import { net } from 'electron'
import type { TranslateRequest, TranslateResponse } from '../../shared/translate'
import {
  ChatCompletionStreamError,
  consumeChatCompletionTextStream
} from '../../shared/chatCompletionStream'
import { getLLMConfig } from './configManager'
import type { AppSettings } from '../../shared/config'

class TranslateServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TranslateServiceError'
    this.code = code
  }
}

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 单次翻译执行时由 IPC 层注入的取消信号与增量回调 */
export interface TranslateExecutionOptions {
  /** 用户修改输入或发起新请求时用于中止网络请求 */
  signal?: AbortSignal
  /** 收到流式正文增量时回调渲染进程 */
  onDelta?: (delta: string) => void
}

/** 判断异常是否由主动取消触发 */
const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
  return Boolean(signal?.aborted || (error as { name?: string })?.name === 'AbortError')
}

/** 在关键节点主动检查取消状态，避免已经取消的请求继续处理响应 */
const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new TranslateServiceError('ABORTED', '翻译请求已取消')
  }
}

const mockTranslate = async (
  request: TranslateRequest,
  execution?: TranslateExecutionOptions
): Promise<TranslateResponse> => {
  const { text, targetLanguage, sourceLanguage, options } = request

  if (!text.trim()) {
    return { ok: false, error: { code: 'EMPTY_TEXT', message: '输入文本不能为空' } }
  }

  await sleep(400)
  throwIfAborted(execution?.signal)

  const response: TranslateResponse = {
    ok: true,
    text: `[模拟翻译] (${sourceLanguage} -> ${targetLanguage} | 模型: ${options?.model ?? 'default'}):\n${text}`
  }
  execution?.onDelta?.(response.text)
  return response
}

const translateWithOpenAICompatible = async (
  request: TranslateRequest,
  config: AppSettings,
  execution?: TranslateExecutionOptions
): Promise<TranslateResponse> => {
  if (!config.apiKey) {
    throw new TranslateServiceError('CONFIG_MISSING_API_KEY', '缺少 API Key，请在设置中配置')
  }
  if (!config.baseUrl) {
    throw new TranslateServiceError('CONFIG_MISSING_BASE_URL', '缺少 Base URL，请在设置中配置')
  }
  const apiKey = config.apiKey.trim()
  const cleanBaseUrl = config.baseUrl
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
  const endpoint = `${cleanBaseUrl}/chat/completions`
  const model = request.options?.model || config.model || 'gpt-4o-mini'

  const customPrompt = config.translation?.customSystemPrompt?.trim()
  let systemContent = ''

  if (customPrompt) {
    systemContent = customPrompt
  } else {
    systemContent = [
      'You are a translation engine.',
      'Translate the user text accurately.',
      'Preserve the original structure exactly:',
      '- keep the same line breaks and paragraph breaks',
      '- do not merge or split lines',
      '- keep URLs, list structure, headings, dates, and separators in their original positions',
      '- translate only the text content; do not rewrite, summarize, or reformat',
      'Direct translation only. Do not output any thinking process, reasoning, or <think> tags.',
      'Output only the translated text.'
    ].join('\n')
  }

  try {
    const buildRequestBody = (stream: boolean): Record<string, unknown> => {
      return {
        model,
        stream,
        messages: [
          {
            role: 'system',
            content: systemContent
          },
          {
            role: 'user',
            content: `Source language: ${request.sourceLanguage}\nTarget language: ${request.targetLanguage}\nText:${request.text}`
          }
        ]
      }
    }

    const sendRequest = (stream: boolean): ReturnType<typeof net.fetch> => {
      return net.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'screenshot-translator/1.0'
        },
        body: JSON.stringify(buildRequestBody(stream)),
        signal: execution?.signal
      })
    }

    console.log('[main] translateWithOpenAICompatible 发起流式请求 ->', endpoint, '模型:', model)
    throwIfAborted(execution?.signal)

    // 使用 Electron 的 net.fetch，自动继承 macOS 操作系统代理配置（支持 VPN、Clash 等网络环境）
    let response = await sendRequest(true)

    // 少数兼容服务不支持 stream 参数，明确返回参数错误时回退普通请求以保持兼容
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const streamErrorText = await response.text()
      console.warn('[main] 流式翻译被服务端拒绝，回退非流式请求:', {
        status: response.status,
        message: streamErrorText.slice(0, 150)
      })
      throwIfAborted(execution?.signal)
      response = await sendRequest(false)
    }

    console.log('[main] 模型响应状态码:', response.status)

    if (!response.ok) {
      const rawResponseText = await response.text()
      let errorMessage = `模型请求失败：${response.status} (${rawResponseText.slice(0, 150)})`

      try {
        const data = JSON.parse(rawResponseText) as {
          error?: { message?: string }
        }
        errorMessage = data.error?.message ?? errorMessage
      } catch {
        // 非 JSON 错误体直接使用截断后的原始文本
      }

      console.error('[main] 模型返回错误状态码:', response.status, errorMessage)
      throw new TranslateServiceError(`HTTP_${response.status}`, errorMessage)
    }

    if (!response.body) {
      throw new TranslateServiceError('EMPTY_RESPONSE', '模型响应不包含可读取的内容')
    }

    const streamedResult = await consumeChatCompletionTextStream(response.body, execution?.onDelta)

    throwIfAborted(execution?.signal)

    // 防御性再清理一次，兼容整段 JSON 兜底或服务端拼接出的异常标签
    const stripped = streamedResult.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    const text = stripped || streamedResult.text.trim()

    if (!text) {
      console.error('[main] 模型完成流式输出但未提取到有效内容')
      throw new TranslateServiceError('EMPTY_RESPONSE', '模型返回内容为空')
    }

    console.log('[main] 翻译提取成功，结果长度:', text.length)

    return {
      ok: true,
      text
    }
  } catch (error: unknown) {
    console.error('[main] translateWithOpenAICompatible 捕获到异常:', error)
    if (error instanceof TranslateServiceError) {
      throw error
    }
    if (isAbortError(error, execution?.signal)) {
      throw new TranslateServiceError('ABORTED', '翻译请求已取消')
    }
    if (error instanceof ChatCompletionStreamError) {
      throw new TranslateServiceError('STREAM_ERROR', error.message)
    }

    const cause = (error as { cause?: unknown })?.cause
    const causeText = cause ? ` (${String(cause)})` : ''
    throw new TranslateServiceError(
      'NETWORK_ERROR',
      error instanceof Error ? `${error.message}${causeText}` : '无法连接到模型服务'
    )
  }
}

