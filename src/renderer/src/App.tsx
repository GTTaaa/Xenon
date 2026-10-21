import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProviderItem, ShortcutSettings } from '../../shared/config'
import {
  getAlignmentPairSentences,
  resolveLearningHighlightSide,
  tokenizeTextWords,
  type AlignmentSegment,
  type AlignmentToken,
  type LearningHighlight,
  type TextAlignment
} from '../../shared/textAlignment'
import {
  findEnglishWordAtOffset,
  type WordLookupResult,
  type WordLookupSide
} from '../../shared/wordLookup'
import {
  splitSentenceSyntaxText,
  type SentenceSyntaxAnalysis,
  type SentenceSyntaxSegment
} from '../../shared/sentenceSyntax'

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
  getPhraseVocabItems,
  getRandomVocabFlashcard,
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
  NORMAL_WINDOW_HEIGHT_MAX
} from '../../shared/windowLayout'

type TranslateStatus = 'idle' | 'translating' | 'error'

const INITIAL_SOURCE_TEXT = ''
// 普通模式输入字号 14px × 行高 1.55，用来把输入框内容高度换算成行数
const INPUT_LINE_HEIGHT = 21.7
// 输入区最多长到 5 行，再多交给输入框自己滚动
const MAX_INPUT_LINES = 5
// 学习模式两侧统一显示 4～15 行：短文本按内容收敛，长文本提供更充足的对照阅读空间
const LEARNING_MIN_VISIBLE_LINES = 4
const LEARNING_MAX_VISIBLE_LINES = 15
// 普通模式译文最少铺 3 行（16px 字号 × 1.6 行高），短内容不再留下过多空白
const RESULT_MIN_HEIGHT = 16 * 1.6 * 3
// 学习对齐结果只保留当前会话内最近使用的少量文本，避免缓存无限增长
const MAX_ALIGNMENT_CACHE_ENTRIES = 8
// 单词释义按“当前句 + 对应译文”缓存，避免重复点击同一语境时产生额外模型请求
const MAX_WORD_LOOKUP_CACHE_ENTRIES = 64
// 鼠标离开单词后留出移动到释义浮层的时间，超时后自动关闭
const WORD_LOOKUP_HOVER_HIDE_DELAY_MS = 120
// 调整对齐规则或提示词后递增缓存版本，主动淘汰旧结果
const ALIGNMENT_CACHE_VERSION = 'learning-v5'
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
  /** 命中类型：学习高亮优先于生词偶遇，生词偶遇优先于普通单词 */
  kind: 'highlight' | 'encounter' | 'word' | 'sentence'
  /** 学习高亮编号、生词偶遇编号、单词编号或整句对齐组编号 */
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
  /** 当前词条或学习高亮的稳定编号，用于固定高亮状态 */
  lookupAnchorId: string
  /** 英文项所属的整句对齐组编号 */
  pairId: string
  /** 英文项位于原文还是译文 */
  side: WordLookupSide
  /** 当前查询状态 */
  status: 'loading' | 'ready' | 'error'
  /** 当前数据来自学习高亮、本地词库、模型查询还是二次偶遇 */
  origin?: 'highlight' | 'database' | 'llm' | 'encounter'
  /** 查询成功后的上下文释义 */
  result?: WordLookupResult
  /** 中译英学习高亮附带的地道表达说明 */
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
  /** 当前侧全部英文词片段，按自然句归组 */
  lookupTokensBySegmentId?: ReadonlyMap<string, AlignmentToken[]>
  /** 当前侧经过校验的学习高亮 */
  highlights?: LearningHighlight[]
  /** 当前侧命中的本地已收录词 */
  encounterHighlights?: EncounterVocabHighlight[]
  /** 当前鼠标指向或固定的普通英文词编号 */
  activeLookupWordId?: string | null
  /** 当前鼠标指向或固定的学习高亮编号 */
  activeHighlightId?: string | null
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
  /** 点击学习高亮时的回调 */
  onHighlightClick?: (
    highlight: LearningHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ) => void
  /** 鼠标进入学习高亮时的回调 */
  onHighlightEnter?: (
    highlight: LearningHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ) => void
  /** 鼠标离开学习高亮时的回调 */
  onHighlightLeave?: () => void
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
  lookupTokensBySegmentId,
  highlights = [],
  encounterHighlights = [],
  activeLookupWordId = null,
  activeHighlightId = null,
  activeEncounterId = null,
  onLookupWordClick,
  onLookupWordEnter,
  onLookupWordLeave,
  onHighlightClick,
  onHighlightEnter,
  onHighlightLeave,
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
    const segmentHighlights = highlights.filter(
      (highlight) => highlight.start < segment.end && highlight.end > segment.start
    )
    const segmentEncounterHighlights = encounterHighlights.filter(
      (highlight) => highlight.start < segment.end && highlight.end > segment.start
    )

    while (segmentCursor < segment.end) {
      const highlight = segmentHighlights.find(
        (item) => item.start <= segmentCursor && item.end > segmentCursor
      )
      if (highlight) {
        const end = Math.min(highlight.end, segment.end)
        const isHighlightActive = highlight.id === activeHighlightId
        const hasLocalEncounter = segmentEncounterHighlights.some(
          (item) => item.start < end && item.end > segmentCursor
        )
        segmentNodes.push(
          <span
            key={`highlight-${highlight.id}-${segmentCursor}`}
            className={`learning-highlight learning-highlight-${side}${
              isHighlightActive ? ' learning-highlight-active' : ''
            }${hasLocalEncounter ? ' learning-highlight-collected' : ''}`}
            data-source-highlight-id={side === 'source' ? highlight.id : undefined}
            data-target-highlight-id={side === 'target' ? highlight.id : undefined}
            onClick={onHighlightClick ? (event) => onHighlightClick(highlight, event) : undefined}
            onMouseEnter={
              onHighlightEnter ? (event) => onHighlightEnter(highlight, event) : undefined
            }
            onMouseLeave={onHighlightLeave}
          >
            {text.slice(segmentCursor, end)}
          </span>
        )
        segmentCursor = end
        continue
      }

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
        segmentNodes.push(
          <span
            key={`word-${token.id}-${segmentCursor}`}
            className={`source-word${isWordActive ? ' source-word-active' : ''}`}
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
        ...segmentHighlights.map((item) => item.start).filter((start) => start > segmentCursor),
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
      >
        {segmentNodes}
      </span>
    )

    cursor = segment.end
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))

  return <>{nodes}</>
}

/** 轻量骨架图标，用于进入和退出语法透视视图 */
function SyntaxStructureIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.25h4v3H3zM9 4.25h4v3H9zM6 10.25h4v3H6z" />
      <path d="M7 5.75h2M8 7.25v3" />
    </svg>
  )
}

