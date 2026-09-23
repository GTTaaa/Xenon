import { useEffect, useState } from 'react'
import type {
  LLMConfig,
  ProviderItem,
  ProviderModelItem,
  TestConnectionResult
} from '../../shared/config'

/**
 * 预设厂商模板
 */
interface ProviderTemplate {
  id: string
  name: string
  baseUrl: string
  defaultModel: string
  models: ProviderModelItem[]
}

const PRESET_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3 对话' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1 深度推理', enableThinking: true }
    ]
  },
  {
    id: 'cline',
    name: 'ClinePass',
    baseUrl: 'https://api.cline.bot/api/v1',
    defaultModel: 'cline-pass/deepseek-v4.1-flash',
    models: [
      { id: 'cline-pass/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
      { id: 'cline-pass/qwen3.7-max', label: 'Qwen 3.7 Max' },
      { id: 'cline-pass/muse-spark-1.3-contributor', label: 'Muse Spark 1.3' }
    ]
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen-plus', label: 'Qwen Plus 平衡版' },
      { id: 'qwen-max', label: 'Qwen Max 旗舰版' }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini 极速' },
      { id: 'gpt-4o', label: 'GPT-4o 旗舰' }
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3:latest',
    models: [{ id: 'llama3:latest', label: 'Llama 3' }]
  },
  {
    id: 'stepfun',
    name: '阶跃星辰',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-1-8k',
    models: [{ id: 'step-1-8k', label: 'Step 1 8k' }]
  }
]

