import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectLanguage,
  resolveAutoTargetLanguage,
  resolvePromptLanguage,
  getLanguageInfo,
  SUPPORTED_LANGUAGES
} from '../languageDetector.ts'

test('语言列表元数据完整性', () => {
  assert.ok(SUPPORTED_LANGUAGES.length > 0)
  const autoInfo = getLanguageInfo('auto')
  assert.equal(autoInfo.code, 'auto')
  assert.equal(autoInfo.shortLabel, 'AUTO')

  const zhInfo = getLanguageInfo('zh')
  assert.equal(zhInfo.promptName, 'CHINESE (SIM)')

  const enInfo = getLanguageInfo('en')
  assert.equal(enInfo.promptName, 'ENGLISH')
})

test('检测中英日韩等主流语言', () => {
  // 英文测试
  const enRes = detectLanguage('Hello world, how are you today?')
  assert.equal(enRes.detected, 'en')
  assert.ok(enRes.confidence > 0.8)

  // 中文测试
  const zhRes = detectLanguage('你好，这是一个测试！')
  assert.equal(zhRes.detected, 'zh')
  assert.ok(zhRes.confidence > 0.9)

  // 日文测试（假名）
  const jaRes1 = detectLanguage('こんにちは、元気ですか？')
  assert.equal(jaRes1.detected, 'ja')
  assert.ok(jaRes1.confidence > 0.9)

  // 日文测试（汉字+假名）
  const jaRes2 = detectLanguage('東京に行きたいです')
  assert.equal(jaRes2.detected, 'ja')
  assert.ok(jaRes2.confidence > 0.9)

  // 韩文测试
  const koRes = detectLanguage('안녕하세요 오늘 날씨가 좋네요')
  assert.equal(koRes.detected, 'ko')
  assert.ok(koRes.confidence > 0.9)
})

test('检测主要欧洲语言（德语、法语、西班牙语、俄语、意大利语、葡萄牙语）', () => {
  // 德语测试
  const deRes = detectLanguage('Guten Tag, wie geht es Ihnen?')
  assert.equal(deRes.detected, 'de')

  // 法语测试
  const frRes = detectLanguage("Bonjour, comment allez-vous aujourd'hui?")
  assert.equal(frRes.detected, 'fr')

  // 西班牙语测试
  const esRes = detectLanguage('Hola, ¿cómo estás hoy?')
  assert.equal(esRes.detected, 'es')

  // 俄语测试
  const ruRes = detectLanguage('Привет, как твои дела сегодня?')
  assert.equal(ruRes.detected, 'ru')

  // 意大利语测试
  const itRes = detectLanguage('Ciao, come stai oggi?')
  assert.equal(itRes.detected, 'it')

  // 葡萄牙语测试
  const ptRes = detectLanguage('Olá, como você está hoje?')
  assert.equal(ptRes.detected, 'pt')
})

test('空文本与纯标点兜底策略', () => {
  const emptyRes = detectLanguage('')
  assert.equal(emptyRes.confidence, 0)

  const spacesRes = detectLanguage('   \n  \t  ')
  assert.equal(spacesRes.confidence, 0)

  const punctuationRes = detectLanguage('... ??? !!! ---')
  assert.equal(punctuationRes.confidence, 0)
})

test('目标语言智能适配与 Prompt 转换', () => {
  // 源语言检测为中文时，目标语言推荐为英文
  assert.equal(resolveAutoTargetLanguage('zh'), 'en')

  // 源语言检测为其他语言时，目标语言推荐为中文
  assert.equal(resolveAutoTargetLanguage('en'), 'zh')
  assert.equal(resolveAutoTargetLanguage('ja'), 'zh')
  assert.equal(resolveAutoTargetLanguage('ko'), 'zh')
  assert.equal(resolveAutoTargetLanguage('de'), 'zh')

  // Prompt 转换
  assert.equal(resolvePromptLanguage('auto', 'ja'), 'JAPANESE')
  assert.equal(resolvePromptLanguage('auto', 'zh'), 'CHINESE (SIM)')
  assert.equal(resolvePromptLanguage('de', 'ja'), 'GERMAN')
})
