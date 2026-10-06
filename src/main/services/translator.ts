import { net } from 'electron'
import type { TranslateRequest, TranslateResponse } from '../../shared/translate'
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

const mockTranslate = async (request: TranslateRequest): Promise<TranslateResponse> => {
  const { text, targetLanguage, sourceLanguage, options } = request

  if (!text.trim()) {
    return { ok: false, error: { code: 'EMPTY_TEXT', message: '输入文本不能为空' } }
  }

  await sleep(400)

  return {
    ok: true,
    text: `[模拟翻译] (${sourceLanguage} -> ${targetLanguage} | 模型: ${options?.model ?? 'default'}):\n${text}`
  }
}

const translateWithOpenAICompatible = async (
  request: TranslateRequest,
  config: AppSettings
): Promise<TranslateResponse> => {
  if (!config.apiKey) {
    throw new TranslateServiceError('CONFIG_MISSING_API_KEY', '缺少 API Key，请在设置中配置')
  }
  if (!config.baseUrl) {
    throw new TranslateServiceError('CONFIG_MISSING_BASE_URL', '缺少 Base URL，请在设置中配置')
  }
  const cleanBaseUrl = config.baseUrl
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
  const endpoint = `${cleanBaseUrl}/chat/completions`
  const model = request.options?.model || config.model || 'gpt-4o-mini'
  const enableThinking =
    request.options?.enableThinking ??
    config.enableThinking ??
    config.translation?.defaultEnableThinking ??
    false

  const customPrompt = config.translation?.customSystemPrompt?.trim()
  let systemContent = ''

  if (customPrompt) {
    systemContent = customPrompt
  } else if (enableThinking) {
    systemContent = [
      'You are a translation engine with deep reasoning enabled.',
      'Translate the user text accurately.',
      'Preserve the original structure exactly:',
      '- keep the same line breaks and paragraph breaks',
      '- do not merge or split lines',
      '- keep URLs, list structure, headings, dates, and separators in their original positions',
      '- translate only the text content; do not rewrite, summarize, or reformat',
      'Output only the translated text.'
    ].join('\n')
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
    const requestBody: Record<string, unknown> = {
      model,
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

    // 仅当用户明确开启深度思考时传递 thinking 扩展参数，避免标准 OpenAI 兼容代理网关报 400 校验错误
    if (enableThinking) {
      requestBody.thinking = {
        type: 'enabled'
      }
    }

    console.log('[main] translateWithOpenAICompatible 发起请求 ->', endpoint, '模型:', model)

    // 使用 Electron 的 net.fetch，自动继承 macOS 操作系统代理配置（支持 VPN、Clash 等网络环境）
    const response = await net.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
        'User-Agent': 'screenshot-translator/1.0'
      },
      body: JSON.stringify(requestBody)
    })

    const rawResponseText = await response.text()
    console.log('[main] 模型响应状态码:', response.status)

    let data: {
      choices?: Array<{
        message?: {
          content?: string | Array<{ text?: string; content?: string }>
          reasoning_content?: string
        }
        text?: string
      }>
      error?: {
        message?: string
      }
    } = {}

    try {
      data = JSON.parse(rawResponseText)
    } catch {
      console.error('[main] 模型返回非 JSON 格式响应:', rawResponseText.slice(0, 150))
      throw new TranslateServiceError(
        `HTTP_${response.status}`,
        `模型响应非 JSON: ${rawResponseText.slice(0, 100)}`
      )
    }

    if (!response.ok) {
      const errorMsg =
        data.error?.message ?? `模型请求失败：${response.status} (${rawResponseText.slice(0, 150)})`
      console.error('[main] 模型返回错误状态码:', response.status, errorMsg)
      throw new TranslateServiceError(`HTTP_${response.status}`, errorMsg)
    }

    let text = ''
    // 兼容标准 OpenAI 格式 choices 以及 Cline API 等网关外层包裹的 data.choices 格式
    const rawChoices =
      (data as { data?: { choices?: typeof data.choices } }).data?.choices ?? data.choices
    const firstChoice = rawChoices?.[0]

    const messageContent = firstChoice?.message?.content
    if (typeof messageContent === 'string') {
      text = messageContent.trim()
    } else if (Array.isArray(messageContent)) {
      text = messageContent
        .map((item) => (typeof item === 'object' ? item.text || item.content || '' : String(item)))
        .join('')
        .trim()
    } else if (firstChoice?.message?.reasoning_content) {
      text = firstChoice.message.reasoning_content.trim()
    } else if (typeof firstChoice?.text === 'string') {
      text = firstChoice.text.trim()
    }

    if (!text) {
      console.error('[main] 模型返回成功但未提取到有效内容:', data)
      throw new TranslateServiceError('EMPTY_RESPONSE', '模型返回内容为空')
    }

    // 关闭思考模式时，若模型仍然返回了 <think> 标签内容，自动将其剥离保持译文纯净
    if (!enableThinking) {
      const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      // 若模型将所有内容均包裹在 think 标签内，剥离后为空时兜底使用原始内容，防止抛出空响应异常
      text = stripped || text
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

    const cause = (error as { cause?: unknown })?.cause
    const causeText = cause ? ` (${String(cause)})` : ''
    throw new TranslateServiceError(
      'NETWORK_ERROR',
      error instanceof Error ? `${error.message}${causeText}` : '无法连接到模型服务'
    )
  }
}

export const translateText = async (request: TranslateRequest): Promise<TranslateResponse> => {
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

    // 检查模型本身是否配置了默认思考开关
    const matchedModelObj = targetProvider?.models?.find((m) => m.id === targetModel)
    const effectiveThinking =
      request.options?.enableThinking ??
      matchedModelObj?.enableThinking ??
      config.enableThinking ??
      false

    console.log('[main] translateText 厂商隔离路由分发:', {
      providerName: targetProvider?.name ?? '未知服务商',
      providerId: targetProvider?.id,
      targetModel,
      endpoint: effectiveBaseUrl,
      hasApiKey: Boolean(effectiveApiKey),
      enableThinking: effectiveThinking
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
      model: targetModel,
      enableThinking: effectiveThinking
    }

    if (effectiveProviderType === 'mock') {
      return await mockTranslate(request)
    }

    if (effectiveProviderType === 'openai-compatible') {
      return await translateWithOpenAICompatible(request, effectiveConfig)
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
