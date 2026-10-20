import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterLearningTokens,
  parseAlignmentPairs,
  resolveLearningHighlightSide,
  segmentText,
  tokenizeTextWords
} from '../textAlignment.ts'
import { alignmentRegressionCases } from './fixtures/alignmentRegressionCases.ts'
import { learningRegressionCases } from './fixtures/learningRegressionCases.ts'

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

test('英文句号后接小写品牌名时仍按自然句切分', () => {
  const text = 'A subscription works in one agent. magpie puts everything behind one gateway:'
  const segments = segmentText(text, 'ENGLISH', 's')

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['A subscription works in one agent.', 'magpie puts everything behind one gateway:']
  )
  assert.equal(text.slice(segments[0].start, segments[0].end), segments[0].text)
  assert.equal(text.slice(segments[1].start, segments[1].end), segments[1].text)
})

test('Markdown 列表项内部的小写句首也会单独切分', () => {
  const text = '- **Pick any model for any agent** from one list. magpie edits the important key.'
  const segments = segmentText(text, 'ENGLISH', 's')

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['- **Pick any model for any agent** from one list.', 'magpie edits the important key.']
  )
})

test('常见英文缩写后的句号不会误切', () => {
  const text = 'Use e.g. this value with Dr. smith. It works.'
  const segments = segmentText(text, 'ENGLISH', 's')

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['Use e.g. this value with Dr. smith.', 'It works.']
  )
})

