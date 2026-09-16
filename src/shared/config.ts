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
  /** 模型调用标识符，如 gpt-4o-mini、deepseek-chat */
  value: string
  /** 快捷编号代码，如 A1, B2 */
  code: string
  /** 模式或特性描述，如 FAST RESPONSE, BALANCED */
  profile: string
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
