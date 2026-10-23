import { net } from 'electron'
import { resolveAlignmentReasoningEffort } from '../../shared/alignmentReasoning'
import {
  parseWordLookupResult,
  type WordLookupRequest,
  type WordLookupResponse,
  type WordLookupSide
} from '../../shared/wordLookup'
import { getLLMConfig } from './configManager'
import { resolveModelRoute, type ModelRoute } from './modelRoute'

class WordLookupServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WordLookupServiceError'
    this.code = code
  }
}

/** 单词查询接口返回体 */
interface WordLookupResponseBody {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; content?: string }>
    }
    text?: string
  }>
  data?: {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string; content?: string }>
      }
      text?: string
    }>
    usage?: WordLookupUsage
  }
  usage?: WordLookupUsage
  error?:
    | {
        message?: string
      }
    | string
}

/** 兼容服务商返回的 token 用量信息 */
interface WordLookupUsage {
  /** 输入 token */
  prompt_tokens?: number
  /** 输出 token */
  completion_tokens?: number
  /** 总 token */
  total_tokens?: number
  /** 输出 token 明细 */
  completion_tokens_details?: {
    /** 推理 token */
    reasoning_tokens?: number
  }
}

/** 构造只解释点击词、不改写翻译的系统提示词 */
const buildWordLookupSystemPrompt = (wordSide: WordLookupSide): string => {
  const clickedSentence = wordSide === 'source' ? 'sourceSentence' : 'targetSentence'
  const correspondingSentence = wordSide === 'source' ? 'targetSentence' : 'sourceSentence'

  return [
    'You are a concise English-to-Simplified-Chinese contextual vocabulary assistant.',
    'Return only strict JSON. For a content word, use this shape:',
    '{"kind":"lexical","lemma":"base form","literalMeaning":"脱离本句时最常见的简体中文字面义","meaning":"本句中的简体中文含义","contextNote":"为什么这里取这个含义","wordOrderNote":"这个词为什么放在当前位置","targetText":"对应中文片段","confidence":"high"}',
    'For an auxiliary, modal, copula, determiner, preposition, pronoun, conjunction, article, particle, or grammatical contraction, use this shape:',
    '{"kind":"grammar","lemma":"expanded grammatical form","literalMeaning":"","meaning":"本句中的语法作用","contextNote":"为什么这里使用这个语法形式","wordOrderNote":"这个语法词为什么放在当前位置","targetText":"对应中文片段","confidence":"high"}',
    'Rules:',
    `- Analyze only the clicked English word inside ${clickedSentence} and its paired text in ${correspondingSentence}.`,
    '- kind must describe the clicked word in this sentence, not another lexical sense that happens to share the same spelling.',
    '- Use kind "grammar" when the word mainly builds tense, aspect, modality, negation, question, voice, case, or sentence structure.',
    "- For a grammatical contraction, lemma must be its full grammatical expansion: didn't → did not, can't → cannot, won't → will not, I'm → I am.",
    '- For kind "lexical", lemma must be the concise English base form and literalMeaning must be the most common standalone Simplified Chinese dictionary meaning.',
    '- For kind "grammar", literalMeaning must be an empty string. Never attach the lexical meaning of a homographic content verb to a grammar form.',
    '- In particular, didn\'t means did not; its did marks simple-past negation and does not mean "做". The content verb in "I didn\'t eat today" is eat.',
    '- meaning must be a short Simplified Chinese explanation of the clicked word in this exact context.',
    '- contextNote must briefly explain the contextual clue in Simplified Chinese. Set it to an empty string only when no contextual distinction needs explanation.',
    "- wordOrderNote must explain the clicked word's grammatical role and why it occupies its current position, using one or two short Simplified Chinese sentences.",
    '- When the position is flexible, explain the neutral default position and the emphasis or contrast created by moving it.',
    '- For example, in "I didn\'t eat today.", today is a time adverbial normally placed at the end; moving it to the front emphasizes contrast.',
    '- Set wordOrderNote to an empty string only when its position has no useful teaching point or cannot be determined reliably.',
    `- targetText must be an exact contiguous Simplified Chinese substring of ${correspondingSentence}.`,
    '- Use an empty targetText when no direct correspondence can be established.',
    '- Never reuse a generic dictionary meaning when the translation indicates a different contextual meaning.',
    '- Return confidence exactly "high" only when the contextual meaning is directly supported.',
    '- If no reliable contextual meaning can be determined, return {"error":"NO_RELIABLE_MEANING"}.',
    '- Do not translate or explain the whole sentence; wordOrderNote must stay focused on the clicked word.',
    '- Do not include Markdown fences, headings, explanations, or extra keys.'
  ].join('\n')
}

/** 从兼容 OpenAI 的响应中提取正文 */
const extractMessageText = (data: WordLookupResponseBody): string => {
  const rawChoices = data.data?.choices ?? data.choices
  const firstChoice = rawChoices?.[0]
  const messageContent = firstChoice?.message?.content

  if (typeof messageContent === 'string') return messageContent.trim()
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => (typeof item === 'object' ? item.text || item.content || '' : String(item)))
      .join('')
      .trim()
  }
  if (typeof firstChoice?.text === 'string') return firstChoice.text.trim()
  return ''
}

