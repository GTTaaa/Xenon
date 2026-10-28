import { app, BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { unlink } from 'fs/promises'
import { recognizeImageText } from './ocrEngine'
import { normalizeAppLanguage, translate } from '../../shared/i18n'
import { getLLMConfig } from './configManager'

/** 获取当前持久化的界面语言，用于系统弹窗与截图错误提示 */
const getMessageLanguage = (): ReturnType<typeof normalizeAppLanguage> =>
  normalizeAppLanguage(getLLMConfig().general?.language)

const t = (
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2]
): string => translate(getMessageLanguage(), key, params)

// 防止并发触发多次截屏（快捷键连按时窗口状态与截图选区会相互干扰）
let isCapturing = false

// 截图 / OCR 流程诊断日志开关：默认关闭，排查问题时以 DEBUG_CAPTURE=1 启动
const DEBUG_CAPTURE = process.env.DEBUG_CAPTURE === '1'

const debugCapture = (...args: unknown[]): void => {
  if (DEBUG_CAPTURE) console.log(...args)
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
    debugCapture('[main] 启动截屏命令:', screencaptureBin, args)

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

      debugCapture('[main] screencapture 执行完成:', {
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
 * 调起 macOS 原生选区截图，仅负责拿到临时图片路径
 * 若用户按 ESC 取消，返回 null（临时文件不会被创建）
 */
const captureScreenshotToTempPath = async (): Promise<string | null> => {
  if (process.platform !== 'darwin') {
    throw new Error('当前截图 OCR 功能仅支持 macOS 系统')
  }

  // 统一使用 /tmp 目录，保证跨进程绝对读写权限
  const tempImagePath = `/tmp/snip_${Date.now()}.png`

  // 1. 调起系统原生交互截屏
  const hasCaptured = await takeInteractiveScreenshot(tempImagePath)
  if (!hasCaptured) {
    debugCapture('[main] 用户按 ESC 取消了选区截图')
    return null
  }

  debugCapture('[main] 选区截图已生成:', tempImagePath)
  return tempImagePath
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
    title: t('capture.permissionTitle'),
    message: t('capture.permissionMessage'),
    detail: t('capture.permissionDetail'),
    buttons: [t('capture.permissionAction'), t('common.cancel')],
    defaultId: 0,
    cancelId: 1
  })

  if (result.response === 0) {
    await openScreenRecordingSettings()
  }
}

/**
 * 等待窗口列表全部从屏幕上消失（带超时兜底）
 * 返回实际等待时长与是否超时，便于诊断偶发遮挡问题
 */
const waitForWindowsHidden = async (
  windows: BrowserWindow[],
  timeoutMs = 800
): Promise<{ elapsedMs: number; timedOut: boolean }> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const anyVisible = windows.some((win) => !win.isDestroyed() && win.isVisible())
    if (!anyVisible) return { elapsedMs: Date.now() - start, timedOut: false }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }

  return { elapsedMs: Date.now() - start, timedOut: true }
}

/**
 * 描述当前所有窗口的可见状态，用于截图前后诊断日志
 */
const describeWindowStates = (): string => {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) return '(无窗口)'
  return wins
    .map((win, index) => {
      const flags = [
        `visible=${win.isDestroyed() ? 'destroyed' : win.isVisible()}`,
        `minimized=${win.isDestroyed() ? 'destroyed' : win.isMinimized()}`,
        `onTop=${win.isDestroyed() ? 'destroyed' : win.isAlwaysOnTop()}`
      ]
      return `#${index}{${flags.join(',')}}`
    })
    .join(' ')
}

/**
 * 触发截图翻译完整流程：截屏 -> OCR -> 唤起主窗口 -> 传递识别文本
 *
 * 为避免应用窗口浮在最上层遮挡待截取区域，截图前会隐藏所有应用窗口，
 * 截图结束后再按需恢复（用户按 ESC 取消时恢复原可见状态）。
 */
