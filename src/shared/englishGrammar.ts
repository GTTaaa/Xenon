/** 把英文撇号统一成直撇号，避免不同输入法影响语法词判断 */
const normalizeApostrophes = (text: string): string => {
  return text.trim().toLowerCase().replace(/’/g, "'")
}

/**
 * 判断一个英文词是否是语法缩写。
 * 这里只识别助动词、否定式和常见代词缩写，不把名词所有格误判成语法词。
 */
export const isGrammarContraction = (text: string): boolean => {
  const normalized = normalizeApostrophes(text)
  if (!normalized.includes("'")) return false

  return (
    /^[a-z]+n't$/.test(normalized) ||
    /^(?:i|you|we|they|he|she|it)'(?:m|re|ve|ll|d)$/.test(normalized) ||
    normalized === "let's"
  )
}

/**
 * 判断多词片段是否以语法缩写开头。
 * 例如 "didn't eat" 只能表示语法与实义动词的组合，不能当成一个词汇短语。
 */
export const isGrammarContractionPhrase = (text: string): boolean => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized.includes(' ')) return false

  const words = normalized.split(' ')
  const firstWord = words[0] ?? ''
  const secondWord = words[1] ?? ''
  const startsWithSubjectPronoun = /^(?:i|you|we|they|he|she|it)$/i.test(firstWord)

  return (
    isGrammarContraction(firstWord) ||
    (startsWithSubjectPronoun && isGrammarContraction(secondWord))
  )
}
