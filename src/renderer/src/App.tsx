import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type { ProviderItem, ShortcutSettings } from '../../shared/config'
import {
  getAlignmentPairSentences,
  resolveLearningHighlightSide,
  tokenizeTextWords,
  type AlignmentSegment,
  type AlignmentToken,
  type TextAlignment
} from '../../shared/textAlignment'
import {
  findEnglishWordAtOffset,
  type WordLookupResult,
  type WordLookupSide
} from '../../shared/wordLookup'
import {
  type SentenceSyntaxAnalysis,
  type SentenceSyntaxInsight,
  type SentenceSyntaxSegment
} from '../../shared/sentenceSyntax'
import { isGrammarContraction } from '../../shared/englishGrammar.ts'

import {
  detectLanguage,
  getLanguageInfo,
  resolveAutoTargetLanguage,
  resolvePromptLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage
} from '../../shared/languageDetector'
import {
  calculatePairScrollTop,
  findFirstVisiblePairId as selectFirstVisiblePairId,
  type ScrollRectBoundary,
  type VisiblePairBox
} from './scrollAlignment'
import {
  findCachedVocab,
  getVocabFlashcards,
  getVocabItemCount,
  getVocabItems,
  getVocabItemsByWordForms,
  incrementPassiveVocabEncounters,
  normalizeVocabLemma,
  recordVocabEncounter,
  removeVocabItem,
  type VocabFlashcard,
  type VocabItem
} from './services/vocabDatabase'
import {
  collectUniqueEnglishWords,
  findVocabTextMatches,
  splitSentenceAroundVocab,
  type VocabTextMatch
} from './services/vocabMatching'
import {
  MAIN_WINDOW_HEIGHT_MAX,
  MAIN_WINDOW_HEIGHT_MIN,
  NORMAL_WINDOW_HEIGHT_MAX,
  STRUCTURE_LAYOUT_COLLAPSE_MS,
  STRUCTURE_LAYOUT_TRANSITION_MS,
  VOCAB_LIBRARY_WINDOW_HEIGHT_MIN
} from '../../shared/windowLayout'
import { EncounterCrowdCanvas } from './components/EncounterCrowdCanvas'
import { filterVocabItems, removeVocabFlashcardFromQueue } from './vocabReview'

type TranslateStatus = 'idle' | 'translating' | 'error'
type PrimaryView = 'translate' | 'learn' | 'review'
type ReviewReturnView = Exclude<PrimaryView, 'review'>

const INITIAL_SOURCE_TEXT = ''
// 普通模式输入字号 14px × 行高 1.55，用来把输入框内容高度换算成行数
const INPUT_LINE_HEIGHT = 21.7
// 输入区最多长到 5 行，再多交给输入框自己滚动
const MAX_INPUT_LINES = 5
// 学习模式两侧统一显示 2～15 行：短句保持紧凑，长文本提供更充足的对照阅读空间
const LEARNING_MIN_VISIBLE_LINES = 2
const LEARNING_MAX_VISIBLE_LINES = 15
// 普通模式译文最少铺 3 行（16px 字号 × 1.6 行高），短内容不再留下过多空白
const RESULT_MIN_HEIGHT = 16 * 1.6 * 3
// 学习对齐结果只保留当前会话内最近使用的少量文本，避免缓存无限增长
const MAX_ALIGNMENT_CACHE_ENTRIES = 8
// 单词释义按“当前句 + 对应译文”缓存，避免重复点击同一语境时产生额外模型请求
const MAX_WORD_LOOKUP_CACHE_ENTRIES = 64
// 空状态一次准备多张闪卡，既够轮播一轮，也不会让开始学习前的读取过重
const VOCAB_FLASHCARD_LIMIT = 8
// 调整对齐规则或提示词后递增缓存版本，主动淘汰旧结果
const ALIGNMENT_CACHE_VERSION = 'learning-v7'
// 程序化平滑滚动期间短暂忽略滚动事件，避免自动定位被当成用户滚动而关闭悬停状态
const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 600
// 用户停止滚动后再同步另一侧，避免连续滚动时两侧抢滚动位置
const PAIR_SCROLL_SYNC_DEBOUNCE_MS = 80
const getUserFriendlyErrorMessage = (code: string): string => {
  switch (code) {
    case 'CONFIG_MISSING_API_KEY':
      return '请先配置模型密钥'
    case 'CONFIG_MISSING_BASE_URL':
      return '请先配置模型服务地址'
    case 'HTTP_401':
      return '模型服务鉴权失败，请检查密钥'
    case 'HTTP_403':
      return '当前模型服务拒绝访问'
    case 'HTTP_429':
      return '请求过于频繁，请稍后再试'
    case 'NETWORK_ERROR':
      return '无法连接到模型服务'
    case 'EMPTY_RESPONSE':
      return '模型没有返回可用结果'
    case 'STREAM_ERROR':
      return '模型流式响应异常，请重试'
    default:
      return '翻译失败，请重试'
  }
}

/** 把单词查询错误转换成简洁、可操作的界面提示 */
const getWordLookupErrorMessage = (code: string): string => {
  switch (code) {
    case 'CONFIG_MISSING_API_KEY':
      return '请先配置模型密钥'
    case 'CONFIG_MISSING_BASE_URL':
      return '请先配置模型服务地址'
    case 'WORD_LOOKUP_UNRELIABLE':
      return '暂时无法确认该词在当前语境中的释义'
    case 'EMPTY_RESPONSE':
      return '模型没有返回可用释义'
    case 'HTTP_401':
    case 'HTTP_403':
      return '模型服务暂时不可用'
    case 'HTTP_429':
      return '查询过于频繁，请稍后再试'
    default:
      return '释义查询失败，请稍后再试'
  }
}

/**
 * 挑选主界面当前使用的服务商。
 * 只在"已启用"的渠道里找：按候选 ID 顺序命中第一个匹配项，都没命中就取第一个启用的。
 * 一个启用的渠道都没有时返回 undefined，调用方据此清空选择 ——
 * 否则界面会继续显示一个已经停用的渠道和它的模型，点下去还会真的发请求。
 */
const pickActiveProvider = (
  list: ProviderItem[],
  preferredIds: Array<string | null | undefined>
): ProviderItem | undefined => {
  const enabled = list.filter((p) => p.enabled)
  for (const id of preferredIds) {
    if (!id) continue
    const hit = enabled.find((p) => p.id === id)
    if (hit) return hit
  }
  return enabled[0]
}

/**
 * 语言名的极短中文显示：列表标签去掉括号里的原文，例如「英语 (English)」→「英语」。
 * 头部一行要同时放下两种语言，用不了「CHINESE (SIM)」这种长写法。
 */
function getShortLanguageLabel(code: SupportedLanguage): string {
  if (code === 'auto') return '自动'
  return getLanguageInfo(code).label.split(' (')[0]
}

/** 输入框透明测量层缓存的命中区域 */
interface SourceHitBox {
  /** 命中类型：生词偶遇优先于普通单词 */
  kind: 'encounter' | 'word'
  /** 生词偶遇编号或单词编号 */
  id: string
  /** 片段在屏幕上的所有行矩形 */
  rects: DOMRect[]
}

/** 收集同一对齐组内所有元素的屏幕矩形，兼容跨行片段 */
const collectElementRects = (
  elements: NodeListOf<HTMLElement>
): Array<{ top: number; bottom: number }> => {
  const rects: Array<{ top: number; bottom: number }> = []

  for (const element of elements) {
    for (const rect of element.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) {
        rects.push({ top: rect.top, bottom: rect.bottom })
      }
    }
  }

  return rects
}

/** 判断词片段是否是可供查词的纯英文单词 */
const isEnglishLookupWord = (text: string): boolean => {
  return /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(text)
}

/**
 * 生成学习模式下全部可点击的英文词。
 * 浏览器分词器会把连字符复合词拆成多个词，这里在保留精确偏移的前提下重新合并，
 * 同时排除数字、版本号和混排标识符，避免出现可见却无法可靠查词的范围。
 */
const buildEnglishLookupTokens = (
  text: string,
  segments: AlignmentSegment[],
  idPrefix: 'sw' | 'tw'
): AlignmentToken[] => {
  const rawTokens = tokenizeTextWords(text, 'en', segments, idPrefix)
  const tokens: AlignmentToken[] = []

  for (const rawToken of rawTokens) {
    if (!isEnglishLookupWord(rawToken.text)) continue

    const previousToken = tokens.at(-1)
    const gap = previousToken ? text.slice(previousToken.end, rawToken.start) : ''
    const mergedText = previousToken ? text.slice(previousToken.start, rawToken.end) : ''
    const canMergeHyphenatedWord =
      previousToken?.segmentId === rawToken.segmentId &&
      /^[-‐‑]$/.test(gap) &&
      isEnglishLookupWord(mergedText)

    if (previousToken && canMergeHyphenatedWord) {
      tokens[tokens.length - 1] = {
        ...previousToken,
        text: mergedText,
        end: rawToken.end
      }
      continue
    }

    tokens.push({
      ...rawToken,
      id: `${idPrefix}${tokens.length}`
    })
  }

  return tokens
}

/** 找出滚动容器中第一个进入可视区的对齐组，用作另一侧的滚动锚点 */
const findVisiblePairId = (container: HTMLElement, selector: string): string | null => {
  const viewport = container.getBoundingClientRect()
  const elements = container.querySelectorAll<HTMLElement>(selector)
  const pairs: VisiblePairBox[] = []

  for (const element of elements) {
    const pairId = element.dataset.sourcePairId ?? element.dataset.targetPairId
    if (!pairId) continue

    const rects: ScrollRectBoundary[] = Array.from(element.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ top: rect.top, bottom: rect.bottom }))
    if (rects.length > 0) pairs.push({ id: pairId, rects })
  }

  return selectFirstVisiblePairId(viewport, pairs)
}

/** 查词浮层相对鼠标的位置 */
interface WordLookupPosition {
  /** 横向坐标 */
  x: number
  /** 纵向坐标 */
  y: number
  /** 浮层优先显示在鼠标上方还是下方 */
  placement: 'above' | 'below'
}

/** 用户点击或悬停英文学习项后显示的释义浮层状态 */
interface WordLookupDisplay extends WordLookupPosition {
  /** 当前展示的英文词形或短语 */
  lookupText: string
  /** 当前词条或偶遇词的稳定编号，用于固定当前交互项 */
  lookupAnchorId: string
  /** 英文项所属的整句对齐组编号 */
  pairId: string
  /** 英文项位于原文还是译文 */
  side: WordLookupSide
  /** 当前查询状态 */
  status: 'loading' | 'ready' | 'error'
  /** 当前数据来自本地词库、模型查询还是二次偶遇 */
  origin?: 'database' | 'llm' | 'encounter'
  /** 查询成功后的上下文释义 */
  result?: WordLookupResult
  /** 词义卡附带的地道表达说明 */
  note?: string
  /** 本地词库中记录的累计偶遇次数 */
  encounterCount?: number
  /** 当前词是否已经确认收录到本地词库 */
  isPersisted?: boolean
  /** 当前浮层是否仍提供主动收藏入口 */
  canPersist?: boolean
  /** 当前浮层是否正在写入本地词库 */
  isPersisting?: boolean
  /** 当前浮层是否正在检查本地词库状态 */
  isCheckingPersistence?: boolean
  /** 当前浮层是否正在从本地词库移除 */
  isRemoving?: boolean
  /** 查询失败时的界面说明 */
  errorMessage?: string
}

/** 统一比较中文释义时使用的文本格式，避免标点和空白造成重复展示 */
const normalizeCompactMeaning = (text: string): string => {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，。；：、,.!?;:'"“”‘’]/g, '')
}

/** 字面义已经被本句释义覆盖时不再重复展示 */
const hasRedundantCompactMeaning = (literalMeaning: string, meaning: string): boolean => {
  const literal = normalizeCompactMeaning(literalMeaning)
  const contextual = normalizeCompactMeaning(meaning)
  if (!literal || !contextual) return false

  return literal === contextual || contextual.includes(literal) || literal.includes(contextual)
}

/** 常见否定缩写的语法作用可以直接从词形推导，无需额外请求模型 */
const GRAMMAR_CONTRACTION_LABELS: Record<string, string> = {
  "don't": '现在否定',
  "doesn't": '第三人称否定',
  "didn't": '过去否定',
  "isn't": 'be 动词否定',
  "aren't": 'be 动词否定',
  "wasn't": '过去否定',
  "weren't": '过去否定',
  "haven't": '完成时否定',
  "hasn't": '完成时否定',
  "hadn't": '过去完成否定',
  "can't": '否定',
  "couldn't": '过去否定',
  "won't": '将来否定',
  "wouldn't": '否定',
  "shouldn't": '否定',
  "mustn't": '否定'
}

/** 摘要区只保留最短、最容易扫读的本句词义 */
const getCompactLookupMeaning = (result: WordLookupResult, lookupText: string): string => {
  if (result.kind === 'lexical') return result.meaning

  const normalizedSurface = lookupText.trim().toLowerCase().replace(/’/g, "'")
  return GRAMMAR_CONTRACTION_LABELS[normalizedSurface] ?? result.meaning
}

/** 只在原形或字面义能补充当前词义时生成一条辅助提示 */
const getCompactLookupHint = (result: WordLookupResult, lookupText: string): string => {
  const surface = lookupText.trim().toLowerCase().replace(/’/g, "'")
  const lemma = result.lemma.trim().replace(/’/g, "'")
  const lemmaDiffers = lemma.toLowerCase() !== surface

  if (result.kind === 'grammar') {
    return lemmaDiffers ? `完整形式 ${lemma}` : ''
  }

  const hints: string[] = []
  if (lemmaDiffers) hints.push(`原形 ${lemma}`)

  if (result.literalMeaning && !hasRedundantCompactMeaning(result.literalMeaning, result.meaning)) {
    hints.push(`字面 ${result.literalMeaning}`)
  }

  return hints.join(' · ')
}

/** 解释区只给出一条最有解释力的原因，避免多个近义栏目重复占空间 */
const getCompactLookupReason = (lookup: WordLookupDisplay): string => {
  if (!lookup.result) return ''

  const directReason = lookup.result.wordOrderNote || lookup.result.contextNote || lookup.note || ''
  if (directReason) return directReason

  return lookup.result.kind === 'grammar' ? lookup.result.meaning : ''
}

interface WordLookupCompactViewProps {
  /** 当前词义查询的完整状态 */
  lookup: WordLookupDisplay
  /** 返回整句结构 */
  onClose: () => void
  /** 收藏当前词义 */
  onPersist: () => void
  /** 从生词库移出当前词义 */
  onRemove: () => void
}

/** 加载、成功和失败始终复用同一套纵向词义层级，避免查询完成后界面突然变样 */
function WordLookupCompactView({
  lookup,
  onClose,
  onPersist,
  onRemove
}: WordLookupCompactViewProps): React.JSX.Element {
  const result = lookup.status === 'ready' ? lookup.result : undefined
  const hint = result ? getCompactLookupHint(result, lookup.lookupText) : ''

  let stateText = '查询失败'
  if (result) {
    stateText = getCompactLookupMeaning(result, lookup.lookupText)
  } else if (lookup.status === 'loading') {
    stateText = '正在查询'
  }

  let detailText = lookup.errorMessage || '释义查询失败，请稍后再试'
  if (result) {
    detailText = getCompactLookupReason(lookup)
  } else if (lookup.status === 'loading') {
    detailText = '正在结合上下文查询词义…'
  }

  return (
    <div className="word-compact-view">
      <div className="word-compact-head">
        <strong className="word-compact-word" lang="en" title={lookup.lookupText}>
          {lookup.lookupText}
        </strong>
        <div className="word-compact-actions">
          <button type="button" className="word-compact-link" onClick={onClose}>
            整句
          </button>
          {result && lookup.isPersisted ? (
            <button
              type="button"
              className="word-compact-save word-compact-save-on"
              disabled={lookup.isRemoving}
              aria-label={lookup.isRemoving ? '正在移出' : '移出生词库'}
              title={lookup.isRemoving ? '正在移出' : '已在生词库，点击移出'}
              onClick={onRemove}
            >
              {lookup.isRemoving ? '…' : '★'}
            </button>
          ) : result && lookup.isCheckingPersistence ? (
            <button
              type="button"
              className="word-compact-save"
              disabled
              aria-label="正在检查词库"
              title="正在检查词库"
            >
              …
            </button>
          ) : result && lookup.isPersisting ? (
            <button
              type="button"
              className="word-compact-save"
              disabled
              aria-label="正在收录"
              title="正在收录"
            >
              …
            </button>
          ) : result && lookup.canPersist ? (
            <button
              type="button"
              className="word-compact-save"
              aria-label="收藏到生词库"
              title="收藏到生词库"
              onClick={onPersist}
            >
              ☆
            </button>
          ) : (
            <span className="word-compact-save-placeholder" aria-hidden="true" />
          )}
        </div>
      </div>
      <div
        className={`word-compact-meaning${
          lookup.status === 'error' ? ' word-compact-meaning-error' : ''
        }`}
      >
        {stateText}
      </div>
      {result && hint ? (
        <p className="word-compact-hint" title={hint}>
          {hint}
        </p>
      ) : null}
      <p
        className={`word-compact-why${lookup.status === 'error' ? ' word-compact-why-error' : ''}`}
      >
        {detailText}
      </p>
    </div>
  )
}

/** 二次偶遇高亮：本地词条在英文文本中的可交互范围 */
interface EncounterVocabHighlight extends VocabTextMatch {
  /** 渲染与交互使用的稳定编号 */
  id: string
  /** 命中位置所属的自然句片段编号 */
  segmentId: string
  /** 命中位置所属的对齐组编号 */
  pairId: string
  /** 当前英文文本位于原文还是译文 */
  side: WordLookupSide
}

/** 根据鼠标位置计算查词浮层坐标，并预留窗口边缘安全距离 */
const getWordLookupPosition = (x: number, y: number): WordLookupPosition => {
  return {
    x: Math.max(8, Math.min(x + 14, window.innerWidth - 248)),
    y: y + 16,
    placement: y > window.innerHeight * 0.62 ? 'above' : 'below'
  }
}

const DRAWER_SYNTAX_ROLE_LABELS: Record<
  'subject' | 'predicate' | 'object' | 'modifier' | 'other',
  string
> = {
  subject: '主语',
  predicate: '谓语',
  object: '宾语',
  modifier: '补充',
  other: '连接'
}

interface DrawerSyntaxGroup {
  /** 合并后的语义角色 */
  role: Exclude<SentenceSyntaxSegment['role'], 'punctuation'>
  /** 当前角色在句中的原文 */
  text: string
  /** 当前语义块相对于完整英文句子的起始偏移 */
  start: number
  /** 当前语义块相对于完整英文句子的结束偏移 */
  end: number
  /** 面向初学者的白话说明 */
  plainTip?: string
}

/** 把同一角色的连续片段合并，避免抽屉被逐词切片撑得过长 */
const groupSentenceSyntaxSegments = (segments: SentenceSyntaxSegment[]): DrawerSyntaxGroup[] => {
  const groups: DrawerSyntaxGroup[] = []
  let cursor = 0

  for (const segment of segments) {
    const segmentStart = cursor
    cursor += segment.text.length
    if (segment.role === 'punctuation' || !segment.text.trim()) continue

    const previous = groups.at(-1)
    if (previous?.role === segment.role) {
      // 标点被移除后相邻语义块可能直接黏在一起，补一个空格再规范化
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, ' ').trim()
      // 展示文本可以规范化，但高亮范围必须继续使用原始字符偏移
      previous.end = cursor
      previous.plainTip = segment.plainTip ?? previous.plainTip
      continue
    }

    groups.push({
      role: segment.role,
      text: segment.text.replace(/\s+/g, ' ').trim(),
      start: segmentStart,
      end: cursor,
      ...(segment.plainTip ? { plainTip: segment.plainTip } : {})
    })
  }

  return groups
}

interface SentenceStructureViewProps {
  /** 当前句已通过校验的结构分析 */
  analysis: SentenceSyntaxAnalysis | null
  /** 当前句是否仍在请求模型 */
  isLoading: boolean
  /** 当前句的结构请求是否已经失败 */
  hasError: boolean
  /** 重新发起当前句的结构分析 */
  onRetry: () => void
  /** 鼠标指向某个语义块时同步原文单词 */
  onGroupHover?: (start: number, end: number, role: DrawerSyntaxGroup['role']) => void
  /** 鼠标离开语义块时清除同步 */
  onGroupLeave?: () => void
}

/** 找出锚定在当前语义块内的语法选择说明 */
const findGroupSyntaxInsights = (
  text: string,
  insights: SentenceSyntaxInsight[]
): SentenceSyntaxInsight[] => {
  return insights.filter((insight) => text.includes(insight.anchorText))
}

