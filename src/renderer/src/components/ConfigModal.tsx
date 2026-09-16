import { useEffect, useState } from 'react'
import type {
  LLMConfig,
  LLMProviderType,
  ModelOptionItem,
  TestConnectionResult
} from '../../../shared/config'

/**
 * 常用厂商快捷填充预设
 */
interface ProviderPreset {
  name: string
  baseUrl: string
  defaultModel: string
  profile: string
}

const PRESETS: ProviderPreset[] = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    profile: 'FAST & ACCURATE'
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    profile: 'STANDARD BALANCED'
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    profile: 'ALIBABA CLOUD'
  },
  {
    name: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3:latest',
    profile: 'LOCAL OFFLINE'
  },
  {
    name: '阶跃星辰',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-1-8k',
    profile: 'HIGH PERFORMANCE'
  }
]

interface ConfigModalProps {
  /** 弹窗是否可见 */
  isOpen: boolean
  /** 关闭弹窗回调 */
  onClose: () => void
  /** 保存配置成功回调 */
  onConfigSaved: (config: LLMConfig) => void
}

export const ConfigModal = ({
  isOpen,
  onClose,
  onConfigSaved
}: ConfigModalProps): React.JSX.Element | null => {
  const [provider, setProvider] = useState<LLMProviderType>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOptionItem[]>([])
  const [showApiKey, setShowApiKey] = useState(false)

  // 连通性测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  // 保存中状态与消息提示
  const [isSaving, setIsSaving] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')

  // 新增备选模型临时输入
  const [newModelName, setNewModelName] = useState('')

  // 打开弹窗时，从主进程加载当前实际配置
  useEffect(() => {
    if (!isOpen) return

    let isMounted = true
    window.api
      .getConfig()
      .then((config) => {
        if (!isMounted) return
        setProvider(config.provider || 'openai-compatible')
        setBaseUrl(config.baseUrl || '')
        setApiKey(config.apiKey || '')
        setModel(config.model || '')
        setModelOptions(config.modelOptions || [])
        setTestResult(null)
        setFeedbackMessage('')
      })
      .catch((error) => {
        console.error('[renderer] 获取大模型配置失败', error)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen])

  // 监听 ESC 键关闭弹窗
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  /**
   * 应用快捷预设
   */
  const handleApplyPreset = (preset: ProviderPreset): void => {
    setProvider('openai-compatible')
    setBaseUrl(preset.baseUrl)
    setModel(preset.defaultModel)

    // 检查并自动将预设模型追加进模型池备选
    const exists = modelOptions.some((item) => item.value === preset.defaultModel)
    if (!exists) {
      const codeIndex = modelOptions.length + 1
      const generatedCode = `U${codeIndex}`
      setModelOptions((prev) => [
        ...prev,
        {
          value: preset.defaultModel,
          code: generatedCode,
          profile: preset.profile
        }
      ])
    }

    setTestResult(null)
  }

  /**
   * 执行连通性测试
   */
  const handleTestConnection = async (): Promise<void> => {
    setIsTesting(true)
    setTestResult(null)
    setFeedbackMessage('')

    const currentDraftConfig: LLMConfig = {
      provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim() || 'gpt-4o-mini',
      modelOptions
    }

    try {
      const result = await window.api.testConfig(currentDraftConfig)
      setTestResult(result)
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : '连接测试执行异常'
      })
    } finally {
      setIsTesting(false)
    }
  }

  /**
   * 保存并应用配置
   */
  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    setFeedbackMessage('')

    // 确保当前选中的主模型在模型库中有对应项
    const currentOptions = [...modelOptions]
    const trimmedModel = model.trim()
    if (trimmedModel && !currentOptions.some((item) => item.value === trimmedModel)) {
      currentOptions.unshift({
        value: trimmedModel,
        code: 'A0',
        profile: 'PRIMARY MODEL'
      })
    }

    const payload: LLMConfig = {
      provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: trimmedModel || 'step-3.5-flash',
      modelOptions: currentOptions
    }

    try {
      const result = await window.api.saveConfig(payload)
      if (result.ok) {
        setFeedbackMessage('配置已保存并生效')
        onConfigSaved(payload)
        setTimeout(() => {
          onClose()
        }, 350)
      } else {
        setFeedbackMessage(`保存失败: ${result.error || '未知错误'}`)
      }
    } catch (error) {
      setFeedbackMessage(`保存异常: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * 添加自定义备选模型
   */
  const handleAddModelOption = (): void => {
    const trimmed = newModelName.trim()
    if (!trimmed) return
    if (modelOptions.some((item) => item.value === trimmed)) {
      setNewModelName('')
      return
    }

    const code = `U${modelOptions.length + 1}`
    setModelOptions((prev) => [
      ...prev,
      {
        value: trimmed,
        code,
        profile: 'CUSTOM MODEL'
      }
    ])
    setNewModelName('')
  }

  /**
   * 移除备选模型
   */
  const handleRemoveModelOption = (valueToRemove: string): void => {
    setModelOptions((prev) => prev.filter((item) => item.value !== valueToRemove))
  }

  return (
    <div
      className="config-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="config-modal-title"
    >
      <div className="config-modal-window">
        {/* 顶部标题栏 */}
        <div className="config-modal-header">
          <div className="config-header-title-wrap">
            <span className="config-header-code">SYS-CFG // 01</span>
            <h2 id="config-modal-title" className="config-modal-title">
              LLM ENGINE CONFIG
            </h2>
          </div>
          <button
            className="config-close-button"
            type="button"
            aria-label="关闭配置面板"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 内部滚动表单区 */}
        <div className="config-modal-scroll">
          {/* 模式选择 */}
          <div className="config-field-group">
            <label className="config-field-label">SERVICE PROVIDER // 模式选择</label>
            <div className="config-provider-toggle">
              <button
                type="button"
                className={`config-provider-chip ${
                  provider === 'openai-compatible' ? 'config-provider-chip-active' : ''
                }`}
                onClick={() => setProvider('openai-compatible')}
              >
                OPENAI COMPATIBLE
              </button>
              <button
                type="button"
                className={`config-provider-chip ${provider === 'mock' ? 'config-provider-chip-active' : ''}`}
                onClick={() => setProvider('mock')}
              >
                MOCK 模拟模式
              </button>
            </div>
            <span className="config-field-hint">
              {provider === 'openai-compatible'
                ? '支持通用兼容 OpenAI 的模型接口（DeepSeek, 通义千问, Kimi, Ollama, 阶跃星辰等）'
                : '离线模拟模式，无需配置网络与 API Key，用于界面演练'}
            </span>
          </div>

          {provider === 'openai-compatible' ? (
            <>
              {/* 快捷预设 */}
              <div className="config-field-group">
                <label className="config-field-label">QUICK PRESETS // 厂商预设快速填充</label>
                <div className="config-preset-list">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="config-preset-btn"
                      onClick={() => handleApplyPreset(preset)}
                      title={`填入 ${preset.baseUrl}`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Base URL */}
              <div className="config-field-group">
                <label className="config-field-label" htmlFor="llm-base-url">
                  BASE URL // 接口基础地址
                </label>
                <div className="config-input-wrapper">
                  <input
                    id="llm-base-url"
                    type="text"
                    className="config-text-input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="例如: https://api.openai.com/v1"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* API Key */}
              <div className="config-field-group">
                <div className="config-label-row">
                  <label className="config-field-label" htmlFor="llm-api-key">
                    API KEY // 访问密钥
                  </label>
                  <button
                    type="button"
                    className="config-toggle-visibility-btn"
                    onClick={() => setShowApiKey((prev) => !prev)}
                  >
                    {showApiKey ? '[HIDE]' : '[SHOW]'}
                  </button>
                </div>
                <div className="config-input-wrapper">
                  <input
                    id="llm-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    className="config-text-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* 默认模型 */}
              <div className="config-field-group">
                <label className="config-field-label" htmlFor="llm-model-name">
                  DEFAULT MODEL // 默认模型代号
                </label>
                <div className="config-input-wrapper">
                  <input
                    id="llm-model-name"
                    type="text"
                    className="config-text-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="例如: gpt-4o-mini 或 deepseek-chat"
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* 连通性测试区 */}
              <div className="config-test-panel">
                <div className="config-test-header">
                  <span className="config-field-label">CONNECTION DIAGNOSTIC // 连通性检测</span>
                  <button
                    type="button"
                    className="config-test-button"
                    onClick={() => void handleTestConnection()}
                    disabled={isTesting || !baseUrl.trim() || !apiKey.trim()}
                  >
                    {isTesting ? 'PINGING...' : 'TEST PING'}
                  </button>
                </div>

                {testResult ? (
                  <div
                    className={`config-test-result ${
                      testResult.ok ? 'config-test-result-ok' : 'config-test-result-error'
                    }`}
                  >
                    <span
                      className={`config-indicator-dot ${
                        testResult.ok ? 'config-indicator-dot-green' : 'config-indicator-dot-red'
                      }`}
                    />
                    <div className="config-test-result-body">
                      <span className="config-test-result-title">
                        {testResult.ok
                          ? `CONNECTED (${testResult.latencyMs ?? 0}ms)`
                          : 'CONNECTION FAILED'}
                      </span>
                      <span className="config-test-result-desc">{testResult.message}</span>
                    </div>
                  </div>
                ) : isTesting ? (
                  <div className="config-test-result config-test-result-testing">
                    <span className="config-indicator-dot config-indicator-dot-pulsing" />
                    <span className="config-test-result-title">SENDING TEST PACKET...</span>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {/* 模型库备选池 */}
          <div className="config-field-group">
            <label className="config-field-label">MODEL BANK UNITS // 备选模型切换库</label>
            <div className="config-model-options-list">
              {modelOptions.map((opt) => (
                <div key={opt.value} className="config-model-item-chip">
                  <span className="config-model-chip-code">{opt.code}</span>
                  <span className="config-model-chip-value" title={opt.value}>
                    {opt.value}
                  </span>
                  <button
                    type="button"
                    className="config-model-chip-del"
                    onClick={() => handleRemoveModelOption(opt.value)}
                    title="移除该模型"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="config-add-model-row">
              <input
                type="text"
                className="config-text-input config-add-model-input"
                placeholder="新增模型，如 qwen-turbo"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddModelOption()
                  }
                }}
              />
              <button
                type="button"
                className="config-add-model-btn"
                onClick={handleAddModelOption}
                disabled={!newModelName.trim()}
              >
                + ADD
              </button>
            </div>
          </div>

          {feedbackMessage ? (
            <div className="config-feedback-msg" role="status">
              {feedbackMessage}
            </div>
          ) : null}
        </div>

        {/* 底部按钮栏 */}
        <div className="config-modal-footer">
          <button
            type="button"
            className="config-footer-button config-footer-button-cancel"
            onClick={onClose}
          >
            CANCEL
          </button>
          <button
            type="button"
            className="config-footer-button config-footer-button-save"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? 'APPLYING...' : 'SAVE & APPLY'}
          </button>
        </div>
      </div>
    </div>
  )
}
