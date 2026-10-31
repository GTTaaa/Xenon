import { app } from 'electron'
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from 'electron-updater'
import {
  DEFAULT_UPDATE_SETTINGS,
  sanitizeUpdateSettings,
  type UpdateSettings
} from '../../shared/config'
import type { AppUpdateState } from '../../shared/update'
import { getLLMConfig } from './configManager'

type UpdateStateListener = (state: AppUpdateState) => void

// 启动后稍等，避免更新检查抢占首屏和 OCR 预热资源。
const INITIAL_CHECK_DELAY_MS = 5000
// 自动检查失败后先短间隔重试，避免启动时网络抖动导致长时间不再检查。
const CHECK_RETRY_DELAY_MS = 30 * 60 * 1000
// 下载完成后短暂停留，让渲染进程有机会先展示完成状态。
const AUTO_INSTALL_DELAY_MS = 800
// 有翻译或 OCR 任务时，自动重启最多等待两分钟。
const RESTART_BUSY_TIMEOUT_MS = 2 * 60 * 1000
const RESTART_BUSY_POLL_MS = 1000

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
let updateSettings: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS }
let appActivityBusy = false
let restartWaitStartedAt: number | null = null
let restartDeferred = false
let restartInProgress = false

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

/** 清除自动检查定时器。 */
const clearAutoCheckTimer = (): void => {
  if (!autoCheckTimer) return
  clearTimeout(autoCheckTimer)
  autoCheckTimer = null
}

/** 清除自动安装定时器。 */
const clearInstallTimer = (): void => {
  if (!installTimer) return
  clearTimeout(installTimer)
  installTimer = null
}

/** 返回当前配置对应的检查间隔毫秒数。 */
const getCheckIntervalMs = (): number => updateSettings.checkIntervalMinutes * 60 * 1000

/**
 * 安排下一次自动检查。
 * 检查结束后才安排下一轮，避免请求时间较长时出现重叠任务。
 */
const scheduleAutoCheck = (delayMs = getCheckIntervalMs()): void => {
  clearAutoCheckTimer()
  if (!app.isPackaged || !updateSettings.autoCheck) return

  autoCheckTimer = setTimeout(
    () => {
      autoCheckTimer = null

      if (state.status === 'downloading' || state.status === 'downloaded') {
        scheduleAutoCheck()
        return
      }

      void checkForUpdates()
    },
    Math.max(0, delayMs)
  )
  autoCheckTimer.unref()
}

/** 自动重启是否仍应进行。 */
const shouldAutoInstall = (): boolean => {
  return (
    updateSettings.autoRestart &&
    state.status === 'downloaded' &&
    !restartDeferred &&
    !restartInProgress
  )
}

/**
 * 下载完成后尝试自动安装。
 * 翻译或 OCR 正在运行时延后，最多等待两分钟；超时后保留手动重启入口。
 */
const maybeAutoInstall = (): void => {
  if (!shouldAutoInstall()) return

  if (appActivityBusy) {
    if (restartWaitStartedAt === null) {
      restartWaitStartedAt = Date.now()
    }

    const elapsed = Date.now() - restartWaitStartedAt
    const remaining = RESTART_BUSY_TIMEOUT_MS - elapsed
    if (remaining <= 0) {
      restartDeferred = true
      restartWaitStartedAt = null
      updateState({ restartDeferred: true })
      return
    }

    clearInstallTimer()
    installTimer = setTimeout(
      () => {
        installTimer = null
        maybeAutoInstall()
      },
      Math.min(RESTART_BUSY_POLL_MS, remaining)
    )
    installTimer.unref()
    return
  }

  restartInProgress = true
  restartWaitStartedAt = null
  clearInstallTimer()
  updateState({ restartDeferred: undefined })
  autoUpdater.quitAndInstall(false, true)
}

/** 安排自动安装，并从用户当前可见的状态开始计时。 */
const scheduleAutoInstall = (delayMs = AUTO_INSTALL_DELAY_MS): void => {
  clearInstallTimer()
  if (!shouldAutoInstall()) return

  installTimer = setTimeout(() => {
    installTimer = null
    maybeAutoInstall()
  }, delayMs)
  installTimer.unref()
}

