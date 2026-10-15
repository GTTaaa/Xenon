import { app, net } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  AppSettings,
  FetchModelsResult,
  GeneralSettings,
  LLMConfig,
  ProviderItem,
  ProviderModelItem,
  ShortcutSettings,
  TestConnectionResult,
  TranslationSettings
} from '../../shared/config'
import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_SHORTCUTS,
  DEFAULT_TRANSLATION_SETTINGS
} from '../../shared/config'
import {
  SPEED_TEST_PROMPT,
  calculateTokensPerSecond,
  consumeChatCompletionStream
} from '../../shared/streamSpeed'

/**
 * 规整 Base URL，自动去除末尾的 /chat/completions 与多余斜杠
 */
export const normalizeBaseUrl = (url: string): string => {
  return url
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
}

/**
 * 默认内置的预设厂商列表
 */
export const DEFAULT_PROVIDERS: ProviderItem[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3 对话模型' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1 深度推理' }
    ],
    defaultModel: 'deepseek-chat'
  },
  {
    id: 'cline',
    name: 'ClinePass',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.cline.bot/api/v1',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'cline-pass/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
      { id: 'cline-pass/qwen3.7-max', label: 'Qwen 3.7 Max' },
      { id: 'cline-pass/muse-spark-1.3-contributor', label: 'Muse Spark 1.3' }
    ],
    defaultModel: 'cline-pass/deepseek-v4.1-flash'
  },
  {
    id: 'qwen',
    name: '通义千问',
    providerType: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    enabled: false,
    models: [
      { id: 'qwen-plus', label: 'Qwen Plus 平衡版' },
      { id: 'qwen-max', label: 'Qwen Max 旗舰版' }
    ],
    defaultModel: 'qwen-plus'
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    enabled: false,
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini 极速' },
      { id: 'gpt-4o', label: 'GPT-4o 旗舰' }
    ],
    defaultModel: 'gpt-4o-mini'
  }
]

/**
 * 内存中缓存的当前配置
 */
let cachedConfig: AppSettings | null = null

/**
 * 获取配置文件存储路径
 */
const getConfigFilePath = (): string => {
  return join(app.getPath('userData'), 'llm-config.json')
}

/**
 * 清洗规整快捷键配置
 */
export const sanitizeShortcuts = (raw?: Partial<ShortcutSettings>): ShortcutSettings => {
  return {
    screenshot:
      typeof raw?.screenshot === 'string' && raw.screenshot.trim()
        ? raw.screenshot.trim()
        : DEFAULT_SHORTCUTS.screenshot,
    inputTranslate:
      typeof raw?.inputTranslate === 'string' && raw.inputTranslate.trim()
        ? raw.inputTranslate.trim()
        : DEFAULT_SHORTCUTS.inputTranslate,
    openPreferences:
      typeof raw?.openPreferences === 'string' && raw.openPreferences.trim()
        ? raw.openPreferences.trim()
        : DEFAULT_SHORTCUTS.openPreferences
  }
}

/**
 * 清洗规整翻译偏好设置
 */
export const sanitizeTranslationSettings = (
  raw?: Partial<TranslationSettings>
): TranslationSettings => {
  return {
    defaultTargetLanguage:
      typeof raw?.defaultTargetLanguage === 'string' && raw.defaultTargetLanguage.trim()
        ? raw.defaultTargetLanguage.trim()
        : DEFAULT_TRANSLATION_SETTINGS.defaultTargetLanguage,
    autoCopyResult:
      typeof raw?.autoCopyResult === 'boolean'
        ? raw.autoCopyResult
        : DEFAULT_TRANSLATION_SETTINGS.autoCopyResult,
    customSystemPrompt: typeof raw?.customSystemPrompt === 'string' ? raw.customSystemPrompt : ''
  }
}

/**
 * 清洗规整通用系统偏好
 */
export const sanitizeGeneralSettings = (raw?: Partial<GeneralSettings>): GeneralSettings => {
  return {
    launchAtLogin:
      typeof raw?.launchAtLogin === 'boolean'
        ? raw.launchAtLogin
        : DEFAULT_GENERAL_SETTINGS.launchAtLogin,
    alwaysOnTop:
      typeof raw?.alwaysOnTop === 'boolean'
        ? raw.alwaysOnTop
        : DEFAULT_GENERAL_SETTINGS.alwaysOnTop,
    closeAction: raw?.closeAction === 'quit' ? 'quit' : 'tray'
  }
}

