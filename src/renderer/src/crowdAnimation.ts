/** 人物精灵表按 15 列、7 行排列；原组件把行列命名写反，这里统一改为直观命名 */
export const CROWD_SPRITE_COLUMNS = 15
export const CROWD_SPRITE_ROWS = 7

/** 人物精灵表中一个角色的尺寸 */
export interface CrowdSpriteMetrics {
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
}

/** 控制近景人群密度与尺度的一组参数 */
export interface CrowdActorSettings {
  count: number
  minHeight: number
  maxHeight: number
  minSpeed: number
  maxSpeed: number
  minAlpha: number
  maxAlpha: number
  minOffset: number
  maxOffset: number
}

/** 一个持续穿过卡面的人物 */
export interface CrowdActor {
  x: number
  height: number
  drawWidth: number
  direction: 1 | -1
  speed: number
  alpha: number
  baseOffset: number
  phase: number
  row: number
  column: number
}

type RandomSource = () => number

const randomBetween = (min: number, max: number, random: RandomSource): number => {
  return min + random() * (max - min)
}

/** 随机取一个合法帧编号，避免随机源返回 1 时越界 */
const randomIndex = (length: number, random: RandomSource): number => {
  return Math.min(length - 1, Math.floor(random() * length))
}

/** 根据原始精灵图尺寸换算单个人物的取帧区域 */
export const getCrowdSpriteMetrics = (width: number, height: number): CrowdSpriteMetrics => {
  return {
    columns: CROWD_SPRITE_COLUMNS,
    rows: CROWD_SPRITE_ROWS,
    cellWidth: width / CROWD_SPRITE_COLUMNS,
    cellHeight: height / CROWD_SPRITE_ROWS
  }
}

/** 重置角色造型，但不改变原本的行进方向，让每个人从同一侧重新进入 */
const resetCrowdActor = (
  actor: CrowdActor,
  viewportWidth: number,
  sprite: CrowdSpriteMetrics,
  settings: CrowdActorSettings,
  random: RandomSource
): CrowdActor => {
  const height = randomBetween(settings.minHeight, settings.maxHeight, random)
  const drawWidth = height * (sprite.cellWidth / sprite.cellHeight)
  const edgeOffset = drawWidth * 0.55

  return {
    ...actor,
    x: actor.direction === 1 ? -edgeOffset : viewportWidth + edgeOffset,
    height,
    drawWidth,
    speed: randomBetween(settings.minSpeed, settings.maxSpeed, random),
    alpha: randomBetween(settings.minAlpha, settings.maxAlpha, random),
    baseOffset: randomBetween(settings.minOffset, settings.maxOffset, random),
    phase: randomBetween(0, Math.PI * 2, random),
    row: randomIndex(sprite.rows, random),
    column: randomIndex(sprite.columns, random)
  }
}

/** 创建初始人物，并在卡面宽度范围内错开出场位置 */
export const createCrowdActor = (
  viewportWidth: number,
  sprite: CrowdSpriteMetrics,
  settings: CrowdActorSettings,
  random: RandomSource = Math.random
): CrowdActor => {
  const direction: 1 | -1 = random() > 0.5 ? 1 : -1
  const actor: CrowdActor = {
    x: 0,
    height: settings.minHeight,
    drawWidth: 0,
    direction,
    speed: settings.minSpeed,
    alpha: settings.minAlpha,
    baseOffset: 0,
    phase: 0,
    row: 0,
    column: 0
  }
  const resetActor = resetCrowdActor(actor, viewportWidth, sprite, settings, random)

  return {
    ...resetActor,
    x: randomBetween(
      -resetActor.drawWidth * 0.35,
      viewportWidth + resetActor.drawWidth * 0.35,
      random
    )
  }
}

/**
 * 推进人物位置；走出边界时重新抽取造型和取帧坐标。
 * 这里必须是纯函数，方便测试覆盖“走完一轮后画面变空”的回归问题。
 */
export const advanceCrowdActor = (
  actor: CrowdActor,
  deltaSeconds: number,
  viewportWidth: number,
  sprite: CrowdSpriteMetrics,
  settings: CrowdActorSettings,
  random: RandomSource = Math.random
): CrowdActor => {
  const nextX = actor.x + actor.direction * actor.speed * deltaSeconds
  const edgeOffset = actor.drawWidth * 0.55
  const walkedPastRight = actor.direction === 1 && nextX - edgeOffset > viewportWidth
  const walkedPastLeft = actor.direction === -1 && nextX + edgeOffset < 0

  if (walkedPastRight || walkedPastLeft) {
    return resetCrowdActor(actor, viewportWidth, sprite, settings, random)
  }

  return { ...actor, x: nextX }
}
