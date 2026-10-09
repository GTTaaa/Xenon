import { useEffect, useState, useMemo, useRef } from 'react'
import type {
  AppSettings,
  GeneralSettings,
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
import { SUPPORTED_LANGUAGES } from '../../shared/languageDetector'
import { useSmoothHorizontalScroll } from './utils/useSmoothHorizontalScroll'

/**
 * 偏好设置一级分类菜单定义
 */
type PrefNavCategory = 'providers' | 'shortcuts' | 'translation' | 'general'

interface NavItem {
  id: PrefNavCategory
  title: string
  subtitle: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'providers', title: 'AI 模型', subtitle: 'PROVIDERS & MODELS' },
  { id: 'shortcuts', title: '快捷键', subtitle: 'GLOBAL SHORTCUTS' },
  { id: 'translation', title: '翻译偏好', subtitle: 'TRANSLATE BEHAVIOR' },
  { id: 'general', title: '通用设置', subtitle: 'SYSTEM & LAUNCH' }
]

/**
 * 偏好设置外观主题风格类型
 */
type PrefTheme = 'wise' | 'classic'

interface ThemeOption {
  id: PrefTheme
  label: string
}

const PREF_THEMES: ThemeOption[] = [
  { id: 'classic', label: '设备原色' },
  { id: 'wise', label: 'Wise 先锋绿' }
]

/**
 * 主题偏好的本地持久化键。
 * 旧键 xenon_pref_theme 跨越了 glass / linear / macos / wise 几代主题体系，
 * 里面残留的 Wise 选择会盖住新的默认值，所以升级键名并清掉旧键。
 */