/**
 * 清洗并规整厂商列表数据，并对老版本配置进行平滑无损迁移
 */
const sanitizeProviders = (
  rawProviders: unknown,
  legacyConfig?: Partial<LLMConfig>
): ProviderItem[] => {
  let list: ProviderItem[] = []

  if (Array.isArray(rawProviders) && rawProviders.length > 0) {
    list = rawProviders
      .map((item): ProviderItem | null => {
        if (!item || typeof item !== 'object') return null
        const id =
          typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `p_${Date.now()}`
        const name =
          typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名服务商'
        const baseUrl = typeof item.baseUrl === 'string' ? normalizeBaseUrl(item.baseUrl) : ''
        const apiKey = typeof item.apiKey === 'string' ? item.apiKey.trim() : ''
        const enabled = typeof item.enabled === 'boolean' ? item.enabled : true
        const defaultModel =
          typeof item.defaultModel === 'string' ? item.defaultModel.trim() : undefined
        const models: ProviderModelItem[] = Array.isArray(item.models)
          ? item.models
              .map((m: unknown) => {
                if (typeof m === 'string' && m.trim()) return { id: m.trim() }
                if (m && typeof m === 'object' && typeof (m as { id?: string }).id === 'string') {
                  const obj = m as { id: string; label?: string }
                  return {
                    id: obj.id.trim(),
                    label: typeof obj.label === 'string' ? obj.label.trim() : undefined
                  }
                }
                return null
              })
              .filter((m): m is ProviderModelItem => m !== null)
          : []

        return {
          id,
          name,
          providerType: 'openai-compatible',
          baseUrl,
          apiKey,
          enabled,
          models,
          defaultModel
        }
      })
      .filter((item): item is ProviderItem => item !== null)
  }

  // 若无有效配置，使用默认厂商模板
  if (list.length === 0) {
    list = JSON.parse(JSON.stringify(DEFAULT_PROVIDERS))
  }

  // 确保内置的 DeepSeek 和 Cline 至少存在于列表中
  for (const preset of DEFAULT_PROVIDERS) {
    if (!list.some((p) => p.id === preset.id)) {
      list.push(JSON.parse(JSON.stringify(preset)))
    }
  }

  // 若存在老配置，提取老密钥自动归位至相应厂商
  if (legacyConfig) {
    const legacyUrl = (legacyConfig.baseUrl || '').toLowerCase()
    const legacyKey = (legacyConfig.apiKey || '').trim()

    if (legacyKey) {
      if (legacyUrl.includes('cline.bot')) {
        const clineP = list.find((p) => p.id === 'cline')
        if (clineP && !clineP.apiKey) clineP.apiKey = legacyKey
      } else if (legacyUrl.includes('deepseek.com')) {
        const dsP = list.find((p) => p.id === 'deepseek')
        if (dsP && !dsP.apiKey) dsP.apiKey = legacyKey
      }
    }

    if (Array.isArray(legacyConfig.modelOptions)) {
      for (const opt of legacyConfig.modelOptions) {
        if (!opt || !opt.apiKey) continue
        const optUrl = (opt.baseUrl || '').toLowerCase()
        if (optUrl.includes('cline.bot')) {
          const clineP = list.find((p) => p.id === 'cline')
          if (clineP && !clineP.apiKey) clineP.apiKey = opt.apiKey.trim()
        } else if (optUrl.includes('deepseek.com')) {
          const dsP = list.find((p) => p.id === 'deepseek')
          if (dsP && !dsP.apiKey) dsP.apiKey = opt.apiKey.trim()
        }
      }
    }
  }

  return list
}

/**
 * 读取当前完整应用偏好设置（包含大模型配置、快捷键、翻译行为与通用设置）
 */
