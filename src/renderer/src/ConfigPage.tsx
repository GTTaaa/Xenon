import { useEffect, useState } from 'react'
import type {
  LLMConfig,
  LLMProviderType,
  ModelOptionItem,
  TestConnectionResult
} from '../../shared/config'

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

export const ConfigPage = (): React.JSX.Element => {
  const [provider, setProvider] = useState<LLMProviderType>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOptionItem[]>([])
  const [showApiKey, setShowApiKey] = useState(false)
  // 深度思考模式开关
  const [enableThinking, setEnableThinking] = useState(false)

  // 连通性测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  // 保存中状态与消息提示
  const [isSaving, setIsSaving] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')

  // 新增备选模型临时输入
  const [newModelName, setNewModelName] = useState('')

  // 初始化加载当前持久化配置
  useEffect(() => {
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
        setEnableThinking(Boolean(config.enableThinking))
        setTestResult(null)
        setFeedbackMessage('')
      })
      .catch((error) => {
        console.error('[renderer] 获取大模型配置失败', error)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // 监听 ESC 键关闭独立设置窗口
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        void window.api.closeConfigWindow()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

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
    setFeedbackMessage(`已填充 ${preset.name} 预设`)
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
      modelOptions,
      enableThinking
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
      modelOptions: currentOptions,
      enableThinking
    }

    try {
      const result = await window.api.saveConfig(payload)
      if (result.ok) {
        setFeedbackMessage('✓ 配置已保存并实时同步至主窗口')
        setTimeout(() => {
          void window.api.closeConfigWindow()
        }, 500)
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
      setFeedbackMessage(`模型 ${trimmed} 已在列表中`)
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
    <div className="config-page-root">
      {/* 顶部可拖拽工业控制条 */}
      <header className="config-page-header">
        <div className="config-header-brand">
          <span className="config-brand-code">SYS-CFG // PREFERENCES</span>
          <h1 className="config-page-title">LLM ENGINE CONFIGURATION</h1>
        </div>
        <div className="config-header-actions">
          <button
            type="button"
            className="config-window-close-btn"
            aria-label="关闭设置窗口"
            title="关闭设置 (ESC)"
            onClick={() => void window.api.closeConfigWindow()}
          >
            ✕ ESC
          </button>
        </div>
      </header>

      {/* 主体滚动表单 */}
      <main className="config-page-scroll">
        {/* 服务提供商选择 */}
        <section className="config-section-card">
          <div className="config-section-header">
            <span className="config-section-tag">01 / MODE</span>
            <label className="config-field-label">SERVICE PROVIDER // 模式选择</label>
          </div>
          <div className="config-provider-toggle">
            <button
              type="button"
              className={`config-provider-chip ${
                provider === 'openai-compatible' ? 'config-provider-chip-active' : ''
              }`}
              onClick={() => setProvider('openai-compatible')}
            >
              OPENAI COMPATIBLE (通用接口)
            </button>
            <button
              type="button"
              className={`config-provider-chip ${provider === 'mock' ? 'config-provider-chip-active' : ''}`}
              onClick={() => setProvider('mock')}
            >
              MOCK 离线模拟演练
            </button>
          </div>
          <p className="config-field-hint">
            {provider === 'openai-compatible'
              ? '支持兼容 OpenAI 标准的各种商业与本地大模型接口（DeepSeek, 通义千问, Kimi, Ollama, 阶跃星辰等）'
              : '离线模拟模式，无需配置网络与 API Key，返回预设模拟翻译结果'}
          </p>
        </section>

        {provider === 'openai-compatible' ? (
          <>
            {/* 厂商快捷预设 */}
            <section className="config-section-card">
              <div className="config-section-header">
                <span className="config-section-tag">02 / PRESETS</span>
                <label className="config-field-label">QUICK PRESETS // 常用厂商一键填充</label>
              </div>
              <div className="config-preset-grid">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="config-preset-card-btn"
                    onClick={() => handleApplyPreset(preset)}
                  >
                    <span className="config-preset-name">{preset.name}</span>
                    <span className="config-preset-meta">{preset.defaultModel}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* 核心接口参数 */}
            <section className="config-section-card">
              <div className="config-section-header">
                <span className="config-section-tag">03 / ENDPOINT</span>
                <label className="config-field-label">API PARAMETERS // 接口基础配置</label>
              </div>

              {/* Base URL */}
              <div className="config-field-group">
                <label className="config-field-label" htmlFor="llm-base-url">
                  BASE URL // 接口服务地址
                </label>
                <div className="config-input-wrapper">
                  <input
                    id="llm-base-url"
                    type="text"
                    className="config-text-input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="例如: https://api.deepseek.com/v1"
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
                    {showApiKey ? '[HIDE / 隐藏]' : '[SHOW / 显示]'}
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
            </section>

            {/* 主模型与特性 */}
            <section className="config-section-card">
              <div className="config-section-header">
                <span className="config-section-tag">04 / ENGINE</span>
                <label className="config-field-label">
                  DEFAULT ENGINE & REASONING // 主模型与深度思考
                </label>
              </div>

              <div className="config-field-group">
                <label className="config-field-label" htmlFor="llm-model-name">
                  DEFAULT MODEL ID // 默认模型代号
                </label>
                <div className="config-input-wrapper">
                  <input
                    id="llm-model-name"
                    type="text"
                    className="config-text-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="例如: deepseek-chat 或 gpt-4o-mini"
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* 深度思考开关 */}
              <div className="config-field-group">
                <div
                  className="config-checkbox-label"
                  onClick={() => setEnableThinking((prev) => !prev)}
                >
                  <input
                    id="llm-enable-thinking"
                    type="checkbox"
                    checked={enableThinking}
                    onChange={(e) => setEnableThinking(e.target.checked)}
                    className="config-checkbox-input"
                  />
                  <div className="config-checkbox-info">
                    <span className="config-checkbox-title">
                      ENABLE DEEP THINKING // 开启深度思考模式
                    </span>
                    <span className="config-checkbox-desc">
                      适配 DeepSeek-R1 / OpenAI o1 等推理模型，让模型输出思考推导链
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 备选模型切换池 */}
            <section className="config-section-card">
              <div className="config-section-header">
                <span className="config-section-tag">05 / REPOSITORY</span>
                <label className="config-field-label">MODEL POOL // 主窗口快速切换模型库</label>
              </div>

              <div className="config-model-list">
                {modelOptions.map((opt) => (
                  <div key={opt.value} className="config-model-item">
                    <div className="config-model-item-code">{opt.code}</div>
                    <div className="config-model-item-info">
                      <span className="config-model-item-value">{opt.value}</span>
                      <span className="config-model-item-profile">{opt.profile}</span>
                    </div>
                    {modelOptions.length > 1 ? (
                      <button
                        type="button"
                        className="config-model-remove-btn"
                        onClick={() => handleRemoveModelOption(opt.value)}
                        title={`移除 ${opt.value}`}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* 添加新备选模型 */}
              <div className="config-add-model-row">
                <input
                  type="text"
                  className="config-text-input config-add-input"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddModelOption()
                    }
                  }}
                  placeholder="输入新模型标识符，如 claude-3-5-sonnet..."
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="config-action-btn config-add-btn"
                  onClick={handleAddModelOption}
                  disabled={!newModelName.trim()}
                >
                  + ADD POOL
                </button>
              </div>
            </section>
          </>
        ) : null}
      </main>

      {/* 底部固定操作栏 */}
      <footer className="config-page-footer">
        <div className="config-footer-left">
          {provider === 'openai-compatible' ? (
            <button
              type="button"
              className="config-action-btn config-test-btn"
              onClick={() => void handleTestConnection()}
              disabled={isTesting || isSaving}
            >
              {isTesting ? 'TESTING...' : '⚡ TEST CONNECTION'}
            </button>
          ) : null}

          {testResult ? (
            <span
              className={`config-test-badge ${
                testResult.ok ? 'config-test-badge-ok' : 'config-test-badge-fail'
              }`}
            >
              {testResult.ok ? `✓ OK (${testResult.latencyMs ?? 0}ms)` : `✕ ${testResult.message}`}
            </span>
          ) : null}
        </div>

        <div className="config-footer-right">
          {feedbackMessage ? <span className="config-feedback-msg">{feedbackMessage}</span> : null}

          <button
            type="button"
            className="config-action-btn config-cancel-btn"
            onClick={() => void window.api.closeConfigWindow()}
            disabled={isSaving}
          >
            CANCEL
          </button>

          <button
            type="button"
            className="config-action-btn config-save-btn"
            onClick={() => void handleSave()}
            disabled={isSaving || isTesting}
          >
            {isSaving ? 'SAVING...' : 'SAVE & APPLY'}
          </button>
        </div>
      </footer>
    </div>
  )
}
