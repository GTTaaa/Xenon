import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConfigPage } from './ConfigPage'

const searchParams = new URLSearchParams(window.location.search)
const isConfigWindow = searchParams.get('window') === 'config'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isConfigWindow ? <ConfigPage /> : <App />}</StrictMode>
)
