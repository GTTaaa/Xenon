/**
 * 大模型服务提供商类型
 * 'openai-compatible': 兼容 OpenAI 格式的接口（DeepSeek, 通义千问, Kimi, Ollama, StepFun 等）
 * 'mock': 模拟测试模式
 */
export type LLMProviderType = 'openai-compatible' | 'mock'

/**
 * 单个厂商下的模型项配置
 */
export interface ProviderModelItem {
  /** 模型调用标识符，如 'deepseek-chat', 'cline-pass/deepseek-v4.1-flash' */
  id: string
  /** 显示名称或说明，如 'DeepSeek V3', 'Qwen 3.7 Max' */
  label?: string
}

/**
 * 独立的模型服务商/渠道配置项
 */
export interface ProviderItem {
  /** 厂商唯一 ID，例如 'deepseek', 'cline', 'openai', 'qwen', 'custom-1' */
  id: string
  /** 厂商显示名称，如 'DeepSeek 官方', 'ClinePass' */
  name: string
  /** 接口提供商类型 */
  providerType: LLMProviderType
  /** 该厂商专属的基础服务地址 */
  baseUrl: string
  /** 该厂商专属的访问密钥 */
  apiKey: string
  /** 该厂商是否启用（只有启用的厂商才会出现在主界面下拉框） */
  enabled: boolean
  /** 该厂商配置的模型列表 */
  models: ProviderModelItem[]
  /** 该厂商默认使用的模型 ID */
  defaultModel?: string
}

/**
 * 模型选项单项配置（保留用于向下兼容老版本模型池）
 */
export interface ModelOptionItem {
  /** 模型调用标识符，如 gpt-4o-mini、deepseek-chat、cline-pass/deepseek-v4.1-flash */
  value: string
  /** 快捷编号代码，如 A1, B2 */
  code: string
  /** 模式或特性描述/厂商标签，如 FAST RESPONSE, BALANCED, DEEPSEEK 官方, CLINEPASS */
  profile: string
  /** 服务提供商类型（可选，默认继承全局） */
  provider?: LLMProviderType
  /** 该模型专属的接口地址（可选，未设置时继承全局 baseUrl） */
  baseUrl?: string
  /** 该模型专属的访问密钥（可选，未设置时继承全局 apiKey） */
  apiKey?: string
}

/**
 * 大模型核心配置数据结构
 */
export interface LLMConfig {
  /** 当前主界面选中的生效服务提供商 ID */
  activeProviderId?: string
  /** 当前主界面选中的生效模型 ID */
  activeModelId?: string
  /** 多服务商独立配置列表 */
  providers: ProviderItem[]

  // --- 以下字段保留兼容旧版本与兜底逻辑 ---
  /** 服务提供商类型 */
  provider?: LLMProviderType
  /** 接口基础地址 */
  baseUrl?: string
  /** 访问密钥 */
  apiKey?: string
  /** 默认使用的模型名称 */
  model?: string
  /** 用户配置的快捷模型备选池 */
  modelOptions?: ModelOptionItem[]
}

/**
 * 连通性测试返回结果
 */
export interface TestConnectionResult {
  /** 连通性测试是否成功 */
  ok: boolean
  /** 提示消息或错误原因 */
  message: string
  /** 响应延迟（毫秒） */
  latencyMs?: number
  /** 详细错误信息或 HTTP 响应体，供排查诊断 */
  errorDetail?: string
}

/**
 * 自动拉取服务商模型列表的返回结果
 */
export interface FetchModelsResult {
  /** 是否拉取成功 */
  ok: boolean
  /** 获取到的模型 ID 列表 */
  models?: string[]
  /** 失败原因说明 */
  error?: string
  /** 原始响应或调试详情 */
  errorDetail?: string
}

/**
 * 全局快捷键偏好设置
 */
export interface ShortcutSettings {
  /** 截屏翻译快捷键，如 'Alt+S' 或 'CommandOrControl+Shift+S' */
  screenshot: string
  /** 唤起输入翻译主窗口快捷键，如 'Alt+A' */
  inputTranslate: string
  /** 打开系统偏好设置快捷键，如 'CommandOrControl+,' */
  openPreferences: string
}

/**
 * 翻译行为偏好设置
 */
export interface TranslationSettings {
  /** 默认目标语言代码，如 'zh-CN', 'en', 'ja', 'ko' 等 */
  defaultTargetLanguage: string
  /** 翻译成功后是否自动写入系统剪贴板 */
  autoCopyResult: boolean
  /** 自定义翻译系统提示词（留空使用系统内置精准提示词） */
  customSystemPrompt?: string
}

/**
 * 通用系统偏好设置
 */
export interface GeneralSettings {
  /** 是否开机自动启动 */
  launchAtLogin: boolean
  /** 主窗口是否始终置顶浮动 */
  alwaysOnTop: boolean
  /** 关闭主窗口时的行为：'tray' (最小化到托盘) | 'quit' (退出应用) */
  closeAction: 'tray' | 'quit'
}

/**
 * 综合应用完整偏好设置（包含大模型配置、快捷键、翻译行为与通用设置）
 */
export interface AppSettings extends LLMConfig {
  /** 快捷键设置 */
  shortcuts?: ShortcutSettings
  /** 翻译偏好设置 */
  translation?: TranslationSettings
  /** 通用系统设置 */
  general?: GeneralSettings
}

/**
 * 默认快捷键设置
 */
export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  screenshot: 'Alt+S',
  inputTranslate: 'Alt+A',
  openPreferences: 'CommandOrControl+,'
}

/**
 * 默认翻译偏好设置
 */
export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  defaultTargetLanguage: 'zh-CN',
  autoCopyResult: false,
  customSystemPrompt: ''
}

/**
 * 默认通用系统设置
 */
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  launchAtLogin: false,
  alwaysOnTop: false,
  closeAction: 'tray'
}
