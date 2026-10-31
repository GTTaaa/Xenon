/**
 * 应用更新流程的公开状态。
 * 渲染进程只依赖这些状态，不直接接触 electron-updater。
 */
export type AppUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

/**
 * 主进程向设置页和托盘同步的更新状态快照。
 */
export interface AppUpdateState {
  /** 当前更新流程所处阶段 */
  status: AppUpdateStatus
  /** 当前已安装版本 */
  currentVersion: string
  /** 服务端发现的新版本 */
  availableVersion?: string
  /** 下载进度，范围为 0 到 100 */
  percent?: number
  /** 已下载字节数 */
  transferred?: number
  /** 更新包总字节数 */
  total?: number
  /** 当前下载速度，单位字节/秒 */
  bytesPerSecond?: number
  /** 面向用户的状态说明或错误原因 */
  message?: string
  /** 最近一次完成检查的时间戳 */
  checkedAt?: number
  /** 自动重启因应用仍在执行任务而超时，等待用户手动重启 */
  restartDeferred?: boolean
}
