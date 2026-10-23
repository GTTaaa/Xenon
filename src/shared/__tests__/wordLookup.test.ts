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
    '```json\n{"kind":"lexical","lemma":"matter","literalMeaning":"要紧、有关系","meaning":"此处指真正重要","contextNote":"与 only 搭配时强调唯一重要的事项","wordOrderNote":"matter 在句中作谓语，放在主语之后；若提前通常需要调整句式。","targetText":"真正重要","confidence":"high"}\n```',
    '只修改配置中真正重要的那一个密钥。'
  )

  assert.deepEqual(result, {
    kind: 'lexical',
    lemma: 'matter',
    literalMeaning: '要紧、有关系',
    meaning: '此处指真正重要',
    contextNote: '与 only 搭配时强调唯一重要的事项',
    wordOrderNote: 'matter 在句中作谓语，放在主语之后；若提前通常需要调整句式。',
    targetText: '真正重要'
  })
})

test('译文对应不是目标句子的连续片段时拒绝结果', () => {
  const result = parseWordLookupResult(
    '{"kind":"lexical","lemma":"matter","literalMeaning":"要紧、有关系","meaning":"此处指真正重要","targetText":"并不存在","confidence":"high"}',
    '只修改配置中真正重要的那一个密钥。'
  )

  assert.equal(result, null)
})

test('低置信度、非中文释义或非法原形都会被拒绝', () => {
  assert.equal(
    parseWordLookupResult(
      '{"kind":"lexical","lemma":"matter","literalMeaning":"要紧、有关系","meaning":"此处指真正重要","targetText":"真正重要","confidence":"medium"}',
      '真正重要'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      '{"kind":"lexical","lemma":"matter","literalMeaning":"要紧、有关系","meaning":"really important","targetText":"重要","confidence":"high"}',
      '真正重要'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      '{"kind":"lexical","lemma":"123","literalMeaning":"要紧、有关系","meaning":"此处指重要","targetText":"重要","confidence":"high"}',
      '真正重要'
    ),
    null
  )
})

test('缺少字面义或判断依据不是中文时拒绝结果', () => {
  assert.equal(
    parseWordLookupResult(
      '{"kind":"lexical","lemma":"matter","meaning":"此处指真正重要","targetText":"真正重要","confidence":"high"}',
      '真正重要'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      '{"kind":"lexical","lemma":"matter","literalMeaning":"to be important","meaning":"此处指真正重要","targetText":"真正重要","confidence":"high"}',
      '真正重要'
    ),
    null
  )
})

test('语序说明必须是简体中文且长度受限', () => {
  const base = {
    kind: 'lexical',
    lemma: 'today',
    literalMeaning: '今天',
    meaning: '本句指今天',
    targetText: '',
    confidence: 'high'
  }

  assert.equal(
    parseWordLookupResult(
      JSON.stringify({
        ...base,
        wordOrderNote: 'today is placed at the end.'
      }),
      '我今天没吃饭。'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      JSON.stringify({
        ...base,
        wordOrderNote: '这'.repeat(161)
      }),
      '我今天没吃饭。'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      JSON.stringify({
        ...base,
        wordOrderNote: 'today 是时间状语，英语通常放在句末；移到句首常用于强调或对比。'
      }),
      '我今天没吃饭。'
    )?.wordOrderNote,
    'today 是时间状语，英语通常放在句末；移到句首常用于强调或对比。'
  )
})

test('助动词缩写按语法词解析，不把实义动词的字面义套到助动词上', () => {
  const result = parseWordLookupResult(
    '{"kind":"grammar","lemma":"did not","literalMeaning":"做","meaning":"用于一般过去时的否定，本身不表示“做”","contextNote":"didn\'t = did not；后面的 eat 才是实义动词","targetText":"","confidence":"high"}',
    '我今天没有吃饭。'
  )

  assert.deepEqual(result, {
    kind: 'grammar',
    lemma: 'did not',
    meaning: '用于一般过去时的否定，本身不表示“做”',
    contextNote: "didn't = did not；后面的 eat 才是实义动词",
    targetText: ''
  })
})

test('语法词允许字面义为空，但缺少类型或使用未知类型时拒绝结果', () => {
  const grammarResult = parseWordLookupResult(
    '{"kind":"grammar","lemma":"did not","literalMeaning":"","meaning":"构成一般过去时否定","contextNote":"didn\'t = did not，缩写后用于否定","targetText":"","confidence":"high"}',
    '我今天没有吃饭。'
  )
  assert.equal(grammarResult?.kind, 'grammar')
  assert.equal(grammarResult?.literalMeaning, undefined)

  assert.equal(
    parseWordLookupResult(
      '{"lemma":"did not","meaning":"构成一般过去时否定","targetText":"","confidence":"high"}',
      '我今天没有吃饭。'
    ),
    null
  )
  assert.equal(
    parseWordLookupResult(
      '{"kind":"unknown","lemma":"did not","meaning":"构成一般过去时否定","targetText":"","confidence":"high"}',
      '我今天没有吃饭。'
    ),
    null
  )
})
