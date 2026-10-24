import { useEffect, useRef } from 'react'
import peepSheetUrl from '../assets/open-peeps/all-peeps.png'
import {
  advanceCrowdActor,
  createCrowdActor,
  getCrowdSpriteMetrics,
  type CrowdActor,
  type CrowdActorSettings,
  type CrowdSpriteMetrics
} from '../crowdAnimation'

/** W2 近景人群的密度、尺寸和行进速度 */
const CROWD_SETTINGS: CrowdActorSettings = {
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

/** 在偶遇复习卡片的翻页正面绘制持续行走的人群 */
export function EncounterCrowdCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduceMotion = motionQuery.matches
    let disposed = false
    let animationFrame: number | null = null
    let lastFrameTime = 0
    let viewportWidth = 0
    let viewportHeight = 0
    let pixelRatio = 1
    let sprite: CrowdSpriteMetrics | null = null
    let actors: CrowdActor[] = []

    /** 取消当前动画帧，避免卡片换页后继续占用渲染资源 */
    const stopAnimation = (): void => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
    }

    /** 按当前卡面尺寸重设高分屏画布，并保持人物相对位置不变 */
    const resizeCanvas = (): void => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const previousWidth = viewportWidth
      viewportWidth = rect.width
      viewportHeight = rect.height
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(viewportWidth * pixelRatio)
      canvas.height = Math.round(viewportHeight * pixelRatio)

      if (!sprite) return

      if (actors.length === 0) {
        const activeSprite = sprite
        actors = Array.from({ length: CROWD_SETTINGS.count }, () =>
          createCrowdActor(viewportWidth, activeSprite, CROWD_SETTINGS)
        )
      } else if (previousWidth > 0 && previousWidth !== viewportWidth) {
        const ratio = viewportWidth / previousWidth
        actors = actors.map((actor) => ({ ...actor, x: actor.x * ratio }))
      }
    }

    /** 清空画布并绘制当前帧；每一步都同时推进人物位置 */
    const paintCrowd = (time: number, deltaSeconds: number): void => {
      if (!sprite || viewportWidth <= 0 || viewportHeight <= 0) return
      const activeSprite = sprite

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, viewportWidth, viewportHeight)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      actors = actors.map((actor) =>
        advanceCrowdActor(actor, deltaSeconds, viewportWidth, activeSprite, CROWD_SETTINGS)
      )

      const orderedActors = [...actors].sort((left, right) => left.height - right.height)
      orderedActors.forEach((actor) => {
        const bob = Math.sin(time * 0.008 + actor.phase) * 1.8
        const sway = Math.sin(time * 0.006 + actor.phase * 0.7) * 0.012

        context.save()
        context.globalAlpha = actor.alpha
        context.translate(actor.x, viewportHeight - actor.height + actor.baseOffset + bob)
        context.rotate(sway * actor.direction)
        context.scale(actor.direction, 1)
        context.drawImage(
          image,
          actor.column * activeSprite.cellWidth,
          actor.row * activeSprite.cellHeight,
          activeSprite.cellWidth,
          activeSprite.cellHeight,
          -actor.drawWidth / 2,
          0,
          actor.drawWidth,
          actor.height
        )
        context.restore()
      })
    }

    /** 用真实时间推进动画，页面恢复时限制首帧步长，避免人物瞬移 */
    const tick = (time: number): void => {
      if (disposed || reduceMotion) return
      const deltaSeconds = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.05) : 0
      lastFrameTime = time
      paintCrowd(time, deltaSeconds)
      animationFrame = window.requestAnimationFrame(tick)
    }

    /** 只有在允许动态效果且页面可见时启动动画 */
    const startAnimation = (): void => {
      if (disposed || reduceMotion || document.hidden || animationFrame !== null) return
      lastFrameTime = 0
      animationFrame = window.requestAnimationFrame(tick)
    }

    /** 降低动态效果时只绘制一张静态人群 */
    const renderStillFrame = (): void => {
      if (reduceMotion) paintCrowd(0, 0)
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
      renderStillFrame()
    })
    resizeObserver.observe(canvas)

    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (disposed) return
      sprite = getCrowdSpriteMetrics(image.naturalWidth, image.naturalHeight)
      resizeCanvas()
      renderStillFrame()
      startAnimation()
    }
    image.src = peepSheetUrl

    const handleMotionChange = (event: MediaQueryListEvent): void => {
      reduceMotion = event.matches
      if (reduceMotion) {
        stopAnimation()
        renderStillFrame()
      } else {
        startAnimation()
      }
    }

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        stopAnimation()
      } else {
        startAnimation()
      }
    }

    motionQuery.addEventListener('change', handleMotionChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      stopAnimation()
      resizeObserver.disconnect()
      motionQuery.removeEventListener('change', handleMotionChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <div className="vocab-flashcard-crowd-stage" aria-hidden="true">
      <canvas ref={canvasRef} className="vocab-flashcard-crowd-canvas" />
      <span className="vocab-flashcard-crowd-ground" />
      <span className="vocab-flashcard-crowd-crop" />
    </div>
  )
}
