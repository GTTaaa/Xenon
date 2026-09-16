import type { TranslateRequest, TranslateResponse } from '../../shared/translate'
import { getLLMConfig } from './configManager'
import type { LLMConfig } from '../../shared/config'

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
  config: LLMConfig
): Promise<TranslateResponse> => {
  if (!config.apiKey) {
    throw new TranslateServiceError('CONFIG_MISSING_API_KEY', '缺少 API Key，请在设置中配置')
  }
  if (!config.baseUrl) {
    throw new TranslateServiceError('CONFIG_MISSING_BASE_URL', '缺少 Base URL，请在设置中配置')
  }
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const model = request.options?.model || config.model || 'gpt-4o-mini'
  const enableThinking = request.options?.enableThinking ?? config.enableThinking ?? false

  const systemContent = enableThinking
    ? [
        'You are a translation engine with deep reasoning enabled.',
        'Translate the user text accurately.',
        'Preserve the original structure exactly:',
        '- keep the same line breaks and paragraph breaks',
        '- do not merge or split lines',
        '- keep URLs, list structure, headings, dates, and separators in their original positions',
        '- translate only the text content; do not rewrite, summarize, or reformat',
        'Output only the translated text.'
      ].join('\n')
    : [
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

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
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
        ],
        // DeepSeek 官方标准思考开关参数：{"thinking": {"type": "enabled/disabled"}}
        thinking: {
          type: enableThinking ? 'enabled' : 'disabled'
        }
      })
    })
    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string
        }
      }>
      error?: {
        message?: string
      }
    }

    if (!response.ok) {
      throw new TranslateServiceError(
        `HTTP_${response.status}`,
        data.error?.message ?? `模型请求失败：${response.status}`
      )
    }

    let text = data.choices?.[0]?.message?.content?.trim()

    if (!text) {
      throw new TranslateServiceError('EMPTY_RESPONSE', '模型返回内容为空')
    }

    // 关闭思考模式时，若模型仍然返回了 <think> 标签内容，自动将其剥离保持译文纯净
    if (!enableThinking) {
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    }

    return {
      ok: true,
      text
    }
  } catch (error: unknown) {
    if (error instanceof TranslateServiceError) {
      throw error
    }

    throw new TranslateServiceError('NETWORK_ERROR', '无法连接到模型服务')
  }
}

export const translateText = async (request: TranslateRequest): Promise<TranslateResponse> => {
  try {
    const config = getLLMConfig()

    console.log(
      '[main] translateText 执行，当前模式 =',
      config.provider,
      '模型 =',
      request.options?.model || config.model,
      '思考开关 =',
      (request.options?.enableThinking ?? config.enableThinking ?? false) ? '开启' : '关闭'
    )

    if (config.provider === 'mock') {
      return await mockTranslate(request)
    }

    if (config.provider === 'openai-compatible') {
      return await translateWithOpenAICompatible(request, config)
    }

    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: '不支持的翻译服务类型'
      }
    }
  } catch (error) {
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
        message: '翻译服务发生未知错误'
      }
    }
  }
}
