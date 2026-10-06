import { app } from 'electron'
import { cpSync, existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 品牌改名之前使用的 userData 目录名 */
const LEGACY_USER_DATA_DIR_NAME = 'screenshot-translator'

/** 迁移完成标记文件，避免每次启动重复拷贝 */
const MIGRATION_MARKER = '.migrated-from-screenshot-translator'

/**
 * 需要随目录一起迁移的用户数据
 *
 * - llm-config.json：服务商 / API Key / 快捷键 / 通用设置
 * - Local Storage：渲染层偏好（源语言、目标语言、视觉样式等），
 *   其中部分字段主进程配置里并不存在，只此一份
 */
const MIGRATED_ITEMS = ['llm-config.json', 'Local Storage']

/**
 * 覆盖式拷贝单个条目
 *
 * 统一先清空目标再拷贝：`Local Storage` 是 leveldb，若与新目录中已有的
 * 文件混在一起会产生不一致的库，因此不做逐文件覆盖。
 */
const copyItem = (sourcePath: string, destinationPath: string): void => {
  rmSync(destinationPath, { recursive: true, force: true })
  cpSync(sourcePath, destinationPath, { recursive: true })
}

/**
 * 将旧品牌目录中的用户数据迁移到当前 userData 目录
 *
 * 必须在 `app.whenReady()` 之前调用：userData 路径只在 ready 前可改。
 *
 * 迁移策略：
 * - 新用户（旧目录无 llm-config.json）或已迁移过（存在标记）→ 不动
 * - 迁移成功 → 写入标记，继续使用新目录
 * - 迁移失败 → 回退到旧目录，保证配置与 API Key 不丢失
 */
export const migrateLegacyUserData = (): void => {
  const userDataPath = app.getPath('userData')
  const legacyUserDataPath = join(app.getPath('appData'), LEGACY_USER_DATA_DIR_NAME)

  // 已经运行在旧目录上（回退后的状态），无需处理
  if (userDataPath === legacyUserDataPath) return

  // 旧目录没有有效配置：新用户，或旧数据已被清理
  if (!existsSync(join(legacyUserDataPath, 'llm-config.json'))) return

  // 已迁移过，不重复拷贝
  if (existsSync(join(userDataPath, MIGRATION_MARKER))) return

  const migratedItems: string[] = []

  try {
    for (const item of MIGRATED_ITEMS) {
      const sourcePath = join(legacyUserDataPath, item)
      if (!existsSync(sourcePath)) continue
      copyItem(sourcePath, join(userDataPath, item))
      migratedItems.push(item)
    }

    // 拷贝完成后再落标记，确保中途失败时下次启动仍会重试
    writeFileSync(
      join(userDataPath, MIGRATION_MARKER),
      `migrated from ${LEGACY_USER_DATA_DIR_NAME} at ${new Date().toISOString()}\n`,
      'utf8'
    )
    console.log(`[main] 已从旧配置目录迁移用户数据: ${migratedItems.join(', ') || '(无匹配项)'}`)
  } catch (error) {
    console.warn('[main] 迁移旧配置目录失败，回退到旧目录:', error)
    try {
      app.setPath('userData', legacyUserDataPath)
    } catch (fallbackError) {
      console.error('[main] 回退旧配置目录同样失败:', fallbackError)
    }
  }
}
