import type { TranslateOptions } from './translate'

/** 用户在原文中选中的英文单词及其精确偏移 */
export interface EnglishWordSelection {
  /** 命中的英文单词 */
  text: string
  /** 单词在完整原文中的起始偏移 */
  start: number
  /** 单词在完整原文中的结束偏移 */
  end: number
}

/** 单词上下文释义请求 */
export interface WordLookupRequest {
  /** 用户点击的英文单词 */
  word: string
  /** 单词所在的完整英文句段 */
  sourceSentence: string
  /** 与英文句段对应的完整中文译文 */
  targetSentence: string
  /** 源语言提示名 */
  sourceLanguage: string
  /** 目标语言提示名 */
  targetLanguage: string
  /** 复用当前翻译服务商与模型 */
  options?: TranslateOptions
}

/** 模型返回并通过严格校验的上下文释义 */
export interface WordLookupResult {
  /** 英文词形还原后的原形 */
  lemma: string
  /** 当前语境中的简体中文释义 */
  meaning: string
  /** 译文中直接对应的连续表达；没有可靠对应时为空字符串 */
  targetText: string
}

/** 单词查询成功响应 */
export interface WordLookupSuccessResponse {
  ok: true
  result: WordLookupResult
}

/** 单词查询失败响应 */
export interface WordLookupErrorResponse {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type WordLookupResponse = WordLookupSuccessResponse | WordLookupErrorResponse

/** 判断字符是否可以出现在英文单词内部 */
const isEnglishWordCharacter = (character: string): boolean => {
  return /[A-Za-z'’-]/.test(character)
}

/**
 * 根据输入框光标偏移找到英文单词。
 * 点击单词末尾时光标可能落在单词之后，因此会先后检查 offset 和 offset - 1。
 */
export const findEnglishWordAtOffset = (
  text: string,
  offset: number
): EnglishWordSelection | null => {
  const normalizedOffset = Math.max(0, Math.min(offset, text.length))
  const indexesToCheck = [normalizedOffset, normalizedOffset - 1]
  let wordIndex = -1

  for (const index of indexesToCheck) {
    if (index >= 0 && index < text.length && isEnglishWordCharacter(text[index])) {
      wordIndex = index
      break
    }
  }

  if (wordIndex < 0) return null

  let start = wordIndex
  let end = wordIndex + 1
  while (start > 0 && isEnglishWordCharacter(text[start - 1])) start -= 1
  while (end < text.length && isEnglishWordCharacter(text[end])) end += 1

  // 去掉引号或连字符单独落在词首、词尾的情况
  while (start < end && !/[A-Za-z]/.test(text[start])) start += 1
  while (end > start && !/[A-Za-z]/.test(text[end - 1])) end -= 1
  if (start >= end) return null

  const selectedText = text.slice(start, end)
  if (!/[A-Za-z]/.test(selectedText)) return null

  return {
    text: selectedText,
    start,
    end
  }
}

/** 从模型回复中提取最外层 JSON 对象 */
const extractJsonObject = (rawText: string): unknown => {
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // 模型偶尔会在 JSON 前后附带说明，继续截取最外层对象
  }

  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) return null

  try {
    return JSON.parse(cleaned.slice(objectStart, objectEnd + 1))
  } catch {
    return null
  }
}

/**
 * 严格校验模型返回的上下文释义。
 * 任何字段不可靠时直接拒绝，避免把猜测展示成确定词义。
 */
export const parseWordLookupResult = (
  rawText: string,
  targetSentence: string
): WordLookupResult | null => {
  const parsed = extractJsonObject(rawText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const item = parsed as {
    lemma?: unknown
    meaning?: unknown
    targetText?: unknown
    confidence?: unknown
  }
  const confidence = typeof item.confidence === 'string' ? item.confidence.trim().toLowerCase() : ''
  if (confidence !== 'high') return null

  const lemma = typeof item.lemma === 'string' ? item.lemma.trim() : ''
  const meaning = typeof item.meaning === 'string' ? item.meaning.trim().replace(/\s+/g, ' ') : ''
  const targetText =
    typeof item.targetText === 'string' ? item.targetText.trim().replace(/\s+/g, ' ') : ''

  if (!lemma || lemma.length > 80) return null
  if (!meaning || meaning.length > 80) return null
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(lemma)) return null
  if (!/[\u3400-\u9fff]/.test(meaning)) return null
  if (targetText.length > 120) return null
  if (targetText && !targetSentence.includes(targetText)) return null

  return {
    lemma,
    meaning,
    targetText
  }
}
