import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSentenceSyntaxCardModel,
  buildSentenceSyntaxSystemPrompt,
  buildSentenceSyntaxUserMessage,
  parseSentenceSyntaxAnalysis,
  splitSentenceSyntaxText
} from '../sentenceSyntax.ts'

const createValidResult = (): Record<string, unknown> => ({
  coreSpine: 'The legacy API has been deprecated',
  segments: [
    {
      text: 'The legacy API',
      isCore: true,
      role: '主语',
      type: 'subject'
    },
    {
      text: ' has been deprecated',
      isCore: true,
      role: '谓语',
      type: 'predicate'
    },
    {
      text: ' in the latest release.',
      isCore: false,
      role: '状语 (范围)',
      type: 'modifier'
    }
  ],
  note: '被动语态突出结果，介词短语限定范围'
})

test('主干拆解会逐字符校验连续切片并保留原始空格', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'
  const analysis = parseSentenceSyntaxAnalysis(JSON.stringify(createValidResult()), sentence)

  assert.ok(analysis)
  assert.equal(analysis.segments.map((segment) => segment.text).join(''), sentence)
  assert.equal(analysis.segments[1].type, 'predicate')
  assert.equal(analysis.segments[2].isCore, false)
  assert.equal(analysis.coreSpine, 'The legacy API has been deprecated')
})

test('代码围栏和前后说明不会阻止严格 JSON 解析', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'
  const raw = `分析如下：\n\`\`\`json\n${JSON.stringify(createValidResult())}\n\`\`\``

  assert.ok(parseSentenceSyntaxAnalysis(raw, sentence))
})

test('切片缺少空格或重复标点时拒绝分析结果', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'
  const missingSpace = createValidResult()
  missingSpace.segments = [
    {
      text: 'The legacy API',
      isCore: true,
      role: '主语',
      type: 'subject'
    },
    {
      text: 'has been deprecated',
      isCore: true,
      role: '谓语',
      type: 'predicate'
    },
    {
      text: ' in the latest release.',
      isCore: false,
      role: '状语 (范围)',
      type: 'modifier'
    }
  ]

  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(missingSpace), sentence), null)
})

test('非法成分类型、核心修饰冲突和超长点拨都会被拒绝', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'

  const invalidType = createValidResult()
  invalidType.segments = [
    {
      text: sentence,
      isCore: true,
      role: '主干',
      type: 'adverbial-clause'
    }
  ]
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(invalidType), sentence), null)

  const coreModifierConflict = createValidResult()
  coreModifierConflict.segments = [
    {
      text: sentence,
      isCore: true,
      role: '主干',
      type: 'modifier'
    }
  ]
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(coreModifierConflict), sentence), null)

  const longNote = {
    ...createValidResult(),
    note: '这是一条明显超过三十五个字符限制的中文语法点拨内容用于验证解析器会拒绝不可靠结果'
  }
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(longNote), sentence), null)

  const nonChineseNote = {
    ...createValidResult(),
    note: 'This note is not Simplified Chinese.'
  }
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(nonChineseNote), sentence), null)
})

test('Prompt 明确要求连续切片、温度约束由服务层设置且点拨不超过 35 字', () => {
  const prompt = buildSentenceSyntaxSystemPrompt()
  const message = JSON.parse(
    buildSentenceSyntaxUserMessage({
      sentence: '  The API has been deprecated.  ',
      targetTranslation: ' 该 API 已被弃用。 '
    })
  )

  assert.match(prompt, /exactly equal the original sentence/)
  assert.match(prompt, /no more than 35 characters/)
  assert.equal(message.sentence, 'The API has been deprecated.')
  assert.equal(message.targetTranslation, '该 API 已被弃用。')
})

test('原文透视切片会把标点与空白拆成中立片段且不改变字符顺序', () => {
  const text = 'a searchable list opens: “read-only” mode.'
  const runs = splitSentenceSyntaxText(text)

  assert.equal(runs.map((run) => run.text).join(''), text)
  assert.deepEqual(
    runs.filter((run) => run.isNeutral).map((run) => run.text),
    [' ', ' ', ' ', ': “', '-', '” ', '.']
  )
  assert.equal(
    runs
      .filter((run) => !run.isNeutral)
      .map((run) => run.text)
      .join('|'),
    'a|searchable|list|opens|read|only|mode'
  )
})

test('结构卡会生成带主谓标注的核心骨架与条件前提', () => {
  const model = buildSentenceSyntaxCardModel({
    coreSpine: 'a searchable list opens',
    segments: [
      {
        text: 'Click a value and ',
        isCore: false,
        role: '祈使表假设',
        type: 'modifier'
      },
      {
        text: 'a searchable list',
        isCore: true,
        role: '主语',
        type: 'subject'
      },
      {
        text: ' opens:',
        isCore: true,
        role: '谓语',
        type: 'predicate'
      }
    ],
    note: '冒号后是解释列表内容的同位语'
  })

  assert.deepEqual(model, {
    core: 'a searchable list（主） opens（谓）',
    modifierLabel: '前提',
    modifier: 'Click a value and（祈使表假设）',
    note: '冒号后是解释列表内容的同位语'
  })
})

test('结构卡没有非核心成分时不生成空的修饰行', () => {
  const model = buildSentenceSyntaxCardModel({
    coreSpine: 'The API works',
    segments: [
      {
        text: 'The API works.',
        isCore: true,
        role: '主干',
        type: 'subject'
      }
    ],
    note: '简单主谓结构'
  })

  assert.deepEqual(model, {
    core: 'The API works',
    note: '简单主谓结构'
  })
})
