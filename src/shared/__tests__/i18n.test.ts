import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTranslator,
  getLanguageLabel,
  getProviderDisplayName,
  normalizeAppLanguage
} from '../i18n.ts'

test('界面语言只接受受支持的语言代码', () => {
  assert.equal(normalizeAppLanguage('zh-CN'), 'zh-CN')
  assert.equal(normalizeAppLanguage('en'), 'en')
  assert.equal(normalizeAppLanguage('ja'), 'zh-CN')
  assert.equal(normalizeAppLanguage(undefined), 'zh-CN')
})

test('中英文词条与变量插值正常', () => {
  const zh = createTranslator('zh-CN')
  const en = createTranslator('en')

  assert.equal(zh('config.provider.count', { total: 4, enabled: 2 }), '4 个 · 已启用 2 个')
  assert.equal(en('config.provider.count', { total: 4, enabled: 2 }), '4 total · 2 enabled')
  assert.equal(zh('app.provider.noneAria'), '当前没有启用任何服务商，点击打开模型面板查看')
  assert.equal(
    en('app.provider.noneAria'),
    'No provider is enabled. Open the model panel for details'
  )
})

test('目标语言名称跟随界面语言', () => {
  assert.equal(getLanguageLabel('zh-CN', 'en'), '英语 (English)')
  assert.equal(getLanguageLabel('en', 'zh'), 'Chinese (Simplified)')
  assert.equal(getLanguageLabel('en', 'auto'), 'Auto detect')
})

test('仅未重命名的内置服务商跟随界面语言', () => {
  assert.equal(
    getProviderDisplayName('en', { id: 'deepseek', name: 'DeepSeek 官方' }),
    'DeepSeek Official'
  )
  assert.equal(getProviderDisplayName('zh-CN', { id: 'qwen', name: 'Qwen' }), '通义千问')
  assert.equal(
    getProviderDisplayName('en', { id: 'openai', name: '我的 OpenAI 渠道' }),
    '我的 OpenAI 渠道'
  )
  assert.equal(getProviderDisplayName('en', { id: 'custom-1', name: '自建服务' }), '自建服务')
})
