/**
 * 大模型流式输出测速工具
 *
 * 供「测试当前连接」功能使用：一边消费 OpenAI 兼容接口的流式响应，
 * 一边统计首 token 延迟与输出 token 数，最终换算出每秒输出 token 数。
 */

/**
 * 测速提示词：让模型输出一段长度适中的内容，便于稳定估算每秒输出 token 数
 */
export const SPEED_TEST_PROMPT =
  '请从 1 连续数到 60，数字之间用英文空格分隔，只输出数字本身，不要输出任何解释或多余文字。'

/**
 * 流式测速的统计结果
 */
export interface StreamSpeedStats {
  /** 从发起请求到收到第一个内容分片的耗时（毫秒），未收到内容时为 0 */
  firstTokenMs: number
  /** 从发起请求到流式输出结束的总耗时（毫秒） */
  totalMs: number
  /** 本次输出统计到的 token 数 */
  outputTokens: number
  /** token 数是否为估算值（服务端未返回 usage 时为 true） */
  estimated: boolean
  /** 是否真的收到了模型输出的内容 */
  hasContent: boolean
}

/**
 * 解析 OpenAI 兼容接口的流式响应，统计首 token 延迟与输出 token 数
 *
 * token 数优先取服务端返回的 `usage.completion_tokens`；
 * 若服务端未返回 usage（部分兼容服务或未开启统计），则退化为按内容分片数量估算。
 * 另外，部分服务会忽略 stream 参数直接返回整段 JSON，此时按一次性响应兜底统计。
 *
 * @param body 响应体的可读流
 * @param startTime 请求发起时刻的时间戳（毫秒）
 */
export const consumeChatCompletionStream = async (
  body: ReadableStream<Uint8Array>,
  startTime: number
): Promise<StreamSpeedStats> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let rawText = ''
  let firstTokenMs = 0
  let lastTokenMs = 0
  let contentChunkCount = 0
  let usageTokens = 0
  // 是否走了「服务端忽略 stream 参数」的整段 JSON 兜底：此时耗时含首包延迟，只能算估算值
  let wholeResponseFallback = false

  /**
   * 逐行解析 SSE 数据，提取增量内容与 usage 统计
   */
  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return

    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let parsed: {
      // reasoning_content 是部分推理模型（如 DeepSeek R1 系列）的思考内容字段，同样视为有效输出
      choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>
      usage?: { completion_tokens?: number }
    }
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }

    const delta = parsed.choices?.[0]?.delta
    const deltaContent = delta?.content || delta?.reasoning_content
    if (typeof deltaContent === 'string' && deltaContent.length > 0) {
      contentChunkCount += 1
      const elapsed = Date.now() - startTime
      if (!firstTokenMs) firstTokenMs = elapsed
      lastTokenMs = elapsed
    }

    if (typeof parsed.usage?.completion_tokens === 'number') {
      usageTokens = parsed.usage.completion_tokens
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    buffer += text
    // 只保留有限长度的原始响应，用于识别「服务端忽略了 stream 参数」的场景
    if (rawText.length < 200000) rawText += text

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }

  if (buffer) handleLine(buffer)

  // 兜底：部分兼容服务会忽略 stream 参数直接返回整段 JSON，此时按一次性响应统计
  if (contentChunkCount === 0 && rawText.trim()) {
    try {
      const whole = JSON.parse(rawText) as {
        choices?: Array<{ message?: { content?: string | null } }>
        usage?: { completion_tokens?: number }
      }
      const wholeContent = whole.choices?.[0]?.message?.content
      if (typeof wholeContent === 'string' && wholeContent.length > 0) {
        contentChunkCount = 1
        usageTokens = whole.usage?.completion_tokens ?? 0
        wholeResponseFallback = true
      }
    } catch {
      // 非 JSON 响应保持「未收到内容」的判定，交由调用方处理
    }
  }

  return {
    firstTokenMs,
    totalMs: Math.max(Date.now() - startTime, lastTokenMs),
    outputTokens: usageTokens || contentChunkCount,
    estimated: !usageTokens || wholeResponseFallback,
    hasContent: contentChunkCount > 0
  }
}

/**
 * 由统计结果换算每秒输出 token 数
 *
 * 计算时扣掉首 token 延迟，只统计真正持续吐字的那段时间；
 * 输出过短（生成阶段不足 100ms）时速度噪声过大，直接返回 undefined 表示无法测量。
 */
export const calculateTokensPerSecond = (stats: StreamSpeedStats): number | undefined => {
  const generateMs = stats.totalMs - stats.firstTokenMs
  if (!stats.hasContent || stats.outputTokens <= 0 || generateMs < 100) return undefined
  return (stats.outputTokens / generateMs) * 1000
}
