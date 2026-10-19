import type { TranslateOptions } from './translate'

/** 对齐分段：记录片段文本及其在原文中的 UTF-16 偏移 */
export interface AlignmentSegment {
  /** 稳定的片段编号，例如 s0、t1 */
  id: string
  /** 不含首尾空白的片段文本 */
  text: string
  /** 片段在完整文本中的起始偏移 */
  start: number
  /** 片段在完整文本中的结束偏移 */
  end: number
}

/** 词级片段：只保存可用于学习提示的单词或词片段 */
export interface AlignmentToken {
  /** 稳定的词片段编号，例如 sw0、tw1 */
  id: string
  /** 词片段文本 */
  text: string
  /** 词片段在完整文本中的起始偏移 */
  start: number
  /** 词片段在完整文本中的结束偏移 */
  end: number
  /** 所属自然句片段编号 */
  segmentId: string
}

/** 一组可悬停的上下文词汇提示 */
export interface LearningHint {
  /** 提示编号，例如 h0 */
  id: string
  /** 该提示所属的整句对齐组编号 */
  pairId: string
  /** 英文原文中的单词或短语 */
  sourceText: string
  /** 中文译文中的对应表达 */
  targetText: string
  /** 英文词形还原后的原形；短语通常与原文一致 */
  lemma: string
  /** 当前上下文中的简体中文释义 */
  meaning: string
  /** 原文片段的起始偏移 */
  sourceStart: number
  /** 原文片段的结束偏移 */
  sourceEnd: number
  /** 译文片段的起始偏移 */
  targetStart: number
  /** 译文片段的结束偏移 */
  targetEnd: number
  /** 原文片段所属自然句编号 */
  sourceSegmentId: string
  /** 译文片段所属自然句编号 */
  targetSegmentId: string
}

/** 一组语义对应的源文片段与译文片段 */
export interface AlignmentPair {
  /** 对齐组编号，例如 p0 */
  id: string
  /** 同一组内的源文片段编号 */
  sourceIds: string[]
  /** 同一组内的译文片段编号 */
  targetIds: string[]
}

/** 双向悬停所需的完整对齐数据 */
export interface TextAlignment {
  /** 源文分段 */
  sourceSegments: AlignmentSegment[]
  /** 译文分段 */
  targetSegments: AlignmentSegment[]
  /** 源文与译文的语义对应组 */
  pairs: AlignmentPair[]
  /** 可选的词级学习提示；仅在用户开启学习模式时生成 */
  learningHints?: LearningHint[]
}

/** 文本对齐请求 */
export interface AlignTextRequest {
  /** 已翻译的源文 */
  sourceText: string
  /** 已完成翻译的译文 */
  targetText: string
  /** 源语言提示名 */
  sourceLanguage: string
  /** 目标语言提示名 */
  targetLanguage: string
  /** 是否在整句对齐之外生成词级学习提示 */
  learningMode?: boolean
  /** 复用主翻译当前选中的服务商与模型 */
  options?: TranslateOptions
}

/** 文本对齐成功响应 */
export interface AlignTextSuccessResponse {
  ok: true
  alignment: TextAlignment
}

