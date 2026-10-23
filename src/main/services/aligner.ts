import { net } from 'electron'
import {
  resolveAlignmentReasoningEffort,
  type AlignmentReasoningEffort
} from '../../shared/alignmentReasoning'
import { buildAlignmentSystemPrompt, buildAlignmentUserMessage } from '../../shared/alignmentPrompt'
import {
  parseAlignmentPairs,
  segmentText,
  type AlignTextRequest,
  type AlignTextResponse,
  type TextAlignment
} from '../../shared/textAlignment'
import { getLLMConfig } from './configManager'
import { resolveModelRoute, type ModelRoute } from './modelRoute'

class AlignmentServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AlignmentServiceError'
    this.code = code
  }
}

/** 兼容服务商返回的 token 用量信息 */
interface AlignmentUsage {
  /** 输入 token */
  prompt_tokens?: number
  /** 输出 token，包含推理 token */
  completion_tokens?: number
  /** 总 token */
  total_tokens?: number
  /** 输出 token 明细 */
  completion_tokens_details?: {
    /** 推理 token */
    reasoning_tokens?: number
  }
}

/** 对齐接口返回体 */
interface AlignmentResponseBody {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; content?: string }>
    }
    text?: string
  }>
  data?: {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string; content?: string }>
      }
      text?: string
    }>
    usage?: AlignmentUsage
  }
  usage?: AlignmentUsage
  error?:
    | {
        message?: string
      }
    | string
}

/** 单次对齐 HTTP 请求结果 */
interface AlignmentHttpResult {
  response: Awaited<ReturnType<typeof net.fetch>>
  data: AlignmentResponseBody
}

/** 学习模式二次对齐的执行选项 */
export interface AlignExecutionOptions {
  /** 输入变化、清空或发起新翻译时用于中止旧对齐请求 */
  signal?: AbortSignal
}

/** 判断对齐异常是否由主动取消触发 */
const isAlignmentAbortError = (error: unknown, signal?: AbortSignal): boolean => {
  return Boolean(signal?.aborted || (error as { name?: string })?.name === 'AbortError')
}

/** 在关键节点检查取消状态，避免旧请求继续重试或解析 */
const throwIfAlignmentAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new AlignmentServiceError('ABORTED', '文本对齐请求已取消')
  }
}

/** 从兼容 OpenAI 的响应中提取正文 */
const extractMessageText = (data: {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; content?: string }>
    }
    text?: string
  }>
  data?: {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string; content?: string }>
      }
      text?: string
    }>
  }
}): string => {
  const rawChoices = data.data?.choices ?? data.choices
  const firstChoice = rawChoices?.[0]
  const messageContent = firstChoice?.message?.content

  if (typeof messageContent === 'string') return messageContent.trim()
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => (typeof item === 'object' ? item.text || item.content || '' : String(item)))
      .join('')
      .trim()
  }
  if (typeof firstChoice?.text === 'string') return firstChoice.text.trim()
  return ''
}

/** 提取服务商返回的错误说明 */
const getAlignmentErrorMessage = (result: AlignmentHttpResult): string => {
  const error = result.data.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object' && error.message?.trim()) return error.message.trim()
  return `对齐请求失败：${result.response.status}`
}

/** 使用指定推理强度发送一次对齐请求 */
const sendAlignmentRequest = async (
  request: AlignTextRequest,
  route: ModelRoute,
  sourceSegments: TextAlignment['sourceSegments'],
  targetSegments: TextAlignment['targetSegments'],
  reasoningEffort?: AlignmentReasoningEffort,
  signal?: AbortSignal
): Promise<AlignmentHttpResult> => {
  const cleanBaseUrl = route.baseUrl
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
  const endpoint = `${cleanBaseUrl}/chat/completions`

  throwIfAlignmentAborted(signal)

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${route.apiKey.trim()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'screenshot-translator/1.0'
    },
    body: JSON.stringify({
      model: route.model,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      messages: [
        {
          role: 'system',
          content: buildAlignmentSystemPrompt()
        },
        {
          role: 'user',
          content: buildAlignmentUserMessage(request, sourceSegments, targetSegments)
        }
      ]
    }),
    signal
  })

  throwIfAlignmentAborted(signal)
  const rawResponseText = await response.text()
  let data: AlignmentResponseBody

  try {
    data = JSON.parse(rawResponseText)
  } catch {
    throw new AlignmentServiceError(
      `HTTP_${response.status}`,
      `对齐服务返回非 JSON 响应: ${rawResponseText.slice(0, 100)}`
    )
  }

  return {
    response,
    data
  }
}

