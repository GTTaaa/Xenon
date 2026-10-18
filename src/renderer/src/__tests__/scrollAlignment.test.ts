import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePairScrollTop } from '../scrollAlignment.ts'

const baseContainer = {
  scrollTop: 100,
  scrollHeight: 600,
  clientHeight: 200,
  viewportTop: 50,
  viewportBottom: 250
}

test('对应片段已经完整可见时不触发自动滚动', () => {
  const nextScrollTop = calculatePairScrollTop(baseContainer, [{ top: 80, bottom: 120 }])

  assert.equal(nextScrollTop, null)
})

test('对应片段在可视区上方时向上滚动到安全位置', () => {
  const nextScrollTop = calculatePairScrollTop(baseContainer, [{ top: 30, bottom: 60 }])

  assert.equal(nextScrollTop, 72)
})

test('对应片段在可视区下方时向下滚动到安全位置', () => {
  const nextScrollTop = calculatePairScrollTop(baseContainer, [{ top: 230, bottom: 270 }])

  assert.equal(nextScrollTop, 128)
})

test('多行片段跨越可视区时向下滚动展示末尾', () => {
  const nextScrollTop = calculatePairScrollTop(baseContainer, [
    { top: 100, bottom: 170 },
    { top: 180, bottom: 260 }
  ])

  assert.equal(nextScrollTop, 118)
})

test('片段高于可视区时优先展示片段开头', () => {
  const nextScrollTop = calculatePairScrollTop(baseContainer, [{ top: 120, bottom: 420 }])

  assert.equal(nextScrollTop, 162)
})

test('目标滚动位置不会超出容器有效范围', () => {
  const nextScrollTop = calculatePairScrollTop(
    {
      ...baseContainer,
      scrollTop: 390
    },
    [{ top: 400, bottom: 440 }]
  )

  assert.equal(nextScrollTop, 400)
})
