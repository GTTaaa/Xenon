import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProviderItem } from '../../shared/config'
import {
  detectLanguage,
  getLanguageInfo,
  resolveAutoTargetLanguage,
  resolvePromptLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage
} from '../../shared/languageDetector'
import {
  MAIN_WINDOW_HEIGHT_EMPTY,
  MAIN_WINDOW_HEIGHT_MIN,
  NORMAL_WINDOW_HEIGHT_MAX
} from '../../shared/windowLayout'
import {
  getLanguageLabel,
  getLanguageShortLabel,
  getProviderDisplayName,
  normalizeAppLanguage,
  type Translate
} from '../../shared/i18n'
import { useI18n } from './i18n/useI18n'

type TranslateStatus = 'idle' | 'translating' | 'error'

// 输入字号 12.5px × 行高 1.62，用来把输入内容高度换算成行数。
const INPUT_LINE_HEIGHT = 20.25
// 输入区最多长到 5 行，再多交给输入框自己滚动。
const MAX_INPUT_LINES = 5
// 译文最少铺 3 行（18px 字号 × 1.68 行高），避免短内容留下过多空白。
const RESULT_MIN_HEIGHT = 18 * 1.68 * 3

/** 把模型服务错误转换成面向用户的简短提示 */
const getUserFriendlyErrorMessage = (code: string, t: Translate): string => {
  switch (code) {
    case 'CONFIG_MISSING_API_KEY':
      return t('app.error.configApiKey')
    case 'CONFIG_MISSING_BASE_URL':
      return t('app.error.configBaseUrl')
    case 'HTTP_401':
      return t('app.error.auth')
    case 'HTTP_403':
      return t('app.error.forbidden')
    case 'HTTP_429':
      return t('app.error.rateLimit')
    case 'NETWORK_ERROR':
      return t('app.error.network')
    case 'EMPTY_RESPONSE':
      return t('app.error.emptyResponse')
    case 'STREAM_ERROR':
      return t('app.error.stream')
    default:
      return t('app.error.default')
  }
}

/**
 * 挑选主界面当前使用的服务商。
 * 只从已启用渠道中选择，避免模型面板继续显示已经停用的服务。
 */
const pickActiveProvider = (
  list: ProviderItem[],
  preferredIds: Array<string | null | undefined>
): ProviderItem | undefined => {
  const enabled = list.filter((provider) => provider.enabled)

  for (const id of preferredIds) {
    if (!id) continue
    const hit = enabled.find((provider) => provider.id === id)
    if (hit) return hit
  }

  return enabled[0]
}

