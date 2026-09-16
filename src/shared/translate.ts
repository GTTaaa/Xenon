export interface TranslateRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  options?: TranslateOptions
}

export interface TranslateSuccessResponse {
  ok: true
  text: string
}
export interface TranslateErrorResponse {
  ok: false
  error: {
    code: string
    message: string
  }
}
export type TranslateResponse = TranslateSuccessResponse | TranslateErrorResponse

export interface TranslateOptions {
  model?: string
  /** 是否开启大模型深度思考/推理模式 */
  enableThinking?: boolean
}