export const ConfigPage = (): React.JSX.Element => {
  // 服务商列表及当前选中的 Tab
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('deepseek')

  // 是否显示密码
  const [showApiKey, setShowApiKey] = useState(false)

  // 连通性测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  // 保存状态与消息提示
  const [isSaving, setIsSaving] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')

  // 当前厂商新加模型输入框
  const [newModelId, setNewModelId] = useState('')

  // 初始化加载配置
  useEffect(() => {
    let isMounted = true
    window.api
      .getConfig()
      .then((cfg) => {
        if (!isMounted) return
        const list = Array.isArray(cfg.providers) && cfg.providers.length > 0 ? cfg.providers : []
        setProviders(list)
        if (list.length > 0) {
          const matched = cfg.activeProviderId && list.some((p) => p.id === cfg.activeProviderId)
          setActiveTabId(matched ? (cfg.activeProviderId as string) : list[0].id)
        }
      })
      .catch((error) => {
        console.error('[renderer] 读取服务商配置失败', error)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // 监听 ESC 键关闭窗口
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

  // 当前选中的厂商
  const activeProvider = providers.find((p) => p.id === activeTabId) || providers[0]

  /**
   * 更新当前正在编辑的厂商字段
   */
  const updateActiveProvider = (patch: Partial<ProviderItem>): void => {
    if (!activeProvider) return
    setProviders((prev) =>
      prev.map((item) => (item.id === activeProvider.id ? { ...item, ...patch } : item))
    )
    setTestResult(null)
  }

  /**
   * 从模板快速添加一个新服务商
   */
  const handleAddFromTemplate = (template: ProviderTemplate): void => {
    // 检查是否已存在同 ID 厂商
    const exists = providers.some((p) => p.id === template.id)
    if (exists) {
      setActiveTabId(template.id)
      setFeedbackMessage(`已切换至【${template.name}】`)
      return
    }

    const newProvider: ProviderItem = {
      id: template.id,
      name: template.name,
      providerType: 'openai-compatible',
      baseUrl: template.baseUrl,
      apiKey: '',
      enabled: true,
      models: template.models,
      defaultModel: template.defaultModel
    }

    setProviders((prev) => [...prev, newProvider])
    setActiveTabId(newProvider.id)
    setFeedbackMessage(`已添加服务商【${template.name}】，请填写对应的 API Key`)
  }

  /**
   * 添加一个自定义空白厂商
   */
  const handleAddCustomProvider = (): void => {
    const customId = `custom_${Date.now()}`
    const newProvider: ProviderItem = {
      id: customId,
      name: `自定义服务商 ${providers.length + 1}`,
      providerType: 'openai-compatible',
      baseUrl: 'https://',
      apiKey: '',
      enabled: true,
      models: [{ id: 'custom-model', label: '默认模型' }],
      defaultModel: 'custom-model'
    }

    setProviders((prev) => [...prev, newProvider])
    setActiveTabId(customId)
    setFeedbackMessage('已创建新服务商，请填写其名称、Base URL 与 API Key')
  }

  /**
   * 删除某个厂商
   */
  const handleDeleteProvider = (providerIdToDelete: string): void => {
    if (providers.length <= 1) {
      setFeedbackMessage('至少需要保留一个服务商')
      return
    }

    const nextList = providers.filter((p) => p.id !== providerIdToDelete)
    setProviders(nextList)
    if (activeTabId === providerIdToDelete) {
      setActiveTabId(nextList[0].id)
    }
    setFeedbackMessage('已移除该服务商')
  }

  /**
   * 为当前厂商添加新模型
   */
  const handleAddModelToActive = (): void => {
    if (!activeProvider) return
    const trimmed = newModelId.trim()
    if (!trimmed) return

    if (activeProvider.models.some((m) => m.id === trimmed)) {
      setFeedbackMessage(`模型 ${trimmed} 已在当前列表中`)
      setNewModelId('')
      return
    }

    const updatedModels: ProviderModelItem[] = [...activeProvider.models, { id: trimmed }]
    updateActiveProvider({
      models: updatedModels,
      defaultModel: activeProvider.defaultModel || trimmed
    })
    setNewModelId('')
    setFeedbackMessage(`已为【${activeProvider.name}】添加模型 ${trimmed}`)
  }

  /**
   * 为当前厂商移除模型
   */
  const handleRemoveModelFromActive = (modelIdToRemove: string): void => {
    if (!activeProvider) return
    if (activeProvider.models.length <= 1) {
      setFeedbackMessage('每个服务商至少保留一个可用模型')
      return
    }

    const updatedModels = activeProvider.models.filter((m) => m.id !== modelIdToRemove)
    const newDefault =
      activeProvider.defaultModel === modelIdToRemove
        ? updatedModels[0].id
        : activeProvider.defaultModel

    updateActiveProvider({
      models: updatedModels,
      defaultModel: newDefault
    })
  }

  /**
   * 测试当前正在查看的厂商连通性
   */
  const handleTestCurrentProvider = async (): Promise<void> => {
    if (!activeProvider) return
    setIsTesting(true)
    setTestResult(null)
    setFeedbackMessage('')

    try {
      const result = await window.api.testConfig({
        activeProviderId: activeProvider.id,
        activeModelId: activeProvider.defaultModel || activeProvider.models[0]?.id,
        providers
      })
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
   * 保存所有服务商配置
   */
  const handleSaveAll = async (): Promise<void> => {
    setIsSaving(true)
    setFeedbackMessage('')

    try {
      const payload: LLMConfig = {
        activeProviderId: activeTabId,
        activeModelId: activeProvider?.defaultModel || activeProvider?.models[0]?.id,
        providers
      }

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

  return (
    <div className="pref-root">
      {/* 顶部标题栏 */}
      <header className="pref-header">
        <div className="pref-header-title">
          <span className="pref-title-main">偏好设置</span>
          <span className="pref-title-sub">PREFERENCES // PROVIDER ARCHITECTURE</span>
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

      {/* 主体区 */}
      <main className="pref-body">
        {/* 顶部：厂商选项卡切换栏 */}
        <section className="pref-card" style={{ padding: '8px 12px 12px 12px' }}>
          <div className="pref-card-header" style={{ marginBottom: '8px' }}>
            <h2 className="pref-card-title">独立服务商管理 (PROVIDERS)</h2>
            <button
              type="button"
              className="pref-btn pref-btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={handleAddCustomProvider}
            >
              + 新建服务商
            </button>
          </div>

          {/* 选项卡行 */}
          <div className="pref-provider-tabs">
            {providers.map((p) => {
              const isSelected = p.id === activeTabId
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`pref-provider-tab ${isSelected ? 'pref-provider-tab-active' : ''} ${
                    !p.enabled ? 'pref-provider-tab-disabled' : ''
                  }`}
                  onClick={() => {
                    setActiveTabId(p.id)
                    setTestResult(null)
                  }}
                >
                  <span
                    className={`pref-provider-tab-dot ${p.enabled ? 'dot-enabled' : 'dot-disabled'}`}
                  />
                  <span className="pref-provider-tab-name">{p.name}</span>
                </button>
              )
            })}
          </div>

          {/* 快速快捷填入预设模板 */}
          <div className="pref-preset-row" style={{ marginTop: '10px' }}>
            <span className="pref-preset-tip">快捷添加：</span>
            <div className="pref-preset-chips">
              {PRESET_TEMPLATES.map((tmpl) => {
                const isAlreadyAdded = providers.some((p) => p.id === tmpl.id)
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    className="pref-preset-chip"
                    onClick={() => handleAddFromTemplate(tmpl)}
                    title={`添加或激活 ${tmpl.name}`}
                  >
                    {isAlreadyAdded ? `切换: ${tmpl.name}` : `+ ${tmpl.name}`}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* 当前厂商的专属配置面板 */}
        {activeProvider ? (
          <section className="pref-card">
            <div className="pref-card-header">
              <div className="pref-card-title-group">
                <h2 className="pref-card-title">
                  【{activeProvider.name}】专属连接配置
                </h2>
                <span className="pref-card-subtitle">
                  与其它厂商完全隔离，独立管理其专属地址与密钥
                </span>
              </div>

              {/* 启用/停用开关 */}
              <div
                className="pref-switch-inline"
                onClick={() => updateActiveProvider({ enabled: !activeProvider.enabled })}
                title="开启后该厂商的模型才会出现在主界面下拉框中"
              >
                <span style={{ fontSize: '11px', color: '#5a5247', marginRight: '6px' }}>
                  {activeProvider.enabled ? '已启用' : '已停用'}
                </span>
                <div className={`pref-switch ${activeProvider.enabled ? 'pref-switch-on' : ''}`}>
                  <div className="pref-switch-thumb" />
                </div>
              </div>
            </div>

            <div className="pref-fields-grid">
              {/* 厂商名称 */}
              <div className="pref-field">
                <div className="pref-label-row">
                  <label className="pref-label" htmlFor="prov-name">
                    服务商显示名称
                  </label>
                  {providers.length > 1 ? (
                    <button
                      type="button"
                      className="pref-text-btn"
                      style={{ color: '#d85c5c' }}
                      onClick={() => handleDeleteProvider(activeProvider.id)}
                    >
                      删除该服务商
                    </button>
                  ) : null}
                </div>
                <input
                  id="prov-name"
                  type="text"
                  className="pref-input"
                  value={activeProvider.name}
                  onChange={(e) => updateActiveProvider({ name: e.target.value })}
                  placeholder="如：DeepSeek 官方"
                  spellCheck={false}
                />
              </div>

              {/* 服务地址 (Base URL) */}
              <div className="pref-field">
                <label className="pref-label" htmlFor="prov-base-url">
                  服务地址 (Base URL)
                </label>
                <input
                  id="prov-base-url"
                  type="text"
                  className="pref-input"
                  value={activeProvider.baseUrl}
                  onChange={(e) => updateActiveProvider({ baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {/* 访问密钥 (API Key) */}
              <div className="pref-field">
                <div className="pref-label-row">
                  <label className="pref-label" htmlFor="prov-api-key">
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
                  id="prov-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  className="pref-input"
                  value={activeProvider.apiKey}
                  onChange={(e) => updateActiveProvider({ apiKey: e.target.value })}
                  placeholder="填入该服务商的 API Key..."
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {/* 该服务商的专属模型列表 */}
              <div className="pref-field">
                <label className="pref-label">
                  可用模型列表 (MODELS FOR {activeProvider.name.toUpperCase()})
                </label>
                <div className="pref-pills-wrap">
                  {activeProvider.models.map((m) => {
                    const isDefault = (activeProvider.defaultModel || activeProvider.models[0]?.id) === m.id
                    return (
                      <span
                        key={m.id}
                        className={`pref-pill ${isDefault ? 'pref-pill-active' : ''}`}
                        title={isDefault ? '当前厂商的默认模型' : '点击设为默认模型'}
                        onClick={() => updateActiveProvider({ defaultModel: m.id })}
                        style={{ cursor: 'pointer' }}
                      >
                        {isDefault ? (
                          <span style={{ fontSize: '9px', color: '#e06c3a', marginRight: '2px' }}>★</span>
                        ) : null}
                        <span className="pref-pill-name">{m.id}</span>
                        {activeProvider.models.length > 1 ? (
                          <button
                            type="button"
                            className="pref-pill-remove"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveModelFromActive(m.id)
                            }}
                            title={`移除 ${m.id}`}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    )
                  })}
                </div>

                {/* 增加模型 */}
                <div className="pref-add-row" style={{ marginTop: '6px' }}>
                  <input
                    type="text"
                    className="pref-input pref-add-input"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddModelToActive()
                      }
                    }}
                    placeholder={`添加模型至【${activeProvider.name}】...`}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="pref-btn pref-btn-secondary"
                    onClick={handleAddModelToActive}
                    disabled={!newModelId.trim()}
                  >
                    + 添加模型
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {/* 底部操作工具栏 */}
      <footer className="pref-footer">
        <div className="pref-footer-left">
          {activeProvider ? (
            <button
              type="button"
              className="pref-btn pref-btn-test"
              onClick={handleTestCurrentProvider}
              disabled={isTesting || !activeProvider.baseUrl || !activeProvider.apiKey}
              title={`测试【${activeProvider.name}】的连通性 (${activeProvider.baseUrl})`}
            >
              {isTesting ? '正在测试...' : '测试当前连接'}
            </button>
          ) : null}

          {/* 测试连通性结果反馈 */}
          {testResult ? (
            <span
              className={`pref-test-status ${
                testResult.ok ? 'pref-test-status-ok' : 'pref-test-status-fail'
              }`}
              title={`${testResult.message}${testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ''}`}
            >
              <span className="pref-status-dot" />
              <span className="pref-test-status-text">
                {testResult.message}
                {testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ''}
              </span>
            </span>
          ) : null}

          {feedbackMessage ? (
            <span className="pref-feedback-text" title={feedbackMessage}>
              {feedbackMessage}
            </span>
          ) : null}
        </div>

        <div className="pref-footer-right">
          <button
            type="button"
            className="pref-btn pref-btn-cancel"
            onClick={() => void window.api.closeConfigWindow()}
          >
            取消
          </button>
          <button
            type="button"
            className="pref-btn pref-btn-save"
            onClick={handleSaveAll}
            disabled={isSaving}
          >
            {isSaving ? '正在保存...' : '保存所有设置'}
          </button>
        </div>
      </footer>
    </div>
  )
}
