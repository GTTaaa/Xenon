/** 主窗口固定宽度 */
export const MAIN_WINDOW_WIDTH = 358

/** 学习模式宽度：左侧固定结构栏，右侧保留原文与译文 */
export const LEARNING_WINDOW_WIDTH = 560

/** 整句结构展开时，左侧面板从窗口边缘揭开的过渡时长 */
export const STRUCTURE_LAYOUT_TRANSITION_MS = 240

/** 整句结构收起时，面板先完成退场，再缩回窗口宽度 */
export const STRUCTURE_LAYOUT_COLLAPSE_MS = 180

/** 主窗口的两种程序化布局，不允许用户手动拖拽改变宽度 */
export type WindowLayoutMode = 'normal' | 'learning'

/** 主窗口最小高度，保持单行输入时的紧凑机身 */
export const MAIN_WINDOW_HEIGHT_MIN = 240

/** 主窗口最大高度，需完整容纳学习模式 15 行对照内容和底部工具行 */
export const MAIN_WINDOW_HEIGHT_MAX = 840

/** 普通翻译模式的最大高度，保持紧凑，超出内容在译文区内部滚动 */
export const NORMAL_WINDOW_HEIGHT_MAX = 480
