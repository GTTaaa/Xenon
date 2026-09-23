/**
 * 大模型服务提供商类型
 * 'openai-compatible': 兼容 OpenAI 格式的接口（DeepSeek, 通义千问, Kimi, Ollama, StepFun 等）
 * 'mock': 模拟测试模式
 */
export type LLMProviderType = 'openai-compatible' | 'mock'

/**
 * 模型选项单项配置
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
  /** 该模型是否默认启用深度思考（可选） */
  enableThinking?: boolean
}

/**
 * 大模型核心配置数据结构
 */
export interface LLMConfig {
  /** 服务提供商类型 */
  provider: LLMProviderType
  /** 接口基础地址 */
  baseUrl: string
  /** 访问密钥 */
  apiKey: string
  /** 默认使用的模型名称 */
  model: string
  /** 默认是否启用大模型深度思考/推理模式 */
  enableThinking?: boolean
  /** 用户配置的快捷模型备选池 */
  modelOptions: ModelOptionItem[]
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
}
