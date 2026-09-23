import { useEffect, useState, useMemo } from 'react'
import type {
  LLMConfig,
  ProviderItem,
  ProviderModelItem,
  TestConnectionResult
} from '../../shared/config'

/**
 * 预设厂商模板定义
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
  // 服务商列表
  const [providers, setProviders] = useState<ProviderItem[]>([])
  // 当前正在查看/编辑的 Tab ID
  const [selectedTabId, setSelectedTabId] = useState<string>('deepseek')
  // 当前软件全局生效的主用服务商 ID
  const [activeProviderId, setActiveProviderId] = useState<string>('deepseek')

  // API Key 密码遮罩切换
  const [showApiKey, setShowApiKey] = useState(false)

  // 连通性测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  // 保存状态与消息提示
  const [isSaving, setIsSaving] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')

  // 当前厂商新加单模型输入框
  const [newModelId, setNewModelId] = useState('')

  // 一键拉取模型状态与弹窗
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [showFetchModal, setShowFetchModal] = useState(false)
  const [selectedModelsToAdd, setSelectedModelsToAdd] = useState<Record<string, boolean>>({})
  const [modelSearchQuery, setModelSearchQuery] = useState('')

  // 错误详情弹窗
  const [showErrorModal, setShowErrorModal] = useState(false)

  // 初始化加载全局配置
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
          const primaryId = matched ? (cfg.activeProviderId as string) : list[0].id
          setActiveProviderId(primaryId)
          setSelectedTabId(primaryId)
        }
      })
      .catch((error) => {
        console.error('[renderer] 读取服务商配置失败', error)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // 监听 ESC 键关闭窗口或弹窗
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (showFetchModal) {
          setShowFetchModal(false)
          return
        }
        if (showErrorModal) {
          setShowErrorModal(false)
          return
        }
        void window.api.closeConfigWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showFetchModal, showErrorModal])

  // 当前正在查看编辑的厂商
  const activeProvider = providers.find((p) => p.id === selectedTabId) || providers[0]

  /**
   * 自动清洗 Base URL
   */
  const cleanBaseUrl = (url: string): string => {
    return url
      .trim()
      .replace(/\/chat\/completions\/?$/, '')
      .replace(/\/$/, '')
  }

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
   * 显式将当前查看的厂商设为全局主用服务商
   */
  const handleSetAsPrimary = (): void => {
    if (!activeProvider) return
    setActiveProviderId(activeProvider.id)
    if (!activeProvider.enabled) {
      updateActiveProvider({ enabled: true })
    }
    setFeedbackMessage(`已将【${activeProvider.name}】设为全局主用服务商`)
  }

  /**
   * 从模板快速添加一个新服务商
   */
  const handleAddFromTemplate = (template: ProviderTemplate): void => {
    const exists = providers.some((p) => p.id === template.id)
    if (exists) {
      setSelectedTabId(template.id)
      setFeedbackMessage(`已定位至【${template.name}】`)
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
    setSelectedTabId(newProvider.id)
    setFeedbackMessage(`已添加服务商【${template.name}】，请配置对应 API Key`)
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
    setSelectedTabId(customId)
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

    if (selectedTabId === providerIdToDelete) {
      setSelectedTabId(nextList[0].id)
    }

    // 若删除的是主用服务商，自动将首项设为主用
    if (activeProviderId === providerIdToDelete) {
      setActiveProviderId(nextList[0].id)
    }

    setFeedbackMessage('已移除该服务商')
  }

  /**
   * 为当前厂商手动添加新模型
   */
  const handleAddModelToActive = (): void => {
    if (!activeProvider) return
    const trimmed = newModelId.trim()
    if (!trimmed) return

    if (activeProvider.models.some((m) => m.id === trimmed)) {
      setFeedbackMessage(`模型 ${trimmed} 已在列表中`)
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
   * 自动从服务商端点拉取模型列表
   */
  const handleFetchModels = async (): Promise<void> => {
    if (!activeProvider) return
    const targetUrl = cleanBaseUrl(activeProvider.baseUrl)
    if (!targetUrl) {
      setFeedbackMessage('请先输入有效的服务地址 (Base URL)')
      return
    }

    setIsFetchingModels(true)
    setFeedbackMessage('正在从服务商接口拉取模型列表...')

    try {
      const result = await window.api.fetchModels({
        baseUrl: targetUrl,
        apiKey: activeProvider.apiKey.trim()
      })

      if (result.ok && Array.isArray(result.models) && result.models.length > 0) {
        setFetchedModels(result.models)
        // 默认勾选尚未添加进当前模型库的模型
        const initialSelection: Record<string, boolean> = {}
        const existingIds = new Set(activeProvider.models.map((m) => m.id))
        result.models.forEach((mId) => {
          if (!existingIds.has(mId)) {
            initialSelection[mId] = true
          }
        })
        setSelectedModelsToAdd(initialSelection)
        setModelSearchQuery('')
        setShowFetchModal(true)
        setFeedbackMessage(`成功获取到 ${result.models.length} 个模型`)
      } else {
        setFeedbackMessage(`拉取模型失败: ${result.error || '未返回有效模型'}`)
        if (result.errorDetail) {
          setTestResult({
            ok: false,
            message: `拉取模型失败: ${result.error || '请求异常'}`,
            errorDetail: result.errorDetail
          })
        }
      }
    } catch (err) {
      setFeedbackMessage(`拉取异常: ${err instanceof Error ? err.message : '网络错误'}`)
    } finally {
      setIsFetchingModels(false)
    }
  }

  /**
   * 批量将勾选的模型添加入当前厂商
   */
  const handleConfirmAddFetchedModels = (): void => {
    if (!activeProvider) return
    const idsToAdd = Object.keys(selectedModelsToAdd).filter((id) => selectedModelsToAdd[id])
    if (idsToAdd.length === 0) {
      setShowFetchModal(false)
      return
    }

    const existingIds = new Set(activeProvider.models.map((m) => m.id))
    const newItems: ProviderModelItem[] = idsToAdd
      .filter((id) => !existingIds.has(id))
      .map((id) => ({ id }))

    if (newItems.length === 0) {
      setShowFetchModal(false)
      setFeedbackMessage('所选模型已全部存在于列表中')
      return
    }

    const updated = [...activeProvider.models, ...newItems]
    updateActiveProvider({
      models: updated,
      defaultModel: activeProvider.defaultModel || newItems[0].id
    })
    setShowFetchModal(false)
    setFeedbackMessage(`已成功为【${activeProvider.name}】添加 ${newItems.length} 个模型`)
  }

  /**
   * 复制 API Key 到剪贴板
   */
  const handleCopyApiKey = async (): Promise<void> => {
    if (!activeProvider?.apiKey) {
      setFeedbackMessage('当前 API Key 为空，无需复制')
      return
    }
    try {
      await navigator.clipboard.writeText(activeProvider.apiKey)
      setFeedbackMessage('API Key 已复制到剪贴板')
    } catch {
      setFeedbackMessage('复制失败，请手动选取复制')
    }
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
      // 智能清洗当前厂商地址与密钥
      const sanitizedProviders = providers.map((p) => ({
        ...p,
        baseUrl: cleanBaseUrl(p.baseUrl),
        apiKey: p.apiKey.trim()
      }))

      const payload: LLMConfig = {
        activeProviderId: activeProviderId,
        activeModelId:
          sanitizedProviders.find((p) => p.id === activeProviderId)?.defaultModel ||
          sanitizedProviders.find((p) => p.id === activeProviderId)?.models[0]?.id,
        providers: sanitizedProviders
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

  // 尚未添加的预置模板
  const unaddedTemplates = useMemo(() => {
    return PRESET_TEMPLATES.filter((tmpl) => !providers.some((p) => p.id === tmpl.id))
  }, [providers])

  // 过滤拉取到的模型列表
  const filteredFetchedModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return fetchedModels
    const q = modelSearchQuery.toLowerCase()
    return fetchedModels.filter((m) => m.toLowerCase().includes(q))
  }, [fetchedModels, modelSearchQuery])

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
        {/* 顶部：服务商选项卡管理栏 */}
        <section className="pref-card" style={{ padding: '10px 14px 12px 14px' }}>
          <div className="pref-card-header" style={{ marginBottom: '8px' }}>
            <div className="pref-header-with-badge">
              <h2 className="pref-card-title">独立服务商管理 (PROVIDERS)</h2>
              <span className="pref-provider-count-tip">已配置 {providers.length} 个渠道</span>
            </div>
            <button
              type="button"
              className="pref-btn pref-btn-secondary"
              style={{ fontSize: '11px', padding: '3px 9px' }}
              onClick={handleAddCustomProvider}
            >
              + 新建服务商
            </button>
          </div>

          {/* 选项卡列表 */}
          <div className="pref-provider-tabs">
            {providers.map((p) => {
              const isSelected = p.id === selectedTabId
              const isPrimary = p.id === activeProviderId
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`pref-provider-tab ${isSelected ? 'pref-provider-tab-active' : ''} ${
                    !p.enabled ? 'pref-provider-tab-disabled' : ''
                  }`}
                  onClick={() => {
                    setSelectedTabId(p.id)
                    setTestResult(null)
                  }}
                  title={isPrimary ? '当前全局生效的主用服务商' : '点击查看与编辑此服务商'}
                >
                  <span
                    className={`pref-provider-tab-dot ${p.enabled ? 'dot-enabled' : 'dot-disabled'}`}
                  />
                  <span className="pref-provider-tab-name">{p.name}</span>
                  {isPrimary ? <span className="pref-primary-indicator">主用</span> : null}
                </button>
              )
            })}
          </div>

          {/* 快捷添加预置模板（仅在有未添加模板时展示，彻底消除冗余） */}
          <div className="pref-preset-row">
            {unaddedTemplates.length > 0 ? (
              <>
                <span className="pref-preset-tip">快捷添加预置：</span>
                <div className="pref-preset-chips">
                  {unaddedTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      type="button"
                      className="pref-preset-chip"
                      onClick={() => handleAddFromTemplate(tmpl)}
                      title={`快捷配置【${tmpl.name}】`}
                    >
                      + {tmpl.name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="pref-preset-tip-dim">
                ✓ 官方预设服务商模板已全部加入列表，可通过上方【+ 新建服务商】增加自定义渠道
              </span>
            )}
          </div>
        </section>

        {/* 当前选中厂商的专属配置面板 */}
        {activeProvider ? (
          <section className="pref-card">
            <div className="pref-card-header">
              <div className="pref-card-title-group">
                <div className="pref-title-with-actions">
                  <h2 className="pref-card-title">【{activeProvider.name}】专属连接配置</h2>
                  {activeProvider.id === activeProviderId ? (
                    <span className="pref-badge-primary">★ 全局主用服务商</span>
                  ) : (
                    <button
                      type="button"
                      className="pref-btn-set-primary"
                      onClick={handleSetAsPrimary}
                      title="点击设为主界面默认使用的大模型渠道"
                    >
                      设为主用
                    </button>
                  )}
                </div>
                <span className="pref-card-subtitle">
                  与其它厂商完全隔离，独立管理其专属地址、密钥与模型库
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
                  onBlur={(e) => {
                    const cleaned = cleanBaseUrl(e.target.value)
                    if (cleaned !== e.target.value) {
                      updateActiveProvider({ baseUrl: cleaned })
                    }
                  }}
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
                  <div className="pref-field-actions">
                    {activeProvider.apiKey ? (
                      <>
                        <button
                          type="button"
                          className="pref-text-btn"
                          onClick={() => void handleCopyApiKey()}
                          title="复制 API Key 到剪贴板"
                        >
                          复制
                        </button>
                        <span className="pref-action-divider">|</span>
                        <button
                          type="button"
                          className="pref-text-btn"
                          onClick={() => updateActiveProvider({ apiKey: '' })}
                          title="清空当前输入的密钥"
                        >
                          清空
                        </button>
                        <span className="pref-action-divider">|</span>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="pref-text-btn"
                      onClick={() => setShowApiKey((prev) => !prev)}
                    >
                      {showApiKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>
                <input
                  id="prov-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  className="pref-input"
                  value={activeProvider.apiKey}
                  onChange={(e) => updateActiveProvider({ apiKey: e.target.value })}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim()
                    if (trimmed !== e.target.value) {
                      updateActiveProvider({ apiKey: trimmed })
                    }
                  }}
                  placeholder="填入该服务商的 API Key..."
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {/* 该服务商的专属模型列表 */}
              <div className="pref-field">
                <div className="pref-label-row">
                  <label className="pref-label">
                    可用模型列表 (MODELS FOR {activeProvider.name.toUpperCase()})
                  </label>
                  <button
                    type="button"
                    className="pref-btn-fetch"
                    onClick={() => void handleFetchModels()}
                    disabled={isFetchingModels || !activeProvider.baseUrl}
                    title="从接口端点自动获取该服务商支持的全部模型"
                  >
                    {isFetchingModels ? '正在拉取...' : '⚡ 自动获取模型列表'}
                  </button>
                </div>

                <div className="pref-pills-wrap">
                  {activeProvider.models.map((m) => {
                    const isDefault =
                      (activeProvider.defaultModel || activeProvider.models[0]?.id) === m.id
                    return (
                      <span
                        key={m.id}
                        className={`pref-pill ${isDefault ? 'pref-pill-active' : ''}`}
                        title={isDefault ? '当前默认模型' : '点击设为默认模型'}
                        onClick={() => updateActiveProvider({ defaultModel: m.id })}
                        style={{ cursor: 'pointer' }}
                      >
                        {isDefault ? (
                          <span style={{ fontSize: '9px', color: '#e06c3a', marginRight: '2px' }}>
                            ★
                          </span>
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

                {/* 手动追加模型 */}
                <div className="pref-add-row" style={{ marginTop: '8px' }}>
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
                    placeholder={`手动添加模型 ID 至【${activeProvider.name}】...`}
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
              disabled={isTesting || !activeProvider.baseUrl}
              title={`测试【${activeProvider.name}】的连通性 (${activeProvider.baseUrl})`}
            >
              {isTesting ? '正在测试...' : '测试当前连接'}
            </button>
          ) : null}

          {/* 测试连通性结果反馈 */}
          {testResult ? (
            <div className="pref-test-result-group">
              <span
                className={`pref-test-status ${
                  testResult.ok ? 'pref-test-status-ok' : 'pref-test-status-fail'
                }`}
                title={testResult.message}
              >
                <span className="pref-status-dot" />
                <span className="pref-test-status-text">
                  {testResult.message}
                  {testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ''}
                </span>
              </span>

              {/* 报错详情入口 */}
              {!testResult.ok && testResult.errorDetail ? (
                <button
                  type="button"
                  className="pref-btn-error-detail"
                  onClick={() => setShowErrorModal(true)}
                  title="查看详细错误信息与原始响应"
                >
                  查看详情
                </button>
              ) : null}
            </div>
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

      {/* 自动拉取模型列表对话框 */}
      {showFetchModal ? (
        <div className="pref-modal-mask" onClick={() => setShowFetchModal(false)}>
          <div className="pref-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pref-modal-header">
              <div className="pref-modal-title">
                <span>从【{activeProvider?.name}】获取模型</span>
                <span className="pref-modal-badge">{fetchedModels.length} 个模型</span>
              </div>
              <button
                type="button"
                className="pref-modal-close"
                onClick={() => setShowFetchModal(false)}
              >
                ×
              </button>
            </div>

            <div className="pref-modal-filter-row">
              <input
                type="text"
                className="pref-input pref-modal-search"
                placeholder="搜索模型名称过滤..."
                value={modelSearchQuery}
                onChange={(e) => setModelSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="pref-modal-quick-select">
                <button
                  type="button"
                  className="pref-text-btn"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    const existing = new Set(activeProvider?.models.map((m) => m.id))
                    filteredFetchedModels.forEach((id) => {
                      if (!existing.has(id)) next[id] = true
                    })
                    setSelectedModelsToAdd(next)
                  }}
                >
                  全选未添加
                </button>
                <span className="pref-action-divider">|</span>
                <button
                  type="button"
                  className="pref-text-btn"
                  onClick={() => setSelectedModelsToAdd({})}
                >
                  取消全选
                </button>
              </div>
            </div>

            <div className="pref-modal-model-list">
              {filteredFetchedModels.length === 0 ? (
                <div className="pref-modal-empty">无匹配的模型</div>
              ) : (
                filteredFetchedModels.map((mId) => {
                  const alreadyInList = activeProvider?.models.some((m) => m.id === mId)
                  const isChecked = Boolean(selectedModelsToAdd[mId])
                  return (
                    <label
                      key={mId}
                      className={`pref-modal-model-item ${alreadyInList ? 'item-already-added' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={alreadyInList || isChecked}
                        disabled={alreadyInList}
                        onChange={(e) => {
                          setSelectedModelsToAdd((prev) => ({
                            ...prev,
                            [mId]: e.target.checked
                          }))
                        }}
                      />
                      <span className="pref-modal-model-id">{mId}</span>
                      {alreadyInList ? <span className="pref-modal-item-tag">已在列表</span> : null}
                    </label>
                  )
                })
              )}
            </div>

            <div className="pref-modal-footer">
              <span className="pref-modal-selected-tip">
                已选中{' '}
                {Object.keys(selectedModelsToAdd).filter((k) => selectedModelsToAdd[k]).length}{' '}
                个新模型
              </span>
              <div className="pref-modal-footer-btns">
                <button
                  type="button"
                  className="pref-btn pref-btn-cancel"
                  onClick={() => setShowFetchModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="pref-btn pref-btn-save"
                  onClick={handleConfirmAddFetchedModels}
                >
                  确认导入勾选模型
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 连通性测试报错详情弹窗 */}
      {showErrorModal && testResult?.errorDetail ? (
        <div className="pref-modal-mask" onClick={() => setShowErrorModal(false)}>
          <div
            className="pref-modal-card pref-modal-card-error"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pref-modal-header">
              <div className="pref-modal-title" style={{ color: '#d85c5c' }}>
                <span>连通性诊断报告</span>
              </div>
              <button
                type="button"
                className="pref-modal-close"
                onClick={() => setShowErrorModal(false)}
              >
                ×
              </button>
            </div>

            <div className="pref-modal-error-content">
              <div className="pref-error-meta-row">
                <span className="pref-error-meta-label">测试服务商：</span>
                <span className="pref-error-meta-val">{activeProvider?.name}</span>
              </div>
              <div className="pref-error-meta-row">
                <span className="pref-error-meta-label">接口地址：</span>
                <span className="pref-error-meta-val">{activeProvider?.baseUrl}</span>
              </div>
              <div className="pref-error-meta-row">
                <span className="pref-error-meta-label">错误概要：</span>
                <span className="pref-error-meta-val" style={{ color: '#d85c5c' }}>
                  {testResult.message}
                </span>
              </div>

              <div className="pref-error-body-title">服务端原始响应体 / 异常堆栈：</div>
              <pre className="pref-error-body-pre">{testResult.errorDetail}</pre>
            </div>

            <div className="pref-modal-footer">
              <button
                type="button"
                className="pref-btn pref-btn-secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(testResult.errorDetail || '')
                  setFeedbackMessage('错误日志已复制')
                }}
              >
                复制错误日志
              </button>
              <button
                type="button"
                className="pref-btn pref-btn-cancel"
                onClick={() => setShowErrorModal(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