test('真实中英文文本的分句和一一配对保持稳定', () => {
  assert.equal(alignmentRegressionCases.length, 10)

  for (const regressionCase of alignmentRegressionCases) {
    const sourceSegments = segmentText(regressionCase.sourceText, 'ENGLISH', 's')
    const targetSegments = segmentText(regressionCase.targetText, 'CHINESE (SIM)', 't')

    assert.deepEqual(
      sourceSegments.map((segment) => segment.text),
      regressionCase.expectedSourceSegments,
      `${regressionCase.name}: 英文分句不符合预期`
    )
    assert.deepEqual(
      targetSegments.map((segment) => segment.text),
      regressionCase.expectedTargetSegments,
      `${regressionCase.name}: 中文分句不符合预期`
    )

    const alignment = parseAlignmentPairs(
      JSON.stringify({
        pairs: regressionCase.expectedPairs.map((pair) => ({
          source: pair.sourceIds,
          target: pair.targetIds
        }))
      }),
      sourceSegments,
      targetSegments
    )

    assert.ok(alignment, `${regressionCase.name}: 合法配对不应被拒绝`)
    assert.deepEqual(
      alignment.pairs.map((pair) => ({
        sourceIds: pair.sourceIds,
        targetIds: pair.targetIds
      })),
      regressionCase.expectedPairs,
      `${regressionCase.name}: 配对结果不符合预期`
    )
  }
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

test('学习高亮方向只在中英双向翻译时启用', () => {
  assert.equal(resolveLearningHighlightSide('ENGLISH', 'CHINESE (SIM)'), 'source')
  assert.equal(resolveLearningHighlightSide('CHINESE (SIM)', 'ENGLISH'), 'target')
  assert.equal(resolveLearningHighlightSide('ENGLISH', 'JAPANESE'), null)
})

test('学习模式 36 组候选词回归样例保持预期过滤结果', () => {
  assert.equal(learningRegressionCases.length, 36)

  for (const regressionCase of learningRegressionCases) {
    const sourceSegments = segmentText(regressionCase.sourceText, 'ENGLISH', 's')
    const sourceTokens = tokenizeTextWords(
      regressionCase.sourceText,
      'ENGLISH',
      sourceSegments,
      'sw'
    )
    const filteredTerms = new Set(
      filterLearningTokens(sourceTokens, 'ENGLISH', 'sw').map((token) => token.text.toLowerCase())
    )

    for (const term of regressionCase.expectedTerms) {
      assert.ok(
        filteredTerms.has(term.toLowerCase()),
        `${regressionCase.name}: 应保留候选词 ${term}`
      )
    }
    for (const term of regressionCase.forbiddenTerms) {
      assert.ok(
        !filteredTerms.has(term.toLowerCase()),
        `${regressionCase.name}: 不应保留候选词 ${term}`
      )
    }
  }
})

test('英译中的学习高亮会校验并计算精确偏移', () => {
  const sourceText = 'Please ramp up the review process.'
  const targetText = '请加快审阅流程。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: [
        {
          pairId: 'p0',
          side: 'source',
          surface: 'ramp up',
          lemma: 'ramp up',
          meaning: '逐步加快',
          targetText: '加快',
          note: ''
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'ENGLISH',
      targetLanguage: 'CHINESE (SIM)'
    }
  )

  assert.ok(alignment)
  assert.equal(alignment.highlights.length, 1)
  assert.deepEqual(
    {
      pairId: alignment.highlights[0].pairId,
      side: alignment.highlights[0].side,
      surface: alignment.highlights[0].surface,
      start: alignment.highlights[0].start,
      end: alignment.highlights[0].end
    },
    {
      pairId: 'p0',
      side: 'source',
      surface: 'ramp up',
      start: sourceText.indexOf('ramp up'),
      end: sourceText.indexOf('ramp up') + 'ramp up'.length
    }
  )
})

test('中译英会高亮英文译文并保留地道表达说明', () => {
  const sourceText = '请加快审阅流程。'
  const targetText = 'Please ramp up the review process.'
  const sourceSegments = segmentText(sourceText, 'CHINESE (SIM)', 's')
  const targetSegments = segmentText(targetText, 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: [
        {
          pairId: 0,
          side: 'target',
          surface: 'ramp up',
          lemma: 'ramp up',
          meaning: '加快、提升',
          targetText: '加快',
          note: 'ramp up 比 increase 更有逐步加码的力度感，更符合项目推进语境。'
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'CHINESE (SIM)',
      targetLanguage: 'ENGLISH'
    }
  )

  assert.ok(alignment)
  assert.equal(alignment.highlights.length, 1)
  assert.equal(alignment.highlights[0].pairId, 'p0')
  assert.equal(alignment.highlights[0].side, 'target')
  assert.equal(alignment.highlights[0].start, targetText.indexOf('ramp up'))
  assert.ok(alignment.highlights[0].note.includes('力度感'))
})

test('方向错误的侧、无效配对和非连续短语只丢弃单项', () => {
  const sourceText = 'Please streamline the review process.'
  const targetText = '请精简审阅流程。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: [
        {
          pairId: 'p0',
          side: 'target',
          surface: 'streamline',
          lemma: 'streamline',
          meaning: '精简',
          targetText: '精简',
          note: ''
        },
        {
          pairId: 'p9',
          side: 'source',
          surface: 'review',
          lemma: 'review',
          meaning: '审阅',
          targetText: '审阅',
          note: ''
        },
        {
          pairId: 'p0',
          side: 'source',
          surface: 'stream line',
          lemma: 'streamline',
          meaning: '精简',
          targetText: '精简',
          note: ''
        },
        {
          pairId: 'p0',
          side: 'source',
          surface: 'streamline',
          lemma: 'streamline',
          meaning: '精简',
          targetText: '优化',
          note: ''
        },
        {
          pairId: 'p0',
          side: 'source',
          surface: 'streamline',
          lemma: 'streamline',
          meaning: '精简',
          targetText: '精简',
          note: ''
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'ENGLISH',
      targetLanguage: 'CHINESE (SIM)'
    }
  )

  assert.ok(alignment)
  assert.deepEqual(
    alignment.highlights.map((highlight) => highlight.surface),
    ['streamline']
  )
})

test('重叠高亮与基础虚词会被过滤', () => {
  const sourceText = 'Please streamline the review process.'
  const targetText = '请精简审阅流程。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: [
        {
          pairId: 'p0',
          side: 'source',
          surface: 'review process',
          lemma: 'review process',
          meaning: '审阅流程',
          targetText: '审阅流程',
          note: ''
        },
        {
          pairId: 'p0',
          side: 'source',
          surface: 'review',
          lemma: 'review',
          meaning: '审阅',
          targetText: '审阅',
          note: ''
        },
        {
          pairId: 'p0',
          side: 'source',
          surface: 'the',
          lemma: 'the',
          meaning: '定冠词',
          targetText: '',
          note: ''
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'ENGLISH',
      targetLanguage: 'CHINESE (SIM)'
    }
  )

  assert.ok(alignment)
  assert.deepEqual(
    alignment.highlights.map((highlight) => highlight.surface),
    ['review process']
  )
})

