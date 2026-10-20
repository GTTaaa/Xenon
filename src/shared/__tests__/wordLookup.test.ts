import test from 'node:test'
import assert from 'node:assert/strict'
import { findEnglishWordAtOffset, parseWordLookupResult } from '../wordLookup.ts'

test('光标落在单词内部时返回完整单词与偏移', () => {
  const selection = findEnglishWordAtOffset('Pick any model for any agent.', 9)

  assert.deepEqual(selection, {
    text: 'model',
    start: 9,
    end: 14
  })
})

test('点击单词末尾且光标落在空格处时仍返回前一个单词', () => {
  const selection = findEnglishWordAtOffset('Pick any model for any agent.', 14)

  assert.deepEqual(selection, {
    text: 'model',
    start: 9,
    end: 14
  })
})

test('带撇号或连字符的英文词保持完整', () => {
  const selection = findEnglishWordAtOffset("magpie edits the agent's framework-neutral config", 23)

  assert.equal(selection?.text, "agent's")
})

test('光标落在标点或空白时不返回单词', () => {
  assert.equal(findEnglishWordAtOffset('Hello, world.', 6), null)
  assert.equal(findEnglishWordAtOffset('Hello,  world.', 7), null)
})

test('合法的上下文释义会被接受', () => {
  const result = parseWordLookupResult(
    '```json\n{"lemma":"matter","meaning":"此处指真正重要","targetText":"真正重要","confidence":"high"}\n```',
    '只修改配置中真正重要的那一个密钥。'
  )

  assert.deepEqual(result, {
    lemma: 'matter',
    meaning: '此处指真正重要',
    targetText: '真正重要'
  })
})

test('译文对应不是目标句子的连续片段时拒绝结果', () => {
  const result = parseWordLookupResult(
    '{"lemma":"matter","meaning":"此处指真正重要","targetText":"并不存在","confidence":"high"}',
    '只修改配置中真正重要的那一个密钥。'
  )

  assert.equal(result, null)
})

test('低置信度、非中文释义或非法原形都会被拒绝', () => {
  assert.equal(
    parseWordLookupResult(
      '{"lemma":"matter","meaning":"此处指真正重要","targetText":"真正重要","confidence":"medium"}',
      '真正重要'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      '{"lemma":"matter","meaning":"really important","targetText":"重要","confidence":"high"}',
      '真正重要'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      '{"lemma":"123","meaning":"此处指重要","targetText":"重要","confidence":"high"}',
      '真正重要'
    ),
    null
  )
})
