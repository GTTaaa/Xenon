import type { AlignTextRequest, TextAlignment } from './textAlignment'

/** 构造包含两侧全部编号片段的用户消息 */
export const buildAlignmentUserMessage = (
  request: AlignTextRequest,
  sourceSegments: TextAlignment['sourceSegments'],
  targetSegments: TextAlignment['targetSegments']
): string => {
  return JSON.stringify({
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    sourceSegments: sourceSegments.map((segment) => [segment.id, segment.text]),
    targetSegments: targetSegments.map((segment) => [segment.id, segment.text])
  })
}