interface SentenceSyntaxViewProps {
  /** 已通过连续切片校验的语法分析 */
  analysis: SentenceSyntaxAnalysis
  /** 返回常规英文句子视图 */
  onClose: () => void
}

const SYNTAX_ROLE_LABELS: Record<'subject' | 'predicate' | 'object', string> = {
  subject: '主',
  predicate: '谓',
  object: '宾'
}

/** 在不改变输入区高度的行内视图中展示 S-V-O 语义胶囊与次要补充 */
function SentenceSyntaxView({ analysis, onClose }: SentenceSyntaxViewProps): React.JSX.Element {
  const [tooltip, setTooltip] = useState<{
    tip: string
    x: number
    y: number
  } | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const showTooltip = (
    segment: SentenceSyntaxSegment,
    event: React.MouseEvent<HTMLSpanElement>
  ): void => {
    if (!segment.plainTip) return
    setTooltip({
      tip: segment.plainTip,
      x: Math.max(8, Math.min(event.clientX + 9, window.innerWidth - 238)),
      y: Math.max(8, event.clientY - 27)
    })
  }

  const handleClose = (): void => {
    if (isClosing) return
    setIsClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 150)
  }

  return (
    <div className={`sentence-syntax-view${isClosing ? ' sentence-syntax-view-closing' : ''}`}>
      <button
        type="button"
        className="sentence-syntax-toggle"
        title="收起语法透视"
        aria-label="收起语法透视"
        aria-expanded="true"
        disabled={isClosing}
        onClick={handleClose}
      >
        <SyntaxStructureIcon />
      </button>

      <div
        className="sentence-syntax-sentence-shell"
        onMouseLeave={() => setTooltip(null)}
        onScroll={() => setTooltip(null)}
      >
        <p className="sentence-syntax-sentence" lang="en">
          {analysis.segments.flatMap((segment, segmentIndex) =>
            splitSentenceSyntaxText(segment.text).flatMap((run, runIndex) => {
              // 模型切片可能重复，索引与长度组合足以在当前句内保持稳定
              const key = `${segmentIndex}-${runIndex}-${run.text.length}`

              // 标点永远独立渲染，即使模型错误地把它放进了某个语义角色
              if (run.kind === 'punctuation') {
                return [
                  <span key={key} className="sentence-syntax-punctuation">
                    {run.text}
                  </span>
                ]
              }

              const canShowTip = segment.role !== 'other' && Boolean(segment.plainTip)
              const showTip = canShowTip
                ? (event: React.MouseEvent<HTMLSpanElement>) => showTooltip(segment, event)
                : undefined
              const hideTip = canShowTip ? () => setTooltip(null) : undefined
              // 首尾空格留在胶囊外，语义文本内部空格完整保留，角标只出现一次
              const [, leadingSpace = '', content = run.text, trailingSpace = ''] =
                run.text.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? []

              if (!content) {
                return [
                  <span key={`${key}-space`} className="sentence-syntax-whitespace">
                    {run.text}
                  </span>
                ]
              }

              if (
                segment.role === 'subject' ||
                segment.role === 'predicate' ||
                segment.role === 'object'
              ) {
                return [
                  ...(leadingSpace
                    ? [
                        <span key={`${key}-leading`} className="sentence-syntax-whitespace">
                          {leadingSpace}
                        </span>
                      ]
                    : []),
                  <span
                    key={`${key}-capsule`}
                    className={`sentence-syntax-capsule sentence-syntax-role-${segment.role}`}
                    onMouseEnter={showTip}
                    onMouseLeave={hideTip}
                  >
                    {content}
                    <span className="sentence-syntax-role-badge" aria-hidden="true">
                      {SYNTAX_ROLE_LABELS[segment.role]}
                    </span>
                  </span>,
                  ...(trailingSpace
                    ? [
                        <span key={`${key}-trailing`} className="sentence-syntax-whitespace">
                          {trailingSpace}
                        </span>
                      ]
                    : [])
                ]
              }

              if (segment.role === 'modifier') {
                return [
                  ...(leadingSpace
                    ? [
                        <span key={`${key}-leading`} className="sentence-syntax-whitespace">
                          {leadingSpace}
                        </span>
                      ]
                    : []),
                  <span
                    key={`${key}-modifier`}
                    className="sentence-syntax-modifier"
                    onMouseEnter={showTip}
                    onMouseLeave={hideTip}
                  >
                    {content}
                  </span>,
                  ...(trailingSpace
                    ? [
                        <span key={`${key}-trailing`} className="sentence-syntax-whitespace">
                          {trailingSpace}
                        </span>
                      ]
                    : [])
                ]
              }

              return [
                <span key={key} className="sentence-syntax-other">
                  {run.text}
                </span>
              ]
            })
          )}
        </p>
      </div>

      {tooltip ? (
        <div
          className="sentence-syntax-tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          role="tooltip"
        >
          {tooltip.tip}
        </div>
      ) : null}
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
  // 学习模式是可选能力，默认关闭，避免干扰只想快速看译文的用户
  const [learningMode, setLearningMode] = useState(() => {
    return localStorage.getItem('learningMode') === '1'
  })
  // 当前悬停或指向的对齐组编号
  const [activeAlignmentPairId, setActiveAlignmentPairId] = useState<string | null>(null)
  // 当前鼠标指向的普通英文词，用于输入框透明层上的词级底色
  const [hoveredSourceWordId, setHoveredSourceWordId] = useState<string | null>(null)
  // 当前鼠标指向的原文学习高亮
  const [hoveredSourceHighlightId, setHoveredSourceHighlightId] = useState<string | null>(null)
  // 当前鼠标指向的译文普通英文词
  const [hoveredTargetWordId, setHoveredTargetWordId] = useState<string | null>(null)
  // 当前鼠标指向的译文学习高亮
  const [hoveredTargetHighlightId, setHoveredTargetHighlightId] = useState<string | null>(null)
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
  // 当前进入语法透视视图的句子
  const [syntaxViewPairId, setSyntaxViewPairId] = useState<string | null>(null)
  // 语法透视按钮当前指向的句子，由悬停句自动更新
  const [syntaxTargetPairId, setSyntaxTargetPairId] = useState<string | null>(null)
  // 最近一次语法透视的轻量错误提示
  const [syntaxErrorMessage, setSyntaxErrorMessage] = useState('')
  // 学习模式空状态展示的随机复习闪卡
  const [vocabFlashcard, setVocabFlashcard] = useState<VocabFlashcard | null>(null)
  // 区分闪卡加载中、数据库为空与正常展示三种状态
  const [vocabFlashcardState, setVocabFlashcardState] = useState<
    'hidden' | 'loading' | 'ready' | 'empty'
  >('hidden')
  // 中文释义默认遮挡，鼠标悬停或点击后揭晓
  const [isVocabFlashcardRevealed, setIsVocabFlashcardRevealed] = useState(false)
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
  const wordLookupCacheRef = useRef<Map<string, WordLookupResult>>(new Map())
  const wordLookupRef = useRef<HTMLDivElement | null>(null)
  const wordLookupCloseTimerRef = useRef<number | null>(null)
  const sourceInputRef = useRef<HTMLTextAreaElement | null>(null)
  const sourceMirrorRef = useRef<HTMLDivElement | null>(null)
  const sourceHitBoxesRef = useRef<SourceHitBox[]>([])
  const sourceHoverFrameRef = useRef<number | null>(null)
  const isAutoScrollingSourceRef = useRef(false)
  const isAutoScrollingResultRef = useRef(false)
  const autoScrollSourceTimerRef = useRef<number | null>(null)
  const autoScrollResultTimerRef = useRef<number | null>(null)
  const sourceScrollSyncTimerRef = useRef<number | null>(null)
  const resultScrollSyncTimerRef = useRef<number | null>(null)
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
  const isLearningActive = learningMode && isLearningSupported
  // 学习高亮落在英文原文还是英文译文，供本地词库统一还原双语语序
  const learningHighlightSide = useMemo(
    () => resolveLearningHighlightSide(effectiveSourceLang, effectiveTargetLang),
    [effectiveSourceLang, effectiveTargetLang]
  )
  const hasSourceText = sourceText.trim().length > 0
  const hasTargetText = targetText.trim().length > 0
  // 有实际原文时才切换成上下等高的对照布局，空窗口仍保持紧凑
  const useLearningLayout = isLearningActive && hasSourceText
  // 只有真正的学习模式空状态才展示复习闪卡，截图识别与错误提示优先
  const isVocabFlashcardVisible =
    isLearningActive && !hasSourceText && status === 'idle' && !isRecognizing && !errorMessage

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
      targetPairBySegmentId,
      sourceHighlights: alignment.highlights.filter((highlight) => highlight.side === 'source'),
      targetHighlights: alignment.highlights.filter((highlight) => highlight.side === 'target'),
      highlightById: new Map(alignment.highlights.map((highlight) => [highlight.id, highlight]))
    }
  }, [alignment])

  // 当前视图只对英文原文提供语法透视，中译英仍保留原有学习高亮流程
  const canUseSourceSentenceSyntax =
    isLearningActive && learningHighlightSide === 'source' && Boolean(alignment && alignmentView)
  const activeSentenceSyntax =
    syntaxViewPairId && canUseSourceSentenceSyntax
      ? (sentenceSyntaxByPairId[syntaxViewPairId] ?? null)
      : null

  // 学习模式下默认分析第一句；悬停其他句后按钮会自动切换到对应句
  useEffect(() => {
    if (!alignment || !isLearningActive || learningHighlightSide !== 'source') {
      setSyntaxTargetPairId(null)
      setSyntaxViewPairId(null)
      return
    }

    const pairIds = new Set(alignment.pairs.map((pair) => pair.id))
    setSyntaxTargetPairId((current) => {
      if (current && pairIds.has(current)) return current
      return alignment.pairs[0]?.id ?? null
    })
  }, [alignment, isLearningActive, learningHighlightSide])

  useEffect(() => {
    if (
      syntaxViewPairId ||
      !activeAlignmentPairId ||
      !alignment?.pairs.some((pair) => pair.id === activeAlignmentPairId)
    ) {
      return
    }
    setSyntaxTargetPairId(activeAlignmentPairId)
    setSyntaxErrorMessage('')
  }, [activeAlignmentPairId, alignment, syntaxViewPairId])

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

  // 中译英时译文中的全部英文词仍可单点查询，学习高亮则会直接使用对齐响应
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

    for (const match of findVocabTextMatches(englishText, encounterVocabItems)) {
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
    sourceText,
    status,
    targetText
  ])

  // 闪卡英文例句围绕目标词切成三段，渲染时只强调真实命中词形
  const flashcardSentenceParts = useMemo(() => {
    if (!vocabFlashcard) return null
    return splitSentenceAroundVocab(
      vocabFlashcard.context.sourceSentence,
      vocabFlashcard.context.surface || vocabFlashcard.item.surface || vocabFlashcard.item.lemma
    )
  }, [vocabFlashcard])

  const deviceRef = useRef<HTMLElement | null>(null)
  // 译文区滚动容器与底部工具行：量两者高度，窗口才能按"内容实际需要多高"来收放
  const resultScrollRef = useRef<HTMLDivElement | null>(null)
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

  /**
   * 输入区高度与窗口高度联动。
   *
   * 窗口高度按"内容真正需要多高"来算：头部到译文区的固定距离 + 输入区实际高度 + 译文实际高度。
   * 早先是按输入行数线性加高（每行 +50px），多出来的空间全归译文区，
   * 于是"输入 5 行、译文只有 4 行"时底部会空出一大片。
   *
   * 这样算不会自激：译文区已经不再是 flex:1 撑满窗口，它的高度只由内容决定，
   * 改窗口高度不会反过来改变 scrollHeight。
   */
  const syncWindowHeight = useCallback((): void => {
    const textarea = sourceInputRef.current
    const scroll = resultScrollRef.current
    const toolbar = resultToolbarRef.current
    const panel = deviceRef.current
    if (!textarea || !scroll || !toolbar || !panel) return

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
    // 学习模式让译文滚动区与原文输入区拥有相同的文字可视高度
    scroll.style.height = useLearningLayout ? `${learningTextHeight + scrollPadding}px` : ''
    // 普通模式按译文实际内容计算；学习模式忽略内容高度，保持两侧等高
    const resultHeight = useLearningLayout
      ? learningTextHeight
      : Math.max(RESULT_MIN_HEIGHT, scroll.scrollHeight - scrollPadding)
    // 工具行到窗口底边的这点留白写在 .device-body 的 padding-bottom 上，从样式里读，避免两处硬编码
    const body = panel.querySelector('.device-body')
    const bottomPadding = body ? parseFloat(getComputedStyle(body).paddingBottom || '0') : 0

    const nextWindowHeight = Math.round(
      Math.min(
        useLearningLayout ? MAIN_WINDOW_HEIGHT_MAX : NORMAL_WINDOW_HEIGHT_MAX,
        Math.max(
          MAIN_WINDOW_HEIGHT_MIN,
          lead +
            scrollPadding +
            resultHeight +
            toolbar.getBoundingClientRect().height +
            bottomPadding
        )
      )
    )

    // 仅当高度发生有效变化（>= 2px）时才派发 IPC，杜绝微小晃动与性能浪费
    if (Math.abs(lastSentHeightRef.current - nextWindowHeight) >= 2) {
      lastSentHeightRef.current = nextWindowHeight
      void window.api.setWindowHeight(nextWindowHeight)
    }
  }, [useLearningLayout])

  useLayoutEffect(() => {
    syncWindowHeight()
  }, [
    sourceText,
    targetText,
    status,
    errorMessage,
    syncWindowHeight,
    isVocabFlashcardVisible,
    vocabFlashcardState,
    isVocabFlashcardRevealed
  ])

  // 组件卸载时清理退出定时器
  useEffect(() => {
    return () => {
      if (deckClosingTimerRef.current) {
        clearTimeout(deckClosingTimerRef.current)
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
    setHoveredSourceHighlightId(null)
    setHoveredTargetWordId(null)
    setHoveredTargetHighlightId(null)
    setWordLookup(null)
    sentenceSyntaxRequestIdRef.current += 1
    setSentenceSyntaxByPairId({})
    setSyntaxLoadingPairId(null)
    setSyntaxViewPairId(null)
    setSyntaxTargetPairId(null)
    setSyntaxErrorMessage('')
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
  }, [abortActiveTranslationRequests, markTranslationPending])

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

  // 学习模式偏好持久化，下次启动保持用户选择
  useEffect(() => {
    localStorage.setItem('learningMode', learningMode ? '1' : '0')
  }, [learningMode])

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
      const [wordItems, phraseItems] = await Promise.all([
        getVocabItemsByWordForms(words),
        getPhraseVocabItems()
      ])
      const itemByLemma = new Map<string, VocabItem>()
      for (const item of [...wordItems, ...phraseItems]) {
        itemByLemma.set(item.lemmaLower, item)
      }

      const matchedItems = Array.from(itemByLemma.values()).filter(
        (item) => findVocabTextMatches(englishText, [item]).length > 0
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
  }, [isLearningActive, learningHighlightSide, sourceText, status, targetText])

  // 学习模式空状态随机抽取一条带语境的生词闪卡
  useEffect(() => {
    if (!isVocabFlashcardVisible) {
      setVocabFlashcard(null)
      setVocabFlashcardState('hidden')
      setIsVocabFlashcardRevealed(false)
      return
    }

    let cancelled = false
    setVocabFlashcard(null)
    setVocabFlashcardState('loading')
    setIsVocabFlashcardRevealed(false)

    void getRandomVocabFlashcard()
      .then((flashcard) => {
        if (cancelled) return
        setVocabFlashcard(flashcard)
        setVocabFlashcardState(flashcard ? 'ready' : 'empty')
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[renderer] 读取生词闪卡失败:', error)
        setVocabFlashcardState('empty')
      })

    return () => {
      cancelled = true
    }
  }, [isVocabFlashcardVisible])

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

    // 学习短语可能跨行，先按编号合并所有可见矩形，命中时优先于单词和整句
    const highlightRectsById = new Map<string, DOMRect[]>()
    const highlightElements = mirror.querySelectorAll<HTMLElement>('[data-source-highlight-id]')
    for (const element of highlightElements) {
      const highlightId = element.dataset.sourceHighlightId
      if (!highlightId) continue

      const range = document.createRange()
      range.selectNodeContents(element)
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0
      )
      if (rects.length === 0) continue
      const currentRects = highlightRectsById.get(highlightId) ?? []
      currentRects.push(...rects)
      highlightRectsById.set(highlightId, currentRects)
    }
    for (const [highlightId, rects] of highlightRectsById) {
      hitBoxes.push({ kind: 'highlight', id: highlightId, rects })
    }

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

    const segmentElements = mirror.querySelectorAll<HTMLElement>('[data-source-pair-id]')
    for (const element of segmentElements) {
      const pairId = element.dataset.sourcePairId
      if (!pairId) continue

      const range = document.createRange()
      range.selectNodeContents(element)
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0
      )

      if (rects.length > 0) hitBoxes.push({ kind: 'sentence', id: pairId, rects })
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
      if (wordLookupCloseTimerRef.current !== null) {
        window.clearTimeout(wordLookupCloseTimerRef.current)
      }
    }
  }, [])

  /** 关闭查词浮层，并让尚未返回的旧查询自动失效 */
  const closeWordLookup = useCallback((): void => {
    if (wordLookupCloseTimerRef.current !== null) {
      window.clearTimeout(wordLookupCloseTimerRef.current)
      wordLookupCloseTimerRef.current = null
    }
    wordLookupRequestIdRef.current += 1
    setWordLookup(null)
    setActiveAlignmentPairId(null)
    setHoveredSourceWordId(null)
    setHoveredSourceHighlightId(null)
    setHoveredTargetWordId(null)
    setHoveredTargetHighlightId(null)
  }, [])

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

  /** 取消即将执行的查词浮层关闭，供重新进入单词或浮层时调用 */
  const cancelWordLookupClose = useCallback((): void => {
    if (wordLookupCloseTimerRef.current === null) return
    window.clearTimeout(wordLookupCloseTimerRef.current)
    wordLookupCloseTimerRef.current = null
  }, [])

  /** 鼠标离开单词或浮层后开始计时；连续移动不会反复重置关闭时间 */
  const scheduleWordLookupClose = useCallback((): void => {
    if (!wordLookup || wordLookupCloseTimerRef.current !== null) return

    wordLookupCloseTimerRef.current = window.setTimeout(() => {
      wordLookupCloseTimerRef.current = null
      closeWordLookup()
    }, WORD_LOOKUP_HOVER_HIDE_DELAY_MS)
  }, [closeWordLookup, wordLookup])

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
          surface: params.surface,
          meaning: params.result.meaning,
          targetText: params.result.targetText,
          ...(params.note ? { note: params.note } : {}),
          side: params.side,
          englishSentence: pairSentences.englishSentence,
          chineseSentence: pairSentences.chineseSentence
        })

        upsertEncounterVocabItem(item, params.side)
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
    [alignment, learningHighlightSide, sourceText, targetText, upsertEncounterVocabItem]
  )

  /** 学习高亮直接使用句级对齐响应，不再发起额外查词请求 */
  const showHighlightLookup = useCallback(
    (
      highlight: LearningHighlight,
      position: WordLookupPosition,
      options?: { persist?: boolean }
    ): void => {
      cancelWordLookupClose()
      // 学习高亮直接命中缓存数据时，也要让尚未返回的普通查词请求失效。
      wordLookupRequestIdRef.current += 1
      setActiveAlignmentPairId(highlight.pairId)
      if (highlight.side === 'source') {
        setHoveredSourceWordId(null)
        setHoveredSourceHighlightId(highlight.id)
        setHoveredTargetWordId(null)
        setHoveredTargetHighlightId(null)
        scrollResultToPair(highlight.pairId)
      } else {
        setHoveredSourceWordId(null)
        setHoveredSourceHighlightId(null)
        setHoveredTargetWordId(null)
        setHoveredTargetHighlightId(highlight.id)
        scrollSourceToPair(highlight.pairId)
      }

      setWordLookup({
        ...position,
        lookupText: highlight.surface,
        lookupAnchorId: highlight.id,
        pairId: highlight.pairId,
        side: highlight.side,
        status: 'ready',
        result: {
          lemma: highlight.lemma,
          meaning: highlight.meaning,
          targetText: highlight.targetText
        },
        note: highlight.note || undefined,
        origin: 'highlight',
        isPersisted: false,
        canPersist: false,
        isPersisting: false,
        isCheckingPersistence: true
      })

      const requestId = wordLookupRequestIdRef.current
      void Promise.all([findCachedVocab(highlight.lemma), findCachedVocab(highlight.surface)])
        .then(([itemByLemma, itemBySurface]) => {
          if (wordLookupRequestIdRef.current !== requestId) return
          const item = itemByLemma ?? itemBySurface
          if (!item) {
            if (options?.persist) {
              void persistLookupData({
                lookupAnchorId: highlight.id,
                pairId: highlight.pairId,
                side: highlight.side,
                surface: highlight.surface,
                result: {
                  lemma: highlight.lemma,
                  meaning: highlight.meaning,
                  targetText: highlight.targetText
                },
                ...(highlight.note ? { note: highlight.note } : {})
              })
              return
            }

            setWordLookup((current) =>
              current && current.lookupAnchorId === highlight.id && current.side === highlight.side
                ? {
                    ...current,
                    isPersisted: false,
                    canPersist: true,
                    isCheckingPersistence: false
                  }
                : current
            )
            return
          }

          setWordLookup((current) =>
            current && current.lookupAnchorId === highlight.id && current.side === highlight.side
              ? {
                  ...current,
                  encounterCount: item.encounterCount,
                  isPersisted: true,
                  canPersist: false,
                  isPersisting: false,
                  isCheckingPersistence: false
                }
              : current
          )
        })
        .catch((error) => {
          console.warn('[renderer] 读取学习高亮词库状态失败:', error)
          if (wordLookupRequestIdRef.current !== requestId) return
          setWordLookup((current) =>
            current && current.lookupAnchorId === highlight.id && current.side === highlight.side
              ? {
                  ...current,
                  isPersisted: false,
                  canPersist: true,
                  isCheckingPersistence: false
                }
              : current
          )
        })
    },
    [cancelWordLookupClose, persistLookupData, scrollResultToPair, scrollSourceToPair]
  )

  /** 二次偶遇高亮直接展示本地数据，不发起任何模型请求 */
  const showEncounterLookup = useCallback(
    (match: EncounterVocabHighlight, position: WordLookupPosition): void => {
      cancelWordLookupClose()
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
        setHoveredSourceHighlightId(null)
        setHoveredTargetWordId(null)
        setHoveredTargetHighlightId(null)
        scrollResultToPair(match.pairId)
      } else {
        setHoveredSourceWordId(null)
        setHoveredSourceHighlightId(null)
        setHoveredTargetWordId(null)
        setHoveredTargetHighlightId(null)
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
          lemma: match.item.lemma,
          meaning: match.item.meaning,
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
      cancelWordLookupClose,
      learningHighlightSide,
      scrollResultToPair,
      scrollSourceToPair,
      sourceText,
      targetText
    ]
  )

  /** 按需分析当前悬停句的核心内容，并缓存结果供再次展开 */
  const handleToggleSentenceSyntax = useCallback((): void => {
    const pairId = activeAlignmentPairId ?? syntaxTargetPairId
    if (
      !pairId ||
      !alignment ||
      !isLearningActive ||
      learningHighlightSide !== 'source' ||
      syntaxLoadingPairId
    ) {
      return
    }

    if (syntaxViewPairId === pairId) {
      setSyntaxViewPairId(null)
      window.requestAnimationFrame(() => sourceInputRef.current?.focus())
      return
    }

    const cachedAnalysis = sentenceSyntaxByPairId[pairId]
    if (cachedAnalysis) {
      setSyntaxErrorMessage('')
      setSyntaxViewPairId(pairId)
      sourceInputRef.current?.blur()
      return
    }

    const pairSentences = getAlignmentPairSentences(
      alignment,
      sourceText,
      targetText,
      pairId,
      learningHighlightSide
    )
    if (!pairSentences?.englishSentence || !pairSentences.chineseSentence) {
      setSyntaxErrorMessage('当前句缺少完整的双语上下文')
      return
    }

    const requestId = sentenceSyntaxRequestIdRef.current + 1
    sentenceSyntaxRequestIdRef.current = requestId
    setSyntaxLoadingPairId(pairId)
    setSyntaxErrorMessage('')
    sourceInputRef.current?.blur()

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
          setSyntaxErrorMessage(response.error.message || '语法透视失败，请稍后再试')
          return
        }

        setSentenceSyntaxByPairId((current) => ({
          ...current,
          [pairId]: response.analysis
        }))
        setSyntaxViewPairId(pairId)
      })
      .catch((error) => {
        if (sentenceSyntaxRequestIdRef.current !== requestId) return
        console.warn('[renderer] 语法透视失败:', error)
        setSyntaxErrorMessage('语法透视失败，请稍后再试')
      })
      .finally(() => {
        if (sentenceSyntaxRequestIdRef.current === requestId) {
          setSyntaxLoadingPairId(null)
        }
      })
  }, [
    activeAlignmentPairId,
    alignment,
    isLearningActive,
    learningHighlightSide,
    selectedModel,
    selectedProviderId,
    sentenceSyntaxByPairId,
    sourceText,
    syntaxLoadingPairId,
    syntaxTargetPairId,
    syntaxViewPairId,
    targetText
  ])

  /** 关闭语法透视并恢复输入框焦点 */
  const handleCloseSentenceSyntax = useCallback((): void => {
    setSyntaxViewPairId(null)
    window.requestAnimationFrame(() => sourceInputRef.current?.focus())
  }, [])

  /** 对未被学习高亮覆盖的英文词发起单点上下文查词 */
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

      cancelWordLookupClose()
      setActiveAlignmentPairId(params.pairId)
      if (params.side === 'source') {
        setHoveredSourceWordId(params.anchorId)
        setHoveredSourceHighlightId(null)
        setHoveredTargetWordId(null)
        setHoveredTargetHighlightId(null)
        scrollResultToPair(params.pairId)
      } else {
        setHoveredSourceWordId(null)
        setHoveredSourceHighlightId(null)
        setHoveredTargetWordId(params.anchorId)
        setHoveredTargetHighlightId(null)
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
              lemma: cachedItem.lemma,
              meaning: cachedItem.meaning,
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
      cancelWordLookupClose,
      detectedInfo.detected,
      effectiveTargetLang,
      scrollResultToPair,
      scrollSourceToPair,
      selectedModel,
      selectedProviderId,
      sourceLanguage
    ]
  )

  /** 鼠标在原生输入框上移动时，按高亮、单词、整句的优先级更新命中项 */
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
      let nextPairId: string | null = null
      let nextWordId: string | null = null
      let nextHighlightId: string | null = null
      let nextEncounterId: string | null = null
      let hoveredWordIdUnderPointer: string | null = null
      let hoveredHighlightIdUnderPointer: string | null = null
      let hoveredEncounterIdUnderPointer: string | null = null
      let isPointerOverLookupItem = false
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
          if (hitBox.kind === 'word') {
            hoveredWordIdUnderPointer = hitBox.id
            if (wordLookup?.side === 'source' && hitBox.id === wordLookup.lookupAnchorId) {
              isPointerOverLookupItem = true
            }
          } else if (hitBox.kind === 'highlight') {
            hoveredHighlightIdUnderPointer = hitBox.id
            if (wordLookup?.side === 'source' && hitBox.id === wordLookup.lookupAnchorId) {
              isPointerOverLookupItem = true
            }
          } else if (hitBox.kind === 'encounter') {
            hoveredEncounterIdUnderPointer = hitBox.id
            if (wordLookup?.side === 'source' && hitBox.id === wordLookup.lookupAnchorId) {
              isPointerOverLookupItem = true
            }
          }

          const priority =
            hitBox.kind === 'highlight'
              ? 0
              : hitBox.kind === 'encounter'
                ? 1
                : hitBox.kind === 'word'
                  ? 2
                  : 3
          if (
            verticalDistance > bestVerticalDistance ||
            (verticalDistance === bestVerticalDistance && priority >= bestPriority)
          ) {
            continue
          }

          bestVerticalDistance = verticalDistance
          bestPriority = priority
          if (hitBox.kind === 'highlight') {
            const highlight = alignmentView?.highlightById.get(hitBox.id)
            nextHighlightId = hitBox.id
            nextEncounterId = null
            nextWordId = null
            nextPairId = highlight?.pairId ?? null
          } else if (hitBox.kind === 'encounter') {
            const encounterMatch = encounterWordView?.matchById.get(hitBox.id)
            nextHighlightId = null
            nextEncounterId = hitBox.id
            nextWordId = null
            nextPairId = encounterMatch?.pairId ?? null
          } else if (hitBox.kind === 'word') {
            const wordToken = sourceWordView?.tokenById.get(hitBox.id)
            nextHighlightId = null
            nextEncounterId = null
            nextWordId = hitBox.id
            nextPairId = wordToken
              ? (alignmentView?.sourcePairBySegmentId.get(wordToken.segmentId) ?? null)
              : null
          } else {
            nextHighlightId = null
            nextEncounterId = null
            nextWordId = null
            nextPairId = hitBox.id
          }
        }
      }

      setHoveredSourceWordId(nextWordId)
      setHoveredSourceHighlightId(nextHighlightId)

      if (nextHighlightId) {
        const highlight = alignmentView?.highlightById.get(nextHighlightId)
        if (highlight) {
          setActiveAlignmentPairId(highlight.pairId)
          if (wordLookup?.side === 'source' && wordLookup.lookupAnchorId === highlight.id) {
            cancelWordLookupClose()
          } else {
            showHighlightLookup(highlight, getWordLookupPosition(pointerX, event.clientY))
          }
        }
      } else if (nextEncounterId) {
        const encounterMatch = encounterWordView?.matchById.get(nextEncounterId)
        if (encounterMatch) {
          setActiveAlignmentPairId(encounterMatch.pairId)
          if (wordLookup?.side === 'source' && wordLookup.lookupAnchorId === encounterMatch.id) {
            cancelWordLookupClose()
          } else {
            showEncounterLookup(encounterMatch, getWordLookupPosition(pointerX, event.clientY))
          }
        }
      } else if (!wordLookup) {
        setActiveAlignmentPairId((current) => (current === nextPairId ? current : nextPairId))
        if (nextPairId) scrollResultToPair(nextPairId)
      } else if (isPointerOverLookupItem) {
        cancelWordLookupClose()
      } else if (hoveredWordIdUnderPointer) {
        closeWordLookup()
        setHoveredSourceWordId(hoveredWordIdUnderPointer)
        setHoveredSourceHighlightId(null)
        setActiveAlignmentPairId(nextPairId)
        if (nextPairId) scrollResultToPair(nextPairId)
      } else {
        scheduleWordLookupClose()
      }
      textarea.style.cursor =
        hoveredHighlightIdUnderPointer ||
        hoveredEncounterIdUnderPointer ||
        hoveredWordIdUnderPointer ||
        nextWordId ||
        nextEncounterId
          ? 'pointer'
          : 'text'
    })
  }

  /** 点击原文时优先打开已返回的学习高亮，否则查询光标下的普通英文词 */
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
    const clickedHighlight =
      alignmentView.sourceHighlights.find(
        (highlight) => clickOffset >= highlight.start && clickOffset < highlight.end
      ) ?? alignmentView.sourceHighlights.find((highlight) => clickOffset === highlight.end)
    if (clickedHighlight) {
      showHighlightLookup(clickedHighlight, getWordLookupPosition(event.clientX, event.clientY), {
        persist: true
      })
      return
    }

    const clickedEncounter =
      encounterWordView?.highlights.find(
        (encounter) => clickOffset >= encounter.start && clickOffset < encounter.end
      ) ?? encounterWordView?.highlights.find((encounter) => clickOffset === encounter.end)
    if (clickedEncounter) {
      showEncounterLookup(clickedEncounter, getWordLookupPosition(event.clientX, event.clientY))
      return
    }

    if (!sourceWordView) {
      closeWordLookup()
      return
    }

    const selection = findEnglishWordAtOffset(sourceText, clickOffset)
    if (!selection) {
      closeWordLookup()
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

  /** 鼠标离开输入区时立即取消两侧高亮 */
  const handleSourceMouseLeave = (event: React.MouseEvent<HTMLTextAreaElement>): void => {
    if (sourceHoverFrameRef.current !== null) {
      window.cancelAnimationFrame(sourceHoverFrameRef.current)
      sourceHoverFrameRef.current = null
    }
    event.currentTarget.style.cursor = ''
    if (wordLookup) {
      scheduleWordLookupClose()
    } else {
      setHoveredSourceWordId(null)
      setHoveredSourceHighlightId(null)
      setActiveAlignmentPairId(null)
    }
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

  /** 点击学习高亮表示主动学习，立即写入本地词库 */
  const handleTargetHighlightClick = (
    highlight: LearningHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ): void => {
    event.stopPropagation()
    showHighlightLookup(highlight, getWordLookupPosition(event.clientX, event.clientY), {
      persist: true
    })
  }

  /** 译文中的学习高亮直接展示对齐响应中的释义与地道表达说明 */
  const handleTargetHighlightEnter = (
    highlight: LearningHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ): void => {
    showHighlightLookup(highlight, getWordLookupPosition(event.clientX, event.clientY))
  }

  /** 译文普通词只显示轻量悬停状态，点击时才发起请求 */
  const handleTargetWordEnter = (token: AlignmentToken, pairId: string): void => {
    setActiveAlignmentPairId(pairId)
    setHoveredTargetWordId(token.id)
    setHoveredTargetHighlightId(null)
    scrollSourceToPair(pairId)
  }

  /** 译文中的二次偶遇词直接展示本地记录，不发模型请求 */
  const handleTargetEncounterLookup = (
    match: EncounterVocabHighlight,
    event: React.MouseEvent<HTMLSpanElement>
  ): void => {
    event.stopPropagation()
    showEncounterLookup(match, getWordLookupPosition(event.clientX, event.clientY))
  }

  /** 浮层中的收藏按钮用于把仅预览的学习高亮主动写入本地词库 */
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
        // 偶遇高亮完全由该状态派生，移除词条后下划线与星标会立即消失。
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

  /** 离开译文词条后按原有延迟关闭浮层 */
  const handleTargetLookupLeave = (): void => {
    setHoveredTargetWordId(null)
    setHoveredTargetHighlightId(null)
    if (wordLookup) scheduleWordLookupClose()
  }

  // 查词浮层打开后，点击单词与浮层外的位置或按 Esc 即可立即关闭
  useEffect(() => {
    if (!wordLookup) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && sourceInputRef.current?.contains(target)) return
      if (target instanceof Node && wordLookupRef.current?.contains(target)) return
      closeWordLookup()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeWordLookup()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
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
    setHoveredSourceHighlightId(null)
    measureSourceHitBoxes()

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
  }, [alignment, closeWordLookup, measureSourceHitBoxes, scrollResultToPair, useLearningLayout])

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

  /** 清空所有悬停状态，供译文区滚动与鼠标离开时复用 */
  const clearHoverState = useCallback((): void => {
    setActiveAlignmentPairId(null)
    setHoveredTargetWordId(null)
    setHoveredTargetHighlightId(null)
  }, [])

  /** 用户手动滚动译文时清空悬停状态，程序化定位滚动则保持高亮 */
  const handleResultScroll = (): void => {
    if (isAutoScrollingResultRef.current) return
    closeWordLookup()
    clearHoverState()

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
    return window.api.onFocusInput(() => {
      sourceInputRef.current?.focus()
      sourceInputRef.current?.select()
    })
  }, [])

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
      className={`translator-device${useLearningLayout ? ' learning-layout' : ''}`}
      ref={deviceRef}
    >
      <section className="device-panel">
        <header className="lang-bar">
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
        </header>

        <div className="device-body">
          <div className="compose">
            <div
              className={`compose-stage${
                canUseSourceSentenceSyntax ? ' compose-stage-with-syntax' : ''
              }${activeSentenceSyntax ? ' syntax-source-active' : ''}`}
            >
              {isLearningActive && alignment && alignmentView ? (
                <div className="compose-mirror" aria-hidden="true" ref={sourceMirrorRef}>
                  <SegmentedText
                    text={sourceText}
                    segments={alignment.sourceSegments}
                    pairBySegmentId={alignmentView.sourcePairBySegmentId}
                    activePairId={activeAlignmentPairId}
                    side="source"
                    lookupTokensBySegmentId={sourceWordView?.tokensBySegmentId}
                    highlights={alignmentView.sourceHighlights}
                    encounterHighlights={
                      encounterWordView?.side === 'source'
                        ? encounterWordView.highlights
                        : undefined
                    }
                    activeLookupWordId={
                      hoveredSourceWordId ??
                      (wordLookup?.side === 'source' ? wordLookup.lookupAnchorId : null)
                    }
                    activeHighlightId={
                      hoveredSourceHighlightId ??
                      (wordLookup?.side === 'source' ? wordLookup.lookupAnchorId : null)
                    }
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

              {canUseSourceSentenceSyntax && !activeSentenceSyntax ? (
                <button
                  type="button"
                  className={`sentence-syntax-toggle${
                    syntaxErrorMessage ? ' sentence-syntax-toggle-error' : ''
                  }`}
                  disabled={Boolean(syntaxLoadingPairId)}
                  title={
                    syntaxLoadingPairId
                      ? '正在分析当前句的核心内容'
                      : '语法透视（悬停英文句可切换目标）'
                  }
                  aria-label="分析当前英文句的核心内容"
                  aria-expanded="false"
                  onClick={handleToggleSentenceSyntax}
                >
                  {syntaxLoadingPairId ? (
                    <span className="sentence-syntax-spinner" aria-hidden="true" />
                  ) : (
                    <SyntaxStructureIcon />
                  )}
                </button>
              ) : null}

              {syntaxErrorMessage && canUseSourceSentenceSyntax && !activeSentenceSyntax ? (
                <div className="sentence-syntax-error" role="alert">
                  {syntaxErrorMessage}
                </div>
              ) : null}

              {activeSentenceSyntax ? (
                <SentenceSyntaxView
                  analysis={activeSentenceSyntax}
                  onClose={handleCloseSentenceSyntax}
                />
              ) : null}
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
              ) : isVocabFlashcardVisible ? (
                vocabFlashcardState === 'ready' && vocabFlashcard && flashcardSentenceParts ? (
                  <div
                    className={`vocab-flashcard${
                      isVocabFlashcardRevealed ? ' vocab-flashcard-revealed' : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-label="偶遇复习闪卡，悬停或点击查看中文释义"
                    onMouseEnter={() => setIsVocabFlashcardRevealed(true)}
                    onClick={() => setIsVocabFlashcardRevealed(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setIsVocabFlashcardRevealed(true)
                      }
                    }}
                  >
                    <div className="vocab-flashcard-kicker">
                      <span>偶遇复习</span>
                      <span>已偶遇 {vocabFlashcard.item.encounterCount} 次</span>
                    </div>
                    <p className="vocab-flashcard-sentence" lang="en">
                      {flashcardSentenceParts.match ? (
                        <>
                          {flashcardSentenceParts.before}
                          <mark>{flashcardSentenceParts.match}</mark>
                          {flashcardSentenceParts.after}
                        </>
                      ) : (
                        flashcardSentenceParts.before
                      )}
                    </p>
                    <div className="vocab-flashcard-answer">
                      <p>{vocabFlashcard.item.meaning}</p>
                      <p lang="zh-CN">{vocabFlashcard.context.targetSentence}</p>
                    </div>
                    <div className="vocab-flashcard-hint">
                      {isVocabFlashcardRevealed ? '再次偶遇，记得更牢' : '悬停或点击揭晓释义'}
                    </div>
                  </div>
                ) : vocabFlashcardState === 'loading' || vocabFlashcardState === 'hidden' ? (
                  <div className="vocab-flashcard-loading" role="status">
                    正在翻阅生词…
                  </div>
                ) : (
                  <div className="vocab-flashcard-empty">
                    <span>偶遇复习</span>
                    <p>查过的重点词会在这里变成闪卡</p>
                  </div>
                )
              ) : isLearningActive && alignment && alignmentView ? (
                <p className="result-text" onMouseLeave={clearHoverState}>
                  <SegmentedText
                    text={targetText}
                    segments={alignment.targetSegments}
                    pairBySegmentId={alignmentView.targetPairBySegmentId}
                    activePairId={activeAlignmentPairId}
                    side="target"
                    lookupTokensBySegmentId={targetWordView?.tokensBySegmentId}
                    highlights={alignmentView.targetHighlights}
                    encounterHighlights={
                      encounterWordView?.side === 'target'
                        ? encounterWordView.highlights
                        : undefined
                    }
                    activeLookupWordId={
                      hoveredTargetWordId ??
                      (wordLookup?.side === 'target' ? wordLookup.lookupAnchorId : null)
                    }
                    activeHighlightId={
                      hoveredTargetHighlightId ??
                      (wordLookup?.side === 'target' ? wordLookup.lookupAnchorId : null)
                    }
                    activeEncounterId={
                      wordLookup?.origin === 'encounter' && wordLookup.side === 'target'
                        ? wordLookup.lookupAnchorId
                        : null
                    }
                    onPairEnter={handleTargetPairEnter}
                    onLookupWordClick={handleTargetWordClick}
                    onLookupWordEnter={handleTargetWordEnter}
                    onLookupWordLeave={handleTargetLookupLeave}
                    onHighlightClick={handleTargetHighlightClick}
                    onHighlightEnter={handleTargetHighlightEnter}
                    onHighlightLeave={handleTargetLookupLeave}
                    onEncounterClick={handleTargetEncounterLookup}
                    onEncounterEnter={handleTargetEncounterLookup}
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

                <button
                  className={`learning-toggle${isLearningActive ? ' learning-toggle-on' : ''}`}
                  type="button"
                  aria-label={isLearningActive ? '关闭学习模式' : '开启学习模式'}
                  aria-pressed={isLearningActive}
                  disabled={!isLearningSupported}
                  title={
                    isLearningSupported
                      ? learningMode
                        ? '关闭学习模式'
                        : '开启学习模式：查看重点表达并点击英文词查询'
                      : '学习模式当前仅支持英语与简体中文互译'
                  }
                  onClick={() => {
                    const nextMode = !learningMode
                    setLearningMode(nextMode)
                    if (!nextMode) {
                      closeWordLookup()
                      clearHoverState()
                      resetAlignment()
                    }
                  }}
                >
                  学习
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
      </section>

      {wordLookup ? (
        <div
          ref={wordLookupRef}
          className={`word-lookup-tooltip word-lookup-tooltip-${wordLookup.placement}`}
          style={{
            left: `${wordLookup.x}px`,
            top: `${wordLookup.y}px`
          }}
          role="status"
          aria-live="polite"
          onMouseEnter={cancelWordLookupClose}
          onMouseLeave={scheduleWordLookupClose}
        >
          <div className="word-lookup-word" lang="en">
            {wordLookup.lookupText}
          </div>

          {wordLookup.origin === 'database' ? (
            <div className="word-lookup-origin">本地词库命中</div>
          ) : null}

          {wordLookup.status === 'loading' ? (
            <div className="word-lookup-status">正在结合上下文查询释义…</div>
          ) : null}

          {wordLookup.status === 'ready' && wordLookup.result ? (
            <>
              <div className="word-lookup-meaning">
                <span>此处</span>
                {wordLookup.result.meaning}
              </div>
              <div className="word-lookup-meta">
                {wordLookup.result.lemma.trim().toLowerCase() !==
                wordLookup.lookupText.trim().toLowerCase() ? (
                  <span>原形 {wordLookup.result.lemma}</span>
                ) : null}
                {wordLookup.result.targetText ? (
                  <span>
                    {wordLookup.side === 'source' ? '译文对应' : '原文对应'}：
                    {wordLookup.result.targetText}
                  </span>
                ) : (
                  <span>当前没有可靠的连续对应表达</span>
                )}
              </div>
              {wordLookup.note ? (
                <div className="word-lookup-note">
                  <span>表达提示</span>
                  {wordLookup.note}
                </div>
              ) : null}
              {wordLookup.isPersisted ? (
                <button
                  type="button"
                  className="word-lookup-save word-lookup-save-persisted"
                  disabled={wordLookup.isRemoving}
                  onClick={handleRemoveCurrentLookup}
                >
                  {wordLookup.isRemoving ? (
                    '正在移出…'
                  ) : (
                    <>
                      <span className="word-lookup-save-persisted-label">
                        ★ 已在生词库
                        {wordLookup.encounterCount !== undefined
                          ? ` (第 ${wordLookup.encounterCount} 次遇到)`
                          : ''}
                      </span>
                      <span className="word-lookup-save-remove-label">✕ 移出生词库</span>
                    </>
                  )}
                </button>
              ) : wordLookup.isCheckingPersistence ? (
                <button type="button" className="word-lookup-save" disabled>
                  正在检查词库…
                </button>
              ) : wordLookup.isPersisting ? (
                <button type="button" className="word-lookup-save" disabled>
                  正在收录…
                </button>
              ) : wordLookup.canPersist ? (
                <button
                  type="button"
                  className="word-lookup-save"
                  onClick={handlePersistCurrentLookup}
                >
                  ☆ 收藏到生词库
                </button>
              ) : null}
            </>
          ) : null}

          {wordLookup.status === 'error' ? (
            <div className="word-lookup-status word-lookup-status-error">
              {wordLookup.errorMessage || '释义查询失败，请稍后再试'}
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}

export default App
