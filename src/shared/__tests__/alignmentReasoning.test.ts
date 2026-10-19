import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAlignmentReasoningEffort } from '../alignmentReasoning.ts'

test('DeepSeek 对齐请求关闭推理以降低等待时间', () => {
  assert.equal(resolveAlignmentReasoningEffort('deepseek-flash'), 'none')
  assert.equal(resolveAlignmentReasoningEffort('deepseek-v4-pro'), 'none')
  assert.equal(resolveAlignmentReasoningEffort('cline-pass/deepseek-v4.1-flash'), 'none')
})

test('GLM 对齐请求使用低推理强度避免触发强制推理限制', () => {
  assert.equal(resolveAlignmentReasoningEffort('cline-pass/glm-5.3-flash'), 'low')
})

test('未识别模型保留服务商默认推理配置', () => {
  assert.equal(resolveAlignmentReasoningEffort('unknown-model'), undefined)
  assert.equal(resolveAlignmentReasoningEffort('   '), undefined)
})
