import { ElectronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'
import type {
  AppLanguage,
  AppSettings,
  FetchModelsResult,
  TestConnectionResult
} from '../shared/config'
import type { OcrStatus } from '../shared/ocr'
import type { AppUpdateState } from '../shared/update'

interface AppAPI {
  translateTextStream: (
    requestId: string,
    request: TranslateRequest,
    onDelta: (delta: string) => void
  ) => Promise<TranslateResponse>
  cancelTranslation: (requestId: string) => void
  onFocusInput: (callback: () => void) => () => void
  getConfig: () => Promise<AppSettings>
  saveConfig: (config: AppSettings) => Promise<{ ok: boolean; error?: string }>
  testConfig: (config: AppSettings) => Promise<TestConnectionResult>
  fetchModels: (params: {
    baseUrl: string
    apiKey: string
    language?: AppLanguage
  }) => Promise<FetchModelsResult>
  onApplySourceText: (callback: (text: string) => void) => () => void
  onOcrStatus: (callback: (status: OcrStatus) => void) => () => void
  setWindowHeight: (height: number, allowCompactHeight?: boolean) => Promise<void>
  openConfigWindow: () => Promise<void>
  closeConfigWindow: () => Promise<void>
  toggleAlwaysOnTop: () => Promise<boolean>
  getAlwaysOnTop: () => Promise<boolean>
  onConfigUpdated: (callback: (config: AppSettings) => void) => () => void
  getUpdateState: () => Promise<AppUpdateState>
  checkForUpdates: () => Promise<AppUpdateState>
  downloadUpdate: () => Promise<AppUpdateState>
  installUpdate: () => Promise<void>
  setAppActivityBusy: (busy: boolean) => void
  onUpdateState: (callback: (state: AppUpdateState) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