/** 重置自动安装等待状态。 */
const resetAutoInstallState = (): void => {
  clearInstallTimer()
  restartWaitStartedAt = null
  restartDeferred = false
  restartInProgress = false
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

/**
 * 应用最新更新策略。
 * 设置保存后立即生效：重新安排检查、补下载已发现的版本，或启动等待中的自动重启。
 */
export const applyUpdateSettings = (raw?: Partial<UpdateSettings>): void => {
  const previous = updateSettings
  updateSettings = sanitizeUpdateSettings(raw)

  if (!app.isPackaged) return

  if (!updateSettings.autoCheck) {
    clearAutoCheckTimer()
  } else if (
    !previous.autoCheck ||
    previous.checkIntervalMinutes !== updateSettings.checkIntervalMinutes
  ) {
    scheduleAutoCheck(1000)
  }

  if (updateSettings.autoDownload && state.status === 'available') {
    void downloadUpdate()
  }

  if (!updateSettings.autoRestart) {
    clearInstallTimer()
    restartWaitStartedAt = null
    restartDeferred = false
    if (state.status === 'downloaded') {
      updateState({ restartDeferred: undefined })
    }
  } else if (state.status === 'downloaded') {
    restartDeferred = false
    restartWaitStartedAt = null
    scheduleAutoInstall(600)
  }
}

/** 注册更新事件，并设置启动后的首次自动检查。 */
export const initializeAutoUpdater = (listener: UpdateStateListener): void => {
  if (initialized) return
  initialized = true
  stateListener = listener
  updateSettings = sanitizeUpdateSettings(getLLMConfig().update)

  if (!app.isPackaged) {
    updateState({
      status: 'disabled',
      message: '开发模式下不检查更新'
    })
    return
  }

  // 下载始终由主进程按策略触发，避免 electron-updater 绕过用户设置自动下载。
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('checking-for-update', () => {
    updateState({
      status: 'checking',
      availableVersion: undefined,
      percent: undefined,
      restartDeferred: undefined,
      message: undefined
    })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateState({
      status: 'available',
      availableVersion: info.version,
      checkedAt: Date.now(),
      restartDeferred: undefined,
      message: undefined
    })

    if (updateSettings.autoDownload) {
      queueMicrotask(() => {
        void downloadUpdate()
      })
    }
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    updateState({
      status: 'not-available',
      availableVersion: info.version,
      percent: undefined,
      checkedAt: Date.now(),
      restartDeferred: undefined,
      message: undefined
    })
  })

  autoUpdater.on('download-progress', handleDownloadProgress)

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    resetAutoInstallState()
    updateState({
      status: 'downloaded',
      availableVersion: info.version,
      percent: 100,
      checkedAt: Date.now(),
      restartDeferred: undefined,
      message: undefined
    })
    scheduleAutoInstall()
  })

  autoUpdater.on('error', (error: Error) => {
    resetAutoInstallState()
    updateState({
      status: 'error',
      checkedAt: Date.now(),
      restartDeferred: undefined,
      message: error.message
    })
  })

  updateState({
    status: 'idle',
    message: undefined
  })

  scheduleAutoCheck(INITIAL_CHECK_DELAY_MS)
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
    let failed = false
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      failed = true
      updateState({
        status: 'error',
        checkedAt: Date.now(),
        restartDeferred: undefined,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      checkPromise = null
      scheduleAutoCheck(failed ? CHECK_RETRY_DELAY_MS : getCheckIntervalMs())
    }
    return getUpdateState()
  })()

  return checkPromise
}

/** 用户确认或自动策略触发下载，并复用同一轮下载任务。 */
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
    resetAutoInstallState()
    updateState({
      status: 'downloading',
      percent: 0,
      transferred: 0,
      total: undefined,
      bytesPerSecond: undefined,
      restartDeferred: undefined,
      message: undefined
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      updateState({
        status: 'error',
        checkedAt: Date.now(),
        restartDeferred: undefined,
        message: error instanceof Error ? error.message : String(error)
      })
      scheduleAutoCheck(CHECK_RETRY_DELAY_MS)
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
  if (state.status !== 'downloaded' || restartInProgress) return

  resetAutoInstallState()
  restartInProgress = true
  autoUpdater.quitAndInstall(false, true)
}

/**
 * 更新渲染进程是否存在翻译或 OCR 任务。
 * 自动重启会等待任务结束，避免打断用户当前操作。
 */
export const setAppActivityBusy = (busy: boolean): void => {
  if (appActivityBusy === busy) return
  appActivityBusy = busy

  if (!busy && !restartDeferred) {
    scheduleAutoInstall(0)
  }
}

/** 应用退出前清理自动检查与自动安装定时器。 */
export const shutdownAutoUpdater = (): void => {
  clearAutoCheckTimer()
  clearInstallTimer()
}
