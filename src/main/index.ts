import { config as loadEnv } from 'dotenv'
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  session,
  screen
} from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIconTemplate2x from '../../resources/trayTemplate@2x.png?asset'
import trayIconColor2x from '../../resources/xenon.png?asset'
import type { TranslateRequest } from '../shared/translate'
import type { AppSettings, GeneralSettings, ShortcutSettings } from '../shared/config'
import { DEFAULT_SHORTCUTS } from '../shared/config'
import { translateText } from './services/translator'
import {
  fetchProviderModels,
  getLLMConfig,
  saveLLMConfig,
  testLLMConnection
} from './services/configManager'
import { triggerScreenshotTranslation, prewarmOcrTool } from './services/screenCapture'
import { migrateLegacyUserData } from './services/configMigration'

loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true })
loadEnv({ path: resolve(process.cwd(), '.env.local'), override: true, quiet: true })

// 品牌名从 screenshot-translator 改为 Xenon 后 userData 目录会改名，
// 必须在 app ready 之前完成旧数据迁移，否则用户配置 / API Key 会"丢失"
migrateLegacyUserData()

let tray: Tray | null = null
let trayMenu: Menu | null = null
let mainWindow: BrowserWindow | null = null
let configWindow: BrowserWindow | null = null

// 标记应用是否正在退出
// app.quit() 同样会触发窗口的 close 事件，若 close 处理器继续拦截，
// 退出流程会被静默取消（窗口隐藏了但进程仍在），托盘「退出」会失效
let isQuitting = false

/** 非 macOS 托盘图标的缩放尺寸（覆盖 Windows 100%~200% 缩放的 16/24/32px 需求） */
const TRAY_ICON_SIZE = 32

/** 截图 OCR 依赖 macOS Vision 框架，其它平台不提供该能力 */
function canCaptureOnThisPlatform(): boolean {
  return process.platform === 'darwin'
}

/**
 * 创建或激活独立的系统偏好设置窗口
 */
