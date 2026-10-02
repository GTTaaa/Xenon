import { useRef, useEffect, useCallback } from 'react'

/**
 * 丝滑横向滚动配置选项
 */
export interface SmoothHorizontalScrollOptions {
  /**
   * 当前激活项的唯一标识符，改变时自动将该项平滑滚动至视野内
   */
  activeItemId?: string
  /**
   * 鼠标滚轮阻尼插值系数（0.1 ~ 0.3，默认 0.2，数值越小越柔和，数值越大响应越紧凑）
   */
  lerpFactor?: number
  /**
   * 是否启用鼠标按住拖拽滚动（默认开启）
   */
  enableDrag?: boolean
}

/**
 * 专为跨平台（macOS 触控板与高刷屏、Windows、外接机械滚轮鼠标）深度优化的丝滑横向滚动 Hook
 * 核心优化特性：
 * 1. Mac 触控板高精度横滑完全放行：绝对不阻断原生 120Hz 硬件加速物理动量与弹性回弹；
 * 2. 传统外接鼠标滚轮阻尼平滑插值：通过 requestAnimationFrame 逐帧追赶，消除生硬阶跃跳跃；
 * 3. 鼠标抓取自由拖拽（Drag to Scroll）与惯性甩动（Momentum Flick）：按住即拖，松手自然滑行，并智能过滤误触点击；
 * 4. 激活项自动居中：选中或新增渠道时柔和滑入可视区域；
 * 5. 动态溢出边缘遮罩标记：实时更新左右滚动余量状态属性。
 */
export interface SmoothHorizontalScrollReturn<T extends HTMLElement> {
  containerRef: React.RefObject<T | null>
  updateScrollMaskAttributes: () => void
}

