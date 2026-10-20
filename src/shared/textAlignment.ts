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

/** 学习高亮所在的文本侧 */
export type LearningHighlightSide = 'source' | 'target'

/** 句级对齐响应中可直接展示的英文学习词条 */
export interface LearningLexeme {
  /** 英文原文词形或短语 */
  surface: string
  /** 英文词形还原后的原形 */
  lemma: string
  /** 当前上下文中的简体中文释义 */
  meaning: string
  /** 与英文片段对应的中文连续表达；没有可靠对应时为空字符串 */
  targetText: string
}

/** 经过偏移校验、可直接绑定到原文或译文的学习高亮 */
export interface LearningHighlight extends LearningLexeme {
  /** 高亮编号，例如 h0 */
  id: string
  /** 所属句级对齐组编号 */
  pairId: string
  /** 英文片段位于原文还是译文 */
  side: LearningHighlightSide
  /** 为什么这样表达更地道；英译中时通常为空 */
  note: string
  /** 英文片段在完整原文或完整译文中的起始偏移 */
  start: number
  /** 英文片段在完整原文或完整译文中的结束偏移 */
  end: number
  /** 英文片段起始位置所属的自然句编号 */
  segmentId: string
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
  /** 句级对齐时顺带提取的学习高亮 */
  highlights: LearningHighlight[]
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
  /** 复用主翻译当前选中的服务商与模型 */
  options?: TranslateOptions
}

/** 句级对齐解析所需的语言信息 */
export interface AlignmentParseOptions {
  /** 完整源文，用于还原高亮的精确偏移 */
  sourceText: string
  /** 完整译文，用于还原高亮的精确偏移 */
  targetText: string
  /** 源语言提示名 */
  sourceLanguage: string
  /** 目标语言提示名 */
  targetLanguage: string
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

/** 判断语言提示名是否代表英语或简体中文 */
const isEnglishLanguage = (language: string): boolean => {
  const normalized = language.trim().toUpperCase()
  return normalized === 'EN' || normalized === 'ENGLISH'
}

const isChineseLanguage = (language: string): boolean => {
  const normalized = language.trim().toUpperCase()
  return normalized === 'ZH' || normalized.startsWith('CHINESE')
}

/**
 * 根据当前翻译方向确定学习高亮应落在哪一侧。
 * 英译中标记英文原文，中译英标记生成的英文译文；其他方向不启用学习高亮。
 */
export const resolveLearningHighlightSide = (
  sourceLanguage: string,
  targetLanguage: string
): LearningHighlightSide | null => {
  if (isEnglishLanguage(sourceLanguage) && isChineseLanguage(targetLanguage)) return 'source'
  if (isChineseLanguage(sourceLanguage) && isEnglishLanguage(targetLanguage)) return 'target'
  return null
}

/** 把模型返回的配对引用统一成 p0、p1 形式 */
const normalizePairReference = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return `p${value}`
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null
  if (/^\d+$/.test(normalized)) return `p${normalized}`
  return normalized
}

/** 判断英文短语两端是否落在完整单词边界上 */
const isEnglishWordBoundary = (text: string, start: number, end: number): boolean => {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  return !/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)
}

/** 在限定文本范围内查找精确连续片段 */
const findExactRange = (
  text: string,
  value: string,
  rangeStart: number,
  rangeEnd: number,
  requireEnglishBoundary = false
): { start: number; end: number } | null => {
  let searchFrom = rangeStart

  while (searchFrom <= rangeEnd - value.length) {
    const start = text.indexOf(value, searchFrom)
    if (start < 0 || start + value.length > rangeEnd) return null
    const end = start + value.length

    if (!requireEnglishBoundary || isEnglishWordBoundary(text, start, end)) {
      return { start, end }
    }
    searchFrom = start + 1
  }

  return null
}

/** 获取一对句级片段在完整文本中的连续起止范围 */
const getPairTextRange = (
  pairIds: string[],
  segmentsById: ReadonlyMap<string, AlignmentSegment>
): { start: number; end: number; segmentIds: string[] } | null => {
  const pairSegments = pairIds
    .map((id) => segmentsById.get(id))
    .filter((segment): segment is AlignmentSegment => Boolean(segment))
    .sort((a, b) => a.start - b.start)

  if (pairSegments.length !== pairIds.length || pairSegments.length === 0) return null

  return {
    start: pairSegments[0].start,
    end: pairSegments[pairSegments.length - 1].end,
    segmentIds: pairSegments.map((segment) => segment.id)
  }
}

/**
 * 校验模型顺带返回的学习高亮。
 * 单项数据不可靠时只丢弃该项，不影响已经通过校验的句级对齐。
 */
