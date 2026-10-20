/** 流式翻译解析结果 */
export interface ChatCompletionStreamResult {
  /** 清洗后的完整译文 */
  text: string
  /** 实际收到的内容分片数量；整段 JSON 兜底时记为 1 */
  contentChunkCount: number
}

/** 流式接口在响应体中返回业务错误时使用的异常 */
export class ChatCompletionStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatCompletionStreamError'
  }
}

/** OpenAI 兼容接口中可能出现的消息内容结构 */
type MessageContent = string | Array<{ text?: string; content?: string }> | null | undefined

/** 从字符串或分段数组里提取正文 */
const extractContent = (content: MessageContent): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => (typeof item === 'object' ? item.text || item.content || '' : String(item)))
    .join('')
}

/**
 * 从非流式或整段 JSON 响应中提取正文。
 * 同时兼容标准 choices 与部分网关额外包一层的 data.choices。
 */
export const extractChatCompletionText = (data: unknown): string => {
  if (!data || typeof data !== 'object') return ''

  const payload = data as {
    choices?: Array<{
      message?: { content?: MessageContent }
      text?: string
    }>
    data?: {
      choices?: Array<{
        message?: { content?: MessageContent }
        text?: string
      }>
    }
  }
  const firstChoice = (payload.data?.choices ?? payload.choices)?.[0]
  const messageContent = extractContent(firstChoice?.message?.content)
  if (messageContent) return messageContent
  return typeof firstChoice?.text === 'string' ? firstChoice.text : ''
}

/**
 * 创建可跨分片工作的思考标签清理器。
 * 部分模型即使被要求只返回译文，仍可能输出 <think> 内容，增量渲染时必须避免短暂闪现。
 */
const createThinkTagStripper = (): {
  push: (chunk: string) => string
  flush: () => string
} => {
  const openTag = '<think>'
  const closeTag = '</think>'
  let insideThink = false
  let pending = ''

  /** 找出字符串末尾可能是某个标签前缀的长度，避免把跨分片的标签直接输出 */
  const findPartialTagLength = (text: string, tag: string): number => {
    const lowerText = text.toLowerCase()
    const maxLength = Math.min(text.length, tag.length - 1)

    for (let length = maxLength; length > 0; length -= 1) {
      if (lowerText.endsWith(tag.slice(0, length))) return length
    }
    return 0
  }

  const push = (chunk: string): string => {
    pending += chunk
    let output = ''

    while (pending) {
      if (insideThink) {
        const closeIndex = pending.toLowerCase().indexOf(closeTag)
        if (closeIndex === -1) {
          const keepLength = findPartialTagLength(pending, closeTag)
          pending = pending.slice(pending.length - keepLength)
          break
        }

        pending = pending.slice(closeIndex + closeTag.length)
        insideThink = false
        continue
      }

      const openIndex = pending.toLowerCase().indexOf(openTag)
      if (openIndex === -1) {
        const keepLength = findPartialTagLength(pending, openTag)
        output += pending.slice(0, pending.length - keepLength)
        pending = pending.slice(pending.length - keepLength)
        break
      }

      output += pending.slice(0, openIndex)
      pending = pending.slice(openIndex + openTag.length)
      insideThink = true
    }

    return output
  }

  const flush = (): string => {
    if (insideThink) {
      pending = ''
      return ''
    }

    const output = pending
    pending = ''
    return output
  }

  return { push, flush }
}

/** 解析单个 SSE 事件中的 data 字段 */
const extractSseData = (eventText: string): string => {
  return eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
}

/**
 * 消费 OpenAI 兼容接口的文本流。
 *
 * 正常 SSE 会逐片回调 delta；如果服务端忽略 stream 参数直接返回整段 JSON，
 * 则在流结束后只回调一次，保证现有兼容服务仍可正常翻译。
 */
export const consumeChatCompletionTextStream = async (
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void
): Promise<ChatCompletionStreamResult> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const thinkStripper = createThinkTagStripper()
  let buffer = ''
  let rawText = ''
  let text = ''
  let contentChunkCount = 0
  let streamErrorMessage = ''
  let streamDone = false

  /** 清洗增量、累计最终文本并通知调用方 */
  const emitContent = (content: string): void => {
    if (!content) return

    const cleaned = thinkStripper.push(content)
    if (!cleaned) return

    text += cleaned
    contentChunkCount += 1
    onDelta?.(cleaned)
  }

  /** 处理一个完整 SSE 事件 */
  const handleEvent = (eventText: string): void => {
    const payload = extractSseData(eventText)
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') streamDone = true
      return
    }

    let parsed: {
      choices?: Array<{
        delta?: {
          content?: MessageContent
          text?: string
        }
      }>
      error?: { message?: string } | string
    }

    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }

    const error = parsed.error
    if (typeof error === 'string') {
      streamErrorMessage = error
    } else if (error?.message) {
      streamErrorMessage = error.message
    }

    const delta = parsed.choices?.[0]?.delta
    const content = extractContent(delta?.content) || delta?.text || ''
    if (content) emitContent(content)
  }

  while (!streamDone) {
    const { done, value } = await reader.read()
    if (done) break

    const decoded = decoder.decode(value, { stream: true })
    buffer += decoded
    if (rawText.length < 2_000_000) rawText += decoded

    while (true) {
      const boundary = buffer.match(/\r?\n\r?\n/)
      if (!boundary || boundary.index === undefined) break

      const eventText = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length)
      handleEvent(eventText)
      if (streamDone) break
    }
  }

  // TextDecoder 的 stream 模式可能暂存末尾不完整的多字节字符，结束时必须显式冲刷
  const trailingText = decoder.decode()
  if (trailingText) {
    buffer += trailingText
    if (rawText.length < 2_000_000) rawText += trailingText
  }

  if (streamDone) {
    // 部分服务在 [DONE] 后仍保持连接，主动释放读取器，避免请求迟迟不结束
    await reader.cancel().catch(() => undefined)
  } else if (buffer.trim()) {
    handleEvent(buffer)
  }

  text += thinkStripper.flush()

  if (streamErrorMessage) {
    throw new ChatCompletionStreamError(streamErrorMessage)
  }

  // 服务端忽略 stream 参数时，回退到整段 JSON 中提取正文
  if (contentChunkCount === 0 && rawText.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new ChatCompletionStreamError('模型返回了无法解析的流式响应')
    }

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const error = (parsed as { error?: { message?: string } | string }).error
      const message = typeof error === 'string' ? error : error?.message || '模型流式响应返回错误'
      throw new ChatCompletionStreamError(message)
    }

    const wholeContent = extractChatCompletionText(parsed).trim()
    if (wholeContent) {
      const cleaned = thinkStripper.push(wholeContent)
      text += cleaned + thinkStripper.flush()
      contentChunkCount = 1
      if (cleaned) onDelta?.(cleaned)
    }
  }

  return {
    text: text.trim(),
    contentChunkCount
  }
}
