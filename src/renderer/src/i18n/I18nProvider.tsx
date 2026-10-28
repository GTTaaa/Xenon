import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppLanguage } from '../../../shared/config'
import { createTranslator, DEFAULT_APP_LANGUAGE, normalizeAppLanguage } from '../../../shared/i18n'
import { I18nContext, type I18nContextValue } from './useI18n'

const LANGUAGE_STORAGE_KEY = 'appLanguage'

/** 从本地缓存恢复最近一次界面语言，避免配置异步加载期间出现语言闪烁 */
const getInitialLanguage = (): AppLanguage => {
  try {
    return normalizeAppLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return DEFAULT_APP_LANGUAGE
  }
}

/**
 * 应用级国际化上下文。
 * 界面语言既会写入本地缓存，也会随偏好设置持久化到主进程配置文件。
 */
export const I18nProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage)
  const t = useMemo(() => createTranslator(language), [language])

  const setLanguage = useCallback((nextLanguage: AppLanguage): void => {
    const normalized = normalizeAppLanguage(nextLanguage)
    setLanguageState(normalized)
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized)
    } catch {
      // 本地缓存不可用时仍允许当前会话正常切换语言
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
