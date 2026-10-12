import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderItem, ShortcutSettings } from '../../shared/config'

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
// 输入区字号 13px × 行高 1.5，用来把输入框内容高度换算成行数（与 .compose-input 保持一致）
const INPUT_LINE_HEIGHT = 19.5
// 输入区最多长到 3 行，再多交给输入框自己滚动
const MAX_INPUT_LINES = 3
// 窗口高度只在这两档之间浮动：1 行输入 330px 紧凑机身，3 行输入 430px 封顶
const WINDOW_HEIGHT_MIN = 330
const WINDOW_HEIGHT_MAX = 430
// 每多一行输入窗口加 50px：多出来的空间留给译文区，而不是把译文区压扁
const WINDOW_HEIGHT_PER_INPUT_LINE = 50

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
 * 语言名的极短中文显示：列表标签去掉括号里的原文，例如「英语 (English)」→「英语」。
 * 头部一行要同时放下两种语言，用不了「CHINESE (SIM)」这种长写法。
 */
function getShortLanguageLabel(code: SupportedLanguage): string {
  if (code === 'auto') return '自动'
  return getLanguageInfo(code).label.split(' (')[0]
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
  const modelSelectorRef = useRef<HTMLButtonElement | null>(null)
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

  // 头部语言行：源语言名（自动模式下显示当前识别出的语言，识别不出就写"自动"）
  const sourceLanguageName = useMemo(() => {
    if (sourceLanguage !== 'auto') return getShortLanguageLabel(sourceLanguage)
    return sourceText.trim() ? getShortLanguageLabel(detectedInfo.detected) : '自动'
  }, [sourceLanguage, sourceText, detectedInfo.detected])

  // 头部语言行：目标语言名（自动匹配时显示匹配结果）
  const targetLanguageName = useMemo(
    () => getShortLanguageLabel(effectiveTargetLang),
    [effectiveTargetLang]
  )

  const deviceRef = useRef<HTMLElement | null>(null)

  // 缓存上一次同步给 Electron 主进程的窗口高度，避免高频冗余触发
  const lastSentHeightRef = useRef<number>(0)

  /**
   * 输入区高度与窗口高度联动。
   * 窗口高度由"输入行数"算出，而不是读 DOM 实测高度 ——
   * 译文区是 flex:1 撑满剩余空间的，用实测高度会形成"测量 → 改窗口 → 再测量"的自激循环。
   */
  const syncInputHeight = useCallback((): void => {
    const textarea = sourceInputRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const contentHeight = textarea.scrollHeight
    // 行数只取 1–3 行：再多也只让输入框自己滚动，不继续顶窗口
    const lineCount = Math.max(
      1,
      Math.min(MAX_INPUT_LINES, Math.round(contentHeight / INPUT_LINE_HEIGHT))
    )
    // 高度按整行取整，避免内容高度里的小数点让输入框每次输入都抖动 1px
    textarea.style.height = `${Math.min(lineCount * INPUT_LINE_HEIGHT, contentHeight)}px`

    const nextWindowHeight = Math.min(
      WINDOW_HEIGHT_MAX,
      WINDOW_HEIGHT_MIN + (lineCount - 1) * WINDOW_HEIGHT_PER_INPUT_LINE
    )

    // 仅当高度发生有效变化（>= 2px）时才派发 IPC，杜绝微小晃动与性能浪费
    if (Math.abs(lastSentHeightRef.current - nextWindowHeight) >= 2) {
      lastSentHeightRef.current = nextWindowHeight
      void window.api.setWindowHeight(nextWindowHeight)
    }
  }, [])

  useEffect(() => {
    syncInputHeight()
  }, [sourceText, syncInputHeight])

  // 组件卸载时清理退出定时器
  useEffect(() => {
    return () => {
      if (deckClosingTimerRef.current) {
        clearTimeout(deckClosingTimerRef.current)
      }
    }
  }, [])

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

  // 空态提示里的截图快捷键：跟随用户在设置里自定义的键位，读不到就退回默认值
  const [screenshotShortcut, setScreenshotShortcut] = useState('Alt+S')

  useEffect(() => {
    const applyShortcut = (next: ShortcutSettings | undefined): void => {
      setScreenshotShortcut(next?.screenshot || 'Alt+S')
    }

    window.api
      .getConfig()
      .then((cfg) => applyShortcut(cfg.shortcuts))
      .catch((err) => console.error('[renderer] 读取截图快捷键失败', err))

    return window.api.onConfigUpdated((cfg) => applyShortcut(cfg.shortcuts))
  }, [])
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

  return (
    <main className="translator-device" ref={deviceRef}>
      <section className="device-panel">
        <header className="lang-bar">
          <div className="lang-slot" ref={sourceLangSelectorRef}>
            <button
              type="button"
              className="lang-trigger"
              aria-haspopup="listbox"
              aria-expanded={isSourceLangMenuOpen}
              title="切换源语言"
              onClick={() => {
                setIsSourceLangMenuOpen((open) => !open)
                setIsTargetLangMenuOpen(false)
                closeModelMenu()
              }}
            >
              <span className="lang-name">{sourceLanguageName}</span>
              {sourceLanguage === 'auto' && hasSourceText ? (
                <span className="lang-sub">自动</span>
              ) : null}
            </button>

            {isSourceLangMenuOpen ? (
              <div className="lang-menu" role="listbox" aria-label="源语言选择">
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isSelected = lang.code === sourceLanguage

                  return (
                    <button
                      key={lang.code}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`lang-option${isSelected ? ' lang-option-on' : ''}`}
                      onClick={() => {
                        setIsSourceLangMenuOpen(false)
                        if (sourceLanguage === lang.code) return
                        setSourceLanguage(lang.code)
                        if (sourceText.trim()) {
                          markTranslationPending()
                        }
                      }}
                    >
                      {lang.label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <span className="flow-swap" aria-hidden="true">
            <svg
              width="13"
              height="13"
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

          <div className="lang-slot lang-slot-target" ref={targetLangSelectorRef}>
            <button
              type="button"
              className="lang-trigger"
              aria-haspopup="listbox"
              aria-expanded={isTargetLangMenuOpen}
              title="切换目标语言"
              onClick={() => {
                setIsTargetLangMenuOpen((open) => !open)
                setIsSourceLangMenuOpen(false)
                closeModelMenu()
              }}
            >
              <span className="lang-name">{targetLanguageName}</span>
            </button>

            {isTargetLangMenuOpen ? (
              <div className="lang-menu" role="listbox" aria-label="目标语言选择">
                <button
                  type="button"
                  role="option"
                  aria-selected={manualTargetLang === null}
                  className={`lang-option${manualTargetLang === null ? ' lang-option-on' : ''}`}
                  title="跟随源语言自动匹配"
                  onClick={() => {
                    setIsTargetLangMenuOpen(false)
                    if (manualTargetLang === null) return
                    setManualTargetLang(null)
                    if (sourceText.trim()) {
                      markTranslationPending()
                    }
                  }}
                >
                  自动匹配
                </button>

                {SUPPORTED_LANGUAGES.filter((lang) => lang.code !== 'auto').map((lang) => {
                  const isSelected = manualTargetLang === lang.code

                  return (
                    <button
                      key={lang.code}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`lang-option${isSelected ? ' lang-option-on' : ''}`}
                      onClick={() => {
                        setIsTargetLangMenuOpen(false)
                        if (manualTargetLang === lang.code) return
                        setManualTargetLang(lang.code)
                        if (sourceText.trim()) {
                          markTranslationPending()
                        }
                      }}
                    >
                      {lang.label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <button
            className={`icon-btn pin-btn${isPinned ? ' pin-btn-on' : ''}`}
            type="button"
            aria-label={isPinned ? '取消固定窗口' : '固定窗口置顶'}
            title={isPinned ? '当前已置顶（点击取消）' : '点击置顶窗口'}
            onClick={() => void handleTogglePin()}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 17v5" />
              <path d="M9 3h6l-.8 5.2 2.8 2.6V13H7v-2.2l2.8-2.6L9 3z" />
            </svg>
          </button>
        </header>

        <div className="device-body">
          <div className="compose">
            <textarea
              ref={sourceInputRef}
              className="compose-input"
              value={sourceText}
              onChange={handleSourceTextChange}
              placeholder={`截图 ${screenshotShortcut}，或直接输入 / 粘贴文字`}
              rows={1}
              spellCheck={false}
              aria-label="源文本输入框"
            />
          </div>

          <section className="result">
            <div className="result-scroll">
              {errorMessage ? (
                <p className="result-error" role="status" aria-live="polite">
                  {errorMessage}
                </p>
              ) : null}

              {status === 'translating' ? (
                <div className="result-loader" aria-live="polite" aria-label="正在翻译">
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <p className={`result-text${targetText ? '' : ' result-placeholder'}`}>
                  {targetText || '译文会显示在这里'}
                </p>
              )}
            </div>

            <div className="result-toolbar">
              <div className="toolbar-left">
                <button
                  className="icon-btn"
                  type="button"
                  onClick={handleClearSource}
                  disabled={!hasSourceText}
                  aria-label="清空输入"
                  title="清空输入"
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
                      ? `当前服务商: ${activeProvider.name}，模型: ${selectedModel}，点击打开模型面板`
                      : '当前没有启用任何服务商，点击打开模型面板查看'
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
                  {selectedModel || '未配置模型'}
                </button>
              </div>

              <button
                className={`icon-btn${copyState === 'done' ? ' icon-btn-done' : ''}${
                  copyState === 'error' ? ' icon-btn-error' : ''
                }`}
                type="button"
                onClick={() => void handleCopyTarget()}
                disabled={!hasTargetText || status === 'translating'}
                aria-label={copyState === 'done' ? '复制完成' : '复制输出'}
                title={copyState === 'done' ? '复制完成' : '复制输出'}
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
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* 模型面板：结构与交互沿用原实现，配色并入中性极简体系 */}
        {isDeckMounted ? (
          <div
            className={`terminal-engine-deck ${isDeckClosing ? 'terminal-engine-deck-closing' : ''}`}
            ref={engineDeckRef}
            role="dialog"
            aria-label="翻译引擎选择面板"
          >
            <div className="terminal-engine-deck-header">
              <div className="terminal-engine-deck-title">模型</div>
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
                  设置
                </button>
                <button
                  type="button"
                  className="terminal-engine-deck-close"
                  onClick={() => closeModelMenu()}
                  aria-label="关闭模型面板"
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
                    const isSelected = prov.id === selectedProviderId && item.id === selectedModel
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
              /* 一个启用的服务商都没有：点右上角「设置」去启用，不再列出写死的示例模型 */
              <div className="terminal-engine-empty-hint">
                还没有启用任何服务商，点右上角「设置」去启用
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
