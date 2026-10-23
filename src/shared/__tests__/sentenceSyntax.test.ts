import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSentenceSyntaxSystemPrompt,
  buildSentenceSyntaxUserMessage,
  parseSentenceSyntaxAnalysis,
  shouldShowSyntaxCoreSummary,
  splitSentenceSyntaxText
} from '../sentenceSyntax.ts'

const createValidResult = (): Record<string, unknown> => ({
  coreSummary: '认证令牌会自动失效',
  segments: [
    {
      text: 'The authentication tokens',
      role: 'subject',
      isCore: true,
      plainTip: '描述的主体'
    },
    {
      text: ' are automatically invalidated',
      role: 'predicate',
      isCore: true,
      plainTip: '核心变化'
    },
    {
      text: ' upon password reset.',
      role: 'modifier',
      isCore: false,
      plainTip: '触发的条件'
    }
  ]
})

const sentence = 'The authentication tokens are automatically invalidated upon password reset.'

test('解析核心提示、连续切片并在客户端二次拆分标点', () => {
  const analysis = parseSentenceSyntaxAnalysis(JSON.stringify(createValidResult()), sentence)

  assert.ok(analysis)
  assert.equal(analysis.coreSummary, '认证令牌会自动失效')
  assert.deepEqual(
    analysis.segments.map((segment) => ({
      text: segment.text,
      role: segment.role,
      isCore: segment.isCore
    })),
    [
      {
        text: 'The authentication tokens',
        role: 'subject',
        isCore: true
      },
      {
        text: ' are automatically invalidated',
        role: 'predicate',
        isCore: true
      },
      {
        text: ' upon password reset',
        role: 'modifier',
        isCore: false
      },
      {
        text: '.',
        role: 'punctuation',
        isCore: false
      }
    ]
  )
  assert.equal(analysis.segments.map((segment) => segment.text).join(''), sentence)
})

test('代码围栏和前后说明不会阻止严格 JSON 解析', () => {
  const raw = `分析如下：\n\`\`\`json\n${JSON.stringify(createValidResult())}\n\`\`\``

  assert.ok(parseSentenceSyntaxAnalysis(raw, sentence))
})

