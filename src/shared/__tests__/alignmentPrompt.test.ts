import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAlignmentSystemPrompt, buildAlignmentUserMessage } from '../alignmentPrompt.ts'
import { segmentText } from '../textAlignment.ts'

test('对齐消息只包含句级片段，不携带词级学习数据', () => {
  const sourceText = 'Please review. Improve quality.'
  const targetText = '请审阅。提升质量。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')

  const payload = JSON.parse(
    buildAlignmentUserMessage(
      {
        sourceText,
        targetText,
        sourceLanguage: 'ENGLISH',
        targetLanguage: 'CHINESE (SIM)'
      },
      sourceSegments,
      targetSegments
    )
  ) as Record<string, unknown>

  assert.deepEqual(payload, {
    sourceLanguage: 'ENGLISH',
    targetLanguage: 'CHINESE (SIM)',
    sourceSegments: [
      ['s0', 'Please review.'],
      ['s1', 'Improve quality.']
    ],
    targetSegments: [
      ['t0', '请审阅。'],
      ['t1', '提升质量。']
    ]
  })
})

test('句级对齐消息不产生空词级字段', () => {
  const sourceText = 'Hello.'
  const targetText = '你好。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')
  const payload = JSON.parse(
    buildAlignmentUserMessage(
      {
        sourceText,
        targetText,
        sourceLanguage: 'ENGLISH',
        targetLanguage: 'CHINESE (SIM)'
      },
      sourceSegments,
      targetSegments
    )
  ) as Record<string, unknown>

  assert.equal('sourceWords' in payload, false)
  assert.equal('targetWords' in payload, false)
  assert.equal('learningHints' in payload, false)
})

test('英译中 Prompt 要求最多提取三个原文学习高亮', () => {
  const prompt = buildAlignmentSystemPrompt('source')

  assert.match(prompt, /1 to 3/)
  assert.match(prompt, /"side":"source"/)
  assert.match(prompt, /exact contiguous substring of the source text/)
  assert.match(prompt, /"highlights"/)
})

test('中译英 Prompt 要求从英文译文提取地道表达并说明原因', () => {
  const prompt = buildAlignmentSystemPrompt('target')

  assert.match(prompt, /1 to 2/)
  assert.match(prompt, /"side":"target"/)
  assert.match(prompt, /highlight side must be "target"/)
  assert.match(prompt, /generated English target segments/)
  assert.match(prompt, /why the English expression is natural or idiomatic/)
})

test('不支持的学习方向要求返回空高亮数组', () => {
  const prompt = buildAlignmentSystemPrompt(null)

  assert.match(prompt, /highlights as an empty array/)
})
