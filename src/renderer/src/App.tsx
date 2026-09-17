import { useEffect, useMemo, useRef, useState } from 'react'
import menuIcon from './assets/menu-icon.svg'
import pinIcon from './assets/pin-icon.svg'
import { ConfigModal } from './components/ConfigModal'
import type { LLMConfig, ModelOptionItem } from '../../shared/config'
import {
  detectLanguage,
  getLanguageInfo,
  resolveAutoTargetLanguage,
  resolvePromptLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage
} from '../../shared/languageDetector'

type TranslateStatus = 'idle' | 'translating' | 'error'

const DEFAULT_MODEL = 'step-3.5-flash'
const INITIAL_SOURCE_TEXT =
  'Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.'
const INITIAL_MODEL_OPTIONS: ModelOptionItem[] = [
  {
    value: 'step-3.5-flash',
    code: 'A1',
    profile: 'FAST RESPONSE'
  },
  {
    value: 'gpt-4o-mini',
    code: 'B2',
    profile: 'BALANCED MODE'
  },
  {
    value: 'claude-3.5-haiku',
    code: 'C3',
    profile: 'LOW COST'
  }
]

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
  const [modelOptions, setModelOptions] = useState<ModelOptionItem[]>(INITIAL_MODEL_OPTIONS)
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
  const [enableThinking, setEnableThinking] = useState<boolean>(() => {
    const saved = localStorage.getItem('enableThinking')
    return saved === 'true'
  })
  const [selectedModel, setSelectedModel] = useState(() => {
    const savedModel = localStorage.getItem('selectedModel')
    if (!savedModel) return DEFAULT_MODEL

    const isValidModel = INITIAL_MODEL_OPTIONS.some((option) => option.value === savedModel)
    if (!isValidModel) {
      localStorage.removeItem('selectedModel')
      return DEFAULT_MODEL
    }

    return savedModel
  })
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement | null>(null)

  // 用户选中的源语言模式（'auto' 或指定语言）
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

  const [isSourceLangMenuOpen, setIsSourceLangMenuOpen] = useState(false)
  const [isTargetLangMenuOpen, setIsTargetLangMenuOpen] = useState(false)
  const sourceLangSelectorRef = useRef<HTMLDivElement | null>(null)
  const targetLangSelectorRef = useRef<HTMLDivElement | null>(null)

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
      return sourceText.trim() ? detectedInfo.languageInfo.promptName : 'AUTO'
    }
    return getLanguageInfo(sourceLanguage).promptName
  }, [sourceLanguage, sourceText, detectedInfo.languageInfo.promptName])

  // 初始加载后端持久化的大模型配置与模型列表
  useEffect(() => {
    window.api
      .getConfig()
      .then((cfg) => {
        if (Array.isArray(cfg.modelOptions) && cfg.modelOptions.length > 0) {
          setModelOptions(cfg.modelOptions)
        }
        const savedModel = localStorage.getItem('selectedModel')
        if (savedModel && cfg.modelOptions?.some((opt) => opt.value === savedModel)) {
          setSelectedModel(savedModel)
        } else if (cfg.model) {
          setSelectedModel(cfg.model)
        }
        if (
          localStorage.getItem('enableThinking') === null &&
          typeof cfg.enableThinking === 'boolean'
        ) {
          setEnableThinking(cfg.enableThinking)
        }
      })
      .catch((err) => {
        console.error('[renderer] 初始化加载配置失败', err)
      })
  }, [])

  const resetTranslationState = (): void => {
    setTargetText('')
    setErrorMessage('')
    setStatus('idle')
  }

  const markTranslationPending = (): void => {
    setErrorMessage('')
    setStatus('translating')
  }

  // 监听托盘快捷打开配置面板事件
  useEffect(() => {
    return window.api.onOpenConfig(() => {
      setIsConfigModalOpen(true)
    })
  }, [])

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

  // 切换大模型思考模式
  const handleToggleThinking = (): void => {
    setEnableThinking((prev) => {
      const next = !prev
      localStorage.setItem('enableThinking', String(next))
      return next
    })
    if (sourceText.trim()) {
      markTranslationPending()
    }
  }

  // 配置保存成功后的联动处理
  const handleConfigSaved = (newConfig: LLMConfig): void => {
    if (Array.isArray(newConfig.modelOptions) && newConfig.modelOptions.length > 0) {
      setModelOptions(newConfig.modelOptions)
    }
    if (newConfig.model) {
      setSelectedModel(newConfig.model)
    }
    if (typeof newConfig.enableThinking === 'boolean') {
      setEnableThinking(newConfig.enableThinking)
      localStorage.setItem('enableThinking', String(newConfig.enableThinking))
    }
    if (sourceText.trim()) {
      markTranslationPending()
    }
  }

  // 监听多浮层外部点击与 Esc 按键关闭
  useEffect(() => {
    if (!isModelMenuOpen && !isSourceLangMenuOpen && !isTargetLangMenuOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (isModelMenuOpen && !modelSelectorRef.current?.contains(target)) {
        setIsModelMenuOpen(false)
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
        setIsModelMenuOpen(false)
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
  }, [isModelMenuOpen, isSourceLangMenuOpen, isTargetLangMenuOpen])

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
      const response = await window.api.translateText({
        text: sourceText,
        sourceLanguage: effectiveSourcePrompt,
        targetLanguage: effectiveTargetPrompt,
        options: {
          model: selectedModel,
          enableThinking
        }
      })
      if (currentRequestId !== requestIdRef.current) return

      if (response.ok) {
        setTargetText(response.text)
        setErrorMessage('')
        setStatus('idle')
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
    selectedModel,
    sourceText,
    enableThinking,
    sourceLanguage,
    effectiveTargetLang,
    detectedInfo.detected
  ])

  // 互换源语言与目标语言（包括对应文本内容）
  const handleSwapLanguages = (): void => {
    if (sourceLanguage !== 'auto') {
      const prevSource = sourceLanguage
      const prevTarget = effectiveTargetLang
      setSourceLanguage(prevTarget)
      setManualTargetLang(prevSource)
    } else {
      const detected = detectedInfo.detected
      setManualTargetLang(detected)
    }

    // 互换文本内容
    if (targetText.trim()) {
      const prevTarget = targetText
      setSourceText(prevTarget)
      setTargetText('')
      markTranslationPending()
    }
  }

  useEffect(() => {
    return window.api.onFocusInput(() => {
      sourceInputRef.current?.focus()
      sourceInputRef.current?.select()
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('selectedModel', selectedModel)
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

  const handleModelSelect = (nextModel: string): void => {
    setSelectedModel(nextModel)
    setIsModelMenuOpen(false)

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
    <main className="translator-device">
      <section className={`device-panel ${errorMessage ? 'device-panel-error' : ''}`}>
        <header className="device-header">
          <button
            className="panel-button"
            type="button"
            aria-label="打开大模型配置"
            title="打开大模型配置"
            onClick={() => setIsConfigModalOpen(true)}
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

          <button className="panel-button pin-button" type="button" aria-label="固定窗口">
            <img className="panel-icon" src={pinIcon} alt="" />
          </button>
        </header>

        <section className="display-section">
          <div className="display-section-header">
            <div className="lang-header-item" ref={sourceLangSelectorRef}>
              <button
                className={`lang-badge-button ${isSourceLangMenuOpen ? 'lang-badge-button-open' : ''}`}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isSourceLangMenuOpen}
                aria-label={`当前源语言: ${sourceLanguage === 'auto' ? `自动检测 (当前识别: ${detectedInfo.languageInfo.label})` : getLanguageInfo(sourceLanguage).label}，点击切换`}
                onClick={() => {
                  setIsSourceLangMenuOpen((open) => !open)
                  setIsTargetLangMenuOpen(false)
                  setIsModelMenuOpen(false)
                }}
              >
                <span className="language-label">
                  SOURCE: <span className="language-label-value">{sourceDisplayPrompt}</span>
                </span>
                {sourceLanguage === 'auto' && sourceText.trim() ? (
                  <span
                    className="lang-pill"
                    title={`已自动识别: ${detectedInfo.languageInfo.label} (置信度: ${Math.round(detectedInfo.confidence * 100)}%)`}
                  >
                    AUTO
                  </span>
                ) : null}
              </button>

              {isSourceLangMenuOpen ? (
                <div className="lang-switcher-panel" role="dialog" aria-label="源语言选择面板">
                  <div className="lang-switcher-panel-header">
                    <span>SELECT SOURCE</span>
                    <span>{SUPPORTED_LANGUAGES.length.toString().padStart(2, '0')} UNITS</span>
                  </div>
                  <div className="lang-switcher-list" role="listbox" aria-label="源语言列表">
                    {SUPPORTED_LANGUAGES.map((lang) => {
                      const isSelected = lang.code === sourceLanguage

                      return (
                        <button
                          key={lang.code}
                          className={`lang-option ${isSelected ? 'lang-option-selected' : ''}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setSourceLanguage(lang.code)
                            setIsSourceLangMenuOpen(false)
                            if (sourceText.trim()) {
                              markTranslationPending()
                            }
                          }}
                        >
                          <span className="lang-option-code">{lang.shortLabel}</span>
                          <span className="lang-option-body">
                            <span className="lang-option-name">{lang.label}</span>
                            {lang.code === 'auto' && sourceText.trim() ? (
                              <span className="lang-option-sub">
                                识别: {detectedInfo.languageInfo.label}
                              </span>
                            ) : null}
                          </span>
                          <span className="lang-option-indicator" aria-hidden="true" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="display-section-tools">
              <div className="model-selector" ref={modelSelectorRef}>
                <button
                  className={`model-switcher-trigger ${isModelMenuOpen ? 'model-switcher-trigger-open' : ''}`}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={isModelMenuOpen}
                  aria-label={`当前模型 ${selectedModel}，点击切换模型`}
                  onClick={() => setIsModelMenuOpen((open) => !open)}
                >
                  <span className="model-switcher-label">MODEL BANK</span>
                  <span className="model-switcher-value" title={selectedModel}>
                    {selectedModel}
                  </span>
                </button>

                {isModelMenuOpen ? (
                  <div className="model-switcher-panel" role="dialog" aria-label="模型切换面板">
                    <div className="model-switcher-panel-header">
                      <span>SELECT ENGINE</span>
                      <span>{modelOptions.length.toString().padStart(2, '0')} UNITS</span>
                    </div>
                    <div className="model-switcher-list" role="listbox" aria-label="可用模型列表">
                      {modelOptions.map((option) => {
                        const isSelected = option.value === selectedModel

                        return (
                          <button
                            key={option.value}
                            className={`model-option ${isSelected ? 'model-option-selected' : ''}`}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleModelSelect(option.value)}
                          >
                            <span className="model-option-code">{option.code}</span>
                            <span className="model-option-body">
                              <span className="model-option-name">{option.value}</span>
                              <span className="model-option-profile">{option.profile}</span>
                            </span>
                            <span className="model-option-indicator" aria-hidden="true" />
                          </button>
                        )
                      })}
                    </div>
                    <div className="model-switcher-panel-footer">
                      <button
                        type="button"
                        className="model-switcher-config-btn"
                        onClick={() => {
                          setIsModelMenuOpen(false)
                          setIsConfigModalOpen(true)
                        }}
                      >
                        ⚙ CONFIGURE ENGINES
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
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
                    className={`display-screen-action-button display-screen-action-button-think ${
                      enableThinking ? 'display-screen-action-button-think-active' : ''
                    }`}
                    type="button"
                    onClick={handleToggleThinking}
                    aria-label={
                      enableThinking
                        ? '深度思考模式: 已开启 (点击关闭)'
                        : '深度思考模式: 已关闭 (点击开启)'
                    }
                    title={
                      enableThinking
                        ? '深度思考模式: 已开启 (点击关闭)'
                        : '深度思考模式: 已关闭 (点击开启)'
                    }
                  >
                    {enableThinking ? (
                      <svg
                        className="display-screen-action-icon display-screen-action-icon-toggle"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        {/* 开启态：通透亮绿线框胶囊 + 微弱通电底色 + 右侧实心亮绿滑块 */}
                        <rect
                          x="2.5"
                          y="5.5"
                          width="19"
                          height="13"
                          rx="6.5"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          fill="currentColor"
                          fillOpacity="0.14"
                        />
                        <circle cx="15.5" cy="12" r="4" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg
                        className="display-screen-action-icon display-screen-action-icon-toggle"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        {/* 关闭态：暗线空心胶囊 + 左侧暗淡滑块 */}
                        <rect
                          x="2.5"
                          y="5.5"
                          width="19"
                          height="13"
                          rx="6.5"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          fill="none"
                        />
                        <circle cx="8.5" cy="12" r="3.4" fill="currentColor" fillOpacity="0.7" />
                      </svg>
                    )}
                  </button>
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
        <section className="display-section">
          <div className="display-section-header">
            <div className="lang-header-item" ref={targetLangSelectorRef}>
              <button
                className={`lang-badge-button ${isTargetLangMenuOpen ? 'lang-badge-button-open' : ''}`}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isTargetLangMenuOpen}
                aria-label={`当前目标语言: ${getLanguageInfo(effectiveTargetLang).label}，点击切换`}
                onClick={() => {
                  setIsTargetLangMenuOpen((open) => !open)
                  setIsSourceLangMenuOpen(false)
                  setIsModelMenuOpen(false)
                }}
              >
                <span className="language-label">
                  TARGET:{' '}
                  <span className="language-label-value">
                    {getLanguageInfo(effectiveTargetLang).promptName}
                  </span>
                </span>
              </button>

              {isTargetLangMenuOpen ? (
                <div className="lang-switcher-panel" role="dialog" aria-label="目标语言选择面板">
                  <div className="lang-switcher-panel-header">
                    <span>SELECT TARGET</span>
                    <span>MODE</span>
                  </div>
                  <div className="lang-switcher-list" role="listbox" aria-label="目标语言列表">
                    <button
                      className={`lang-option ${manualTargetLang === null ? 'lang-option-selected' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={manualTargetLang === null}
                      onClick={() => {
                        setManualTargetLang(null)
                        setIsTargetLangMenuOpen(false)
                        if (sourceText.trim()) {
                          markTranslationPending()
                        }
                      }}
                    >
                      <span className="lang-option-code">AUTO</span>
                      <span className="lang-option-body">
                        <span className="lang-option-name">智能自动匹配</span>
                        <span className="lang-option-sub">根据输入语言自动对偶切换</span>
                      </span>
                      <span className="lang-option-indicator" aria-hidden="true" />
                    </button>

                    {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => {
                      const isSelected = manualTargetLang === lang.code

                      return (
                        <button
                          key={lang.code}
                          className={`lang-option ${isSelected ? 'lang-option-selected' : ''}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setManualTargetLang(lang.code)
                            setIsTargetLangMenuOpen(false)
                            if (sourceText.trim()) {
                              markTranslationPending()
                            }
                          }}
                        >
                          <span className="lang-option-code">{lang.shortLabel}</span>
                          <span className="lang-option-body">
                            <span className="lang-option-name">{lang.label}</span>
                          </span>
                          <span className="lang-option-indicator" aria-hidden="true" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="display-section-tools">
              <button
                className="lang-swap-icon-button"
                type="button"
                onClick={handleSwapLanguages}
                title="互换翻译方向与内容"
                aria-label="互换源语言与目标语言"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 10l-4 4 4 4" />
                  <path d="M3 14h14" />
                  <path d="M17 14l4-4-4-4" />
                  <path d="M21 10H7" />
                </svg>
              </button>
            </div>
          </div>
          <div className="display-screen display-screen-target">
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
          </div>

          {errorMessage ? (
            <p className="translate-error" role="status" aria-live="polite">
              <span className="translate-error-label">SYSTEM NOTICE</span>
              <span className="translate-error-text">{errorMessage}</span>
            </p>
          ) : null}
        </section>
      </section>

      {/* 大模型配置弹窗 */}
      <ConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onConfigSaved={handleConfigSaved}
      />
    </main>
  )
}

export default App
