import type { TranslateRequest, TranslateResponse } from '../../shared/translate'
type TranslateProvider = 'mock' | 'openai-compatible'

interface ProviderConfig {
  provider: TranslateProvider
  apiKey: string
  baseUrl: string
  defaultModel: string
}

class TranslateServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TranslateServiceError'
    this.code = code
  }
}

const getProviderConfig = (): ProviderConfig => {
  const provider = (process.env.TRANSLATE_PROVIDER ?? 'mock') as TranslateProvider
  const config = {
    provider,
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? '',
    defaultModel: process.env.LLM_MODEL ?? 'gpt-4o-mini'
  }

  console.log('[main] provider config', {
    provider: config.provider,
    hasApiKey: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel
  })

  return config
}

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const mockTranslate = async (request: TranslateRequest): Promise<TranslateResponse> => {
  const { text, targetLanguage, sourceLanguage, options } = request

  // if (!text.trim()) return { text: '' }
  if (!text.trim()) return { ok: false, error: { code: 'EMPTY_TEXT', message: '输入文本不能为空' } }

  await sleep(800)

  // const shouldFail = Math.random() < 0.3
  // if (shouldFail) {
  //   throw new Error('翻译失败')
  // }

  return {
    ok: true,
    text: `模拟翻译(${sourceLanguage} -> ${targetLanguage}/${options?.model ?? 'default'}):${text}`
  }
}

const translateWithOpenAICompatible = async (
  request: TranslateRequest,
  config: ProviderConfig
): Promise<TranslateResponse> => {
  if (!config.apiKey) {
    throw new TranslateServiceError('CONFIG_MISSING_API_KEY', '缺少 LLM_API_KEY')
  }
  if (!config.baseUrl) {
    throw new TranslateServiceError('CONFIG_MISSING_BASE_URL', '缺少 LLM_BASE_URL')
  }
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const model = request.options?.model || config.defaultModel
  // console.log('[main] request endpoint', endpoint)
  // console.log('[main] request model', model)
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
            content:
              'You are a translation engine. Translate the user text accurately. Output only the translated text.'
          },
          {
            role: 'user',
            content: `Source language: ${request.sourceLanguage}
                    Target language: ${request.targetLanguage}
                    Text:${request.text}`
          }
        ]
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

    const text = data.choices?.[0]?.message?.content?.trim()

    if (!text) {
      throw new TranslateServiceError('EMPTY_RESPONSE', '模型返回内容为空')
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
    // console.log('[main] translateText called')
    console.log('[main] provider =', process.env.TRANSLATE_PROVIDER)

    const config = getProviderConfig()

    if (config.provider === 'mock') {
      // console.log('[main] using mock provider')
      return await mockTranslate(request)
    }

    if (config.provider === 'openai-compatible') {
      // console.log('[main] using openai-compatible provider')
      return await translateWithOpenAICompatible(request, config)
    }

    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: '不支持的翻译 provider'
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
