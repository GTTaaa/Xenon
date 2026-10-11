import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import menuIcon from './assets/menu-icon.svg'
import pinIcon from './assets/pin-icon.svg'
import type { ProviderItem } from '../../shared/config'
import {
  detectLanguage,
  getLanguageInfo,
  resolveAutoTargetLanguage,
  resolvePromptLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage
} from '../../shared/languageDetector'

type TranslateStatus = 'idle' | 'translating' | 'error'

const INITIAL_SOURCE_TEXT = ''
const STATUS_TEXT_MAP: Record<TranslateStatus, string> = {
  idle: 'READY_V1.1',
  translating: 'TRANSLATING',
  error: 'ERROR'
}
const STATUS_DOT_CLASS_MAP: Record<TranslateStatus, string> = {
  idle: 'status-dot status-dot-idle',
  translating: 'status-dot status-dot-translating',
  error: 'status-dot status-dot-error'
}

const STATUS_VALUE_CLASS_MAP: Record<TranslateStatus, string> = {
  idle: 'status-value status-value-idle',
  translating: 'status-value status-value-translating',
  error: 'status-value status-value-error'
}

const getUserFriendlyErrorMessage = (code: string): string => {
  switch (code) {
    case 'CONFIG_MISSING_API_KEY':
      return '请先配置模型密钥'
    case 'CONFIG_MISSING_BASE_URL':
      return '请先配置模型服务地址'
    case 'HTTP_401':
      return '模型服务鉴权失败，请检查密钥'
    case 'HTTP_403':
      return '当前模型服务拒绝访问'
    case 'HTTP_429':
      return '请求过于频繁，请稍后再试'
    case 'NETWORK_ERROR':
      return '无法连接到模型服务'
    case 'EMPTY_RESPONSE':
      return '模型没有返回可用结果'
    default:
      return '翻译失败，请重试'
  }
}

/**
 * 挑选主界面当前使用的服务商。
 * 只在"已启用"的渠道里找：按候选 ID 顺序命中第一个匹配项，都没命中就取第一个启用的。
 * 一个启用的渠道都没有时返回 undefined，调用方据此清空选择 ——
 * 否则界面会继续显示一个已经停用的渠道和它的模型，点下去还会真的发请求。
 */
const pickActiveProvider = (
  list: ProviderItem[],
  preferredIds: Array<string | null | undefined>
): ProviderItem | undefined => {
  const enabled = list.filter((p) => p.enabled)
  for (const id of preferredIds) {
    if (!id) continue
    const hit = enabled.find((p) => p.id === id)
    if (hit) return hit
  }
  return enabled[0]
}

/**
 * 格式化界面显示的语言名称，去除多余繁杂括号
 */
function formatLanguageDisplay(code: SupportedLanguage): string {
  if (code === 'auto') return 'AUTO'
  if (code === 'zh') return 'CHINESE'
  return getLanguageInfo(code).promptName
}

