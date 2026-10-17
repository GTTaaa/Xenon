/* eslint-disable @typescript-eslint/explicit-function-return-type -- 纯本地排查脚本，用 JS 编写，无需类型注解 */
/**
 * 冷启动可复现验证脚本（仅用于本地排查，不参与打包）
 *
 * 背景：macOS Vision 的 CoreML/e5rt 模型缓存目录按「可执行文件 basename」命名，
 * 即 ~/Library/Caches/<basename>/com.apple.e5rt.e5bundlecache/。
 * 因此把二进制复制成一个新名字，就等价于一次全新安装的首次冷启动 ——
 * 既能真实复现「第一次 OCR 需要现场编译模型」，又不会污染 / 破坏用户现有的
 * ~/Library/Caches/mac-vision-ocr 缓存。
 *
 * 用法：
 *   pnpm run verify:ocr-cold          # 一次全新冷启动 + 2 次热识别，结束自动清理
 *   pnpm run verify:ocr-cold --keep   # 保留复制出的二进制与临时缓存，便于二次观察
 *
 * 环境变量：
 *   OCR_VERIFY_TIMEOUT_MS  单次识别允许的最长等待（默认 240000）
 *
 * 退出码：0 全部符合预期；1 有断言失败或超时。
 */
import { spawn, execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir, userInfo } from 'os'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const SOURCE_BINARY = join(REPO_ROOT, 'resources/bin/mac-vision-ocr')

// 仓库内的测试用图（420x96 白底黑字，含中英文）
const SAMPLE_IMAGE = join(HERE, 'fixtures/ocr-sample.png')

// 判定「模型确实冷了」的下界：真实冷编译实测 28~60s，低于此值说明缓存没被隔离干净
const COLD_MIN_MS = 5000
// 判定「模型确实热了」的上界：热识别实测 80~200ms
const WARM_MAX_MS = 3000

const TIMEOUT_MS = Number(process.env.OCR_VERIFY_TIMEOUT_MS || 240000)
const KEEP = process.argv.includes('--keep')

let failures = 0

const pass = (msg) => {
  console.log(`  ✅ ${msg}`)
}

const fail = (msg) => {
  failures += 1
  console.log(`  ❌ ${msg}`)
}

const cachesRoot = () => join(userInfo().homedir, 'Library/Caches')

/** 以 daemon 模式起一个进程，发一次请求，返回耗时与原始输出 */
const runOnce = (binary, imagePath) =>
  new Promise((resolve, reject) => {
    const start = Date.now()
    const child = spawn(binary, ['--daemon'], { stdio: ['pipe', 'pipe', 'pipe'] })

    let buffer = ''
    let stderr = ''
    let settled = false

    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`超过 ${TIMEOUT_MS}ms 无响应（stderr: ${stderr.trim()}）`)))
    }, TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const line = buffer.slice(0, index)
      finish(() => resolve({ ms: Date.now() - start, raw: line }))
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => finish(() => reject(error)))
    child.on('exit', (code, signal) => {
      if (buffer.indexOf('\n') >= 0) return
      finish(() =>
        reject(
          new Error(`子进程提前退出（code=${code}, signal=${signal}, stderr=${stderr.trim()}）`)
        )
      )
    })

    child.stdin.write(`${imagePath}\n`)
  })

const parseResult = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return { ok: false, error: `无法解析输出: ${raw.slice(0, 200)}` }
  }
}

