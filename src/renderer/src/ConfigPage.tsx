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
import deepseekLogo from './assets/brands/deepseek.svg'
import clineLogo from './assets/brands/cline.svg'

/**
 * 偏好设置一级分类菜单定义
 */
type PrefNavCategory = 'providers' | 'shortcuts' | 'translation' | 'general'

interface NavItem {
  id: PrefNavCategory
  title: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'providers', title: 'AI 模型' },
  { id: 'shortcuts', title: '快捷键' },
  { id: 'translation', title: '翻译偏好' },
  { id: 'general', title: '通用设置' }
]

/**
 * 偏好设置外观主题风格类型。
 * 运行时的主题切换入口已移除，设置弹窗固定使用 Wise 先锋绿，
 * 保留类型是为了将来恢复「设备原色」外观时不用重新推导字面量。
 */
type PrefTheme = 'wise' | 'classic'

/**
 * 页脚反馈消息的语义分档：
 * success 走绿色并在 3 秒后自动退场；error 走红色、neutral 走灰色，两者常驻到下一次操作。
 */
type FeedbackTone = 'success' | 'error' | 'neutral'

interface FeedbackMessage {
  text: string
  tone: FeedbackTone
}

const PREF_THEME: PrefTheme = 'wise'

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

/**
 * 单个服务商的品牌标识定义
 */
interface ProviderBrand {
  /** 品牌图形资源地址（构建时由 Vite 处理成内联 data URI） */
  src: string
  /**
   * 图幅是否为横向图形。
   * 横向图形等比缩进同一方格后视觉高度只有一半左右（如 DeepSeek 鲸鱼），
   * 需要单独加宽补回视觉重量，否则和方形图标放在一起会显得小一圈。
   */
  wide?: boolean
}

/**
 * 服务商品牌标识映射：按 provider.id 在代码内匹配，不写进用户配置文件。
 * 这样老用户配置无需迁移，自定义服务商没有命中时自动退回纯文字，不占位、不留空白。
 */
const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  deepseek: { src: deepseekLogo, wide: true },
  cline: { src: clineLogo }
}

/**
 * 服务商列表分组定义：按启用状态分段，未启用的一律排在后面。
 * 服务商变多时，分组比单一顺序更容易一眼找到停用的那个。
 */
const PROVIDER_GROUPS = [
  { key: 'on', title: '已启用' },
  { key: 'off', title: '未启用' }
] as const

/**
 * 服务商品牌标识渲染组件。
 * 未命中品牌的厂商不渲染任何节点，调用处布局会自动退回纯文字形态。
 */
const ProviderBrandLogo = ({ providerId }: { providerId: string }): React.JSX.Element | null => {
  const brand = PROVIDER_BRANDS[providerId]
  if (!brand) return null
  return (
    <img
      className={`pref-brand-logo ${brand.wide ? 'pref-brand-logo-wide' : ''}`.trim()}
      src={brand.src}
      alt=""
      aria-hidden="true"
    />
  )
}

const PRESET_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3 对话' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1 深度推理' }
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

/**
 * 挑选接手默认渠道的服务商：优先仍然启用的，全都被停用时才退回首项。
 * 直接取列表首项会挑到"未启用"分组里的渠道，导致主界面翻译不可用。
 */
const pickNextPrimaryProvider = (list: ProviderItem[]): ProviderItem | undefined =>
  list.find((p) => p.enabled) ?? list[0]

/**
 * 组装连通性测试结果的悬浮提示，把测速细节（首 token 延迟、输出 token 数、总耗时）一并展示
 */
const buildTestResultTooltip = (result: TestConnectionResult): string => {
  if (!result.ok) {
    return result.errorDetail ? `${result.message}（点击“诊断报告”查看详情）` : result.message
  }

  const details: string[] = []
  if (typeof result.firstTokenMs === 'number')
    details.push(`首 token 延迟 ${result.firstTokenMs}ms`)
  if (typeof result.outputTokens === 'number') {
    details.push(`本次输出 ${result.speedEstimated ? '约 ' : ''}${result.outputTokens} 个 token`)
  }
  if (typeof result.latencyMs === 'number') details.push(`总耗时 ${result.latencyMs}ms`)

  if (details.length === 0) return result.message
  return `${result.message}\n${details.join(' · ')}`
}

/**
 * 从失败信息里提取极简提示，供紧凑结果胶囊使用（例如「连接失败 (404)」）
 *
 * 优先取括号里的三位状态码；没有状态码时退化为按关键词判断超时与鉴权问题。
 */