test('学习高亮会按翻译方向限制最大数量', () => {
  const sourceText = 'Streamline and accelerate the review process.'
  const targetText = '请精简并加快审阅流程。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')

  const sourceAlignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: ['Streamline', 'accelerate', 'review', 'process'].map((surface) => ({
        pairId: 'p0',
        side: 'source',
        surface,
        lemma: surface.toLowerCase(),
        meaning: '语境释义',
        targetText: '',
        note: ''
      }))
    }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'ENGLISH',
      targetLanguage: 'CHINESE (SIM)'
    }
  )

  assert.ok(sourceAlignment)
  assert.equal(sourceAlignment.highlights.length, 3)

  const targetSourceText = '请精简并加快审阅流程。'
  const targetTextEnglish = 'Streamline and accelerate the review process.'
  const targetSourceSegments = segmentText(targetSourceText, 'CHINESE (SIM)', 's')
  const englishTargetSegments = segmentText(targetTextEnglish, 'ENGLISH', 't')
  const targetAlignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: ['Streamline', 'accelerate', 'review'].map((surface) => ({
        pairId: 'p0',
        side: 'target',
        surface,
        lemma: surface.toLowerCase(),
        meaning: '语境释义',
        targetText: '',
        note: '这个表达比基础词更贴合当前语境。'
      }))
    }),
    targetSourceSegments,
    englishTargetSegments,
    {
      sourceText: targetSourceText,
      targetText: targetTextEnglish,
      sourceLanguage: 'CHINESE (SIM)',
      targetLanguage: 'ENGLISH'
    }
  )

  assert.ok(targetAlignment)
  assert.equal(targetAlignment.highlights.length, 2)
})

test('中译英高亮缺少中文地道说明时只丢弃该项', () => {
  const sourceText = '请精简审阅流程。'
  const targetText = 'Please streamline the review process.'
  const sourceSegments = segmentText(sourceText, 'CHINESE (SIM)', 's')
  const targetSegments = segmentText(targetText, 'ENGLISH', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({
      pairs: [{ source: ['s0'], target: ['t0'] }],
      highlights: [
        {
          pairId: 'p0',
          side: 'target',
          surface: 'streamline',
          lemma: 'streamline',
          meaning: '精简',
          targetText: '精简',
          note: ''
        }
      ]
    }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'CHINESE (SIM)',
      targetLanguage: 'ENGLISH'
    }
  )

  assert.ok(alignment)
  assert.deepEqual(alignment.highlights, [])
})

test('旧格式或缺少 highlights 字段时仍保留句级对齐', () => {
  const sourceText = 'Hello.'
  const targetText = '你好。'
  const sourceSegments = segmentText(sourceText, 'ENGLISH', 's')
  const targetSegments = segmentText(targetText, 'CHINESE (SIM)', 't')

  const alignment = parseAlignmentPairs(
    JSON.stringify({ pairs: [{ source: ['s0'], target: ['t0'] }] }),
    sourceSegments,
    targetSegments,
    {
      sourceText,
      targetText,
      sourceLanguage: 'ENGLISH',
      targetLanguage: 'CHINESE (SIM)'
    }
  )

  assert.ok(alignment)
  assert.deepEqual(alignment.highlights, [])
})
