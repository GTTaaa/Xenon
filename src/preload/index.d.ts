import { ElectronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'
import type { AlignTextRequest, AlignTextResponse } from '../shared/textAlignment'
import type { AppSettings, FetchModelsResult, TestConnectionResult } from '../shared/config'
import type { OcrStatus } from '../shared/ocr'

interface AppAPI {
  translateText: (request: TranslateRequest) => Promise<TranslateResponse>
  alignText: (request: AlignTextRequest) => Promise<AlignTextResponse>
  onFocusInput: (callback: () => void) => () => void
  getConfig: () => Promise<AppSettings>
  saveConfig: (config: AppSettings) => Promise<{ ok: boolean; error?: string }>
  testConfig: (config: AppSettings) => Promise<TestConnectionResult>
  fetchModels: (params: { baseUrl: string; apiKey: string }) => Promise<FetchModelsResult>
  onApplySourceText: (callback: (text: string) => void) => () => void
  onOcrStatus: (callback: (status: OcrStatus) => void) => () => void
  setWindowHeight: (height: number) => Promise<void>
  openConfigWindow: () => Promise<void>
  closeConfigWindow: () => Promise<void>
  toggleAlwaysOnTop: () => Promise<boolean>
  getAlwaysOnTop: () => Promise<boolean>
  onConfigUpdated: (callback: (config: AppSettings) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
