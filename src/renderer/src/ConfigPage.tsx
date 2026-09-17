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
    setFeedbackMessage(`已填入 ${preset.name} 预设参数`)
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
        setFeedbackMessage('配置已保存生效')
        setTimeout(() => {
          void window.api.closeConfigWindow()
        }, 400)
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
    <div className="pref-root">
      {/* 顶部标题栏 */}
      <header className="pref-header">
        <div className="pref-header-title">
          <span className="pref-title-main">偏好设置</span>
          <span className="pref-title-sub">PREFERENCES // LLM CONFIG</span>
        </div>
        <button
          type="button"
          className="pref-close-btn"
          aria-label="关闭设置窗口"
          title="关闭设置 (ESC)"
          onClick={() => void window.api.closeConfigWindow()}
        >
          ×
        </button>
      </header>

      {/* 主体设置表单区 */}
      <main className="pref-body">
        {/* 模块一：服务模式与厂商预设 */}
        <section className="pref-card">
          <div className="pref-card-header">
            <h2 className="pref-card-title">模型服务与厂商</h2>
            {/* 分段模式选择器 */}
            <div className="pref-seg-control">
              <button
                type="button"
                className={`pref-seg-btn ${
                  provider === 'openai-compatible' ? 'pref-seg-btn-active' : ''
                }`}
                onClick={() => setProvider('openai-compatible')}
              >
                OpenAI 兼容接口
              </button>
              <button
                type="button"
                className={`pref-seg-btn ${provider === 'mock' ? 'pref-seg-btn-active' : ''}`}
                onClick={() => setProvider('mock')}
              >
                Mock 离线演练
              </button>
            </div>
          </div>

          {provider === 'openai-compatible' ? (
            <div className="pref-preset-row">
              <span className="pref-preset-tip">快速填入：</span>
              <div className="pref-preset-chips">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="pref-preset-chip"
                    onClick={() => handleApplyPreset(preset)}
                    title={`填充 Base URL 与 ${preset.defaultModel}`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="pref-mock-hint">当前为离线演练模式，将返回预设翻译结果，无需网络请求。</p>
          )}
        </section>

        {provider === 'openai-compatible' ? (
          <>
            {/* 模块二：接口连接与模型配置 */}
            <section className="pref-card">
              <div className="pref-card-header">
                <h2 className="pref-card-title">接口连接与主模型</h2>
              </div>

              <div className="pref-fields-grid">
                {/* 服务地址 */}
                <div className="pref-field">
                  <label className="pref-label" htmlFor="llm-base-url">
                    服务地址 (Base URL)
                  </label>
                  <input
                    id="llm-base-url"
                    type="text"
                    className="pref-input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.deepseek.com/v1"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                {/* 访问密钥 */}
                <div className="pref-field">
                  <div className="pref-label-row">
                    <label className="pref-label" htmlFor="llm-api-key">
                      访问密钥 (API Key)
                    </label>
                    <button
                      type="button"
                      className="pref-text-btn"
                      onClick={() => setShowApiKey((prev) => !prev)}
                    >
                      {showApiKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <input
                    id="llm-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    className="pref-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                {/* 默认模型 */}
                <div className="pref-field">
                  <label className="pref-label" htmlFor="llm-model-name">
                    默认模型 (Model ID)
                  </label>
                  <input
                    id="llm-model-name"
                    type="text"
                    className="pref-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="例如: deepseek-chat 或 gpt-4o-mini"
                    spellCheck={false}
                  />
                </div>

                {/* 深度思考模式 Switch 开关 */}
                <div className="pref-switch-row" onClick={() => setEnableThinking((prev) => !prev)}>
                  <div className="pref-switch-desc">
                    <span className="pref-switch-name">深度思考推理模式</span>
                    <span className="pref-switch-sub">
                      让模型输出思维推导链（支持 DeepSeek-R1 / o1 / o3 等）
                    </span>
                  </div>
                  <div className={`pref-switch ${enableThinking ? 'pref-switch-on' : ''}`}>
                    <div className="pref-switch-thumb" />
                  </div>
                </div>
              </div>
            </section>

            {/* 模块三：主窗口快捷模型库 */}
            <section className="pref-card">
              <div className="pref-card-header">
                <div className="pref-card-title-group">
                  <h2 className="pref-card-title">快捷切换模型池</h2>
                  <span className="pref-card-subtitle">
                    主翻译界面右上角可直接快速下拉切换以下模型
                  </span>
                </div>
              </div>

              <div className="pref-pool-container">
                {/* 标签胶囊池 */}
                <div className="pref-pills-wrap">
                  {modelOptions.map((opt) => (
                    <span key={opt.value} className="pref-pill">
                      <span className="pref-pill-name">{opt.value}</span>
                      {modelOptions.length > 1 ? (
                        <button
                          type="button"
                          className="pref-pill-remove"
                          onClick={() => handleRemoveModelOption(opt.value)}
                          title={`移除 ${opt.value}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>

                {/* 紧凑添加行 */}
                <div className="pref-add-row">
                  <input
                    type="text"
                    className="pref-input pref-add-input"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddModelOption()
                      }
                    }}
                    placeholder="添加新模型，如 qwen-max..."
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="pref-btn pref-btn-secondary"
                    onClick={handleAddModelOption}
                    disabled={!newModelName.trim()}
                  >
                    + 加入模型池
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>

      {/* 底部操作工具栏 */}
      <footer className="pref-footer">
        <div className="pref-footer-left">
          {provider === 'openai-compatible' ? (
            <button
              type="button"
              className="pref-btn pref-btn-test"
              onClick={() => void handleTestConnection()}
              disabled={isTesting || isSaving}
            >
              {isTesting ? '正在测试...' : '测试连接'}
            </button>
          ) : null}

          {testResult ? (
            <div
              className={`pref-test-status ${
                testResult.ok ? 'pref-test-status-ok' : 'pref-test-status-fail'
              }`}
            >
              <span className="pref-status-dot" />
              <span className="pref-status-text">
                {testResult.ok
                  ? `连接成功 (${testResult.latencyMs ?? 0}ms)`
                  : `连接失败: ${testResult.message}`}
              </span>
            </div>
          ) : null}
        </div>

        <div className="pref-footer-right">
          {feedbackMessage ? <span className="pref-feedback-text">{feedbackMessage}</span> : null}

          <button
            type="button"
            className="pref-btn pref-btn-cancel"
            onClick={() => void window.api.closeConfigWindow()}
            disabled={isSaving}
          >
            取消
          </button>

          <button
            type="button"
            className="pref-btn pref-btn-save"
            onClick={() => void handleSave()}
            disabled={isSaving || isTesting}
          >
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </footer>
    </div>
  )
}
