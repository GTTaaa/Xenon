/* eslint-disable @typescript-eslint/explicit-function-return-type -- 纯本地渲染脚本，用 JS 编写，无需类型注解 */
/**
 * Xenon 宣传短片渲染脚本
 *
 * 原理：以 --remote-debugging-pipe 启动无头 Chrome，通过 CDP 管道逐帧调用页面中的
 * window.render(t) 并截图，截图流式写入 ffmpeg 合成 H.264 MP4。
 *
 * 用法：
 *   node promo/render.mjs                 # 默认 1920x1080 / 30fps
 *   node promo/render.mjs --fps 60        # 60 帧更顺滑
 *   node promo/render.mjs --preview 12.5  # 只导出第 12.5 秒的单帧 PNG，便于检查画面
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const promoDir = dirname(fileURLToPath(import.meta.url))
const outDir = join(promoDir, 'out')
mkdirSync(outDir, { recursive: true })

/** 解析命令行参数 */
function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}

const fps = Number(readArg('fps', 30))
const previewAt = readArg('preview', null)
const chromePath =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!existsSync(chromePath)) {
  console.error(`未找到 Chrome：${chromePath}，可通过 CHROME_PATH 环境变量指定`)
  process.exit(1)
}

/** 启动 Chrome，并封装基于管道的 CDP 收发 */
function launchChrome() {
  const userDataDir = join(outDir, '.chrome-profile')
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      // 只加载本地静态页面；嵌套沙箱环境下 Chrome 自带进程沙箱无法初始化
      '--no-sandbox',
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1920,1080',
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
  )

  // Chrome 意外退出时输出日志并终止，避免 Promise 悬挂导致脚本静默结束
  let stderrLog = ''
  chrome.stderr.on('data', (chunk) => (stderrLog += chunk))
  chrome.on('exit', (code) => {
    if (pending.size > 0) {
      console.error(`Chrome 意外退出（code=${code}）：\n${stderrLog.slice(-2000)}`)
      process.exit(1)
    }
  })

  const writer = chrome.stdio[3]
  const reader = chrome.stdio[4]
  let nextId = 1
  let buffer = Buffer.alloc(0)
  const pending = new Map()

  // CDP 管道协议：每条消息是以 \0 结尾的 JSON
  reader.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    let end
    while ((end = buffer.indexOf(0)) !== -1) {
      const message = JSON.parse(buffer.subarray(0, end).toString('utf8'))
      buffer = buffer.subarray(end + 1)
      if (message.id && pending.has(message.id)) {
        const { resolve: done, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else done(message.result)
      }
    }
  })

  /** 发送一条 CDP 命令，sessionId 用于指向具体页面 */
  const send = (method, params = {}, sessionId) =>
    new Promise((done, reject) => {
      const id = nextId++
      pending.set(id, { resolve: done, reject })
      writer.write(JSON.stringify({ id, method, params, sessionId }) + '\0')
    })

  return { chrome, send }
}

/** 启动 ffmpeg，从 stdin 读取 PNG 序列并编码为 MP4 */
function launchFfmpeg(outputFile) {
  return spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputFile
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] }
  )
}

async function main() {
  const { chrome, send } = launchChrome()
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => send(method, params, sessionId)

  await page('Page.enable')
  await page('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  })
  const url = pathToFileURL(resolve(promoDir, 'index.html')).href + '?capture'
  await page('Page.navigate', { url })

  // 等待页面、字体与图片全部就绪
  const evaluate = async (expression) => {
    const { result } = await page('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    return result.value
  }
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate(
      `document.readyState === 'complete' && typeof window.render === 'function'`
    )
    if (ready) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await evaluate(
    `document.fonts.ready.then(() => Promise.all([...document.images].map((img) => img.decode())))`
  )
  const duration = await evaluate('window.DURATION')

  /** 渲染并截取指定时间点的一帧，返回 PNG Buffer */
  const capture = async (t) => {
    await evaluate(`window.render(${t}); new Promise((r) => requestAnimationFrame(() => r(true)))`)
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(data, 'base64')
  }

  if (previewAt !== null) {
    const file = join(outDir, `preview-${previewAt}s.png`)
    writeFileSync(file, await capture(Number(previewAt)))
    console.log(`已导出预览帧：${file}`)
  } else {
    const outputFile = join(outDir, `xenon-promo-${fps}fps.mp4`)
    const ffmpeg = launchFfmpeg(outputFile)
    const totalFrames = Math.round(duration * fps)
    const startedAt = Date.now()
    for (let frame = 0; frame < totalFrames; frame++) {
      const png = await capture(frame / fps)
      // 处理背压，避免内存堆积
      if (!ffmpeg.stdin.write(png)) {
        await new Promise((r) => ffmpeg.stdin.once('drain', r))
      }
      if (frame % fps === 0) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
        process.stdout.write(`\r渲染进度 ${frame}/${totalFrames} 帧（已用 ${elapsed}s）`)
      }
    }
    ffmpeg.stdin.end()
    await new Promise((r) => ffmpeg.on('close', r))
    console.log(`\n视频已生成：${outputFile}`)
  }

  chrome.kill()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
