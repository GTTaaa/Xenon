/* eslint-disable @typescript-eslint/explicit-function-return-type -- 纯本地排查脚本，用 JS 编写，无需类型注解 */
/**
 * 端到端验证：真实执行 src/main/services/ocrEngine.ts 的冷启动分支
 *
 * 与 verify-ocr-cold.mjs 的区别：
 * - verify-ocr-cold.mjs 直接对着二进制发请求，只验证 Swift 侧；
 * - 本脚本用 esbuild 把 ocrEngine.ts 打成 CJS 并在 Node 里真实运行，
 *   验证的是「应用实际会走的那条代码路径」：懒启动 daemon → 冷启动预算 →
 *   预热并发 → 热识别 → 缓存落盘 → 半成品残留。
 *
 * 全新安装的模拟方式：临时把 ~/Library/Caches/mac-vision-ocr 移走，
 * 跑完在 finally 里原样搬回（缓存仅 ~76KB，搬移是原子 rename，不会损坏）。
 *
 * 用法：pnpm run verify:ocr-engine
 * 退出码：0 通过；1 失败。
 */
import { execFileSync, spawn } from 'child_process'
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir, userInfo } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as esbuild from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const ENGINE_SRC = join(REPO_ROOT, 'src/main/services/ocrEngine.ts')
const SAMPLE_IMAGE = join(HERE, 'fixtures/ocr-sample.png')
const BINARY = join(REPO_ROOT, 'resources/bin/mac-vision-ocr')

const CACHE_DIR = join(userInfo().homedir, 'Library/Caches/mac-vision-ocr')
const CACHE_BACKUP = `${CACHE_DIR}.verify-backup-${Date.now()}`

const COLD_MIN_MS = 5000
const WARM_MAX_MS = 3000

let failures = 0
const pass = (m) => {
  console.log(`  ✅ ${m}`)
}
const fail = (m) => {
  failures += 1
  console.log(`  ❌ ${m}`)
}

/** 收集缓存目录里的 .tmp.* 半成品（编译被中途杀死的症状） */
const findLeftovers = (dir) => {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(current, entry.name)
      if (entry.name.includes('.tmp.')) found.push(full)
      else walk(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return found
}

/**
 * ocrEngine 只从 electron 里取 app.getAppPath()，这里用一个最小 stub 替掉，
 * 让引擎能在普通 Node 进程里跑（平台能力全部走真实二进制）
 */
const writeElectronStub = (dir) => {
  const stubPath = join(dir, 'electron-stub.cjs')
  writeFileSync(stubPath, 'module.exports = { app: { getAppPath: () => process.cwd() } }\n')
  return stubPath
}

const bundle = async (electronStub) => {
  const bundlePath = join(tmpdir(), `xenon-ocr-engine-${Date.now()}.cjs`)
  await esbuild.build({
    entryPoints: [ENGINE_SRC],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'error',
    alias: { electron: electronStub }
  })
  return bundlePath
}

/** 在独立 Node 进程里跑一个场景，把结果以 JSON 打回来 */
const runScenario = (bundlePath, script) =>
  new Promise((resolve, reject) => {
    const code = `
      process.resourcesPath = '/nonexistent'
      const engine = require(${JSON.stringify(bundlePath)});
      ${script}
    `
    const child = spawn(process.execPath, ['-e', code], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d.toString()
    })
    child.stderr.on('data', (d) => {
      err += d.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      // 主进程的 console.log/warn 混在 stdout 里，只取最后一行 JSON 结果
      const lines = out.trim().split('\n')
      const last = lines[lines.length - 1] || ''
      let payload = null
      try {
        payload = JSON.parse(last)
      } catch {
        payload = null
      }
      resolve({ code, payload, out, err })
    })
  })

