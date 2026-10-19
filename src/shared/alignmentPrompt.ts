import type { AlignTextRequest, AlignmentToken, TextAlignment } from './textAlignment'

/** 紧凑词片段：只保留模型生成提示所需的编号与文本 */
type CompactWord = [string, string]

/** 按自然句分组的词片段：句子编号只出现一次 */
type CompactWordsBySegment = Array<[string, CompactWord[]]>

/** 把词片段按所属自然句分组，减少重复的句子编号 */
const groupTokensBySegment = (
  tokens: AlignmentToken[],
  segments: TextAlignment['sourceSegments']
): CompactWordsBySegment => {
  const wordsBySegmentId = new Map<string, CompactWord[]>()

  for (const token of tokens) {
    const words = wordsBySegmentId.get(token.segmentId)
    const compactWord: CompactWord = [token.id, token.text]
    if (words) {
      words.push(compactWord)
    } else {
      wordsBySegmentId.set(token.segmentId, [compactWord])
    }
  }

  return segments.map((segment) => [segment.id, wordsBySegmentId.get(segment.id) ?? []])
}

/** 构造包含两侧全部编号片段的用户消息 */
export const buildAlignmentUserMessage = (
  request: AlignTextRequest,
  sourceSegments: TextAlignment['sourceSegments'],
  targetSegments: TextAlignment['targetSegments'],
  sourceTokens?: AlignmentToken[],
  targetTokens?: AlignmentToken[]
): string => {
  const sourceWords = sourceTokens ? groupTokensBySegment(sourceTokens, sourceSegments) : undefined
  const targetWords = targetTokens ? groupTokensBySegment(targetTokens, targetSegments) : undefined

  return JSON.stringify({
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    sourceSegments: sourceSegments.map((segment) => [segment.id, segment.text]),
    targetSegments: targetSegments.map((segment) => [segment.id, segment.text]),
    ...(sourceWords && targetWords
      ? {
          sourceWords,
          targetWords
        }
      : {})
  })
}
