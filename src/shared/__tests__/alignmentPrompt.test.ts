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

test('对齐 Prompt 只负责句级配对，不再自动推荐单词或短语', () => {
  const prompt = buildAlignmentSystemPrompt()

  assert.match(prompt, /"pairs"/)
  assert.match(prompt, /"highlights":\[\]/)
  assert.match(prompt, /highlights must always be an empty array/)
  assert.match(prompt, /Do not recommend/)
})
