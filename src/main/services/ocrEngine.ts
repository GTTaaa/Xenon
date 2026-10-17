import { app } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * OCR 引擎：以常驻子进程（daemon）方式复用 Vision 框架。
 *
 * 背景：macOS Vision 在「首次带 recognitionLanguages 的请求」时需要现场编译
 * CoreML/e5rt 模型（实测冷启动 30~60s，产物缓存在
 * ~/Library/Caches/<binary-name>/com.apple.e5rt.e5bundlecache/），编译完成后的
 * 单次识别仅需 ~0.15s。若每次截图都 fork 一个新进程，就永远付这份冷启动成本，
 * 而且在编译中途被超时 SIGKILL 会让缓存始终无法落盘，于是次次超时。
 *
 * 因此这里常驻一个 `mac-vision-ocr --daemon` 进程：
 * - 启动时后台预热，把模型编译开销移出用户截图关键路径；
 * - 之后每次识别走 stdin/stdout 的行协议，进程内模型已就绪。
 */

// 截图 / OCR 流程诊断日志开关：默认关闭，排查问题时以 DEBUG_CAPTURE=1 启动
const DEBUG_CAPTURE = process.env.DEBUG_CAPTURE === '1'

const debugOcr = (...args: unknown[]): void => {
  if (DEBUG_CAPTURE) console.log(...args)
}

// 模型已预热后的单次识别预算（实测 ~0.15s，留足余量）
const OCR_WARM_TIMEOUT_MS = 20000

// 冷启动预算：必须覆盖 Vision 首次模型编译（实测 30~60s，慢盘可能更久），
// 过短会在编译中途杀进程，导致 e5rt 缓存永远写不完、次次冷启动
const OCR_COLD_TIMEOUT_MS = 180000

// daemon 不可用时（崩溃 / 找不到二进制）的单次进程兜底预算
const OCR_ONESHOT_TIMEOUT_MS = 120000

// 用户截图遇上升温中的冷启动时，最多无声等待这么久；再久就回一条明确提示让用户重试，
// 避免用户按住快捷键后长时间看不到任何反馈
const OCR_COLD_WAIT_MS = 10000

// 空闲回收：模型编译结果已落盘缓存（~/Library/Caches/<binary>/…e5bundlecache），
// 重启进程仅需 ~0.15s，因此长时间不用时释放 daemon 占用的内存
const OCR_IDLE_SHUTDOWN_MS = 5 * 60 * 1000

// 预热用极小 PNG（160x48 白底黑条），仅用于让 Vision 框架完成冷加载，不入库为资源文件
const OCR_PREWARM_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAAAwCAIAAAAZy+Y5AAAAkklEQVR4nO3XwQmAQBAEwc0/aQ3BxyG6TVUEA/2auUibrwfwLoHjBI4TOE7gOIHjBI4TOE7gOIHjngMP/yZwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHE3WX5019R2b9UAAAAASUVORK5CYII='

/** 单张图片的识别失败（图片读不出等），daemon 本身健康，无需兜底重建 */
class OcrRequestError extends Error {
  constructor(message: string) {
    super(`OCR 识别异常: ${message}`)
    this.name = 'OcrRequestError'
  }
}

/** 区分「超时」与其他失败，供上层决定是否兜底重试 */
class OcrTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`OCR 识别超时（超过 ${timeoutMs}ms），已终止子进程`)
    this.name = 'OcrTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * 容错定位 Vision OCR 可执行工具或源码脚本
 */
const resolveOcrExecutionCommand = (): { command: string; args: string[] } => {
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
      debugOcr('[main] 命中已编译的 Vision OCR 二进制工具:', candidate)
      return { command: candidate, args: [] }
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
      return { command: 'swift', args: [script] }
    }
  }

  throw new Error('未找到 Vision OCR 工具可执行文件或源码脚本，请先执行 pnpm run build:ocr 编译')
}

// ---------------------------------------------------------------------------
// daemon 生命周期
// ---------------------------------------------------------------------------

let daemon: ChildProcessWithoutNullStreams | null = null
let daemonBuffer = ''
let daemonReady = false

type PendingRequest = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  timeoutMs: number
}

let pendingRequest: PendingRequest | null = null
let idleTimer: NodeJS.Timeout | null = null

// 启动阶段后台预热的进行中 promise，供截图流程判断「模型还在首次编译」
let warmupPromise: Promise<void> | null = null

// 识别请求串行化：daemon 单线程同步执行 Vision 请求，并发写 stdin 会导致响应错配
let requestQueue: Promise<unknown> = Promise.resolve()

const isReady = (): boolean => daemon !== null && daemonReady