function openConfigWindow(): void {
  if (configWindow && !configWindow.isDestroyed()) {
    if (configWindow.isMinimized()) {
      configWindow.restore()
    }
    configWindow.show()
    configWindow.focus()
    return
  }

  configWindow = new BrowserWindow({
    width: 720,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  configWindow.on('ready-to-show', () => {
    configWindow?.show()
    configWindow?.focus()
  })

  configWindow.on('closed', () => {
    configWindow = null
  })

  configWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    configWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=config`)
  } else {
    configWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'config' }
    })
  }
}

/**
 * 关闭独立的系统偏好设置窗口
 */
function closeConfigWindow(): void {
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.close()
    configWindow = null
  }
}

function createWindow(): void {
  const cfg = getLLMConfig()

  // 获取主显示器可用工作区（排除 macOS 顶部菜单栏/Dock 栏或 Windows 任务栏）
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay

  const windowWidth = 358
  const windowHeight = 340

  // 计算屏幕右上角坐标（完全贴合在屏幕工作区右上角，无缝紧贴右侧与顶部）
  const x = Math.max(workArea.x, Math.round(workArea.x + workArea.width - windowWidth))
  const y = Math.max(workArea.y, Math.round(workArea.y))

  mainWindow = new BrowserWindow({
    x,
    y,
    useContentSize: true,
    width: windowWidth,
    height: windowHeight,
    minWidth: 358,
    maxWidth: 358,
    minHeight: 280,
    maxHeight: 880,
    resizable: false,
    frame: false,
    show: false,
    alwaysOnTop: Boolean(cfg.general?.alwaysOnTop),
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    // 正在退出（app.quit / 托盘退出 / 系统关机）时不再拦截，否则应用无法关闭
    if (isQuitting) return

    const currentConfig = getLLMConfig()
    if (currentConfig.general?.closeAction === 'tray') {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }

  mainWindow.show()
  mainWindow.focus()
}

function showInputTranslateWindow(): void {
  showMainWindow()
  mainWindow?.webContents.send('translate:focus-input')
}

/**
 * 依据当前生效的快捷键配置构建托盘菜单
 * 用户修改全局快捷键后需重新构建，避免托盘加速键长期停留在硬编码旧值
 */
function buildTrayMenu(): Menu {
  const shortcuts = getLLMConfig().shortcuts || DEFAULT_SHORTCUTS
  const canCapture = canCaptureOnThisPlatform()

  return Menu.buildFromTemplate([
    {
      label: '输入翻译',
      accelerator: shortcuts.inputTranslate,
      click: () => {
        showInputTranslateWindow()
      }
    },
    ...(canCapture
      ? [
          {
            label: '截图翻译',
            accelerator: shortcuts.screenshot,
            click: () => {
              void triggerScreenshotTranslation(() => mainWindow)
            }
          }
        ]
      : []),
    {
      label: '模型配置',
      accelerator: shortcuts.openPreferences,
      click: () => {
        openConfigWindow()
      }
    },
    { type: 'separator' },
    {
      label: '显示窗口',
      click: () => {
        if (!mainWindow) {
          createWindow()
          return
        }

        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: '隐藏窗口',
      click: () => {
        mainWindow?.hide()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
}

/**
 * 重建并缓存托盘菜单（快捷键热更新后调用）
 *
 * 非 macOS 平台按截图能力做平台门禁：截图 OCR 依赖 macOS Vision 框架，
 * 在 Windows / Linux 上保留菜单项只会让用户点击后收到报错
 */
function refreshTrayMenu(): void {
  if (!tray) return
  trayMenu = buildTrayMenu()
}

function createTray(): void {
  const isMac = process.platform === 'darwin'
  // macOS：使用纯黑模板图，由系统按浅色/深色菜单栏自动反色
  // Windows / Linux：模板图是纯黑且尺寸偏小，在深色任务栏上几乎不可见，改用彩色应用图标
  let image = nativeImage.createFromPath(isMac ? trayIconTemplate2x : trayIconColor2x)

  if (isMac) {
    image.setTemplateImage(true)
  } else {
    // 非 macOS 平台显式缩放到 32px：原图 1156px 过大，而直接给 16px
    // 在高 DPI（150%/200%）下会被系统放大变模糊；给 32px 则由系统平滑降采样
    // 注意 resize 返回新对象，不会原地修改
    image = image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE })
  }

  tray = new Tray(image)
  tray.setToolTip('Xenon')
  refreshTrayMenu()

  tray.on('right-click', () => {
    if (trayMenu) tray?.popUpContextMenu(trayMenu)
  })

  tray.on('click', () => {
    // macOS 习惯左键直接展开菜单；Windows 习惯左键切换主窗口，Linux 则往往收不到 click
    if (isMac) {
      if (trayMenu) tray?.popUpContextMenu(trayMenu)
      return
    }

    if (mainWindow?.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide()
    } else {
      showMainWindow()
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // 设置应用模型 ID（用于 Windows 任务栏识别）
  electronApp.setAppUserModelId('com.electron.app')

  // 在 macOS 环境下设置 Dock 栏应用图标（开发环境与运行时即时生效）
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  // 自动同步环境中的代理配置给 Electron 网络会话
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  if (proxy) {
    console.log('[main] 检测到网络代理配置，为 Electron 设置代理:', proxy)
    try {
      await session.defaultSession.setProxy({ proxyRules: proxy })
    } catch (proxyErr) {
      console.error('[main] 设置代理规则失败:', proxyErr)
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('translate:text', async (_, request: TranslateRequest) => {
    return await translateText(request)
  })

  ipcMain.handle('config:get', async () => {
    return getLLMConfig()
  })

  ipcMain.handle('config:save', async (_, config: AppSettings) => {
    const result = await saveLLMConfig(config)
    if (result.ok) {
      const latestConfig = getLLMConfig()
      applyShortcuts(latestConfig.shortcuts)
      applyGeneralSettings(latestConfig.general)
      mainWindow?.webContents.send('config:updated', latestConfig)
    }
    return result
  })

  ipcMain.handle('app:open-config', () => {
    openConfigWindow()
  })

  ipcMain.handle('window:close-config', () => {
    closeConfigWindow()
  })

  ipcMain.handle('config:test', async (_, config: AppSettings) => {
    return await testLLMConnection(config)
  })

  ipcMain.handle('config:fetch-models', async (_, params: { baseUrl: string; apiKey: string }) => {
    return await fetchProviderModels(params)
  })

  ipcMain.handle('capture:screen', async () => {
    return await triggerScreenshotTranslation(() => mainWindow)
  })

  ipcMain.handle('window:toggle-always-on-top', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    const nextState = !mainWindow.isAlwaysOnTop()
    mainWindow.setAlwaysOnTop(nextState, 'floating')
    return nextState
  })

  ipcMain.handle('window:get-always-on-top', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    return mainWindow.isAlwaysOnTop()
  })

  // 窗口高度实时同步设置（保持不低于 280px 紧凑高度，超长文本自适应延展）
  ipcMain.handle('window:set-height', (_, targetHeight: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [width, currentHeight] = mainWindow.getContentSize()
    const clampedTargetHeight = Math.max(280, Math.min(Math.round(targetHeight), 880))
    if (Math.abs(currentHeight - clampedTargetHeight) >= 2) {
      mainWindow.setContentSize(width, clampedTargetHeight, false)
    }
  })

  createWindow()
  createTray()

  // 后台预热 Vision OCR 子进程，把 dyld/Vision 冷加载开销移出用户截图关键路径
  prewarmOcrTool()

  // 动态注册与管理全局快捷键
  let currentRegisteredShortcuts: ShortcutSettings | null = null

  function applyShortcuts(shortcuts?: ShortcutSettings): void {
    const nextShortcuts = shortcuts || DEFAULT_SHORTCUTS

    if (currentRegisteredShortcuts) {
      try {
        if (currentRegisteredShortcuts.inputTranslate) {
          globalShortcut.unregister(currentRegisteredShortcuts.inputTranslate)
        }
        if (currentRegisteredShortcuts.screenshot) {
          globalShortcut.unregister(currentRegisteredShortcuts.screenshot)
        }
        if (currentRegisteredShortcuts.openPreferences) {
          globalShortcut.unregister(currentRegisteredShortcuts.openPreferences)
        }
      } catch (err) {
        console.warn('[main] 注销旧快捷键失败:', err)
      }
    }

    if (nextShortcuts.inputTranslate) {
      try {
        const ok = globalShortcut.register(nextShortcuts.inputTranslate, () => {
          showInputTranslateWindow()
        })
        if (!ok) console.warn(`[main] 注册输入快捷键失败: ${nextShortcuts.inputTranslate}`)
        else console.log(`[main] 注册输入快捷键成功: ${nextShortcuts.inputTranslate}`)
      } catch (e) {
        console.warn(`[main] 快捷键格式错误: ${nextShortcuts.inputTranslate}`, e)
      }
    }

    // 截图快捷键同样只在具备截图能力的平台注册，避免占用快捷键却只能报错
    if (nextShortcuts.screenshot && canCaptureOnThisPlatform()) {
      try {
        const ok = globalShortcut.register(nextShortcuts.screenshot, () => {
          void triggerScreenshotTranslation(() => mainWindow)
        })
        if (!ok) console.warn(`[main] 注册截屏快捷键失败: ${nextShortcuts.screenshot}`)
        else console.log(`[main] 注册截屏快捷键成功: ${nextShortcuts.screenshot}`)
      } catch (e) {
        console.warn(`[main] 快捷键格式错误: ${nextShortcuts.screenshot}`, e)
      }
    }

    if (nextShortcuts.openPreferences) {
      try {
        const ok = globalShortcut.register(nextShortcuts.openPreferences, () => {
          openConfigWindow()
        })
        if (!ok) console.warn(`[main] 注册偏好设置快捷键失败: ${nextShortcuts.openPreferences}`)
        else console.log(`[main] 注册偏好设置快捷键成功: ${nextShortcuts.openPreferences}`)
      } catch (e) {
        console.warn(`[main] 快捷键格式错误: ${nextShortcuts.openPreferences}`, e)
      }
    }

    currentRegisteredShortcuts = { ...nextShortcuts }

    // 快捷键变更后同步刷新托盘菜单中的加速键展示
    refreshTrayMenu()
  }

  function applyGeneralSettings(general?: GeneralSettings): void {
    if (!general) return
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(general.launchAtLogin)
      })
    } catch (err) {
      console.warn('[main] 设置开机自启失败:', err)
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(Boolean(general.alwaysOnTop), 'floating')
    }
  }

  // 初始化应用快捷键与通用系统设置
  const initialConfig = getLLMConfig()
  applyShortcuts(initialConfig.shortcuts)
  applyGeneralSettings(initialConfig.general)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
})

// 只要退出流程被发起（托盘退出、Cmd+Q、系统关机等），就必须放行 close 事件
app.on('before-quit', () => {
  isQuitting = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