export const getLLMConfig = (): AppSettings => {
  if (cachedConfig) {
    return cachedConfig
  }

  const filePath = getConfigFilePath()

  try {
    if (existsSync(filePath)) {
      const rawContent = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(rawContent) as Partial<AppSettings>

      const providers = sanitizeProviders(parsed.providers, parsed)
      const firstEnabled = providers.find((p) => p.enabled) || providers[0]

      const activeProviderId =
        typeof parsed.activeProviderId === 'string' &&
        providers.some((p) => p.id === parsed.activeProviderId)
          ? parsed.activeProviderId
          : firstEnabled.id

      const currentProvider = providers.find((p) => p.id === activeProviderId) || firstEnabled
      const activeModelId =
        typeof parsed.activeModelId === 'string' && parsed.activeModelId
          ? parsed.activeModelId
          : currentProvider.defaultModel || currentProvider.models[0]?.id || 'deepseek-chat'

      cachedConfig = {
        activeProviderId,
        activeModelId,
        providers,
        shortcuts: sanitizeShortcuts(parsed.shortcuts),
        translation: sanitizeTranslationSettings(parsed.translation),
        general: sanitizeGeneralSettings(parsed.general),
        // 兼容字段
        provider: 'openai-compatible',
        baseUrl: currentProvider.baseUrl,
        apiKey: currentProvider.apiKey,
        model: activeModelId
      }
      return cachedConfig
    }
  } catch (error) {
    console.error('[main] 读取本地配置文件失败，使用默认配置', error)
  }

  const defaultProviders = JSON.parse(JSON.stringify(DEFAULT_PROVIDERS)) as ProviderItem[]
  cachedConfig = {
    activeProviderId: 'deepseek',
    activeModelId: 'deepseek-chat',
    providers: defaultProviders,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    translation: { ...DEFAULT_TRANSLATION_SETTINGS },
    general: { ...DEFAULT_GENERAL_SETTINGS },
    provider: 'openai-compatible',
    baseUrl: defaultProviders[0].baseUrl,
    apiKey: '',
    model: 'deepseek-chat'
  }
  return cachedConfig
}

/**
 * 保存应用偏好设置至本地持久化文件
 */
export const saveLLMConfig = async (
  newConfig: AppSettings
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const filePath = getConfigFilePath()
    const sanitizedProviders = sanitizeProviders(newConfig.providers)
    const activeProviderId =
      newConfig.activeProviderId || sanitizedProviders.find((p) => p.enabled)?.id || 'deepseek'
    const activeProvider =
      sanitizedProviders.find((p) => p.id === activeProviderId) || sanitizedProviders[0]

    const activeModelId =
      newConfig.activeModelId ||
      activeProvider.defaultModel ||
      activeProvider.models[0]?.id ||
      'deepseek-chat'

    const sanitizedConfig: AppSettings = {
      activeProviderId,
      activeModelId,
      providers: sanitizedProviders,
      shortcuts: sanitizeShortcuts(newConfig.shortcuts),
      translation: sanitizeTranslationSettings(newConfig.translation),
      general: sanitizeGeneralSettings(newConfig.general),
      // 兼容字段
      provider: 'openai-compatible',
      baseUrl: activeProvider.baseUrl,
      apiKey: activeProvider.apiKey,
      model: activeModelId
    }

    writeFileSync(filePath, JSON.stringify(sanitizedConfig, null, 2), 'utf-8')
    cachedConfig = sanitizedConfig

    console.log('[main] 系统偏好配置保存成功', {
      activeProviderId: sanitizedConfig.activeProviderId,
      activeModelId: sanitizedConfig.activeModelId,
      providerCount: sanitizedConfig.providers.length,
      shortcuts: sanitizedConfig.shortcuts,
      alwaysOnTop: sanitizedConfig.general?.alwaysOnTop
    })

    return { ok: true }
  } catch (error) {
    console.error('[main] 保存系统偏好配置失败', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : '保存配置失败'
    }
  }
}

/**
 * 连通性测试允许的最长等待时间（毫秒），流式测速比单纯握手更耗时，因此放宽到 20 秒
 */
const CONNECTION_TEST_TIMEOUT_MS = 20000

/**
 * 测试大模型配置连通性（支持传入单个 ProviderItem 或完整 LLMConfig）
 */
