import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSentenceSyntaxSystemPrompt,
  buildSentenceSyntaxUserMessage,
  parseSentenceSyntaxAnalysis,
  splitSentenceSyntaxText
} from '../sentenceSyntax.ts'

const createValidResult = (): Record<string, unknown> => ({
  segments: [
    {
      text: 'The legacy API',
      role: 'subject',
      isCore: true,
      plainTip: '动作的发出者'
    },
    {
      text: ' has been deprecated',
      role: 'predicate',
      isCore: true,
      plainTip: '核心变化'
    },
    {
      text: ' in the latest release',
      role: 'modifier',
      isCore: false,
      plainTip: '发生范围'
    },
    {
      text: '.',
      role: 'other',
      isCore: false
    }
  ]
})

test('语法透视会保留角色并逐字符校验连续切片', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'
  const analysis = parseSentenceSyntaxAnalysis(JSON.stringify(createValidResult()), sentence)

  assert.ok(analysis)
  assert.equal(analysis.segments.map((segment) => segment.text).join(''), sentence)
  assert.deepEqual(
    analysis.segments.map((segment) => segment.role),
    ['subject', 'predicate', 'modifier', 'other']
  )
  assert.equal(analysis.segments[0].plainTip, '动作的发出者')
  assert.equal(analysis.segments[3].plainTip, undefined)
})

test('代码围栏和前后说明不会阻止严格 JSON 解析', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'
  const raw = `分析如下：\n\`\`\`json\n${JSON.stringify(createValidResult())}\n\`\`\``

  assert.ok(parseSentenceSyntaxAnalysis(raw, sentence))
})

test('切片缺少空格、角色非法或遗漏核心内容时拒绝结果', () => {
  const sentence = 'The legacy API has been deprecated in the latest release.'
  const missingSpace = createValidResult()
  missingSpace.segments = [
    {
      text: 'The legacy API',
      role: 'subject',
      isCore: true,
      plainTip: '动作的发出者'
    },
    {
      text: 'has been deprecated',
      role: 'predicate',
      isCore: true,
      plainTip: '核心变化'
    },
    {
      text: ' in the latest release.',
      role: 'modifier',
      isCore: false,
      plainTip: '发生范围'
    }
  ]
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(missingSpace), sentence), null)

  const invalidRole = createValidResult()
  invalidRole.segments = [
    {
      text: sentence,
      role: 'verb-phrase',
      isCore: true,
      plainTip: '核心动作'
    }
  ]
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(invalidRole), sentence), null)

  const noCore = createValidResult()
  noCore.segments = [
    {
      text: sentence,
      role: 'modifier',
      isCore: true,
      plainTip: '补充说明'
    }
  ]
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(noCore), sentence), null)
})

test('语义提示缺失或含应试术语时按角色回退为白话说明', () => {
  const sentence = 'An open exercise illustration library, including icons and examples.'
  const raw = JSON.stringify({
    segments: [
      {
        text: 'An open exercise illustration library',
        role: 'subject',
        isCore: true,
        plainTip: '主语'
      },
      {
        text: ',',
        role: 'other',
        isCore: false
      },
      {
        text: ' including icons and examples',
        role: 'modifier',
        isCore: false
      },
      {
        text: '.',
        role: 'other',
        isCore: false
      }
    ]
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, sentence)

  assert.ok(analysis)
  assert.equal(analysis.segments[0].plainTip, '描述的主体')
  assert.equal(analysis.segments[2].plainTip, '补充说明')
})

test('modifier 与 other 即使被标成核心也会被强制降为非核心', () => {
  const sentence = 'The API works in production.'
  const raw = JSON.stringify({
    segments: [
      {
        text: 'The API',
        role: 'subject',
        isCore: true,
        plainTip: '描述的主体'
      },
      {
        text: ' works',
        role: 'predicate',
        isCore: true,
        plainTip: '核心动作'
      },
      {
        text: ' in production',
        role: 'modifier',
        isCore: true,
        plainTip: '发生场景'
      },
      {
        text: '.',
        role: 'other',
        isCore: true
      }
    ]
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, sentence)

  assert.ok(analysis)
  assert.equal(analysis.segments[2].isCore, false)
  assert.equal(analysis.segments[3].isCore, false)
})

test('object 角色可用于动作对象或表语', () => {
  const sentence = 'The API returns JSON.'
  const raw = JSON.stringify({
    segments: [
      {
        text: 'The API',
        role: 'subject',
        isCore: true,
        plainTip: '动作的发出者'
      },
      {
        text: ' returns',
        role: 'predicate',
        isCore: true,
        plainTip: '核心动作'
      },
      {
        text: ' JSON',
        role: 'object',
        isCore: true,
        plainTip: '动作对象'
      },
      {
        text: '.',
        role: 'other',
        isCore: false
      }
    ]
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, sentence)

  assert.ok(analysis)
  assert.equal(analysis.segments[2].role, 'object')
  assert.equal(analysis.segments[2].plainTip, '动作对象')
})

test('Prompt 明确定义五种角色并要求标点独立返回', () => {
  const prompt = buildSentenceSyntaxSystemPrompt()
  const message = JSON.parse(
    buildSentenceSyntaxUserMessage({
      sentence: '  An open exercise illustration library  ',
      targetTranslation: ' 一个开放的练习插图库 '
    })
  )

  assert.match(prompt, /role must be one of: subject, predicate, object, modifier, other/)
  assert.match(prompt, /Punctuation must be returned as separate other segments/)
  assert.match(prompt, /noun phrase/)
  assert.match(prompt, /text, role, isCore, and plainTip/)
  assert.doesNotMatch(prompt, /"coreSpine"\s*:/)
  assert.doesNotMatch(prompt, /"note"\s*:/)
  assert.equal(message.sentence, 'An open exercise illustration library')
  assert.equal(message.targetTranslation, '一个开放的练习插图库')
})

test('透视切片只剥离标点，并保留完整语义块与空格', () => {
  const text = 'a searchable list opens: "read-only" mode.'
  const runs = splitSentenceSyntaxText(text)

  assert.equal(runs.map((run) => run.text).join(''), text)
  assert.deepEqual(
    runs.filter((run) => run.kind === 'text').map((run) => run.text),
    ['a searchable list opens', ' ', 'read-only', ' mode']
  )
  assert.deepEqual(
    runs.filter((run) => run.kind === 'punctuation').map((run) => run.text),
    [':', '"', '"', '.']
  )
})

test('多词语义切片不会被空格拆成多个胶囊片段', () => {
  const runs = splitSentenceSyntaxText('The legacy API')

  assert.deepEqual(runs, [{ text: 'The legacy API', kind: 'text' }])
})
