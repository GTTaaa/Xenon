#!/usr/bin/env node

// 纯 JavaScript 脚本使用 JSDoc 描述类型，关闭对该文件中箭头函数返回类型的重复检查。
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 输出中文错误并终止发布。
 * @param {string} message 错误说明
 * @returns {never} 该函数不会正常返回
 */
const fail = (message) => {
  console.error(`发布终止：${message}`)
  process.exit(1)
}

const bumpArgumentIndex = process.argv.indexOf('--bump')
const bumpType = bumpArgumentIndex === -1 ? null : process.argv[bumpArgumentIndex + 1]
if (bumpType !== null && !['patch', 'minor', 'major'].includes(bumpType)) {
  fail('--bump 仅支持 patch、minor 或 major')
}

/**
 * 读取命令输出，失败时返回空字符串。
 * @param {string} command 可执行命令
 * @param {string[]} args 命令参数
 * @returns {string} 去除首尾空白的标准输出
 */
const readCommand = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  return result.status === 0 ? result.stdout.trim() : ''
}

/**
 * 运行构建或发布命令，失败时立即终止。
 * @param {string} command 可执行命令
 * @param {string[]} args 命令参数
 * @param {Record<string, string>} extraEnv 仅本次命令附加的环境变量
 * @returns {void}
 */
const runCommand = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} 执行失败`)
  }
}

const gitStatus = readCommand('git', ['status', '--porcelain'])
if (gitStatus) {
  fail('工作区存在未提交改动，请先提交代码后再发布')
}

const branch = readCommand('git', ['branch', '--show-current'])
if (branch !== 'main') {
  fail(`当前分支为 ${branch || '未知'}，请在 main 分支发布`)
}

const token = readCommand('gh', ['auth', 'token'])
if (!token) {
  fail('无法读取 GitHub Token，请先执行 gh auth login')
}

const localHead = readCommand('git', ['rev-parse', 'HEAD'])
const remoteMainLine = readCommand('git', ['ls-remote', 'origin', 'refs/heads/main'])
const remoteHead = remoteMainLine.split(/\s+/)[0] || ''
if (!remoteHead) {
  fail('无法读取 origin/main，请检查网络和远程仓库')
}

const remoteIsAncestor =
  spawnSync('git', ['merge-base', '--is-ancestor', remoteHead, 'HEAD'], {
    cwd: projectRoot,
    stdio: 'ignore'
  }).status === 0
if (!remoteIsAncestor) {
  fail('本地 main 落后于 origin/main 或已分叉，请先同步远程分支')
}
const hasUnpushedCommits = localHead !== remoteHead

const readVersion = () => {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  return String(packageJson.version || '')
}

let version = readVersion()
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json 中的版本号无效：${version || '空'}`)
}

if (bumpType) {
  console.log(`正在自动提升版本（${bumpType}）`)
  runCommand('pnpm', ['version', bumpType, '--no-git-tag-version'])
  version = readVersion()
  console.log(`版本已提升至 ${version}`)
}

const tag = `v${version}`
const existingRelease = spawnSync('gh', ['release', 'view', tag], {
  cwd: projectRoot,
  stdio: 'ignore'
})
if (existingRelease.status === 0) {
  fail(`GitHub 已存在 ${tag} Release，请先提升 package.json 版本`)
}

console.log(`准备发布 Xenon ${version}，目标标签 ${tag}`)
runCommand('pnpm', ['run', 'build'])

if (bumpType) {
  runCommand('git', ['add', '--all'])
  runCommand('git', ['commit', '-m', `chore: 发布 v${version}`])
}

if (bumpType || hasUnpushedCommits) {
  runCommand('git', ['push', 'origin', 'main'])
  console.log(`main 分支已推送到 origin/main`)
}

runCommand('pnpm', ['exec', 'electron-builder', '--mac', '--publish', 'always'], {
  GH_TOKEN: token
})

const releaseUrl = readCommand('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url'])
console.log(releaseUrl ? `发布完成：${releaseUrl}` : `发布命令已完成，请检查 ${tag} Release`)