function App(): React.JSX.Element {
  const { language, setLanguage, t } = useI18n()
  const [sourceText, setSourceText] = useState('')
  const [targetText, setTargetText] = useState('')
  const [status, setStatus] = useState<TranslateStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [ocrSlowHint, setOcrSlowHint] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle')

  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    return localStorage.getItem('selectedProviderId') || ''
  })
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('selectedModel') || ''
  })
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isDeckMounted, setIsDeckMounted] = useState(false)
  const [isDeckClosing, setIsDeckClosing] = useState(false)

  const [sourceLanguage, setSourceLanguage] = useState<SupportedLanguage>(() => {
    const saved = localStorage.getItem('sourceLanguage') as SupportedLanguage | null
    return saved && SUPPORTED_LANGUAGES.some((language) => language.code === saved) ? saved : 'auto'
  })
  const [manualTargetLang, setManualTargetLang] = useState<SupportedLanguage | null>(() => {
    const saved = localStorage.getItem('targetLanguage') as SupportedLanguage | null
    return saved &&
      SUPPORTED_LANGUAGES.some((language) => language.code === saved && language.code !== 'auto')
      ? saved
      : null
  })
  const [isSourceLangMenuOpen, setIsSourceLangMenuOpen] = useState(false)
  const [isTargetLangMenuOpen, setIsTargetLangMenuOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [screenshotShortcut, setScreenshotShortcut] = useState('Alt+S')

  const requestIdRef = useRef(0)
  const translationAbortRef = useRef<AbortController | null>(null)
  const ipcRequestSequenceRef = useRef(0)
  const autoCopyRef = useRef(false)
  const sourceInputRef = useRef<HTMLTextAreaElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const resultScrollRef = useRef<HTMLDivElement | null>(null)
  const resultToolbarRef = useRef<HTMLDivElement | null>(null)
  const lastSentHeightRef = useRef(0)
  const modelSelectorRef = useRef<HTMLButtonElement | null>(null)
  const engineDeckRef = useRef<HTMLDivElement | null>(null)
  const sourceLangSelectorRef = useRef<HTMLDivElement | null>(null)
  const targetLangSelectorRef = useRef<HTMLDivElement | null>(null)
  const deckClosingTimerRef = useRef<number | null>(null)
  const [translateTriggerToken, setTranslateTriggerToken] = useState(0)

  const enabledProviders = useMemo(() => {
    return providers.filter((provider) => provider.enabled)
  }, [providers])

  const activeProvider = useMemo(() => {
    return (
      enabledProviders.find((provider) => provider.id === selectedProviderId) || enabledProviders[0]
    )
  }, [enabledProviders, selectedProviderId])

  /** 清空当前渠道与模型，并同步清理本地记忆值 */
  const clearActiveProviderSelection = useCallback((): void => {
    setSelectedProviderId('')
    setSelectedModel('')
    localStorage.removeItem('selectedProviderId')
    localStorage.removeItem('selectedModel')
  }, [])

  /** 打开模型面板，并收起语言菜单 */
  const openModelMenu = useCallback((): void => {
    if (deckClosingTimerRef.current !== null) {
      window.clearTimeout(deckClosingTimerRef.current)
      deckClosingTimerRef.current = null
    }
    setIsDeckMounted(true)
    setIsDeckClosing(false)
    setIsModelMenuOpen(true)
    setIsSourceLangMenuOpen(false)
    setIsTargetLangMenuOpen(false)
  }, [])

  /** 关闭模型面板，保留短暂淡出动画 */
  const closeModelMenu = useCallback((): void => {
    setIsDeckClosing(true)
    setIsModelMenuOpen(false)
    if (deckClosingTimerRef.current !== null) {
      window.clearTimeout(deckClosingTimerRef.current)
    }
    deckClosingTimerRef.current = window.setTimeout(() => {
      deckClosingTimerRef.current = null
      setIsDeckMounted(false)
      setIsDeckClosing(false)
    }, 100)
  }, [])

  const detectedInfo = useMemo(() => detectLanguage(sourceText), [sourceText])

  const effectiveTargetLang: SupportedLanguage = useMemo(() => {
    if (manualTargetLang) return manualTargetLang
    const autoTarget = resolveAutoTargetLanguage(detectedInfo.detected)
    if (sourceLanguage !== 'auto' && sourceLanguage === autoTarget) {
      return autoTarget === 'zh' ? 'en' : 'zh'
    }
    return autoTarget
  }, [manualTargetLang, detectedInfo.detected, sourceLanguage])

  const sourceLanguageName = useMemo(() => {
    if (sourceLanguage !== 'auto') return getLanguageShortLabel(language, sourceLanguage)
    return sourceText.trim()
      ? getLanguageShortLabel(language, detectedInfo.detected)
      : t('common.auto')
  }, [language, sourceLanguage, sourceText, detectedInfo.detected, t])

  const targetLanguageName = useMemo(
    () => getLanguageShortLabel(language, effectiveTargetLang),
    [language, effectiveTargetLang]
  )

  const hasSourceText = sourceText.trim().length > 0
  const hasTargetText = targetText.trim().length > 0
  const isBlankState =
    !hasSourceText && !hasTargetText && status === 'idle' && !errorMessage && !isRecognizing

  const handleTogglePin = async (): Promise<void> => {
    try {
      setIsPinned(await window.api.toggleAlwaysOnTop())
    } catch (error) {
      console.error('[renderer] 切换窗口置顶失败', error)
    }
  }

  /** 生成只用于 IPC 请求追踪的唯一 ID */
  const createIpcRequestId = useCallback((): string => {
    ipcRequestSequenceRef.current += 1
    return `translate-${Date.now()}-${ipcRequestSequenceRef.current}`
  }, [])

  /** 将渲染进程的取消信号连接到主进程 */
  const bindAbortCancellation = useCallback(
    (controller: AbortController, requestId: string): void => {
      controller.signal.addEventListener(
        'abort',
        () => {
          window.api.cancelTranslation(requestId)
        },
        { once: true }
      )
    },
    []
  )

  /** 立即取消当前翻译请求，防止旧响应覆盖新输入 */
  const abortActiveTranslationRequests = useCallback((): void => {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
  }, [])

  /** 清空译文并进入等待翻译状态 */
  const markTranslationPending = useCallback((): void => {
    abortActiveTranslationRequests()
    setTargetText('')
    setErrorMessage('')
    setStatus('translating')
    setTranslateTriggerToken((current) => current + 1)
  }, [abortActiveTranslationRequests])

  // 初始化已保存的服务商、模型、自动复制与置顶状态。
  useEffect(() => {
    window.api
      .getConfig()
      .then((config) => {
        if (Array.isArray(config.providers) && config.providers.length > 0) {
          setProviders(config.providers)
          const savedProviderId = localStorage.getItem('selectedProviderId')
          const provider = pickActiveProvider(config.providers, [
            savedProviderId,
            config.activeProviderId
          ])

          if (!provider) {
            clearActiveProviderSelection()
          } else {
            setSelectedProviderId(provider.id)
            localStorage.setItem('selectedProviderId', provider.id)

            const savedModel = localStorage.getItem('selectedModel')
            const hasSavedModel = provider.models.some((model) => model.id === savedModel)
            const model = hasSavedModel
              ? (savedModel as string)
              : config.activeModelId || provider.defaultModel || provider.models[0]?.id || ''

            setSelectedModel(model)
            localStorage.setItem('selectedModel', model)
          }
        }

        autoCopyRef.current = Boolean(config.translation?.autoCopyResult)
        setScreenshotShortcut(config.shortcuts?.screenshot || 'Alt+S')
        setLanguage(normalizeAppLanguage(config.general?.language))
        if (typeof config.general?.alwaysOnTop === 'boolean') {
          setIsPinned(config.general.alwaysOnTop)
        }
      })
      .catch((error) => {
        console.error('[renderer] 初始化加载配置失败', error)
      })
  }, [clearActiveProviderSelection, setLanguage])

  // 偏好设置保存后，同步主窗口的服务商、模型与快捷键显示。
  useEffect(() => {
    return window.api.onConfigUpdated((config) => {
      if (Array.isArray(config.providers) && config.providers.length > 0) {
        setProviders(config.providers)
        const provider = pickActiveProvider(config.providers, [config.activeProviderId])

        if (!provider) {
          clearActiveProviderSelection()
        } else {
          setSelectedProviderId(provider.id)
          localStorage.setItem('selectedProviderId', provider.id)

          const model =
            config.activeModelId || provider.defaultModel || provider.models[0]?.id || ''
          setSelectedModel(model)
          localStorage.setItem('selectedModel', model)
        }
      }

      autoCopyRef.current = Boolean(config.translation?.autoCopyResult)
      setScreenshotShortcut(config.shortcuts?.screenshot || 'Alt+S')
      setLanguage(normalizeAppLanguage(config.general?.language))
      if (typeof config.general?.alwaysOnTop === 'boolean') {
        setIsPinned(config.general.alwaysOnTop)
      }
    })
  }, [clearActiveProviderSelection, setLanguage])

  // OCR 阶段提供明确反馈，避免首次初始化 Vision 模型时被误认为应用卡死。
  useEffect(() => {
    return window.api.onOcrStatus((next) => {
      if (next.phase === 'pending') {
        abortActiveTranslationRequests()
        requestIdRef.current += 1
        setTargetText('')
        setErrorMessage('')
        setStatus('translating')
      }

      setOcrSlowHint(false)
      setIsRecognizing(next.phase === 'pending')

      if (next.phase === 'error') {
        setErrorMessage(next.message)
        setStatus('error')
      }
    })
  }, [abortActiveTranslationRequests])

  // 识别超过 4 秒时解释首次冷启动可能较慢。
  useEffect(() => {
    if (!isRecognizing) return
    const timer = window.setTimeout(() => setOcrSlowHint(true), 4000)
    return () => window.clearTimeout(timer)
  }, [isRecognizing])

  // 接收截图 OCR 结果，并立即触发翻译。
  useEffect(() => {
    return window.api.onApplySourceText((recognizedText) => {
      const trimmed = recognizedText.trim()
      abortActiveTranslationRequests()
      requestIdRef.current += 1

      if (!trimmed) {
        setTargetText('')
        setErrorMessage(t('app.error.ocrEmpty'))
        setStatus('idle')
        return
      }

      setIsSourceLangMenuOpen(false)
      setIsTargetLangMenuOpen(false)
      setSourceText(recognizedText)
      markTranslationPending()
    })
  }, [abortActiveTranslationRequests, markTranslationPending, t])

  // 输入翻译快捷键直接聚焦并选中当前输入。
  useEffect(() => {
    let firstFrame = 0
    let secondFrame = 0

    const unsubscribe = window.api.onFocusInput(() => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          sourceInputRef.current?.focus()
          sourceInputRef.current?.select()
        })
      })
    })

    return () => {
      unsubscribe()
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [])

  // 浮层打开时支持点击外部区域或按 Esc 关闭。
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
      if (event.key !== 'Escape') return
      closeModelMenu()
      setIsSourceLangMenuOpen(false)
      setIsTargetLangMenuOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeModelMenu, isModelMenuOpen, isSourceLangMenuOpen, isTargetLangMenuOpen])

  // 持久化源语言、目标语言与模型选择。
  useEffect(() => {
    localStorage.setItem('sourceLanguage', sourceLanguage)
  }, [sourceLanguage])

  useEffect(() => {
    if (manualTargetLang) {
      localStorage.setItem('targetLanguage', manualTargetLang)
    } else {
      localStorage.removeItem('targetLanguage')
    }
  }, [manualTargetLang])

  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('selectedModel', selectedModel)
    } else {
      localStorage.removeItem('selectedModel')
    }
  }, [selectedModel])

  // 核心翻译流程：输入变化后防抖请求，并用动画帧合并流式增量。
  useEffect(() => {
    const trimmedSourceText = sourceText.trim()
    if (!trimmedSourceText) {
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      return
    }

    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current
    const effectiveSourcePrompt = resolvePromptLanguage(sourceLanguage, detectedInfo.detected)
    const effectiveTargetPrompt = getLanguageInfo(effectiveTargetLang).promptName
    const controller = new AbortController()
    const ipcRequestId = createIpcRequestId()

    translationAbortRef.current?.abort()
    translationAbortRef.current = controller
    bindAbortCancellation(controller, ipcRequestId)

    let pendingFrame: number | null = null
    let streamedText = ''
    let requestStarted = false
    let requestSettled = false

    const timer = window.setTimeout(async () => {
      if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

      if (!selectedProviderId || !selectedModel) {
        setTargetText('')
        setErrorMessage(t('app.error.noProvider'))
        setStatus('error')
        return
      }

      requestStarted = true
      setTargetText('')
      setErrorMessage('')

      try {
        const response = await window.api.translateTextStream(
          ipcRequestId,
          {
            text: sourceText,
            sourceLanguage: effectiveSourcePrompt,
            targetLanguage: effectiveTargetPrompt,
            options: {
              providerId: selectedProviderId,
              model: selectedModel
            }
          },
          (delta) => {
            if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

            streamedText += delta
            if (pendingFrame !== null) return
            pendingFrame = window.requestAnimationFrame(() => {
              pendingFrame = null
              if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return
              setTargetText(streamedText)
            })
          }
        )

        if (pendingFrame !== null) {
          window.cancelAnimationFrame(pendingFrame)
          pendingFrame = null
        }
        if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

        if (response.ok) {
          setTargetText(response.text)
          setErrorMessage('')
          setStatus('idle')

          if (autoCopyRef.current && response.text.trim()) {
            void navigator.clipboard
              .writeText(response.text)
              .then(() => setCopyState('done'))
              .catch((error) => {
                console.warn('[renderer] 自动复制剪贴板失败:', error)
              })
          }
          return
        }

        if (response.error.code === 'ABORTED') return

        setTargetText('')
        setErrorMessage(getUserFriendlyErrorMessage(response.error.code, t))
        console.error('[renderer] translate error', response.error.code, response.error.message)
        setStatus('error')
      } catch (error) {
        if (pendingFrame !== null) {
          window.cancelAnimationFrame(pendingFrame)
          pendingFrame = null
        }
        if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

        console.error('[renderer] 翻译请求异常', error)
        setTargetText('')
        setErrorMessage(t('app.error.default'))
        setStatus('error')
      } finally {
        requestSettled = true
        if (translationAbortRef.current === controller) {
          translationAbortRef.current = null
        }
      }
    }, 500)

    return () => {
      window.clearTimeout(timer)
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
      if (requestStarted && !requestSettled) controller.abort()
      if (translationAbortRef.current === controller) {
        translationAbortRef.current = null
      }
    }
  }, [
    bindAbortCancellation,
    createIpcRequestId,
    detectedInfo.detected,
    effectiveTargetLang,
    selectedModel,
    selectedProviderId,
    sourceLanguage,
    sourceText,
    translateTriggerToken,
    t
  ])

  // 根据输入与译文内容动态校准窗口高度，避免短文本留下大面积空白。
  const syncWindowHeight = useCallback((): void => {
    const panel = panelRef.current
    const textarea = sourceInputRef.current
    const scroll = resultScrollRef.current
    const toolbar = resultToolbarRef.current
    if (!panel || !textarea || !scroll || !toolbar) return

    textarea.style.height = 'auto'
    const contentHeight = textarea.scrollHeight
    const lineCount = Math.max(
      1,
      Math.min(MAX_INPUT_LINES, Math.ceil(contentHeight / INPUT_LINE_HEIGHT))
    )
    textarea.style.height = `${Math.min(lineCount * INPUT_LINE_HEIGHT, contentHeight)}px`

    const lead = scroll.getBoundingClientRect().top - panel.getBoundingClientRect().top
    const scrollStyle = getComputedStyle(scroll)
    const scrollPadding =
      parseFloat(scrollStyle.paddingTop || '0') + parseFloat(scrollStyle.paddingBottom || '0')

    scroll.style.height = ''
    const baseResultHeight = isBlankState
      ? 0
      : Math.max(RESULT_MIN_HEIGHT, scroll.scrollHeight - scrollPadding)
    const body = panel.querySelector('.device-body')
    const bottomPadding = body ? parseFloat(getComputedStyle(body).paddingBottom || '0') : 0
    const toolbarHeight = toolbar.getBoundingClientRect().height
    const fixedHeight = lead + scrollPadding + toolbarHeight + bottomPadding
    const resultHeight = Math.max(
      0,
      Math.min(baseResultHeight, NORMAL_WINDOW_HEIGHT_MAX - fixedHeight)
    )

    if (resultHeight < baseResultHeight) {
      scroll.style.height = `${resultHeight + scrollPadding}px`
    }

    const minimumHeight = isBlankState ? MAIN_WINDOW_HEIGHT_EMPTY : MAIN_WINDOW_HEIGHT_MIN
    const nextWindowHeight = Math.round(
      Math.max(minimumHeight, Math.min(NORMAL_WINDOW_HEIGHT_MAX, fixedHeight + resultHeight))
    )

    if (Math.abs(lastSentHeightRef.current - nextWindowHeight) < 2) return
    lastSentHeightRef.current = nextWindowHeight
    void window.api.setWindowHeight(nextWindowHeight, isBlankState)
  }, [isBlankState])

  useLayoutEffect(() => {
    syncWindowHeight()
  }, [errorMessage, isRecognizing, sourceText, status, targetText, syncWindowHeight])

  // 复制成功或失败的反馈只保留 1 秒。
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 1000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  // 卸载时清理浮层动画定时器与未完成请求。
  useEffect(() => {
    return () => {
      translationAbortRef.current?.abort()
      if (deckClosingTimerRef.current !== null) {
        window.clearTimeout(deckClosingTimerRef.current)
      }
    }
  }, [])

  const handleSourceTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextText = event.target.value
    abortActiveTranslationRequests()
    setSourceText(nextText)

    if (!nextText.trim()) {
      setTargetText('')
      setErrorMessage('')
      setStatus('idle')
      return
    }

    setTargetText('')
    setErrorMessage('')
    setStatus('translating')
  }

  const handleModelSelect = (providerId: string, nextModel: string): void => {
    setSelectedProviderId(providerId)
    setSelectedModel(nextModel)
    localStorage.setItem('selectedProviderId', providerId)
    localStorage.setItem('selectedModel', nextModel)
    closeModelMenu()

    if (sourceText.trim()) markTranslationPending()
  }

  const handleClearSource = (): void => {
    abortActiveTranslationRequests()
    requestIdRef.current += 1
    setSourceText('')
    setTargetText('')
    setErrorMessage('')
    setStatus('idle')
    setCopyState('idle')
    sourceInputRef.current?.focus()
  }

  const handleCopyTarget = async (): Promise<void> => {
    if (!targetText.trim()) return

    try {
      await navigator.clipboard.writeText(targetText)
      setCopyState('done')
    } catch (error) {
      console.error('[renderer] 复制译文失败', error)
      setCopyState('error')
    }
  }

  return (
    <main className="translator-device" ref={panelRef}>
      <section className="device-panel">
        <header className="window-bar">
          <div className="window-bar-main">
            <div className="header-language">
              <div className="lang-slot" ref={sourceLangSelectorRef}>
                <button
                  type="button"
                  className="lang-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={isSourceLangMenuOpen}
                  title={t('app.language.switchSource')}
                  onClick={() => {
                    setIsSourceLangMenuOpen((open) => !open)
                    setIsTargetLangMenuOpen(false)
                    closeModelMenu()
                  }}
                >
                  <span className="lang-name">{sourceLanguageName}</span>
                  {sourceLanguage === 'auto' && hasSourceText ? (
                    <span className="lang-sub">{t('common.auto')}</span>
                  ) : null}
                </button>

                {isSourceLangMenuOpen ? (
                  <div
                    className="lang-menu"
                    role="listbox"
                    aria-label={t('app.language.sourceList')}
                  >
                    {SUPPORTED_LANGUAGES.map((languageOption) => {
                      const isSelected = languageOption.code === sourceLanguage
                      return (
                        <button
                          key={languageOption.code}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`lang-option${isSelected ? ' lang-option-on' : ''}`}
                          onClick={() => {
                            setIsSourceLangMenuOpen(false)
                            if (sourceLanguage === languageOption.code) return
                            setSourceLanguage(languageOption.code)
                            if (sourceText.trim()) markTranslationPending()
                          }}
                        >
                          {getLanguageLabel(language, languageOption.code)}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>

              <span className="flow-swap" aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 8h13M14 5l3 3-3 3" />
                  <path d="M20 16H7M10 13l-3 3 3 3" />
                </svg>
              </span>

              <div className="lang-slot" ref={targetLangSelectorRef}>
                <button
                  type="button"
                  className="lang-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={isTargetLangMenuOpen}
                  title={t('app.language.switchTarget')}
                  onClick={() => {
                    setIsTargetLangMenuOpen((open) => !open)
                    setIsSourceLangMenuOpen(false)
                    closeModelMenu()
                  }}
                >
                  <span className="lang-name">{targetLanguageName}</span>
                </button>

                {isTargetLangMenuOpen ? (
                  <div
                    className="lang-menu"
                    role="listbox"
                    aria-label={t('app.language.targetList')}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={manualTargetLang === null}
                      className={`lang-option${manualTargetLang === null ? ' lang-option-on' : ''}`}
                      title={t('app.language.autoMatchHint')}
                      onClick={() => {
                        setIsTargetLangMenuOpen(false)
                        if (manualTargetLang === null) return
                        setManualTargetLang(null)
                        if (sourceText.trim()) markTranslationPending()
                      }}
                    >
                      {t('app.language.autoMatch')}
                    </button>

                    {SUPPORTED_LANGUAGES.filter(
                      (languageOption) => languageOption.code !== 'auto'
                    ).map((languageOption) => {
                      const isSelected = manualTargetLang === languageOption.code
                      return (
                        <button
                          key={languageOption.code}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`lang-option${isSelected ? ' lang-option-on' : ''}`}
                          onClick={() => {
                            setIsTargetLangMenuOpen(false)
                            if (manualTargetLang === languageOption.code) return
                            setManualTargetLang(languageOption.code)
                            if (sourceText.trim()) markTranslationPending()
                          }}
                        >
                          {getLanguageLabel(language, languageOption.code)}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="window-actions">
              <button
                className="icon-btn settings-btn"
                type="button"
                aria-label={t('app.settings.open')}
                title={t('app.settings.title')}
                onClick={() => {
                  setIsSourceLangMenuOpen(false)
                  setIsTargetLangMenuOpen(false)
                  closeModelMenu()
                  void window.api.openConfigWindow()
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M7.37506 3.98898C7.25044 4.06093 7.18813 4.0969 7.13585 4.1315C6.34815 4.65274 6.01706 5.6437 6.33322 6.53376C6.3542 6.59284 6.38237 6.65904 6.43871 6.79145L6.62174 7.2216C5.98033 7.94301 5.48186 8.79434 5.17077 9.73116L4.70884 9.78747C4.566 9.80488 4.49458 9.81359 4.43292 9.82495C3.50404 9.99618 2.81138 10.7784 2.75382 11.7212C2.75 11.7838 2.75 11.8557 2.75 11.9996C2.75 12.1435 2.75 12.2155 2.75382 12.278C2.81138 13.2208 3.50404 14.003 4.43292 14.1743C4.49458 14.1856 4.566 14.1943 4.70884 14.2117L5.1704 14.268C5.48144 15.2052 5.97999 16.0568 6.62157 16.7785L6.43873 17.2082C6.38239 17.3406 6.35422 17.4068 6.33324 17.4659C6.01708 18.3559 6.34817 19.3469 7.13587 19.8681C7.18815 19.9027 7.25046 19.9387 7.37508 20.0107C7.4997 20.0826 7.56201 20.1186 7.61811 20.1466C8.46337 20.5681 9.48712 20.3594 10.0998 19.6405C10.1405 19.5928 10.1838 19.5353 10.2703 19.4203L10.55 19.0484C11.0184 19.1442 11.5034 19.1946 12.0001 19.1946C12.4969 19.1946 12.9818 19.1442 13.4503 19.0484L13.7299 19.4201C13.8164 19.5351 13.8596 19.5926 13.9003 19.6403C14.513 20.3591 15.5368 20.5679 16.382 20.1463C16.4381 20.1184 16.5004 20.0824 16.6251 20.0104C16.7497 19.9385 16.812 19.9025 16.8643 19.8679C17.652 19.3467 17.9831 18.3557 17.6669 17.4657C17.6459 17.4066 17.6177 17.3404 17.5614 17.208L17.3786 16.7785C18.0202 16.0568 18.5188 15.2052 18.8298 14.268L19.2912 14.2117C19.434 14.1943 19.5054 14.1856 19.5671 14.1743C20.496 14.003 21.1886 13.2208 21.2462 12.278C21.25 12.2155 21.25 12.1435 21.25 11.9996C21.25 11.8557 21.25 11.7838 21.2462 11.7212C21.1886 10.7784 20.496 9.99618 19.5671 9.82495C19.5054 9.81359 19.434 9.80488 19.2912 9.78747L18.8294 9.73118C18.7517 9.49698 18.6622 9.26811 18.5617 9.04528C18.2601 8.37679 17.8594 7.76261 17.3784 7.22156L17.5613 6.7916C17.6176 6.65919 17.6458 6.59299 17.6668 6.53391C17.983 5.64385 17.6519 4.65289 16.8642 4.13165C16.8119 4.09705 16.7496 4.06107 16.625 3.98912C16.5003 3.91718 16.438 3.8812 16.3819 3.85322C15.5367 3.43168 14.5129 3.64043 13.9002 4.35925C13.8595 4.40697 13.8163 4.46447 13.7298 4.57946L13.4497 4.95176C12.9815 4.85594 12.4967 4.80569 12.0001 4.80569C11.5035 4.80569 11.0187 4.856 10.5504 4.95181L10.2702 4.57932C10.1837 4.46432 10.1405 4.40682 10.0998 4.35911C9.4871 3.64028 8.46335 3.43153 7.61809 3.85307C7.56199 3.88105 7.49968 3.91703 7.37506 3.98898Z" />
                </svg>
              </button>

              <button
                className={`icon-btn pin-btn${isPinned ? ' pin-btn-on' : ''}`}
                type="button"
                aria-label={isPinned ? t('app.pin.disableAria') : t('app.pin.enableAria')}
                title={isPinned ? t('app.pin.disableTitle') : t('app.pin.enableTitle')}
                onClick={() => void handleTogglePin()}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8.375 15.625L12.2092 19.4592C13.3676 20.6175 15.351 19.9682 15.6001 18.3491L16.3396 13.5425C16.44 12.8901 16.8558 12.3292 17.4509 12.0435L20.2054 10.7214C21.4483 10.1248 21.729 8.47902 20.7542 7.50413L16.4959 3.24583C15.521 2.27093 13.8752 2.55164 13.2786 3.79458L11.9564 6.54908C11.6708 7.14417 11.1099 7.55999 10.4575 7.66036L5.65092 8.39984C4.03176 8.64894 3.38243 10.6324 4.54081 11.7908L8.375 15.625ZM8.375 15.625L3.75 20.25" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <div className="device-body">
          <div className="reading-column">
            <div className="reading-view">
              <div className="compose">
                <div className="compose-stage">
                  <textarea
                    ref={sourceInputRef}
                    className="compose-input"
                    value={sourceText}
                    onChange={handleSourceTextChange}
                    placeholder={t('app.input.placeholder', { shortcut: screenshotShortcut })}
                    rows={1}
                    spellCheck={false}
                    aria-label={t('app.input.aria')}
                  />
                </div>
              </div>

              <section className="result">
                <div className="result-scroll" ref={resultScrollRef}>
                  {errorMessage ? (
                    <p className="result-error" role="status" aria-live="polite">
                      {errorMessage}
                    </p>
                  ) : isRecognizing ? (
                    <div className="result-pending" role="status" aria-live="polite">
                      <p>{t('app.ocr.pending')}</p>
                      {ocrSlowHint ? (
                        <p className="result-pending-hint">{t('app.ocr.slowHint')}</p>
                      ) : null}
                    </div>
                  ) : status === 'translating' && !targetText.trim() ? (
                    <div
                      className="result-loader"
                      aria-live="polite"
                      aria-label={t('app.translating')}
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : hasTargetText ? (
                    <p
                      className={`result-text${
                        status === 'translating' ? ' result-text-streaming' : ''
                      }`}
                    >
                      {targetText}
                    </p>
                  ) : null}
                </div>

                <div className="result-toolbar" ref={resultToolbarRef}>
                  <div className="toolbar-left">
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={handleClearSource}
                      disabled={!hasSourceText}
                      aria-label={t('app.clearInput')}
                      title={t('app.clearInput')}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>

                    <button
                      ref={modelSelectorRef}
                      className="model-entry"
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={isModelMenuOpen}
                      aria-label={
                        activeProvider
                          ? t('app.provider.currentAria', {
                              provider: getProviderDisplayName(language, activeProvider),
                              model: selectedModel
                            })
                          : t('app.provider.noneAria')
                      }
                      title={
                        activeProvider
                          ? t('app.provider.tooltip', {
                              provider: getProviderDisplayName(language, activeProvider),
                              model: selectedModel,
                              baseUrl: activeProvider.baseUrl
                            })
                          : t('app.provider.noneHint')
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
                      {selectedModel || t('app.provider.unconfiguredModel')}
                    </button>
                  </div>

                  <button
                    className={`icon-btn${copyState === 'done' ? ' icon-btn-done' : ''}${
                      copyState === 'error' ? ' icon-btn-error' : ''
                    }`}
                    type="button"
                    onClick={() => void handleCopyTarget()}
                    disabled={!hasTargetText || status === 'translating'}
                    aria-label={copyState === 'done' ? t('app.copy.done') : t('app.copy.output')}
                    title={copyState === 'done' ? t('app.copy.done') : t('app.copy.output')}
                  >
                    {copyState === 'done' ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M15.25 8.75V4C15.25 3.30964 14.6904 2.75 14 2.75H4C3.30964 2.75 2.75 3.30964 2.75 4V14C2.75 14.6904 3.30964 15.25 4 15.25H8.75M10 8.75H20C20.6904 8.75 21.25 9.30964 21.25 10V20C21.25 20.6904 20.6904 21.25 20 21.25H10C9.30964 21.25 8.75 20.6904 8.75 20V10C8.75 9.30964 9.30964 8.75 10 8.75Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>

        {isDeckMounted ? (
          <div
            className={`terminal-engine-deck ${isDeckClosing ? 'terminal-engine-deck-closing' : ''}`}
            ref={engineDeckRef}
            role="dialog"
            aria-label={t('app.deck.dialogAria')}
          >
            <div className="terminal-engine-deck-header">
              <div className="terminal-engine-deck-title">{t('app.deck.title')}</div>
              <div className="terminal-engine-deck-actions">
                <button
                  type="button"
                  className="terminal-engine-deck-config"
                  onClick={() => {
                    closeModelMenu()
                    void window.api.openConfigWindow()
                  }}
                  aria-label={t('app.deck.settingsAria')}
                  title={t('app.deck.settingsTitle')}
                >
                  {t('app.deck.settings')}
                </button>
                <button
                  type="button"
                  className="terminal-engine-deck-close"
                  onClick={closeModelMenu}
                  aria-label={t('app.deck.closeAria')}
                  title={t('app.deck.closeTitle')}
                >
                  ✕
                </button>
              </div>
            </div>

            {enabledProviders.length > 0 ? (
              <div
                className="terminal-engine-models-list"
                role="listbox"
                aria-label={t('app.deck.listAria')}
              >
                {enabledProviders.flatMap((provider, providerIndex) => {
                  const rows = provider.models.map((model) => {
                    const isSelected =
                      provider.id === selectedProviderId && model.id === selectedModel
                    return (
                      <button
                        key={`${provider.id}-${model.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`terminal-engine-option ${
                          isSelected ? 'terminal-engine-option-selected' : ''
                        }`}
                        onClick={() => handleModelSelect(provider.id, model.id)}
                        title={`${model.id} · ${getProviderDisplayName(language, provider)}`}
                      >
                        <span className="terminal-engine-name">{model.id}</span>
                        <span className="terminal-engine-provider">
                          {getProviderDisplayName(language, provider)}
                        </span>
                      </button>
                    )
                  })

                  if (providerIndex === 0) return rows
                  return [
                    <div
                      key={`sep-${provider.id}`}
                      className="terminal-engine-group-sep"
                      aria-hidden="true"
                    />,
                    ...rows
                  ]
                })}
              </div>
            ) : (
              <div className="terminal-engine-empty-hint">{t('app.deck.empty')}</div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
