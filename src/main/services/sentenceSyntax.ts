import { net } from 'electron'
import { resolveAlignmentReasoningEffort } from '../../shared/alignmentReasoning'
import {
  buildSentenceSyntaxSystemPrompt,
  buildSentenceSyntaxUserMessage,
  parseSentenceSyntaxAnalysis,
  type SentenceSyntaxAnalysis,
  type SentenceSyntaxResponse
} from '../../shared/sentenceSyntax'
import type { TranslateOptions } from '../../shared/translate'
import { getLLMConfig } from './configManager'
import { resolveModelRoute, type ModelRoute } from './modelRoute'

class SentenceSyntaxServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SentenceSyntaxServiceError'
    this.code = code
  }
}

/** 兼容服务商返回的 token 用量信息 */
interface SentenceSyntaxUsage {
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

/** 长难句分析接口返回体 */
interface SentenceSyntaxResponseBody {
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
    usage?: SentenceSyntaxUsage
  }
  usage?: SentenceSyntaxUsage
  error?:
    | {
        message?: string
      }
    | string
}

/** 从兼容 OpenAI 的响应中提取正文 */
const extractMessageText = (data: SentenceSyntaxResponseBody): string => {
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
const getErrorMessage = (data: SentenceSyntaxResponseBody, status: number): string => {
  const error = data.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object' && error.message?.trim()) return error.message.trim()
  return `主干拆解请求失败：${status}`
}

/** 请求当前模型把英文长句切成连续语法片段 */
const requestSentenceSyntax = async (
  sentence: string,
  targetTranslation: string,
  route: ModelRoute
): Promise<SentenceSyntaxAnalysis> => {
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
      stream: false,
      temperature: 0.1,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      messages: [
        {
          role: 'system',
          content: buildSentenceSyntaxSystemPrompt()
        },
        {
          role: 'user',
          content: buildSentenceSyntaxUserMessage({
            sentence,
            targetTranslation
          })
        }
      ]
    })
  })

  const rawResponseText = await response.text()
  let data: SentenceSyntaxResponseBody

  try {
    data = JSON.parse(rawResponseText)
  } catch {
    throw new SentenceSyntaxServiceError(
      `HTTP_${response.status}`,
      `主干拆解服务返回非 JSON 响应: ${rawResponseText.slice(0, 100)}`
    )
  }

  if (!response.ok) {
    throw new SentenceSyntaxServiceError(
      `HTTP_${response.status}`,
      getErrorMessage(data, response.status)
    )
  }

  const usage = data.data?.usage ?? data.usage
  if (usage) {
    console.log('[main] 主干拆解 token 用量:', {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0
    })
  }

  const rawAnalysis = extractMessageText(data)
  if (!rawAnalysis) {
    throw new SentenceSyntaxServiceError('EMPTY_RESPONSE', '主干拆解没有返回可用内容')
  }

  const analysis = parseSentenceSyntaxAnalysis(rawAnalysis, sentence)
  if (!analysis) {
    throw new SentenceSyntaxServiceError(
      'INVALID_SYNTAX_ANALYSIS',
      '主干拆解结果未能严格覆盖原句，已拒绝展示'
    )
  }

  return analysis
}

/** 按需分析一个英文长句的主谓宾骨架与修饰成分 */
export const analyzeSentenceSyntax = async (
  sentence: string,
  targetTranslation = '',
  options?: TranslateOptions
): Promise<SentenceSyntaxResponse> => {
  try {
    const normalizedSentence = sentence.trim()
    if (!normalizedSentence) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_SYNTAX_INPUT',
          message: '缺少需要分析的英文句子'
        }
      }
    }

    const config = getLLMConfig()
    const route = resolveModelRoute(config, options)

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
        analysis: {
          coreSpine: normalizedSentence,
          segments: [
            {
              text: normalizedSentence,
              isCore: true,
              role: '主干',
              type: 'predicate'
            }
          ],
          note: '模拟模式仅展示完整句子主干'
        }
      }
    }

    if (route.providerType !== 'openai-compatible') {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: '当前服务商不支持长难句主干拆解'
        }
      }
    }

    const analysis = await requestSentenceSyntax(
      normalizedSentence,
      targetTranslation.trim(),
      route
    )
    return {
      ok: true,
      analysis
    }
  } catch (error) {
    console.error('[main] 长难句主干拆解失败:', error)
    if (error instanceof SentenceSyntaxServiceError) {
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
        code: 'SYNTAX_NETWORK_ERROR',
        message: error instanceof Error ? error.message : '主干拆解服务发生未知错误'
      }
    }
  }
}
