import { ElectronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'
import type { AlignTextRequest, AlignTextResponse } from '../shared/textAlignment'
import type { WordLookupRequest, WordLookupResponse } from '../shared/wordLookup'
import type { SentenceSyntaxRequest, SentenceSyntaxResponse } from '../shared/sentenceSyntax'
import type { AppSettings, FetchModelsResult, TestConnectionResult } from '../shared/config'
import type { OcrStatus } from '../shared/ocr'
import type { WindowLayoutMode } from '../shared/windowLayout'

interface AppAPI {
  translateTextStream: (
    requestId: string,
    request: TranslateRequest,
    onDelta: (delta: string) => void
  ) => Promise<TranslateResponse>
  alignText: (requestId: string, request: AlignTextRequest) => Promise<AlignTextResponse>
  cancelTranslation: (requestId: string) => void
  lookupWord: (request: WordLookupRequest) => Promise<WordLookupResponse>
  analyzeSentenceSyntax: (request: SentenceSyntaxRequest) => Promise<SentenceSyntaxResponse>
  onFocusInput: (callback: () => void) => () => void
  getConfig: () => Promise<AppSettings>
  saveConfig: (config: AppSettings) => Promise<{ ok: boolean; error?: string }>
  testConfig: (config: AppSettings) => Promise<TestConnectionResult>
  fetchModels: (params: { baseUrl: string; apiKey: string }) => Promise<FetchModelsResult>
  onApplySourceText: (callback: (text: string) => void) => () => void
  onOcrStatus: (callback: (status: OcrStatus) => void) => () => void
  setWindowHeight: (height: number) => Promise<void>
  setWindowLayout: (layout: WindowLayoutMode) => Promise<void>
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
