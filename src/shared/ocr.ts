/**
 * OCR 阶段状态：主进程在截图完成后、识别进行中时推送给渲染进程，
 * 用于在界面上显示「正在识别」而不是让用户以为界面卡住了。
 */
export type OcrStatus =
  /**
   * pending: 识别进行中（首次冷启动时可能持续 30~60s，因为要现场编译 Vision 模型）
   * idle: 识别已结束且成功，识别文本随后通过 translate:apply-source-text 送达
   * error: 识别或截屏失败，界面应展示 message 而不是把它当成源文本
   */
  { phase: 'pending' } | { phase: 'idle' } | { phase: 'error'; message: string }
