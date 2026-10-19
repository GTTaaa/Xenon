import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePairScrollTop, findFirstVisiblePairId } from '../scrollAlignment.ts'

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

test('选择第一个进入可视区的对齐组作为同步锚点', () => {
  const pairId = findFirstVisiblePairId({ top: 50, bottom: 250 }, [
    { id: 'p0', rects: [{ top: 10, bottom: 42 }] },
    { id: 'p1', rects: [{ top: 48, bottom: 76 }] },
    { id: 'p2', rects: [{ top: 90, bottom: 130 }] }
  ])

  assert.equal(pairId, 'p1')
})

test('跨行对齐组只有末尾进入可视区时仍可作为锚点', () => {
  const pairId = findFirstVisiblePairId({ top: 50, bottom: 250 }, [
    { id: 'p0', rects: [{ top: 10, bottom: 48 }] },
    {
      id: 'p1',
      rects: [
        { top: 20, bottom: 46 },
        { top: 52, bottom: 80 }
      ]
    }
  ])

  assert.equal(pairId, 'p1')
})

test('没有对齐组进入可视区时不选择锚点', () => {
  const pairId = findFirstVisiblePairId({ top: 50, bottom: 250 }, [
    { id: 'p0', rects: [{ top: 10, bottom: 40 }] },
    { id: 'p1', rects: [{ top: 260, bottom: 290 }] }
  ])

  assert.equal(pairId, null)
})
