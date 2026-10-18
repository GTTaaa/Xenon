import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterLearningTokens,
  parseAlignmentPairs,
  segmentText,
  tokenizeTextWords
} from '../textAlignment.ts'

test('中文按自然句切分并保留精确偏移', () => {
  const text = '你好。今天很好！'
  const segments = segmentText(text, 'CHINESE (SIM)', 's')

  assert.equal(segments.length, 2)
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['你好。', '今天很好！']
  )
  assert.equal(text.slice(segments[0].start, segments[0].end), '你好。')
  assert.equal(text.slice(segments[1].start, segments[1].end), '今天很好！')
})

test('英文片段之间的空格不出现在高亮范围内', () => {
  const text = 'Hello world. How are you?'
  const segments = segmentText(text, 'ENGLISH', 't')

  assert.equal(segments.length, 2)
  assert.equal(segments[0].text, 'Hello world.')
  assert.equal(segments[1].text, 'How are you?')
  assert.ok(segments[1].start > segments[0].end)
})

test('纯空白不会生成可悬停片段', () => {
  assert.deepEqual(segmentText('  \n\n  ', 'ENGLISH', 's'), [])
})

test('合法的多对一配对可以规范化生成对齐组', () => {
  const sourceText = '第一句。第二句。'
  const targetText = 'First and second sentences.'
  const sourceSegments = segmentText(sourceText, 'CHINESE (SIM)', 's')
  const targetSegments = segmentText(targetText, 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0', 's1'], target: ['t0'] }]
    }),
    sourceSegments,
    targetSegments
  )

  assert.ok(alignment)
  assert.equal(alignment.pairs.length, 1)
  assert.deepEqual(alignment.pairs[0].sourceIds, ['s0', 's1'])
  assert.deepEqual(alignment.pairs[0].targetIds, ['t0'])
})

test('兼容代码围栏包裹的 JSON', () => {
  const sourceSegments = segmentText('你好。', 'CHINESE (SIM)', 's')
  const targetSegments = segmentText('Hello.', 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    '```json\n{"pairs":[{"source":["s0"],"target":["t0"]}]}\n```',
    sourceSegments,
    targetSegments
  )

  assert.ok(alignment)
  assert.equal(alignment.pairs[0].id, 'p0')
})

test('遗漏片段时拒绝启用对齐', () => {
  const sourceSegments = segmentText('第一句。第二句。', 'CHINESE (SIM)', 's')
  const targetSegments = segmentText('First. Second.', 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }]
    }),
    sourceSegments,
    targetSegments
  )

  assert.equal(alignment, null)
})

test('重复使用片段编号时拒绝启用对齐', () => {
  const sourceSegments = segmentText('第一句。第二句。', 'CHINESE (SIM)', 's')
  const targetSegments = segmentText('First. Second.', 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [
        { source: ['s0'], target: ['t0'] },
        { source: ['s0', 's1'], target: ['t1'] }
      ]
    }),
    sourceSegments,
    targetSegments
  )

  assert.equal(alignment, null)
})

test('交叉配对时拒绝启用对齐', () => {
  const sourceSegments = segmentText('第一句。第二句。', 'CHINESE (SIM)', 's')
  const targetSegments = segmentText('First. Second.', 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [
        { source: ['s0'], target: ['t1'] },
        { source: ['s1'], target: ['t0'] }
      ]
    }),
    sourceSegments,
    targetSegments
  )

  assert.equal(alignment, null)
})

test('英文原文与中文译文可以生成保留精确偏移的词片段', () => {
  const sourceText = 'Please review the proposal.'
  const targetText = '请审阅这份提案。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')
  const sourceTokens = tokenizeTextWords(sourceText, 'ENGLISH', sourceSegments, 'sw')
  const targetTokens = tokenizeTextWords(targetText, 'CHINESE (SIM)', targetSegments, 'tw')

  assert.ok(sourceTokens.some((token) => token.text === 'review'))
  assert.ok(targetTokens.some((token) => token.text === '审阅'))
  for (const token of [...sourceTokens, ...targetTokens]) {
    const fullText = token.id.startsWith('sw') ? sourceText : targetText
    assert.equal(fullText.slice(token.start, token.end), token.text)
  }
})

