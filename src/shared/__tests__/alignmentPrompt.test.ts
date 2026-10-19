import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAlignmentUserMessage } from '../alignmentPrompt.ts'
import { segmentText, tokenizeTextWords } from '../textAlignment.ts'

test('学习模式词片段按自然句分组且保留全部编号与文本', () => {
  const sourceText = 'Please review. Improve quality.'
  const targetText = '请审阅。提升质量。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')
  const sourceTokens = tokenizeTextWords(sourceText, 'ENGLISH', sourceSegments, 'sw')
  const targetTokens = tokenizeTextWords(targetText, 'CHINESE (SIM)', targetSegments, 'tw')

  const payload = JSON.parse(
    buildAlignmentUserMessage(
      {
        sourceText,
        targetText,
        sourceLanguage: 'ENGLISH',
        targetLanguage: 'CHINESE (SIM)',
        learningMode: true
      },
      sourceSegments,
      targetSegments,
      sourceTokens,
      targetTokens
    )
  ) as {
    sourceWords: Array<[string, Array<[string, string]>]>
    targetWords: Array<[string, Array<[string, string]>]>
  }

  assert.deepEqual(payload.sourceWords, [
    [
      's0',
      [
        ['sw0', 'Please'],
        ['sw1', 'review']
      ]
    ],
    [
      's1',
      [
        ['sw2', 'Improve'],
        ['sw3', 'quality']
      ]
    ]
  ])
  assert.deepEqual(
    payload.targetWords.map(([segmentId, words]) => [segmentId, words.map(([wordId]) => wordId)]),
    [
      ['t0', ['tw0', 'tw1']],
      ['t1', ['tw2', 'tw3']]
    ]
  )
})

test('普通对齐消息不携带词片段', () => {
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
})
