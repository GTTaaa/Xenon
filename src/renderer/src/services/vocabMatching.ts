import type { VocabItem } from './vocabDatabase'

/** 英文文本中的单个词出现位置 */
export interface EnglishWordOccurrence {
  /** 原始词形 */
  word: string
  /** 小写归一化词形 */
  wordLower: string
  /** 在完整文本中的起始偏移 */
  start: number
  /** 在完整文本中的结束偏移 */
  end: number
}

/** 已收录多词短语在文本中的一次出现 */
export interface VocabPhraseMatch {
  /** 命中的本地词条 */
  item: VocabItem
  /** 在完整文本中的起始偏移 */
  start: number
  /** 在完整文本中的结束偏移 */
  end: number
}

/** 本地词条在英文文本中的一次完整匹配 */
export interface VocabTextMatch {
  /** 命中的本地词条 */
  item: VocabItem
  /** 文本中实际出现的词形 */
  surface: string
  /** 在完整文本中的起始偏移 */
  start: number
  /** 在完整文本中的结束偏移 */
  end: number
}

/** 匹配英文单词、缩写和连字符复合词 */
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

/** 提取英文文本中全部单词及其精确偏移 */
export const extractEnglishWordOccurrences = (text: string): EnglishWordOccurrence[] => {
  const occurrences: EnglishWordOccurrence[] = []

  for (const match of text.matchAll(ENGLISH_WORD_PATTERN)) {
    const word = match[0]
    const start = match.index
    if (start === undefined) continue
    occurrences.push({
      word,
      wordLower: word.toLowerCase().replace(/’/g, "'"),
      start,
      end: start + word.length
    })
  }

  return occurrences
}

/** 提取当前文本中需要批量查询的唯一小写词形 */
export const collectUniqueEnglishWords = (text: string): string[] => {
  return Array.from(new Set(extractEnglishWordOccurrences(text).map((item) => item.wordLower)))
}

/** 转义正则中的普通字符 */
const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 查找已收录多词短语的实际出现位置。
 * 长短语优先，并与已经占用的范围去重，避免嵌套高亮互相覆盖。
 */
export const findVocabPhraseMatches = (text: string, items: VocabItem[]): VocabPhraseMatch[] => {
  const phraseItems = items
    .filter((item) => item.lemmaLower.includes(' '))
    .sort((a, b) => b.lemmaLower.length - a.lemmaLower.length)
  const matches: VocabPhraseMatch[] = []

  for (const item of phraseItems) {
    const phrasePattern = escapeRegExp(item.lemmaLower).replace(/\\?\s+/g, '\\s+')
    const pattern = new RegExp(`(?<![A-Za-z])${phrasePattern}(?![A-Za-z])`, 'gi')

    for (const match of text.matchAll(pattern)) {
      const start = match.index
      if (start === undefined) continue
      const end = start + match[0].length
      const overlaps = matches.some((existing) => start < existing.end && end > existing.start)
      if (overlaps) continue
      matches.push({ item, start, end })
    }
  }

  return matches.sort((a, b) => a.start - b.start)
}

/**
 * 同时匹配多词短语与单词，供译文完成后的二次偶遇高亮使用。
 * 短语先占位，单词再补入未重叠范围，避免同一段文本被重复装饰。
 */
export const findVocabTextMatches = (text: string, items: VocabItem[]): VocabTextMatch[] => {
  const phraseMatches = findVocabPhraseMatches(text, items)
  const itemByLemma = new Map(items.map((item) => [item.lemmaLower, item]))
  const matches: VocabTextMatch[] = phraseMatches.map((match) => ({
    item: match.item,
    surface: text.slice(match.start, match.end),
    start: match.start,
    end: match.end
  }))

  for (const occurrence of extractEnglishWordOccurrences(text)) {
    const item = itemByLemma.get(occurrence.wordLower)
    if (!item) continue

    const overlaps = matches.some(
      (existing) => occurrence.start < existing.end && occurrence.end > existing.start
    )
    if (overlaps) continue

    matches.push({
      item,
      surface: occurrence.word,
      start: occurrence.start,
      end: occurrence.end
    })
  }

  return matches.sort((a, b) => a.start - b.start)
}

/** 把闪卡英文原句拆成生词前后三段，便于挖空展示 */
export const splitSentenceAroundVocab = (
  sentence: string,
  surfaceOrLemma: string
): { before: string; match: string; after: string } => {
  const normalizedNeedle = surfaceOrLemma.trim()
  if (!normalizedNeedle) return { before: sentence, match: '', after: '' }

  const pattern = new RegExp(
    `(?<![A-Za-z])${escapeRegExp(normalizedNeedle).replace(/\\?\s+/g, '\\s+')}(?![A-Za-z])`,
    'i'
  )
  const match = pattern.exec(sentence)
  if (!match || match.index === undefined) {
    return { before: sentence, match: '', after: '' }
  }

  return {
    before: sentence.slice(0, match.index),
    match: match[0],
    after: sentence.slice(match.index + match[0].length)
  }
}
