export interface TranslateRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  options: TranslateOptions
}

export interface TranslateResponse {
  text: string
}

export interface TranslateOptions {
  model: string
}