const main = async () => {
  console.log('== OCR 冷启动可复现验证 ==\n')

  if (process.platform !== 'darwin') {
    console.log('跳过：Vision OCR 仅在 macOS 上可用')
    return
  }

  if (!existsSync(SOURCE_BINARY)) {
    throw new Error(`未找到 ${SOURCE_BINARY}，请先执行 pnpm run build:ocr`)
  }
  if (!existsSync(SAMPLE_IMAGE)) {
    throw new Error(`缺少测试图片 ${SAMPLE_IMAGE}，仓库文件可能不完整`)
  }

  // 1. 复制成新名字 => 等价于全新安装（缓存目录名随之改变）
  const workDir = mkdtempSync(join(tmpdir(), 'xenon-ocr-cold-'))
  const freshBinary = join(workDir, `mac-vision-ocr-cold${Date.now() % 100000}`)
  const freshName = basename(freshBinary)
  const freshCacheDir = join(cachesRoot(), freshName)

  execFileSync('cp', [SOURCE_BINARY, freshBinary])
  console.log(`二进制      -> ${freshBinary}`)
  console.log(`对应缓存目录 -> ${freshCacheDir}`)

  if (existsSync(freshCacheDir)) {
    rmSync(freshCacheDir, { recursive: true, force: true })
    console.log('（同名旧缓存已清理，确保本次是真正的冷启动）')
  }
  console.log('')

  try {
    // 2. 首次识别：真实冷启动（现场编译模型）
    console.log('第 1 次识别（模拟全新安装首次 OCR，模型需现场编译）...')
    const cold = await runOnce(freshBinary, SAMPLE_IMAGE)
    const coldResult = parseResult(cold.raw)
    console.log(`   耗时 ${cold.ms}ms，输出 ${cold.raw.slice(0, 100)}`)

    if (!coldResult.ok) {
      fail(`首次识别失败：${coldResult.error}`)
    } else if (cold.ms < COLD_MIN_MS) {
      fail(
        `耗时仅 ${cold.ms}ms，低于冷启动下界 ${COLD_MIN_MS}ms —— ` +
          '缓存可能没隔离成功，本次不代表全新安装'
      )
    } else {
      pass(`真实经历了一次冷启动编译（${cold.ms}ms）`)
    }

    if (coldResult.ok && !String(coldResult.text || '').trim()) {
      fail('首次识别返回空文本，测试图片可能不适合作为 OCR 样本')
    } else if (coldResult.ok) {
      pass(`识别出了文本：${JSON.stringify(coldResult.text)}`)
    }

    // 3. 编译产物是否落盘
    if (!existsSync(freshCacheDir)) {
      fail(`未生成缓存目录 ${freshCacheDir}（等于后续每次都会重新冷启动）`)
    } else {
      const sizeKb = Number(execFileSync('du', ['-sk', freshCacheDir]).toString().split('\t')[0])
      const bundles = readdirSync(freshCacheDir)
      const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`
      pass(`模型缓存已落盘：${bundles.length} 个条目，约 ${sizeLabel}`)

      // 半成品残留是「编译被中途杀死」的典型症状，必须为 0
      const leftovers = []
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const full = join(dir, entry.name)
          if (entry.name.includes('.tmp.')) leftovers.push(full)
          else walk(full)
        }
      }
      walk(freshCacheDir)
      if (leftovers.length > 0) {
        fail(`残留 ${leftovers.length} 个 .tmp.* 半成品 bundle（说明编译曾被中途杀死）`)
      } else {
        pass('无 .tmp.* 半成品残留，编译完整结束')
      }
    }

    // 4. 后续识别必须秒回
    console.log('\n第 2、3 次识别（模型已编译落盘，重新起进程）...')
    for (const round of [2, 3]) {
      const warm = await runOnce(freshBinary, SAMPLE_IMAGE)
      const warmResult = parseResult(warm.raw)
      console.log(`   第 ${round} 次：${warm.ms}ms`)
      if (!warmResult.ok) {
        fail(`第 ${round} 次识别失败：${warmResult.error}`)
      } else if (warm.ms > WARM_MAX_MS) {
        fail(`第 ${round} 次耗时 ${warm.ms}ms，超过热识别上界 ${WARM_MAX_MS}ms`)
      } else {
        pass(`第 ${round} 次 ${warm.ms}ms，符合热识别预期`)
      }
    }
  } finally {
    if (KEEP) {
      console.log(`\n--keep 已指定，保留：${workDir} 与 ${freshCacheDir}`)
    } else {
      rmSync(workDir, { recursive: true, force: true })
      rmSync(freshCacheDir, { recursive: true, force: true })
      console.log('\n已清理临时二进制与临时缓存（用户现有 mac-vision-ocr 缓存未受影响）')
    }
  }

  console.log('')
  if (failures > 0) {
    console.log(`结果：${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('结果：全部断言通过')
}

main().catch((error) => {
  console.error('\n验证脚本异常:', error instanceof Error ? error.message : error)
  process.exit(1)
})
