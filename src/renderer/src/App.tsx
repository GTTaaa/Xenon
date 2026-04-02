import { useEffect, useRef, useState } from 'react'
import menuIcon from './assets/menu-icon.svg'
import pinIcon from './assets/pin-icon.svg'

const SOURCE_LANGUAGE = 'ENGLISH'
const TARGET_LANGUAGE = 'CHINESE (SIM)'
type TranslateStatus = 'idle' | 'translating' | 'error'
const DEFAULT_MODEL = 'step-3.5-flash'
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
  const [sourceText, setSourceText] = useState(
    `Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.`
  )
  // const targetText = `你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。`
  // const [targetText, setTargetText] = useState('等待翻译结果...')
  const [targetText, setTargetText] = useState('')
  // const [statusText, setStatusText] = useState('READY_V1.1')
  const [status, setStatus] = useState<TranslateStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const requestIdRef = useRef(0)
  const [selectedModel] = useState(DEFAULT_MODEL)

  useEffect(() => {
    if (!sourceText.trim()) return

    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current

    // 防抖处理，避免频繁调用翻译接口
    const timer = window.setTimeout(async () => {
      console.log('[renderer] runTranslation start', {
        text: sourceText,
        requestId: currentRequestId
      })

      const response = await window.api.translateText({
        text: sourceText,
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: TARGET_LANGUAGE,
        options: {
          model: selectedModel
        }
      })

      if (currentRequestId !== requestIdRef.current) return

      if (response.ok) {
        setTargetText(response.text)
        setErrorMessage('')
        setStatus('idle')
        return
      }

      setErrorMessage(getUserFriendlyErrorMessage(response.error.code))
      console.error('[renderer] translate error', response.error.code, response.error.message)
      setStatus('error')
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [selectedModel, sourceText])

  const handleSourceTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextText = event.target.value

    setSourceText(nextText)

    if (!nextText.trim()) {
      setTargetText('')
      setErrorMessage('')
      setStatus('idle')
      return
    }

    setErrorMessage('')
    setStatus('translating')
  }
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
            <div className="model-inline-tag" aria-label={`当前模型 ${selectedModel}`}>
              <span className="model-inline-tag-label">MODEL</span>
              <span className="model-inline-tag-value">{selectedModel}</span>
            </div>
          </div>
          <div className="display-screen display-screen-source">
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
          </div>
        </section>
        <section className="display-section">
          <p className="language-label">TARGET: {TARGET_LANGUAGE}</p>
          <div className="display-screen display-screen-target">
            <div className="display-scroll">
              <p className={`display-content ${!targetText ? 'display-placeholder' : ''}`}>
                {targetText || '等待翻译结果...'}
              </p>
            </div>
          </div>

          {errorMessage ? <p className="translate-error">{errorMessage}</p> : null}
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
