import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeChatCompletionStream, calculateTokensPerSecond } from '../streamSpeed.ts'

/**
 * 构造一段可读流，按给定分片顺序吐出数据，用于模拟服务端的流式响应
 *
 * @param chunks 依次下发的响应分片
 * @param delayMs 分片之间的间隔毫秒数，用于模拟真实的吐字节奏
 */
const createSseStream = (chunks: string[], delayMs = 0): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      if (delayMs > 0 && index > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
}

/**
 * 构造一条标准的 OpenAI 兼容流式分片
 */
const buildContentChunk = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

test('服务端返回 usage 时采用精确 token 数', async () => {
  const chunks = [
    buildContentChunk('1 '),
    buildContentChunk('2 '),
    buildContentChunk('3 '),
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: 42 } })}\n\n`,
    'data: [DONE]\n\n'
  ]

  const stats = await consumeChatCompletionStream(createSseStream(chunks, 60), Date.now())

  assert.equal(stats.hasContent, true)
  assert.equal(stats.outputTokens, 42)
  assert.equal(stats.estimated, false)
  assert.ok(stats.firstTokenMs >= 0)
  assert.ok(stats.totalMs >= stats.firstTokenMs)
})

test('服务端未返回 usage 时按内容分片数量估算', async () => {
  const chunks = [buildContentChunk('1 '), buildContentChunk('2 '), buildContentChunk('3 ')]

  const stats = await consumeChatCompletionStream(createSseStream(chunks), Date.now())

  assert.equal(stats.hasContent, true)
  assert.equal(stats.outputTokens, 3)
  assert.equal(stats.estimated, true)
})

test('推理模型的 reasoning_content 也算作有效输出', async () => {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: '答案' } }] })}\n\n`
  ]

  const stats = await consumeChatCompletionStream(createSseStream(chunks), Date.now())

  assert.equal(stats.hasContent, true)
  assert.equal(stats.outputTokens, 2)
})

test('服务端忽略 stream 参数返回整段 JSON 时按兜底逻辑统计', async () => {
  const payload = JSON.stringify({
    choices: [{ message: { content: '1 2 3 4' } }],
    usage: { completion_tokens: 9 }
  })

  const stats = await consumeChatCompletionStream(createSseStream([payload]), Date.now())

  assert.equal(stats.hasContent, true)
  assert.equal(stats.outputTokens, 9)
  // 兜底场景的耗时包含首包延迟，速度只能算估算值
  assert.equal(stats.estimated, true)
})

test('跨分片截断的 SSE 数据也能正确拼接解析', async () => {
  const fullPayload = buildContentChunk('你好') + buildContentChunk('世界')
  const chunks = [fullPayload.slice(0, 17), fullPayload.slice(17)]

  const stats = await consumeChatCompletionStream(createSseStream(chunks), Date.now())

  assert.equal(stats.hasContent, true)
  assert.equal(stats.outputTokens, 2)
})

test('输出速度按生成阶段（扣除首 token 延迟）换算', () => {
  const speed = calculateTokensPerSecond({
    firstTokenMs: 200,
    totalMs: 1200,
    outputTokens: 100,
    estimated: false,
    hasContent: true
  })

  // 100 个 token 用了 1000ms，即每秒 100 个
  assert.equal(speed, 100)
})

test('输出过短或没有内容时不给出速度', () => {
  const tooShort = calculateTokensPerSecond({
    firstTokenMs: 200,
    totalMs: 250,
    outputTokens: 3,
    estimated: true,
    hasContent: true
  })
  assert.equal(tooShort, undefined)

  const noContent = calculateTokensPerSecond({
    firstTokenMs: 0,
    totalMs: 500,
    outputTokens: 0,
    estimated: true,
    hasContent: false
  })
  assert.equal(noContent, undefined)
})
