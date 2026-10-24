import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceCrowdActor,
  createCrowdActor,
  getCrowdSpriteMetrics,
  type CrowdActorSettings
} from '../crowdAnimation.ts'

const settings: CrowdActorSettings = {
  count: 14,
  minHeight: 61,
  maxHeight: 82,
  minSpeed: 20,
  maxSpeed: 35,
  minAlpha: 0.82,
  maxAlpha: 1,
  minOffset: -7,
  maxOffset: 6
}

const sprite = getCrowdSpriteMetrics(3600, 2268)
const fixedRandom = (): number => 0.42

test('人物精灵表会按 15 列和 7 行换算单帧尺寸', () => {
  assert.deepEqual(sprite, {
    columns: 15,
    rows: 7,
    cellWidth: 240,
    cellHeight: 324
  })
})

test('新建人物拥有合法且完整的取帧坐标', () => {
  const actor = createCrowdActor(320, sprite, settings, fixedRandom)

  assert.ok(Number.isInteger(actor.row))
  assert.ok(actor.row >= 0 && actor.row < sprite.rows)
  assert.ok(Number.isInteger(actor.column))
  assert.ok(actor.column >= 0 && actor.column < sprite.columns)
  assert.ok(actor.height >= settings.minHeight && actor.height <= settings.maxHeight)
  assert.ok(Number.isFinite(actor.x))
})

test('人物走出右边界后会重新获得合法造型并从左侧进入', () => {
  const actor = {
    ...createCrowdActor(320, sprite, settings, fixedRandom),
    direction: 1 as const,
    x: 500
  }
  const nextActor = advanceCrowdActor(actor, 1 / 60, 320, sprite, settings, fixedRandom)

  assert.equal(nextActor.direction, 1)
  assert.ok(nextActor.x < 0)
  assert.ok(Number.isInteger(nextActor.row))
  assert.ok(Number.isInteger(nextActor.column))
  assert.ok(nextActor.row >= 0 && nextActor.row < sprite.rows)
  assert.ok(nextActor.column >= 0 && nextActor.column < sprite.columns)
})

test('长时间循环后所有人物仍保留有效取帧坐标，不会整块变空', () => {
  let actors = Array.from({ length: settings.count }, () =>
    createCrowdActor(320, sprite, settings, fixedRandom)
  )

  for (let frame = 0; frame < 60 * 120; frame += 1) {
    actors = actors.map((actor) =>
      advanceCrowdActor(actor, 1 / 60, 320, sprite, settings, fixedRandom)
    )
  }

  actors.forEach((actor) => {
    assert.ok(Number.isFinite(actor.x))
    assert.ok(Number.isInteger(actor.row))
    assert.ok(Number.isInteger(actor.column))
    assert.ok(actor.row >= 0 && actor.row < sprite.rows)
    assert.ok(actor.column >= 0 && actor.column < sprite.columns)
  })
})
