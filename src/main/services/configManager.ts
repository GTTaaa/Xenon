import { app, net } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { LLMConfig, ModelOptionItem, TestConnectionResult } from '../../shared/config'

/**
 * 规整 Base URL，自动去除末尾的 /chat/completions 与多余斜杠
 */
const normalizeBaseUrl = (url: string): string => {
  return url.trim().replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '')
}

/**
 * 默认预设模型列表
 */
const DEFAULT_MODEL_OPTIONS: ModelOptionItem[] = [
  {
    value: 'step-3.5-flash',
    code: 'A1',
    profile: 'FAST RESPONSE'
  },
  {
    value: 'gpt-4o-mini',
    code: 'B2',
    profile: 'BALANCED MODE'
  },
  {
    value: 'claude-3.5-haiku',
    code: 'C3',
    profile: 'LOW COST'
  }
]

/**
 * 内存中缓存的当前配置
 */
let cachedConfig: LLMConfig | null = null

/**
 * 获取配置文件存储路径
 */
const getConfigFilePath = (): string => {
  return join(app.getPath('userData'), 'llm-config.json')
}

/**
 * 从环境变量读取初值作为兜底配置
 */
const getDefaultConfigFromEnv = (): LLMConfig => {
  const envProvider = process.env.TRANSLATE_PROVIDER
  const provider =
    envProvider === 'openai-compatible' || envProvider === 'mock' ? envProvider : 'mock'
  const apiKey = process.env.LLM_API_KEY ?? ''
  const baseUrl = process.env.LLM_BASE_URL ?? ''
  const model = process.env.LLM_MODEL ?? 'step-3.5-flash'

  return {
    provider,
    apiKey,
    baseUrl,
    model,
    enableThinking: false,
    modelOptions: DEFAULT_MODEL_OPTIONS
  }
}

/**
 * 清洗并规整模型通道列表数据
 */
const sanitizeModelOptions = (rawList: unknown): ModelOptionItem[] => {
  if (!Array.isArray(rawList) || rawList.length === 0) return DEFAULT_MODEL_OPTIONS
  const sanitized = rawList
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null
      const value = typeof item.value === 'string' ? item.value.trim() : ''
      if (!value) return null
      const code = typeof item.code === 'string' && item.code ? item.code.trim() : `U${idx + 1}`
      const profile = typeof item.profile === 'string' && item.profile ? item.profile.trim() : 'CUSTOM'
      const baseUrl =
        typeof item.baseUrl === 'string' && item.baseUrl.trim()
          ? normalizeBaseUrl(item.baseUrl)
          : undefined
      const apiKey = typeof item.apiKey === 'string' && item.apiKey.trim() ? item.apiKey.trim() : undefined
      const provider =
        item.provider === 'openai-compatible' || item.provider === 'mock' ? item.provider : undefined
      const enableThinking = typeof item.enableThinking === 'boolean' ? item.enableThinking : undefined

      const option: ModelOptionItem = {
        value,
        code,
        profile,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(provider ? { provider } : {}),
        ...(typeof enableThinking === 'boolean' ? { enableThinking } : {})
      }
      return option
    })
    .filter((item): item is ModelOptionItem => item !== null)

  return sanitized.length > 0 ? sanitized : DEFAULT_MODEL_OPTIONS
}

/**
 * 读取当前大模型配置
 * 优先读取本地持久化文件，不存在时使用环境变量初值
 */
export const getLLMConfig = (): LLMConfig => {
  if (cachedConfig) {
    return cachedConfig
  }

  const filePath = getConfigFilePath()

  try {
    if (existsSync(filePath)) {
      const rawContent = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(rawContent) as Partial<LLMConfig>

      cachedConfig = {
        provider: parsed.provider === 'openai-compatible' ? 'openai-compatible' : 'mock',
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        model: typeof parsed.model === 'string' && parsed.model ? parsed.model : 'step-3.5-flash',
        enableThinking: Boolean(parsed.enableThinking),
        modelOptions: sanitizeModelOptions(parsed.modelOptions)
      }
      return cachedConfig
    }
  } catch (error) {
    console.error('[main] 读取本地配置文件失败，回退到默认环境变量配置', error)
  }

  cachedConfig = getDefaultConfigFromEnv()
  return cachedConfig
}