const main = async () => {
  console.log('== OCR 引擎端到端验证（模拟全新安装）==\n')

  if (process.platform !== 'darwin') {
    console.log('跳过：Vision OCR 仅在 macOS 上可用')
    return
  }
  if (!existsSync(BINARY)) throw new Error(`未找到 ${BINARY}，请先执行 pnpm run build:ocr`)
  if (!existsSync(SAMPLE_IMAGE)) throw new Error(`缺少测试图片 ${SAMPLE_IMAGE}`)

  const stubDir = tmpdir()
  const electronStub = writeElectronStub(stubDir)
  const bundlePath = await bundle(electronStub)
  console.log(`引擎代码已打包 -> ${bundlePath}`)

  // 模拟全新安装：把现有缓存移走
  const hadCache = existsSync(CACHE_DIR)
  if (hadCache) {
    renameSync(CACHE_DIR, CACHE_BACKUP)
    console.log(`已把现有缓存临时移到 ${CACHE_BACKUP}`)
  } else {
    console.log('本机暂无缓存，天然就是冷启动状态')
  }
  console.log('')

  const scenario = `
    (async () => {
      const t0 = Date.now()
      const warm = engine.prewarmOcr()
      const s1 = Date.now()
      const first = await engine.recognizeImageText(${JSON.stringify(SAMPLE_IMAGE)})
      const firstMs = Date.now() - s1
      await warm
      const prewarmMs = Date.now() - t0
      const s2 = Date.now()
      const second = await engine.recognizeImageText(${JSON.stringify(SAMPLE_IMAGE)})
      const secondMs = Date.now() - s2
      const s3 = Date.now()
      const bad = await engine.recognizeImageText('/tmp/xenon-no-such-file.png').then(
        () => 'UNEXPECTED_OK',
        (e) => 'ERR ' + e.message
      )
      const s4 = Date.now()
      const after = await engine.recognizeImageText(${JSON.stringify(SAMPLE_IMAGE)})
      const afterMs = Date.now() - s4
      engine.shutdownOcrDaemon()
      console.log(JSON.stringify({ prewarmMs, firstMs, first, secondMs, second, bad, afterMs, after }))
    })().catch((e) => {
      console.log(JSON.stringify({ error: e.message }))
      process.exitCode = 3
    })
  `

  try {
    console.log('运行场景（首次识别会真实触发模型编译，通常 30~60s）...')
    const { payload, out, err } = await runScenario(bundlePath, scenario)

    if (!payload || payload.error) {
      console.log(out.trim())
      if (err.trim()) console.log('stderr:', err.trim().slice(0, 2000))
      fail(`场景执行失败：${payload ? payload.error : '无输出'}`)
    } else {
      console.log(`   预热+首次识别 ${payload.prewarmMs}ms，其中首次识别 ${payload.firstMs}ms`)
      console.log(`   第二次识别 ${payload.secondMs}ms`)
      console.log(`   错误图片 -> ${payload.bad}`)
      console.log(`   出错之后再次识别 ${payload.afterMs}ms`)
      console.log('')

      // 冷启动：首次识别必须真的付出了编译成本
      if (payload.firstMs < COLD_MIN_MS) {
        fail(`首次识别仅 ${payload.firstMs}ms，未真正冷启动（缓存未隔离干净）`)
      } else {
        pass(`首次识别支付了冷启动成本（${payload.firstMs}ms），且没有卡在 15s 超时上`)
      }
      if (String(payload.first || '').trim() === '') {
        fail('首次识别返回空文本')
      } else {
        pass(`首次识别结果正确：${JSON.stringify(payload.first)}`)
      }

      // 热识别
      if (payload.secondMs > WARM_MAX_MS) {
        fail(`第二次识别 ${payload.secondMs}ms，超过热识别上界 ${WARM_MAX_MS}ms`)
      } else {
        pass(`第二次识别 ${payload.secondMs}ms（daemon 常驻生效）`)
      }
      if (payload.second !== payload.first) {
        fail('两次识别结果不一致')
      } else {
        pass('两次识别结果一致')
      }

      // 坏图片不应拖垮 daemon
      if (!String(payload.bad).startsWith('ERR')) {
        fail(`不存在的图片应报错，实际：${payload.bad}`)
      } else {
        pass('不存在的图片返回明确错误，未误杀 daemon')
      }
      if (String(payload.after || '').trim() === '') {
        fail('出错后再次识别失败（daemon 被误回收）')
      } else {
        pass(`出错后再次识别 ${payload.afterMs}ms 正常`)
      }
    }

    // 缓存落盘 + 无半成品
    console.log('')
    const leftovers = findLeftovers(CACHE_DIR)
    if (leftovers.length > 0) {
      fail(`缓存目录残留 ${leftovers.length} 个 .tmp.* 半成品`, leftovers[0])
    } else {
      pass('缓存目录无 .tmp.* 半成品残留')
    }
    if (!existsSync(CACHE_DIR)) {
      fail('未生成缓存目录，下次仍会冷启动')
    } else {
      const sizeKb = Number(execFileSync('du', ['-sk', CACHE_DIR]).toString().split('\t')[0])
      const label = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`
      pass(`编译产物已落盘（${label}），后续启动免编译`)
    }
  } finally {
    // 还原用户原有缓存
    rmSync(CACHE_DIR, { recursive: true, force: true })
    if (hadCache) {
      renameSync(CACHE_BACKUP, CACHE_DIR)
      console.log('\n已还原原有缓存')
    } else {
      console.log('\n本机原本无缓存，已清理本次生成的缓存')
    }
    rmSync(bundlePath, { force: true })
    rmSync(electronStub, { force: true })
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
