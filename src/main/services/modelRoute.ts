import type { AppSettings, ProviderItem } from '../../shared/config'
import type { TranslateOptions } from '../../shared/translate'

/** 一次模型请求实际使用的服务商、地址、密钥与模型 */
export interface ModelRoute {
  /** 当前服务商，用于错误提示与日志 */
  provider: ProviderItem | undefined
  /** 实际使用的服务商类型 */
  providerType: NonNullable<AppSettings['provider']>
  /** 实际使用的接口地址 */
  baseUrl: string
  /** 实际使用的访问密钥 */
  apiKey: string
  /** 实际使用的模型编号 */
  model: string
}

/**
 * 按主界面当前选择解析出稳定的模型路由。
 * 对齐和按词查询共用这段逻辑，避免两个辅助能力落到不同服务商。
 */
export const resolveModelRoute = (config: AppSettings, options?: TranslateOptions): ModelRoute => {
  const targetModel = options?.model || config.activeModelId || config.model || 'deepseek-chat'
  const targetProviderId = options?.providerId
  let targetProvider = config.providers?.find((provider) => provider.id === targetProviderId)

  if (!targetProvider && targetModel) {
    targetProvider = config.providers?.find((provider) =>
      provider.models?.some((model) => model.id === targetModel)
    )
  }

  if (!targetProvider && targetModel) {
    if (targetModel.startsWith('cline-pass/') || targetModel.includes('cline')) {
      targetProvider = config.providers?.find((provider) => provider.id === 'cline')
    } else if (targetModel.includes('deepseek')) {
      targetProvider = config.providers?.find((provider) => provider.id === 'deepseek')
    }
  }

  if (!targetProvider) {
    targetProvider =
      config.providers?.find((provider) => provider.id === config.activeProviderId) ||
      config.providers?.find((provider) => provider.enabled) ||
      config.providers?.[0]
  }

  return {
    provider: targetProvider,
    providerType: targetProvider?.providerType || config.provider || 'openai-compatible',
    baseUrl: (targetProvider?.baseUrl || config.baseUrl || '').trim(),
    apiKey: (targetProvider?.apiKey || config.apiKey || '').trim(),
    model: targetModel
  }
}
