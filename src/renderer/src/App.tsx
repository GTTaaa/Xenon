import { useEffect, useRef, useState } from 'react'
import menuIcon from './assets/menu-icon.svg'
import pinIcon from './assets/pin-icon.svg'

const SOURCE_LANGUAGE = 'ENGLISH'
const TARGET_LANGUAGE = 'CHINESE (SIM)'
type TranslateStatus = 'idle' | 'translating' | 'error'
type ModelOption = {
  value: string
  code: string
  profile: string
}

const DEFAULT_MODEL = 'step-3.5-flash'
const INITIAL_SOURCE_TEXT =
  'Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.'
const MODEL_OPTIONS: ModelOption[] = [
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
  const [selectedModel, setSelectedModel] = useState(() => {
    const savedModel = localStorage.getItem('selectedModel')
    if (!savedModel) return DEFAULT_MODEL

    const isValidModel = MODEL_OPTIONS.some((option) => option.value === savedModel)
    if (!isValidModel) {
      localStorage.removeItem('selectedModel')
      return DEFAULT_MODEL
    }

    return savedModel
  })
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement | null>(null)

  const resetTranslationState = (): void => {
    setTargetText('')
    setErrorMessage('')
    setStatus('idle')
  }

  const markTranslationPending = (): void => {
    setErrorMessage('')
    setStatus('translating')
  }

  useEffect(() => {
    if (!isModelMenuOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      if (!modelSelectorRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsModelMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isModelMenuOpen])

  useEffect(() => {
    const trimmedSourceText = sourceText.trim()
    if (!trimmedSourceText) return

    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current
    // console.log(trimmedSourceText)
    // 防抖处理，避免频繁调用翻译接口
    const timer = window.setTimeout(async () => {
      // console.log('[renderer] runTranslation start', {
      //   text: trimmedSourceText,
      //   requestId: currentRequestId
      // })
      const response = await window.api.translateText({
        text: trimmedSourceText,
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: TARGET_LANGUAGE,
        options: {
          model: selectedModel
        }
      })
      // console.log(response)
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
  }, [selectedModel, sourceText])

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
      <section className="device-panel">
        <header className="device-header">
          <button className="panel-button" type="button" aria-label="打开菜单">
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
            <p className="language-label">SOURCE: {SOURCE_LANGUAGE}</p>
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
                      <span>{MODEL_OPTIONS.length.toString().padStart(2, '0')} UNITS</span>
                    </div>
                    <div className="model-switcher-list" role="listbox" aria-label="可用模型列表">
                      {MODEL_OPTIONS.map((option) => {
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
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="display-screen display-screen-source">
            <div className="display-screen-body">
              <div className="display-scroll">
                <textarea
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
          <p className="language-label">TARGET: {TARGET_LANGUAGE}</p>
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

        <footer className="device-footer">
          <span>LABORATORY UNIT #402-B // ANALOG CONVERTER</span>
          <i />
        </footer>
      </section>
    </main>
  )
}

export default App
