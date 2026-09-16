import { config as loadEnv } from 'dotenv'
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut
} from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon2x from '../../resources/trayTemplate@2x.png?asset'
import type { TranslateRequest } from '../shared/translate'
import type { LLMConfig } from '../shared/config'
import { translateText } from './services/translator'
import { getLLMConfig, saveLLMConfig, testLLMConnection } from './services/configManager'
import { triggerScreenshotTranslation } from './services/screenCapture'

loadEnv({ path: resolve(process.cwd(), '.env.local') })

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

console.log('[main] process booted')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    useContentSize: true,
    width: 358,
    height: 670,
    minWidth: 358,
    minHeight: 670,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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

function createTray(): void {
  if (process.platform !== 'darwin') return

  const image = nativeImage.createFromPath(trayIcon2x)
  image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('Xenon')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '输入翻译',
      accelerator: 'Alt+A',
      click: () => {
        showInputTranslateWindow()
      }
    },
    {
      label: '截图翻译',
      accelerator: 'Alt+S',
      click: () => {
        void triggerScreenshotTranslation(() => mainWindow)
      }
    },
    {
      label: '模型配置',
      click: () => {
        showMainWindow()
        mainWindow?.webContents.send('app:open-config')
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

  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu)
  })

  tray.on('click', () => {
    tray?.popUpContextMenu(contextMenu)
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('translate:text', async (_, request: TranslateRequest) => {
    console.log('[main] ipcMain.handle translate:text', request)
    return await translateText(request)
  })

  ipcMain.handle('config:get', async () => {
    return getLLMConfig()
  })

  ipcMain.handle('config:save', async (_, config: LLMConfig) => {
    return await saveLLMConfig(config)
  })

  ipcMain.handle('config:test', async (_, config: LLMConfig) => {
    return await testLLMConnection(config)
  })

  ipcMain.handle('capture:screen', async () => {
    return await triggerScreenshotTranslation(() => mainWindow)
  })
  createWindow()
  createTray()

  const isInputTranslateShortcutRegistered = globalShortcut.register('Alt+A', () => {
    showInputTranslateWindow()
  })

  if (!isInputTranslateShortcutRegistered) {
    console.warn('[main] failed to register input translate shortcut: Alt+A')
  } else {
    console.log('[main] registered input translate shortcut: Alt+A')
  }

  const isScreenshotShortcutRegistered = globalShortcut.register('Alt+S', () => {
    void triggerScreenshotTranslation(() => mainWindow)
  })

  if (!isScreenshotShortcutRegistered) {
    console.warn('[main] failed to register screenshot shortcut: Alt+S')
  } else {
    console.log('[main] registered screenshot shortcut: Alt+S')
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
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
