import { useEffect, useRef, useState } from 'react'
import menuIcon from './assets/menu-icon.svg'
import pinIcon from './assets/pin-icon.svg'
import { fakeTranslate } from './services/translator'

function App(): React.JSX.Element {
  const [sourceText, setSourceText] = useState(
    `Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.`
  )
  // const targetText = `你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。`
  const [targetText, setTargetText] = useState('等待翻译结果...')
  const [statusText, setStatusText] = useState('READY_V1.1')
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!sourceText.trim()) return

    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current

    const timer = window.setTimeout(async () => {
      try {
        const result = await fakeTranslate(sourceText)
        if (currentRequestId !== requestIdRef.current) return

        setTargetText(result)
        setStatusText('READY_V1.1')
      } catch {
        if (currentRequestId !== requestIdRef.current) return

        setTargetText('翻译失败，请重试。')
        setStatusText('ERROR')
      }
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [sourceText])

  const handleSourceTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextText = event.target.value

    setSourceText(nextText)

    if (!nextText.trim()) {
      setTargetText('等待翻译结果...')
      setStatusText('READY_V1.1')
      return
    }

    setStatusText('TRANSLATING')
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
            <div className="status-value">
              <span className="status-dot" />
              <span>{statusText}</span>
            </div>
          </div>

          <button className="panel-button pin-button" type="button" aria-label="固定窗口">
            <img className="panel-icon" src={pinIcon} alt="" />
          </button>
        </header>

        <section className="display-section">
          <p className="language-label">SOURCE: ENGLISH</p>
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
          <p className="language-label">TARGET: CHINESE (SIM)</p>
          <div className="display-screen display-screen-target">
            <div className="display-scroll">
              <p className="display-content">{targetText}</p>
            </div>
          </div>
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