/**
 * 保存大模型配置至本地持久化文件
 */
export const saveLLMConfig = async (
  newConfig: LLMConfig
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const filePath = getConfigFilePath()
    const sanitizedConfig: LLMConfig = {
      provider: newConfig.provider === 'openai-compatible' ? 'openai-compatible' : 'mock',
      baseUrl: normalizeBaseUrl(newConfig.baseUrl ?? ''),
      apiKey: (newConfig.apiKey ?? '').trim(),
      model: (newConfig.model ?? '').trim() || 'step-3.5-flash',
      enableThinking: Boolean(newConfig.enableThinking),
      modelOptions: sanitizeModelOptions(newConfig.modelOptions)
    }

    writeFileSync(filePath, JSON.stringify(sanitizedConfig, null, 2), 'utf-8')
    cachedConfig = sanitizedConfig

    console.log('[main] 大模型配置保存成功', {
      provider: sanitizedConfig.provider,
      baseUrl: sanitizedConfig.baseUrl,
      hasApiKey: Boolean(sanitizedConfig.apiKey),
      model: sanitizedConfig.model,
      enableThinking: sanitizedConfig.enableThinking,
      modelCount: sanitizedConfig.modelOptions.length
    })

    return { ok: true }
  } catch (error) {
    console.error('[main] 保存大模型配置失败', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : '保存配置失败'
    }
  }
}

/**
 * 测试大模型配置连通性
 */
export const testLLMConnection = async (config: LLMConfig): Promise<TestConnectionResult> => {
  const startTime = Date.now()

  // 模拟模式直接返回成功
  if (config.provider === 'mock') {
    return {
      ok: true,
      message: '模拟模式就绪',
      latencyMs: 12
    }
  }

  // 校验参数完整性
  if (!config.baseUrl?.trim()) {
    return {
      ok: false,
      message: '缺少服务地址 (Base URL)'
    }
  }

  if (!config.apiKey?.trim()) {
    return {
      ok: false,
      message: '缺少密钥 (API Key)'
    }
  }

  const endpoint = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  const targetModel = config.model.trim() || 'gpt-4o-mini'
  console.log('[main] testLLMConnection 发起测试:', {
    endpoint,
    model: targetModel,
    hasApiKey: Boolean(config.apiKey)
  })

  try {
    // 使用 Electron 的 net.fetch，自动继承系统代理设置；请求体与 Postman 保持纯净一致（不传 max_tokens）
    const response = await net.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
        'User-Agent': 'screenshot-translator/1.0'
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'Hello' }]
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (response.ok) {
      console.log('[main] testLLMConnection 测试成功，耗时:', latencyMs, 'ms')
      return {
        ok: true,
        message: '连接成功，服务响应正常',
        latencyMs
      }
    }

    const rawResponseText = await response.text()
    console.error('[main] testLLMConnection 请求失败，状态码:', response.status, '返回内容:', rawResponseText)

    let errorDetail = ''
    try {
      const errorJson = JSON.parse(rawResponseText) as {
        error?: { message?: string }
        message?: string
        detail?: string
      }
      errorDetail =
        errorJson.error?.message ??
        errorJson.message ??
        errorJson.detail ??
        ''
    } catch {
      errorDetail = rawResponseText.slice(0, 150)
    }

    if (response.status === 401) {
      return {
        ok: false,
        message: '鉴权失败 (401)：API Key 无效或未授权'
      }
    }

    if (response.status === 404) {
      return {
        ok: false,
        message: '端点不存在 (404)：请检查 Base URL 是否正确'
      }
    }

    if (response.status === 429) {
      return {
        ok: false,
        message: '速率超限或配额用尽 (429)'
      }
    }

    return {
      ok: false,
      message: `请求失败 (${response.status})${errorDetail ? `: ${errorDetail}` : ''}`
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.error('[main] testLLMConnection 捕获底层网络异常:', error)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        message: '连接超时（10秒内未收到响应，请检查网络或代理）'
      }
    }

    const cause = (error as { cause?: unknown })?.cause
    const causeText = cause ? ` [原因: ${String(cause)}]` : ''

    return {
      ok: false,
      message: error instanceof Error ? `连接异常: ${error.message}${causeText}` : '无法连接到模型服务'
    }
  }
}
