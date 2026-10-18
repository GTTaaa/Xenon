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
  }
]