/** 文本对齐失败响应 */
export interface AlignTextErrorResponse {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type AlignTextResponse = AlignTextSuccessResponse | AlignTextErrorResponse

/** 语言代码或提示名到句段分析区域的映射 */
const SEGMENTER_LOCALE_MAP: Record<string, string> = {
  AUTO: 'en',
  ZH: 'zh',
  EN: 'en',
  JA: 'ja',
  KO: 'ko',
  FR: 'fr',
  DE: 'de',
  ES: 'es',
  RU: 'ru',
  IT: 'it',
  PT: 'pt',
  'CHINESE (SIM)': 'zh',
  ENGLISH: 'en',
  JAPANESE: 'ja',
  KOREAN: 'ko',
  FRENCH: 'fr',
  GERMAN: 'de',
  SPANISH: 'es',
  RUSSIAN: 'ru',
  ITALIAN: 'it',
  PORTUGUESE: 'pt'
}

/** 按语言与粒度缓存文本分析器，避免每次翻译都重复创建 */
const segmenterCache = new Map<string, Intl.Segmenter>()

/**
 * 将语言提示名转换成 Intl.Segmenter 可识别的区域标识。
 * 未识别的语言统一回退到英语规则，至少仍能按常见句末标点切分。
 */
const resolveSegmenterLocale = (language: string): string => {
  const normalized = language.trim().toUpperCase()
  return SEGMENTER_LOCALE_MAP[normalized] || 'en'
}

/** 获取当前语言与粒度对应的文本分析器 */
const getSegmenter = (language: string, granularity: 'sentence' | 'word'): Intl.Segmenter => {
  const locale = resolveSegmenterLocale(language)
  const cacheKey = `${granularity}:${locale}`
  const cached = segmenterCache.get(cacheKey)
  if (cached) return cached

  const segmenter = new Intl.Segmenter(locale, { granularity })
  segmenterCache.set(cacheKey, segmenter)
  return segmenter
}

/** 英文中常以缩写形式出现、句号后不应强制切分的词 */
const ENGLISH_SENTENCE_ABBREVIATIONS = new Set([
  'approx',
  'co',
  'corp',
  'dept',
  'dr',
  'ed',
  'eds',
  'est',
  'etc',
  'fig',
  'inc',
  'jr',
  'ltd',
  'mr',
  'mrs',
  'ms',
  'mx',
  'no',
  'nos',
  'pp',
  'prof',
  'sr',
  'st',
  'vs',
  'vol'
])

/**
 * 查找英文句子内部仍应切分的位置。
 * 浏览器分句器遇到“句号后接小写品牌名”时通常会合并成一段，
 * 例如“…nowhere else. magpie…”，这里补上这条保守规则。
 */
const findEnglishSentenceSplitOffsets = (rawText: string): number[] => {
  const offsets: number[] = []
  const pattern = /([.!?])(["'”’)\]]*)(\s+)(?=[A-Za-z])/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(rawText)) !== null) {
    const previousContent = rawText.slice(0, match.index)
    const previousWord = /([A-Za-z][A-Za-z.'’]*)$/.exec(previousContent)?.[1]?.toLowerCase()
    if (!previousWord) continue
    if (previousWord.length <= 1) continue
    if (previousWord.includes('.')) continue
    if (ENGLISH_SENTENCE_ABBREVIATIONS.has(previousWord)) continue

    const nextContent = rawText.slice(match.index + match[0].length)
    if (!/[A-Za-z0-9]/.test(previousContent)) continue
    if (!/[A-Za-z0-9]/.test(nextContent)) continue

    offsets.push(match.index + 1 + match[2].length)
  }

  return offsets
}

/**
 * 按自然句切分文本，并保留片段在原始字符串中的精确偏移。
 * 片段会去掉首尾空白，片段之间的空白与换行由渲染层原样补回。
 */
export const segmentText = (
  text: string,
  language: string,
  idPrefix: 's' | 't'
): AlignmentSegment[] => {
  if (!text.trim()) return []

  const segments: AlignmentSegment[] = []
  const iterator = getSegmenter(language, 'sentence').segment(text)
  const shouldRefineEnglishSentences = resolveSegmenterLocale(language) === 'en'

  /** 按绝对偏移截取片段，并去掉首尾空白 */
  const pushSegment = (rawStart: number, rawEnd: number): void => {
    const rawText = text.slice(rawStart, rawEnd)
    const leadingWhitespaceLength = rawText.match(/^\s*/)?.[0].length ?? 0
    const trailingWhitespaceLength = rawText.match(/\s*$/)?.[0].length ?? 0
    const start = rawStart + leadingWhitespaceLength
    const end = rawEnd - trailingWhitespaceLength

    if (end <= start) return

    segments.push({
      id: `${idPrefix}${segments.length}`,
      text: text.slice(start, end),
      start,
      end
    })
  }

  for (const item of iterator) {
    const rawText = item.segment
    const splitOffsets = shouldRefineEnglishSentences
      ? findEnglishSentenceSplitOffsets(rawText)
      : []
    let rangeStart = item.index

    for (const splitOffset of [...splitOffsets, rawText.length]) {
      pushSegment(rangeStart, item.index + splitOffset)
      rangeStart = item.index + splitOffset
    }
  }

  return segments
}

/**
 * 在自然句内部继续按单词切分，并保留精确偏移。
 * 只保留可组成词语的片段，标点与空白由原文渲染层原样补回。
 */
export const tokenizeTextWords = (
  text: string,
  language: string,
  segments: AlignmentSegment[],
  idPrefix: 'sw' | 'tw'
): AlignmentToken[] => {
  const tokens: AlignmentToken[] = []

  for (const segment of segments) {
    const segmentText = text.slice(segment.start, segment.end)
    const iterator = getSegmenter(language, 'word').segment(segmentText)

    for (const item of iterator) {
      if (!item.isWordLike) continue

      const rawText = item.segment
      const leadingWhitespaceLength = rawText.match(/^\s*/)?.[0].length ?? 0
      const trailingWhitespaceLength = rawText.match(/\s*$/)?.[0].length ?? 0
      const start = segment.start + item.index + leadingWhitespaceLength
      const end = segment.start + item.index + rawText.length - trailingWhitespaceLength

      if (end <= start) continue

      tokens.push({
        id: `${idPrefix}${tokens.length}`,
        text: text.slice(start, end),
        start,
        end,
        segmentId: segment.id
      })
    }
  }

  return tokens
}

/** 英语中通常不单独作为学习目标的虚词 */
const ENGLISH_LOW_VALUE_WORDS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'mine',
  'we',
  'us',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'it',
  'its',
  'they',
  'them',
  'their',
  'theirs',
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'and',
  'or',
  'but',
  'if',
  'because',
  'while',
  'than',
  'then',
  'so',
  'such',
  'very',
  'too',
  'also',
  'just',
  'only',
  'both',
  'either',
  'neither',
  'nor',
  'none',
  'not',
  'no',
  'never',
  'cannot',
  'nobody',
  'nothing',
  'nowhere',
  'anyone',
  'anybody',
  'anything',
  'everyone',
  'everybody',
  'everything',
  'someone',
  'somebody',
  'something',
  'one',
  'oneself',
  'there',
  'yes',
  "i'm",
  "you're",
  "we're",
  "they're",
  "it's",
  "don't",
  "doesn't",
  "didn't",
  "can't",
  "won't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "i've",
  "we've",
  "you've",
  "they've",
  "i'll",
  "we'll",
  "you'll",
  "they'll",
  "i'd",
  "we'd",
  "you'd",
  "they'd"
])

/** 中文中通常只承担语法作用、不单独生成学习提示的词 */
const CHINESE_LOW_VALUE_WORDS = new Set([
  '的',
  '地',
  '得',
  '了',
  '着',
  '过',
  '是',
  '在',
  '和',
  '与',
  '及',
  '或',
  '而',
  '但',
  '就',
  '都',
  '也',
  '还',
  '又',
  '很',
  '更',
  '最',
  '这',
  '那',
  '个',
  '些',
  '吗',
  '呢',
  '吧',
  '啊',
  '呀'
])

/**
 * 过滤低学习价值词片段，并重新编号为连续编号。
 * 完整句子仍会发送给模型，因此过滤候选词不会丢失上下文。
 */
export const filterLearningTokens = (
  tokens: AlignmentToken[],
  language: string,
  idPrefix: 'sw' | 'tw'
): AlignmentToken[] => {
  const locale = resolveSegmenterLocale(language)
  const firstTokenIdBySegment = new Map<string, string>()

  for (const token of tokens) {
    if (!firstTokenIdBySegment.has(token.segmentId)) {
      firstTokenIdBySegment.set(token.segmentId, token.id)
    }
  }

  return tokens
    .filter((token) => {
      if (!token.text.trim()) return false
      if (/\d/.test(token.text)) return false

      const normalizedText = token.text.toLowerCase().replace(/’/g, "'")
      if (locale === 'en') {
        if (ENGLISH_LOW_VALUE_WORDS.has(normalizedText)) return false
        if (!/^[A-Za-z][A-Za-z'’-]*$/.test(token.text)) return false

        // 缩写词、品牌名和句中的首字母大写词通常是专有名词，不作为学习候选
        const hasInternalUppercase = /[A-Z]/.test(token.text.slice(1))
        const isAllCaps =
          token.text.length > 1 &&
          token.text === token.text.toUpperCase() &&
          /[A-Z]/.test(token.text)
        const isMidSentenceTitleCase =
          /^[A-Z][a-z'’-]+$/.test(token.text) &&
          firstTokenIdBySegment.get(token.segmentId) !== token.id

        return !hasInternalUppercase && !isAllCaps && !isMidSentenceTitleCase
      }
      if (locale === 'zh') return !CHINESE_LOW_VALUE_WORDS.has(token.text)
      return true
    })
    .map((token, index) => ({
      ...token,
      id: `${idPrefix}${index}`
    }))
}

/** 从模型回复中提取 JSON，兼容代码围栏和前后说明文字 */
const extractJsonValue = (rawText: string): unknown => {
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // 模型偶尔会在 JSON 前后补充一句话，继续尝试截取最外层对象或数组
  }

  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(cleaned.slice(objectStart, objectEnd + 1))
    } catch {
      // 继续尝试数组形式
    }
  }

  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
    } catch {
      return null
    }
  }

