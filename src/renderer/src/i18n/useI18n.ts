import { createContext, useContext } from 'react'
import type { AppLanguage } from '../../../shared/config'
import type { Translate } from '../../../shared/i18n'

export interface I18nContextValue {
  /** 当前界面语言 */
  language: AppLanguage
  /** 切换界面语言，同时更新本地缓存与文档语言标记 */
  setLanguage: (language: AppLanguage) => void
  /** 当前语言对应的翻译函数 */
  t: Translate
}

export const I18nContext = createContext<I18nContextValue | null>(null)

/** 在组件中读取当前界面语言与翻译函数 */
export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n 必须在 I18nProvider 内使用')
  }
  return context
}