function App(): React.JSX.Element {
  const [sourceText, setSourceText] = useState(INITIAL_SOURCE_TEXT)
  // const targetText = `你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。`
  // const [targetText, setTargetText] = useState('等待翻译结果...')
  const [targetText, setTargetText] = useState('')
  // const [statusText, setStatusText] = useState('READY_V1.1')
  const [status, setStatus] = useState<TranslateStatus>(
    INITIAL_SOURCE_TEXT.trim() ? 'translating' : 'idle'
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const requestIdRef = useRef(0)
  const sourceInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [providers, setProviders] = useState<ProviderItem[]>([])
  // 渠道与模型的初始值只认本地记忆值，读不到就留空 ——
  // 这里不再写 'deepseek' / 'deepseek-chat' 这类硬编码兜底：
  // 用户配置里未必有 deepseek 渠道，先显示一个不存在的模型名会误导人。
  // 真实取值由下面加载配置的 effect 补齐。
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    return localStorage.getItem('selectedProviderId') || ''
  })
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('selectedModel') || ''
  })
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  // 控制深色掌机面板真实 DOM 挂载生命周期（支持退出淡出动画，避免瞬间闪退）
  const [isDeckMounted, setIsDeckMounted] = useState(false)
  // 控制面板是否处于退出淡出状态
  const [isDeckClosing, setIsDeckClosing] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement | null>(null)
  const engineDeckRef = useRef<HTMLDivElement | null>(null)

  // 启用的服务商列表
  const enabledProviders = useMemo(() => {
    return providers.filter((p) => p.enabled)
  }, [providers])

  // 当前生效的服务商对象：只认已启用的渠道，一个都没启用时为 undefined
  const activeProvider = useMemo(
    () => enabledProviders.find((p) => p.id === selectedProviderId) || enabledProviders[0],
    [enabledProviders, selectedProviderId]
  )

  /**
   * 清空渠道与模型选择，并同步清掉本地记忆值。
   * 停在"没有任何启用渠道"的状态时用它，避免界面继续显示已经不可用的旧渠道。
   */
  const clearActiveProviderSelection = useCallback((): void => {
    setSelectedProviderId('')
    setSelectedModel('')
    localStorage.removeItem('selectedProviderId')
    localStorage.removeItem('selectedModel')
  }, [])

  // 用户指定的源语言（'auto' 表示自动识别）
  const [sourceLanguage, setSourceLanguage] = useState<SupportedLanguage>(() => {
    const saved = localStorage.getItem('sourceLanguage') as SupportedLanguage | null
    return saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved) ? saved : 'auto'
  })

  // 用户手动指定的目标语言（为 null 时跟随自动匹配）
  const [manualTargetLang, setManualTargetLang] = useState<SupportedLanguage | null>(() => {
    const saved = localStorage.getItem('targetLanguage') as SupportedLanguage | null
    return saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved && l.code !== 'auto')
      ? saved
      : null
  })

  // 窗口置顶状态
  const [isPinned, setIsPinned] = useState(false)
  // 自动复制结果引用（避免频繁闭包捕获）
  const autoCopyRef = useRef(false)

  useEffect(() => {
    window.api.getAlwaysOnTop().then(setIsPinned).catch(console.error)
  }, [])

  const handleTogglePin = async (): Promise<void> => {
    try {
      const nextState = await window.api.toggleAlwaysOnTop()
      setIsPinned(nextState)
    } catch (err) {
      console.error('[renderer] 切换窗口置顶失败', err)
    }
  }

  const [isSourceLangMenuOpen, setIsSourceLangMenuOpen] = useState(false)
  const [isTargetLangMenuOpen, setIsTargetLangMenuOpen] = useState(false)
  const sourceLangSelectorRef = useRef<HTMLDivElement | null>(null)
  const targetLangSelectorRef = useRef<HTMLDivElement | null>(null)
  const sourceRibbonTrackRef = useRef<HTMLDivElement | null>(null)
  const targetRibbonTrackRef = useRef<HTMLDivElement | null>(null)

  // 记录深色面板退出动画定时器
  const deckClosingTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 打开模型选择面板（立即挂载 DOM 并以纯 GPU 硬件加速滑入）
  const openModelMenu = useCallback((): void => {
    if (deckClosingTimerRef.current) {
      clearTimeout(deckClosingTimerRef.current)
      deckClosingTimerRef.current = null
    }
    setIsDeckMounted(true)
    setIsDeckClosing(false)
    setIsModelMenuOpen(true)
    setIsSourceLangMenuOpen(false)
    setIsTargetLangMenuOpen(false)
  }, [])

  // 关闭模型选择面板（触发 100ms 纯 GPU 淡出，完成后卸载 DOM）
  const closeModelMenu = useCallback((): void => {
    setIsDeckClosing(true)
    setIsModelMenuOpen(false)
    if (deckClosingTimerRef.current) {
      clearTimeout(deckClosingTimerRef.current)
    }
    deckClosingTimerRef.current = setTimeout(() => {
      setIsDeckMounted(false)
      setIsDeckClosing(false)
      deckClosingTimerRef.current = null
    }, 100)
  }, [])

  // 磁带滑轨展开时，自动平滑滚动使当前选中语言进入视窗中心
  useEffect(() => {
    if (!isSourceLangMenuOpen && !isTargetLangMenuOpen) return undefined
    const track = isSourceLangMenuOpen ? sourceRibbonTrackRef.current : targetRibbonTrackRef.current
    const timer = window.setTimeout(() => {
      const selectedEl = track?.querySelector('.tape-chip-selected')
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }, 50)
    return () => window.clearTimeout(timer)
  }, [isSourceLangMenuOpen, isTargetLangMenuOpen])

  // 横向滑轨鼠标滚轮自适应水平滚动（触控板横滑原生放行，纵向滚轮驱动横移）
  const handleRibbonWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    // 若横向位移占主导（触控板双指横滑），完全交由系统原生 120Hz 硬件加速物理管线处理
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      return
    }
    if (event.deltaY !== 0) {
      event.currentTarget.scrollLeft += event.deltaY
    }
  }

  // 毫秒级根据输入文本自动检测语言
  const detectedInfo = useMemo(() => {
    return detectLanguage(sourceText)
  }, [sourceText])

  // 计算当前实际生效的目标语言
  const effectiveTargetLang: SupportedLanguage = useMemo(() => {
    if (manualTargetLang) return manualTargetLang
    const autoTarget = resolveAutoTargetLanguage(detectedInfo.detected)
    if (sourceLanguage !== 'auto' && sourceLanguage === autoTarget) {
      return autoTarget === 'zh' ? 'en' : 'zh'
    }
    return autoTarget
  }, [manualTargetLang, detectedInfo.detected, sourceLanguage])

  // 源语言标签的单行规范化显示文本
  const sourceDisplayPrompt = useMemo(() => {
    if (sourceLanguage === 'auto') {
      return sourceText.trim() ? formatLanguageDisplay(detectedInfo.detected) : 'AUTO'
    }
    return formatLanguageDisplay(sourceLanguage)
  }, [sourceLanguage, sourceText, detectedInfo.detected])

  const deviceRef = useRef<HTMLElement | null>(null)

  // 动态根据输入内容自适应调整 textarea 高度
  const adjustTextareaHeight = (): void => {
    const textarea = sourceInputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, 180)
    textarea.style.height = `${Math.max(nextHeight, 36)}px`
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [sourceText])

  // 缓存上一次同步给 Electron 主进程的窗口高度，避免高频冗余触发
  const lastSentHeightRef = useRef<number>(0)
  // 目标输出屏幕 DOM 引用
  const targetScreenRef = useRef<HTMLDivElement | null>(null)

  // 组件卸载时清理退出定时器
  useEffect(() => {
    return () => {
      if (deckClosingTimerRef.current) {
        clearTimeout(deckClosingTimerRef.current)
      }
    }
  }, [])

  // 监听组件真实渲染尺寸，确保在超长文本输入时能适度自适应扩展窗口高度（基准下限为 280px 紧凑小巧机身）
  useEffect(() => {
    if (!deviceRef.current) return

    const updateWindowHeight = (): void => {
      if (!deviceRef.current) return
      const rect = deviceRef.current.getBoundingClientRect()
      // 基础内容高度加上上下安全裕量，紧凑自然贴合，杜绝死板大面积空白
      const targetHeight = Math.max(280, Math.ceil(rect.height + 24))

      // 仅当高度发生有效变化（>= 2px）时才派发 IPC，杜绝微小晃动与性能浪费
      if (Math.abs(lastSentHeightRef.current - targetHeight) >= 2) {
        lastSentHeightRef.current = targetHeight
        void window.api.setWindowHeight(targetHeight)
      }
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateWindowHeight)
    })

    observer.observe(deviceRef.current)

    // 在每一轮渲染或菜单开关切换后触发一次高度测量与同步
    const frameId = window.requestAnimationFrame(updateWindowHeight)

    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [isSourceLangMenuOpen, isTargetLangMenuOpen, isModelMenuOpen])

  // 初始加载后端持久化的大模型配置与多服务商列表
  useEffect(() => {
    window.api
      .getConfig()
      .then((cfg) => {
        if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
          setProviders(cfg.providers)
          const savedProvId = localStorage.getItem('selectedProviderId')
          const prov = pickActiveProvider(cfg.providers, [savedProvId, cfg.activeProviderId])

          if (!prov) {
            clearActiveProviderSelection()
          } else {
            setSelectedProviderId(prov.id)
            localStorage.setItem('selectedProviderId', prov.id)

            const savedModel = localStorage.getItem('selectedModel')
            const hasSavedModel = prov.models.some((m) => m.id === savedModel)
            const finalModel = hasSavedModel
              ? (savedModel as string)
              : cfg.activeModelId || prov.defaultModel || prov.models[0]?.id || ''

            setSelectedModel(finalModel)
            localStorage.setItem('selectedModel', finalModel)
          }
        }

        if (cfg.translation) {
          autoCopyRef.current = Boolean(cfg.translation.autoCopyResult)
        }
        if (typeof cfg.general?.alwaysOnTop === 'boolean') {
          setIsPinned(cfg.general.alwaysOnTop)
        }
      })
      .catch((err) => {
        console.error('[renderer] 初始化加载配置失败', err)
      })
  }, [clearActiveProviderSelection])

  // 监听偏好设置保存更新
  useEffect(() => {
    return window.api.onConfigUpdated((newCfg) => {
      if (Array.isArray(newCfg.providers) && newCfg.providers.length > 0) {
        setProviders(newCfg.providers)
        const prov = pickActiveProvider(newCfg.providers, [newCfg.activeProviderId])

        if (!prov) {
          // 设置页把所有渠道都停用了：清空选择，别让主界面继续挂着旧渠道和旧模型名
          clearActiveProviderSelection()
        } else {
          setSelectedProviderId(prov.id)
          localStorage.setItem('selectedProviderId', prov.id)

          const finalModel = newCfg.activeModelId || prov.defaultModel || prov.models[0]?.id || ''
          setSelectedModel(finalModel)
          localStorage.setItem('selectedModel', finalModel)
        }
      }

      if (newCfg.translation) {
        autoCopyRef.current = Boolean(newCfg.translation.autoCopyResult)
      }
      if (typeof newCfg.general?.alwaysOnTop === 'boolean') {
        setIsPinned(newCfg.general.alwaysOnTop)
      }
    })
  }, [clearActiveProviderSelection])

  const resetTranslationState = (): void => {
    setTargetText('')
    setErrorMessage('')
    setStatus('idle')
  }

  // 翻译触发计数器，确保显式触发时必定驱动翻译 Effect 闭环完成
  const [translateTriggerToken, setTranslateTriggerToken] = useState(0)

  const markTranslationPending = (): void => {
    setErrorMessage('')
    setStatus('translating')
    setTranslateTriggerToken((prev) => prev + 1)
  }

  // 监听截图 OCR 提取出的文本并自动填充触发翻译
  useEffect(() => {
    return window.api.onApplySourceText((recognizedText) => {
      const trimmed = recognizedText.trim()
      if (!trimmed) {
        setErrorMessage('截图未识别到文字内容')
        setStatus('idle')
        return
      }

      setSourceText(recognizedText)
      setErrorMessage('')
      markTranslationPending()
    })
  }, [])

  const handleTriggerCapture = async (): Promise<void> => {
    try {
      await window.api.captureScreen()
    } catch (error) {
      console.error('[renderer] 触发截图翻译失败', error)
    }
  }

  // 监听多浮层外部点击与 Esc 按键关闭
  useEffect(() => {
    if (!isModelMenuOpen && !isSourceLangMenuOpen && !isTargetLangMenuOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        isModelMenuOpen &&
        !modelSelectorRef.current?.contains(target) &&
        !engineDeckRef.current?.contains(target)
      ) {
        closeModelMenu()
      }
      if (isSourceLangMenuOpen && !sourceLangSelectorRef.current?.contains(target)) {
        setIsSourceLangMenuOpen(false)
      }
      if (isTargetLangMenuOpen && !targetLangSelectorRef.current?.contains(target)) {
        setIsTargetLangMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeModelMenu()
        setIsSourceLangMenuOpen(false)
        setIsTargetLangMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeModelMenu, isModelMenuOpen, isSourceLangMenuOpen, isTargetLangMenuOpen])

  // 源语言选择持久化
  useEffect(() => {
    localStorage.setItem('sourceLanguage', sourceLanguage)
  }, [sourceLanguage])

  // 手动目标语言选择持久化
  useEffect(() => {
    if (manualTargetLang) {
      localStorage.setItem('targetLanguage', manualTargetLang)
    } else {
      localStorage.removeItem('targetLanguage')
    }
  }, [manualTargetLang])

  // 核心翻译流程：基于动态检测的源语言与自适应目标语言触发模型翻译
  useEffect(() => {
    const trimmedSourceText = sourceText.trim()
    if (!trimmedSourceText) return

    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current
    const effectiveSourcePrompt = resolvePromptLanguage(sourceLanguage, detectedInfo.detected)
    const effectiveTargetPrompt = getLanguageInfo(effectiveTargetLang).promptName

    // 防抖处理，避免频繁调用翻译接口
    const timer = window.setTimeout(async () => {
      // 没有启用的渠道就直接给反馈：空 providerId 会在主进程里回落到配置里的默认渠道，
      // 那可能正是用户刚停用的那个，等于"停用了却还在用"
      if (!selectedProviderId || !selectedModel) {
        setTargetText('')
        setErrorMessage('还没有启用任何服务商，请先在偏好设置里启用一个')
        setStatus('error')
        return
      }

      const response = await window.api.translateText({
        text: sourceText,
        sourceLanguage: effectiveSourcePrompt,
        targetLanguage: effectiveTargetPrompt,
        options: {
          providerId: selectedProviderId,
          model: selectedModel
        }
      })
      if (currentRequestId !== requestIdRef.current) return

      if (response.ok) {
        setTargetText(response.text)
        setErrorMessage('')
        setStatus('idle')

        if (autoCopyRef.current && response.text.trim()) {
          void navigator.clipboard
            .writeText(response.text)
            .then(() => {
              setCopyState('done')
            })
            .catch((copyErr) => {
              console.warn('[renderer] 自动复制剪贴板失败:', copyErr)
            })
        }
        return
      }

      setTargetText('')
      setErrorMessage(getUserFriendlyErrorMessage(response.error.code))
      console.error('[renderer] translate error', response.error.code, response.error.message)
      setStatus('error')
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    selectedProviderId,
    selectedModel,
    sourceText,
    sourceLanguage,
    effectiveTargetLang,
    detectedInfo.detected,
    translateTriggerToken
  ])

  useEffect(() => {
    return window.api.onFocusInput(() => {
      sourceInputRef.current?.focus()
      sourceInputRef.current?.select()
    })
  }, [])

  // 模型选择持久化：没有可用模型时清掉记忆值，避免下次启动读到一个已经失效的模型名
  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('selectedModel', selectedModel)
    } else {
      localStorage.removeItem('selectedModel')
    }
  }, [selectedModel])

  useEffect(() => {
    if (copyState === 'idle') return

    const timer = window.setTimeout(() => {
      setCopyState('idle')
    }, 1000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [copyState])

  const handleSourceTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    // console.log('[renderer] source text changed', event.target.value)
    const nextText = event.target.value

    setSourceText(nextText)

    if (!nextText.trim()) {
      resetTranslationState()
      return
    }

    markTranslationPending()
  }

  const handleModelSelect = (providerId: string, nextModel: string): void => {
    setSelectedProviderId(providerId)
    setSelectedModel(nextModel)
    localStorage.setItem('selectedProviderId', providerId)
    localStorage.setItem('selectedModel', nextModel)
    closeModelMenu()

    if (sourceText.trim()) {
      markTranslationPending()
    }
  }

  const handleClearSource = (): void => {
    requestIdRef.current += 1
    setSourceText('')
    resetTranslationState()
    setCopyState('idle')
  }

  const handleCopyTarget = async (): Promise<void> => {
    if (!targetText.trim()) return

    try {
      await navigator.clipboard.writeText(targetText)
      setCopyState('done')
    } catch (error) {
      console.error('[renderer] copy target failed', error)
      setCopyState('error')
    }
  }

  const hasSourceText = sourceText.trim().length > 0
  const hasTargetText = targetText.trim().length > 0
  const screenActionButtonClassName = [
    'display-screen-action-button',
    'display-screen-action-button-copy',
    copyState === 'done' ? 'display-screen-action-button-done' : '',
    copyState === 'error' ? 'display-screen-action-button-error' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main className="translator-device" ref={deviceRef}>
      <section className={`device-panel ${errorMessage ? 'device-panel-error' : ''}`}>
        <header className="device-header">
          <button
            className="panel-button"
            type="button"
            aria-label="打开系统偏好设置"
            title="偏好设置 (Cmd+,)"
            onClick={() => void window.api.openConfigWindow()}
          >
            <img className="panel-icon" src={menuIcon} alt="" />
          </button>

          <div className="status-panel">
            <p className="status-label">SYSTEM STATUS</p>
            <div className={STATUS_VALUE_CLASS_MAP[status]}>
              <span className={STATUS_DOT_CLASS_MAP[status]} />
              <span>{STATUS_TEXT_MAP[status]}</span>
            </div>
          </div>

          <button
            className={`panel-button pin-button ${isPinned ? 'panel-button-pinned' : ''}`}
            type="button"
            aria-label={isPinned ? '取消固定窗口' : '固定窗口置顶'}
            title={isPinned ? '当前已置顶（点击取消）' : '点击置顶窗口'}
            onClick={() => void handleTogglePin()}
          >
            <img className="panel-icon" src={pinIcon} alt="" />
          </button>
        </header>

        <section className="display-section">
          <div className="display-section-header display-section-header-target">
            {isSourceLangMenuOpen ? (
              <div
                className="tape-ribbon"
                ref={sourceLangSelectorRef}
                role="region"
                aria-label="源语言磁带滑轨"
              >
                <div className="tape-ribbon-label">
                  <span className="section-header-label">SOURCE:</span>
                </div>
                <div
                  className="tape-ribbon-track"
                  ref={sourceRibbonTrackRef}
                  onWheel={handleRibbonWheel}
                  role="listbox"
                  aria-label="源语言选择"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isSelected = lang.code === sourceLanguage

                    return (
                      <button
                        key={lang.code}
                        className={`tape-chip ${isSelected ? 'tape-chip-selected' : ''}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        title={
                          lang.code === 'auto'
                            ? `自动检测${sourceText.trim() ? ` (当前识别: ${detectedInfo.languageInfo.label})` : ''}`
                            : lang.label
                        }
                        onClick={() => {
                          setIsSourceLangMenuOpen(false)
                          if (sourceLanguage !== lang.code) {
                            setSourceLanguage(lang.code)
                            if (sourceText.trim()) {
                              markTranslationPending()
                            }
                          }
                        }}
                      >
                        {lang.shortLabel}
                      </button>
                    )
                  })}
                </div>
                <div className="tape-ribbon-controls">
                  <button
                    type="button"
                    className="tape-close-btn"
                    onClick={() => setIsSourceLangMenuOpen(false)}
                    title="收起滑轨"
                    aria-label="收起滑轨"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <div className="lang-header-item" ref={sourceLangSelectorRef}>
                <button
                  className="lang-badge-button"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={false}
                  aria-label={`当前源语言: ${sourceLanguage === 'auto' ? `自动检测 (当前识别: ${detectedInfo.languageInfo.label})` : getLanguageInfo(sourceLanguage).label}，点击展开语言滑轨`}
                  onClick={() => {
                    setIsSourceLangMenuOpen((open) => !open)
                    setIsTargetLangMenuOpen(false)
                    closeModelMenu()
                  }}
                >
                  <span className="section-header-label">SOURCE:</span>
                  <span className="section-header-value">{sourceDisplayPrompt}</span>
                  {sourceLanguage === 'auto' && sourceText.trim() ? (
                    <span
                      className="lang-pill"
                      title={`已自动识别: ${detectedInfo.languageInfo.label} (置信度: ${Math.round(detectedInfo.confidence * 100)}%)`}
                    >
                      AUTO
                    </span>
                  ) : null}
                </button>
              </div>
            )}
          </div>
          <div className="display-screen display-screen-source">
            <div className="display-screen-body">
              <div className="display-scroll">
                <textarea
                  ref={sourceInputRef}
                  className="display-input"
                  value={sourceText}
                  onChange={handleSourceTextChange}
                  placeholder="Type text here..."
                  spellCheck={false}
                  aria-label="源文本输入框"
                />
              </div>
              <div className="display-screen-actions">
                <span className="display-screen-actions-label">INPUT ACTIONS</span>
                <div className="display-screen-actions-list">
                  <button
                    className="display-screen-action-button display-screen-action-button-capture"
                    type="button"
                    onClick={() => void handleTriggerCapture()}
                    aria-label="截图翻译 (Alt+S)"
                    title="截图翻译 (Alt+S)"
                  >
                    <span
                      className="display-screen-action-icon display-screen-action-icon-crop"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    className="display-screen-action-button display-screen-action-button-clear"
                    type="button"
                    onClick={handleClearSource}
                    disabled={!hasSourceText}
                    aria-label="清空输入"
                    title="清空输入"
                  >
                    <span
                      className="display-screen-action-icon display-screen-action-icon-clear"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="display-section display-section-target-wrap">
          <div className="display-section-header display-section-header-target">
            {isTargetLangMenuOpen ? (
              <div
                className="tape-ribbon"
                ref={targetLangSelectorRef}
                role="region"
                aria-label="目标语言磁带滑轨"
              >
                <div className="tape-ribbon-label">
                  <span className="section-header-label">TARGET:</span>
                </div>
                <div
                  className="tape-ribbon-track"
                  ref={targetRibbonTrackRef}
                  onWheel={handleRibbonWheel}
                  role="listbox"
                  aria-label="目标语言选择"
                >
                  <button
                    className={`tape-chip ${manualTargetLang === null ? 'tape-chip-selected' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={manualTargetLang === null}
                    title="智能自动匹配 (对偶切换)"
                    onClick={() => {
                      setIsTargetLangMenuOpen(false)
                      if (manualTargetLang !== null) {
                        setManualTargetLang(null)
                        if (sourceText.trim()) {
                          markTranslationPending()
                        }
                      }
                    }}
                  >
                    AUTO
                  </button>

                  {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => {
                    const isSelected = manualTargetLang === lang.code

                    return (
                      <button
                        key={lang.code}
                        className={`tape-chip ${isSelected ? 'tape-chip-selected' : ''}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        title={lang.label}
                        onClick={() => {
                          setIsTargetLangMenuOpen(false)
                          if (manualTargetLang !== lang.code) {
                            setManualTargetLang(lang.code)
                            if (sourceText.trim()) {
                              markTranslationPending()
                            }
                          }
                        }}
                      >
                        {lang.shortLabel}
                      </button>
                    )
                  })}
                </div>
                <div className="tape-ribbon-controls">
                  <button
                    type="button"
                    className="tape-close-btn"
                    onClick={() => setIsTargetLangMenuOpen(false)}
                    title="收起滑轨"
                    aria-label="收起滑轨"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* 目标语言选择器 */}
                <div className="lang-header-item" ref={targetLangSelectorRef}>
                  <button
                    className={`lang-badge-button ${isTargetLangMenuOpen ? 'lang-badge-button-open' : ''}`}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={isTargetLangMenuOpen}
                    aria-label={`当前目标语言: ${getLanguageInfo(effectiveTargetLang).label}，点击展开语言滑轨`}
                    onClick={() => {
                      setIsTargetLangMenuOpen((open) => !open)
                      setIsSourceLangMenuOpen(false)
                      closeModelMenu()
                    }}
                  >
                    <span className="section-header-label">TARGET:</span>
                    <span className="section-header-value">
                      {formatLanguageDisplay(effectiveTargetLang)}
                    </span>
                  </button>
                </div>

                {/* 模型选择器（保留在腰线右侧入口） */}
                <div className="model-selector" ref={modelSelectorRef}>
                  <button
                    className={`model-switcher-trigger ${isModelMenuOpen ? 'model-switcher-trigger-open' : ''}`}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={isModelMenuOpen}
                    aria-label={
                      activeProvider
                        ? `当前服务商: ${activeProvider.name}，模型: ${selectedModel}，点击在下方屏幕展开选择`
                        : '当前没有启用任何服务商，点击在下方屏幕查看'
                    }
                    title={
                      activeProvider
                        ? `服务商: ${activeProvider.name}\n模型: ${selectedModel}\n地址: ${activeProvider.baseUrl}`
                        : '当前没有启用任何服务商，请在偏好设置里启用一个'
                    }
                    onClick={() => {
                      setIsSourceLangMenuOpen(false)
                      setIsTargetLangMenuOpen(false)
                      if (isModelMenuOpen) {
                        closeModelMenu()
                      } else {
                        openModelMenu()
                      }
                    }}
                  >
                    <span className="section-header-label">MODEL:</span>
                    <span className="section-header-value">{selectedModel || '--'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <div
            ref={targetScreenRef}
            className={`display-screen display-screen-target ${
              isModelMenuOpen ? 'display-screen-target-deck-open' : ''
            }`}
          >
            <div className="display-screen-body">
              <div className="display-scroll">
                {status === 'translating' ? (
                  <div className="translation-loader" aria-live="polite" aria-label="正在翻译">
                    <div className="translation-loader-bubble" aria-hidden="true">
                      <span className="translation-loader-bubble-tail" />
                      <span className="translation-loader-bubble-dots">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className={`display-content ${!targetText ? 'display-placeholder' : ''}`}>
                    {targetText || '等待翻译结果...'}
                  </p>
                )}
              </div>
              <div className="display-screen-actions">
                <span className="display-screen-actions-label">OUTPUT ACTIONS</span>
                <div className="display-screen-actions-list">
                  <button
                    className={screenActionButtonClassName}
                    type="button"
                    onClick={() => void handleCopyTarget()}
                    disabled={!hasTargetText || status === 'translating'}
                    aria-label={copyState === 'done' ? '复制完成' : '复制输出'}
                    title={copyState === 'done' ? '复制完成' : '复制输出'}
                  >
                    <span
                      className={`display-screen-action-icon ${
                        copyState === 'done'
                          ? 'display-screen-action-icon-check'
                          : 'display-screen-action-icon-copy'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* 深色掌机终端引擎面板 (Terminal Engine Deck - 嵌在结果输出屏内部) */}
            {isDeckMounted ? (
              <div
                className={`terminal-engine-deck ${isDeckClosing ? 'terminal-engine-deck-closing' : ''}`}
                ref={engineDeckRef}
                role="dialog"
                aria-label="翻译引擎选择面板"
              >
                <div className="terminal-engine-deck-header">
                  <div className="terminal-engine-deck-title">
                    <span className="terminal-engine-deck-dot" aria-hidden="true" />
                    <span>ENGINE</span>
                  </div>
                  {/* 设置入口从底部整条按钮收进头部，把高度还给模型列表 */}
                  <div className="terminal-engine-deck-actions">
                    <button
                      type="button"
                      className="terminal-engine-deck-config"
                      onClick={() => {
                        closeModelMenu()
                        void window.api.openConfigWindow()
                      }}
                      aria-label="打开偏好设置"
                      title="配置服务商（Cmd+,）"
                    >
                      CONFIG
                    </button>
                    <button
                      type="button"
                      className="terminal-engine-deck-close"
                      onClick={() => closeModelMenu()}
                      aria-label="关闭引擎面板"
                      title="关闭面板"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {enabledProviders.length > 0 ? (
                  /* 所有渠道的模型平铺成一列：一次点击直达，渠道之间只用一条细线分隔 */
                  <div className="terminal-engine-models-list" role="listbox" aria-label="模型列表">
                    {enabledProviders.flatMap((prov, provIndex) => {
                      const rows = prov.models.map((item) => {
                        const isSelected =
                          prov.id === selectedProviderId && item.id === selectedModel
                        return (
                          <button
                            key={`${prov.id}-${item.id}`}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`terminal-engine-option ${
                              isSelected ? 'terminal-engine-option-selected' : ''
                            }`}
                            onClick={() => handleModelSelect(prov.id, item.id)}
                            title={`${item.id} · ${prov.name}`}
                          >
                            <span className="terminal-engine-name">{item.id}</span>
                            <span className="terminal-engine-provider">{prov.name}</span>
                          </button>
                        )
                      })

                      // 第一个渠道前面不加分隔线，避免顶部多出一条悬空的线
                      if (provIndex === 0) return rows
                      return [
                        <div
                          key={`sep-${prov.id}`}
                          className="terminal-engine-group-sep"
                          aria-hidden="true"
                        />,
                        ...rows
                      ]
                    })}
                  </div>
                ) : (
                  /* 一个启用的服务商都没有：这里以前兜底列出写死的示例模型，会把人引到不存在的渠道上 */
                  <div className="terminal-engine-empty-hint terminal-engine-empty-hint-deck">
                    还没有启用任何服务商，点右上角齿轮去启用
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <p className="translate-error" role="status" aria-live="polite">
              <span className="translate-error-label">SYSTEM NOTICE</span>
              <span className="translate-error-text">{errorMessage}</span>
            </p>
          ) : null}
        </section>
      </section>
    </main>
  )
}

export default App
