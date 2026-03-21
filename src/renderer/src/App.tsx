import { useState } from 'react'
import menuIcon from './assets/menu-icon.svg'
import pinIcon from './assets/pin-icon.svg'

function App(): React.JSX.Element {
  const [sourceText, setSourceText] = useState(
    `Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.Hello, how are you today? I am testing the professional industrial handheld translator layout to ensure it handles long text content properly with a fixed-height display area and internal scrolling.`
  )
  const targetText = `你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。`

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
              <span>READY_V1.1</span>
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
                onChange={(event) => setSourceText(event.target.value)}
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