/** 提取服务商返回的错误说明 */
const getErrorMessage = (data: WordLookupResponseBody, status: number): string => {
  const error = data.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object' && error.message?.trim()) return error.message.trim()
  return `单词查询请求失败：${status}`
}

/** 调用当前模型获取一个单词在当前句中的上下文释义 */
const requestWordLookup = async (
  request: WordLookupRequest,
  route: ModelRoute
): Promise<ReturnType<typeof parseWordLookupResult>> => {
  const cleanBaseUrl = route.baseUrl
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
  const endpoint = `${cleanBaseUrl}/chat/completions`
  const reasoningEffort = resolveAlignmentReasoningEffort(route.model)

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${route.apiKey.trim()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'screenshot-translator/1.0'
    },
    body: JSON.stringify({
      model: route.model,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      messages: [
        {
          role: 'system',
          content: buildWordLookupSystemPrompt(request.wordSide === 'target' ? 'target' : 'source')
        },
        {
          role: 'user',
          content: JSON.stringify({
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            word: request.word,
            wordSide: request.wordSide === 'target' ? 'target' : 'source',
            sourceSentence: request.sourceSentence,
            targetSentence: request.targetSentence
          })
        }
      ]
    })
  })

  const rawResponseText = await response.text()
  let data: WordLookupResponseBody

  try {
    data = JSON.parse(rawResponseText)
  } catch {
    throw new WordLookupServiceError(
      `HTTP_${response.status}`,
      `单词查询服务返回非 JSON 响应: ${rawResponseText.slice(0, 100)}`
    )
  }

  if (!response.ok) {
    throw new WordLookupServiceError(
      `HTTP_${response.status}`,
      getErrorMessage(data, response.status)
    )
  }

  const usage = data.data?.usage ?? data.usage
  if (usage) {
    console.log('[main] 单词查询 token 用量:', {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0
    })
  }

  const rawResult = extractMessageText(data)
  if (!rawResult) {
    throw new WordLookupServiceError('EMPTY_RESPONSE', '单词查询没有返回可用内容')
  }

  const correspondingSentence =
    request.wordSide === 'target' ? request.sourceSentence : request.targetSentence

  return parseWordLookupResult(rawResult, correspondingSentence)
}

/** 查询任意英文单词在当前上下文中的中文释义 */
export const lookupWord = async (request: WordLookupRequest): Promise<WordLookupResponse> => {
  try {
    const word = request.word.trim()
    const sourceSentence = request.sourceSentence.trim()
    const targetSentence = request.targetSentence.trim()
    const wordSide: WordLookupSide = request.wordSide === 'target' ? 'target' : 'source'
    const clickedSentence = wordSide === 'target' ? targetSentence : sourceSentence

    if (!word || !sourceSentence || !targetSentence) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_WORD_LOOKUP_INPUT',
          message: '缺少单词或对应句段，无法查询释义'
        }
      }
    }

    if (!clickedSentence.toLowerCase().includes(word.toLowerCase())) {
      return {
        ok: false,
        error: {
          code: 'WORD_NOT_IN_SENTENCE',
          message: '点击的单词不在当前句段中'
        }
      }
    }

    const config = getLLMConfig()
    const route = resolveModelRoute(config, request.options)

    if (!route.apiKey) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_MISSING_API_KEY',
          message: `未配置服务商【${route.provider?.name || '当前服务商'}】的 API Key`
        }
      }
    }

    if (!route.baseUrl) {
      return {
        ok: false,
        error: {
          code: 'CONFIG_MISSING_BASE_URL',
          message: `服务商【${route.provider?.name || '当前服务商'}】缺少 Base URL`
        }
      }
    }

    if (route.providerType === 'mock') {
      return {
        ok: true,
        result: {
          kind: 'lexical',
          lemma: word.toLowerCase(),
          literalMeaning: '字面义（模拟）',
          meaning: '此处释义（模拟）',
          targetText: ''
        }
      }
    }

    if (route.providerType !== 'openai-compatible') {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: '当前服务商不支持单词释义查询'
        }
      }
    }

    console.log('[main] 开始查询单词上下文释义:', {
      providerId: route.provider?.id,
      model: route.model,
      word,
      wordSide,
      sourceLength: sourceSentence.length,
      targetLength: targetSentence.length
    })

    const result = await requestWordLookup(
      {
        ...request,
        word,
        wordSide,
        sourceSentence,
        targetSentence
      },
      route
    )

    if (!result) {
      return {
        ok: false,
        error: {
          code: 'WORD_LOOKUP_UNRELIABLE',
          message: '无法确认该词在当前语境中的可靠释义'
        }
      }
    }

    return {
      ok: true,
      result
    }
  } catch (error) {
    console.error('[main] 单词上下文释义查询失败:', error)

    if (error instanceof WordLookupServiceError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      }
    }

    return {
      ok: false,
      error: {
        code: 'WORD_LOOKUP_NETWORK_ERROR',
        message: error instanceof Error ? error.message : '单词查询服务发生未知错误'
      }
    }
  }
}
