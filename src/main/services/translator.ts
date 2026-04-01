import type { TranslateRequest, TranslateResponse } from '../../shared/translate'
type TranslateProvider = 'mock' | 'openai-compatible'

interface ProviderConfig {
  provider: TranslateProvider
  apiKey: string
  baseUrl: string
  defaultModel: string
}

const getProviderConfig = (): ProviderConfig => {
  const provider = (process.env.TRANSLATE_PROVIDER ?? 'mock') as TranslateProvider

  return {
    provider,
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? '',
    defaultModel: process.env.LLM_MODEL ?? 'gpt-4o-mini'
  }
}

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const mockTranslate = async (request: TranslateRequest): Promise<TranslateResponse> => {
  const { text, targetLanguage, sourceLanguage, options } = request

  if (!text.trim()) return { text: '' }

  await sleep(800)

  const shouldFail = Math.random() < 0.3
  if (shouldFail) {
    throw new Error('翻译失败')
  }

  return {
    text: `模拟翻译(${sourceLanguage} -> ${targetLanguage}/${options?.model ?? 'default'}):${text}`
  }
}

const translateWithOpenAICompatible = async (
  request: TranslateRequest,
  config: ProviderConfig
): Promise<TranslateResponse> => {
  if (!config.apiKey) {
    throw new Error('请配置大模型对应的 key')
  }
  if (!config.baseUrl) {
    throw new Error('请配置大模型对应的 url')
  }
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const model = request.options?.model || config.defaultModel
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
          role: 'developer',
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
    throw new Error(data.error?.message ?? `模型请求失败：${response.status}`)
  }

  const text = data.choices?.[0]?.message?.content?.trim()

  if (!text) {
    throw new Error('模型返回内容为空')
  }

  return { text }
}

export const translateText = async (request: TranslateRequest): Promise<TranslateResponse> => {
  const config = getProviderConfig()
  if (config.provider === 'mock') {
    return await mockTranslate(request)
  }
  if (config.provider === 'openai-compatible') {
    return await translateWithOpenAICompatible(request, config)
  }

  throw new Error('不支持的翻译 provider')
}
