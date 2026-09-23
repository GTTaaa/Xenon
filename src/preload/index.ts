import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'
import type { FetchModelsResult, LLMConfig, TestConnectionResult } from '../shared/config'

// 暴露给渲染进程的应用 API
const api = {
  translateText: (request: TranslateRequest): Promise<TranslateResponse> => {
    console.log('[preload] translateText invoke', request)
    return ipcRenderer.invoke('translate:text', request)
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
  getConfig: (): Promise<LLMConfig> => {
    return ipcRenderer.invoke('config:get')
  },
  saveConfig: (config: LLMConfig): Promise<{ ok: boolean; error?: string }> => {
    return ipcRenderer.invoke('config:save', config)
  },
  testConfig: (config: LLMConfig): Promise<TestConnectionResult> => {
    return ipcRenderer.invoke('config:test', config)
  },
  fetchModels: (params: { baseUrl: string; apiKey: string }): Promise<FetchModelsResult> => {
    return ipcRenderer.invoke('config:fetch-models', params)
  },
  onOpenConfig: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }

    ipcRenderer.on('app:open-config', listener)

    return () => {
      ipcRenderer.removeListener('app:open-config', listener)
    }
  },
  captureScreen: (): Promise<{ ok: boolean; message?: string }> => {
    return ipcRenderer.invoke('capture:screen')
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
  setWindowHeight: (height: number): Promise<void> => {
    return ipcRenderer.invoke('window:set-height', height)
  },
  openConfigWindow: (): Promise<void> => {
    return ipcRenderer.invoke('app:open-config')
  },
  closeConfigWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:close-config')
  },
  onConfigUpdated: (callback: (config: LLMConfig) => void): (() => void) => {
    const listener = (_: unknown, config: LLMConfig): void => {
      callback(config)
    }

    ipcRenderer.on('config:updated', listener)

    return () => {
      ipcRenderer.removeListener('config:updated', listener)
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