export const triggerScreenshotTranslation = async (
  getMainWindow: () => BrowserWindow | null
): Promise<{ ok: boolean; message?: string }> => {
  debugCapture('[main] 触发截图翻译...')

  // 防止连按快捷键并发触发多次截屏
  if (isCapturing) {
    debugCapture('[main] 已有截屏流程进行中，忽略本次触发')
    return { ok: false, message: t('capture.busy') }
  }
  isCapturing = true

  const mainWindow = getMainWindow()

  // 记录截图前所有可见窗口，截图完成后据此恢复
  const windowsBeforeCapture = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  )

  debugCapture('[main][截图诊断] 触发时窗口状态:', describeWindowStates())
  debugCapture(
    `[main][截图诊断] 需隐藏窗口 ${windowsBeforeCapture.length} 个，` +
      `主窗口可见=${Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())}`
  )

  try {
    // 隐藏所有应用窗口（含主窗口、配置窗口等），避免遮挡待截取区域
    if (windowsBeforeCapture.length > 0) {
      const hideStart = Date.now()
      for (const win of windowsBeforeCapture) {
        win.hide()
      }

      const { elapsedMs, timedOut } = await waitForWindowsHidden(windowsBeforeCapture)
      // 额外等待一小段时间，确保 macOS 窗口淡出动画彻底结束
      await new Promise((resolve) => setTimeout(resolve, 120))

      const totalElapsedMs = Date.now() - hideStart
      debugCapture(
        `[main][截图诊断] 隐藏窗口耗时 ${totalElapsedMs}ms` +
          `（轮询确认 ${elapsedMs}ms${timedOut ? '，⚠️ 轮询超时仍有窗口可见' : ''} + 淡出余量 120ms）`
      )
      debugCapture('[main][截图诊断] 隐藏后窗口状态:', describeWindowStates())

      if (timedOut) {
        console.warn(
          '[main][截图诊断] ⚠️ 等待窗口隐藏超时，截图中可能残留应用窗口遮挡，请上报此日志'
        )
      }
    } else {
      debugCapture('[main][截图诊断] 触发时无可见窗口，无需隐藏，直接截屏')
    }

    const captureStart = Date.now()
    const tempImagePath = await captureScreenshotToTempPath()
    debugCapture(`[main][截图诊断] 截屏耗时 ${Date.now() - captureStart}ms`)

    // 用户主动取消了截图，恢复截图前可见的所有窗口
    if (tempImagePath === null) {
      for (const win of windowsBeforeCapture) {
        if (!win.isDestroyed()) {
          win.show()
        }
      }
      debugCapture('[main][截图诊断] 用户取消截图，已恢复窗口:', describeWindowStates())
      return { ok: false, message: t('capture.cancelled') }
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      await unlink(tempImagePath).catch(() => {})
      return { ok: false, message: t('capture.noMainWindow') }
    }

    // 恢复截图前可见的附属窗口（如配置窗口）
    for (const win of windowsBeforeCapture) {
      if (!win.isDestroyed() && win !== mainWindow) {
        win.show()
      }
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

    // 窗口已恢复可见，后续 OCR 在用户看得见的界面上进行。
    // 全新安装后的首次 OCR 需要现场编译 Vision 模型（实测 30~60s），
    // 如果把它放在窗口恢复之前，这期间用户面对的是一个「消失的窗口」，
    // 看起来就像应用卡死了 —— 所以先恢复窗口，再用忙碌态告知进度。
    debugCapture('[main][截图诊断] 截图完成，已恢复窗口，开始 OCR:', describeWindowStates())
    mainWindow.webContents.send('translate:ocr-status', { phase: 'pending' })

    try {
      const ocrStart = Date.now()
      const recognizedText = await recognizeImageText(tempImagePath)
      debugCapture(`[main][截图诊断] OCR 耗时 ${Date.now() - ocrStart}ms`)
      mainWindow.webContents.send('translate:ocr-status', { phase: 'idle' })
      mainWindow.webContents.send('translate:apply-source-text', recognizedText)
      return { ok: true }
    } catch (error) {
      mainWindow.webContents.send('translate:ocr-status', { phase: 'idle' })
      throw error
    } finally {
      await unlink(tempImagePath).catch(() => {})
    }
  } catch (error) {
    console.error('[main] 截图翻译流程异常', error)

    const rawErrorMsg = error instanceof Error ? error.message : String(error)
    const isPermissionError = rawErrorMsg.includes('could not create image from rect')

    if (isPermissionError) {
      console.warn('[main] 明确命中 macOS 屏幕录制权限缺失，弹出系统设置引导框...')
      void promptScreenRecordingPermission()
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
      const userMessage = isPermissionError
        ? t('capture.permissionError')
        : t('capture.exception', { message: rawErrorMsg })

      // 失败信息走 ocr-status 而不是 apply-source-text：
      // 后者会把错误文案塞进源输入框并触发一次翻译，等于「把报错当内容去翻」
      mainWindow.webContents.send('translate:ocr-status', {
        phase: 'error',
        message: userMessage
      })
    }

    return {
      ok: false,
      message: rawErrorMsg
    }
  } finally {
    isCapturing = false
    debugCapture('[main][截图诊断] 截图流程结束，释放并发布锁')
  }
}