const THEME_STORAGE_KEY = 'xenon_pref_theme_v2'
const LEGACY_THEME_STORAGE_KEY = 'xenon_pref_theme'

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
  // 当前处于的左侧分类
  const [activeCategory, setActiveCategory] = useState<PrefNavCategory>('providers')

  // 偏好设置外观风格：默认 Wise 先锋绿，支持本地持久化
  const [prefTheme, setPrefTheme] = useState<PrefTheme>(() => {
    try {
      // 旧键的历史值不再沿用，读取时顺手清掉
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
      const saved = localStorage.getItem(THEME_STORAGE_KEY)
      if (saved === 'wise' || saved === 'classic') {
        return saved
      }
    } catch {
      // 忽略存储读取异常
    }
    return 'wise'
  })

  // 风格切换处理函数
  const handleSelectTheme = (theme: PrefTheme): void => {
    setPrefTheme(theme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // 忽略存储写入异常
    }
  }

  // 服务商列表
  const [providers, setProviders] = useState<ProviderItem[]>([])
  // 当前正在查看/编辑的 Tab ID
  const [selectedTabId, setSelectedTabId] = useState<string>('deepseek')
  // 当前软件全局生效的主用服务商 ID
  const [activeProviderId, setActiveProviderId] = useState<string>('deepseek')

  // 全局快捷键设置
  const [shortcuts, setShortcuts] = useState<ShortcutSettings>({ ...DEFAULT_SHORTCUTS })

  // 翻译偏好设置
  const [translation, setTranslation] = useState<TranslationSettings>({
    ...DEFAULT_TRANSLATION_SETTINGS
  })

  // 通用系统设置
  const [general, setGeneral] = useState<GeneralSettings>({ ...DEFAULT_GENERAL_SETTINGS })

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

  // 错误详情弹窗与复制反馈
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [copiedErrorLog, setCopiedErrorLog] = useState(false)

  // 添加服务商下拉菜单控制
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement | null>(null)

  // 手动录入单模型展开状态（默认收起以释放纵向空间）
  const [showManualAdd, setShowManualAdd] = useState(false)

  // 渠道横向滑轨丝滑手势交互管理器（触控板原生高帧率放行、鼠标滚轮阻尼平滑、按住抓取拖拽）
  const { containerRef: providerTabsRef } = useSmoothHorizontalScroll<HTMLDivElement>({
    activeItemId: selectedTabId,
    lerpFactor: 0.22,
    enableDrag: true
  })

  // 点击外部自动收起添加服务商下拉菜单
  useEffect(() => {
    if (!showAddMenu) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu])

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

        if (cfg.shortcuts) {
          setShortcuts({ ...cfg.shortcuts })
        }
        if (cfg.translation) {
          setTranslation({ ...cfg.translation })
        }
        if (cfg.general) {
          setGeneral({ ...cfg.general })
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
   * 显式将当前查看的厂商设为全局默认服务商
   */
  const handleSetAsPrimary = (): void => {
    if (!activeProvider) return
    setActiveProviderId(activeProvider.id)
    if (!activeProvider.enabled) {
      updateActiveProvider({ enabled: true })
    }
    setFeedbackMessage(`已将【${activeProvider.name}】设为默认服务商`)
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
   * 格式化模型名称显示：支持拆分组织前缀与核心模型名，提升长模型名的排版可读性
   */
  const formatModelDisplay = (id: string): { prefix: string; name: string } => {
    const slashIndex = id.indexOf('/')
    if (slashIndex !== -1) {
      return {
        prefix: id.slice(0, slashIndex + 1),
        name: id.slice(slashIndex + 1)
      }
    }
    return { prefix: '', name: id }
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
        providers,
        shortcuts,
        translation,
        general
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
   * 保存所有系统偏好设置
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

      const payload: AppSettings = {
        activeProviderId: activeProviderId,
        activeModelId:
          sanitizedProviders.find((p) => p.id === activeProviderId)?.defaultModel ||
          sanitizedProviders.find((p) => p.id === activeProviderId)?.models[0]?.id,
        providers: sanitizedProviders,
        shortcuts,
        translation,
        general
      }

      const result = await window.api.saveConfig(payload)
      if (result.ok) {
        setFeedbackMessage('系统偏好设置已保存并生效')
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
    <div className="pref-root" data-pref-theme={prefTheme}>
      {/* 顶部栏：一级分类导航（药丸式切换）+ 主题切换 + 关闭 */}
      <header className="pref-header">
        <nav className="pref-topnav" aria-label="偏好设置分类">
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === activeCategory
            return (
              <button
                key={item.id}
                type="button"
                className={`pref-topnav-tab ${isActive ? 'pref-topnav-tab-active' : ''}`}
                onClick={() => setActiveCategory(item.id)}
              >
                {item.title}
              </button>
            )
          })}
        </nav>

        {/* 顶部右侧：主题风格实时切换器与关闭按钮 */}
        <div className="pref-header-actions">
          <div className="pref-theme-switcher" role="group" aria-label="主题风格实时切换">
            {PREF_THEMES.map((theme) => {
              const isActive = prefTheme === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`pref-theme-btn ${isActive ? 'pref-theme-btn-active' : ''}`}
                  onClick={() => handleSelectTheme(theme.id)}
                  title={`切换为 ${theme.label} 视觉风格`}
                >
                  {theme.label}
                </button>
              )
            })}
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
        </div>
      </header>

      {/* 左右双栏主体布局 */}
      <div className="pref-layout-split">
        {/* 核心内容面板：一级分类已上移到顶部导航 */}
        <main className="pref-main-content">
          {/* ===================== 分类 1: AI 模型 (Providers) ===================== */}
          {activeCategory === 'providers' && (
            <div className="pref-panel-fade">
              {/* 顶部：服务商切换与管理栏（扁平化无框集成，释放纵向空间） */}
              <div className="pref-provider-bar">
                <div className="pref-provider-tabs-row">
                  {/* 滑轨视口包一层，才能在两端叠溢出提示阴影 */}
                  <div className="pref-provider-tabs-viewport">
                    <div className="pref-provider-tabs" ref={providerTabsRef}>
                      {providers.map((p) => {
                        const isSelected = p.id === selectedTabId
                        const isPrimary = p.id === activeProviderId
                        return (
                          <button
                            key={p.id}
                            type="button"
                            data-item-id={p.id}
                            className={`pref-provider-tab ${isSelected ? 'pref-provider-tab-active' : ''} ${
                              !p.enabled ? 'pref-provider-tab-disabled' : ''
                            }`}
                            onClick={() => {
                              setSelectedTabId(p.id)
                              setTestResult(null)
                            }}
                            title={
                              isPrimary ? '当前全局生效的默认服务商' : '点击查看与编辑此服务商'
                            }
                          >
                            <span
                              className={`pref-provider-tab-dot ${p.enabled ? 'dot-enabled' : 'dot-disabled'}`}
                            />
                            <span className="pref-provider-tab-name">{p.name}</span>
                            {isPrimary ? (
                              <span className="pref-primary-indicator">默认</span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* 整合 + 新建与预设导入的下拉选择器 */}
                  <div className="pref-add-dropdown-container" ref={addMenuRef}>
                    <button
                      type="button"
                      className={`pref-btn-add-provider ${showAddMenu ? 'pref-btn-add-active' : ''}`}
                      onClick={() => setShowAddMenu((prev) => !prev)}
                      title="添加服务商（自定义或从官方预置快速导入）"
                    >
                      <span>+ 添加渠道</span>
                      <span className="pref-dropdown-arrow">{showAddMenu ? '▴' : '▾'}</span>
                    </button>

                    {showAddMenu ? (
                      <div className="pref-add-menu">
                        <button
                          type="button"
                          className="pref-add-menu-item"
                          onClick={() => {
                            setShowAddMenu(false)
                            handleAddCustomProvider()
                          }}
                        >
                          <span className="pref-menu-item-icon">+</span>
                          <span>自定义空白服务商</span>
                        </button>

                        {unaddedTemplates.length > 0 ? (
                          <>
                            <div className="pref-add-menu-divider" />
                            <div className="pref-add-menu-label">从官方预置快速导入：</div>
                            {unaddedTemplates.map((tmpl) => (
                              <button
                                key={tmpl.id}
                                type="button"
                                className="pref-add-menu-item"
                                onClick={() => {
                                  setShowAddMenu(false)
                                  handleAddFromTemplate(tmpl)
                                }}
                              >
                                <span className="pref-menu-item-bullet">•</span>
                                <span>{tmpl.name}</span>
                              </button>
                            ))}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* 当前选中厂商的核心连接配置面板 */}
              {activeProvider ? (
                <section className="pref-card pref-provider-active-card">
                  <div className="pref-card-header">
                    <div className="pref-title-with-actions">
                      <h2 className="pref-card-title">{activeProvider.name}</h2>
                      {activeProvider.id !== activeProviderId ? (
                        <button
                          type="button"
                          className="pref-field-btn pref-field-btn-primary"
                          onClick={handleSetAsPrimary}
                          title="点击设为主界面默认使用的大模型渠道"
                        >
                          设为默认服务商
                        </button>
                      ) : null}
                    </div>

                    {/* 启用/停用开关 */}
                    <div
                      className="pref-switch-inline"
                      onClick={() => updateActiveProvider({ enabled: !activeProvider.enabled })}
                      title="开启后该厂商的模型才会出现在主界面下拉框中"
                    >
                      <span className="pref-switch-label">
                        {activeProvider.enabled ? '已启用' : '已停用'}
                      </span>
                      <div
                        className={`pref-switch ${activeProvider.enabled ? 'pref-switch-on' : ''}`}
                      >
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
                          <div className="pref-field-actions">
                            <button
                              type="button"
                              className="pref-field-btn pref-field-btn-danger"
                              onClick={() => handleDeleteProvider(activeProvider.id)}
                            >
                              删除该服务商
                            </button>
                          </div>
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
                                className="pref-field-btn"
                                onClick={() => void handleCopyApiKey()}
                                title="复制 API Key 到剪贴板"
                              >
                                复制
                              </button>
                              <button
                                type="button"
                                className="pref-field-btn"
                                onClick={() => updateActiveProvider({ apiKey: '' })}
                                title="清空当前输入的密钥"
                              >
                                清空
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className={`pref-field-btn ${showApiKey ? 'pref-field-btn-active' : ''}`}
                            onClick={() => setShowApiKey((prev) => !prev)}
                            title={showApiKey ? '点击以掩码形式隐藏密钥' : '点击查看明文密钥'}
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

                    {/* 可用模型列表 */}
                    <div className="pref-field">
                      <div className="pref-label-row">
                        <label className="pref-label">
                          可用模型列表 (MODELS FOR {activeProvider.name.toUpperCase()})
                        </label>
                        <div className="pref-field-actions">
                          <button
                            type="button"
                            className="pref-field-btn pref-field-btn-primary"
                            onClick={() => void handleFetchModels()}
                            disabled={isFetchingModels || !activeProvider.baseUrl}
                            title="从接口端点自动获取该服务商支持的全部模型"
                          >
                            {isFetchingModels ? '正在拉取...' : '自动获取模型列表'}
                          </button>
                        </div>
                      </div>

                      <div className="pref-pills-wrap">
                        {activeProvider.models.map((m) => {
                          const isDefault =
                            (activeProvider.defaultModel || activeProvider.models[0]?.id) === m.id
                          const { prefix, name } = formatModelDisplay(m.id)
                          return (
                            <span
                              key={m.id}
                              className={`pref-pill ${isDefault ? 'pref-pill-active' : ''}`}
                              title={
                                isDefault
                                  ? `当前渠道的默认模型: ${m.id}`
                                  : `点击将【${m.id}】设为默认模型`
                              }
                              onClick={() => updateActiveProvider({ defaultModel: m.id })}
                            >
                              {isDefault ? (
                                <span className="pref-pill-default-badge" title="默认模型">
                                  DEF
                                </span>
                              ) : null}
                              <span className="pref-pill-name">
                                {prefix ? (
                                  <span className="pref-pill-prefix" title={m.id}>
                                    {prefix}
                                  </span>
                                ) : null}
                                <span className="pref-pill-main-name">{name}</span>
                              </span>
                              {activeProvider.models.length > 1 ? (
                                <button
                                  type="button"
                                  className="pref-pill-remove"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleRemoveModelFromActive(m.id)
                                  }}
                                  title={`从列表中移除 ${m.id}`}
                                  aria-label={`移除 ${m.id}`}
                                >
                                  <svg
                                    width="8"
                                    height="8"
                                    viewBox="0 0 8 8"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="pref-pill-remove-icon"
                                  >
                                    <path
                                      d="M1 1L7 7M7 1L1 7"
                                      stroke="currentColor"
                                      strokeWidth="1.3"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                </button>
                              ) : null}
                            </span>
                          )
                        })}

                        {/* 手动录入触发按键（以紧凑虚线微胶囊呈现，平时不占大行） */}
                        <button
                          type="button"
                          className="pref-pill-btn-add"
                          onClick={() => setShowManualAdd((prev) => !prev)}
                          title="手动录入单个自定义模型 ID"
                        >
                          {showManualAdd ? '取消录入' : '+ 手动录入'}
                        </button>
                      </div>

                      {/* 手动追加模型输入栏（仅在点击手动录入时展开） */}
                      {showManualAdd ? (
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
                            placeholder="输入模型 ID（如 gpt-4o、claude-3-5-sonnet...）"
                            spellCheck={false}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="pref-field-btn pref-field-btn-primary"
                            onClick={handleAddModelToActive}
                            disabled={!newModelId.trim()}
                          >
                            + 保存模型
                          </button>
                          <button
                            type="button"
                            className="pref-field-btn"
                            onClick={() => {
                              setNewModelId('')
                              setShowManualAdd(false)
                            }}
                          >
                            收起
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          )}

          {/* ===================== 分类 2: 快捷键 (Shortcuts) ===================== */}
          {activeCategory === 'shortcuts' && (
            <div className="pref-panel-fade">
              <section className="pref-card">
                <div className="pref-card-header">
                  <div className="pref-card-title-group">
                    <h2 className="pref-card-title">全局呼出快捷键 (GLOBAL SHORTCUTS)</h2>
                    <span className="pref-card-subtitle">
                      在任何应用或前台全屏状态下，均可使用全局组合键呼出翻译功能
                    </span>
                  </div>
                  <button
                    type="button"
                    className="pref-btn pref-btn-secondary"
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                    onClick={() => {
                      setShortcuts({ ...DEFAULT_SHORTCUTS })
                      setFeedbackMessage('快捷键已重置为默认值')
                    }}
                  >
                    恢复默认快捷键
                  </button>
                </div>

                <div className="pref-fields-grid" style={{ marginTop: '6px' }}>
                  {/* 截屏翻译 */}
                  <div className="pref-field">
                    <div className="pref-label-row">
                      <label className="pref-label" htmlFor="sc-screenshot">
                        截屏识别翻译
                      </label>
                      <span className="pref-shortcut-tip">推荐: Alt+S 或 Option+S</span>
                    </div>
                    <div className="pref-shortcut-input-group">
                      <input
                        id="sc-screenshot"
                        type="text"
                        className="pref-input"
                        value={shortcuts.screenshot}
                        onChange={(e) =>
                          setShortcuts((prev) => ({ ...prev, screenshot: e.target.value.trim() }))
                        }
                        placeholder="例如: Alt+S 或 CommandOrControl+Shift+S"
                        spellCheck={false}
                      />
                      <div className="pref-quick-chips">
                        {['Alt+S', 'CommandOrControl+Shift+S', 'Alt+Shift+S'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="pref-preset-chip"
                            onClick={() =>
                              setShortcuts((prev) => ({ ...prev, screenshot: preset }))
                            }
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 输入翻译 */}
                  <div className="pref-field">
                    <div className="pref-label-row">
                      <label className="pref-label" htmlFor="sc-input">
                        呼出输入翻译窗口
                      </label>
                      <span className="pref-shortcut-tip">推荐: Alt+A 或 Option+A</span>
                    </div>
                    <div className="pref-shortcut-input-group">
                      <input
                        id="sc-input"
                        type="text"
                        className="pref-input"
                        value={shortcuts.inputTranslate}
                        onChange={(e) =>
                          setShortcuts((prev) => ({
                            ...prev,
                            inputTranslate: e.target.value.trim()
                          }))
                        }
                        placeholder="例如: Alt+A 或 CommandOrControl+Shift+A"
                        spellCheck={false}
                      />
                      <div className="pref-quick-chips">
                        {['Alt+A', 'CommandOrControl+Shift+A', 'Alt+Space'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="pref-preset-chip"
                            onClick={() =>
                              setShortcuts((prev) => ({ ...prev, inputTranslate: preset }))
                            }
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 偏好设置窗口 */}
                  <div className="pref-field">
                    <div className="pref-label-row">
                      <label className="pref-label" htmlFor="sc-pref">
                        打开偏好设置
                      </label>
                      <span className="pref-shortcut-tip">通用规范: CommandOrControl+,</span>
                    </div>
                    <input
                      id="sc-pref"
                      type="text"
                      className="pref-input"
                      value={shortcuts.openPreferences}
                      onChange={(e) =>
                        setShortcuts((prev) => ({
                          ...prev,
                          openPreferences: e.target.value.trim()
                        }))
                      }
                      placeholder="CommandOrControl+,"
                      spellCheck={false}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ===================== 分类 3: 翻译偏好 (Translation) ===================== */}
          {activeCategory === 'translation' && (
            <div className="pref-panel-fade">
              <section className="pref-card">
                <div className="pref-card-header">
                  <div className="pref-card-title-group">
                    <h2 className="pref-card-title">翻译与交互行为 (TRANSLATION BEHAVIOR)</h2>
                    <span className="pref-card-subtitle">
                      定制默认目标语言、自动剪贴板同步及大模型提示词微调
                    </span>
                  </div>
                </div>

                <div className="pref-fields-grid" style={{ marginTop: '6px' }}>
                  {/* 默认目标语言 */}
                  <div className="pref-field">
                    <label className="pref-label" htmlFor="pref-target-lang">
                      默认翻译目标语言
                    </label>
                    <select
                      id="pref-target-lang"
                      className="pref-input pref-select"
                      value={translation.defaultTargetLanguage}
                      onChange={(e) =>
                        setTranslation((prev) => ({
                          ...prev,
                          defaultTargetLanguage: e.target.value
                        }))
                      }
                    >
                      {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label} ({lang.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 自动复制结果到剪贴板 */}
                  <div
                    className="pref-switch-row"
                    onClick={() =>
                      setTranslation((prev) => ({ ...prev, autoCopyResult: !prev.autoCopyResult }))
                    }
                  >
                    <div className="pref-switch-desc">
                      <span className="pref-switch-name">翻译成功后自动复制到剪贴板</span>
                      <span className="pref-switch-sub">
                        开启后，截屏翻译或文本翻译完成时自动将目标译文写入系统剪贴板，无需手动点击复制
                      </span>
                    </div>
                    <div
                      className={`pref-switch ${translation.autoCopyResult ? 'pref-switch-on' : ''}`}
                    >
                      <div className="pref-switch-thumb" />
                    </div>
                  </div>

                  {/* 默认启用深度思考推理 */}
                  <div
                    className="pref-switch-row"
                    onClick={() =>
                      setTranslation((prev) => ({
                        ...prev,
                        defaultEnableThinking: !prev.defaultEnableThinking
                      }))
                    }
                  >
                    <div className="pref-switch-desc">
                      <span className="pref-switch-name">默认开启深度思考推理模式 (Thinking)</span>
                      <span className="pref-switch-sub">
                        若模型支持（如 DeepSeek-R1 /
                        QwQ），将开启深度逻辑链思考，译文更考究但在响应上略有延迟
                      </span>
                    </div>
                    <div
                      className={`pref-switch ${translation.defaultEnableThinking ? 'pref-switch-on' : ''}`}
                    >
                      <div className="pref-switch-thumb" />
                    </div>
                  </div>

                  {/* 自定义翻译系统提示词 */}
                  <div className="pref-field" style={{ marginTop: '4px' }}>
                    <div className="pref-label-row">
                      <label className="pref-label" htmlFor="pref-prompt">
                        自定义系统提示词 (SYSTEM PROMPT)
                      </label>
                      {translation.customSystemPrompt ? (
                        <div className="pref-field-actions">
                          <button
                            type="button"
                            className="pref-field-btn"
                            onClick={() =>
                              setTranslation((prev) => ({ ...prev, customSystemPrompt: '' }))
                            }
                          >
                            恢复内置提示词
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <textarea
                      id="pref-prompt"
                      className="pref-textarea"
                      rows={4}
                      value={translation.customSystemPrompt || ''}
                      onChange={(e) =>
                        setTranslation((prev) => ({ ...prev, customSystemPrompt: e.target.value }))
                      }
                      placeholder="留空时默认采用系统精密格式保留与纯净翻译指令；您也可输入如：'你是一名专业学术翻译专家，请将文本翻译为学术级专业术语，仅输出译文。'"
                      spellCheck={false}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ===================== 分类 4: 通用设置 (General) ===================== */}
          {activeCategory === 'general' && (
            <div className="pref-panel-fade">
              <section className="pref-card">
                <div className="pref-card-header">
                  <div className="pref-card-title-group">
                    <h2 className="pref-card-title">系统与窗口行为 (SYSTEM & WINDOW)</h2>
                    <span className="pref-card-subtitle">
                      管理开机自动启动、主窗口悬浮层级与托盘驻留策略
                    </span>
                  </div>
                </div>

                <div className="pref-fields-grid" style={{ marginTop: '6px' }}>
                  {/* 开机自动启动 */}
                  <div
                    className="pref-switch-row"
                    onClick={() =>
                      setGeneral((prev) => ({ ...prev, launchAtLogin: !prev.launchAtLogin }))
                    }
                  >
                    <div className="pref-switch-desc">
                      <span className="pref-switch-name">开机自动启动 (Launch at Startup)</span>
                      <span className="pref-switch-sub">
                        随系统登录自动启动并在后台托盘静默就绪，随时按下快捷键即可调用
                      </span>
                    </div>
                    <div className={`pref-switch ${general.launchAtLogin ? 'pref-switch-on' : ''}`}>
                      <div className="pref-switch-thumb" />
                    </div>
                  </div>

                  {/* 主窗口默认置顶 */}
                  <div
                    className="pref-switch-row"
                    onClick={() =>
                      setGeneral((prev) => ({ ...prev, alwaysOnTop: !prev.alwaysOnTop }))
                    }
                  >
                    <div className="pref-switch-desc">
                      <span className="pref-switch-name">主翻译窗口始终保持置顶</span>
                      <span className="pref-switch-sub">
                        开启后主掌机窗口浮动在所有应用程序之上，也可随时点击主界面右上角图钉按钮临时切换
                      </span>
                    </div>
                    <div className={`pref-switch ${general.alwaysOnTop ? 'pref-switch-on' : ''}`}>
                      <div className="pref-switch-thumb" />
                    </div>
                  </div>

                  {/* 关闭主窗口时的行为 */}
                  <div className="pref-field" style={{ marginTop: '4px' }}>
                    <label className="pref-label">点击主窗口右上角关闭按钮时：</label>
                    <div className="pref-radio-group">
                      <label className="pref-radio-item">
                        <input
                          type="radio"
                          name="closeAction"
                          checked={general.closeAction === 'tray'}
                          onChange={() => setGeneral((prev) => ({ ...prev, closeAction: 'tray' }))}
                        />
                        <span>最小化隐藏到系统托盘（推荐，保持快捷键随时可用）</span>
                      </label>
                      <label className="pref-radio-item">
                        <input
                          type="radio"
                          name="closeAction"
                          checked={general.closeAction === 'quit'}
                          onChange={() => setGeneral((prev) => ({ ...prev, closeAction: 'quit' }))}
                        />
                        <span>彻底退出应用程序</span>
                      </label>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* 底部操作工具栏 */}
      <footer className="pref-footer">
        <div className="pref-footer-left">
          {/* 只有在 AI 模型面板才展示连通性测试按钮 */}
          {activeCategory === 'providers' && activeProvider ? (
            <button
              type="button"
              className="pref-btn pref-btn-test"
              onClick={handleTestCurrentProvider}
              disabled={isTesting || !activeProvider.baseUrl}
              title={`测试【${activeProvider.name}】的连通性 (${activeProvider.baseUrl})`}
            >
              {isTesting ? (
                <span className="pref-btn-testing-wrap">
                  <span className="pref-loading-pulse" />
                  <span>正在检测...</span>
                </span>
              ) : (
                '测试当前连接'
              )}
            </button>
          ) : null}

          {/* 测试连通性结果反馈 */}
          {activeCategory === 'providers' && testResult ? (
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
                  className="pref-field-btn pref-field-btn-danger pref-test-detail-btn"
                  onClick={() => {
                    setCopiedErrorLog(false)
                    setShowErrorModal(true)
                  }}
                  title="查看详细错误信息与原始响应"
                >
                  诊断报告
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
                <span className="pref-modal-status-dot" />
                <span>从【{activeProvider?.name}】获取模型</span>
                <span className="pref-modal-badge">{fetchedModels.length} 个可用模型</span>
              </div>
              <button
                type="button"
                className="pref-modal-close"
                onClick={() => setShowFetchModal(false)}
                title="关闭窗口"
                aria-label="关闭"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="pref-modal-filter-row">
              <input
                type="text"
                className="pref-input pref-modal-search"
                placeholder="搜索模型名称实时过滤..."
                value={modelSearchQuery}
                onChange={(e) => setModelSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="pref-modal-quick-select pref-field-actions">
                <button
                  type="button"
                  className="pref-field-btn"
                  onClick={() => {
                    const next: Record<string, boolean> = { ...selectedModelsToAdd }
                    const existing = new Set(activeProvider?.models.map((m) => m.id))
                    filteredFetchedModels.forEach((id) => {
                      if (!existing.has(id)) next[id] = true
                    })
                    setSelectedModelsToAdd(next)
                  }}
                  title="全选当前过滤列表中尚未添加的模型"
                >
                  全选未添加
                </button>
                <button
                  type="button"
                  className="pref-field-btn"
                  onClick={() => setSelectedModelsToAdd({})}
                  title="清空所有勾选项"
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
                      className={`pref-modal-model-item ${
                        alreadyInList ? 'item-already-added' : isChecked ? 'item-selected' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="pref-modal-checkbox"
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
                      {alreadyInList ? (
                        <span className="pref-modal-item-tag tag-added">已在列表</span>
                      ) : isChecked ? (
                        <span className="pref-modal-item-tag tag-new">待导入</span>
                      ) : null}
                    </label>
                  )
                })
              )}
            </div>

            <div className="pref-modal-footer">
              <div className="pref-modal-footer-left">
                {(() => {
                  const count = Object.keys(selectedModelsToAdd).filter(
                    (k) => selectedModelsToAdd[k]
                  ).length
                  return (
                    <span
                      className={`pref-modal-selected-badge ${
                        count > 0 ? 'selected-badge-active' : ''
                      }`}
                    >
                      已选中 {count} 个新模型
                    </span>
                  )
                })()}
              </div>
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
                  disabled={
                    Object.keys(selectedModelsToAdd).filter((k) => selectedModelsToAdd[k])
                      .length === 0
                  }
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
              <div className="pref-modal-title pref-modal-title-error">
                <span className="pref-diagnostic-indicator" />
                <span>连通性诊断报告</span>
              </div>
              <button
                type="button"
                className="pref-modal-close"
                onClick={() => setShowErrorModal(false)}
                title="关闭诊断报告"
                aria-label="关闭"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="pref-modal-error-content">
              <div className="pref-error-meta-card">
                <div className="pref-error-meta-row">
                  <span className="pref-error-meta-label">测试服务商</span>
                  <span className="pref-error-meta-val">{activeProvider?.name}</span>
                </div>
                <div className="pref-error-meta-row">
                  <span className="pref-error-meta-label">接口端点</span>
                  <span className="pref-error-meta-val">{activeProvider?.baseUrl}</span>
                </div>
                <div className="pref-error-meta-row">
                  <span className="pref-error-meta-label">状态概要</span>
                  <span className="pref-error-meta-val pref-error-highlight">
                    {testResult.message}
                  </span>
                </div>
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
                  setCopiedErrorLog(true)
                  setTimeout(() => setCopiedErrorLog(false), 2000)
                }}
              >
                {copiedErrorLog ? '已复制到剪贴板' : '复制诊断日志'}
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