/** 在底部学习抽屉中展示“这句话由哪些语义块组成” */
function SentenceStructureView({
  analysis,
  isLoading,
  hasError,
  onRetry,
  onGroupHover,
  onGroupLeave
}: SentenceStructureViewProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="structure-state-row">
        <p className="learning-drawer-status">正在拆解这句话…</p>
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="structure-state-row">
        <p className="learning-drawer-status learning-drawer-status-error">
          整句结构没有返回，可以重新分析。
        </p>
        <button type="button" className="word-compact-link" onClick={onRetry}>
          重新分析
        </button>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="structure-state-row">
        <p className="learning-drawer-status">整句结构尚未生成，可以点击英文单词查看词义。</p>
      </div>
    )
  }

  const groups = groupSentenceSyntaxSegments(analysis.segments)
  return (
    <div className="sentence-structure-list">
      {groups.map((group, index) => {
        const insights = findGroupSyntaxInsights(group.text, analysis.insights ?? [])

        return (
          <div
            key={`${group.role}-${index}`}
            className={`sentence-structure-row sentence-structure-${group.role}${
              onGroupHover ? ' sentence-structure-row-hoverable' : ''
            }`}
            onMouseEnter={
              onGroupHover ? () => onGroupHover(group.start, group.end, group.role) : undefined
            }
            onMouseLeave={onGroupLeave}
          >
            <div className="sentence-structure-meta">
              <span>{DRAWER_SYNTAX_ROLE_LABELS[group.role]}</span>
            </div>
            <div className="sentence-structure-copy">
              <p lang="en">{group.text}</p>
              {group.plainTip ? <small>{group.plainTip}</small> : null}
              {insights.map((insight, insightIndex) => (
                <details
                  key={`${insight.anchorText}-${insightIndex}`}
                  className="sentence-structure-insight"
                >
                  <summary>{insight.title}</summary>
                  <div className="sentence-structure-insight-body">
                    <p>{insight.reason}</p>
                    {insight.contrast ? (
                      <p className="sentence-structure-insight-contrast">
                        <span>对比</span>
                        {insight.contrast}
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 结构语义块与原文单词的联动高亮 */
interface SyntaxWordHighlight {
  /** 当前语义块覆盖的单词编号 */
  wordIds: ReadonlySet<string>
  /** 用于复用结构栏语义配色的角色 */
  role: DrawerSyntaxGroup['role']
}

interface SegmentedTextProps {
  /** 要渲染的完整文本 */
  text: string
  /** 当前文本的分段信息 */
  segments: AlignmentSegment[]
  /** 片段编号到对齐组编号的映射 */
  pairBySegmentId: ReadonlyMap<string, string>
  /** 当前激活的对齐组编号 */
  activePairId: string | null
  /** 当前文本是源文还是译文 */
  side: WordLookupSide
  /** 鼠标进入某个对齐组时的回调 */
  onPairEnter?: (pairId: string) => void
  /** 点击某个对齐组时锁定该句结构 */
  onPairClick?: (pairId: string) => void
  /** 当前侧全部英文词片段，按自然句归组 */
  lookupTokensBySegmentId?: ReadonlyMap<string, AlignmentToken[]>
  /** 当前侧命中的本地已收录词 */
  encounterHighlights?: EncounterVocabHighlight[]
  /** 当前鼠标指向或固定的普通英文词编号 */
  activeLookupWordId?: string | null
  /** 当前结构语义块覆盖的英文词编号 */
  activeSyntaxHighlight?: SyntaxWordHighlight | null
  /** 当前浮层固定的二次偶遇词条编号 */
  activeEncounterId?: string | null
  /** 点击普通英文词时的回调 */
  onLookupWordClick?: (
    token: AlignmentToken,
    pairId: string,
    event: React.MouseEvent<HTMLSpanElement>
  ) => void
  /** 鼠标进入普通英文词时的回调 */
  onLookupWordEnter?: (token: AlignmentToken, pairId: string) => void
  /** 鼠标离开普通英文词时的回调 */
  onLookupWordLeave?: () => void
  /** 点击二次偶遇词时的回调 */
  onEncounterClick?: (
    match: EncounterVocabHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ) => void
  /** 鼠标进入二次偶遇词时的回调 */
  onEncounterEnter?: (
    match: EncounterVocabHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ) => void
  /** 鼠标离开二次偶遇词时的回调 */
  onEncounterLeave?: () => void
}

/**
 * 按分段渲染纯文本。
 * 片段之间的空白仍按原字符串补回，因此不会改变翻译结果的换行、空格或复制内容。
 */
function SegmentedText({
  text,
  segments,
  pairBySegmentId,
  activePairId,
  side,
  onPairEnter,
  onPairClick,
  lookupTokensBySegmentId,
  encounterHighlights = [],
  activeLookupWordId = null,
  activeSyntaxHighlight = null,
  activeEncounterId = null,
  onLookupWordClick,
  onLookupWordEnter,
  onLookupWordLeave,
  onEncounterClick,
  onEncounterEnter,
  onEncounterLeave
}: SegmentedTextProps): React.JSX.Element {
  const nodes: React.ReactNode[] = []
  let cursor = 0

  for (const segment of segments) {
    if (segment.start > cursor) nodes.push(text.slice(cursor, segment.start))

    const pairId = pairBySegmentId.get(segment.id) ?? null
    const isActive = pairId !== null && pairId === activePairId
    const segmentNodes: React.ReactNode[] = []
    let segmentCursor = segment.start
    const segmentTokens = (lookupTokensBySegmentId?.get(segment.id) ?? []).filter(
      (token) => token.start >= segment.start && token.end <= segment.end
    )
    const segmentEncounterHighlights = encounterHighlights.filter(
      (highlight) => highlight.start < segment.end && highlight.end > segment.start
    )

    while (segmentCursor < segment.end) {
      const encounterHighlight = segmentEncounterHighlights.find(
        (item) => item.start <= segmentCursor && item.end > segmentCursor
      )
      if (encounterHighlight) {
        const end = Math.min(encounterHighlight.end, segment.end)
        const isEncounterActive = encounterHighlight.id === activeEncounterId
        segmentNodes.push(
          <span
            key={`encounter-${encounterHighlight.id}-${segmentCursor}`}
            className={`encounter-highlight encounter-highlight-${side}${
              isEncounterActive ? ' encounter-highlight-active' : ''
            }`}
            data-source-encounter-id={side === 'source' ? encounterHighlight.id : undefined}
            data-target-encounter-id={side === 'target' ? encounterHighlight.id : undefined}
            onClick={
              onEncounterClick ? (event) => onEncounterClick(encounterHighlight, event) : undefined
            }
            onMouseEnter={
              onEncounterEnter ? (event) => onEncounterEnter(encounterHighlight, event) : undefined
            }
            onMouseLeave={onEncounterLeave}
          >
            {text.slice(segmentCursor, end)}
          </span>
        )
        segmentCursor = end
        continue
      }

      const token = segmentTokens.find(
        (item) => item.start <= segmentCursor && item.end > segmentCursor
      )
      if (token) {
        const end = Math.min(token.end, segment.end)
        const isWordActive = token.id === activeLookupWordId
        const activeSyntaxRole = activeSyntaxHighlight?.wordIds.has(token.id)
          ? activeSyntaxHighlight.role
          : null
        segmentNodes.push(
          <span
            key={`word-${token.id}-${segmentCursor}`}
            className={`source-word${isWordActive ? ' source-word-active' : ''}${
              activeSyntaxRole
                ? ` source-word-structure-active source-word-structure-${activeSyntaxRole}`
                : ''
            }`}
            data-source-word-id={side === 'source' ? token.id : undefined}
            data-target-word-id={side === 'target' ? token.id : undefined}
            onClick={
              onLookupWordClick && pairId
                ? (event) => onLookupWordClick(token, pairId, event)
                : undefined
            }
            onMouseEnter={
              onLookupWordEnter && pairId ? () => onLookupWordEnter(token, pairId) : undefined
            }
            onMouseLeave={onLookupWordLeave}
          >
            {text.slice(segmentCursor, end)}
          </span>
        )
        segmentCursor = end
        continue
      }

      const nextBoundary = Math.min(
        segment.end,
        ...segmentEncounterHighlights
          .map((item) => item.start)
          .filter((start) => start > segmentCursor),
        ...segmentTokens.map((item) => item.start).filter((start) => start > segmentCursor)
      )
      const end = nextBoundary > segmentCursor ? nextBoundary : segment.end
      segmentNodes.push(text.slice(segmentCursor, end))
      segmentCursor = end
    }

    nodes.push(
      <span
        key={segment.id}
        className={`alignment-segment${isActive ? ' alignment-segment-active' : ''}`}
        data-source-pair-id={side === 'source' && pairId ? pairId : undefined}
        data-target-pair-id={side === 'target' && pairId ? pairId : undefined}
        onMouseEnter={onPairEnter && pairId ? () => onPairEnter(pairId) : undefined}
        onClick={onPairClick && pairId ? () => onPairClick(pairId) : undefined}
      >
        {segmentNodes}
      </span>
    )

    cursor = segment.end
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))

  return <>{nodes}</>
}

interface VocabFlashcardCarouselProps {
  /** 已按随机顺序准备好的复习闪卡 */
  cards: VocabFlashcard[]
  /** 当前轮播卡片编号 */
  activeIndex: number
  /** 切换轮播卡片 */
  onIndexChange: (index: number) => void
  /** 是否启用自动轮播；复习模式固定关闭 */
  autoAdvance?: boolean
  /** 是否在闪卡顶部展示“全部生词”入口 */
  showAllVocabLink?: boolean
  /** 打开生词列表覆盖层 */
  onOpenVocabLibrary?: () => void
}

/** 复习视图的多卡片闪卡组 */
function VocabFlashcardCarousel({
  cards,
  activeIndex,
  onIndexChange,
  autoAdvance = true,
  showAllVocabLink = false,
  onOpenVocabLibrary
}: VocabFlashcardCarouselProps): React.JSX.Element | null {
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [isCarouselHovered, setIsCarouselHovered] = useState(false)
  const [isCardHovered, setIsCardHovered] = useState(false)
  const [isFocusWithin, setIsFocusWithin] = useState(false)
  // 用卡片键记录固定状态，换卡后旧键自然失效，无需在 Effect 里额外重置
  const [pinnedCardKey, setPinnedCardKey] = useState<string | null>(null)
  const activeCard = cards[activeIndex] ?? cards[0]

  const sentenceParts = useMemo(() => {
    if (!activeCard) return null
    return splitSentenceAroundVocab(
      activeCard.context.sourceSentence,
      activeCard.context.surface || activeCard.item.surface || activeCard.item.lemma
    )
  }, [activeCard])

  if (!activeCard || !sentenceParts) return null

  const cardKey = `${activeCard.item.lemmaLower}-${
    activeCard.context.id ?? activeCard.context.sourceSentenceKey
  }`
  const isAnswerPinned = pinnedCardKey === cardKey
  const isRevealed = isCardHovered || isAnswerPinned
  const isPaused = isCarouselHovered || isFocusWithin || isAnswerPinned
  const hasMultipleCards = cards.length > 1

  /** 保留切换方向，让前后两张卡可以从对应方向滑入 */
  const navigateTo = (nextIndex: number, nextDirection: 'next' | 'prev'): void => {
    setDirection(nextDirection)
    onIndexChange(nextIndex)
  }

  const goToPrevious = (): void => {
    if (!hasMultipleCards) return
    navigateTo((activeIndex - 1 + cards.length) % cards.length, 'prev')
  }

  const goToNext = (): void => {
    if (!hasMultipleCards) return
    navigateTo((activeIndex + 1) % cards.length, 'next')
  }

  /** 进度条播放完自动翻到下一张，悬停或固定答案时动画会暂停 */
  const handleProgressEnd = (event: React.AnimationEvent<HTMLSpanElement>): void => {
    if (event.animationName !== 'vocab-flashcard-progress') return
    goToNext()
  }

  const togglePinnedAnswer = (): void => {
    setPinnedCardKey((current) => (current === cardKey ? null : cardKey))
  }

  // 固定释义才需要额外状态；自动暂停不额外占用正文注意力
  const statusText = isAnswerPinned ? '释义已固定' : null

  return (
    <div
      className="vocab-flashcard-carousel"
      role="group"
      aria-roledescription="轮播"
      aria-label="偶遇复习轮播"
      onMouseEnter={() => setIsCarouselHovered(true)}
      onMouseLeave={() => {
        setIsCarouselHovered(false)
        setIsCardHovered(false)
      }}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false)
        }
      }}
    >
      {autoAdvance && hasMultipleCards ? (
        <span
          className={`vocab-flashcard-progress${
            isPaused ? ' vocab-flashcard-progress-paused' : ''
          }`}
          aria-hidden="true"
        >
          <span key={activeIndex} onAnimationEnd={handleProgressEnd} />
        </span>
      ) : null}

      <div className="vocab-flashcard-kicker">
        <span className="vocab-flashcard-kicker-start">
          <span
            className="vocab-flashcard-dots"
            role="img"
            aria-label={`第 ${activeIndex + 1} 张，共 ${cards.length} 张`}
          >
            {cards.map((card, index) => (
              <span
                key={`${card.item.lemmaLower}-${card.context.id ?? card.context.sourceSentenceKey ?? index}`}
                className={`vocab-flashcard-dot${
                  index === activeIndex ? ' vocab-flashcard-dot-active' : ''
                }`}
                aria-hidden="true"
              />
            ))}
          </span>
          {statusText ? (
            <span className="vocab-flashcard-status vocab-flashcard-status-paused">
              {statusText}
            </span>
          ) : null}
        </span>
        {showAllVocabLink ? (
          <button type="button" className="review-all-vocab-link" onClick={onOpenVocabLibrary}>
            全部生词 →
          </button>
        ) : null}
      </div>

      <div
        className="vocab-flashcard-stage"
        onMouseEnter={() => setIsCardHovered(true)}
        onMouseLeave={() => setIsCardHovered(false)}
      >
        <div
          key={cardKey}
          className={`vocab-flashcard vocab-flashcard-enter-${direction}${
            isRevealed ? ' vocab-flashcard-revealed' : ''
          }`}
          role="button"
          tabIndex={0}
          aria-pressed={isAnswerPinned}
          aria-label={
            isRevealed
              ? '偶遇复习闪卡，中文释义已显示，点击可固定或取消固定'
              : '偶遇复习闪卡，悬停或按回车键显示中文释义'
          }
          onClick={togglePinnedAnswer}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              togglePinnedAnswer()
              return
            }
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              goToPrevious()
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              goToNext()
            }
          }}
        >
          <p className="vocab-flashcard-sentence" lang="en">
            {sentenceParts.match ? (
              <>
                {sentenceParts.before}
                <mark>{sentenceParts.match}</mark>
                {sentenceParts.after}
              </>
            ) : (
              sentenceParts.before
            )}
          </p>
          <div className="vocab-flashcard-reveal">
            <div className="vocab-flashcard-flap-rotor">
              <div
                className="vocab-flashcard-flap-face vocab-flashcard-flap-front vocab-flashcard-crowd-front"
                aria-hidden="true"
              >
                <EncounterCrowdCanvas />
              </div>
              <div className="vocab-flashcard-flap-face vocab-flashcard-flap-back">
                <div className="vocab-flashcard-answer" aria-hidden={!isRevealed}>
                  <p className="vocab-flashcard-meaning">{activeCard.item.meaning}</p>
                  <p className="vocab-flashcard-context" lang="zh-CN">
                    {activeCard.context.targetSentence}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const [sourceText, setSourceText] = useState(INITIAL_SOURCE_TEXT)
  // const targetText = `你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。  你好，你今天怎么样？我正在测试专业工业手持翻译器的布局，以确保它能够通过固定高度和内部滚动机制妥善处理长文本内容。`
  // const [targetText, setTargetText] = useState('等待翻译结果...')
  const [targetText, setTargetText] = useState('')
  // 后台二次对齐结果；为空时译文仍按普通字符串渲染
  const [alignment, setAlignment] = useState<TextAlignment | null>(null)
  // 主视图只有一个状态；复习不会写入本地偏好，重启后回到最近一次翻译或学习
  const [primaryView, setPrimaryView] = useState<PrimaryView>(() => {
    return localStorage.getItem('learningMode') === '1' ? 'learn' : 'translate'
  })
  // 已收藏词标记默认关闭，避免自动装饰打断阅读
  const [showCollectedWordMarks, setShowCollectedWordMarks] = useState(() => {
    return localStorage.getItem('showCollectedWordMarks') === '1'
  })
  // 当前悬停或指向的对齐组编号
  const [activeAlignmentPairId, setActiveAlignmentPairId] = useState<string | null>(null)
  // 当前鼠标指向的普通英文词，用于输入框透明层上的词级底色
  const [hoveredSourceWordId, setHoveredSourceWordId] = useState<string | null>(null)
  // 当前鼠标指向的译文普通英文词
  const [hoveredTargetWordId, setHoveredTargetWordId] = useState<string | null>(null)
  // 当前鼠标指向的结构语义块，用于在原文输入区同步高亮
  const [hoveredSyntaxGroupRange, setHoveredSyntaxGroupRange] = useState<{
    start: number
    end: number
    role: DrawerSyntaxGroup['role']
  } | null>(null)
  // 点击单词后显示的上下文释义浮层
  const [wordLookup, setWordLookup] = useState<WordLookupDisplay | null>(null)
  // 当前英文句子里命中的本地词条，用于二次偶遇高亮与悬停解析
  const [encounterVocabItems, setEncounterVocabItems] = useState<VocabItem[]>([])
  // 按对齐组缓存的语法分析，重复展开同一句不会再次消耗 Token
  const [sentenceSyntaxByPairId, setSentenceSyntaxByPairId] = useState<
    Record<string, SentenceSyntaxAnalysis>
  >({})
  // 当前正在请求语法分析的句子
  const [syntaxLoadingPairId, setSyntaxLoadingPairId] = useState<string | null>(null)
  // 结构分析失败后保留明确状态，避免界面一直显示“稍候查看”
  const [syntaxErrorPairId, setSyntaxErrorPairId] = useState<string | null>(null)
  // 手动重试时驱动分析 Effect 重新执行
  const [syntaxRetryToken, setSyntaxRetryToken] = useState(0)
  // 当前直接铺回原文的语法分析句
  const [syntaxTargetPairId, setSyntaxTargetPairId] = useState<string | null>(null)
  // 收起结构时保留面板内容，等左栏退场后再卸载并缩回窗口
  const [isStructureCollapsing, setIsStructureCollapsing] = useState(false)
  // 窗口宽度就绪后才允许左栏播放展开动画，避免动画前几帧被旧视口裁掉
  const [isStructureLayoutReady, setIsStructureLayoutReady] = useState(false)
  // 学习模式空状态展示的随机复习闪卡轮播
  const [vocabFlashcards, setVocabFlashcards] = useState<VocabFlashcard[]>([])
  const vocabFlashcardsRef = useRef<VocabFlashcard[]>([])
  // 当前轮播卡片编号，放在主组件里以便换卡后重新校准窗口高度
  const [vocabFlashcardIndex, setVocabFlashcardIndex] = useState(0)
  const vocabFlashcardIndexRef = useRef(0)
  // 生词库唯一词条总数，供“复习 (n)”入口展示
  const [vocabItemCount, setVocabItemCount] = useState(0)
  // 生词列表覆盖层：独立于模型面板维护挂载与退出动画
  const [isVocabLibraryOpen, setIsVocabLibraryOpen] = useState(false)
  const [isVocabLibraryMounted, setIsVocabLibraryMounted] = useState(false)
  const [isVocabLibraryClosing, setIsVocabLibraryClosing] = useState(false)
  const [vocabLibraryItems, setVocabLibraryItems] = useState<VocabItem[]>([])
  const [vocabLibraryState, setVocabLibraryState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [vocabLibrarySearch, setVocabLibrarySearch] = useState('')
  const [removingVocabLemmaLowers, setRemovingVocabLemmaLowers] = useState<Set<string>>(
    () => new Set()
  )
  // 区分闪卡加载中、数据库为空与正常展示三种状态
  const [vocabFlashcardState, setVocabFlashcardState] = useState<
    'hidden' | 'loading' | 'ready' | 'empty'
  >('hidden')
  // const [statusText, setStatusText] = useState('READY_V1.1')
  const [status, setStatus] = useState<TranslateStatus>(
    INITIAL_SOURCE_TEXT.trim() ? 'translating' : 'idle'
  )
  const [errorMessage, setErrorMessage] = useState('')
  // 截图后 OCR 进行中（首次冷启动可能持续数十秒），用于给界面一个明确的忙碌态
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [ocrSlowHint, setOcrSlowHint] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const requestIdRef = useRef(0)
  const alignmentRequestIdRef = useRef(0)
  const translationAbortRef = useRef<AbortController | null>(null)
  const alignmentAbortRef = useRef<AbortController | null>(null)
  const ipcRequestSequenceRef = useRef(0)
  const alignmentCacheRef = useRef<Map<string, TextAlignment>>(new Map())
  // 同一次翻译只累计一次被动偶遇，避免状态刷新造成重复计数
  const passiveEncounterSignatureRef = useRef('')
  const wordLookupRequestIdRef = useRef(0)
  // 同一词条写入尚未完成时，阻止快速连点产生并发请求
  const persistenceInFlightRef = useRef(new Set<string>())
  // 同一词条删除尚未完成时，阻止快速连点产生并发事务
  const vocabRemovalInFlightRef = useRef(new Set<string>())
  // 输入切换或新翻译开始时，让旧的语法分析结果失效
  const sentenceSyntaxRequestIdRef = useRef(0)
  const structureCollapseTimerRef = useRef<number | null>(null)
  const structureLayoutTransitionTimerRef = useRef<number | null>(null)
  // 窗口宽度切换期间暂停高度校准，避免横向动画之后紧跟一次纵向跳动
  const isStructureLayoutTransitioningRef = useRef(false)
  const previousWantsStructureLayoutRef = useRef(false)
  const wordLookupCacheRef = useRef<Map<string, WordLookupResult>>(new Map())
  const sourceInputRef = useRef<HTMLTextAreaElement | null>(null)
  const sourceMirrorRef = useRef<HTMLDivElement | null>(null)
  const sourceHitBoxesRef = useRef<SourceHitBox[]>([])
  // 事件回调读取当前主视图，避免闭包持有切换前的旧状态
  const primaryViewRef = useRef<PrimaryView>(primaryView)
  // 记录进入复习前是翻译还是学习
  const reviewReturnViewRef = useRef<ReviewReturnView>('translate')
  // 快捷入口恢复学习视图前，需要确认当前语言组合仍支持学习
  const learningSupportedRef = useRef(false)
  // 复习主体：窗口高度按它的自然内容高度测量，不能再依赖已隐藏的阅读列
  const reviewViewRef = useRef<HTMLElement | null>(null)
  const sourceHoverFrameRef = useRef<number | null>(null)
  const isAutoScrollingSourceRef = useRef(false)
  const isAutoScrollingResultRef = useRef(false)
  const autoScrollSourceTimerRef = useRef<number | null>(null)
  const autoScrollResultTimerRef = useRef<number | null>(null)
  const sourceScrollSyncTimerRef = useRef<number | null>(null)
  const resultScrollSyncTimerRef = useRef<number | null>(null)
  // 同一句默认只自动请求一次，失败后由用户点击“重新分析”显式重试
  const attemptedSyntaxPairIdsRef = useRef(new Set<string>())
  const [providers, setProviders] = useState<ProviderItem[]>([])
  // 渠道与模型的初始值只认本地记忆值，读不到就留空 ——
  // 这里不再写 'deepseek' / 'deepseek-chat' 这类硬编码兜底：
  // 用户配置里未必有 deepseek 渠道，先显示一个不存在的模型名会误导人。
  // 真实取值由下面加载配置的 effect 补齐。
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    return localStorage.getItem('selectedProviderId') || ''
  })
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('selectedModel') || ''
  })
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  // 控制深色掌机面板真实 DOM 挂载生命周期（支持退出淡出动画，避免瞬间闪退）
  const [isDeckMounted, setIsDeckMounted] = useState(false)
  // 控制面板是否处于退出淡出状态
  const [isDeckClosing, setIsDeckClosing] = useState(false)
  const modelSelectorRef = useRef<HTMLButtonElement | null>(null)
  const engineDeckRef = useRef<HTMLDivElement | null>(null)

  // 启用的服务商列表
  const enabledProviders = useMemo(() => {
    return providers.filter((p) => p.enabled)
  }, [providers])

  // 当前生效的服务商对象：只认已启用的渠道，一个都没启用时为 undefined
  const activeProvider = useMemo(
    () => enabledProviders.find((p) => p.id === selectedProviderId) || enabledProviders[0],
    [enabledProviders, selectedProviderId]
  )

  /**
   * 清空渠道与模型选择，并同步清掉本地记忆值。
   * 停在"没有任何启用渠道"的状态时用它，避免界面继续显示已经不可用的旧渠道。
   */
  const clearActiveProviderSelection = useCallback((): void => {
    setSelectedProviderId('')
    setSelectedModel('')
    localStorage.removeItem('selectedProviderId')
    localStorage.removeItem('selectedModel')
  }, [])

  // 用户指定的源语言（'auto' 表示自动识别）
  const [sourceLanguage, setSourceLanguage] = useState<SupportedLanguage>(() => {
    const saved = localStorage.getItem('sourceLanguage') as SupportedLanguage | null
    return saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved) ? saved : 'auto'
  })

  // 用户手动指定的目标语言（为 null 时跟随自动匹配）
  const [manualTargetLang, setManualTargetLang] = useState<SupportedLanguage | null>(() => {
    const saved = localStorage.getItem('targetLanguage') as SupportedLanguage | null
    return saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved && l.code !== 'auto')
      ? saved
      : null
  })

  // 窗口置顶状态
  const [isPinned, setIsPinned] = useState(false)
  // 自动复制结果引用（避免频繁闭包捕获）
  const autoCopyRef = useRef(false)

  useEffect(() => {
    window.api.getAlwaysOnTop().then(setIsPinned).catch(console.error)
  }, [])

  const handleTogglePin = async (): Promise<void> => {
    try {
      const nextState = await window.api.toggleAlwaysOnTop()
      setIsPinned(nextState)
    } catch (err) {
      console.error('[renderer] 切换窗口置顶失败', err)
    }
  }

  const [isSourceLangMenuOpen, setIsSourceLangMenuOpen] = useState(false)
  const [isTargetLangMenuOpen, setIsTargetLangMenuOpen] = useState(false)
  const sourceLangSelectorRef = useRef<HTMLDivElement | null>(null)
  const targetLangSelectorRef = useRef<HTMLDivElement | null>(null)

  // 记录深色面板退出动画定时器
  const deckClosingTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 记录生词列表覆盖层的退出动画定时器
  const vocabLibraryClosingTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 打开模型选择面板（立即挂载 DOM 并以纯 GPU 硬件加速滑入）
  const openModelMenu = useCallback((): void => {
    if (deckClosingTimerRef.current) {
      clearTimeout(deckClosingTimerRef.current)
      deckClosingTimerRef.current = null
    }
    setIsDeckMounted(true)
    setIsDeckClosing(false)
    setIsModelMenuOpen(true)
    setIsSourceLangMenuOpen(false)
    setIsTargetLangMenuOpen(false)
  }, [])

  // 关闭模型选择面板（触发 100ms 纯 GPU 淡出，完成后卸载 DOM）
  const closeModelMenu = useCallback((): void => {
    setIsDeckClosing(true)
    setIsModelMenuOpen(false)
    if (deckClosingTimerRef.current) {
      clearTimeout(deckClosingTimerRef.current)
    }
    deckClosingTimerRef.current = setTimeout(() => {
      setIsDeckMounted(false)
      setIsDeckClosing(false)
      deckClosingTimerRef.current = null
    }, 100)
  }, [])

  /** 打开全部生词覆盖层；每次打开都从空搜索开始并重新读取数据库 */
  const openVocabLibrary = useCallback((): void => {
    if (vocabLibraryClosingTimerRef.current) {
      clearTimeout(vocabLibraryClosingTimerRef.current)
      vocabLibraryClosingTimerRef.current = null
    }
    setVocabLibrarySearch('')
    setVocabLibraryItems([])
    setVocabLibraryState('loading')
    setRemovingVocabLemmaLowers(new Set())
    setIsVocabLibraryMounted(true)
    setIsVocabLibraryClosing(false)
    setIsVocabLibraryOpen(true)
  }, [])

  /** 关闭全部生词覆盖层，保留复习队列和当前位置 */
  const closeVocabLibrary = useCallback((): void => {
    setIsVocabLibraryClosing(true)
    setIsVocabLibraryOpen(false)
    if (vocabLibraryClosingTimerRef.current) {
      clearTimeout(vocabLibraryClosingTimerRef.current)
    }
    vocabLibraryClosingTimerRef.current = setTimeout(() => {
      setIsVocabLibraryMounted(false)
      setIsVocabLibraryClosing(false)
      vocabLibraryClosingTimerRef.current = null
    }, 100)
  }, [])

  // 打开期间读取完整生词库；搜索只在已读取的本地数组上过滤
  useEffect(() => {
    if (!isVocabLibraryOpen) return

    let cancelled = false
    setVocabLibraryState('loading')
    void getVocabItems()
      .then((items) => {
        if (cancelled) return
        setVocabLibraryItems(items)
        setVocabItemCount(items.length)
        setVocabLibraryState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[renderer] 读取生词列表失败:', error)
        setVocabLibraryState('error')
      })

    return () => {
      cancelled = true
    }
  }, [isVocabLibraryOpen])

  // Esc 两段行为：有搜索词时先清空，搜索为空时才关闭覆盖层
  useEffect(() => {
    if (!isVocabLibraryOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      event.stopPropagation()
      if (vocabLibrarySearch.length > 0) {
        setVocabLibrarySearch('')
        return
      }
      closeVocabLibrary()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [closeVocabLibrary, isVocabLibraryOpen, vocabLibrarySearch])

  // 毫秒级根据输入文本自动检测语言
  const detectedInfo = useMemo(() => {
    return detectLanguage(sourceText)
  }, [sourceText])

  // 计算当前实际生效的目标语言
  const effectiveTargetLang: SupportedLanguage = useMemo(() => {
    if (manualTargetLang) return manualTargetLang
    const autoTarget = resolveAutoTargetLanguage(detectedInfo.detected)
    if (sourceLanguage !== 'auto' && sourceLanguage === autoTarget) {
      return autoTarget === 'zh' ? 'en' : 'zh'
    }
    return autoTarget
  }, [manualTargetLang, detectedInfo.detected, sourceLanguage])

  // 当前实际生效的源语言；自动模式取即时检测结果
  const effectiveSourceLang: SupportedLanguage = useMemo(() => {
    return sourceLanguage === 'auto' ? detectedInfo.detected : sourceLanguage
  }, [sourceLanguage, detectedInfo.detected])

  // 学习模式覆盖英译中与中译英两个方向
  const isLearningSupported =
    (effectiveSourceLang === 'en' && effectiveTargetLang === 'zh') ||
    (effectiveSourceLang === 'zh' && effectiveTargetLang === 'en')
  const isLearningActive = primaryView === 'learn' && isLearningSupported
  const isReviewActive = primaryView === 'review'
  // 英文位于原文还是译文，供本地词库与点词查义统一还原双语语序
  const learningHighlightSide = useMemo(
    () => resolveLearningHighlightSide(effectiveSourceLang, effectiveTargetLang),
    [effectiveSourceLang, effectiveTargetLang]
  )
  const hasSourceText = sourceText.trim().length > 0
  const hasTargetText = targetText.trim().length > 0
  // 有实际原文时才切换成上下等高的对照布局，空窗口仍保持紧凑
  const useLearningLayout = isLearningActive && hasSourceText
  // 只有复习主视图会加载闪卡
  const isVocabReviewVisible = isReviewActive
  // 搜索只在已加载的生词数组内做本地筛选
  const filteredVocabLibraryItems = useMemo(
    () => filterVocabItems(vocabLibraryItems, vocabLibrarySearch),
    [vocabLibraryItems, vocabLibrarySearch]
  )

  // 快捷入口或模式切换离开复习时，同步收起仍然挂载的生词列表
  useEffect(() => {
    if (!isReviewActive && isVocabLibraryOpen) {
      closeVocabLibrary()
    }
  }, [closeVocabLibrary, isReviewActive, isVocabLibraryOpen])

  // 头部语言行：源语言名（自动模式下显示当前识别出的语言，识别不出就写"自动"）
  const sourceLanguageName = useMemo(() => {
    if (sourceLanguage !== 'auto') return getShortLanguageLabel(sourceLanguage)
    return sourceText.trim() ? getShortLanguageLabel(detectedInfo.detected) : '自动'
  }, [sourceLanguage, sourceText, detectedInfo.detected])

  // 头部语言行：目标语言名（自动匹配时显示匹配结果）
  const targetLanguageName = useMemo(
    () => getShortLanguageLabel(effectiveTargetLang),
    [effectiveTargetLang]
  )

  // 供快捷键与截图回调同步读取最新主视图和语言能力
  useLayoutEffect(() => {
    primaryViewRef.current = primaryView
  }, [primaryView])

  useLayoutEffect(() => {
    learningSupportedRef.current = isLearningSupported
  }, [isLearningSupported])

  /** 快捷入口离开复习时，回到进入前的翻译或学习；学习不可用则回退翻译 */
  const restoreViewBeforeReview = useCallback((): void => {
    if (primaryViewRef.current !== 'review') return

    const nextView =
      reviewReturnViewRef.current === 'learn' && learningSupportedRef.current
        ? 'learn'
        : 'translate'
    primaryViewRef.current = nextView
    setPrimaryView(nextView)
  }, [])

  /** 从本地生词库重新读取唯一词条数量 */
  const refreshVocabItemCount = useCallback((): void => {
    void getVocabItemCount()
      .then(setVocabItemCount)
      .catch((error) => {
        console.warn('[renderer] 读取生词数量失败:', error)
      })
  }, [])

  // 当前语言组合不支持学习时，停留在学习视图没有意义，自动回到翻译
  useEffect(() => {
    if (primaryView === 'learn' && !isLearningSupported) {
      setPrimaryView('translate')
    }
  }, [isLearningSupported, primaryView])

  // 三个主视图都会展示复习数量，进入任一视图时从生词库刷新
  useEffect(() => {
    refreshVocabItemCount()
  }, [primaryView, refreshVocabItemCount])

  // 预先建立"片段编号 → 对齐组编号"映射，避免悬停时反复遍历配对数组
  const alignmentView = useMemo(() => {
    if (!alignment) return null

    const sourcePairBySegmentId = new Map<string, string>()
    const targetPairBySegmentId = new Map<string, string>()

    for (const pair of alignment.pairs) {
      for (const segmentId of pair.sourceIds) {
        sourcePairBySegmentId.set(segmentId, pair.id)
      }
      for (const segmentId of pair.targetIds) {
        targetPairBySegmentId.set(segmentId, pair.id)
      }
    }

    return {
      sourcePairBySegmentId,
      targetPairBySegmentId
    }
  }, [alignment])

  // 阅读与写作都分析英文侧：英译中取原文，中译英取模型生成的英文译文
  const canUseSentenceSyntax =
    isLearningActive && Boolean(alignment && alignmentView && learningHighlightSide)
  const displayedSyntaxPairId = canUseSentenceSyntax ? syntaxTargetPairId : null
  const displayedSentenceSyntax = displayedSyntaxPairId
    ? (sentenceSyntaxByPairId[displayedSyntaxPairId] ?? null)
    : null
  // A1 左右布局只在整句结构被触发后启用；收起动画期间继续保留面板内容
  const wantsStructureLayout = useLearningLayout && Boolean(displayedSyntaxPairId)
  const useStructureLayout = wantsStructureLayout || (useLearningLayout && isStructureCollapsing)
  // 收起时先保留宽窗口让左栏完成退场，面板卸载后再一次性缩回
  const useStructureWindowLayout = wantsStructureLayout

  // 切换结构句时清除旧语义块范围，避免新句子沿用上一句的偏移
  useEffect(() => {
    setHoveredSyntaxGroupRange(null)
  }, [displayedSyntaxPairId])

  // 布局目标变化时立即冻结高度同步，早于后续 useLayoutEffect 里的高度测量
  useLayoutEffect(() => {
    const wasWanted = previousWantsStructureLayoutRef.current
    previousWantsStructureLayoutRef.current = wantsStructureLayout
    if (wasWanted === wantsStructureLayout) return

    isStructureLayoutTransitioningRef.current = true
    if (wantsStructureLayout) setIsStructureLayoutReady(false)
  }, [wantsStructureLayout])

  const displayedSyntaxSentenceNumber = useMemo(() => {
    if (!alignment || !displayedSyntaxPairId) return null
    const pairIndex = alignment.pairs.findIndex((pair) => pair.id === displayedSyntaxPairId)
    return pairIndex >= 0 ? pairIndex + 1 : null
  }, [alignment, displayedSyntaxPairId])
  const hoveredSyntaxSentenceNumber = useMemo(() => {
    if (!alignment || !activeAlignmentPairId || activeAlignmentPairId === displayedSyntaxPairId) {
      return null
    }
    const pairIndex = alignment.pairs.findIndex((pair) => pair.id === activeAlignmentPairId)
    return pairIndex >= 0 ? pairIndex + 1 : null
  }, [activeAlignmentPairId, alignment, displayedSyntaxPairId])

  // 进入学习模式时不自动触发整句结构；只有用户点击某一句后才开始分析
  useEffect(() => {
    if (!alignment || !isLearningActive || !learningHighlightSide) {
      setSyntaxTargetPairId(null)
      return
    }

    const pairIds = new Set(alignment.pairs.map((pair) => pair.id))
    setSyntaxTargetPairId((current) => {
      if (current && pairIds.has(current)) return current
      return null
    })
  }, [alignment, isLearningActive, learningHighlightSide])

  // 进入学习模式后，当前句会自动请求一次轻量分析并缓存到左侧结构栏
  useEffect(() => {
    const pairId = syntaxTargetPairId
    if (
      !canUseSentenceSyntax ||
      !pairId ||
      !alignment ||
      !learningHighlightSide ||
      !selectedProviderId ||
      !selectedModel ||
      sentenceSyntaxByPairId[pairId] ||
      syntaxLoadingPairId ||
      attemptedSyntaxPairIdsRef.current.has(pairId)
    ) {
      return
    }

    const pairSentences = getAlignmentPairSentences(
      alignment,
      sourceText,
      targetText,
      pairId,
      learningHighlightSide
    )
    if (!pairSentences?.englishSentence || !pairSentences.chineseSentence) return

    const timer = window.setTimeout(() => {
      attemptedSyntaxPairIdsRef.current.add(pairId)
      const requestId = sentenceSyntaxRequestIdRef.current + 1
      sentenceSyntaxRequestIdRef.current = requestId
      setSyntaxErrorPairId(null)
      setSyntaxLoadingPairId(pairId)

      void window.api
        .analyzeSentenceSyntax({
          sentence: pairSentences.englishSentence,
          targetTranslation: pairSentences.chineseSentence,
          options: {
            providerId: selectedProviderId,
            model: selectedModel
          }
        })
        .then((response) => {
          if (sentenceSyntaxRequestIdRef.current !== requestId) return
          if (!response.ok) {
            console.warn('[renderer] 语法透视未返回结果:', response.error.code)
            setSyntaxErrorPairId(pairId)
            return
          }
          setSyntaxErrorPairId(null)
          setSentenceSyntaxByPairId((current) => ({
            ...current,
            [pairId]: response.analysis
          }))
        })
        .catch((error) => {
          if (sentenceSyntaxRequestIdRef.current !== requestId) return
          console.warn('[renderer] 语法透视失败:', error)
          setSyntaxErrorPairId(pairId)
        })
        .finally(() => {
          if (sentenceSyntaxRequestIdRef.current === requestId) {
            setSyntaxLoadingPairId(null)
          }
        })
    }, 220)

    return () => window.clearTimeout(timer)
  }, [
    alignment,
    canUseSentenceSyntax,
    learningHighlightSide,
    selectedModel,
    selectedProviderId,
    sentenceSyntaxByPairId,
    sourceText,
    syntaxLoadingPairId,
    syntaxRetryToken,
    syntaxTargetPairId,
    targetText
  ])

  // 原文中所有英文词都参与点击查词；分词结果与透明测量层共用同一套偏移
  const sourceWordView = useMemo(() => {
    if (!isLearningActive || !alignment || effectiveSourceLang !== 'en') return null

    const tokens = buildEnglishLookupTokens(sourceText, alignment.sourceSegments, 'sw')
    const tokensBySegmentId = new Map<string, AlignmentToken[]>()
    const tokenById = new Map<string, AlignmentToken>()

    for (const token of tokens) {
      tokenById.set(token.id, token)
      const segmentTokens = tokensBySegmentId.get(token.segmentId) ?? []
      segmentTokens.push(token)
      tokensBySegmentId.set(token.segmentId, segmentTokens)
    }

    return {
      tokens,
      tokenById,
      tokensBySegmentId
    }
  }, [alignment, effectiveSourceLang, isLearningActive, sourceText])

  // 把结构句内的相对偏移换算成原文绝对位置，再筛出完整落在语义块内的单词
  const activeSyntaxWordHighlight = useMemo<SyntaxWordHighlight | null>(() => {
    if (
      !hoveredSyntaxGroupRange ||
      !alignment ||
      !displayedSyntaxPairId ||
      learningHighlightSide !== 'source' ||
      !sourceWordView
    ) {
      return null
    }

    const pair = alignment.pairs.find((item) => item.id === displayedSyntaxPairId)
    if (!pair) return null

    const sourceSegmentsById = new Map(
      alignment.sourceSegments.map((segment) => [segment.id, segment])
    )
    const pairSegments = pair.sourceIds
      .map((segmentId) => sourceSegmentsById.get(segmentId))
      .filter((segment): segment is AlignmentSegment => Boolean(segment))
      .sort((left, right) => left.start - right.start)
    if (pairSegments.length !== pair.sourceIds.length || pairSegments.length === 0) return null

    const sentenceStart = pairSegments[0].start
    const sentenceEnd = Math.max(...pairSegments.map((segment) => segment.end))
    const rawSentence = sourceText.slice(sentenceStart, sentenceEnd)
    // 结构分析读取的是 trim 后的句子，因此这里补回句首被裁掉的实际偏移
    const trimmedSentenceStart = sentenceStart + rawSentence.length - rawSentence.trimStart().length
    const rangeStart = trimmedSentenceStart + hoveredSyntaxGroupRange.start
    const rangeEnd = trimmedSentenceStart + hoveredSyntaxGroupRange.end
    const wordIds = new Set<string>()

    for (const token of sourceWordView.tokens) {
      if (token.start >= rangeStart && token.end <= rangeEnd) {
        wordIds.add(token.id)
      }
    }

    return wordIds.size > 0
      ? {
          wordIds,
          role: hoveredSyntaxGroupRange.role
        }
      : null
  }, [
    alignment,
    displayedSyntaxPairId,
    hoveredSyntaxGroupRange,
    learningHighlightSide,
    sourceText,
    sourceWordView
  ])

  // 中译英时译文中的全部英文词仍可单点查询
  const targetWordView = useMemo(() => {
    if (!isLearningActive || !alignment || effectiveTargetLang !== 'en') return null

    const tokens = buildEnglishLookupTokens(targetText, alignment.targetSegments, 'tw')
    const tokensBySegmentId = new Map<string, AlignmentToken[]>()
    const tokenById = new Map<string, AlignmentToken>()

    for (const token of tokens) {
      tokenById.set(token.id, token)
      const segmentTokens = tokensBySegmentId.get(token.segmentId) ?? []
      segmentTokens.push(token)
      tokensBySegmentId.set(token.segmentId, segmentTokens)
    }

    return {
      tokens,
      tokenById,
      tokensBySegmentId
    }
  }, [alignment, effectiveTargetLang, isLearningActive, targetText])

  // 翻译完成后把英文侧已收录词转换为带偏移的高亮片段
  const encounterWordView = useMemo(() => {
    if (
      !isLearningActive ||
      !alignment ||
      !alignmentView ||
      !learningHighlightSide ||
      !showCollectedWordMarks ||
      status !== 'idle' ||
      encounterVocabItems.length === 0
    ) {
      return null
    }

    const englishText = learningHighlightSide === 'source' ? sourceText : targetText
    const segments =
      learningHighlightSide === 'source' ? alignment.sourceSegments : alignment.targetSegments
    const pairBySegmentId =
      learningHighlightSide === 'source'
        ? alignmentView.sourcePairBySegmentId
        : alignmentView.targetPairBySegmentId
    const highlights: EncounterVocabHighlight[] = []

    for (const match of findVocabTextMatches(englishText, encounterVocabItems, {
      includePhrases: false
    })) {
      const segment = segments.find((item) => match.start >= item.start && match.start < item.end)
      const pairId = segment ? pairBySegmentId.get(segment.id) : null
      if (!segment || !pairId) continue

      highlights.push({
        ...match,
        id: `${learningHighlightSide}:${match.item.lemmaLower}:${match.start}`,
        segmentId: segment.id,
        pairId,
        side: learningHighlightSide
      })
    }

    return {
      side: learningHighlightSide,
      highlights,
      matchById: new Map(highlights.map((highlight) => [highlight.id, highlight]))
    }
  }, [
    alignment,
    alignmentView,
    encounterVocabItems,
    isLearningActive,
    learningHighlightSide,
    showCollectedWordMarks,
    sourceText,
    status,
    targetText
  ])

  const deviceRef = useRef<HTMLElement | null>(null)
  // 译文区滚动容器与底部工具行：量两者高度，窗口才能按"内容实际需要多高"来收放
  const resultScrollRef = useRef<HTMLDivElement | null>(null)
  const learningDrawerRef = useRef<HTMLElement | null>(null)
  const resultToolbarRef = useRef<HTMLDivElement | null>(null)

  // 缓存上一次同步给 Electron 主进程的窗口高度，避免高频冗余触发
  const lastSentHeightRef = useRef<number>(0)

  /** 标记一次程序化滚动，短暂抑制滚动事件对悬停状态的清理 */
  const beginAutoScroll = useCallback((target: 'source' | 'result'): void => {
    const activeRef = target === 'source' ? isAutoScrollingSourceRef : isAutoScrollingResultRef
    const timerRef = target === 'source' ? autoScrollSourceTimerRef : autoScrollResultTimerRef

    activeRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      activeRef.current = false
      timerRef.current = null
    }, PROGRAMMATIC_SCROLL_SUPPRESS_MS)
  }, [])

  /** 悬停译文片段时，把对应原文按需滚入输入区可视范围 */
  const scrollSourceToPair = useCallback(
    (pairId: string): void => {
      const textarea = sourceInputRef.current
      const mirror = sourceMirrorRef.current
      if (!textarea || !mirror) return

      const pairElements = mirror.querySelectorAll<HTMLElement>(`[data-source-pair-id="${pairId}"]`)
      const previousMirrorScrollTop = mirror.scrollTop
      mirror.scrollTop = 0
      const pairRects = collectElementRects(pairElements).map((rect) => ({
        top: rect.top - textarea.scrollTop,
        bottom: rect.bottom - textarea.scrollTop
      }))
      mirror.scrollTop = previousMirrorScrollTop
      const textareaRect = textarea.getBoundingClientRect()
      const nextScrollTop = calculatePairScrollTop(
        {
          scrollTop: textarea.scrollTop,
          scrollHeight: textarea.scrollHeight,
          clientHeight: textarea.clientHeight,
          viewportTop: textareaRect.top,
          viewportBottom: textareaRect.bottom
        },
        pairRects
      )

      if (nextScrollTop === null) return
      beginAutoScroll('source')
      textarea.scrollTo({ top: nextScrollTop, behavior: 'smooth' })
    },
    [beginAutoScroll]
  )

  /** 悬停原文片段时，把对应译文按需滚入输出区可视范围 */
  const scrollResultToPair = useCallback(
    (pairId: string): void => {
      const scroll = resultScrollRef.current
      if (!scroll) return

      const pairElements = scroll.querySelectorAll<HTMLElement>(`[data-target-pair-id="${pairId}"]`)
      const pairRects = collectElementRects(pairElements)
      const scrollRect = scroll.getBoundingClientRect()
      const nextScrollTop = calculatePairScrollTop(
        {
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
          viewportTop: scrollRect.top,
          viewportBottom: scrollRect.bottom
        },
        pairRects
      )

      if (nextScrollTop === null) return
      beginAutoScroll('result')
      scroll.scrollTo({ top: nextScrollTop, behavior: 'smooth' })
    },
    [beginAutoScroll]
  )

  /** 新的句子结构请求会中断尚未完成的收起动画 */
  const cancelStructureCollapse = useCallback((): void => {
    const wasCollapsing = structureCollapseTimerRef.current !== null
    if (structureCollapseTimerRef.current !== null) {
      window.clearTimeout(structureCollapseTimerRef.current)
      structureCollapseTimerRef.current = null
    }
    setIsStructureCollapsing(false)
    // 若是在左栏退场途中重新打开，宽窗口仍在，直接恢复已就绪状态
    if (wasCollapsing) setIsStructureLayoutReady(true)
  }, [])

  /** 展开指定句子的结构，并同步左右两侧的阅读位置 */
  const openStructurePair = useCallback(
    (pairId: string): void => {
      cancelStructureCollapse()
      setActiveAlignmentPairId(pairId)
      setSyntaxTargetPairId(pairId)
      scrollSourceToPair(pairId)
    },
    [cancelStructureCollapse, scrollSourceToPair]
  )

  /** 已展开结构时跟随滚动定位当前可见句；未展开时不自动触发结构。 */
  const restoreRestingSyntaxPair = useCallback((): void => {
    if (!canUseSentenceSyntax || !syntaxTargetPairId) return

    const mirror = sourceMirrorRef.current
    const visiblePairId = mirror ? findVisiblePairId(mirror, '[data-source-pair-id]') : null
    if (visiblePairId) setSyntaxTargetPairId(visiblePairId)
  }, [canUseSentenceSyntax, syntaxTargetPairId])

  /**
   * 输入区高度与窗口高度联动。
   *
   * 窗口高度按"内容真正需要多高"来算：头部到译文区的固定距离 + 输入区实际高度
   * + 译文实际高度。
   * 早先是按输入行数线性加高（每行 +50px），多出来的空间全归译文区，
   * 于是"输入 5 行、译文只有 4 行"时底部会空出一大片。
   *
   * 这样算不会自激：译文区已经不再是 flex:1 撑满窗口，它的高度只由内容决定，
   * 改窗口高度不会反过来改变 scrollHeight。
   */
  const syncWindowHeight = useCallback((): void => {
    // 展开与收起窗口期间只提交宽度，避免宽度刚变化又触发一次纵向跳动
    if (isStructureLayoutTransitioningRef.current) return
    // 生词列表打开期间保持现有高度，不随列表条目减少或闪卡队列变化收缩
    if (isVocabLibraryOpen) return

    const panel = deviceRef.current
    if (!panel) return

    if (isReviewActive) {
      // 加载中还没有可测量的真实内容，保留当前高度，避免先缩成一条再弹回
      if (vocabFlashcardState === 'loading' || vocabFlashcardState === 'hidden') return

      const reviewView = reviewViewRef.current
      const reviewContent = reviewView?.firstElementChild
      if (!reviewView || !(reviewContent instanceof HTMLElement)) return
      // 仅已有闪卡时允许低于普通阅读窗口的最小高度，空态仍沿用统一下限
      const allowCompactHeight = vocabFlashcardState === 'ready'
      const minimumHeight = allowCompactHeight ? 0 : MAIN_WINDOW_HEIGHT_MIN

      const reviewStyle = getComputedStyle(reviewView)
      const reviewPadding =
        parseFloat(reviewStyle.paddingTop || '0') + parseFloat(reviewStyle.paddingBottom || '0')
      const lead = reviewView.getBoundingClientRect().top - panel.getBoundingClientRect().top
      const body = panel.querySelector('.device-body')
      const bottomPadding = body ? parseFloat(getComputedStyle(body).paddingBottom || '0') : 0
      // scrollHeight 会补回亚像素布局与内部边距造成的 1～2px 溢出
      const contentHeight = Math.max(
        reviewContent.getBoundingClientRect().height,
        reviewContent.scrollHeight
      )
      const measuredHeight = Math.ceil(
        Math.min(
          MAIN_WINDOW_HEIGHT_MAX,
          Math.max(minimumHeight, lead + reviewPadding + contentHeight + bottomPadding)
        )
      )
      if (Math.abs(lastSentHeightRef.current - measuredHeight) < 2) return

      lastSentHeightRef.current = measuredHeight
      void window.api.setWindowHeight(measuredHeight, allowCompactHeight)
      return
    }

    const textarea = sourceInputRef.current
    const scroll = resultScrollRef.current
    const toolbar = resultToolbarRef.current
    if (!textarea || !scroll || !toolbar) return

    // 输入框先恢复自动高度，才能量到文本本身的真实行数，而不是上一次的容器高度
    textarea.style.height = 'auto'
    const contentHeight = textarea.scrollHeight
    const learningLineHeight = parseFloat(getComputedStyle(textarea).lineHeight)
    const resultText = scroll.querySelector<HTMLElement>('.result-text')
    const sourceLineCount = Math.max(1, Math.ceil(contentHeight / learningLineHeight))
    const targetLineCount = resultText
      ? Math.max(1, Math.ceil(resultText.offsetHeight / learningLineHeight))
      : 1
    const learningVisibleLines = Math.min(
      LEARNING_MAX_VISIBLE_LINES,
      Math.max(LEARNING_MIN_VISIBLE_LINES, sourceLineCount, targetLineCount)
    )
    const learningTextHeight = learningLineHeight * learningVisibleLines

    if (useLearningLayout) {
      textarea.style.height = `${learningTextHeight}px`
    } else {
      const lineCount = Math.max(
        1,
        Math.min(MAX_INPUT_LINES, Math.round(contentHeight / INPUT_LINE_HEIGHT))
      )
      // 高度按整行取整，避免内容高度里的小数点让输入框每次输入都抖动 1px
      textarea.style.height = `${Math.min(lineCount * INPUT_LINE_HEIGHT, contentHeight)}px`
    }

    // 译文区顶部到窗口顶部的距离（头部 + 输入区 + 分隔线），不受窗口高度影响
    const lead = scroll.getBoundingClientRect().top - panel.getBoundingClientRect().top
    const scrollStyle = getComputedStyle(scroll)
    const scrollPadding =
      parseFloat(scrollStyle.paddingTop || '0') + parseFloat(scrollStyle.paddingBottom || '0')

    // 普通模式按译文实际内容计算；学习模式忽略内容高度，保持两侧等高
    scroll.style.height = ''
    const baseResultHeight = useLearningLayout
      ? learningTextHeight
      : Math.max(RESULT_MIN_HEIGHT, scroll.scrollHeight - scrollPadding)
    // 内容区到窗口底边的留白写在 .device-body 的 padding-bottom 上，从样式里读，避免两处硬编码
    const body = panel.querySelector('.device-body')
    const bottomPadding = body ? parseFloat(getComputedStyle(body).paddingBottom || '0') : 0
    const drawer = learningDrawerRef.current
    // 左侧结构栏与阅读区并排；只有右侧词义卡仍参与窗口纵向高度累加
    const drawerHeight =
      (!useStructureLayout || wordLookup) && drawer
        ? drawer.getBoundingClientRect().height +
          parseFloat(getComputedStyle(drawer).marginTop || '0') +
          parseFloat(getComputedStyle(drawer).marginBottom || '0')
        : 0
    const toolbarHeight = toolbar.getBoundingClientRect().height
    const maxWindowHeight = useLearningLayout ? MAIN_WINDOW_HEIGHT_MAX : NORMAL_WINDOW_HEIGHT_MAX
    const fixedHeight = lead + scrollPadding + drawerHeight + toolbarHeight + bottomPadding
    const resultHeight = Math.max(0, Math.min(baseResultHeight, maxWindowHeight - fixedHeight))

    // 学习模式让译文滚动区与原文输入区拥有相同的文字可视高度；空间不足时允许内部滚动
    scroll.style.height =
      useLearningLayout || resultHeight < baseResultHeight
        ? `${resultHeight + scrollPadding}px`
        : ''

    const nextWindowHeight = Math.round(
      Math.min(maxWindowHeight, Math.max(MAIN_WINDOW_HEIGHT_MIN, fixedHeight + resultHeight))
    )

    // 仅当高度发生有效变化（>= 2px）时才派发 IPC，杜绝微小晃动与性能浪费
    if (Math.abs(lastSentHeightRef.current - nextWindowHeight) < 2) return

    lastSentHeightRef.current = nextWindowHeight
    void window.api.setWindowHeight(nextWindowHeight)
  }, [
    isReviewActive,
    isVocabLibraryOpen,
    useLearningLayout,
    useStructureLayout,
    vocabFlashcardState,
    wordLookup
  ])

  // 窗口布局 Effect 只响应布局模式变化，始终通过 ref 调用最新的高度校准函数
  const syncWindowHeightRef = useRef(syncWindowHeight)
  useLayoutEffect(() => {
    syncWindowHeightRef.current = syncWindowHeight
  }, [syncWindowHeight])

  // 打开生词列表时临时抬高窗口；覆盖层内的后续变化不会再次推进高度
  useLayoutEffect(() => {
    if (!isVocabLibraryOpen) return

    const currentHeight =
      deviceRef.current?.getBoundingClientRect().height ?? MAIN_WINDOW_HEIGHT_MIN
    const targetHeight = Math.max(Math.ceil(currentHeight), VOCAB_LIBRARY_WINDOW_HEIGHT_MIN)
    lastSentHeightRef.current = targetHeight
    void window.api.setWindowHeight(targetHeight, true)
  }, [isVocabLibraryOpen])

  // 覆盖层关闭后，等复习视图重新露出再按当前闪卡重新测量
  useEffect(() => {
    if (isVocabLibraryOpen || !isReviewActive) return

    let firstFrame = 0
    let secondFrame = 0
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        syncWindowHeightRef.current()
      })
    })

    return () => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [isReviewActive, isVocabLibraryOpen])

  // 翻卡会替换闪卡节点；监听主体尺寸变化，确保每次按新卡片的真实高度校准窗口
  useEffect(() => {
    if (!isReviewActive) return

    const reviewContent = reviewViewRef.current?.firstElementChild
    if (!(reviewContent instanceof HTMLElement)) return

    let resizeFrame = 0
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0
        syncWindowHeightRef.current()
      })
    })
    resizeObserver.observe(reviewContent)

    return () => {
      resizeObserver.disconnect()
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
    }
  }, [isReviewActive, vocabFlashcardState])

  useLayoutEffect(() => {
    syncWindowHeight()
  }, [
    sourceText,
    targetText,
    status,
    errorMessage,
    syncWindowHeight,
    isVocabReviewVisible,
    vocabFlashcardState,
    vocabFlashcardIndex,
    displayedSentenceSyntax,
    syntaxLoadingPairId,
    wordLookup
  ])

  // 阅读区从 display:none 恢复后，等布局完成再测量输入框与窗口高度
  useLayoutEffect(() => {
    if (isReviewActive) return

    let firstFrame = 0
    let secondFrame = 0
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        syncWindowHeightRef.current()
      })
    })

    return () => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [isReviewActive, primaryView])

  // 先提交窗口宽度，再分两帧启动左栏动画；动画结束后统一补做高度校准
  useEffect(() => {
    let resizeFrame = 0
    let revealFrame = 0
    let cancelled = false

    if (structureLayoutTransitionTimerRef.current !== null) {
      window.clearTimeout(structureLayoutTransitionTimerRef.current)
      structureLayoutTransitionTimerRef.current = null
    }

    void window.api
      .setWindowLayout(useStructureWindowLayout ? 'learning' : 'normal', isReviewActive)
      .then(() => {
        if (cancelled) return

        resizeFrame = window.requestAnimationFrame(() => {
          if (cancelled) return

          if (!useStructureWindowLayout) {
            isStructureLayoutTransitioningRef.current = false
            syncWindowHeightRef.current()
            return
          }

          // 第二个绘制帧确保 560px 视口已经生效，再让左栏从零透明度开始播放
          revealFrame = window.requestAnimationFrame(() => {
            if (cancelled) return
            setIsStructureLayoutReady(true)
            structureLayoutTransitionTimerRef.current = window.setTimeout(() => {
              structureLayoutTransitionTimerRef.current = null
              isStructureLayoutTransitioningRef.current = false
              syncWindowHeightRef.current()
            }, STRUCTURE_LAYOUT_TRANSITION_MS)
          })
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[renderer] 切换窗口布局失败', error)
        isStructureLayoutTransitioningRef.current = false
        syncWindowHeightRef.current()
      })

    return () => {
      cancelled = true
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
      if (revealFrame) window.cancelAnimationFrame(revealFrame)
    }
  }, [isReviewActive, useStructureWindowLayout])

  // 组件卸载时清理模型面板的退场定时器
  useEffect(() => {
    return () => {
      if (deckClosingTimerRef.current) {
        clearTimeout(deckClosingTimerRef.current)
      }
      if (vocabLibraryClosingTimerRef.current) {
        clearTimeout(vocabLibraryClosingTimerRef.current)
      }
      if (structureCollapseTimerRef.current !== null) {
        window.clearTimeout(structureCollapseTimerRef.current)
      }
      if (structureLayoutTransitionTimerRef.current !== null) {
        window.clearTimeout(structureLayoutTransitionTimerRef.current)
      }
    }
  }, [])

  // 初始加载后端持久化的大模型配置与多服务商列表
  useEffect(() => {
    window.api
      .getConfig()
      .then((cfg) => {
        if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
          setProviders(cfg.providers)
          const savedProvId = localStorage.getItem('selectedProviderId')
          const prov = pickActiveProvider(cfg.providers, [savedProvId, cfg.activeProviderId])

          if (!prov) {
            clearActiveProviderSelection()
          } else {
            setSelectedProviderId(prov.id)
            localStorage.setItem('selectedProviderId', prov.id)

            const savedModel = localStorage.getItem('selectedModel')
            const hasSavedModel = prov.models.some((m) => m.id === savedModel)
            const finalModel = hasSavedModel
              ? (savedModel as string)
              : cfg.activeModelId || prov.defaultModel || prov.models[0]?.id || ''

            setSelectedModel(finalModel)
            localStorage.setItem('selectedModel', finalModel)
          }
        }

        if (cfg.translation) {
          autoCopyRef.current = Boolean(cfg.translation.autoCopyResult)
        }
        if (typeof cfg.general?.alwaysOnTop === 'boolean') {
          setIsPinned(cfg.general.alwaysOnTop)
        }
      })
      .catch((err) => {
        console.error('[renderer] 初始化加载配置失败', err)
      })
  }, [clearActiveProviderSelection])

  // 监听偏好设置保存更新
  useEffect(() => {
    return window.api.onConfigUpdated((newCfg) => {
      if (Array.isArray(newCfg.providers) && newCfg.providers.length > 0) {
        setProviders(newCfg.providers)
        const prov = pickActiveProvider(newCfg.providers, [newCfg.activeProviderId])

        if (!prov) {
          // 设置页把所有渠道都停用了：清空选择，别让主界面继续挂着旧渠道和旧模型名
          clearActiveProviderSelection()
        } else {
          setSelectedProviderId(prov.id)
          localStorage.setItem('selectedProviderId', prov.id)

          const finalModel = newCfg.activeModelId || prov.defaultModel || prov.models[0]?.id || ''
          setSelectedModel(finalModel)
          localStorage.setItem('selectedModel', finalModel)
        }
      }

      if (newCfg.translation) {
        autoCopyRef.current = Boolean(newCfg.translation.autoCopyResult)
      }
      if (typeof newCfg.general?.alwaysOnTop === 'boolean') {
        setIsPinned(newCfg.general.alwaysOnTop)
      }
    })
  }, [clearActiveProviderSelection])

  /** 生成仅用于 IPC 请求追踪的唯一 ID，避免多个窗口或连续请求互相串流 */
  const createIpcRequestId = useCallback((scope: 'translate' | 'alignment'): string => {
    ipcRequestSequenceRef.current += 1
    return `${scope}-${Date.now()}-${ipcRequestSequenceRef.current}`
  }, [])

  /** 把渲染进程的 AbortController 连接到主进程取消通道 */
  const bindAbortCancellation = useCallback(
    (controller: AbortController, requestId: string): void => {
      controller.signal.addEventListener(
        'abort',
        () => {
          window.api.cancelTranslation(requestId)
        },
        { once: true }
      )
    },
    []
  )

  /** 立即中止主翻译与学习对齐，供输入变化、清空和截图新请求统一调用 */
  const abortActiveTranslationRequests = useCallback((): void => {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    alignmentAbortRef.current?.abort()
    alignmentAbortRef.current = null
  }, [])

  // 清除旧对齐结果，并让尚未返回的对齐请求失效
  const resetAlignment = useCallback((): void => {
    alignmentAbortRef.current?.abort()
    alignmentAbortRef.current = null
    alignmentRequestIdRef.current += 1
    wordLookupRequestIdRef.current += 1
    passiveEncounterSignatureRef.current = ''
    setAlignment(null)
    setEncounterVocabItems([])
    setActiveAlignmentPairId(null)
    setHoveredSourceWordId(null)
    setHoveredTargetWordId(null)
    setHoveredSyntaxGroupRange(null)
    setWordLookup(null)
    sentenceSyntaxRequestIdRef.current += 1
    setSentenceSyntaxByPairId({})
    setSyntaxLoadingPairId(null)
    setSyntaxErrorPairId(null)
    setSyntaxRetryToken(0)
    setSyntaxTargetPairId(null)
    attemptedSyntaxPairIdsRef.current.clear()
    sourceHitBoxesRef.current = []
    isAutoScrollingSourceRef.current = false
    isAutoScrollingResultRef.current = false
    if (autoScrollSourceTimerRef.current !== null) {
      window.clearTimeout(autoScrollSourceTimerRef.current)
      autoScrollSourceTimerRef.current = null
    }
    if (autoScrollResultTimerRef.current !== null) {
      window.clearTimeout(autoScrollResultTimerRef.current)
      autoScrollResultTimerRef.current = null
    }
    if (sourceInputRef.current) sourceInputRef.current.style.cursor = ''
  }, [])

  const resetTranslationState = (): void => {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    setTargetText('')
    setErrorMessage('')
    setStatus('idle')
    resetAlignment()
  }

  // 翻译触发计数器，确保显式触发时必定驱动翻译 Effect 闭环完成
  const [translateTriggerToken, setTranslateTriggerToken] = useState(0)

  const markTranslationPending = useCallback((): void => {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    setTargetText('')
    setErrorMessage('')
    setStatus('translating')
    resetAlignment()
    setTranslateTriggerToken((prev) => prev + 1)
  }, [resetAlignment])

  // 监听主进程的 OCR 阶段状态：识别期间界面要有反馈，
  // 否则全新安装首次截图要等 30~60s（模型编译），用户只会以为应用卡死
  useEffect(() => {
    return window.api.onOcrStatus((next) => {
      if (next.phase === 'pending') {
        // 截图翻译从按下快捷键就开始抢占当前会话，旧译文请求不应继续消耗 Token
        abortActiveTranslationRequests()
        requestIdRef.current += 1
        setTargetText('')
        resetAlignment()
      }

      // 新一轮识别开始时清掉上一轮的「较慢」提示（在事件回调里重置，
      // 避免在 effect 体内同步 setState 触发级联渲染）
      setOcrSlowHint(false)
      setIsRecognizing(next.phase === 'pending')

      if (next.phase === 'error') {
        setErrorMessage(next.message)
        setStatus('error')
      }
    })
  }, [abortActiveTranslationRequests, resetAlignment])

  // 识别超过 4 秒仍无结果时补一句说明：全新安装的首次识别要现场编译
  // Vision 模型（实测 30~60s），这属于预期行为而不是卡死，提前讲清楚
  useEffect(() => {
    if (!isRecognizing) return
    const timer = window.setTimeout(() => setOcrSlowHint(true), 4000)
    return () => window.clearTimeout(timer)
  }, [isRecognizing])

  // 监听截图 OCR 提取出的文本并自动填充触发翻译
  useEffect(() => {
    return window.api.onApplySourceText((recognizedText) => {
      // 识别完成时先离开复习，确保新译文和输入内容立即可见
      restoreViewBeforeReview()
      const trimmed = recognizedText.trim()
      if (!trimmed) {
        abortActiveTranslationRequests()
        setErrorMessage('截图未识别到文字内容')
        setStatus('idle')
        return
      }

      abortActiveTranslationRequests()
      setSourceText(recognizedText)
      setErrorMessage('')
      markTranslationPending()
    })
  }, [abortActiveTranslationRequests, markTranslationPending, restoreViewBeforeReview])

  // 空态提示里的截图快捷键：跟随用户在设置里自定义的键位，读不到就退回默认值
  const [screenshotShortcut, setScreenshotShortcut] = useState('Alt+S')

  useEffect(() => {
    const applyShortcut = (next: ShortcutSettings | undefined): void => {
      setScreenshotShortcut(next?.screenshot || 'Alt+S')
    }

    window.api
      .getConfig()
      .then((cfg) => applyShortcut(cfg.shortcuts))
      .catch((err) => console.error('[renderer] 读取截图快捷键失败', err))

    return window.api.onConfigUpdated((cfg) => applyShortcut(cfg.shortcuts))
  }, [])
  // 监听多浮层外部点击与 Esc 按键关闭
  useEffect(() => {
    if (!isModelMenuOpen && !isSourceLangMenuOpen && !isTargetLangMenuOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        isModelMenuOpen &&
        !modelSelectorRef.current?.contains(target) &&
        !engineDeckRef.current?.contains(target)
      ) {
        closeModelMenu()
      }
      if (isSourceLangMenuOpen && !sourceLangSelectorRef.current?.contains(target)) {
        setIsSourceLangMenuOpen(false)
      }
      if (isTargetLangMenuOpen && !targetLangSelectorRef.current?.contains(target)) {
        setIsTargetLangMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeModelMenu()
        setIsSourceLangMenuOpen(false)
        setIsTargetLangMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeModelMenu, isModelMenuOpen, isSourceLangMenuOpen, isTargetLangMenuOpen])

  // 源语言选择持久化
  useEffect(() => {
    localStorage.setItem('sourceLanguage', sourceLanguage)
  }, [sourceLanguage])

  // 只持久化翻译或学习；复习是临时主视图，重启后回到最近一次正式模式
  useEffect(() => {
    if (primaryView === 'review') return
    localStorage.setItem('learningMode', primaryView === 'learn' ? '1' : '0')
  }, [primaryView])

  // 已收藏词标记偏好持久化；关闭时只收起视觉标记，避免同一段文本重复累计偶遇次数
  useEffect(() => {
    localStorage.setItem('showCollectedWordMarks', showCollectedWordMarks ? '1' : '0')
    if (showCollectedWordMarks) return

    setWordLookup((current) => (current?.origin === 'encounter' ? null : current))
  }, [showCollectedWordMarks])

  // 手动目标语言选择持久化
  useEffect(() => {
    if (manualTargetLang) {
      localStorage.setItem('targetLanguage', manualTargetLang)
    } else {
      localStorage.removeItem('targetLanguage')
    }
  }, [manualTargetLang])

  // 核心翻译流程：基于动态检测的源语言与自适应目标语言触发模型翻译
  useEffect(() => {
    const trimmedSourceText = sourceText.trim()
    if (!trimmedSourceText) {
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      return
    }

    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current
    const effectiveSourcePrompt = resolvePromptLanguage(sourceLanguage, detectedInfo.detected)
    const effectiveTargetPrompt = getLanguageInfo(effectiveTargetLang).promptName
    const controller = new AbortController()
    const ipcRequestId = createIpcRequestId('translate')

    // 新输入一出现就取消旧流，即使旧响应晚到也会被请求代次校验丢弃
    translationAbortRef.current?.abort()
    translationAbortRef.current = controller
    alignmentAbortRef.current?.abort()
    alignmentAbortRef.current = null
    bindAbortCancellation(controller, ipcRequestId)

    let pendingFrame: number | null = null
    let streamedText = ''
    let requestStarted = false
    let requestSettled = false

    // 防抖处理，避免频繁调用翻译接口
    const timer = window.setTimeout(async () => {
      if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

      // 没有启用的渠道就直接给反馈：空 providerId 会在主进程里回落到配置里的默认渠道，
      // 那可能正是用户刚停用的那个，等于"停用了却还在用"
      if (!selectedProviderId || !selectedModel) {
        setTargetText('')
        resetAlignment()
        setErrorMessage('还没有启用任何服务商，请先在偏好设置里启用一个')
        setStatus('error')
        return
      }

      requestStarted = true
      setTargetText('')
      setErrorMessage('')

      try {
        const response = await window.api.translateTextStream(
          ipcRequestId,
          {
            text: sourceText,
            sourceLanguage: effectiveSourcePrompt,
            targetLanguage: effectiveTargetPrompt,
            options: {
              providerId: selectedProviderId,
              model: selectedModel
            }
          },
          (delta) => {
            if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

            streamedText += delta
            // 高频 token 按动画帧合并刷新，既保持实时感，也避免每个分片都触发整棵组件树更新
            if (pendingFrame !== null) return
            pendingFrame = window.requestAnimationFrame(() => {
              pendingFrame = null
              if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return
              setTargetText(streamedText)
            })
          }
        )

        if (pendingFrame !== null) {
          window.cancelAnimationFrame(pendingFrame)
          pendingFrame = null
        }
        if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

        if (response.ok) {
          resetAlignment()
          setTargetText(response.text)
          setErrorMessage('')
          setStatus('idle')

          if (autoCopyRef.current && response.text.trim()) {
            void navigator.clipboard
              .writeText(response.text)
              .then(() => {
                setCopyState('done')
              })
              .catch((copyErr) => {
                console.warn('[renderer] 自动复制剪贴板失败:', copyErr)
              })
          }
          return
        }

        if (response.error.code === 'ABORTED') return

        setTargetText('')
        resetAlignment()
        setErrorMessage(getUserFriendlyErrorMessage(response.error.code))
        console.error('[renderer] translate error', response.error.code, response.error.message)
        setStatus('error')
      } catch (error) {
        if (pendingFrame !== null) {
          window.cancelAnimationFrame(pendingFrame)
          pendingFrame = null
        }
        if (currentRequestId !== requestIdRef.current || controller.signal.aborted) return

        console.error('[renderer] 翻译请求异常', error)
        setTargetText('')
        resetAlignment()
        setErrorMessage('翻译失败，请重试')
        setStatus('error')
      } finally {
        requestSettled = true
        if (translationAbortRef.current === controller) {
          translationAbortRef.current = null
        }
      }
    }, 500)

    return () => {
      window.clearTimeout(timer)
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame)
      }
      // 尚未真正发出的防抖请求无需取消；已发出的流必须在输入变化时立刻中止
      if (requestStarted && !requestSettled) controller.abort()
      if (translationAbortRef.current === controller) {
        translationAbortRef.current = null
      }
    }
  }, [
    bindAbortCancellation,
    createIpcRequestId,
    selectedProviderId,
    selectedModel,
    sourceText,
    sourceLanguage,
    effectiveTargetLang,
    detectedInfo.detected,
    translateTriggerToken,
    resetAlignment
  ])

  // 译文完成后再独立请求一次编号对齐，主翻译结果此时已经可见且不会被改写
  useEffect(() => {
    if (
      !isLearningActive ||
      status !== 'idle' ||
      !sourceText.trim() ||
      !targetText.trim() ||
      !selectedProviderId ||
      !selectedModel
    ) {
      return
    }

    const effectiveSourcePrompt = resolvePromptLanguage(sourceLanguage, detectedInfo.detected)
    const effectiveTargetPrompt = getLanguageInfo(effectiveTargetLang).promptName
    const alignmentCacheKey = JSON.stringify([
      ALIGNMENT_CACHE_VERSION,
      sourceText,
      targetText,
      effectiveSourcePrompt,
      effectiveTargetPrompt,
      selectedProviderId,
      selectedModel
    ])

    const currentAlignmentRequestId = alignmentRequestIdRef.current + 1
    alignmentRequestIdRef.current = currentAlignmentRequestId
    const controller = new AbortController()
    const ipcRequestId = createIpcRequestId('alignment')

    // 新的对齐任务启动前先取消旧任务，避免切换模型或文本后旧结果回填
    alignmentAbortRef.current?.abort()
    alignmentAbortRef.current = controller
    bindAbortCancellation(controller, ipcRequestId)

    let requestStarted = false
    let requestSettled = false

    const timer = window.setTimeout(async () => {
      if (
        currentAlignmentRequestId !== alignmentRequestIdRef.current ||
        controller.signal.aborted
      ) {
        return
      }

      const cachedAlignment = alignmentCacheRef.current.get(alignmentCacheKey)
      if (cachedAlignment) {
        setAlignment(cachedAlignment)
        setActiveAlignmentPairId(null)
        console.info('[renderer] 复用学习模式对齐缓存')
        return
      }

      try {
        requestStarted = true
        const response = await window.api.alignText(ipcRequestId, {
          sourceText,
          targetText,
          sourceLanguage: effectiveSourcePrompt,
          targetLanguage: effectiveTargetPrompt,
          options: {
            providerId: selectedProviderId,
            model: selectedModel
          }
        })

        if (
          currentAlignmentRequestId !== alignmentRequestIdRef.current ||
          controller.signal.aborted
        ) {
          return
        }

        if (response.ok) {
          alignmentCacheRef.current.delete(alignmentCacheKey)
          alignmentCacheRef.current.set(alignmentCacheKey, response.alignment)
          if (alignmentCacheRef.current.size > MAX_ALIGNMENT_CACHE_ENTRIES) {
            const oldestKey = alignmentCacheRef.current.keys().next().value
            if (oldestKey) alignmentCacheRef.current.delete(oldestKey)
          }

          setAlignment(response.alignment)
          setActiveAlignmentPairId(null)
          return
        }

        if (response.error.code === 'ABORTED') return

        setAlignment(null)
        console.info('[renderer] 悬停关联未启用:', response.error.code, response.error.message)
      } catch (error) {
        if (
          currentAlignmentRequestId !== alignmentRequestIdRef.current ||
          controller.signal.aborted
        ) {
          return
        }
        setAlignment(null)
        console.warn('[renderer] 文本对齐请求失败，译文不受影响:', error)
      } finally {
        requestSettled = true
        if (alignmentAbortRef.current === controller) {
          alignmentAbortRef.current = null
        }
      }
    }, 160)

    return () => {
      window.clearTimeout(timer)
      if (requestStarted && !requestSettled) controller.abort()
      if (alignmentAbortRef.current === controller) {
        alignmentAbortRef.current = null
      }
      if (alignmentRequestIdRef.current === currentAlignmentRequestId) {
        alignmentRequestIdRef.current += 1
      }
    }
  }, [
    bindAbortCancellation,
    createIpcRequestId,
    sourceText,
    targetText,
    status,
    selectedProviderId,
    selectedModel,
    sourceLanguage,
    effectiveTargetLang,
    detectedInfo.detected,
    isLearningActive
  ])

  // 翻译完成后批量检查英文文本中的已收录词；同一次翻译只累计一次被动偶遇
  useEffect(() => {
    if (
      !isLearningActive ||
      !learningHighlightSide ||
      !showCollectedWordMarks ||
      status !== 'idle' ||
      !sourceText.trim() ||
      !targetText.trim()
    ) {
      return
    }

    const englishText = learningHighlightSide === 'source' ? sourceText : targetText
    const signature = `${learningHighlightSide}\u0000${englishText}`
    if (passiveEncounterSignatureRef.current === signature) return
    passiveEncounterSignatureRef.current = signature

    let cancelled = false

    const loadPassiveEncounters = async (): Promise<void> => {
      const words = collectUniqueEnglishWords(englishText)
      const wordItems = await getVocabItemsByWordForms(words)
      const itemByLemma = new Map<string, VocabItem>()
      for (const item of wordItems) {
        itemByLemma.set(item.lemmaLower, item)
      }

      const matchedItems = Array.from(itemByLemma.values()).filter(
        (item) => findVocabTextMatches(englishText, [item], { includePhrases: false }).length > 0
      )
      if (matchedItems.length === 0) {
        if (!cancelled) setEncounterVocabItems([])
        return
      }

      const updatedItems = await incrementPassiveVocabEncounters(
        matchedItems.map((item) => item.lemmaLower)
      )
      if (cancelled) return

      setEncounterVocabItems(updatedItems)
    }

    void loadPassiveEncounters().catch((error) => {
      if (cancelled) return
      // 本地库不可用时只放弃偶遇标识，不影响翻译主流程
      console.warn('[renderer] 读取生词偶遇数据失败:', error)
      passiveEncounterSignatureRef.current = ''
    })

    return () => {
      cancelled = true
    }
  }, [
    isLearningActive,
    learningHighlightSide,
    showCollectedWordMarks,
    sourceText,
    status,
    targetText
  ])

  // 进入复习子视图时随机准备一组带语境的生词闪卡
  useEffect(() => {
    if (!isVocabReviewVisible) {
      vocabFlashcardsRef.current = []
      vocabFlashcardIndexRef.current = 0
      setVocabFlashcards([])
      setVocabFlashcardIndex(0)
      setVocabFlashcardState('hidden')
      return
    }

    let cancelled = false
    vocabFlashcardsRef.current = []
    vocabFlashcardIndexRef.current = 0
    setVocabFlashcards([])
    setVocabFlashcardIndex(0)
    setVocabFlashcardState('loading')

    void getVocabFlashcards(VOCAB_FLASHCARD_LIMIT)
      .then((flashcards) => {
        if (cancelled) return
        vocabFlashcardsRef.current = flashcards
        vocabFlashcardIndexRef.current = 0
        setVocabFlashcards(flashcards)
        setVocabFlashcardState(flashcards.length > 0 ? 'ready' : 'empty')
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[renderer] 读取生词闪卡失败:', error)
        setVocabFlashcardState('empty')
      })

    return () => {
      cancelled = true
    }
  }, [isVocabReviewVisible])

  /** 同步闪卡编号到 ref，保证连续移出时读取的不是上一次渲染的旧位置 */
  const handleVocabFlashcardIndexChange = useCallback((nextIndex: number): void => {
    vocabFlashcardIndexRef.current = nextIndex
    setVocabFlashcardIndex(nextIndex)
  }, [])

  /** 从“我的生词”覆盖层移出词条，并同步更新复习队列与唯一词数 */
  const handleRemoveVocabLibraryItem = useCallback(
    async (item: VocabItem): Promise<void> => {
      const lemmaLower = normalizeVocabLemma(item.lemma)
      if (!lemmaLower || vocabRemovalInFlightRef.current.has(lemmaLower)) return

      vocabRemovalInFlightRef.current.add(lemmaLower)
      setRemovingVocabLemmaLowers((current) => new Set(current).add(lemmaLower))

      try {
        const removed = await removeVocabItem(item.lemma)
        if (!removed) return

        setVocabLibraryItems((current) =>
          current.filter((candidate) => candidate.lemmaLower !== lemmaLower)
        )

        const nextQueue = removeVocabFlashcardFromQueue(
          vocabFlashcardsRef.current,
          vocabFlashcardIndexRef.current,
          lemmaLower
        )
        vocabFlashcardsRef.current = nextQueue.cards
        vocabFlashcardIndexRef.current = nextQueue.activeIndex
        setVocabFlashcards(nextQueue.cards)
        setVocabFlashcardIndex(nextQueue.activeIndex)
        setVocabFlashcardState(nextQueue.cards.length > 0 ? 'ready' : 'empty')

        setEncounterVocabItems((current) =>
          current.filter((candidate) => candidate.lemmaLower !== lemmaLower)
        )

        const nextCount = await getVocabItemCount()
        setVocabItemCount(nextCount)
        if (nextCount === 0) {
          // 最后一条被移出后直接回到复习空态，避免空白覆盖层挡住结果
          closeVocabLibrary()
        }
      } catch (error) {
        console.warn('[renderer] 从生词列表移除词条失败:', error)
      } finally {
        vocabRemovalInFlightRef.current.delete(lemmaLower)
        setRemovingVocabLemmaLowers((current) => {
          const next = new Set(current)
          next.delete(lemmaLower)
          return next
        })
      }
    },
    [closeVocabLibrary]
  )

  /** 同步透明测量层尺寸与滚动位置，并缓存单词与整句的屏幕命中矩形 */
  const measureSourceHitBoxes = useCallback((): void => {
    const textarea = sourceInputRef.current
    const mirror = sourceMirrorRef.current
    if (!textarea || !mirror || !alignment) {
      sourceHitBoxesRef.current = []
      return
    }

    mirror.style.width = `${textarea.clientWidth}px`
    mirror.style.height = `${textarea.clientHeight}px`
    // 命中框统一按未滚动的“内容坐标”保存，悬停时再叠加 textarea.scrollTop
    mirror.scrollTop = 0

    const hitBoxes: SourceHitBox[] = []

    // 已收录词优先于普通单词命中，确保点击时直接读取本地释义
    const encounterElements = mirror.querySelectorAll<HTMLElement>('[data-source-encounter-id]')
    for (const element of encounterElements) {
      const encounterId = element.dataset.sourceEncounterId
      if (!encounterId) continue

      const range = document.createRange()
      range.selectNodeContents(element)
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0
      )
      if (rects.length > 0) {
        hitBoxes.push({ kind: 'encounter', id: encounterId, rects })
      }
    }

    // 所有英文词都建立独立命中区，鼠标落在具体单词上时不退回整句
    const wordElements = mirror.querySelectorAll<HTMLElement>('[data-source-word-id]')
    for (const element of wordElements) {
      const wordId = element.dataset.sourceWordId
      if (!wordId) continue

      const range = document.createRange()
      range.selectNodeContents(element)
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0
      )

      if (rects.length > 0) hitBoxes.push({ kind: 'word', id: wordId, rects })
    }

    sourceHitBoxesRef.current = hitBoxes
    mirror.scrollTop = textarea.scrollTop
  }, [alignment])

  useLayoutEffect(() => {
    if (!alignment) {
      sourceHitBoxesRef.current = []
      return
    }

    const frame = window.requestAnimationFrame(measureSourceHitBoxes)
    return () => window.cancelAnimationFrame(frame)
  }, [alignment, encounterWordView, measureSourceHitBoxes, sourceWordView])

  useEffect(() => {
    if (!alignment) return

    const textarea = sourceInputRef.current
    if (!textarea) return

    const observer = new ResizeObserver(() => measureSourceHitBoxes())
    observer.observe(textarea)
    window.addEventListener('resize', measureSourceHitBoxes)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureSourceHitBoxes)
    }
  }, [alignment, encounterWordView, measureSourceHitBoxes, sourceWordView])

  useEffect(() => {
    return () => {
      if (sourceHoverFrameRef.current !== null) {
        window.cancelAnimationFrame(sourceHoverFrameRef.current)
      }
      if (autoScrollSourceTimerRef.current !== null) {
        window.clearTimeout(autoScrollSourceTimerRef.current)
      }
      if (autoScrollResultTimerRef.current !== null) {
        window.clearTimeout(autoScrollResultTimerRef.current)
      }
      if (sourceScrollSyncTimerRef.current !== null) {
        window.clearTimeout(sourceScrollSyncTimerRef.current)
      }
      if (resultScrollSyncTimerRef.current !== null) {
        window.clearTimeout(resultScrollSyncTimerRef.current)
      }
    }
  }, [])

  /** 关闭词义卡，并让尚未返回的旧查询自动失效 */
  const closeWordLookup = useCallback((): void => {
    wordLookupRequestIdRef.current += 1
    setWordLookup(null)
    setActiveAlignmentPairId(null)
    setHoveredSourceWordId(null)
    setHoveredTargetWordId(null)
  }, [])

  /** 允许用户在结构分析失败后主动重试，而不是等待不存在的自动重试 */
  const handleRetrySentenceSyntax = (): void => {
    if (!syntaxTargetPairId) return

    attemptedSyntaxPairIdsRef.current.delete(syntaxTargetPairId)
    setSyntaxErrorPairId(null)
    setSyntaxRetryToken((current) => current + 1)
  }

  /** 写入单词查询缓存，并按最近使用顺序淘汰旧条目 */
  const cacheWordLookupResult = useCallback((cacheKey: string, result: WordLookupResult): void => {
    const cache = wordLookupCacheRef.current
    cache.delete(cacheKey)
    cache.set(cacheKey, result)

    if (cache.size > MAX_WORD_LOOKUP_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value
      if (oldestKey) cache.delete(oldestKey)
    }
  }, [])

  /** 把新收录或计数更新后的词条同步到当前英文文本的偶遇标识 */
  const upsertEncounterVocabItem = useCallback(
    (item: VocabItem, side: WordLookupSide): void => {
      if (learningHighlightSide !== side) return

      setEncounterVocabItems((current) => {
        const index = current.findIndex((entry) => entry.lemmaLower === item.lemmaLower)
        if (index < 0) return [...current, item]

        const next = [...current]
        next[index] = item
        return next
      })
    },
    [learningHighlightSide]
  )

  /**
   * 主动查词成功后写入本地词库。
   * 句级上下文始终由 pairId 还原，避免只保存当前分段而丢失完整语义。
   */
  const persistLookupData = useCallback(
    async (params: {
      lookupAnchorId: string
      pairId: string
      side: WordLookupSide
      surface: string
      result: WordLookupResult
      note?: string
    }): Promise<VocabItem | null> => {
      const persistenceKey = [
        params.lookupAnchorId,
        params.side,
        params.pairId,
        params.result.lemma.trim().toLowerCase(),
        params.surface.trim().toLowerCase()
      ].join('\u0000')
      if (persistenceInFlightRef.current.has(persistenceKey)) return null

      if (!alignment || !learningHighlightSide || params.side !== learningHighlightSide) {
        setWordLookup((current) =>
          current &&
          current.lookupAnchorId === params.lookupAnchorId &&
          current.side === params.side
            ? {
                ...current,
                isPersisted: false,
                isPersisting: false,
                canPersist: true,
                isCheckingPersistence: false
              }
            : current
        )
        return null
      }

      const pairSentences = getAlignmentPairSentences(
        alignment,
        sourceText,
        targetText,
        params.pairId,
        learningHighlightSide
      )
      if (!pairSentences?.englishSentence || !pairSentences.chineseSentence) {
        setWordLookup((current) =>
          current &&
          current.lookupAnchorId === params.lookupAnchorId &&
          current.side === params.side
            ? {
                ...current,
                isPersisted: false,
                isPersisting: false,
                canPersist: true,
                isCheckingPersistence: false
              }
            : current
        )
        return null
      }

      persistenceInFlightRef.current.add(persistenceKey)
      setWordLookup((current) =>
        current && current.lookupAnchorId === params.lookupAnchorId && current.side === params.side
          ? {
              ...current,
              isPersisting: true,
              isPersisted: false,
              canPersist: false,
              isCheckingPersistence: false
            }
          : current
      )

      try {
        const item = await recordVocabEncounter({
          lemma: params.result.lemma,
          kind: params.result.kind,
          surface: params.surface,
          ...(params.result.literalMeaning ? { literalMeaning: params.result.literalMeaning } : {}),
          meaning: params.result.meaning,
          ...(params.result.contextNote ? { contextNote: params.result.contextNote } : {}),
          ...(params.result.wordOrderNote ? { wordOrderNote: params.result.wordOrderNote } : {}),
          targetText: params.result.targetText,
          ...(params.note ? { note: params.note } : {}),
          side: params.side,
          englishSentence: pairSentences.englishSentence,
          chineseSentence: pairSentences.chineseSentence
        })

        upsertEncounterVocabItem(item, params.side)
        refreshVocabItemCount()
        setWordLookup((current) =>
          current &&
          current.lookupAnchorId === params.lookupAnchorId &&
          current.side === params.side
            ? {
                ...current,
                encounterCount: item.encounterCount,
                isPersisted: true,
                isPersisting: false,
                canPersist: false,
                isCheckingPersistence: false
              }
            : current
        )
        return item
      } catch (error) {
        console.warn('[renderer] 写入本地生词库失败:', error)
        setWordLookup((current) =>
          current &&
          current.lookupAnchorId === params.lookupAnchorId &&
          current.side === params.side
            ? {
                ...current,
                isPersisted: false,
                isPersisting: false,
                canPersist: true,
                isCheckingPersistence: false
              }
            : current
        )
        return null
      } finally {
        persistenceInFlightRef.current.delete(persistenceKey)
      }
    },
    [
      alignment,
      learningHighlightSide,
      refreshVocabItemCount,
      sourceText,
      targetText,
      upsertEncounterVocabItem
    ]
  )

  /** 二次偶遇高亮直接展示本地数据，不发起任何模型请求 */
  const showEncounterLookup = useCallback(
    (match: EncounterVocabHighlight, position: WordLookupPosition): void => {
      wordLookupRequestIdRef.current += 1
      setActiveAlignmentPairId(match.pairId)
      const pairSentences = alignment
        ? getAlignmentPairSentences(
            alignment,
            sourceText,
            targetText,
            match.pairId,
            learningHighlightSide
          )
        : null
      const correspondingSentence =
        match.side === 'source' ? pairSentences?.targetSentence : pairSentences?.sourceSentence
      const contextualTargetText =
        match.item.targetText && correspondingSentence?.includes(match.item.targetText)
          ? match.item.targetText
          : ''

      if (match.side === 'source') {
        setHoveredSourceWordId(null)
        setHoveredTargetWordId(null)
        scrollResultToPair(match.pairId)
      } else {
        setHoveredSourceWordId(null)
        setHoveredTargetWordId(null)
        scrollSourceToPair(match.pairId)
      }

      setWordLookup({
        ...position,
        lookupText: match.surface,
        lookupAnchorId: match.id,
        pairId: match.pairId,
        side: match.side,
        status: 'ready',
        origin: 'encounter',
        result: {
          kind: match.item.kind ?? 'lexical',
          lemma: match.item.lemma,
          ...(match.item.literalMeaning ? { literalMeaning: match.item.literalMeaning } : {}),
          meaning: match.item.meaning,
          ...(match.item.contextNote ? { contextNote: match.item.contextNote } : {}),
          ...(match.item.wordOrderNote ? { wordOrderNote: match.item.wordOrderNote } : {}),
          targetText: contextualTargetText
        },
        note: match.item.note,
        encounterCount: match.item.encounterCount,
        isPersisted: true,
        canPersist: false
      })
    },
    [
      alignment,
      learningHighlightSide,
      scrollResultToPair,
      scrollSourceToPair,
      sourceText,
      targetText
    ]
  )

  /** 对用户点击的英文词发起单点上下文查词 */
  const requestContextualWordLookup = useCallback(
    (params: {
      word: string
      anchorId: string
      side: WordLookupSide
      pairId: string
      sourceSentence: string
      targetSentence: string
      position: WordLookupPosition
    }): void => {
      const sourceLanguagePrompt = resolvePromptLanguage(sourceLanguage, detectedInfo.detected)
      const targetLanguagePrompt = getLanguageInfo(effectiveTargetLang).promptName
      const cacheKey = JSON.stringify([
        selectedProviderId,
        selectedModel,
        sourceLanguagePrompt,
        targetLanguagePrompt,
        params.side,
        params.word.toLowerCase(),
        params.sourceSentence,
        params.targetSentence
      ])
      const requestId = wordLookupRequestIdRef.current + 1
      wordLookupRequestIdRef.current = requestId

      setActiveAlignmentPairId(params.pairId)
      if (params.side === 'source') {
        setHoveredSourceWordId(params.anchorId)
        setHoveredTargetWordId(null)
        scrollResultToPair(params.pairId)
      } else {
        setHoveredSourceWordId(null)
        setHoveredTargetWordId(params.anchorId)
        scrollSourceToPair(params.pairId)
      }

      setWordLookup({
        ...params.position,
        lookupText: params.word,
        lookupAnchorId: params.anchorId,
        side: params.side,
        pairId: params.pairId,
        status: 'loading'
      })

      const applyReadyResult = (
        result: WordLookupResult,
        origin: 'database' | 'llm',
        options?: {
          encounterCount?: number
          note?: string
          isPersisted?: boolean
        }
      ): void => {
        if (wordLookupRequestIdRef.current !== requestId) return
        setWordLookup({
          ...params.position,
          lookupText: params.word,
          lookupAnchorId: params.anchorId,
          side: params.side,
          pairId: params.pairId,
          status: 'ready',
          origin,
          result,
          encounterCount: options?.encounterCount,
          isPersisted: Boolean(options?.isPersisted),
          canPersist: !options?.isPersisted,
          isPersisting: false,
          isCheckingPersistence: false,
          ...(options?.note ? { note: options.note } : {})
        })
      }

      void (async () => {
        // 先查 IndexedDB：命中后直接展示已有释义，避免消耗额外 Token
        let cachedItem: VocabItem | null = null
        try {
          cachedItem = await findCachedVocab(params.word)
        } catch (error) {
          console.warn('[renderer] 读取本地词库失败，继续请求模型:', error)
        }
        if (wordLookupRequestIdRef.current !== requestId) return

        if (cachedItem) {
          const correspondingSentence =
            params.side === 'source' ? params.targetSentence : params.sourceSentence
          const contextualTargetText =
            cachedItem.targetText && correspondingSentence.includes(cachedItem.targetText)
              ? cachedItem.targetText
              : ''
          applyReadyResult(
            {
              kind: cachedItem.kind ?? 'lexical',
              lemma: cachedItem.lemma,
              ...(cachedItem.literalMeaning ? { literalMeaning: cachedItem.literalMeaning } : {}),
              meaning: cachedItem.meaning,
              ...(cachedItem.contextNote ? { contextNote: cachedItem.contextNote } : {}),
              ...(cachedItem.wordOrderNote ? { wordOrderNote: cachedItem.wordOrderNote } : {}),
              targetText: contextualTargetText
            },
            'database',
            {
              encounterCount: cachedItem.encounterCount,
              note: cachedItem.note,
              isPersisted: true
            }
          )
          return
        }

        const cachedResult = wordLookupCacheRef.current.get(cacheKey)
        if (cachedResult) {
          cacheWordLookupResult(cacheKey, cachedResult)
          applyReadyResult(cachedResult, 'llm')
          return
        }

        const response = await window.api.lookupWord({
          word: params.word,
          sourceSentence: params.sourceSentence,
          targetSentence: params.targetSentence,
          wordSide: params.side,
          sourceLanguage: sourceLanguagePrompt,
          targetLanguage: targetLanguagePrompt,
          options: {
            providerId: selectedProviderId,
            model: selectedModel
          }
        })
        if (wordLookupRequestIdRef.current !== requestId) return

        if (!response.ok) {
          setWordLookup((current) =>
            current
              ? {
                  ...current,
                  status: 'error',
                  canPersist: false,
                  errorMessage: getWordLookupErrorMessage(response.error.code)
                }
              : current
          )
          return
        }

        cacheWordLookupResult(cacheKey, response.result)
        applyReadyResult(response.result, 'llm')
      })().catch((error) => {
        if (wordLookupRequestIdRef.current !== requestId) return
        console.warn('[renderer] 单词释义查询失败:', error)
        setWordLookup((current) =>
          current
            ? {
                ...current,
                status: 'error',
                canPersist: false,
                errorMessage: '释义查询失败，请稍后再试'
              }
            : current
        )
      })
    },
    [
      cacheWordLookupResult,
      detectedInfo.detected,
      effectiveTargetLang,
      scrollResultToPair,
      scrollSourceToPair,
      selectedModel,
      selectedProviderId,
      sourceLanguage
    ]
  )

  /** 鼠标在原生输入框上移动时只更新单词命中，不再联动译文对应关系 */
  const handleSourceMouseMove = (event: React.MouseEvent<HTMLTextAreaElement>): void => {
    const textarea = event.currentTarget
    if (!alignment) {
      textarea.style.cursor = ''
      return
    }

    const pointerX = event.clientX
    // 命中框存的是未滚动内容坐标，这里把鼠标位置换算到同一坐标系
    const pointerY = event.clientY + textarea.scrollTop

    if (sourceHoverFrameRef.current !== null) {
      window.cancelAnimationFrame(sourceHoverFrameRef.current)
    }

    sourceHoverFrameRef.current = window.requestAnimationFrame(() => {
      sourceHoverFrameRef.current = null
      let nextWordId: string | null = null
      let nextEncounterId: string | null = null
      let bestVerticalDistance = Number.POSITIVE_INFINITY
      let bestPriority = Number.POSITIVE_INFINITY

      for (const hitBox of sourceHitBoxesRef.current) {
        for (const rect of hitBox.rects) {
          if (pointerX < rect.left - 2 || pointerX > rect.right + 2) continue

          const verticalDistance =
            pointerY < rect.top
              ? rect.top - pointerY
              : pointerY > rect.bottom
                ? pointerY - rect.bottom
                : 0
          if (verticalDistance > 4) continue

          const priority = hitBox.kind === 'encounter' ? 0 : 1
          if (
            verticalDistance > bestVerticalDistance ||
            (verticalDistance === bestVerticalDistance && priority >= bestPriority)
          ) {
            continue
          }

          bestVerticalDistance = verticalDistance
          bestPriority = priority
          if (hitBox.kind === 'encounter') {
            nextEncounterId = hitBox.id
            nextWordId = null
          } else {
            nextEncounterId = null
            nextWordId = hitBox.id
          }
        }
      }

      setHoveredSourceWordId(nextWordId)
      textarea.style.cursor = nextWordId || nextEncounterId ? 'pointer' : 'text'
    })
  }

  /** 点击原文时查询光标下的普通英文词 */
  const handleSourceClick = (event: React.MouseEvent<HTMLTextAreaElement>): void => {
    const textarea = event.currentTarget
    if (
      !isLearningActive ||
      !alignment ||
      !alignmentView ||
      textarea.selectionStart !== textarea.selectionEnd
    ) {
      return
    }

    const clickOffset = textarea.selectionStart
    const selection = findEnglishWordAtOffset(sourceText, clickOffset)
    // 语法缩写即使落在旧短语匹配范围里，也必须允许用户单独点选。
    const preferStandaloneGrammarWord = selection ? isGrammarContraction(selection.text) : false
    const clickedEncounter =
      (preferStandaloneGrammarWord
        ? undefined
        : encounterWordView?.highlights.find(
            (encounter) => clickOffset >= encounter.start && clickOffset < encounter.end
          )) ??
      (preferStandaloneGrammarWord
        ? undefined
        : encounterWordView?.highlights.find((encounter) => clickOffset === encounter.end))
    if (clickedEncounter) {
      showEncounterLookup(clickedEncounter, getWordLookupPosition(event.clientX, event.clientY))
      return
    }

    if (!selection || !sourceWordView) {
      const clickedSegment = alignment.sourceSegments.find(
        (segment) => clickOffset >= segment.start && clickOffset < segment.end
      )
      const pairId = clickedSegment
        ? (alignmentView.sourcePairBySegmentId.get(clickedSegment.id) ?? null)
        : null
      closeWordLookup()
      if (pairId) {
        setActiveAlignmentPairId(pairId)
        setSyntaxTargetPairId(pairId)
      }
      return
    }

    const token = sourceWordView.tokens.find(
      (item) => item.start === selection.start && item.end === selection.end
    )
    const segment = alignment.sourceSegments.find(
      (item) => selection.start >= item.start && selection.end <= item.end
    )
    const pairId = segment ? (alignmentView.sourcePairBySegmentId.get(segment.id) ?? null) : null
    const pairSentences = pairId
      ? getAlignmentPairSentences(alignment, sourceText, targetText, pairId, learningHighlightSide)
      : null
    if (!token || !segment || !pairId || !pairSentences) {
      closeWordLookup()
      return
    }

    requestContextualWordLookup({
      word: token.text,
      anchorId: token.id,
      side: 'source',
      pairId,
      sourceSentence: pairSentences.sourceSentence,
      targetSentence: pairSentences.targetSentence,
      position: getWordLookupPosition(event.clientX, event.clientY)
    })
  }

  /** 鼠标离开输入区时只清理单词悬停，不改变译文触发的句对高亮 */
  const handleSourceMouseLeave = (event: React.MouseEvent<HTMLTextAreaElement>): void => {
    if (sourceHoverFrameRef.current !== null) {
      window.cancelAnimationFrame(sourceHoverFrameRef.current)
      sourceHoverFrameRef.current = null
    }
    event.currentTarget.style.cursor = ''
    setHoveredSourceWordId(null)
  }

  /** 中译英时点击译文中的普通英文词，仍走原有单点上下文查词 */
  const handleTargetWordClick = (
    token: AlignmentToken,
    pairId: string,
    event: React.MouseEvent<HTMLSpanElement>
  ): void => {
    if (!alignment || !targetWordView) return

    event.stopPropagation()
    const pairSentences = getAlignmentPairSentences(
      alignment,
      sourceText,
      targetText,
      pairId,
      learningHighlightSide
    )
    if (!pairSentences) return

    requestContextualWordLookup({
      word: token.text,
      anchorId: token.id,
      side: 'target',
      pairId,
      sourceSentence: pairSentences.sourceSentence,
      targetSentence: pairSentences.targetSentence,
      position: getWordLookupPosition(event.clientX, event.clientY)
    })
  }

  /** 译文普通词只显示轻量悬停状态，点击时才发起请求 */
  const handleTargetWordEnter = (token: AlignmentToken, pairId: string): void => {
    setActiveAlignmentPairId(pairId)
    setHoveredTargetWordId(token.id)
    scrollSourceToPair(pairId)
  }

  /** 译文中的二次偶遇词悬停只同步句对，点击后再展示本地记录 */
  const handleTargetEncounterEnter = (match: EncounterVocabHighlight): void => {
    setActiveAlignmentPairId(match.pairId)
    setHoveredTargetWordId(null)
    scrollSourceToPair(match.pairId)
  }

  const handleTargetEncounterLookup = (
    match: EncounterVocabHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ): void => {
    event.stopPropagation()
    showEncounterLookup(match, getWordLookupPosition(event.clientX, event.clientY))
  }

  /** 浮层中的收藏按钮用于把当前词义主动写入本地词库 */
  const handlePersistCurrentLookup = (): void => {
    if (
      !wordLookup?.result ||
      !wordLookup.canPersist ||
      wordLookup.isPersisted ||
      wordLookup.isPersisting ||
      wordLookup.isCheckingPersistence
    ) {
      return
    }

    void persistLookupData({
      lookupAnchorId: wordLookup.lookupAnchorId,
      pairId: wordLookup.pairId,
      side: wordLookup.side,
      surface: wordLookup.lookupText,
      result: wordLookup.result,
      ...(wordLookup.note ? { note: wordLookup.note } : {})
    })
  }

  /** 从气泡中移出当前词条，并同步清理文本中的偶遇标记 */
  const handleRemoveCurrentLookup = (): void => {
    if (!wordLookup?.result || !wordLookup.isPersisted || wordLookup.isRemoving) return

    const lemmaLower = normalizeVocabLemma(wordLookup.result.lemma)
    if (!lemmaLower || vocabRemovalInFlightRef.current.has(lemmaLower)) return

    vocabRemovalInFlightRef.current.add(lemmaLower)
    setWordLookup((current) =>
      current?.result && normalizeVocabLemma(current.result.lemma) === lemmaLower
        ? { ...current, isRemoving: true }
        : current
    )

    void removeVocabItem(wordLookup.result.lemma)
      .then(() => {
        // 已收藏词标记完全由该状态派生，移除词条后下划线与星标会立即消失。
        refreshVocabItemCount()
        setEncounterVocabItems((current) =>
          current.filter((item) => item.lemmaLower !== lemmaLower)
        )
        setWordLookup((current) =>
          current?.result && normalizeVocabLemma(current.result.lemma) === lemmaLower
            ? {
                ...current,
                origin: undefined,
                encounterCount: undefined,
                isPersisted: false,
                canPersist: true,
                isPersisting: false,
                isCheckingPersistence: false,
                isRemoving: false
              }
            : current
        )
      })
      .catch((error) => {
        console.warn('[renderer] 从本地生词库移除词条失败:', error)
        setWordLookup((current) =>
          current?.result && normalizeVocabLemma(current.result.lemma) === lemmaLower
            ? { ...current, isRemoving: false }
            : current
        )
      })
      .finally(() => {
        vocabRemovalInFlightRef.current.delete(lemmaLower)
      })
  }

  /** 离开译文词条后只清理临时悬停状态，不关闭底部学习内容 */
  const handleTargetLookupLeave = (): void => {
    setHoveredTargetWordId(null)
  }

  // 词义卡打开后按 Esc 返回整句结构
  useEffect(() => {
    if (!wordLookup) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeWordLookup()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeWordLookup, wordLookup])

  /** 输入框滚动后同步测量层，避免命中的语句与显示文本错位 */
  const handleSourceScroll = useCallback((): void => {
    const textarea = sourceInputRef.current
    const mirror = sourceMirrorRef.current
    if (textarea && mirror) mirror.scrollTop = textarea.scrollTop

    // 等浏览器完成滚动布局后再测量，避免继续使用滚动前的旧命中框
    window.requestAnimationFrame(() => {
      if (textarea && mirror) mirror.scrollTop = textarea.scrollTop
      measureSourceHitBoxes()
    })

    if (isAutoScrollingSourceRef.current) {
      return
    }

    closeWordLookup()
    if (textarea) textarea.style.cursor = ''

    setActiveAlignmentPairId(null)
    setHoveredSourceWordId(null)
    measureSourceHitBoxes()
    restoreRestingSyntaxPair()

    if (sourceScrollSyncTimerRef.current !== null) {
      window.clearTimeout(sourceScrollSyncTimerRef.current)
    }
    if (!useLearningLayout || !alignment) return

    sourceScrollSyncTimerRef.current = window.setTimeout(() => {
      sourceScrollSyncTimerRef.current = null
      if (isAutoScrollingSourceRef.current) return

      const currentTextarea = sourceInputRef.current
      const currentMirror = sourceMirrorRef.current
      if (!currentTextarea || !currentMirror) return

      const pairId = findVisiblePairId(currentMirror, '[data-source-pair-id]')
      if (pairId) scrollResultToPair(pairId)
    }, PAIR_SCROLL_SYNC_DEBOUNCE_MS)
  }, [
    alignment,
    closeWordLookup,
    measureSourceHitBoxes,
    restoreRestingSyntaxPair,
    scrollResultToPair,
    useLearningLayout
  ])

  useEffect(() => {
    const textarea = sourceInputRef.current
    if (!textarea) return

    textarea.addEventListener('scroll', handleSourceScroll, { passive: true })
    return () => textarea.removeEventListener('scroll', handleSourceScroll)
  }, [handleSourceScroll])

  /** 悬停译文整句时，同步定位原文中的对应片段 */
  const handleTargetPairEnter = useCallback(
    (pairId: string): void => {
      setActiveAlignmentPairId(pairId)
      scrollSourceToPair(pairId)
    },
    [scrollSourceToPair]
  )

  /** 点击译文中的句子才锁定结构；点击单词会阻止冒泡并继续打开词义卡 */
  const handleTargetPairClick = useCallback(
    (pairId: string): void => {
      closeWordLookup()
      openStructurePair(pairId)
    },
    [closeWordLookup, openStructurePair]
  )

  /** 收起整句结构后回到原文、译文上下排列的竖向布局 */
  const handleCollapseStructure = useCallback((): void => {
    if (isStructureCollapsing) return

    closeWordLookup()
    setActiveAlignmentPairId(null)
    setIsStructureCollapsing(true)
    isStructureLayoutTransitioningRef.current = true

    if (structureCollapseTimerRef.current !== null) {
      window.clearTimeout(structureCollapseTimerRef.current)
    }
    if (structureLayoutTransitionTimerRef.current !== null) {
      window.clearTimeout(structureLayoutTransitionTimerRef.current)
      structureLayoutTransitionTimerRef.current = null
    }
    structureCollapseTimerRef.current = window.setTimeout(() => {
      structureCollapseTimerRef.current = null
      setSyntaxTargetPairId(null)
      setIsStructureCollapsing(false)
      setIsStructureLayoutReady(false)
    }, STRUCTURE_LAYOUT_COLLAPSE_MS)
  }, [closeWordLookup, isStructureCollapsing])

  /**
   * 切换顶部主视图。
   * 进入复习时记录来源模式；离开复习时保留阅读区全部状态。
   */
  const handlePrimaryViewChange = useCallback(
    (nextView: PrimaryView): void => {
      const currentView = primaryViewRef.current
      if (nextView === currentView || (nextView === 'learn' && !isLearningSupported)) return

      if (nextView !== 'review') {
        const wasReview = currentView === 'review'
        primaryViewRef.current = nextView
        setPrimaryView(nextView)

        // 普通学习切回翻译时沿用原行为；从复习返回时保留对齐和词义卡
        if (nextView === 'translate' && !wasReview) {
          closeWordLookup()
          resetAlignment()
        }
        return
      }

      reviewReturnViewRef.current = currentView === 'learn' ? 'learn' : 'translate'
      primaryViewRef.current = 'review'
      setPrimaryView('review')
      setIsSourceLangMenuOpen(false)
      setIsTargetLangMenuOpen(false)
      closeModelMenu()

      if (!wantsStructureLayout && !isStructureCollapsing) return

      setActiveAlignmentPairId(null)
      setIsStructureCollapsing(true)
      isStructureLayoutTransitioningRef.current = true

      if (structureCollapseTimerRef.current !== null) {
        window.clearTimeout(structureCollapseTimerRef.current)
      }
      if (structureLayoutTransitionTimerRef.current !== null) {
        window.clearTimeout(structureLayoutTransitionTimerRef.current)
        structureLayoutTransitionTimerRef.current = null
      }
      structureCollapseTimerRef.current = window.setTimeout(() => {
        structureCollapseTimerRef.current = null
        setSyntaxTargetPairId(null)
        setIsStructureCollapsing(false)
        setIsStructureLayoutReady(false)
      }, STRUCTURE_LAYOUT_COLLAPSE_MS)
    },
    [
      closeModelMenu,
      closeWordLookup,
      isLearningSupported,
      isStructureCollapsing,
      resetAlignment,
      wantsStructureLayout
    ]
  )

  /** 词义卡里的“整句”按钮需要真正打开当前词所属句子的结构 */
  const handleOpenLookupSentence = useCallback((): void => {
    const pairId = wordLookup?.pairId
    closeWordLookup()
    if (!pairId) return

    openStructurePair(pairId)
  }, [closeWordLookup, openStructurePair, wordLookup?.pairId])

  /** 清空临时悬停状态；整句结构保留在当前查看的段落，不随鼠标离开回退 */
  const clearHoverState = useCallback((): void => {
    setActiveAlignmentPairId(null)
    setHoveredTargetWordId(null)
  }, [])

  /** 悬停结构语义块时，记录范围供原文单词高亮使用 */
  const handleSyntaxGroupHover = useCallback(
    (start: number, end: number, role: DrawerSyntaxGroup['role']): void => {
      setHoveredSyntaxGroupRange({ start, end, role })
    },
    []
  )

  /** 离开结构语义块后立即撤销原文中的联动高亮 */
  const handleSyntaxGroupLeave = useCallback((): void => {
    setHoveredSyntaxGroupRange(null)
  }, [])

  /** 用户手动滚动译文时清空悬停状态，程序化定位滚动则保持当前句 */
  const handleResultScroll = (): void => {
    if (isAutoScrollingResultRef.current) return
    closeWordLookup()
    clearHoverState()
    restoreRestingSyntaxPair()

    if (resultScrollSyncTimerRef.current !== null) {
      window.clearTimeout(resultScrollSyncTimerRef.current)
    }
    if (!useLearningLayout || !alignment) return

    resultScrollSyncTimerRef.current = window.setTimeout(() => {
      resultScrollSyncTimerRef.current = null
      if (isAutoScrollingResultRef.current) return

      const scroll = resultScrollRef.current
      if (!scroll) return

      const pairId = findVisiblePairId(scroll, '[data-target-pair-id]')
      if (pairId) scrollSourceToPair(pairId)
    }, PAIR_SCROLL_SYNC_DEBOUNCE_MS)
  }

  useEffect(() => {
    let firstFrame = 0
    let secondFrame = 0
    const unsubscribe = window.api.onFocusInput(() => {
      // display:none 的阅读区无法获得焦点，等 React 完成主视图恢复后再聚焦
      restoreViewBeforeReview()
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          sourceInputRef.current?.focus()
          sourceInputRef.current?.select()
        })
      })
    })

    return () => {
      unsubscribe()
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [restoreViewBeforeReview])

  // 模型选择持久化：没有可用模型时清掉记忆值，避免下次启动读到一个已经失效的模型名
  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('selectedModel', selectedModel)
    } else {
      localStorage.removeItem('selectedModel')
    }
  }, [selectedModel])

  useEffect(() => {
    if (copyState === 'idle') return

    const timer = window.setTimeout(() => {
      setCopyState('idle')
    }, 1000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [copyState])

  const handleSourceTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    // console.log('[renderer] source text changed', event.target.value)
    const nextText = event.target.value
    abortActiveTranslationRequests()
    closeWordLookup()

    setSourceText(nextText)

    if (!nextText.trim()) {
      resetTranslationState()
      return
    }

    markTranslationPending()
  }

  const handleModelSelect = (providerId: string, nextModel: string): void => {
    setSelectedProviderId(providerId)
    setSelectedModel(nextModel)
    localStorage.setItem('selectedProviderId', providerId)
    localStorage.setItem('selectedModel', nextModel)
    closeModelMenu()

    if (sourceText.trim()) {
      markTranslationPending()
    }
  }

  const handleClearSource = (): void => {
    abortActiveTranslationRequests()
    requestIdRef.current += 1
    setSourceText('')
    resetTranslationState()
    setCopyState('idle')
  }

  const handleCopyTarget = async (): Promise<void> => {
    if (!targetText.trim()) return

    try {
      await navigator.clipboard.writeText(targetText)
      setCopyState('done')
    } catch (error) {
      console.error('[renderer] copy target failed', error)
      setCopyState('error')
    }
  }

  return (
    <main
      className={`translator-device${useLearningLayout ? ' learning-layout' : ''}${
        useStructureLayout ? ' structure-layout' : ''
      }${isStructureLayoutReady ? ' structure-layout-ready' : ''}${
        isStructureCollapsing ? ' structure-layout-collapsing' : ''
      }`}
      ref={deviceRef}
      style={
        {
          '--structure-layout-duration': `${STRUCTURE_LAYOUT_TRANSITION_MS}ms`,
          '--structure-collapse-duration': `${STRUCTURE_LAYOUT_COLLAPSE_MS}ms`
        } as CSSProperties
      }
    >
      <section className="device-panel">
        <header className="window-bar">
          <div className="window-bar-main">
            <div className="mode-tabs" role="group" aria-label="工作模式">
              <button
                type="button"
                className={`mode-tab${primaryView === 'translate' ? ' mode-tab-active' : ''}`}
                aria-pressed={primaryView === 'translate'}
                onClick={() => handlePrimaryViewChange('translate')}
              >
                翻译
              </button>
              <button
                type="button"
                className={`mode-tab${primaryView === 'learn' ? ' mode-tab-active' : ''}`}
                aria-pressed={primaryView === 'learn'}
                disabled={!isLearningSupported}
                title={isLearningSupported ? '进入学习模式' : '学习模式仅支持英语与简体中文互译'}
                onClick={() => handlePrimaryViewChange('learn')}
              >
                学习
              </button>
              <button
                type="button"
                className={`mode-tab${primaryView === 'review' ? ' mode-tab-active' : ''}`}
                aria-pressed={primaryView === 'review'}
                aria-label={vocabItemCount > 0 ? `复习，生词库共 ${vocabItemCount} 个生词` : '复习'}
                title="复习生词"
                onClick={() => handlePrimaryViewChange('review')}
              >
                复习
                {vocabItemCount > 0 ? (
                  <span className="mode-tab-count">{vocabItemCount}</span>
                ) : null}
              </button>
            </div>

            <div className="window-actions">
              <button
                className="icon-btn settings-btn"
                type="button"
                aria-label="打开偏好设置"
                title="偏好设置（Cmd+,）"
                onClick={() => {
                  setIsSourceLangMenuOpen(false)
                  setIsTargetLangMenuOpen(false)
                  closeModelMenu()
                  void window.api.openConfigWindow()
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M7.37506 3.98898C7.25044 4.06093 7.18813 4.0969 7.13585 4.1315C6.34815 4.65274 6.01706 5.6437 6.33322 6.53376C6.3542 6.59284 6.38237 6.65904 6.43871 6.79145L6.62174 7.2216C5.98033 7.94301 5.48186 8.79434 5.17077 9.73116L4.70884 9.78747C4.566 9.80488 4.49458 9.81359 4.43292 9.82495C3.50404 9.99618 2.81138 10.7784 2.75382 11.7212C2.75 11.7838 2.75 11.8557 2.75 11.9996C2.75 12.1435 2.75 12.2155 2.75382 12.278C2.81138 13.2208 3.50404 14.003 4.43292 14.1743C4.49458 14.1856 4.566 14.1943 4.70884 14.2117L5.1704 14.268C5.48144 15.2052 5.97999 16.0568 6.62157 16.7785L6.43873 17.2082C6.38239 17.3406 6.35422 17.4068 6.33324 17.4659C6.01708 18.3559 6.34817 19.3469 7.13587 19.8681C7.18815 19.9027 7.25046 19.9387 7.37508 20.0107C7.4997 20.0826 7.56201 20.1186 7.61811 20.1466C8.46337 20.5681 9.48712 20.3594 10.0998 19.6405C10.1405 19.5928 10.1838 19.5353 10.2703 19.4203L10.55 19.0484C11.0184 19.1442 11.5034 19.1946 12.0001 19.1946C12.4969 19.1946 12.9818 19.1442 13.4503 19.0484L13.7299 19.4201C13.8164 19.5351 13.8596 19.5926 13.9003 19.6403C14.513 20.3591 15.5368 20.5679 16.382 20.1463C16.4381 20.1184 16.5004 20.0824 16.6251 20.0104C16.7497 19.9385 16.812 19.9025 16.8643 19.8679C17.652 19.3467 17.9831 18.3557 17.6669 17.4657C17.6459 17.4066 17.6177 17.3404 17.5614 17.208L17.3786 16.7785C18.0202 16.0568 18.5188 15.2052 18.8298 14.268L19.2912 14.2117C19.434 14.1943 19.5054 14.1856 19.5671 14.1743C20.496 14.003 21.1886 13.2208 21.2462 12.278C21.25 12.2155 21.25 12.1435 21.25 11.9996C21.25 11.8557 21.25 11.7838 21.2462 11.7212C21.1886 10.7784 20.496 9.99618 19.5671 9.82495C19.5054 9.81359 19.434 9.80488 19.2912 9.78747L18.8294 9.73118C18.7517 9.49698 18.6622 9.26811 18.5617 9.04528C18.2601 8.37679 17.8594 7.76261 17.3784 7.22156L17.5613 6.7916C17.6176 6.65919 17.6458 6.59299 17.6668 6.53391C17.983 5.64385 17.6519 4.65289 16.8642 4.13165C16.8119 4.09705 16.7496 4.06107 16.625 3.98912C16.5003 3.91718 16.438 3.8812 16.3819 3.85322C15.5367 3.43168 14.5129 3.64043 13.9002 4.35925C13.8595 4.40697 13.8163 4.46447 13.7298 4.57946L13.4497 4.95176C12.9815 4.85594 12.4967 4.80569 12.0001 4.80569C11.5035 4.80569 11.0187 4.856 10.5504 4.95181L10.2702 4.57932C10.1837 4.46432 10.1405 4.40682 10.0998 4.35911C9.4871 3.64028 8.46335 3.43153 7.61809 3.85307C7.56199 3.88105 7.49968 3.91703 7.37506 3.98898Z" />
                </svg>
              </button>

              <button
                className={`icon-btn pin-btn${isPinned ? ' pin-btn-on' : ''}`}
                type="button"
                aria-label={isPinned ? '取消固定窗口' : '固定窗口置顶'}
                title={isPinned ? '当前已置顶（点击取消）' : '点击置顶窗口'}
                onClick={() => void handleTogglePin()}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8.375 15.625L12.2092 19.4592C13.3676 20.6175 15.351 19.9682 15.6001 18.3491L16.3396 13.5425C16.44 12.8901 16.8558 12.3292 17.4509 12.0435L20.2054 10.7214C21.4483 10.1248 21.729 8.47902 20.7542 7.50413L16.4959 3.24583C15.521 2.27093 13.8752 2.55164 13.2786 3.79458L11.9564 6.54908C11.6708 7.14417 11.1099 7.55999 10.4575 7.66036L5.65092 8.39984C4.03176 8.64894 3.38243 10.6324 4.54081 11.7908L8.375 15.625ZM8.375 15.625L8.38235 15.6176M8.375 15.625L3.75 20.25" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <div className="device-body">
          {useStructureLayout && alignment && alignmentView ? (
            <aside
              className="learning-drawer learning-drawer-structure learning-structure-panel"
              role="region"
              aria-label="当前句子的结构说明"
              aria-live="polite"
            >
              <span className="learning-drawer-word-rail" aria-hidden="true" />
              <div className="learning-drawer-body structure-compact-body">
                <div className="structure-compact-head">
                  <div className="structure-compact-title">
                    <strong>整句结构</strong>
                    {displayedSyntaxSentenceNumber ? (
                      <span>第 {displayedSyntaxSentenceNumber} 句</span>
                    ) : null}
                  </div>
                  <div className="structure-compact-head-actions">
                    <button
                      type="button"
                      className={`structure-compact-toggle${
                        showCollectedWordMarks ? ' structure-compact-toggle-on' : ''
                      }`}
                      aria-label={showCollectedWordMarks ? '关闭已收藏词标记' : '显示已收藏词标记'}
                      aria-pressed={showCollectedWordMarks}
                      title="只标记已收藏的单词，不影响点击查词"
                      onClick={() => setShowCollectedWordMarks((current) => !current)}
                    >
                      <span className="structure-compact-toggle-dot" aria-hidden="true" />
                      收藏
                    </button>
                    <button
                      type="button"
                      className="structure-compact-close"
                      aria-label="收起整句结构"
                      title="收起整句结构，回到竖向阅读"
                      onClick={handleCollapseStructure}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {hoveredSyntaxSentenceNumber ? (
                  <p className="structure-compact-switch-hint">
                    点击第 {hoveredSyntaxSentenceNumber} 句查看这句话的结构
                  </p>
                ) : null}
                <SentenceStructureView
                  analysis={displayedSentenceSyntax}
                  isLoading={
                    Boolean(displayedSyntaxPairId) &&
                    !displayedSentenceSyntax &&
                    syntaxErrorPairId !== displayedSyntaxPairId
                  }
                  hasError={Boolean(
                    displayedSyntaxPairId &&
                    !displayedSentenceSyntax &&
                    syntaxErrorPairId === displayedSyntaxPairId
                  )}
                  onRetry={handleRetrySentenceSyntax}
                  onGroupHover={
                    learningHighlightSide === 'source' && sourceWordView
                      ? handleSyntaxGroupHover
                      : undefined
                  }
                  onGroupLeave={
                    learningHighlightSide === 'source' && sourceWordView
                      ? handleSyntaxGroupLeave
                      : undefined
                  }
                />
              </div>
            </aside>
          ) : null}

          <div className="reading-column">
            {!isReviewActive ? (
              <div className="language-bar">
                <div className="lang-slot" ref={sourceLangSelectorRef}>
                  <button
                    type="button"
                    className="lang-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={isSourceLangMenuOpen}
                    title="切换源语言"
                    onClick={() => {
                      setIsSourceLangMenuOpen((open) => !open)
                      setIsTargetLangMenuOpen(false)
                      closeModelMenu()
                    }}
                  >
                    <span className="lang-name">{sourceLanguageName}</span>
                    {sourceLanguage === 'auto' && hasSourceText ? (
                      <span className="lang-sub">自动</span>
                    ) : null}
                  </button>

                  {isSourceLangMenuOpen ? (
                    <div className="lang-menu" role="listbox" aria-label="源语言选择">
                      {SUPPORTED_LANGUAGES.map((lang) => {
                        const isSelected = lang.code === sourceLanguage

                        return (
                          <button
                            key={lang.code}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`lang-option${isSelected ? ' lang-option-on' : ''}`}
                            onClick={() => {
                              setIsSourceLangMenuOpen(false)
                              if (sourceLanguage === lang.code) return
                              setSourceLanguage(lang.code)
                              if (sourceText.trim()) {
                                markTranslationPending()
                              }
                            }}
                          >
                            {lang.label}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <span className="flow-swap" aria-hidden="true">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 8h13M14 5l3 3-3 3" />
                    <path d="M20 16H7M10 13l-3 3 3 3" />
                  </svg>
                </span>

                <div className="lang-slot lang-slot-target" ref={targetLangSelectorRef}>
                  <button
                    type="button"
                    className="lang-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={isTargetLangMenuOpen}
                    title="切换目标语言"
                    onClick={() => {
                      setIsTargetLangMenuOpen((open) => !open)
                      setIsSourceLangMenuOpen(false)
                      closeModelMenu()
                    }}
                  >
                    <span className="lang-name">{targetLanguageName}</span>
                  </button>

                  {isTargetLangMenuOpen ? (
                    <div className="lang-menu" role="listbox" aria-label="目标语言选择">
                      <button
                        type="button"
                        role="option"
                        aria-selected={manualTargetLang === null}
                        className={`lang-option${manualTargetLang === null ? ' lang-option-on' : ''}`}
                        title="跟随源语言自动匹配"
                        onClick={() => {
                          setIsTargetLangMenuOpen(false)
                          if (manualTargetLang === null) return
                          setManualTargetLang(null)
                          if (sourceText.trim()) {
                            markTranslationPending()
                          }
                        }}
                      >
                        自动匹配
                      </button>

                      {SUPPORTED_LANGUAGES.filter((lang) => lang.code !== 'auto').map((lang) => {
                        const isSelected = manualTargetLang === lang.code

                        return (
                          <button
                            key={lang.code}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`lang-option${isSelected ? ' lang-option-on' : ''}`}
                            onClick={() => {
                              setIsTargetLangMenuOpen(false)
                              if (manualTargetLang === lang.code) return
                              setManualTargetLang(lang.code)
                              if (sourceText.trim()) {
                                markTranslationPending()
                              }
                            }}
                          >
                            {lang.label}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className={`reading-view${isReviewActive ? ' reading-view-hidden' : ''}`}>
              <div className="compose">
                <div className="compose-stage">
                  {isLearningActive && alignment && alignmentView ? (
                    <div className="compose-mirror" aria-hidden="true" ref={sourceMirrorRef}>
                      <SegmentedText
                        text={sourceText}
                        segments={alignment.sourceSegments}
                        pairBySegmentId={alignmentView.sourcePairBySegmentId}
                        activePairId={activeAlignmentPairId}
                        side="source"
                        lookupTokensBySegmentId={sourceWordView?.tokensBySegmentId}
                        encounterHighlights={
                          encounterWordView?.side === 'source'
                            ? encounterWordView.highlights
                            : undefined
                        }
                        activeLookupWordId={
                          hoveredSourceWordId ??
                          (wordLookup?.side === 'source' ? wordLookup.lookupAnchorId : null)
                        }
                        activeSyntaxHighlight={activeSyntaxWordHighlight}
                        activeEncounterId={
                          wordLookup?.origin === 'encounter' && wordLookup.side === 'source'
                            ? wordLookup.lookupAnchorId
                            : null
                        }
                      />
                    </div>
                  ) : null}

                  <textarea
                    ref={sourceInputRef}
                    className="compose-input"
                    value={sourceText}
                    onChange={handleSourceTextChange}
                    onClick={handleSourceClick}
                    onMouseMove={handleSourceMouseMove}
                    onMouseLeave={handleSourceMouseLeave}
                    placeholder={`截图 ${screenshotShortcut}，或直接输入 / 粘贴文字`}
                    rows={1}
                    spellCheck={false}
                    aria-label="源文本输入框"
                  />
                </div>
              </div>

              <section className="result">
                <div className="result-scroll" ref={resultScrollRef} onScroll={handleResultScroll}>
                  {errorMessage ? (
                    <p className="result-error" role="status" aria-live="polite">
                      {errorMessage}
                    </p>
                  ) : null}

                  {isRecognizing ? (
                    <div className="result-pending" role="status" aria-live="polite">
                      <p>正在识别截图文字…</p>
                      {ocrSlowHint ? (
                        <p className="result-pending-hint">
                          首次使用需要初始化识别模型，可能需要半分钟，请稍候
                        </p>
                      ) : null}
                    </div>
                  ) : status === 'translating' && !targetText.trim() ? (
                    <div className="result-loader" aria-live="polite" aria-label="正在翻译">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : isLearningActive &&
                    !hasSourceText &&
                    status === 'idle' &&
                    !isRecognizing &&
                    !errorMessage ? (
                    <p className="result-text result-placeholder result-reading-empty">
                      粘贴英文开始阅读
                    </p>
                  ) : isLearningActive && alignment && alignmentView ? (
                    <p className="result-text" onMouseLeave={clearHoverState}>
                      <SegmentedText
                        text={targetText}
                        segments={alignment.targetSegments}
                        pairBySegmentId={alignmentView.targetPairBySegmentId}
                        activePairId={activeAlignmentPairId}
                        side="target"
                        lookupTokensBySegmentId={targetWordView?.tokensBySegmentId}
                        encounterHighlights={
                          encounterWordView?.side === 'target'
                            ? encounterWordView.highlights
                            : undefined
                        }
                        activeLookupWordId={
                          hoveredTargetWordId ??
                          (wordLookup?.side === 'target' ? wordLookup.lookupAnchorId : null)
                        }
                        activeEncounterId={
                          wordLookup?.origin === 'encounter' && wordLookup.side === 'target'
                            ? wordLookup.lookupAnchorId
                            : null
                        }
                        onPairEnter={handleTargetPairEnter}
                        onPairClick={handleTargetPairClick}
                        onLookupWordClick={handleTargetWordClick}
                        onLookupWordEnter={handleTargetWordEnter}
                        onLookupWordLeave={handleTargetLookupLeave}
                        onEncounterClick={handleTargetEncounterLookup}
                        onEncounterEnter={handleTargetEncounterEnter}
                        onEncounterLeave={handleTargetLookupLeave}
                      />
                    </p>
                  ) : (
                    <p
                      className={`result-text${targetText ? '' : ' result-placeholder'}${
                        status === 'translating' && targetText ? ' result-text-streaming' : ''
                      }`}
                    >
                      {targetText || '译文会显示在这里'}
                    </p>
                  )}
                </div>

                {wordLookup ? (
                  <aside
                    ref={learningDrawerRef}
                    className="learning-drawer learning-drawer-word"
                    role="region"
                    aria-label={
                      wordLookup.result?.kind === 'grammar'
                        ? '当前语法词的语境说明'
                        : '当前单词的语境释义'
                    }
                    aria-live="polite"
                  >
                    <span className="learning-drawer-word-rail" aria-hidden="true" />
                    <div className="learning-drawer-body word-compact-body">
                      <WordLookupCompactView
                        lookup={wordLookup}
                        onClose={handleOpenLookupSentence}
                        onPersist={handlePersistCurrentLookup}
                        onRemove={handleRemoveCurrentLookup}
                      />
                    </div>
                  </aside>
                ) : null}

                <div className="result-toolbar" ref={resultToolbarRef}>
                  <div className="toolbar-left">
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={handleClearSource}
                      disabled={!hasSourceText}
                      aria-label="清空输入"
                      title="清空输入"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>

                    <button
                      ref={modelSelectorRef}
                      className="model-entry"
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={isModelMenuOpen}
                      aria-label={
                        activeProvider
                          ? `当前服务商: ${activeProvider.name}，模型: ${selectedModel}，点击打开模型面板`
                          : '当前没有启用任何服务商，点击打开模型面板查看'
                      }
                      title={
                        activeProvider
                          ? `服务商: ${activeProvider.name}\n模型: ${selectedModel}\n地址: ${activeProvider.baseUrl}`
                          : '当前没有启用任何服务商，请在偏好设置里启用一个'
                      }
                      onClick={() => {
                        setIsSourceLangMenuOpen(false)
                        setIsTargetLangMenuOpen(false)
                        if (isModelMenuOpen) {
                          closeModelMenu()
                        } else {
                          openModelMenu()
                        }
                      }}
                    >
                      {selectedModel || '未配置模型'}
                    </button>
                  </div>

                  <button
                    className={`icon-btn${copyState === 'done' ? ' icon-btn-done' : ''}${
                      copyState === 'error' ? ' icon-btn-error' : ''
                    }`}
                    type="button"
                    onClick={() => void handleCopyTarget()}
                    disabled={!hasTargetText || status === 'translating'}
                    aria-label={copyState === 'done' ? '复制完成' : '复制输出'}
                    title={copyState === 'done' ? '复制完成' : '复制输出'}
                  >
                    {copyState === 'done' ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M15.25 8.75V4C15.25 3.30964 14.6904 2.75 14 2.75H4C3.30964 2.75 2.75 3.30964 2.75 4V14C2.75 14.6904 3.30964 15.25 4 15.25H8.75M10 8.75H20C20.6904 8.75 21.25 9.30964 21.25 10V20C21.25 20.6904 20.6904 21.25 20 21.25H10C9.30964 21.25 8.75 20.6904 8.75 20V10C8.75 9.30964 9.30964 8.75 10 8.75Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </section>
            </div>

            {isReviewActive ? (
              <section className="review-view" aria-label="生词复习" ref={reviewViewRef}>
                <div className="review-content">
                  {vocabFlashcardState === 'ready' && vocabFlashcards.length > 0 ? (
                    <VocabFlashcardCarousel
                      cards={vocabFlashcards}
                      activeIndex={Math.min(vocabFlashcardIndex, vocabFlashcards.length - 1)}
                      onIndexChange={handleVocabFlashcardIndexChange}
                      autoAdvance={false}
                      showAllVocabLink={vocabItemCount > 0}
                      onOpenVocabLibrary={openVocabLibrary}
                    />
                  ) : vocabFlashcardState === 'loading' || vocabFlashcardState === 'hidden' ? (
                    <div className="vocab-flashcard-loading" role="status" aria-live="polite">
                      正在翻阅生词…
                    </div>
                  ) : (
                    <div className="vocab-review-empty" role="status" aria-live="polite">
                      还没有收藏的生词，阅读时点击单词即可收藏
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {/* 模型面板：结构与交互沿用原实现，配色并入中性极简体系 */}
        {isDeckMounted ? (
          <div
            className={`terminal-engine-deck ${isDeckClosing ? 'terminal-engine-deck-closing' : ''}`}
            ref={engineDeckRef}
            role="dialog"
            aria-label="翻译引擎选择面板"
          >
            <div className="terminal-engine-deck-header">
              <div className="terminal-engine-deck-title">模型</div>
              <div className="terminal-engine-deck-actions">
                <button
                  type="button"
                  className="terminal-engine-deck-config"
                  onClick={() => {
                    closeModelMenu()
                    void window.api.openConfigWindow()
                  }}
                  aria-label="打开偏好设置"
                  title="配置服务商（Cmd+,）"
                >
                  设置
                </button>
                <button
                  type="button"
                  className="terminal-engine-deck-close"
                  onClick={() => closeModelMenu()}
                  aria-label="关闭模型面板"
                  title="关闭面板"
                >
                  ✕
                </button>
              </div>
            </div>

            {enabledProviders.length > 0 ? (
              /* 所有渠道的模型平铺成一列：一次点击直达，渠道之间只用一条细线分隔 */
              <div className="terminal-engine-models-list" role="listbox" aria-label="模型列表">
                {enabledProviders.flatMap((prov, provIndex) => {
                  const rows = prov.models.map((item) => {
                    const isSelected = prov.id === selectedProviderId && item.id === selectedModel
                    return (
                      <button
                        key={`${prov.id}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`terminal-engine-option ${
                          isSelected ? 'terminal-engine-option-selected' : ''
                        }`}
                        onClick={() => handleModelSelect(prov.id, item.id)}
                        title={`${item.id} · ${prov.name}`}
                      >
                        <span className="terminal-engine-name">{item.id}</span>
                        <span className="terminal-engine-provider">{prov.name}</span>
                      </button>
                    )
                  })

                  // 第一个渠道前面不加分隔线，避免顶部多出一条悬空的线
                  if (provIndex === 0) return rows
                  return [
                    <div
                      key={`sep-${prov.id}`}
                      className="terminal-engine-group-sep"
                      aria-hidden="true"
                    />,
                    ...rows
                  ]
                })}
              </div>
            ) : (
              /* 一个启用的服务商都没有：点右上角「设置」去启用，不再列出写死的示例模型 */
              <div className="terminal-engine-empty-hint">
                还没有启用任何服务商，点右上角「设置」去启用
              </div>
            )}
          </div>
        ) : null}

        {/* 生词列表覆盖层：复用模型面板的全窗口覆盖、进出动画与关闭按钮 */}
        {isVocabLibraryMounted ? (
          <div
            className={`terminal-engine-deck vocab-library-deck${
              isVocabLibraryClosing ? ' terminal-engine-deck-closing' : ''
            }`}
            role="dialog"
            aria-label="我的生词"
          >
            <div className="terminal-engine-deck-header">
              <div className="terminal-engine-deck-title vocab-library-title">
                {`我的生词 (${
                  vocabLibraryState === 'ready' ? vocabLibraryItems.length : vocabItemCount
                })`}
              </div>
              <button
                type="button"
                className="terminal-engine-deck-close"
                onClick={closeVocabLibrary}
                aria-label="关闭生词列表"
                title="关闭生词列表"
              >
                ✕
              </button>
            </div>

            <input
              type="search"
              className="vocab-library-search"
              value={vocabLibrarySearch}
              onChange={(event) => setVocabLibrarySearch(event.target.value)}
              placeholder="搜索生词"
              aria-label="搜索生词"
              spellCheck={false}
            />

            <div
              className="vocab-library-list"
              role="list"
              aria-label="生词列表"
              aria-busy={vocabLibraryState === 'loading'}
            >
              {vocabLibraryState === 'loading' ? (
                <div className="vocab-library-status" role="status" aria-live="polite">
                  正在读取生词…
                </div>
              ) : vocabLibraryState === 'error' ? (
                <div className="vocab-library-status" role="status" aria-live="polite">
                  读取生词失败，请稍后重试
                </div>
              ) : vocabLibraryItems.length === 0 ? (
                <div className="vocab-library-status" role="status" aria-live="polite">
                  还没有收藏的生词，阅读时点击单词即可收藏
                </div>
              ) : filteredVocabLibraryItems.length === 0 ? (
                <div className="vocab-library-status" role="status" aria-live="polite">
                  没有匹配的生词
                </div>
              ) : (
                filteredVocabLibraryItems.map((item) => {
                  const isRemoving = removingVocabLemmaLowers.has(item.lemmaLower)
                  return (
                    <div className="vocab-library-item" role="listitem" key={item.lemmaLower}>
                      <span className="vocab-library-word" title={item.lemma}>
                        {item.lemma}
                      </span>
                      <span className="vocab-library-encounter">偶遇 {item.encounterCount} 次</span>
                      <button
                        type="button"
                        className="vocab-library-remove"
                        onClick={() => void handleRemoveVocabLibraryItem(item)}
                        disabled={isRemoving}
                        aria-label={`移出生词 ${item.lemma}`}
                      >
                        {isRemoving ? '移出中' : '移出'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
