/** 主窗口固定宽度 */
export const MAIN_WINDOW_WIDTH = 358

/** 顶部区域由单行改为两行后新增的高度 */
export const HEADER_EXTRA_HEIGHT = 34

/** 改造前的窗口高度基准，顶部新增高度统一从 HEADER_EXTRA_HEIGHT 叠加 */
const BASE_WINDOW_HEIGHT_MIN = 240
const BASE_NORMAL_WINDOW_HEIGHT_MAX = 480

/** 主窗口最小高度，保持单行输入时的紧凑机身 */
export const MAIN_WINDOW_HEIGHT_MIN = BASE_WINDOW_HEIGHT_MIN + HEADER_EXTRA_HEIGHT

/** 普通翻译模式的最大高度，保持紧凑，超出内容在译文区内部滚动 */
export const NORMAL_WINDOW_HEIGHT_MAX = BASE_NORMAL_WINDOW_HEIGHT_MAX + HEADER_EXTRA_HEIGHT
