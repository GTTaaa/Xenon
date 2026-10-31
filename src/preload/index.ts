import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  TranslateRequest,
  TranslateResponse,
  TranslateStreamDeltaEvent
} from '../shared/translate'
import type {
  AppLanguage,
  AppSettings,
  FetchModelsResult,
  TestConnectionResult
} from '../shared/config'
import type { OcrStatus } from '../shared/ocr'
import type { AppUpdateState } from '../shared/update'

// 暴露给渲染进程的应用 API
const api = {
  translateTextStream: (
    requestId: string,
    request: TranslateRequest,
    onDelta: (delta: string) => void
  ): Promise<TranslateResponse> => {
    const listener = (_event: IpcRendererEvent, payload: TranslateStreamDeltaEvent): void => {
      if (payload.requestId === requestId) onDelta(payload.delta)
    }

    ipcRenderer.on('translate:stream-delta', listener)
    return ipcRenderer
      .invoke('translate:text-stream', requestId, request)
      .finally(() => ipcRenderer.removeListener('translate:stream-delta', listener))
  },
  cancelTranslation: (requestId: string): void => {
    ipcRenderer.send('translate:cancel', requestId)
  },
  onFocusInput: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }

    ipcRenderer.on('translate:focus-input', listener)

    return () => {
      ipcRenderer.removeListener('translate:focus-input', listener)
    }
  },
  getConfig: (): Promise<AppSettings> => {
    return ipcRenderer.invoke('config:get')
  },
  saveConfig: (config: AppSettings): Promise<{ ok: boolean; error?: string }> => {
    return ipcRenderer.invoke('config:save', config)
  },
  testConfig: (config: AppSettings): Promise<TestConnectionResult> => {
    return ipcRenderer.invoke('config:test', config)
  },
  fetchModels: (params: {
    baseUrl: string
    apiKey: string
    language?: AppLanguage
  }): Promise<FetchModelsResult> => {
    return ipcRenderer.invoke('config:fetch-models', params)
  },
  toggleAlwaysOnTop: (): Promise<boolean> => {
    return ipcRenderer.invoke('window:toggle-always-on-top')
  },
  getAlwaysOnTop: (): Promise<boolean> => {
    return ipcRenderer.invoke('window:get-always-on-top')
  },
  onApplySourceText: (callback: (text: string) => void): (() => void) => {
    const listener = (_: unknown, text: string): void => {
      callback(text)
    }

    ipcRenderer.on('translate:apply-source-text', listener)

    return () => {
      ipcRenderer.removeListener('translate:apply-source-text', listener)
    }
  },
  onOcrStatus: (callback: (status: OcrStatus) => void): (() => void) => {
    const listener = (_: unknown, status: OcrStatus): void => {
      callback(status)
    }

    ipcRenderer.on('translate:ocr-status', listener)

    return () => {
      ipcRenderer.removeListener('translate:ocr-status', listener)
    }
  },
  setWindowHeight: (height: number, allowCompactHeight?: boolean): Promise<void> => {
    return ipcRenderer.invoke('window:set-height', height, allowCompactHeight)
  },
  openConfigWindow: (): Promise<void> => {
    return ipcRenderer.invoke('app:open-config')
  },
  closeConfigWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:close-config')
  },
  onConfigUpdated: (callback: (config: AppSettings) => void): (() => void) => {
    const listener = (_: unknown, config: AppSettings): void => {
      callback(config)
    }

    ipcRenderer.on('config:updated', listener)

    return () => {
      ipcRenderer.removeListener('config:updated', listener)
    }
  },
  getUpdateState: (): Promise<AppUpdateState> => {
    return ipcRenderer.invoke('app:update-state')
  },
  checkForUpdates: (): Promise<AppUpdateState> => {
    return ipcRenderer.invoke('app:update-check')
  },
  downloadUpdate: (): Promise<AppUpdateState> => {
    return ipcRenderer.invoke('app:update-download')
  },
  installUpdate: (): Promise<void> => {
    return ipcRenderer.invoke('app:update-install')
  },
  onUpdateState: (callback: (state: AppUpdateState) => void): (() => void) => {
    const listener = (_: unknown, state: AppUpdateState): void => {
      callback(state)
    }

    ipcRenderer.on('app:update-state', listener)

    return () => {
      ipcRenderer.removeListener('app:update-state', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
