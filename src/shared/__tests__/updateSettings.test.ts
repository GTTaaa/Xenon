import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_UPDATE_SETTINGS,
  UPDATE_CHECK_INTERVAL_OPTIONS,
  sanitizeUpdateSettings
} from '../config.ts'

test('缺省配置保留既有的自动检查与下载后重启体验', () => {
  assert.deepEqual(sanitizeUpdateSettings(), DEFAULT_UPDATE_SETTINGS)
  assert.equal(DEFAULT_UPDATE_SETTINGS.autoCheck, true)
  assert.equal(DEFAULT_UPDATE_SETTINGS.autoDownload, false)
  assert.equal(DEFAULT_UPDATE_SETTINGS.autoRestart, true)
  assert.equal(DEFAULT_UPDATE_SETTINGS.checkIntervalMinutes, 360)
})

test('只接受受支持的检查间隔并保留合法开关值', () => {
  assert.deepEqual(
    sanitizeUpdateSettings({
      autoCheck: false,
      checkIntervalMinutes: 60,
      autoDownload: true,
      autoRestart: false
    }),
    {
      autoCheck: false,
      checkIntervalMinutes: 60,
      autoDownload: true,
      autoRestart: false
    }
  )

  const unsupportedInterval = {
    checkIntervalMinutes: 120
  } as unknown as Parameters<typeof sanitizeUpdateSettings>[0]
  assert.equal(sanitizeUpdateSettings(unsupportedInterval).checkIntervalMinutes, 360)
  assert.deepEqual(UPDATE_CHECK_INTERVAL_OPTIONS, [60, 360, 1440])
})