const settlePending = (settle: (req: PendingRequest) => void): void => {
  const req = pendingRequest
  if (!req) return
  pendingRequest = null
  clearTimeout(req.timer)
  settle(req)
}

/** 清空空闲回收定时器 */
const clearIdleTimer = (): void => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

/** 每次成功响应后重新计时，空闲超时则回收 daemon 释放内存 */
const scheduleIdleShutdown = (): void => {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pendingRequest) {
      scheduleIdleShutdown()
      return
    }
    disposeDaemon(`空闲超过 ${OCR_IDLE_SHUTDOWN_MS}ms`)
  }, OCR_IDLE_SHUTDOWN_MS)
}

/** 回收 daemon：崩溃、超时与退出流程统一走这里，保证状态归零 */
const disposeDaemon = (reason: string): void => {
  clearIdleTimer()
  const child = daemon
  daemon = null
  daemonReady = false
  daemonBuffer = ''
  if (!child) return

  debugOcr(`[main][OCR daemon] 回收 daemon：${reason}`)
  try {
    if (child.stdin && !child.stdin.destroyed) child.stdin.end()
  } catch {
    /* ignore */
  }
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  } catch {
    /* ignore */
  }
}

const handleDaemonLine = (line: string): void => {
  const trimmed = line.trim()
  if (!trimmed) return

  let payload: { ok?: boolean; text?: string; error?: string }
  try {
    payload = JSON.parse(trimmed) as typeof payload
  } catch {
    console.warn('[main][OCR daemon] 无法解析 daemon 输出，已丢弃:', trimmed.slice(0, 200))
    return
  }

  if (payload.ok) {
    daemonReady = true
    settlePending((req) => req.resolve(payload.text ?? ''))
    if (daemon) scheduleIdleShutdown()
  } else {
    const message = payload.error || 'OCR 识别失败'
    settlePending((req) => req.reject(new OcrRequestError(message)))
  }
}

/**
 * 懒启动常驻 OCR 子进程
 */
