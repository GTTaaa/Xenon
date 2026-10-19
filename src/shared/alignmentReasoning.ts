/** 对齐请求支持的推理强度 */
export type AlignmentReasoningEffort = 'none' | 'low'

/**
 * 按模型能力选择对齐请求的推理强度。
 * DeepSeek 可以关闭推理以降低等待时间；GLM 强制启用推理，只能使用低强度。
 * 未识别的模型不传该参数，保留服务商自身的默认行为。
 */
export const resolveAlignmentReasoningEffort = (
  model: string
): AlignmentReasoningEffort | undefined => {
  const normalizedModel = model.trim().toLowerCase()
  if (!normalizedModel) return undefined

  if (normalizedModel.includes('glm')) return 'low'
  if (normalizedModel.includes('deepseek')) return 'none'
  return undefined
}
