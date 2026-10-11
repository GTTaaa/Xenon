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
  /** 指定服务提供商 ID，如 'deepseek' 或 'cline' */
  providerId?: string
  /** 指定模型 ID，如 'deepseek-chat' 或 'cline-pass/deepseek-v4.1-flash' */
  model?: string
}
