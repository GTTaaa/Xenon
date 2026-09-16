import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { TranslateRequest, TranslateResponse } from '../shared/translate'
import type { LLMConfig, TestConnectionResult } from '../shared/config'

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
  onOpenConfig: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }

    ipcRenderer.on('app:open-config', listener)

    return () => {
      ipcRenderer.removeListener('app:open-config', listener)
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
