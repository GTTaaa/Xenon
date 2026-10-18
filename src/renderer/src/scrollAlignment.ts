/** 可见区域内的矩形边界，单位为屏幕像素 */
export interface ScrollRectBoundary {
  /** 矩形上边 */
  top: number
  /** 矩形下边 */
  bottom: number
}

/** 计算目标滚动位置所需的容器状态 */
export interface ScrollContainerMetrics {
  /** 当前滚动位置 */
  scrollTop: number
  /** 可滚动内容总高度 */
  scrollHeight: number
  /** 容器可视高度 */
  clientHeight: number
  /** 容器可视区域上边 */
  viewportTop: number
  /** 容器可视区域下边 */
  viewportBottom: number
}

/** 定位目标与容器边缘之间保留的安全距离 */
const SCROLL_SAFE_MARGIN = 8

/**
 * 计算把对应片段带入可视区所需的滚动位置。
 * 已经在安全区域内时返回 null，避免无意义的自动滚动。
 */
export const calculatePairScrollTop = (
  container: ScrollContainerMetrics,
  pairRects: ScrollRectBoundary[]
): number | null => {
  if (pairRects.length === 0) return null

  const visibleTop = container.viewportTop + SCROLL_SAFE_MARGIN
  const visibleBottom = container.viewportBottom - SCROLL_SAFE_MARGIN
  const visibleHeight = Math.max(0, visibleBottom - visibleTop)
  const pairTop = Math.min(...pairRects.map((rect) => rect.top))
  const pairBottom = Math.max(...pairRects.map((rect) => rect.bottom))
  const pairHeight = pairBottom - pairTop

  let delta = 0
  if (pairHeight >= visibleHeight) {
    // 片段本身高于可视区时优先展示开头，避免用户从句子中间开始阅读
    delta = pairTop - visibleTop
  } else if (pairTop < visibleTop) {
    delta = pairTop - visibleTop
  } else if (pairBottom > visibleBottom) {
    delta = pairBottom - visibleBottom
  } else {
    return null
  }

  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  return Math.round(Math.max(0, Math.min(container.scrollTop + delta, maxScrollTop)))
}
