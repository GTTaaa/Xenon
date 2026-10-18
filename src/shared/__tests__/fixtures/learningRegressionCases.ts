/** 学习模式候选词回归样例，覆盖多义词、短语、否定、代词、专有名词与数字 */
export interface LearningRegressionCase {
  /** 样例名称，失败时用于定位场景 */
  name: string
  /** 英文原文 */
  sourceText: string
  /** 已确认的中文译文，供后续人工语义评测复用 */
  targetText: string
  /** 应该保留为学习候选的英文词 */
  expectedTerms: string[]
  /** 不应出现在学习候选中的英文词 */
  forbiddenTerms: string[]
}

export const learningRegressionCases: LearningRegressionCase[] = [
  {
    name: '多义词 book 表示预订',
    sourceText: 'We need to book a room.',
    targetText: '我们需要预订一个房间。',
    expectedTerms: ['need', 'book', 'room'],
    forbiddenTerms: ['a']
  },
  {
    name: '多义词 bank 表示银行',
    sourceText: 'The bank is near the river.',
    targetText: '银行在河附近。',
    expectedTerms: ['bank', 'river'],
    forbiddenTerms: ['the', 'is']
  },
  {
    name: '多义词 run 表示经营',
    sourceText: 'She runs a small company.',
    targetText: '她经营一家小公司。',
    expectedTerms: ['runs', 'small', 'company'],
    forbiddenTerms: ['she', 'a']
  },
  {
    name: '多义词 run 表示跑步',
    sourceText: 'He runs every morning.',
    targetText: '他每天早上跑步。',
    expectedTerms: ['runs', 'every', 'morning'],
    forbiddenTerms: ['he']
  },
  {
    name: '短语 look forward to',
    sourceText: 'Our team looks forward to working with you.',
    targetText: '我们的团队期待与您合作。',
    expectedTerms: ['team', 'looks', 'forward', 'working'],
    forbiddenTerms: ['our', 'you']
  },
  {
    name: '短语 give up',
    sourceText: 'They will give up the plan.',
    targetText: '他们会放弃这个计划。',
    expectedTerms: ['give', 'up', 'plan'],
    forbiddenTerms: ['they', 'will', 'the']
  },
  {
    name: '短语 turn down',
    sourceText: 'We must turn down the offer.',
    targetText: '我们必须拒绝这份报价。',
    expectedTerms: ['turn', 'down', 'offer'],
    forbiddenTerms: ['we', 'must', 'the']
  },
  {
    name: '短语 call off',
    sourceText: 'They called off the meeting.',
    targetText: '他们取消了会议。',
    expectedTerms: ['called', 'off', 'meeting'],
    forbiddenTerms: ['they', 'the']
  },
  {
    name: '否定词 never',
    sourceText: 'Never tell anyone your password.',
    targetText: '永远不要告诉任何人你的密码。',
    expectedTerms: ['tell', 'password'],
    forbiddenTerms: ['never', 'anyone', 'your']
  },
  {
    name: '否定词 nothing',
    sourceText: 'Nothing is impossible if you keep trying.',
    targetText: '如果你坚持尝试，没有什么是不可能的。',
    expectedTerms: ['impossible', 'keep', 'trying'],
    forbiddenTerms: ['nothing', 'is', 'if', 'you']
  },
  {
    name: '代词 anyone',
    sourceText: 'Anyone can learn with enough practice.',
    targetText: '任何人都能通过足够的练习学会。',
    expectedTerms: ['learn', 'enough', 'practice'],
    forbiddenTerms: ['anyone', 'can']
  },
  {
    name: '句中专有名词 English',
    sourceText: 'Students learn English through practice.',
    targetText: '学生通过练习学习英语。',
    expectedTerms: ['students', 'learn', 'through', 'practice'],
    forbiddenTerms: ['English']
  },
  {
    name: '品牌名 OpenAI',
    sourceText: 'We discussed OpenAI yesterday.',
    targetText: '我们昨天讨论了 OpenAI。',
    expectedTerms: ['discussed', 'yesterday'],
    forbiddenTerms: ['we', 'OpenAI']
  },
  {
    name: '缩写词 API',
    sourceText: 'We tested the API yesterday.',
    targetText: '我们昨天测试了 API。',
    expectedTerms: ['tested', 'yesterday'],
    forbiddenTerms: ['we', 'the', 'API']
  },
  {
    name: '句中人名 Alice',
    sourceText: 'We met Alice yesterday.',
    targetText: '我们昨天见到了 Alice。',
    expectedTerms: ['met', 'yesterday'],
    forbiddenTerms: ['we', 'Alice']
  },
  {
    name: '技术名词 algorithm',
    sourceText: 'The algorithm improves search quality.',
    targetText: '该算法提升了搜索质量。',
    expectedTerms: ['algorithm', 'improves', 'search', 'quality'],
    forbiddenTerms: ['the']
  },
  {
    name: '产品发布语境',
    sourceText: 'The company will launch a new product.',
    targetText: '公司即将推出一款新产品。',
    expectedTerms: ['company', 'launch', 'new', 'product'],
    forbiddenTerms: ['the', 'will', 'a']
  },
  {
    name: '完成时语境 already',
    sourceText: 'She has already finished the report.',
    targetText: '她已经完成了报告。',
    expectedTerms: ['already', 'finished', 'report'],
    forbiddenTerms: ['she', 'has', 'the']
  },
  {
    name: '医疗语境 medicine',
    sourceText: 'The medicine can reduce pain.',
    targetText: '这种药可以减轻疼痛。',
    expectedTerms: ['medicine', 'reduce', 'pain'],
    forbiddenTerms: ['the', 'can']
  },
  {
    name: '决策语境 decision',
    sourceText: 'This decision may affect our budget.',
    targetText: '这个决定可能影响我们的预算。',
    expectedTerms: ['decision', 'affect', 'budget'],
    forbiddenTerms: ['this', 'may', 'our']
  },
  {
    name: '达成一致语境',
    sourceText: 'The team reached an agreement.',
    targetText: '团队达成了一项协议。',
    expectedTerms: ['team', 'reached', 'agreement'],
    forbiddenTerms: ['the', 'an']
  },
  {
    name: '会议确认语境',
    sourceText: 'Please confirm the meeting time.',
    targetText: '请确认会议时间。',
    expectedTerms: ['confirm', 'meeting', 'time'],
    forbiddenTerms: ['the']
  },
  {
    name: '软件故障语境',
    sourceText: 'The software crashed during the update.',
    targetText: '软件在更新期间崩溃了。',
    expectedTerms: ['software', 'crashed', 'during', 'update'],
    forbiddenTerms: ['the']
  },
  {
    name: '数据保护语境',
    sourceText: 'We should protect personal data.',
    targetText: '我们应该保护个人数据。',
    expectedTerms: ['protect', 'personal', 'data'],
    forbiddenTerms: ['we', 'should']
  },
  {
    name: '退款语境',
    sourceText: 'The customer requested a refund.',
    targetText: '客户申请了退款。',
    expectedTerms: ['customer', 'requested', 'refund'],
    forbiddenTerms: ['the', 'a']
  },
  {
    name: '结果准确性语境',
    sourceText: 'The results were surprisingly accurate.',
    targetText: '结果准确得令人意外。',
    expectedTerms: ['results', 'surprisingly', 'accurate'],
    forbiddenTerms: ['the', 'were']
  },
  {
    name: '问题解决语境',
    sourceText: 'She quickly solved the problem.',
    targetText: '她很快解决了这个问题。',
    expectedTerms: ['quickly', 'solved', 'problem'],
    forbiddenTerms: ['she', 'the']
  },
  {
    name: '合同约束语境',
    sourceText: 'The contract is legally binding.',
    targetText: '这份合同具有法律约束力。',
    expectedTerms: ['contract', 'legally', 'binding'],
    forbiddenTerms: ['the', 'is']
  },
  {
    name: '持续改进语境',
    sourceText: 'Our goal is continuous improvement.',
    targetText: '我们的目标是持续改进。',
    expectedTerms: ['goal', 'continuous', 'improvement'],
    forbiddenTerms: ['our', 'is']
  },
  {
    name: '能源消耗语境',
    sourceText: 'The device consumes less energy.',
    targetText: '该设备消耗更少的能源。',
    expectedTerms: ['device', 'consumes', 'less', 'energy'],
    forbiddenTerms: ['the']
  },
  {
    name: '考虑不同方案语境',
    sourceText: 'They are considering a different approach.',
    targetText: '他们正在考虑一种不同的方法。',
    expectedTerms: ['considering', 'different', 'approach'],
    forbiddenTerms: ['they', 'are', 'a']
  },
  {
    name: '证据支持结论语境',
    sourceText: 'The evidence strongly supports this conclusion.',
    targetText: '证据有力地支持了这个结论。',
    expectedTerms: ['evidence', 'strongly', 'supports', 'conclusion'],
    forbiddenTerms: ['the', 'this']
  },
  {
    name: '否认指控语境',
    sourceText: 'He denied the accusation completely.',
    targetText: '他完全否认了这项指控。',
    expectedTerms: ['denied', 'accusation', 'completely'],
    forbiddenTerms: ['he', 'the']
  },
  {
    name: '数字不应成为学习候选',
    sourceText: 'We processed 12 requests.',
    targetText: '我们处理了 12 个请求。',
    expectedTerms: ['processed', 'requests'],
    forbiddenTerms: ['we', '12']
  },
  {
    name: 'light 表示光线',
    sourceText: 'The light is too bright.',
    targetText: '灯光太亮了。',
    expectedTerms: ['light', 'bright'],
    forbiddenTerms: ['the', 'is', 'too']
  },
  {
    name: 'light 表示重量轻',
    sourceText: 'The bag is very light.',
    targetText: '这个包很轻。',
    expectedTerms: ['bag', 'light'],
    forbiddenTerms: ['the', 'is', 'very']
  }
]
