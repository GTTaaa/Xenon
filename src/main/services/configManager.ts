import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { LLMConfig, ModelOptionItem, TestConnectionResult } from '../../shared/config'

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
    modelOptions: DEFAULT_MODEL_OPTIONS
  }
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
        modelOptions:
          Array.isArray(parsed.modelOptions) && parsed.modelOptions.length > 0
            ? parsed.modelOptions
            : DEFAULT_MODEL_OPTIONS
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
      baseUrl: (newConfig.baseUrl ?? '').trim(),
      apiKey: (newConfig.apiKey ?? '').trim(),
      model: (newConfig.model ?? '').trim() || 'step-3.5-flash',
      modelOptions:
        Array.isArray(newConfig.modelOptions) && newConfig.modelOptions.length > 0
          ? newConfig.modelOptions
          : DEFAULT_MODEL_OPTIONS
    }

    writeFileSync(filePath, JSON.stringify(sanitizedConfig, null, 2), 'utf-8')
    cachedConfig = sanitizedConfig

    console.log('[main] 大模型配置保存成功', {
      provider: sanitizedConfig.provider,
      baseUrl: sanitizedConfig.baseUrl,
      hasApiKey: Boolean(sanitizedConfig.apiKey),
      model: sanitizedConfig.model
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

  const endpoint = `${config.baseUrl.trim().replace(/\/$/, '')}/chat/completions`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model.trim() || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (response.ok) {
      return {
        ok: true,
        message: '连接成功，服务响应正常',
        latencyMs
      }
    }

    let errorDetail = ''
    try {
      const errorJson = (await response.json()) as { error?: { message?: string } }
      errorDetail = errorJson.error?.message ?? ''
    } catch {
      // 忽略响应文本解析错误
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

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        message: '连接超时（10秒内未收到响应）'
      }
    }

    return {
      ok: false,
      message: error instanceof Error ? `连接异常: ${error.message}` : '无法连接到模型服务'
    }
  }
}