  return null
}

/** 判断编号数组是否是连续递增的，避免模型生成跨越、乱序的片段组合 */
const isContiguousSequence = (indexes: number[]): boolean => {
  if (indexes.length === 0) return false
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] !== indexes[index - 1] + 1) return false
  }
  return true
}

/** 词级解析参数：只有开启学习模式时才会传入 */
export interface AlignmentParseOptions {
  /** 完整英文原文，用于还原精确短语 */
  sourceText: string
  /** 完整中文译文，用于还原精确短语 */
  targetText: string
  /** 英文原文词片段 */
  sourceTokens: AlignmentToken[]
  /** 中文译文词片段 */
  targetTokens: AlignmentToken[]
}

/** 把模型返回的词片段编号统一成 sw0、tw0 形式 */
const normalizeTokenId = (value: unknown, prefix: 'sw' | 'tw'): string | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return `${prefix}${value}`
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

/** 只接受模型明确标记为高置信度的结果，避免把猜测包装成学习提示 */
const isHighConfidenceHint = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'high'
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.9
}

/**
 * 校验模型返回的词级学习提示。
 * 单条提示不可靠时只丢弃该提示，保留其他高置信结果；
 * 只有词级提示整体结构异常时才返回 null。
 */
const parseLearningHints = (
  parsed: unknown,
  pairs: AlignmentPair[],
  sourceText: string,
  targetText: string,
  sourceTokens: AlignmentToken[],
  targetTokens: AlignmentToken[]
): LearningHint[] | null => {
  const rawHints = (parsed as { learningHints?: unknown } | null)?.learningHints
  if (!Array.isArray(rawHints) || rawHints.length > 80) return null

  const sourceTokenIndexById = new Map(sourceTokens.map((token, index) => [token.id, index]))
  const targetTokenIndexById = new Map(targetTokens.map((token, index) => [token.id, index]))
  const targetSegmentIdsBySourceSegmentId = new Map<string, Set<string>>()
  const pairIdBySourceSegmentId = new Map<string, string>()

  for (const pair of pairs) {
    const targetSegmentIds = new Set(pair.targetIds)
    for (const sourceSegmentId of pair.sourceIds) {
      targetSegmentIdsBySourceSegmentId.set(sourceSegmentId, targetSegmentIds)
      pairIdBySourceSegmentId.set(sourceSegmentId, pair.id)
    }
  }

  const usedSourceTokenIds = new Set<string>()
  const usedTargetTokenIds = new Set<string>()
  const hints: LearningHint[] = []

  for (const rawHint of rawHints) {
    if (!rawHint || typeof rawHint !== 'object') continue

    const hintItem = rawHint as {
      source?: unknown
      target?: unknown
      sourceIds?: unknown
      targetIds?: unknown
      lemma?: unknown
      meaning?: unknown
      confidence?: unknown
    }

    // 低置信和未标记置信度的结果直接丢弃
    if (!isHighConfidenceHint(hintItem.confidence)) continue

    const rawSourceIds = hintItem.source ?? hintItem.sourceIds
    const rawTargetIds = hintItem.target ?? hintItem.targetIds
    if (!Array.isArray(rawSourceIds) || !Array.isArray(rawTargetIds)) continue
    if (rawSourceIds.length === 0 || rawSourceIds.length > 8) continue
    if (rawTargetIds.length === 0 || rawTargetIds.length > 12) continue

    const sourceIds = rawSourceIds
      .map((value) => normalizeTokenId(value, 'sw'))
      .filter((value): value is string => Boolean(value))
    const targetIds = rawTargetIds
      .map((value) => normalizeTokenId(value, 'tw'))
      .filter((value): value is string => Boolean(value))

    if (sourceIds.length !== rawSourceIds.length) continue
    if (targetIds.length !== rawTargetIds.length) continue

    // 同一条提示内部出现重复编号时，只丢弃这一条不稳定结果
    if (new Set(sourceIds).size !== sourceIds.length) continue
    if (new Set(targetIds).size !== targetIds.length) continue

    const sourceIndexes = sourceIds.map((id) => sourceTokenIndexById.get(id))
    const targetIndexes = targetIds.map((id) => targetTokenIndexById.get(id))
    if (sourceIndexes.some((value) => value === undefined)) continue
    if (targetIndexes.some((value) => value === undefined)) continue

    const normalizedSourceIndexes = (sourceIndexes as number[]).sort((a, b) => a - b)
    const normalizedTargetIndexes = (targetIndexes as number[]).sort((a, b) => a - b)
    if (!isContiguousSequence(normalizedSourceIndexes)) continue
    if (!isContiguousSequence(normalizedTargetIndexes)) continue

    const sourceTokensInHint = normalizedSourceIndexes.map((index) => sourceTokens[index])
    const targetTokensInHint = normalizedTargetIndexes.map((index) => targetTokens[index])
    const sourceSegmentId = sourceTokensInHint[0].segmentId
    const targetSegmentId = targetTokensInHint[0].segmentId
    if (sourceTokensInHint.some((token) => token.segmentId !== sourceSegmentId)) continue
    if (targetTokensInHint.some((token) => token.segmentId !== targetSegmentId)) continue

    const allowedTargetSegments = targetSegmentIdsBySourceSegmentId.get(sourceSegmentId)
    if (!allowedTargetSegments?.has(targetSegmentId)) continue
    if (sourceIds.some((id) => usedSourceTokenIds.has(id))) continue
    if (targetIds.some((id) => usedTargetTokenIds.has(id))) continue

    const sourceStart = Math.min(...sourceTokensInHint.map((token) => token.start))
    const sourceEnd = Math.max(...sourceTokensInHint.map((token) => token.end))
    const targetStart = Math.min(...targetTokensInHint.map((token) => token.start))
    const targetEnd = Math.max(...targetTokensInHint.map((token) => token.end))
    const sourceRawText = sourceText.slice(sourceStart, sourceEnd)
    const targetRawText = targetText.slice(targetStart, targetEnd)
    const lemma = typeof hintItem.lemma === 'string' ? hintItem.lemma.trim() : ''
    const meaning =
      typeof hintItem.meaning === 'string' ? hintItem.meaning.trim().replace(/\s+/g, ' ') : ''

    if (!lemma || lemma.length > 80) continue
    if (!meaning || meaning.length > 80) continue
    if (!/^[A-Za-z][A-Za-z' -]*$/.test(lemma)) continue
    if (!/[\u3400-\u9fff]/.test(meaning)) continue
    if (!/[\u3400-\u9fff]/.test(targetRawText)) continue
    if (sourceEnd - sourceStart > 120 || targetEnd - targetStart > 120) continue

    for (const id of sourceIds) usedSourceTokenIds.add(id)
    for (const id of targetIds) usedTargetTokenIds.add(id)

    hints.push({
      id: `h${hints.length}`,
      pairId: pairIdBySourceSegmentId.get(sourceSegmentId) as string,
      sourceText: sourceRawText,
      targetText: targetRawText,
      lemma,
      meaning,
      sourceStart,
      sourceEnd,
      targetStart,
      targetEnd,
      sourceSegmentId,
      targetSegmentId
    })
  }

  return hints.sort((a, b) => a.sourceStart - b.sourceStart)
}

/**
 * 校验并规范化模型返回的编号配对。
 * 采用严格校验：所有片段必须且只能出现一次，且配对顺序不能交叉。
 * 任一条不满足就返回 null，由调用方关闭悬停关联，绝不猜测映射。
 */
export const parseAlignmentPairs = (
  rawText: string,
  sourceSegments: AlignmentSegment[],
  targetSegments: AlignmentSegment[],
  learningOptions?: AlignmentParseOptions
): TextAlignment | null => {
  if (sourceSegments.length === 0 || targetSegments.length === 0) return null

  const parsed = extractJsonValue(rawText)
  const rawPairs = Array.isArray(parsed) ? parsed : (parsed as { pairs?: unknown } | null)?.pairs

  if (!Array.isArray(rawPairs)) return null

  const sourceIndexById = new Map(sourceSegments.map((segment, index) => [segment.id, index]))
  const targetIndexById = new Map(targetSegments.map((segment, index) => [segment.id, index]))
  const usedSourceIds = new Set<string>()
  const usedTargetIds = new Set<string>()

  /** 把模型可能返回的数字编号或字符串编号统一成 s0、t0 形式 */
  const normalizeId = (value: unknown, prefix: 's' | 't'): string | null => {
    if (typeof value === 'number' && Number.isInteger(value)) return `${prefix}${value}`
    if (typeof value === 'string' && value.trim()) return value.trim()
    return null
  }

  const normalizedPairs: Array<{
    sourceIndexes: number[]
    targetIndexes: number[]
  }> = []

  for (const item of rawPairs) {
    if (!item || typeof item !== 'object') return null

    const pairItem = item as {
      source?: unknown
      target?: unknown
      sourceIds?: unknown
      targetIds?: unknown
    }
    const rawSourceIds = pairItem.source ?? pairItem.sourceIds
    const rawTargetIds = pairItem.target ?? pairItem.targetIds
    if (!Array.isArray(rawSourceIds) || !Array.isArray(rawTargetIds)) return null

    const sourceIds = Array.from(
      new Set(
        rawSourceIds
          .map((value) => normalizeId(value, 's'))
          .filter((value): value is string => Boolean(value))
      )
    )
    const targetIds = Array.from(
      new Set(
        rawTargetIds
          .map((value) => normalizeId(value, 't'))
          .filter((value): value is string => Boolean(value))
      )
    )

    if (sourceIds.length === 0 || targetIds.length === 0) return null

    const sourceIndexes = sourceIds.map((id) => sourceIndexById.get(id))
    const targetIndexes = targetIds.map((id) => targetIndexById.get(id))
    if (sourceIndexes.some((value) => value === undefined)) return null
    if (targetIndexes.some((value) => value === undefined)) return null

    const normalizedSourceIndexes = (sourceIndexes as number[]).sort((a, b) => a - b)
    const normalizedTargetIndexes = (targetIndexes as number[]).sort((a, b) => a - b)
    if (!isContiguousSequence(normalizedSourceIndexes)) return null
    if (!isContiguousSequence(normalizedTargetIndexes)) return null

    for (const id of sourceIds) {
      if (usedSourceIds.has(id)) return null
      usedSourceIds.add(id)
    }
    for (const id of targetIds) {
      if (usedTargetIds.has(id)) return null
      usedTargetIds.add(id)
    }

    normalizedPairs.push({
      sourceIndexes: normalizedSourceIndexes,
      targetIndexes: normalizedTargetIndexes
    })
  }

  if (usedSourceIds.size !== sourceSegments.length) return null
  if (usedTargetIds.size !== targetSegments.length) return null

  normalizedPairs.sort((a, b) => a.sourceIndexes[0] - b.sourceIndexes[0])

  let previousTargetEnd = -1
  for (const pair of normalizedPairs) {
    if (pair.targetIndexes[0] <= previousTargetEnd) return null
    previousTargetEnd = pair.targetIndexes[pair.targetIndexes.length - 1]
  }

  const pairs: AlignmentPair[] = normalizedPairs.map((pair, index) => ({
    id: `p${index}`,
    sourceIds: pair.sourceIndexes.map((sourceIndex) => sourceSegments[sourceIndex].id),
    targetIds: pair.targetIndexes.map((targetIndex) => targetSegments[targetIndex].id)
  }))
  const learningHints = learningOptions
    ? parseLearningHints(
        parsed,
        pairs,
        learningOptions.sourceText,
        learningOptions.targetText,
        learningOptions.sourceTokens,
        learningOptions.targetTokens
      )
    : undefined

  return {
    sourceSegments,
    targetSegments,
    pairs,
    ...(learningHints ? { learningHints } : {})
  }
}
