import assert from 'node:assert/strict'
import test from 'node:test'
import type { VocabItem } from '../services/vocabDatabase.ts'
import {
  collectUniqueEnglishWords,
  extractEnglishWordOccurrences,
  findVocabPhraseMatches,
  findVocabTextMatches,
  splitSentenceAroundVocab
} from '../services/vocabMatching.ts'

/** 生成字段完整的词条，便于聚焦测试匹配逻辑 */
const createVocabItem = (lemma: string, overrides: Partial<VocabItem> = {}): VocabItem => {
  return {
    lemma,
    lemmaLower: lemma.trim().toLowerCase(),
    surface: lemma,
    meaning: '测试释义',
    targetText: '',
    side: 'source',
    encounterCount: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

test('英文词提取会保留原始词形和精确偏移', () => {
  const text = "Don't ignore well-crafted details."
  const occurrences = extractEnglishWordOccurrences(text)

  assert.deepEqual(
    occurrences.map((item) => item.word),
    ["Don't", 'ignore', 'well-crafted', 'details']
  )
  assert.equal(text.slice(occurrences[2].start, occurrences[2].end), 'well-crafted')
  assert.deepEqual(collectUniqueEnglishWords(text), ["don't", 'ignore', 'well-crafted', 'details'])
})

test('多词短语匹配支持重复出现并保持边界', () => {
  const item = createVocabItem('take off')
  const text = 'They take off at dawn; we take off at noon. Uptake office stays.'
  const matches = findVocabPhraseMatches(text, [item])

  assert.equal(matches.length, 2)
  assert.equal(text.slice(matches[0].start, matches[0].end), 'take off')
  assert.equal(text.slice(matches[1].start, matches[1].end), 'take off')
})

test('文本匹配会优先保留长短语并避开重叠单词', () => {
  const items = [createVocabItem('take'), createVocabItem('take off')]
  const matches = findVocabTextMatches('Please take off your shoes, then take a seat.', items)

  assert.deepEqual(
    matches.map((match) => match.surface),
    ['take off', 'take']
  )
  assert.equal(matches[0].item.lemmaLower, 'take off')
})

test('关闭短语匹配后只标记独立单词', () => {
  const phrase = createVocabItem('take off')
  const word = createVocabItem('take')
  const text = 'Please take off your shoes, then take a seat.'

  assert.deepEqual(findVocabTextMatches(text, [phrase], { includePhrases: false }), [])

  const matches = findVocabTextMatches(text, [phrase, word], { includePhrases: false })
  assert.deepEqual(
    matches.map((match) => match.surface),
    ['take', 'take']
  )
  assert.ok(matches.every((match) => match.item.lemmaLower === 'take'))
})

test('单词匹配大小写不敏感并支持多次偶遇', () => {
  const item = createVocabItem('subtle')
  const matches = findVocabTextMatches('Subtle changes create subtle effects.', [item])

  assert.deepEqual(
    matches.map((match) => match.surface),
    ['Subtle', 'subtle']
  )
})

test('实际词形与 lemmaLower 不同时仍能匹配最近词形', () => {
  const item = createVocabItem('deprecate', {
    surface: 'deprecated'
  })
  const text = 'The legacy API has been deprecated in the latest release.'
  const matches = findVocabTextMatches(text, [item])

  assert.equal(matches.length, 1)
  assert.equal(matches[0].surface, 'deprecated')
  assert.equal(matches[0].item.lemmaLower, 'deprecate')
})

test('旧词条把语法缩写和实义动词存成短语时只匹配真正的实义词', () => {
  const item = createVocabItem('eat', {
    surface: "didn't eat"
  })
  const text = "I didn't eat today."

  assert.deepEqual(findVocabPhraseMatches(text, [item]), [])
  const matches = findVocabTextMatches(text, [item])
  assert.deepEqual(
    matches.map((match) => match.surface),
    ['eat']
  )
})

test('闪卡拆分能定位真实词形并保留前后文本', () => {
  const parts = splitSentenceAroundVocab('She carefully crafted every sentence.', 'crafted')

  assert.deepEqual(parts, {
    before: 'She carefully ',
    match: 'crafted',
    after: ' every sentence.'
  })
})