const extractFailureHint = (message: string): string => {
  const statusMatch = message.match(/[(（](\d{3})[)）]/)
  if (statusMatch) return `(${statusMatch[1]})`
  if (message.includes('超时')) return '(超时)'
  if (message.includes('鉴权')) return '(鉴权失败)'
  return ''
}

export const ConfigPage = (): React.JSX.Element => {
  // 当前处于的左侧分类
  const [activeCategory, setActiveCategory] = useState<PrefNavCategory>('providers')

  // 服务商列表
  const [providers, setProviders] = useState<ProviderItem[]>([])
  // 当前正在查看/编辑的 Tab ID
  const [selectedTabId, setSelectedTabId] = useState<string>('deepseek')
  // 服务商编辑弹窗是否展开（点击列表行打开，关闭后回到列表）
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false)
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
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null)

  // 是否存在未保存改动（由数据快照比对得出，用于页脚提示与关窗二次确认）
  const [isDirty, setIsDirty] = useState(false)
  // 上次落盘（或初始加载）时的数据快照，null 表示配置尚未加载完成
  const dirtyBaselineRef = useRef<string | null>(null)
  // 有未保存改动时点关闭/取消，先弹确认而不是静默丢弃
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  // 待确认删除的服务商 ID：非 null 即弹出删除二次确认层
  const [pendingDeleteProviderId, setPendingDeleteProviderId] = useState<string | null>(null)

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

  /**
   * 写入页脚反馈消息。
   * 默认按"成功"处理；错误与警告必须显式传 tone，避免失败信息被当成绿色成功态。
   */
  const showFeedback = (text: string, tone: FeedbackTone = 'success'): void => {
    setFeedbackMessage({ text, tone })
  }

  // 成功类消息看一眼就够，3 秒后自行退场；错误与中性提示常驻，避免用户没看清就消失
  useEffect(() => {
    if (feedbackMessage?.tone !== 'success') return
    const timer = window.setTimeout(() => setFeedbackMessage(null), 3000)
    return () => window.clearTimeout(timer)
  }, [feedbackMessage])

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

  /**
   * 关闭设置窗口。
   * 存在未保存改动时先弹确认，避免"点取消/按 ESC"静默丢掉刚才编辑的内容。
   */
  const requestCloseConfigWindow = (): void => {
    if (isDirty) {
      setShowCloseConfirm(true)
      return
    }
    void window.api.closeConfigWindow()
  }

  // 快照比对得出"是否有未保存改动"：不依赖逐个改动手动标记，避免漏点。
  // 只比对真正写进配置文件的那几个字段，弹窗开合、密钥显隐这类纯界面状态不参与。
  useEffect(() => {
    const snapshot = JSON.stringify({
      providers,
      activeProviderId,
      shortcuts,
      translation,
      general
    })
    if (dirtyBaselineRef.current === null) {
      // 首次加载完成前没有可比对的基线，等拿到服务商数据再建立
      if (providers.length === 0) return
      dirtyBaselineRef.current = snapshot
      return
    }
    setIsDirty(snapshot !== dirtyBaselineRef.current)
  }, [providers, activeProviderId, shortcuts, translation, general])

  // 监听 ESC 键关闭窗口或弹窗
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (pendingDeleteProviderId !== null) {
          setPendingDeleteProviderId(null)
          return
        }
        if (showFetchModal) {
          setShowFetchModal(false)
          return
        }
        if (showErrorModal) {
          setShowErrorModal(false)
          return
        }
        // 确认弹窗上的 ESC 等同于"继续编辑"，只是把确认收起来
        if (showCloseConfirm) {
          setShowCloseConfirm(false)
          return
        }
        if (isProviderDialogOpen) {
          setIsProviderDialogOpen(false)
          return
        }
        if (isDirty) {
          setShowCloseConfirm(true)
          return
        }
        void window.api.closeConfigWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    pendingDeleteProviderId,
    showFetchModal,
    showErrorModal,
    showCloseConfirm,
    isProviderDialogOpen,
    isDirty
  ])

  // 当前正在查看编辑的厂商
  const activeProvider = providers.find((p) => p.id === selectedTabId) || providers[0]

  // 删除确认弹窗的目标服务商
  const pendingDeleteProvider = providers.find((p) => p.id === pendingDeleteProviderId)
  // 删除后接手默认渠道的候选：与 handleDeleteProvider 共用同一套挑选策略
  const nextPrimaryProvider = pickNextPrimaryProvider(
    pendingDeleteProvider ? providers.filter((p) => p.id !== pendingDeleteProvider.id) : []
  )

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
   * 切换指定服务商的启用状态（服务商卡片上的快捷开关，无需先选中）
   */
  const handleToggleProviderEnabled = (providerId: string): void => {
    setProviders((prev) =>
      prev.map((item) => (item.id === providerId ? { ...item, enabled: !item.enabled } : item))
    )
    setTestResult(null)
  }

  /**
   * 把指定服务商设为全局默认（列表行内快捷操作，不需要先打开弹窗）。
   * 顺带确保它是启用状态，否则设成默认也不会出现在主界面下拉框里。
   */
  const handleSetProviderPrimary = (providerId: string): void => {
    const target = providers.find((p) => p.id === providerId)
    if (!target) return
    setProviders((prev) =>
      prev.map((item) => (item.id === providerId ? { ...item, enabled: true } : item))
    )
    setActiveProviderId(providerId)
    showFeedback(`已将【${target.name}】设为默认服务商`)
  }

  /**
   * 打开某个服务商的编辑弹窗
   */
  const openProviderDialog = (providerId: string): void => {
    setSelectedTabId(providerId)
    setTestResult(null)
    // 每次打开都回到干净的表单态：收起手动录入、模型 ID 置空、密钥强制掩码
    setShowManualAdd(false)
    setNewModelId('')
    setShowApiKey(false)
    setIsProviderDialogOpen(true)
  }

  /**
   * 从模板快速添加一个新服务商
   */
  const handleAddFromTemplate = (template: ProviderTemplate): void => {
    const exists = providers.some((p) => p.id === template.id)
    if (exists) {
      setSelectedTabId(template.id)
      showFeedback(`已定位至【${template.name}】`)
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
    showFeedback(`已添加【${template.name}】，请配置 API Key`)
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
    showFeedback('已创建服务商，请填写名称与 API Key')
  }

  /**
   * 删除某个厂商
   */
  const handleDeleteProvider = (providerIdToDelete: string): void => {
    if (providers.length <= 1) {
      showFeedback('至少需要保留一个服务商', 'error')
      return
    }

    const removedName = providers.find((p) => p.id === providerIdToDelete)?.name ?? '该服务商'
    const nextList = providers.filter((p) => p.id !== providerIdToDelete)
    const wasPrimary = activeProviderId === providerIdToDelete
    setProviders(nextList)

    if (selectedTabId === providerIdToDelete) {
      setSelectedTabId(nextList[0].id)
    }

    // 删除后接手默认渠道的候选
    const nextPrimary = pickNextPrimaryProvider(nextList)

    // 若删除的是主用服务商，把默认渠道交给候选者
    if (wasPrimary && nextPrimary) {
      setActiveProviderId(nextPrimary.id)
    }

    // 详情弹窗还停在被删掉的服务商上会跳到别的渠道，直接收起更符合预期
    setIsProviderDialogOpen(false)
    showFeedback(
      wasPrimary && nextPrimary
        ? `已删除【${removedName}】，主界面默认渠道已切到【${nextPrimary.name}】`
        : `已删除【${removedName}】`
    )
  }

  /**
   * 确认删除待删服务商。
   * 先收起确认层再执行删除，避免删除后残留一个指向已消失服务商的弹窗状态。
   */
  const confirmPendingDelete = (): void => {
    const targetId = pendingDeleteProviderId
    setPendingDeleteProviderId(null)
    if (!targetId) return
    handleDeleteProvider(targetId)
  }

  /**
   * 为当前厂商手动添加新模型
   */
  const handleAddModelToActive = (): void => {
    if (!activeProvider) return
    const trimmed = newModelId.trim()
    if (!trimmed) return

    if (activeProvider.models.some((m) => m.id === trimmed)) {
      showFeedback(`模型 ${trimmed} 已在列表中`, 'neutral')
      setNewModelId('')
      return
    }

    const updatedModels: ProviderModelItem[] = [...activeProvider.models, { id: trimmed }]
    updateActiveProvider({
      models: updatedModels,
      defaultModel: activeProvider.defaultModel || trimmed
    })
    setNewModelId('')
    showFeedback(`已为【${activeProvider.name}】添加模型 ${trimmed}`)
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
      showFeedback('每个服务商至少保留一个可用模型', 'error')
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
      showFeedback('请先输入有效的服务地址 (Base URL)', 'error')
      return
    }

    setIsFetchingModels(true)
    showFeedback('正在从服务商接口拉取模型列表...', 'neutral')

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
        showFeedback(`成功获取到 ${result.models.length} 个模型`)
      } else {
        showFeedback(`拉取模型失败: ${result.error || '未返回有效模型'}`, 'error')
        if (result.errorDetail) {
          setTestResult({
            ok: false,
            message: `拉取模型失败: ${result.error || '请求异常'}`,
            errorDetail: result.errorDetail
          })
        }
      }
    } catch (err) {
      showFeedback(`拉取异常: ${err instanceof Error ? err.message : '网络错误'}`, 'error')
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
      showFeedback('所选模型已全部存在于列表中', 'neutral')
      return
    }

    const updated = [...activeProvider.models, ...newItems]
    updateActiveProvider({
      models: updated,
      defaultModel: activeProvider.defaultModel || newItems[0].id
    })
    setShowFetchModal(false)
    showFeedback(`已成功为【${activeProvider.name}】添加 ${newItems.length} 个模型`)
  }

  /**
   * 复制 API Key 到剪贴板
   */
  const handleCopyApiKey = async (): Promise<void> => {
    if (!activeProvider?.apiKey) {
      showFeedback('当前 API Key 为空，无需复制', 'neutral')
      return
    }
    try {
      await navigator.clipboard.writeText(activeProvider.apiKey)
      showFeedback('API Key 已复制到剪贴板')
    } catch {
      showFeedback('复制失败，请手动选取复制', 'error')
    }
  }

  /**
   * 测试当前正在查看的厂商连通性
   */
  const handleTestCurrentProvider = async (): Promise<void> => {
    if (!activeProvider) return
    setIsTesting(true)
    setTestResult(null)
    setFeedbackMessage(null)

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
    setFeedbackMessage(null)

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
        // 已落盘：把当前数据记为新的基线，页脚的未保存提示随之消失
        dirtyBaselineRef.current = JSON.stringify({
          providers: sanitizedProviders,
          activeProviderId,
          shortcuts,
          translation,
          general
        })
        setIsDirty(false)
        // state 收敛为落盘时清洗过的数据，避免"基线是清洗值、state 是原始值"导致脏标记反复
        setProviders(sanitizedProviders)
        showFeedback('系统偏好设置已保存并生效')
        setTimeout(() => {
          void window.api.closeConfigWindow()
        }, 400)
      } else {
        showFeedback(`保存失败: ${result.error || '未知错误'}`, 'error')
      }
    } catch (error) {
      showFeedback(`保存异常: ${error instanceof Error ? error.message : '未知错误'}`, 'error')
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

  // 已启用的服务商数量，用于标题行统计文案
  const enabledProviderCount = useMemo(() => providers.filter((p) => p.enabled).length, [providers])

  // 失败时用于紧凑结果胶囊的简短提示，例如「(404)」
  const failureHint = testResult ? extractFailureHint(testResult.message) : ''

  return (
    <div className="pref-root" data-pref-theme={PREF_THEME}>
      {/* 顶部栏：一级分类导航（药丸式切换）+ 关闭 */}
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

        {/* 顶部右侧：关闭按钮 */}
        <div className="pref-header-actions">
          <button
            type="button"
            className="pref-close-btn"
            aria-label="关闭设置窗口"
            title="关闭设置 (ESC)"
            onClick={requestCloseConfigWindow}
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
                {/* 标题行：数量统计、翻页箭头与添加渠道入口 */}
                <div className="pref-provider-bar-head">
                  <span className="pref-provider-bar-title">选择服务商</span>
                  <div className="pref-provider-bar-tools">
                    <span className="pref-provider-count">
                      {providers.length} 个 · 已启用 {enabledProviderCount} 个
                    </span>
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
                                  {/* 有品牌图标的走图标，其余保留圆点占位，保证左侧文字对齐 */}
                                  {PROVIDER_BRANDS[tmpl.id] ? (
                                    <ProviderBrandLogo providerId={tmpl.id} />
                                  ) : (
                                    <span className="pref-menu-item-bullet">•</span>
                                  )}
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

                {/* 服务商列表：按启用状态分组，点击任意一行打开编辑弹窗 */}
                <div className="pref-provider-list">
                  {PROVIDER_GROUPS.map((group) => {
                    const items = providers.filter((p) =>
                      group.key === 'on' ? p.enabled : !p.enabled
                    )
                    if (items.length === 0) return null
                    return (
                      <div key={group.key} className="pref-provider-group">
                        <div className="pref-provider-group-title">
                          {group.title} · {items.length}
                        </div>
                        {items.map((p) => {
                          const isPrimary = p.id === activeProviderId
                          const modelText =
                            p.models.length > 0 ? p.defaultModel || p.models[0]?.id || '' : ''
                          return (
                            <div
                              key={p.id}
                              role="button"
                              tabIndex={0}
                              className="pref-provider-row"
                              onClick={() => openProviderDialog(p.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  openProviderDialog(p.id)
                                }
                              }}
                              title={isPrimary ? '当前全局生效的默认服务商' : `编辑 ${p.name}`}
                            >
                              <ProviderBrandLogo providerId={p.id} />
                              <span className="pref-provider-row-name">
                                {p.name}
                                {isPrimary ? (
                                  <span className="pref-primary-indicator">默认</span>
                                ) : null}
                              </span>
                              <span className="pref-provider-row-model">
                                {modelText || '未接入'}
                              </span>
                              <span className="pref-provider-row-count">
                                {p.models.length > 0 ? `· ${p.models.length} 个模型` : ''}
                              </span>
                              {isPrimary ? null : (
                                <button
                                  type="button"
                                  className="pref-field-btn pref-provider-row-action"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleSetProviderPrimary(p.id)
                                  }}
                                  title={`将 ${p.name} 设为主界面默认渠道`}
                                >
                                  设为默认
                                </button>
                              )}
                              <button
                                type="button"
                                className={`pref-switch ${p.enabled ? 'pref-switch-on' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleToggleProviderEnabled(p.id)
                                }}
                                title={p.enabled ? '停用该服务商' : '启用该服务商'}
                                aria-label={p.enabled ? `停用 ${p.name}` : `启用 ${p.name}`}
                              >
                                <span className="pref-switch-thumb" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ===================== 分类 2: 快捷键 (Shortcuts) ===================== */}
          {activeCategory === 'shortcuts' && (
            <div className="pref-panel-fade">
              <div className="pref-settings-bar">
                <div className="pref-settings-bar-head">
                  <span className="pref-settings-bar-title">全局呼出快捷键</span>
                  <div className="pref-settings-bar-tools">
                    <span className="pref-settings-count">3 项</span>
                    <button
                      type="button"
                      className="pref-settings-action"
                      onClick={() => {
                        setShortcuts({ ...DEFAULT_SHORTCUTS })
                        showFeedback('快捷键已重置为默认值')
                      }}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>

                <div className="pref-settings-group">
                  <div className="pref-settings-group-title">快捷键映射 · 3</div>
                  <div className="pref-settings-list">
                    {/* 截屏翻译 */}
                    <div className="pref-settings-row">
                      <div className="pref-settings-row-head">
                        <div className="pref-settings-copy">
                          <label className="pref-settings-name" htmlFor="sc-screenshot">
                            截屏识别翻译
                          </label>
                          <span className="pref-settings-sub">
                            框选屏幕区域，本地识别后直接生成译文
                          </span>
                        </div>
                        <span className="pref-shortcut-tip">推荐: Alt+S 或 Option+S</span>
                      </div>
                      <div className="pref-shortcut-input-group">
                        <input
                          id="sc-screenshot"
                          type="text"
                          className="pref-input pref-settings-input"
                          value={shortcuts.screenshot}
                          onChange={(e) =>
                            setShortcuts((prev) => ({
                              ...prev,
                              screenshot: e.target.value.trim()
                            }))
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
                    <div className="pref-settings-row">
                      <div className="pref-settings-row-head">
                        <div className="pref-settings-copy">
                          <label className="pref-settings-name" htmlFor="sc-input">
                            呼出输入翻译窗口
                          </label>
                          <span className="pref-settings-sub">
                            快速呼出输入框，粘贴或键入文本后立即翻译
                          </span>
                        </div>
                        <span className="pref-shortcut-tip">推荐: Alt+A 或 Option+A</span>
                      </div>
                      <div className="pref-shortcut-input-group">
                        <input
                          id="sc-input"
                          type="text"
                          className="pref-input pref-settings-input"
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
                    <div className="pref-settings-row">
                      <div className="pref-settings-row-head">
                        <div className="pref-settings-copy">
                          <label className="pref-settings-name" htmlFor="sc-pref">
                            打开偏好设置
                          </label>
                          <span className="pref-settings-sub">
                            打开当前窗口，调整模型、快捷键与翻译行为
                          </span>
                        </div>
                        <span className="pref-shortcut-tip">通用规范: CommandOrControl+,</span>
                      </div>
                      <input
                        id="sc-pref"
                        type="text"
                        className="pref-input pref-settings-input"
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
                </div>
              </div>
            </div>
          )}

          {/* ===================== 分类 3: 翻译偏好 (Translation) ===================== */}
          {activeCategory === 'translation' && (
            <div className="pref-panel-fade">
              <div className="pref-settings-bar">
                <div className="pref-settings-bar-head">
                  <span className="pref-settings-bar-title">翻译偏好</span>
                  <div className="pref-settings-bar-tools">
                    <span className="pref-settings-count">3 项</span>
                  </div>
                </div>

                <div className="pref-settings-group">
                  <div className="pref-settings-group-title">翻译行为 · 3</div>
                  <div className="pref-settings-list">
                    {/* 默认目标语言 */}
                    <div className="pref-settings-row pref-settings-row-inline">
                      <div className="pref-settings-copy">
                        <label className="pref-settings-name" htmlFor="pref-target-lang">
                          默认翻译目标语言
                        </label>
                        <span className="pref-settings-sub">
                          未识别源语言时，译文默认输出到该语言
                        </span>
                      </div>
                      <select
                        id="pref-target-lang"
                        className="pref-input pref-select pref-settings-select"
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
                      className="pref-settings-row pref-settings-row-inline pref-settings-switch-row"
                      onClick={() =>
                        setTranslation((prev) => ({
                          ...prev,
                          autoCopyResult: !prev.autoCopyResult
                        }))
                      }
                    >
                      <div className="pref-settings-copy">
                        <span className="pref-settings-name">翻译成功后自动复制到剪贴板</span>
                        <span className="pref-settings-sub">
                          截屏翻译或文本翻译完成时自动写入系统剪贴板，无需手动点击复制
                        </span>
                      </div>
                      <div
                        className={`pref-switch ${translation.autoCopyResult ? 'pref-switch-on' : ''}`}
                      >
                        <div className="pref-switch-thumb" />
                      </div>
                    </div>

                    {/* 自定义翻译系统提示词 */}
                    <div className="pref-settings-row">
                      <div className="pref-settings-row-head">
                        <div className="pref-settings-copy">
                          <label className="pref-settings-name" htmlFor="pref-prompt">
                            自定义系统提示词
                          </label>
                          <span className="pref-settings-sub">
                            留空时使用内置格式保留指令；仅影响翻译模型，不修改原始文本
                          </span>
                        </div>
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
                        className="pref-textarea pref-settings-textarea"
                        rows={4}
                        value={translation.customSystemPrompt || ''}
                        onChange={(e) =>
                          setTranslation((prev) => ({
                            ...prev,
                            customSystemPrompt: e.target.value
                          }))
                        }
                        placeholder="留空时默认采用系统精密格式保留与纯净翻译指令；您也可输入如：'你是一名专业学术翻译专家，请将文本翻译为学术级专业术语，仅输出译文。'"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===================== 分类 4: 通用设置 (General) ===================== */}
          {activeCategory === 'general' && (
            <div className="pref-panel-fade">
              <div className="pref-settings-bar">
                <div className="pref-settings-bar-head">
                  <span className="pref-settings-bar-title">通用设置</span>
                  <div className="pref-settings-bar-tools">
                    <span className="pref-settings-count">3 项</span>
                  </div>
                </div>

                <div className="pref-settings-group">
                  <div className="pref-settings-group-title">系统与窗口 · 3</div>
                  <div className="pref-settings-list">
                    {/* 开机自动启动 */}
                    <div
                      className="pref-settings-row pref-settings-row-inline pref-settings-switch-row"
                      onClick={() =>
                        setGeneral((prev) => ({ ...prev, launchAtLogin: !prev.launchAtLogin }))
                      }
                    >
                      <div className="pref-settings-copy">
                        <span className="pref-settings-name">开机自动启动</span>
                        <span className="pref-settings-sub">
                          随系统登录自动启动并在后台静默就绪，随时按下快捷键即可调用
                        </span>
                      </div>
                      <div
                        className={`pref-switch ${general.launchAtLogin ? 'pref-switch-on' : ''}`}
                      >
                        <div className="pref-switch-thumb" />
                      </div>
                    </div>

                    {/* 主窗口默认置顶 */}
                    <div
                      className="pref-settings-row pref-settings-row-inline pref-settings-switch-row"
                      onClick={() =>
                        setGeneral((prev) => ({ ...prev, alwaysOnTop: !prev.alwaysOnTop }))
                      }
                    >
                      <div className="pref-settings-copy">
                        <span className="pref-settings-name">主翻译窗口始终保持置顶</span>
                        <span className="pref-settings-sub">
                          浮动在所有应用程序之上，也可随时点击主界面右上角图钉按钮临时切换
                        </span>
                      </div>
                      <div className={`pref-switch ${general.alwaysOnTop ? 'pref-switch-on' : ''}`}>
                        <div className="pref-switch-thumb" />
                      </div>
                    </div>

                    {/* 关闭主窗口时的行为 */}
                    <div className="pref-settings-row">
                      <div className="pref-settings-copy">
                        <span className="pref-settings-name">关闭主窗口时</span>
                        <span className="pref-settings-sub">
                          决定点击主窗口右上角关闭按钮后的应用状态
                        </span>
                      </div>
                      <div className="pref-radio-group">
                        <label className="pref-radio-item">
                          <input
                            type="radio"
                            name="closeAction"
                            checked={general.closeAction === 'tray'}
                            onChange={() =>
                              setGeneral((prev) => ({ ...prev, closeAction: 'tray' }))
                            }
                          />
                          <span>最小化隐藏到系统托盘（推荐，保持快捷键随时可用）</span>
                        </label>
                        <label className="pref-radio-item">
                          <input
                            type="radio"
                            name="closeAction"
                            checked={general.closeAction === 'quit'}
                            onChange={() =>
                              setGeneral((prev) => ({ ...prev, closeAction: 'quit' }))
                            }
                          />
                          <span>彻底退出应用程序</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 底部操作工具栏 */}
      <footer className="pref-footer">
        <div className="pref-footer-left">
          {feedbackMessage ? (
            <span
              className={`pref-feedback-text pref-feedback-${feedbackMessage.tone}`}
              title={feedbackMessage.text}
            >
              {feedbackMessage.text}
            </span>
          ) : null}
        </div>

        <div className="pref-footer-right">
          {isDirty ? (
            <span className="pref-dirty-hint" title="本次修改还没有写入配置，点击右侧保存才会生效">
              <span className="pref-dirty-dot" />
              有未保存的改动
            </span>
          ) : null}
          <button
            type="button"
            className="pref-btn pref-btn-cancel"
            onClick={requestCloseConfigWindow}
          >
            取消
          </button>
          <button
            type="button"
            className="pref-btn pref-btn-save"
            onClick={handleSaveAll}
            disabled={isSaving}
          >
            {isSaving ? '正在保存...' : '保存'}
          </button>
        </div>
      </footer>

      {/* 服务商详情弹窗：点击列表行后弹出的居中编辑面板 */}
      {isProviderDialogOpen && activeProvider ? (
        <div className="pref-modal-mask" onClick={() => setIsProviderDialogOpen(false)}>
          <div
            className="pref-modal-card pref-provider-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pref-modal-header">
              <div className="pref-modal-title">
                <ProviderBrandLogo providerId={activeProvider.id} />
                <span className="pref-provider-dialog-name">{activeProvider.name}</span>
                {activeProvider.id === activeProviderId ? (
                  <span className="pref-modal-badge">默认服务商</span>
                ) : (
                  <button
                    type="button"
                    className="pref-field-btn pref-field-btn-primary"
                    onClick={() => handleSetProviderPrimary(activeProvider.id)}
                    title="点击设为主界面默认使用的大模型渠道"
                  >
                    设为默认服务商
                  </button>
                )}
              </div>
              <div className="pref-provider-dialog-tools">
                <div
                  className="pref-switch-inline"
                  onClick={() => updateActiveProvider({ enabled: !activeProvider.enabled })}
                  title="开启后该厂商的模型才会出现在主界面下拉框中"
                >
                  <span className="pref-switch-label">
                    {activeProvider.enabled ? '已启用' : '已停用'}
                  </span>
                  <div className={`pref-switch ${activeProvider.enabled ? 'pref-switch-on' : ''}`}>
                    <div className="pref-switch-thumb" />
                  </div>
                </div>
                <button
                  type="button"
                  className="pref-modal-close"
                  onClick={() => setIsProviderDialogOpen(false)}
                  title="关闭 (ESC)"
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
            </div>

            <div className="pref-modal-body pref-provider-dialog-body">
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
                          onClick={() => setPendingDeleteProviderId(activeProvider.id)}
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
            </div>

            <div className="pref-modal-footer">
              <div className="pref-modal-footer-left">
                {/* 连通性测试跟着当前编辑的服务商走：刚改完地址就能原地验证，不用先关弹窗 */}
                {isTesting ? (
                  <button type="button" className="pref-btn pref-btn-test" disabled>
                    <span className="pref-btn-testing-wrap">
                      <span className="pref-loading-pulse" />
                      <span>正在检测...</span>
                    </span>
                  </button>
                ) : testResult ? (
                  <>
                    {/* 测完按钮原地变成结果胶囊：状态、延迟、速度一行放完，点一下即重新测试 */}
                    <button
                      type="button"
                      className={`pref-test-result-pill ${
                        testResult.ok ? 'pref-test-result-pill-ok' : 'pref-test-result-pill-fail'
                      }`}
                      onClick={handleTestCurrentProvider}
                      disabled={!activeProvider.baseUrl}
                      title={`${buildTestResultTooltip(testResult)}\n点击重新测试`}
                    >
                      <span className="pref-status-dot" />
                      <span>
                        {testResult.ok ? '连接成功' : '连接失败'}
                        {!testResult.ok && failureHint ? ` ${failureHint}` : ''}
                      </span>

                      {/* 首 token 延迟：更接近用户感知的连接速度，总耗时放在悬浮提示里 */}
                      {testResult.ok && typeof testResult.firstTokenMs === 'number' ? (
                        <>
                          <span className="pref-test-result-sep">·</span>
                          <span>{testResult.firstTokenMs}ms</span>
                        </>
                      ) : null}

                      {/* 输出速度：服务端未返回 usage 时按估算值展示 */}
                      {testResult.ok && typeof testResult.tokensPerSecond === 'number' ? (
                        <>
                          <span className="pref-test-result-sep">·</span>
                          <span>
                            {testResult.speedEstimated ? '约 ' : ''}
                            {testResult.tokensPerSecond.toFixed(1)} token/s
                          </span>
                        </>
                      ) : null}
                    </button>

                    {/* 失败时保留诊断报告入口 */}
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
                  </>
                ) : (
                  <button
                    type="button"
                    className="pref-btn pref-btn-test"
                    onClick={handleTestCurrentProvider}
                    disabled={!activeProvider.baseUrl}
                    title={`测试【${activeProvider.name}】的连通性 (${activeProvider.baseUrl})`}
                  >
                    测试当前连接
                  </button>
                )}
              </div>

              <div className="pref-modal-footer-btns">
                <button
                  type="button"
                  className="pref-btn pref-btn-save"
                  onClick={() => setIsProviderDialogOpen(false)}
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

      {/* 删除服务商确认：删除不可逆，且可能顺带改掉主界面默认渠道，必须先确认 */}
      {pendingDeleteProvider ? (
        <div className="pref-modal-mask" onClick={() => setPendingDeleteProviderId(null)}>
          <div className="pref-modal-card pref-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="pref-modal-header">
              <div className="pref-modal-title">
                <span>删除服务商</span>
              </div>
            </div>

            <div className="pref-modal-body pref-confirm-body">
              <p className="pref-confirm-text">
                {`确定删除【${pendingDeleteProvider.name}】吗？该服务商下的 ${pendingDeleteProvider.models.length} 个模型配置会一并移除，此操作不可撤销。`}
              </p>
              {nextPrimaryProvider && pendingDeleteProviderId === activeProviderId ? (
                <p className="pref-confirm-text pref-confirm-warn">
                  {`它当前是主界面默认渠道，删除后默认渠道会自动切到【${nextPrimaryProvider.name}】。`}
                </p>
              ) : null}
            </div>

            <div className="pref-modal-footer">
              <div className="pref-modal-footer-left" />
              <div className="pref-modal-footer-btns">
                <button
                  type="button"
                  className="pref-btn pref-btn-cancel"
                  onClick={() => setPendingDeleteProviderId(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="pref-btn pref-btn-danger"
                  onClick={confirmPendingDelete}
                >
                  删除服务商
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 未保存改动确认弹窗：拦住"点关闭/取消"造成的静默丢弃 */}
      {showCloseConfirm ? (
        <div className="pref-modal-mask" onClick={() => setShowCloseConfirm(false)}>
          <div className="pref-modal-card pref-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="pref-modal-header">
              <div className="pref-modal-title">
                <span>有未保存的改动</span>
              </div>
            </div>

            <div className="pref-modal-body pref-confirm-body">
              <p className="pref-confirm-text">
                本次对服务商、快捷键或翻译偏好的修改还没有写入配置，现在关闭设置窗口会丢失这些改动。
              </p>
            </div>

            <div className="pref-modal-footer">
              <div className="pref-modal-footer-left" />
              <div className="pref-modal-footer-btns">
                <button
                  type="button"
                  className="pref-btn pref-btn-cancel"
                  onClick={() => void window.api.closeConfigWindow()}
                >
                  放弃改动并关闭
                </button>
                <button
                  type="button"
                  className="pref-btn pref-btn-save"
                  onClick={() => setShowCloseConfirm(false)}
                >
                  继续编辑
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
