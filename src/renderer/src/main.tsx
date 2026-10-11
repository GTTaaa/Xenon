import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConfigPage } from './ConfigPage'
import { clearLegacyLocalStorage } from './utils/clearLegacyStorage'

// 启动即清掉历史遗留的本地存储键（见 utils/clearLegacyStorage.ts）
clearLegacyLocalStorage()

const searchParams = new URLSearchParams(window.location.search)
const isConfigWindow = searchParams.get('window') === 'config'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isConfigWindow ? <ConfigPage /> : <App />}</StrictMode>
)