export const translateText = async (
  request: TranslateRequest,
  execution?: TranslateExecutionOptions
): Promise<TranslateResponse> => {
  try {
    const config = getLLMConfig()
    const targetModel =
      request.options?.model || config.activeModelId || config.model || 'deepseek-chat'
    const targetProviderId = request.options?.providerId

    // 智能精确定位对应的独立服务商 Provider
    let targetProvider = config.providers?.find((p) => p.id === targetProviderId)

    if (!targetProvider && targetModel) {
      // 通过模型 ID 反向匹配其所属厂商
      targetProvider = config.providers?.find((p) => p.models?.some((m) => m.id === targetModel))
    }

    if (!targetProvider && targetModel) {
      if (targetModel.startsWith('cline-pass/') || targetModel.includes('cline')) {
        targetProvider = config.providers?.find((p) => p.id === 'cline')
      } else if (targetModel.includes('deepseek')) {
        targetProvider = config.providers?.find((p) => p.id === 'deepseek')
      }
    }

    // 兜底使用当前选中的厂商或第一个启用的厂商
    if (!targetProvider) {
      targetProvider =
        config.providers?.find((p) => p.id === config.activeProviderId) ||
        config.providers?.find((p) => p.enabled) ||
        config.providers?.[0]
    }

    const effectiveBaseUrl = (targetProvider?.baseUrl || config.baseUrl || '').trim()
    const effectiveApiKey = (targetProvider?.apiKey || config.apiKey || '').trim()
    const effectiveProviderType =
      targetProvider?.providerType || config.provider || 'openai-compatible'

    console.log('[main] translateText 厂商隔离路由分发:', {
      providerName: targetProvider?.name ?? '未知服务商',
      providerId: targetProvider?.id,
      targetModel,
      endpoint: effectiveBaseUrl,
      hasApiKey: Boolean(effectiveApiKey)
    })

    if (!effectiveApiKey) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_MISSING_API_KEY',
          message: `未配置服务商【${targetProvider?.name || '当前服务商'}】的 API Key，请在偏好设置中填写`
        }
      }
    }

    if (!effectiveBaseUrl) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_MISSING_BASE_URL',
          message: `服务商【${targetProvider?.name || '当前服务商'}】缺少 Base URL，请在偏好设置中填写`
        }
      }
    }

    const effectiveConfig: AppSettings = {
      ...config,
      provider: effectiveProviderType,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: targetModel
    }

    if (effectiveProviderType === 'mock') {
      return await mockTranslate(request, execution)
    }

    if (effectiveProviderType === 'openai-compatible') {
      return await translateWithOpenAICompatible(request, effectiveConfig, execution)
    }

    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: '不支持的翻译服务类型'
      }
    }
  } catch (error) {
    console.error('[main] translateText 顶层捕获到失败:', error)
    if (isAbortError(error, execution?.signal)) {
      return {
        ok: false,
        error: {
          code: 'ABORTED',
          message: '翻译请求已取消'
        }
      }
    }
    if (error instanceof TranslateServiceError) {
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
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : '翻译服务发生未知错误'
      }
    }
  }
}
