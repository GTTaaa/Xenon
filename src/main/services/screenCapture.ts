import { app, BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'

/**
 * 容错定位 Vision OCR 可执行工具或源码脚本
 */
const resolveOcrExecutionCommand = (): { binPath: string; isScript: boolean } => {
  // 按照优先级依次检索编译产物路径
  const candidateBinaries = [
    // 1. 打包后的资源路径
    join(process.resourcesPath, 'bin/mac-vision-ocr'),
    join(process.resourcesPath, 'resources/bin/mac-vision-ocr'),
    join(process.resourcesPath, 'app.asar.unpacked/resources/bin/mac-vision-ocr'),
    // 2. 当前运行进程的工作目录（npm run dev 场景）
    join(process.cwd(), 'resources/bin/mac-vision-ocr'),
    // 3. 基于编译输出目录相对寻址（out/main/../..）
    join(__dirname, '../../resources/bin/mac-vision-ocr'),
    // 4. app.getAppPath() 寻址
    join(app.getAppPath(), 'resources/bin/mac-vision-ocr')
  ]

  for (const candidate of candidateBinaries) {
    if (existsSync(candidate)) {
      console.log('[main] 命中已编译的 Vision OCR 二进制工具:', candidate)
      return { binPath: candidate, isScript: false }
    }
  }

  // 兜底源码脚本路径
  const candidateScripts = [
    join(process.cwd(), 'src/main/native/mac-ocr/main.swift'),
    join(__dirname, '../../src/main/native/mac-ocr/main.swift'),
    join(app.getAppPath(), 'src/main/native/mac-ocr/main.swift')
  ]

  for (const script of candidateScripts) {
    if (existsSync(script)) {
      console.warn('[main] 未找到已编译二进制，回退为使用 Swift 解释执行源码:', script)
      return { binPath: script, isScript: true }
    }
  }

  throw new Error('未找到 Vision OCR 工具可执行文件或源码脚本，请先执行 pnpm run build:ocr 编译')
}

/**
 * 执行系统原生选区截屏
 * 若用户按 ESC 取消或未截取，返回 false
 */
const takeInteractiveScreenshot = async (tempImagePath: string): Promise<boolean> => {
  return new Promise<boolean>((resolve, reject) => {
    // 优先采用系统绝对路径，避免在某些GUI环境下PATH缺失/usr/sbin
    const screencaptureBin = existsSync('/usr/sbin/screencapture')
      ? '/usr/sbin/screencapture'
      : 'screencapture'

    // -i: 交互选区模式; -s: 强制锁定鼠标划选矩形模式(避免误切为窗口模式); -x: 静音
    const args = ['-i', '-s', '-x', tempImagePath]
    console.log('[main] 启动截屏命令:', screencaptureBin, args)

    execFile(screencaptureBin, args, (error, stdout, stderr) => {
      const fileExists = existsSync(tempImagePath)
      let fileSize = 0
      if (fileExists) {
        try {
          fileSize = statSync(tempImagePath).size
        } catch {
          fileSize = 0
        }
      }

      console.log('[main] screencapture 执行完成:', {
        errorCode: error ? (error as { code?: number | string }).code : undefined,
        errorMessage: error?.message,
        stderr: stderr?.trim(),
        stdout: stdout?.trim(),
        fileExists,
        fileSize
      })

      // 只要图片成功生成且内容非空，即视为截屏成功
      if (fileExists && fileSize > 0) {
        resolve(true)
        return
      }

      // 若有异常输出或非正常退出，抛出真实系统异常
      if (stderr?.trim() || (error && (error as { code?: number | string }).code !== 1)) {
        reject(new Error(`系统截屏命令异常: ${stderr?.trim() || error?.message}`))
        return
      }

      // 用户按 ESC 或空框选，文件未生成且无错误输出
      resolve(false)
    })
  })
}

/**
 * 调用 Vision OCR 工具提取图片中的文本
 */
const recognizeImageText = async (tempImagePath: string): Promise<string> => {
  const { binPath, isScript } = resolveOcrExecutionCommand()
  const command = isScript ? 'swift' : binPath
  const args = isScript ? [binPath, tempImagePath] : [tempImagePath]

  console.log('[main] 开始调用 Vision OCR 工具识别图片...', { command, args })

  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[main] OCR 识别工具执行失败:', {
          code: error.code,
          message: error.message,
          stderr: stderr || stdout
        })
        reject(new Error(`OCR 识别异常: ${stderr || error.message}`))
      } else {
        const text = stdout.trim()
        console.log('[main] OCR 识别成功，输出字符数:', text.length)
        resolve(text)
      }
    })
  })
}

