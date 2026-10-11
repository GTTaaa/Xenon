/**
 * 渲染层 localStorage 中已经废弃的键。
 *
 * - xenon_pref_theme / xenon_pref_theme_v2：
 *   偏好设置窗口的主题开关（历经 glass / linear / macos / wise 几代主题体系）。
 *   主题现已固定为 Wise，切换入口在「移除偏好设置主题切换」那次改动里删除，
 *   两个键都不再被读写。
 * - targetChipStyle：
 *   目标语言 Chip 选中样式的双方案切换（vernier / inset），已随方案收敛移除。
 *
 * 这些键不会再被任何代码访问，但会永久留在老用户的磁盘上，
 * 因此在渲染层启动时统一清理一次。
 */
const LEGACY_STORAGE_KEYS = ['xenon_pref_theme', 'xenon_pref_theme_v2', 'targetChipStyle'] as const

/**
 * 清理已废弃的 localStorage 键。
 *
 * 单个键清理失败不应阻断应用启动，因此逐个捕获异常后继续处理下一个。
 */
export const clearLegacyLocalStorage = (): void => {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.warn(`[renderer] 清理废弃本地存储失败: ${key}`, error)
    }
  }
}
