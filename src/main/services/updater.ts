import { app } from 'electron'
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from 'electron-updater'
import type { AppUpdateState } from '../../shared/update'

type UpdateStateListener = (state: AppUpdateState) => void

let state: AppUpdateState = {
  status: 'idle',
  currentVersion: ''
}
let stateListener: UpdateStateListener | null = null
let initialized = false
let checkPromise: Promise<AppUpdateState> | null = null
let downloadPromise: Promise<AppUpdateState> | null = null
let autoCheckTimer: NodeJS.Timeout | null = null
let installTimer: NodeJS.Timeout | null = null

/** 返回当前更新状态的只读快照，避免调用方修改内部状态。 */
export const getUpdateState = (): AppUpdateState => ({ ...state })

/** 将状态变更同步给主进程监听器，并保留当前版本信息。 */
const updateState = (patch: Partial<AppUpdateState>): AppUpdateState => {
  state = {
    ...state,
    ...patch,
    currentVersion: app.getVersion()
  }
  stateListener?.(getUpdateState())
  return getUpdateState()
}

/** 将 electron-updater 的进度事件收敛为渲染进程可直接展示的状态。 */
const handleDownloadProgress = (progress: ProgressInfo): void => {
  updateState({
    status: 'downloading',
    percent: Math.min(100, Math.max(0, Math.round(progress.percent))),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  })
}

/** 注册更新事件，并设置启动后延迟自动检查。 */
export const initializeAutoUpdater = (listener: UpdateStateListener): void => {
  if (initialized) return
  initialized = true
  stateListener = listener

  if (!app.isPackaged) {
    updateState({
      status: 'disabled',
      message: '开发模式下不检查更新'
    })
    return
  }

  // 发现新版本后只提示，必须由用户确认后才开始下载。
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('checking-for-update', () => {
    updateState({
      status: 'checking',
      availableVersion: undefined,
      percent: undefined,
      message: undefined
    })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateState({
      status: 'available',
      availableVersion: info.version,
      message: undefined
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    updateState({
      status: 'not-available',
      availableVersion: info.version,
      percent: undefined,
      checkedAt: Date.now(),
      message: undefined
    })
  })

  autoUpdater.on('download-progress', handleDownloadProgress)

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    updateState({
      status: 'downloaded',
      availableVersion: info.version,
      percent: 100,
      checkedAt: Date.now(),
      message: undefined
    })

    // 用户已通过下载按钮确认更新，下载完成后直接重启安装。
    if (installTimer) clearTimeout(installTimer)
    installTimer = setTimeout(() => {
      installTimer = null
      installDownloadedUpdate()
    }, 600)
  })

  autoUpdater.on('error', (error: Error) => {
    updateState({
      status: 'error',
      checkedAt: Date.now(),
      message: error.message
    })
  })

  updateState({
    status: 'idle',
    message: undefined
  })

  // 不阻塞首屏和 OCR 预热，让更新检查在应用稳定运行后自动开始。
  autoCheckTimer = setTimeout(() => {
    void checkForUpdates()
  }, 5000)
  autoCheckTimer.unref()
}

/** 手动或自动检查更新；重复调用会复用同一轮检查。 */
export const checkForUpdates = async (): Promise<AppUpdateState> => {
  if (!app.isPackaged) {
    return updateState({
      status: 'disabled',
      message: '开发模式下不检查更新'
    })
  }

  if (checkPromise) return checkPromise
  if (state.status === 'downloading' || state.status === 'downloaded') {
    return getUpdateState()
  }

  checkPromise = (async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      updateState({
        status: 'error',
        checkedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      checkPromise = null
    }
    return getUpdateState()
  })()

  return checkPromise
}

/** 用户确认后下载已发现的更新，并复用同一轮下载任务。 */
export const downloadUpdate = async (): Promise<AppUpdateState> => {
  if (!app.isPackaged) {
    return updateState({
      status: 'disabled',
      message: '开发模式下不检查更新'
    })
  }

  if (downloadPromise) return downloadPromise
  if (state.status !== 'available') return getUpdateState()

  downloadPromise = (async () => {
    updateState({
      status: 'downloading',
      percent: 0,
      transferred: 0,
      total: undefined,
      bytesPerSecond: undefined,
      message: undefined
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      updateState({
        status: 'error',
        checkedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      downloadPromise = null
    }

    return getUpdateState()
  })()

  return downloadPromise
}

/**
 * 立即退出并安装已经下载完成的更新。
 * 第二个参数确保安装器结束后重新启动应用。
 */
export const installDownloadedUpdate = (): void => {
  if (state.status !== 'downloaded') return
  autoUpdater.quitAndInstall(false, true)
}

/** 应用退出前清理延迟检查定时器。 */
export const shutdownAutoUpdater = (): void => {
  if (autoCheckTimer) {
    clearTimeout(autoCheckTimer)
    autoCheckTimer = null
  }
  if (installTimer) {
    clearTimeout(installTimer)
    installTimer = null
  }
}
