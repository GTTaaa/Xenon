/** 一组真实中英文文本及预期分句和对齐结果 */
export interface AlignmentRegressionCase {
  /** 样例名称，失败时用于定位场景 */
  name: string
  /** 英文原文 */
  sourceText: string
  /** 已确认的中文译文 */
  targetText: string
  /** 按当前分句规则应得到的英文片段 */
  expectedSourceSegments: string[]
  /** 按当前分句规则应得到的中文片段 */
  expectedTargetSegments: string[]
  /** 预期的一对一句段配对 */
  expectedPairs: Array<{
    /** 英文片段编号 */
    sourceIds: string[]
    /** 中文片段编号 */
    targetIds: string[]
  }>
}

export const alignmentRegressionCases: AlignmentRegressionCase[] = [
  {
    name: '小写品牌名与 Markdown 列表保持逐句对应',
    sourceText: `Each agent keeps its model in its own file, in its own format, with its own keys and base URLs. A subscription you pay for works in one agent and nowhere else. magpie puts all of that behind one app and one local gateway:

- **Pick any model for any agent** from one list. magpie edits the one key that matters in the agent's own config.
- **Use one provider everywhere**: an API key, a local model, or the Claude, ChatGPT, Copilot, Gemini or Grok plan you're signed in to.
- **Keep going when a quota runs out**: a routing group moves to the next account or model, and the agent never sees the error.

It's for you if you use more than one agent, more than one provider, or more than one account. If you use one agent on its vendor's own plan and that's enough, you don't need it.

Runs on macOS, Windows and Linux (menu bar app, window, TUI, web UI and CLI), in Docker, and on Termux.`,
    targetText: `每个智能体都把它的模型保存在自己的文件中，使用自己的格式，并带有自己的密钥和基础 URL。你付费的订阅只在一个智能体中有效，在其他任何地方都不行。magpie 把这一切都放在一个应用和一个本地网关之后：

- **为任何智能体选择任何模型**，从一个列表中选择。magpie 会编辑智能体自身配置中唯一重要的那个密钥。
- **在任何地方使用同一个提供商**：一个 API 密钥、一个本地模型，或者你已登录的 Claude、ChatGPT、Copilot、Gemini 或 Grok 套餐。
- **配额用完时继续运行**：路由组会切换到下一个账户或模型，而智能体永远不会看到该错误。

如果你使用不止一个智能体、不止一个提供商或不止一个账户，那么它适合你。如果你只在一个智能体上使用其供应商自己的套餐，并且这就够了，那你不需要它。

可在 macOS、Windows 和 Linux 上运行（菜单栏应用、窗口、TUI、Web UI 和 CLI），也可在 Docker 中以及 Termux 上运行。`,
    expectedSourceSegments: [
      'Each agent keeps its model in its own file, in its own format, with its own keys and base URLs.',
      'A subscription you pay for works in one agent and nowhere else.',
      'magpie puts all of that behind one app and one local gateway:',
      '- **Pick any model for any agent** from one list.',
      "magpie edits the one key that matters in the agent's own config.",
      "- **Use one provider everywhere**: an API key, a local model, or the Claude, ChatGPT, Copilot, Gemini or Grok plan you're signed in to.",
      '- **Keep going when a quota runs out**: a routing group moves to the next account or model, and the agent never sees the error.',
      "It's for you if you use more than one agent, more than one provider, or more than one account.",
      "If you use one agent on its vendor's own plan and that's enough, you don't need it.",
      'Runs on macOS, Windows and Linux (menu bar app, window, TUI, web UI and CLI), in Docker, and on Termux.'
    ],
    expectedTargetSegments: [
      '每个智能体都把它的模型保存在自己的文件中，使用自己的格式，并带有自己的密钥和基础 URL。',
      '你付费的订阅只在一个智能体中有效，在其他任何地方都不行。',
      'magpie 把这一切都放在一个应用和一个本地网关之后：',
      '- **为任何智能体选择任何模型**，从一个列表中选择。',
      'magpie 会编辑智能体自身配置中唯一重要的那个密钥。',
      '- **在任何地方使用同一个提供商**：一个 API 密钥、一个本地模型，或者你已登录的 Claude、ChatGPT、Copilot、Gemini 或 Grok 套餐。',
      '- **配额用完时继续运行**：路由组会切换到下一个账户或模型，而智能体永远不会看到该错误。',
      '如果你使用不止一个智能体、不止一个提供商或不止一个账户，那么它适合你。',
      '如果你只在一个智能体上使用其供应商自己的套餐，并且这就够了，那你不需要它。',
      '可在 macOS、Windows 和 Linux 上运行（菜单栏应用、窗口、TUI、Web UI 和 CLI），也可在 Docker 中以及 Termux 上运行。'
    ],
    expectedPairs: Array.from({ length: 10 }, (_, index) => ({
      sourceIds: [`s${index}`],
      targetIds: [`t${index}`]
    }))
  },
  {
    name: '常见缩写后接小写品牌名仍保持逐句对应',
    sourceText: 'Use e.g. this value with Dr. smith. magpie explains the result.',
    targetText: '例如，用这个值与 smith 医生一起使用。magpie 解释结果。',
    expectedSourceSegments: ['Use e.g. this value with Dr. smith.', 'magpie explains the result.'],
    expectedTargetSegments: ['例如，用这个值与 smith 医生一起使用。', 'magpie 解释结果。'],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] }
    ]
  },
  {
    name: 'URL 与小写品牌名保持逐句对应',
    sourceText: 'magpie supports HTTPS. It keeps example.com unchanged.',
    targetText: 'magpie 支持 HTTPS。它保持 example.com 不变。',
    expectedSourceSegments: ['magpie supports HTTPS.', 'It keeps example.com unchanged.'],
    expectedTargetSegments: ['magpie 支持 HTTPS。', '它保持 example.com 不变。'],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] }
    ]
  },
  {
    name: '数字与版本号不会被误当成分句边界',
    sourceText: 'Version 2.0 is stable. magpie supports 12 providers.',
    targetText: '2.0 版本已经稳定。magpie 支持 12 个提供商。',
    expectedSourceSegments: ['Version 2.0 is stable.', 'magpie supports 12 providers.'],
    expectedTargetSegments: ['2.0 版本已经稳定。', 'magpie 支持 12 个提供商。'],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] }
    ]
  },
  {
    name: '多句合译为一个中文句段',
    sourceText: 'The model is small. It runs locally.',
    targetText: '这个模型很小并且可以在本地运行。',
    expectedSourceSegments: ['The model is small.', 'It runs locally.'],
    expectedTargetSegments: ['这个模型很小并且可以在本地运行。'],
    expectedPairs: [{ sourceIds: ['s0', 's1'], targetIds: ['t0'] }]
  },
  {
    name: '一个英文句段拆成两个中文句段',
    sourceText: 'The gateway routes requests to the next available account when a quota runs out.',
    targetText: '网关会把请求路由到下一个可用账户。配额用完时会自动切换。',
    expectedSourceSegments: [
      'The gateway routes requests to the next available account when a quota runs out.'
    ],
    expectedTargetSegments: ['网关会把请求路由到下一个可用账户。', '配额用完时会自动切换。'],
    expectedPairs: [{ sourceIds: ['s0'], targetIds: ['t0', 't1'] }]
  },
  {
    name: '引号内句号后接小写品牌名仍可切分',
    sourceText: 'He said, "It works." magpie agreed.',
    targetText: '他说：“它能运行。”magpie 同意了。',
    expectedSourceSegments: ['He said, "It works."', 'magpie agreed.'],
    expectedTargetSegments: ['他说：“它能运行。”', 'magpie 同意了。'],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] }
    ]
  },
  {
    name: '冒号和逗号不会导致错误分句',
    sourceText:
      'There are three options: one app, one gateway and one model. magpie chooses the safest route.',
    targetText: '有三个选项：一个应用、一个网关和一个模型。magpie 会选择最安全的路线。',
    expectedSourceSegments: [
      'There are three options: one app, one gateway and one model.',
      'magpie chooses the safest route.'
    ],
    expectedTargetSegments: [
      '有三个选项：一个应用、一个网关和一个模型。',
      'magpie 会选择最安全的路线。'
    ],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] }
    ]
  },
  {
    name: '命令与本地端口保持逐句对应',
    sourceText: 'Run pnpm dev. magpie opens at localhost:5173.',
    targetText: '运行 pnpm dev。magpie 会在 localhost:5173 打开。',
    expectedSourceSegments: ['Run pnpm dev.', 'magpie opens at localhost:5173.'],
    expectedTargetSegments: ['运行 pnpm dev。', 'magpie 会在 localhost:5173 打开。'],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] }
    ]
  },
  {
    name: '多个 Markdown 列表项逐句对应',
    sourceText: `- **Install the app** from the release page. It runs on every platform.
- **Connect a provider** with one API key. magpie keeps the key in the agent config.`,
    targetText: `- **从发布页面安装应用**。它可以在所有平台上运行。
- **使用一个 API 密钥连接提供商**。magpie 会把密钥保存在智能体配置中。`,
    expectedSourceSegments: [
      '- **Install the app** from the release page.',
      'It runs on every platform.',
      '- **Connect a provider** with one API key.',
      'magpie keeps the key in the agent config.'
    ],
    expectedTargetSegments: [
      '- **从发布页面安装应用**。',
      '它可以在所有平台上运行。',
      '- **使用一个 API 密钥连接提供商**。',
      'magpie 会把密钥保存在智能体配置中。'
    ],
    expectedPairs: [
      { sourceIds: ['s0'], targetIds: ['t0'] },
      { sourceIds: ['s1'], targetIds: ['t1'] },
      { sourceIds: ['s2'], targetIds: ['t2'] },
      { sourceIds: ['s3'], targetIds: ['t3'] }
    ]
  }
]