const ensureDaemon = (): ChildProcessWithoutNullStreams => {
  if (daemon && !daemon.killed) return daemon

  const target = resolveOcrExecutionCommand()
  const daemonArgs = [...target.args, '--daemon']
  const start = Date.now()
  const child = spawn(target.command, daemonArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

  daemon = child
  daemonReady = false
  daemonBuffer = ''

  child.on('spawn', () => {
    debugOcr(`[main][OCR daemon] spawn 完成耗时 ${Date.now() - start}ms`)
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (daemon !== child) return
    daemonBuffer += chunk
    let index = daemonBuffer.indexOf('\n')
    while (index >= 0) {
      const line = daemonBuffer.slice(0, index)
      daemonBuffer = daemonBuffer.slice(index + 1)
      handleDaemonLine(line)
      index = daemonBuffer.indexOf('\n')
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    const msg = chunk.trim()
    if (msg) console.warn('[main][OCR daemon] stderr:', msg)
  })

  child.on('error', (error) => {
    if (daemon !== child) return
    console.error('[main][OCR daemon] 子进程异常:', error.message)
    settlePending((req) => req.reject(new Error(`OCR 子进程异常: ${error.message}`)))
    disposeDaemon('子进程 error 事件')
  })

  child.on('exit', (code, signal) => {
    if (daemon !== child) return
    console.warn('[main][OCR daemon] 子进程退出:', { code, signal })
    settlePending((req) =>
      req.reject(new Error(`OCR 子进程意外退出（code=${code}, signal=${signal}）`))
    )
    disposeDaemon('子进程退出')
  })

  return child
}

/**
 * 在 daemon 上执行一次识别（串行）
 */
const requestDaemon = (imagePath: string, timeoutMs: number): Promise<string> => {
  const run = requestQueue.then(() => executeOnDaemon(imagePath, timeoutMs))
  requestQueue = run.catch(() => undefined)
  return run
}

const executeOnDaemon = (imagePath: string, timeoutMs: number): Promise<string> => {
  let child: ChildProcessWithoutNullStreams
  try {
    child = ensureDaemon()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }

  return new Promise<string>((resolve, reject) => {
    const start = Date.now()

    const timer = setTimeout(() => {
      // 超时后 daemon 状态不可信（Vision 同步调用无法中断），杀掉重建
      settlePending((req) => req.reject(new OcrTimeoutError(req.timeoutMs)))
      disposeDaemon(`识别超时 ${timeoutMs}ms`)
    }, timeoutMs)

    pendingRequest = {
      resolve: (text) => {
        debugOcr(`[main][OCR] daemon 识别完成，耗时 ${Date.now() - start}ms`)
        resolve(text)
      },
      reject,
      timer,
      timeoutMs
    }

    try {
      child.stdin.write(`${imagePath}\n`)
    } catch (error) {
      settlePending((req) =>
        req.reject(
          new Error(`OCR 请求写入失败: ${error instanceof Error ? error.message : String(error)}`)
        )
      )
      disposeDaemon('stdin 写入失败')
    }
  })
}

/**
 * 兜底路径：一次性子进程识别（daemon 不可用时使用），行为与旧实现一致
 */
const recognizeWithOneShot = async (imagePath: string): Promise<string> => {
  const { command, args } = resolveOcrExecutionCommand()
  debugOcr('[main][OCR] 回退到一次性子进程识别:', { command, args })

  return new Promise<string>((resolve, reject) => {
    const start = Date.now()
    execFile(
      command,
      [...args, imagePath],
      { maxBuffer: 10 * 1024 * 1024, timeout: OCR_ONESHOT_TIMEOUT_MS, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const elapsed = Date.now() - start
        if (error) {
          const timedOut = (error as { killed?: boolean }).killed === true
          console.error('[main] OCR 识别工具执行失败:', {
            code: error.code,
            message: error.message,
            signal: (error as { signal?: string }).signal,
            timedOut,
            elapsedMs: elapsed,
            stderr: stderr || stdout
          })
          reject(
            timedOut
              ? new OcrTimeoutError(OCR_ONESHOT_TIMEOUT_MS)
              : new Error(`OCR 识别异常: ${stderr || error.message}`)
          )
          return
        }
        const text = stdout.trim()
        debugOcr(`[main][OCR] 一次性子进程识别完成，耗时 ${elapsed}ms，字符数 ${text.length}`)
        resolve(text)
      }
    )
  })
}

/**
 * 识别图片中的文本
 * daemon 路径优先；仅在 daemon 启动失败 / 崩溃时回退到一次性子进程（超时不回退，避免二次冷启动）
 */
export const recognizeImageText = async (imagePath: string): Promise<string> => {
  // 模型正在首次编译时先短暂等待预热完成（用户还没拿到识别结果，不可能立即重试），
  // 等待超时则继续排队执行，保证本次截图内容不丢失
  if (!isReady() && warmupPromise) {
    await Promise.race([
      warmupPromise,
      new Promise<void>((resolve) => setTimeout(resolve, OCR_COLD_WAIT_MS))
    ])
  }

  const wasWarm = isReady()
  const timeoutMs = wasWarm ? OCR_WARM_TIMEOUT_MS : OCR_COLD_TIMEOUT_MS

  if (!wasWarm) {
    console.warn(
      `[main][OCR] 模型尚未预热，本次识别使用冷启动预算 ${timeoutMs}ms（首次可能需要 30~60s）`
    )
  }

  try {
    return await requestDaemon(imagePath, timeoutMs)
  } catch (error) {
    if (error instanceof OcrTimeoutError || error instanceof OcrRequestError) throw error

    const message = error instanceof Error ? error.message : String(error)
    console.warn('[main][OCR] daemon 路径失败，回退一次性子进程:', message)
    const text = await recognizeWithOneShot(imagePath)
    return text
  }
}

/**
 * 后台预热 OCR daemon：启动子进程并跑一次极小图片识别，
 * 把 CoreML/e5rt 模型的首次编译开销提前到应用启动阶段。失败静默，不影响主流程。
 */
export const prewarmOcr = async (): Promise<void> => {
  if (process.platform !== 'darwin') return

  const task = warmUp()
  warmupPromise = task
  try {
    await task
  } finally {
    warmupPromise = null
  }
}

const warmUp = async (): Promise<void> => {
  const prewarmImagePath = join(tmpdir(), `snip_prewarm_${Date.now()}.png`)

  try {
    await writeFile(prewarmImagePath, Buffer.from(OCR_PREWARM_IMAGE_BASE64, 'base64'))

    const start = Date.now()
    const text = await requestDaemon(prewarmImagePath, OCR_COLD_TIMEOUT_MS)
    console.log(
      `[main][OCR 预热] 完成，冷启动开销 ${Date.now() - start}ms（预热图识别字符数 ${text.length}）`
    )
  } catch (error) {
    console.warn(
      '[main][OCR 预热] 预热失败（不影响正常使用，首次截图会现场冷启动）:',
      error instanceof Error ? error.message : error
    )
  } finally {
    await unlink(prewarmImagePath).catch(() => {})
  }
}

/**
 * 退出流程中回收 daemon，避免残留孤儿进程
 */
export const shutdownOcrDaemon = (): void => {
  settlePending((req) => req.reject(new Error('OCR 引擎已关闭')))
  disposeDaemon('应用退出')
}
