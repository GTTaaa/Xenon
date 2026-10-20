import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ChatCompletionStreamError,
  consumeChatCompletionTextStream,
  extractChatCompletionText
} from '../chatCompletionStream.ts'

/** 构造一段可读流，用于模拟服务端连续下发 SSE 分片 */
const createStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  let index = 0

  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (index >= chunks.length) {
        controller.close()
        return
      }

      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
}

/** 构造按原始字节切分的流，用于验证 UTF-8 多字节字符跨分片解码 */
const createByteStream = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => {
  let index = 0

  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (index >= chunks.length) {
        controller.close()
        return
      }

      controller.enqueue(chunks[index])
      index += 1
    }
  })
}

/** 构造一条标准 OpenAI 兼容流式内容分片 */
const buildChunk = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

test('跨网络分片的 SSE 会逐片回调并拼接完整译文', async () => {
  const deltas: string[] = []
  const fullPayload = `${buildChunk('你好')}${buildChunk('，世界')}data: [DONE]\n\n`
  const result = await consumeChatCompletionTextStream(
    createStream([fullPayload.slice(0, 13), fullPayload.slice(13, 35), fullPayload.slice(35)]),
    (delta) => deltas.push(delta)
  )

  assert.deepEqual(deltas, ['你好', '，世界'])
  assert.equal(result.text, '你好，世界')
  assert.equal(result.contentChunkCount, 2)
})

test('UTF-8 多字节字符被网络分片截断时仍能正确解码', async () => {
  const encoded = new TextEncoder().encode(`${buildChunk('中文译文')}data: [DONE]\n\n`)
  const splitIndex = encoded.findIndex((byte, index) => index > 0 && byte >= 0xe4) + 1
  const result = await consumeChatCompletionTextStream(
    createByteStream([encoded.slice(0, splitIndex), encoded.slice(splitIndex)])
  )

  assert.equal(result.text, '中文译文')
})

test('服务端忽略 stream 参数时从整段 JSON 中兜底提取正文', async () => {
  const wholeResponse = JSON.stringify({
    choices: [{ message: { content: '整段译文' } }]
  })
  const deltas: string[] = []
  const result = await consumeChatCompletionTextStream(createStream([wholeResponse]), (delta) =>
    deltas.push(delta)
  )

  assert.deepEqual(deltas, ['整段译文'])
  assert.equal(result.text, '整段译文')
  assert.equal(result.contentChunkCount, 1)
})

test('跨分片的 think 标签内容不会出现在增量译文中', async () => {
  const deltas: string[] = []
  const payload = [
    buildChunk('<thi'),
    buildChunk('nk>内部推理</th'),
    buildChunk('ink>正式译文'),
    'data: [DONE]\n\n'
  ].join('')

  const result = await consumeChatCompletionTextStream(createStream([payload]), (delta) =>
    deltas.push(delta)
  )

  assert.equal(deltas.join(''), '正式译文')
  assert.equal(result.text, '正式译文')
})

test('流式响应中的业务错误会抛出专用异常', async () => {
  const payload = `data: ${JSON.stringify({ error: { message: '模型额度不足' } })}\n\n`

  await assert.rejects(
    () => consumeChatCompletionTextStream(createStream([payload])),
    (error: unknown) =>
      error instanceof ChatCompletionStreamError && error.message.includes('模型额度不足')
  )
})

test('正文提取兼容网关 data.choices 包裹结构', () => {
  const text = extractChatCompletionText({
    data: {
      choices: [{ message: { content: '网关包裹译文' } }]
    }
  })

  assert.equal(text, '网关包裹译文')
})