test('学习候选词会过滤低价值虚词并重新连续编号', () => {
  const sourceText = 'The team looks forward to reviewing your proposal.'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const sourceTokens = tokenizeTextWords(sourceText, 'ENGLISH', sourceSegments, 'sw')
  const filteredTokens = filterLearningTokens(sourceTokens, 'ENGLISH', 'sw')

  assert.ok(filteredTokens.some((token) => token.text === 'team'))
  assert.ok(filteredTokens.some((token) => token.text === 'reviewing'))
  assert.ok(!filteredTokens.some((token) => token.text === 'The'))
  assert.ok(!filteredTokens.some((token) => token.text === 'your'))
  assert.deepEqual(
    filteredTokens.map((token) => token.id),
    filteredTokens.map((_, index) => `sw${index}`)
  )
})

test('合法的词级学习提示会附加到整句对齐结果', () => {
  const sourceText = 'Please review the proposal.'
  const targetText = '请审阅这份提案。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')
  const sourceTokens = tokenizeTextWords(sourceText, 'ENGLISH', sourceSegments, 'sw')
  const targetTokens = tokenizeTextWords(targetText, 'CHINESE (SIM)', targetSegments, 'tw')
  const reviewToken = sourceTokens.find((token) => token.text === 'review')
  const targetReviewToken = targetTokens.find((token) => token.text === '审阅')

  assert.ok(reviewToken)
  assert.ok(targetReviewToken)

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      learningHints: [
        {
          source: [reviewToken.id],
          target: [targetReviewToken.id],
          lemma: 'review',
          meaning: '审阅'
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    { sourceText, targetText, sourceTokens, targetTokens }
  )

  assert.ok(alignment)
  assert.equal(alignment.learningHints?.length, 1)
  assert.equal(alignment.learningHints?.[0].pairId, 'p0')
  assert.equal(alignment.learningHints?.[0].sourceText, 'review')
  assert.equal(alignment.learningHints?.[0].targetText, '审阅')
  assert.equal(alignment.learningHints?.[0].meaning, '审阅')
})

test('词级提示跨句对应时关闭全部词级提示但保留整句对齐', () => {
  const sourceText = 'Run. Walk.'
  const targetText = '跑。走。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')
  const sourceTokens = tokenizeTextWords(sourceText, 'ENGLISH', sourceSegments, 'sw')
  const targetTokens = tokenizeTextWords(targetText, 'CHINESE (SIM)', targetSegments, 'tw')
  const runToken = sourceTokens.find((token) => token.text === 'Run')
  const walkTargetToken = targetTokens.find((token) => token.text === '走')

  assert.ok(runToken)
  assert.ok(walkTargetToken)

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [
        { source: ['s0'], target: ['t0'] },
        { source: ['s1'], target: ['t1'] }
      ],
      learningHints: [
        {
          source: [runToken.id],
          target: [walkTargetToken.id],
          lemma: 'run',
          meaning: '走'
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    { sourceText, targetText, sourceTokens, targetTokens }
  )

  assert.ok(alignment)
  assert.equal(alignment.pairs.length, 2)
  assert.equal(alignment.learningHints, undefined)
})

test('词级提示重复使用单词编号时整组关闭，避免覆盖冲突', () => {
  const sourceText = 'Please review the proposal.'
  const targetText = '请审阅这份提案。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')
  const sourceTokens = tokenizeTextWords(sourceText, 'ENGLISH', sourceSegments, 'sw')
  const targetTokens = tokenizeTextWords(targetText, 'CHINESE (SIM)', targetSegments, 'tw')
  const reviewToken = sourceTokens.find((token) => token.text === 'review')
  const targetReviewToken = targetTokens.find((token) => token.text === '审阅')

  assert.ok(reviewToken)
  assert.ok(targetReviewToken)

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      learningHints: [
        {
          source: [reviewToken.id],
          target: [targetReviewToken.id],
          lemma: 'review',
          meaning: '审阅'
        },
        {
          source: [reviewToken.id],
          target: [targetReviewToken.id],
          lemma: 'review',
          meaning: '提案'
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    { sourceText, targetText, sourceTokens, targetTokens }
  )

  assert.ok(alignment)
  assert.equal(alignment.learningHints, undefined)
})
