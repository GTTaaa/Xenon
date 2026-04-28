import { ElectronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'

interface AppAPI {
  translateText: (request: TranslateRequest) => Promise<TranslateResponse>
  onFocusInput: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