const parseLearningHighlights = (
  parsed: unknown,
  pairs: AlignmentPair[],
  sourceText: string,
  targetText: string,
  sourceSegments: AlignmentSegment[],
  targetSegments: AlignmentSegment[],
  sourceLanguage: string,
  targetLanguage: string
): LearningHighlight[] => {
  const expectedSide = resolveLearningHighlightSide(sourceLanguage, targetLanguage)
  if (!expectedSide) return []

  const rawHighlights = Array.isArray((parsed as { highlights?: unknown } | null)?.highlights)
    ? ((parsed as { highlights: unknown[] }).highlights as unknown[])
    : []

  const maximumHighlightCount = expectedSide === 'source' ? 3 : 2
  const sourceSegmentsById = new Map(sourceSegments.map((segment) => [segment.id, segment]))
  const targetSegmentsById = new Map(targetSegments.map((segment) => [segment.id, segment]))
  const highlights: LearningHighlight[] = []
  const usedSurfaces = new Set<string>()

  for (const rawHighlight of rawHighlights.slice(0, 24)) {
    if (highlights.length >= maximumHighlightCount) break
    if (!rawHighlight || typeof rawHighlight !== 'object') continue

    const highlightItem = rawHighlight as {
      pairId?: unknown
      side?: unknown
      surface?: unknown
      lemma?: unknown
      meaning?: unknown
      targetText?: unknown
      note?: unknown
    }
    const pairId = normalizePairReference(highlightItem.pairId)
    const side =
      highlightItem.side === 'source' || highlightItem.side === 'target' ? highlightItem.side : null
    if (!pairId || side !== expectedSide) continue

    const pair = pairs.find((item) => item.id === pairId)
    if (!pair) continue

    const englishIds = side === 'source' ? pair.sourceIds : pair.targetIds
    const chineseIds = side === 'source' ? pair.targetIds : pair.sourceIds
    const englishText = side === 'source' ? sourceText : targetText
    const chineseText = side === 'source' ? targetText : sourceText
    const englishSegmentsById = side === 'source' ? sourceSegmentsById : targetSegmentsById
    const chineseSegmentsById = side === 'source' ? targetSegmentsById : sourceSegmentsById
    const englishRange = getPairTextRange(englishIds, englishSegmentsById)
    const chineseRange = getPairTextRange(chineseIds, chineseSegmentsById)
    if (!englishRange || !chineseRange) continue

    const surface =
      typeof highlightItem.surface === 'string'
        ? highlightItem.surface.trim().replace(/\s+/g, ' ')
        : ''
    const lemma =
      typeof highlightItem.lemma === 'string' ? highlightItem.lemma.trim().replace(/\s+/g, ' ') : ''
    const meaning =
      typeof highlightItem.meaning === 'string'
        ? highlightItem.meaning.trim().replace(/\s+/g, ' ')
        : ''
    const correspondingText =
      typeof highlightItem.targetText === 'string'
        ? highlightItem.targetText.trim().replace(/\s+/g, ' ')
        : ''
    const note =
      typeof highlightItem.note === 'string' ? highlightItem.note.trim().replace(/\s+/g, ' ') : ''

    if (!surface || surface.length > 120) continue
    if (!lemma || lemma.length > 80) continue
    if (!meaning || meaning.length > 120) continue
    if (!/^[A-Za-z][A-Za-z'’ -]*$/.test(surface)) continue
    if (!/^[A-Za-z][A-Za-z'’ -]*$/.test(lemma)) continue
    if (!/[\u3400-\u9fff]/.test(meaning)) continue
    if (correspondingText && correspondingText.length > 120) continue
    if (correspondingText && !/[\u3400-\u9fff]/.test(correspondingText)) continue
    if (note.length > 160) continue
    if (side === 'target' && (!note || !/[\u3400-\u9fff]/.test(note))) continue
    if (note && !/[\u3400-\u9fff]/.test(note)) continue

    const normalizedSurface = surface.toLowerCase().replace(/’/g, "'")
    if (!surface.includes(' ') && ENGLISH_LOW_VALUE_WORDS.has(normalizedSurface)) continue
    if (usedSurfaces.has(normalizedSurface)) continue

    const surfaceRange = findExactRange(
      englishText,
      surface,
      englishRange.start,
      englishRange.end,
      true
    )
    if (!surfaceRange) continue

    const correspondingRange =
      correspondingText.length > 0
        ? findExactRange(chineseText, correspondingText, chineseRange.start, chineseRange.end)
        : null
    if (correspondingText && !correspondingRange) continue

    const segmentId =
      englishRange.segmentIds.find((id) => {
        const segment = englishSegmentsById.get(id)
        return (
          segment !== undefined &&
          surfaceRange.start >= segment.start &&
          surfaceRange.start < segment.end
        )
      }) ?? englishRange.segmentIds[0]
    const overlapsExisting = highlights.some(
      (highlight) => surfaceRange.start < highlight.end && surfaceRange.end > highlight.start
    )
    if (overlapsExisting) continue

    usedSurfaces.add(normalizedSurface)
    highlights.push({
      id: `h${highlights.length}`,
      pairId,
      side,
      surface,
      lemma,
      meaning,
      targetText: correspondingText,
      note,
      start: surfaceRange.start,
      end: surfaceRange.end,
      segmentId
    })
  }

  return highlights.sort((a, b) => a.start - b.start)
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
  const highlights = parseLearningHighlights(
    parsed,
    pairs,
    learningOptions?.sourceText ?? '',
    learningOptions?.targetText ?? '',
    sourceSegments,
    targetSegments,
    learningOptions?.sourceLanguage ?? '',
    learningOptions?.targetLanguage ?? ''
  )

  return {
    sourceSegments,
    targetSegments,
    pairs,
    highlights
  }
}
