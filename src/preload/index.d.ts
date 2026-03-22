import { ElectronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'

interface AppAPI {
  translateText: (request: TranslateRequest) => Promise<TranslateResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