/**
 * 调起 macOS 原生选区截图并进行 Vision OCR 文字提取
 * 若用户按 ESC 取消，返回 null
 */
export const captureAndRecognize = async (): Promise<string | null> => {
  if (process.platform !== 'darwin') {
    throw new Error('当前截图 OCR 功能仅支持 macOS 系统')
  }

  // 统一使用 /tmp 目录，保证跨进程绝对读写权限
  const tempImagePath = `/tmp/snip_${Date.now()}.png`

  try {
    // 1. 调起系统原生交互截屏
    const hasCaptured = await takeInteractiveScreenshot(tempImagePath)
    if (!hasCaptured) {
      console.log('[main] 用户按 ESC 取消了选区截图')
      return null
    }

    console.log('[main] 选区截图已生成:', tempImagePath)

    // 2. 执行 OCR 文字提取
    const recognizedText = await recognizeImageText(tempImagePath)
    return recognizedText
  } finally {
    // 3. 确保临时截图图片被安全清理
    await unlink(tempImagePath).catch(() => {})
  }
}

/**
 * 打开 macOS 屏幕录制权限设置页面
 */
export const openScreenRecordingSettings = async (): Promise<void> => {
  if (process.platform === 'darwin') {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  }
}

/**
 * 弹出提示对话框，引导用户去系统设置开启「屏幕录制」权限
 */
export const promptScreenRecordingPermission = async (): Promise<void> => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: '需要「屏幕录制」权限',
    message: '无法截取屏幕图像（macOS 拒绝访问屏幕画面）',
    detail:
      'macOS 安全机制要求截图功能必须被授予「屏幕录制」权限。\n\n请点击下方按钮打开「系统设置」，为您当前运行的终端（Terminal / iTerm / VS Code）或 Electron 应用开启屏幕录制开关，然后重新运行即可。',
    buttons: ['前往系统设置开启', '取消'],
    defaultId: 0,
    cancelId: 1
  })

  if (result.response === 0) {
    await openScreenRecordingSettings()
  }
}

/**
 * 触发截图翻译完整流程：截屏 -> OCR -> 唤起主窗口 -> 传递识别文本
 */
export const triggerScreenshotTranslation = async (
  getMainWindow: () => BrowserWindow | null
): Promise<{ ok: boolean; message?: string }> => {
  console.log('[main] 触发截图翻译...')

  try {
    const recognizedText = await captureAndRecognize()

    // 用户主动取消了截图，静默返回
    if (recognizedText === null) {
      return { ok: false, message: '用户取消截图' }
    }

    const mainWindow = getMainWindow()
    if (!mainWindow) {
      return { ok: false, message: '主窗口未初始化' }
    }

    // 唤起并置顶主窗口
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    }

    // 向渲染进程发送提取到的文本
    mainWindow.webContents.send('translate:apply-source-text', recognizedText)

    return { ok: true }
  } catch (error) {
    console.error('[main] 截图翻译流程异常', error)

    const rawErrorMsg = error instanceof Error ? error.message : String(error)
    const isPermissionError = rawErrorMsg.includes('could not create image from rect')

    if (isPermissionError) {
      console.warn('[main] 明确命中 macOS 屏幕录制权限缺失，弹出系统设置引导框...')
      void promptScreenRecordingPermission()
    }

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
      const userMessage = isPermissionError
        ? '截屏失败：缺少系统「屏幕录制」权限，请在系统设置中开启'
        : `[截屏异常]: ${rawErrorMsg}`

      mainWindow.webContents.send('translate:apply-source-text', userMessage)
    }

    return {
      ok: false,
      message: rawErrorMsg
    }
  }
}