export function useSmoothHorizontalScroll<T extends HTMLElement = HTMLDivElement>(
  options: SmoothHorizontalScrollOptions = {}
): SmoothHorizontalScrollReturn<T> {
  const { activeItemId, lerpFactor = 0.2, enableDrag = true } = options

  const containerRef = useRef<T | null>(null)
  const targetScrollRef = useRef<number>(0)
  const rafIdRef = useRef<number | null>(null)
  const flickRafIdRef = useRef<number | null>(null)

  /**
   * 停止当前所有正在执行的滚动动画
   */
  const stopAllAnimations = useCallback((): void => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (flickRafIdRef.current !== null) {
      cancelAnimationFrame(flickRafIdRef.current)
      flickRafIdRef.current = null
    }
  }, [])

  /**
   * 刷新左右溢出遮罩状态
   */
  const updateScrollMaskAttributes = useCallback((): void => {
    const el = containerRef.current
    if (!el) return

    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 1) {
      if (el.dataset.hasScrollLeft !== 'false') el.dataset.hasScrollLeft = 'false'
      if (el.dataset.hasScrollRight !== 'false') el.dataset.hasScrollRight = 'false'
      return
    }

    const hasLeft = el.scrollLeft > 3
    const hasRight = el.scrollLeft < maxScroll - 3

    const strLeft = hasLeft ? 'true' : 'false'
    const strRight = hasRight ? 'true' : 'false'

    if (el.dataset.hasScrollLeft !== strLeft) el.dataset.hasScrollLeft = strLeft
    if (el.dataset.hasScrollRight !== strRight) el.dataset.hasScrollRight = strRight
  }, [])

  // 绑定原生 wheel 监听（使用 { passive: false } 以便精确拦截非触控板滚轮）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 同步初始化滚动位置
    targetScrollRef.current = container.scrollLeft
    updateScrollMaskAttributes()

    const onScroll = (): void => {
      updateScrollMaskAttributes()
    }

    const onWheel = (e: WheelEvent): void => {
      // 1. 如果用户以横向位移为主（例如 Mac 触控板双指横向滑动、或横向鼠标滚轮）
      // 必须完全放行！让底层 120Hz 硬件加速物理动量与弹性橡皮筋完全由原生引擎处理
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) {
        stopAllAnimations()
        targetScrollRef.current = container.scrollLeft
        return
      }

      // 2. 如果是纵向滚轮驱动横向滚动（传统外接鼠标滚轮）
      const maxScroll = container.scrollWidth - container.clientWidth
      if (maxScroll <= 0) return

      const isScrollingLeft = e.deltaY < 0
      const isScrollingRight = e.deltaY > 0

      // 如果到达极端边界且继续向边界外滚，放行给外部容器纵向滚动
      if (
        (isScrollingLeft && container.scrollLeft <= 0) ||
        (isScrollingRight && container.scrollLeft >= maxScroll - 1)
      ) {
        return
      }

      // 在有效可滚动区间内，拦截页面上下晃动
      e.preventDefault()
      stopAllAnimations()

      // 行模式滚轮与像素滚轮的位移适配
      const stepDelta = e.deltaMode === 1 ? e.deltaY * 28 : e.deltaY * 0.95
      targetScrollRef.current = Math.max(
        0,
        Math.min(maxScroll, targetScrollRef.current + stepDelta)
      )

      // 启动阻尼插值追赶循环
      const animateLerp = (): void => {
        const current = container.scrollLeft
        const target = targetScrollRef.current
        const diff = target - current

        if (Math.abs(diff) < 0.6) {
          container.scrollLeft = target
          rafIdRef.current = null
          updateScrollMaskAttributes()
          return
        }

        container.scrollLeft = current + diff * lerpFactor
        updateScrollMaskAttributes()
        rafIdRef.current = requestAnimationFrame(animateLerp)
      }

      rafIdRef.current = requestAnimationFrame(animateLerp)
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('scroll', onScroll)
      stopAllAnimations()
    }
  }, [lerpFactor, stopAllAnimations, updateScrollMaskAttributes])

  // 绑定鼠标抓取拖拽（Drag to Scroll）与惯性甩动（Momentum Flick）
  useEffect(() => {
    if (!enableDrag) return
    const container = containerRef.current
    if (!container) return

    const handleMouseDown = (e: MouseEvent): void => {
      // 仅响应鼠标左键点击
      if (e.button !== 0) return

      // 停止所有未完成动画，并记录起始状态
      stopAllAnimations()
      const startX = e.clientX
      const startScrollLeft = container.scrollLeft
      let isDragging = false
      let prevX = startX
      let prevTime = performance.now()
      let velocity = 0

      const handleMouseMove = (moveEvent: MouseEvent): void => {
        const currentX = moveEvent.clientX
        const dx = currentX - startX

        // 移动超过 4px 时确认为拖拽交互
        if (!isDragging && Math.abs(dx) > 4) {
          isDragging = true
          container.classList.add('pref-tabs-dragging')
          document.body.style.userSelect = 'none'
        }

        if (isDragging) {
          container.scrollLeft = startScrollLeft - dx
          targetScrollRef.current = container.scrollLeft
          updateScrollMaskAttributes()

          const now = performance.now()
          const dt = now - prevTime
          if (dt > 8) {
            velocity = (currentX - prevX) / dt
            prevX = currentX
            prevTime = now
          }
        }
      }

      const handleMouseUp = (): void => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)

        if (isDragging) {
          container.classList.remove('pref-tabs-dragging')
          document.body.style.userSelect = ''

          // 拖拽释放时，在捕获阶段拦截单次点击事件，防止意外选中某个 Tab
          const captureClick = (clickEvent: MouseEvent): void => {
            clickEvent.stopPropagation()
            clickEvent.preventDefault()
          }
          window.addEventListener('click', captureClick, { capture: true, once: true })

          // 如果存在甩动手势初速度，执行物理惯性衰减滑行
          if (Math.abs(velocity) > 0.18) {
            let v = velocity * 14
            const friction = 0.92

            const stepFlick = (): void => {
              v *= friction
              if (Math.abs(v) < 0.5) {
                targetScrollRef.current = container.scrollLeft
                flickRafIdRef.current = null
                updateScrollMaskAttributes()
                return
              }

              container.scrollLeft -= v
              targetScrollRef.current = container.scrollLeft
              updateScrollMaskAttributes()
              flickRafIdRef.current = requestAnimationFrame(stepFlick)
            }

            flickRafIdRef.current = requestAnimationFrame(stepFlick)
          }
        }
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    container.addEventListener('mousedown', handleMouseDown)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
    }
  }, [enableDrag, stopAllAnimations, updateScrollMaskAttributes])

  // 当 activeItemId 改变或列表渲染变动时，平滑将激活项滚动至视野中偏左最佳视线区
  useEffect(() => {
    if (!activeItemId) return
    const container = containerRef.current
    if (!container) return

    // 稍微延迟一帧以等待 DOM 渲染布局完成
    const timer = setTimeout(() => {
      const activeEl = container.querySelector(
        `[data-item-id="${activeItemId}"]`
      ) as HTMLElement | null
      if (!activeEl) return

      const containerWidth = container.clientWidth
      const elOffsetLeft = activeEl.offsetLeft
      const elWidth = activeEl.offsetWidth
      const maxScroll = container.scrollWidth - containerWidth
      if (maxScroll <= 0) return

      // 将选中的项目居中对齐至容器可视区域
      const targetLeft = Math.max(
        0,
        Math.min(maxScroll, elOffsetLeft - (containerWidth - elWidth) / 2)
      )

      if (Math.abs(container.scrollLeft - targetLeft) > 10) {
        container.scrollTo({
          left: targetLeft,
          behavior: 'smooth'
        })
        targetScrollRef.current = targetLeft
      }
      updateScrollMaskAttributes()
    }, 30)

    return () => clearTimeout(timer)
  }, [activeItemId, updateScrollMaskAttributes])

  return {
    containerRef,
    updateScrollMaskAttributes
  }
}