export const testLLMConnection = async (
  target: LLMConfig | ProviderItem
): Promise<TestConnectionResult> => {
  const startTime = Date.now()

  // 提取待测试的 baseUrl, apiKey 与 model
  let baseUrl = ''
  let apiKey = ''
  let model = ''

  if (
    'baseUrl' in target &&
    'apiKey' in target &&
    typeof target.baseUrl === 'string' &&
    typeof target.apiKey === 'string'
  ) {
    baseUrl = normalizeBaseUrl(target.baseUrl)
    apiKey = target.apiKey.trim()
    if ('models' in target && Array.isArray(target.models) && target.models.length > 0) {
      model = target.defaultModel || target.models[0].id
    } else if ('model' in target && typeof target.model === 'string') {
      model = target.model.trim()
    }
  } else if ('providers' in target && Array.isArray(target.providers)) {
    const activeP =
      target.providers.find((p) => p.id === target.activeProviderId) || target.providers[0]
    if (activeP) {
      baseUrl = normalizeBaseUrl(activeP.baseUrl)
      apiKey = activeP.apiKey.trim()
      model = target.activeModelId || activeP.defaultModel || activeP.models[0]?.id || 'gpt-4o-mini'
    }
  }

  // 校验参数完整性
  if (!baseUrl) {
    return {
      ok: false,
      message: '缺少服务地址 (Base URL)'
    }
  }

  if (!apiKey) {
    return {
      ok: false,
      message: '缺少访问密钥 (API Key)'
    }
  }

  const endpoint = `${baseUrl}/chat/completions`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS)

  const testModel = model || 'gpt-4o-mini'
  console.log('[main] testLLMConnection 独立测试厂商:', {
    endpoint,
    testModel,
    hasApiKey: Boolean(apiKey)
  })

  try {
    // 统一走流式请求：既能验证连通性，又能顺便统计首 token 延迟与每秒输出 token 数
    let response = await net.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'screenshot-translator/1.0'
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: SPEED_TEST_PROMPT }],
        stream: true
      }),
      signal: controller.signal
    })

    // 部分兼容服务不支持 stream 参数，遇到 400/422 时退化为普通请求再确认一次连通性
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const fallbackResponse = await net.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'screenshot-translator/1.0'
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'Hello' }]
        }),
        signal: controller.signal
      })

      if (fallbackResponse.ok) {
        clearTimeout(timeoutId)
        const latencyMs = Date.now() - startTime
        console.log(
          '[main] testLLMConnection 测试成功（该服务不支持流式输出），耗时:',
          latencyMs,
          'ms'
        )
        return {
          ok: true,
          message: '连接成功，服务响应正常（该服务不支持流式输出，未测速）',
          latencyMs
        }
      }

      response = fallbackResponse
    }

    if (response.ok) {
      // 响应体不可读时只能退化为纯连通性判断
      if (!response.body) {
        clearTimeout(timeoutId)
        return {
          ok: true,
          message: '连接成功，服务响应正常',
          latencyMs: Date.now() - startTime
        }
      }

      const stats = await consumeChatCompletionStream(response.body, startTime)
      clearTimeout(timeoutId)

      const tokensPerSecond = calculateTokensPerSecond(stats)

      console.log('[main] testLLMConnection 测试成功:', {
        latencyMs: stats.totalMs,
        firstTokenMs: stats.firstTokenMs,
        outputTokens: stats.outputTokens,
        tokensPerSecond
      })

      return {
        ok: true,
        message: '连接成功，服务响应正常',
        latencyMs: stats.totalMs,
        firstTokenMs: stats.firstTokenMs || undefined,
        outputTokens: stats.outputTokens || undefined,
        tokensPerSecond,
        speedEstimated: tokensPerSecond !== undefined ? stats.estimated : undefined
      }
    }

    const rawResponseText = await response.text()
    console.error(
      '[main] testLLMConnection 测试未通过，状态码:',
      response.status,
      '内容:',
      rawResponseText
    )

    let errorDetail = ''
    try {
      const errorJson = JSON.parse(rawResponseText) as {
        error?: { message?: string } | string
        message?: string
        detail?: string
      }
      if (typeof errorJson.error === 'string') {
        errorDetail = errorJson.error
      } else if (errorJson.error && typeof errorJson.error === 'object') {
        errorDetail = errorJson.error.message || ''
      } else {
        errorDetail = errorJson.message || errorJson.detail || ''
      }
    } catch {
      errorDetail = rawResponseText.slice(0, 150)
    }

    if (response.status === 401) {
      return {
        ok: false,
        message: '鉴权失败 (401)：API Key 无效或未授权',
        errorDetail: rawResponseText
      }
    }

    if (response.status === 404) {
      return {
        ok: false,
        message: '端点不存在 (404)：请检查 Base URL 是否正确',
        errorDetail: rawResponseText
      }
    }

    if (response.status === 429) {
      return {
        ok: false,
        message: '速率超限或配额用尽 (429)',
        errorDetail: rawResponseText
      }
    }

    return {
      ok: false,
      message: `请求失败 (${response.status})${errorDetail ? `: ${errorDetail}` : ''}`,
      errorDetail: rawResponseText
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.error('[main] testLLMConnection 底层网络异常:', error)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        message: `连接超时（${CONNECTION_TEST_TIMEOUT_MS / 1000}秒内未完成输出，请检查网络或代理）`
      }
    }

    const cause = (error as { cause?: unknown })?.cause
    const causeText = cause ? ` [原因: ${String(cause)}]` : ''

    return {
      ok: false,
      message:
        error instanceof Error ? `连接异常: ${error.message}${causeText}` : '无法连接到模型服务',
      errorDetail: error instanceof Error ? String(error.stack || error.message) : undefined
    }
  }
}