test('模型把标点塞进核心片段时仍会剥成中立标点', () => {
  const raw = JSON.stringify({
    coreSummary: '接口已弃用',
    segments: [
      {
        text: 'The legacy API,',
        role: 'subject',
        isCore: true,
        plainTip: '描述的主体'
      },
      {
        text: ' has been deprecated.',
        role: 'predicate',
        isCore: true,
        plainTip: '核心变化'
      }
    ]
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, 'The legacy API, has been deprecated.')

  assert.ok(analysis)
  const punctuationSegments = analysis.segments.filter((segment) => segment.role === 'punctuation')
  assert.deepEqual(
    punctuationSegments.map((segment) => segment.text),
    [',', '.']
  )
  assert.ok(punctuationSegments.every((segment) => !segment.isCore))
})

test('模型给无标点原文补句号时会裁掉多余终句标点', () => {
  const source = "I didn't eat today"
  const raw = JSON.stringify({
    coreSummary: '我今天没吃饭',
    segments: [
      {
        text: 'I',
        role: 'subject',
        isCore: true,
        plainTip: '动作主体'
      },
      {
        text: " didn't",
        role: 'predicate',
        isCore: true,
        plainTip: '表示没有做'
      },
      {
        text: ' eat',
        role: 'predicate',
        isCore: true,
        plainTip: '核心动作'
      },
      {
        text: ' today',
        role: 'modifier',
        isCore: false,
        plainTip: '发生时间'
      },
      {
        text: '.',
        role: 'punctuation',
        isCore: false
      }
    ],
    insights: []
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, source)

  assert.ok(analysis)
  assert.equal(analysis.segments.map((segment) => segment.text).join(''), source)
  assert.equal(analysis.segments.at(-1)?.text, ' today')
})

test('修饰成分即使被模型标成核心也会强制降为非核心', () => {
  const raw = JSON.stringify({
    coreSummary: '接口正常',
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
        text: ' in production.',
        role: 'modifier',
        isCore: true,
        plainTip: '发生场景'
      }
    ]
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, 'The API works in production.')

  assert.ok(analysis)
  assert.equal(analysis.segments.at(-2)?.role, 'modifier')
  assert.equal(analysis.segments.at(-2)?.isCore, false)
  assert.equal(analysis.segments.at(-1)?.role, 'punctuation')
  assert.equal(analysis.segments.at(-1)?.isCore, false)
})

test('修饰成分缺少提示时按 into 兜底，句末句号保持独立', () => {
  const source = 'The script copied the files into the repository.'
  const analysis = parseSentenceSyntaxAnalysis(
    JSON.stringify({
      coreSummary: '脚本把文件复制进仓库',
      segments: [
        {
          text: 'The script',
          role: 'subject',
          isCore: true,
          plainTip: '描述的主体'
        },
        {
          text: ' copied',
          role: 'predicate',
          isCore: true,
          plainTip: '核心动作'
        },
        {
          text: ' the files',
          role: 'object',
          isCore: true,
          plainTip: '动作对象'
        },
        {
          text: ' into the repository.',
          role: 'modifier',
          isCore: false,
          plainTip: ''
        }
      ]
    }),
    source
  )

  assert.ok(analysis)
  const modifier = analysis.segments.find((segment) => segment.role === 'modifier')
  const punctuation = analysis.segments.at(-1)
  assert.equal(modifier?.text, ' into the repository')
  assert.equal(modifier?.plainTip, '补充说明：去向 / 目标地点')
  assert.equal(punctuation?.text, '.')
  assert.equal(punctuation?.role, 'punctuation')
  assert.equal(analysis.segments.map((segment) => segment.text).join(''), source)
})

test('纯名词短语与祈使句不会被强行套成完整主谓宾', () => {
  const nounPhrase = 'An open exercise illustration library, including icons and examples.'
  const nounAnalysis = parseSentenceSyntaxAnalysis(
    JSON.stringify({
      coreSummary: '一个开放的练习插图库',
      segments: [
        {
          text: 'An open exercise illustration library',
          role: 'subject',
          isCore: true,
          plainTip: '核心对象'
        },
        {
          text: ',',
          role: 'punctuation',
          isCore: false
        },
        {
          text: ' including icons and examples.',
          role: 'modifier',
          isCore: false,
          plainTip: '列举库中的内容'
        }
      ]
    }),
    nounPhrase
  )

  const imperative = 'Click a value to open the list.'
  const imperativeAnalysis = parseSentenceSyntaxAnalysis(
    JSON.stringify({
      coreSummary: '点击值以打开列表',
      segments: [
        {
          text: 'Click',
          role: 'predicate',
          isCore: true,
          plainTip: '核心动作'
        },
        {
          text: ' a value',
          role: 'object',
          isCore: true,
          plainTip: '动作对象'
        },
        {
          text: ' to open the list.',
          role: 'modifier',
          isCore: false,
          plainTip: '点击后的结果'
        }
      ]
    }),
    imperative
  )

  assert.ok(nounAnalysis)
  assert.equal(nounAnalysis.segments[0].role, 'subject')
  assert.equal(nounAnalysis.segments[0].isCore, true)
  assert.ok(imperativeAnalysis)
  assert.equal(imperativeAnalysis.segments[0].role, 'predicate')
  assert.equal(imperativeAnalysis.segments[1].role, 'object')
})

test('改写原文、非法角色或没有核心成分时拒绝结果', () => {
  const rewritten = createValidResult()
  rewritten.segments = [
    {
      text: 'All login credentials are invalidated.',
      role: 'subject',
      isCore: true,
      plainTip: '描述的主体'
    }
  ]
  assert.equal(parseSentenceSyntaxAnalysis(JSON.stringify(rewritten), sentence), null)

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

test('应试黑话会回退成白话，核心提示限制为单行短句', () => {
  const raw = JSON.stringify({
    coreSummary: '这是现在分词短语作后置定语',
    segments: [
      {
        text: 'The API',
        role: 'subject',
        isCore: true,
        plainTip: '主语'
      },
      {
        text: ' works',
        role: 'predicate',
        isCore: true,
        plainTip: '谓语'
      },
      {
        text: ' in production.',
        role: 'modifier',
        isCore: false,
        plainTip: '时间状语从句'
      }
    ]
  })
  const analysis = parseSentenceSyntaxAnalysis(raw, 'The API works in production.')

  assert.ok(analysis)
  assert.equal(analysis.coreSummary, '先看高亮部分')
  assert.equal(analysis.segments[0].plainTip, '描述的主体')
  assert.equal(analysis.segments[1].plainTip, '核心动作或状态')
  assert.equal(analysis.segments[2].plainTip, '补充说明：地点或范围')
})

test('切片只剥离标点，并保留多词语义块与空格', () => {
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
  assert.deepEqual(splitSentenceSyntaxText('The legacy API'), [
    { text: 'The legacy API', kind: 'text' }
  ])
})

test('文件名、版本号和内联代码中的点号不会被当成句读', () => {
  const text = 'Use `AGENTS.md` / `CLAUDE.md`, read example.com, then try v1.2.0.'
  const runs = splitSentenceSyntaxText(text)

  assert.equal(runs.map((run) => run.text).join(''), text)
  assert.deepEqual(
    runs.filter((run) => run.kind === 'punctuation').map((run) => run.text),
    [',', ',', '.']
  )
  const textRuns = runs
    .filter((run) => run.kind === 'text')
    .map((run) => run.text)
    .join('')
  assert.ok(textRuns.includes('`AGENTS.md` / `CLAUDE.md`'))
  assert.ok(textRuns.includes('example.com'))
  assert.ok(textRuns.includes('v1.2.0'))
})

test('模型误拆技术词点号时会重新粘回完整文件名', () => {
  const source = 'Open `AGENTS.md` now.'
  const analysis = parseSentenceSyntaxAnalysis(
    JSON.stringify({
      coreSummary: '现在打开说明文件',
      segments: [
        {
          text: 'Open',
          role: 'predicate',
          isCore: true,
          plainTip: '核心动作'
        },
        {
          text: ' `AGENTS',
          role: 'object',
          isCore: true,
          plainTip: '动作对象'
        },
        {
          text: '.',
          role: 'punctuation',
          isCore: false
        },
        {
          text: 'md` now.',
          role: 'object',
          isCore: true,
          plainTip: '动作对象'
        }
      ]
    }),
    source
  )

  assert.ok(analysis)
  assert.deepEqual(
    analysis.segments.map((segment) => ({
      text: segment.text,
      role: segment.role
    })),
    [
      { text: 'Open', role: 'predicate' },
      { text: ' `AGENTS.md` now', role: 'object' },
      { text: '.', role: 'punctuation' }
    ]
  )
  assert.equal(analysis.segments.map((segment) => segment.text).join(''), source)
})

test('解析语法选择说明，并把锚点限制在没有歧义的原文切片内', () => {
  const source = "I didn't eat today."
  const analysis = parseSentenceSyntaxAnalysis(
    JSON.stringify({
      coreSummary: '今天没有吃饭',
      segments: [
        {
          text: 'I',
          role: 'subject',
          isCore: true,
          plainTip: '描述的主体'
        },
        {
          text: " didn't eat",
          role: 'predicate',
          isCore: true,
          plainTip: '今天这顿饭没有吃'
        },
        {
          text: ' today',
          role: 'modifier',
          isCore: false,
          plainTip: '发生时间'
        },
        {
          text: '.',
          role: 'punctuation',
          isCore: false
        }
      ],
      insights: [
        {
          anchorText: "didn't",
          title: "为什么不是 don't",
          reason: '这里说的是今天这顿饭已经结束，所以用 did not；后面的 eat 保持原形。',
          contrast: "don't 更像平时习惯；haven't eaten 表示到现在还没吃。"
        }
      ]
    }),
    source
  )

  assert.ok(analysis)
  assert.deepEqual(analysis.insights, [
    {
      anchorText: "didn't",
      title: "为什么不是 don't",
      reason: '这里说的是今天这顿饭已经结束，所以用 did not；后面的 eat 保持原形。',
      contrast: "don't 更像平时习惯；haven't eaten 表示到现在还没吃。"
    }
  ])
})

test('无效说明会被丢弃，但不会拖垮整句结构', () => {
  const createResult = (anchorText: string): Record<string, unknown> => ({
    coreSummary: '今天没有吃饭',
    segments: [
      {
        text: 'I',
        role: 'subject',
        isCore: true,
        plainTip: '描述的主体'
      },
      {
        text: " didn't eat",
        role: 'predicate',
        isCore: true,
        plainTip: '今天这顿饭没有吃'
      },
      {
        text: ' today.',
        role: 'modifier',
        isCore: false,
        plainTip: '发生时间'
      }
    ],
    insights: [
      {
        anchorText,
        title: "为什么不是 don't",
        reason: '这里说的是已经过去的一次动作。'
      }
    ]
  })

  const invalidCases: Array<[Record<string, unknown>, string]> = [
    [createResult('did not'), "I didn't eat today."],
    [createResult("I didn't"), "I didn't eat today."],
    [
      {
        coreSummary: '今天两样都没有碰',
        segments: [
          {
            text: 'I',
            role: 'subject',
            isCore: true,
            plainTip: '描述的主体'
          },
          {
            text: " didn't eat.",
            role: 'predicate',
            isCore: true,
            plainTip: '今天没有吃'
          },
          {
            text: ' I',
            role: 'subject',
            isCore: true,
            plainTip: '描述的主体'
          },
          {
            text: " didn't drink.",
            role: 'predicate',
            isCore: true,
            plainTip: '今天没有喝'
          }
        ],
        insights: [
          {
            anchorText: "didn't",
            title: "为什么不是 don't",
            reason: '两个动作都已经结束。'
          }
        ]
      },
      "I didn't eat. I didn't drink."
    ]
  ]

  for (const [result, source] of invalidCases) {
    const analysis = parseSentenceSyntaxAnalysis(JSON.stringify(result), source)

    assert.ok(analysis)
    assert.deepEqual(analysis.insights, [])
  }
})

test('Prompt 要求连续切片、标点独立与白话提示', () => {
  const prompt = buildSentenceSyntaxSystemPrompt()
  const message = JSON.parse(
    buildSentenceSyntaxUserMessage({
      sentence: '  The authentication tokens are invalidated.  ',
      targetTranslation: ' 认证令牌会失效。 '
    })
  )

  assert.match(prompt, /"coreSummary":"认证令牌会自动失效"/)
  assert.match(prompt, /"segments":\[\{/)
  assert.match(prompt, /punctuation, other/)
  assert.match(prompt, /noun phrase/)
  assert.match(prompt, /head noun and the complements/)
  assert.match(prompt, /imperative/)
  assert.match(prompt, /technical token/)
  assert.match(prompt, /Concatenating every segment\.text/)
  assert.match(prompt, /grammar-school labels or jargon/)
  assert.match(prompt, /"insights":\[\]/)
  assert.match(prompt, /anchorText/)
  assert.match(prompt, /0 to 2 items/)
  assert.equal(message.sentence, 'The authentication tokens are invalidated.')
  assert.equal(message.targetTranslation, '认证令牌会失效。')
})

test('简单短句不会重复展示核心骨干', () => {
  const analysis = parseSentenceSyntaxAnalysis(JSON.stringify(createValidResult()), sentence)

  assert.ok(analysis)
  assert.equal(shouldShowSyntaxCoreSummary(analysis), false)
})

test('长修饰从句保留核心骨干提示', () => {
  const complexSentence =
    'The legacy API has been deprecated when the background worker receives another request.'
  const analysis = parseSentenceSyntaxAnalysis(
    JSON.stringify({
      coreSummary: '旧接口在后台收到请求时失效',
      segments: [
        {
          text: 'The legacy API',
          role: 'subject',
          isCore: true,
          plainTip: '描述的主体'
        },
        {
          text: ' has been deprecated',
          role: 'predicate',
          isCore: true,
          plainTip: '核心变化'
        },
        {
          text: ' when the background worker receives another request.',
          role: 'modifier',
          isCore: false,
          plainTip: '触发的条件'
        }
      ]
    }),
    complexSentence
  )

  assert.ok(analysis)
  assert.equal(shouldShowSyntaxCoreSummary(analysis), true)
})
