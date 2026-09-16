import { ElectronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'
import type { LLMConfig, TestConnectionResult } from '../shared/config'

interface AppAPI {
  translateText: (request: TranslateRequest) => Promise<TranslateResponse>
  onFocusInput: (callback: () => void) => () => void
  getConfig: () => Promise<LLMConfig>
  saveConfig: (config: LLMConfig) => Promise<{ ok: boolean; error?: string }>
  testConfig: (config: LLMConfig) => Promise<TestConnectionResult>
  onOpenConfig: (callback: () => void) => () => void
  captureScreen: () => Promise<{ ok: boolean; message?: string }>
  onApplySourceText: (callback: (text: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