/**
 * 自动拉取指定服务商的可用模型列表（基于标准 GET /v1/models）
 */
export const fetchProviderModels = async ({
  baseUrl,
  apiKey
}: {
  baseUrl: string
  apiKey: string
}): Promise<FetchModelsResult> => {
  const cleanBase = normalizeBaseUrl(baseUrl)
  if (!cleanBase) {
    return { ok: false, error: 'Base URL 不能为空' }
  }

  const endpoint = `${cleanBase}/models`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)

  console.log('[main] fetchProviderModels 开始拉取模型列表:', endpoint)

  try {
    const response = await net.fetch(endpoint, {
      method: 'GET',
      headers: {
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
        'User-Agent': 'screenshot-translator/1.0'
      },
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    const rawText = await response.text()
    if (!response.ok) {
      let failMsg = `服务商返回状态码 ${response.status}`
      try {
        const errObj = JSON.parse(rawText) as {
          error?: { message?: string } | string
          message?: string
        }
        const parsedMsg =
          typeof errObj.error === 'string' ? errObj.error : errObj.error?.message || errObj.message
        if (parsedMsg) {
          failMsg = `[${response.status}] ${parsedMsg}`
        }
      } catch {
        // 忽略 JSON 解析失败
      }
      return {
        ok: false,
        error: failMsg,
        errorDetail: rawText
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      return {
        ok: false,
        error: '服务商返回的数据不是合法的 JSON 格式',
        errorDetail: rawText.slice(0, 300)
      }
    }

    // 标准 OpenAI 返回结构为 { data: [{ id: 'xxx' }, ...] }
    // 部分聚合网关可能返回 { models: [...] } 或顶层数组 [...]
    let rawList: unknown[] = []
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray((parsed as { data?: unknown[] }).data)) {
        rawList = (parsed as { data: unknown[] }).data
      } else if (Array.isArray((parsed as { models?: unknown[] }).models)) {
        rawList = (parsed as { models: unknown[] }).models
      } else if (Array.isArray(parsed)) {
        rawList = parsed
      }
    }

    const modelIds: string[] = []
    for (const item of rawList) {
      if (typeof item === 'string' && item.trim()) {
        modelIds.push(item.trim())
      } else if (item && typeof item === 'object') {
        const id =
          (item as { id?: unknown; name?: unknown; model?: unknown }).id ||
          (item as { name?: unknown }).name ||
          (item as { model?: unknown }).model
        if (typeof id === 'string' && id.trim()) {
          modelIds.push(id.trim())
        }
      }
    }

    // 去重并按首字母排序
    const uniqueIds = Array.from(new Set(modelIds)).sort((a, b) => a.localeCompare(b))

    if (uniqueIds.length === 0) {
      return {
        ok: false,
        error: '未能从响应中解析到任何有效模型 ID（请核对接口结构）',
        errorDetail: rawText.slice(0, 500)
      }
    }

    return {
      ok: true,
      models: uniqueIds
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.error('[main] fetchProviderModels 请求异常:', error)
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        error: '拉取模型超时（12秒内未收到响应，请检查网络或代理）'
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : '网络请求失败',
      errorDetail: error instanceof Error ? String(error.stack || error.message) : undefined
    }
  }
}