/** 调用 OpenAI 兼容接口完成编号配对 */
const requestAlignment = async (
  request: AlignTextRequest,
  route: ModelRoute,
  sourceSegments: TextAlignment['sourceSegments'],
  targetSegments: TextAlignment['targetSegments'],
  signal?: AbortSignal
): Promise<TextAlignment> => {
  const preferredReasoningEffort = resolveAlignmentReasoningEffort(route.model)
  const reasoningAttempts: Array<AlignmentReasoningEffort | undefined> = preferredReasoningEffort
    ? [preferredReasoningEffort, undefined]
    : [undefined]
  let result: AlignmentHttpResult | null = null

  for (let index = 0; index < reasoningAttempts.length; index += 1) {
    throwIfAlignmentAborted(signal)
    const reasoningEffort = reasoningAttempts[index]
    result = await sendAlignmentRequest(
      request,
      route,
      sourceSegments,
      targetSegments,
      reasoningEffort,
      signal
    )

    throwIfAlignmentAborted(signal)
    if (result.response.ok) break

    const message = getAlignmentErrorMessage(result)
    const canRetryWithDefault = index < reasoningAttempts.length - 1
    if (canRetryWithDefault && result.response.status === 500 && /reasoning/i.test(message)) {
      console.warn('[main] 当前推理强度不被模型支持，将使用服务商默认值重试:', {
        model: route.model,
        reasoningEffort,
        message
      })
      continue
    }

    throw new AlignmentServiceError(`HTTP_${result.response.status}`, message)
  }

  if (!result) {
    throw new AlignmentServiceError('EMPTY_RESPONSE', '对齐服务没有返回可用内容')
  }

  if (!result.response.ok) {
    throw new AlignmentServiceError('HTTP_ERROR', '对齐请求失败')
  }

  const usage = result.data.data?.usage ?? result.data.usage
  if (usage) {
    console.log('[main] 文本对齐 token 用量:', {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0
    })
  }

  const rawAlignment = extractMessageText(result.data)
  if (!rawAlignment) {
    throw new AlignmentServiceError('EMPTY_RESPONSE', '对齐服务没有返回可用内容')
  }

  const alignment = parseAlignmentPairs(rawAlignment, sourceSegments, targetSegments, {
    sourceText: request.sourceText,
    targetText: request.targetText,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage
  })
  if (!alignment) {
    throw new AlignmentServiceError(
      'INVALID_ALIGNMENT',
      '对齐结果不完整、重复或顺序异常，已关闭悬停关联'
    )
  }

  return alignment
}

/** 模拟模式下按片段数量生成可预测的对齐结果 */
const buildMockAlignment = (
  sourceSegments: TextAlignment['sourceSegments'],
  targetSegments: TextAlignment['targetSegments']
): TextAlignment => {
  if (sourceSegments.length === targetSegments.length) {
    return {
      sourceSegments,
      targetSegments,
      pairs: sourceSegments.map((sourceSegment, index) => ({
        id: `p${index}`,
        sourceIds: [sourceSegment.id],
        targetIds: [targetSegments[index].id]
      })),
      highlights: []
    }
  }

  return {
    sourceSegments,
    targetSegments,
    pairs: [
      {
        id: 'p0',
        sourceIds: sourceSegments.map((segment) => segment.id),
        targetIds: targetSegments.map((segment) => segment.id)
      }
    ],
    highlights: []
  }
}

/**
 * 对已完成的译文做二次编号对齐。
 * 该函数不会生成或修改译文；任何失败都只返回错误，由渲染层关闭悬停关联。
 */
export const alignText = async (
  request: AlignTextRequest,
  execution?: AlignExecutionOptions
): Promise<AlignTextResponse> => {
  try {
    if (!request.sourceText.trim() || !request.targetText.trim()) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_ALIGNMENT_INPUT',
          message: '源文或译文为空，无法建立对应关系'
        }
      }
    }

    const sourceSegments = segmentText(request.sourceText, request.sourceLanguage, 's')
    const targetSegments = segmentText(request.targetText, request.targetLanguage, 't')

    if (sourceSegments.length === 0 || targetSegments.length === 0) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_ALIGNMENT_SEGMENT',
          message: '没有可用于对齐的文本片段'
        }
      }
    }

    const config = getLLMConfig()
    const route = resolveModelRoute(config, request.options)

    if (!route.apiKey) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_MISSING_API_KEY',
          message: `未配置服务商【${route.provider?.name || '当前服务商'}】的 API Key`
        }
      }
    }

    if (!route.baseUrl) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_MISSING_BASE_URL',
          message: `服务商【${route.provider?.name || '当前服务商'}】缺少 Base URL`
        }
      }
    }

    if (route.providerType === 'mock') {
      return {
        ok: true,
        alignment: buildMockAlignment(sourceSegments, targetSegments)
      }
    }

    if (route.providerType !== 'openai-compatible') {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: '当前服务商不支持文本对齐'
        }
      }
    }

    console.log('[main] 开始二次文本对齐:', {
      providerId: route.provider?.id,
      model: route.model,
      sourceSegments: sourceSegments.length,
      targetSegments: targetSegments.length
    })

    const alignment = await requestAlignment(
      request,
      route,
      sourceSegments,
      targetSegments,
      execution?.signal
    )

    console.log('[main] 文本对齐完成:', {
      pairs: alignment.pairs.length
    })

    return {
      ok: true,
      alignment
    }
  } catch (error) {
    if (isAlignmentAbortError(error, execution?.signal)) {
      return {
        ok: false,
        error: {
          code: 'ABORTED',
          message: '文本对齐请求已取消'
        }
      }
    }

    console.error('[main] 文本对齐失败:', error)

    if (error instanceof AlignmentServiceError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      }
    }

    return {
      ok: false,
      error: {
        code: 'ALIGNMENT_NETWORK_ERROR',
        message: error instanceof Error ? error.message : '文本对齐服务发生未知错误'
      }
    }
  }
}
