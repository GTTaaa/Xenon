/**
 * 支持的语言代码枚举类型
 */
export type SupportedLanguage =
  | 'auto'
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'it'
  | 'pt'

/**
 * 语言元数据定义
 */
export interface LanguageInfo {
  /** 语言代码 */
  code: SupportedLanguage
  /** 人类可读的显示名称 */
  label: string
  /** 传递给大模型提示词的标准语言标识名 */
  promptName: string
  /** 用于紧凑界面的简短代号 */
  shortLabel: string
}

/**
 * 语言检测结果数据结构
 */
export interface DetectResult {
  /** 检测到的具体语言代码（非 'auto'） */
  detected: SupportedLanguage
  /** 判定置信度（0.0 ~ 1.0） */
  confidence: number
  /** 对应语言的元数据 */
  languageInfo: LanguageInfo
}

/**
 * 系统支持的语言定义列表
 */
export const SUPPORTED_LANGUAGES: readonly LanguageInfo[] = [
  { code: 'auto', label: '自动检测', promptName: 'AUTO', shortLabel: 'AUTO' },
  { code: 'zh', label: '中文 (简体)', promptName: 'CHINESE (SIM)', shortLabel: 'ZH' },
  { code: 'en', label: '英语 (English)', promptName: 'ENGLISH', shortLabel: 'EN' },
  { code: 'ja', label: '日语 (日本語)', promptName: 'JAPANESE', shortLabel: 'JA' },
  { code: 'ko', label: '韩语 (한국어)', promptName: 'KOREAN', shortLabel: 'KO' },
  { code: 'fr', label: '法语 (Français)', promptName: 'FRENCH', shortLabel: 'FR' },
  { code: 'de', label: '德语 (Deutsch)', promptName: 'GERMAN', shortLabel: 'DE' },
  { code: 'es', label: '西班牙语 (Español)', promptName: 'SPANISH', shortLabel: 'ES' },
  { code: 'ru', label: '俄语 (Русский)', promptName: 'RUSSIAN', shortLabel: 'RU' },
  { code: 'it', label: '意大利语 (Italiano)', promptName: 'ITALIAN', shortLabel: 'IT' },
  { code: 'pt', label: '葡萄牙语 (Português)', promptName: 'PORTUGUESE', shortLabel: 'PT' }
] as const

/** 语言元数据速查映射表 */
const LANGUAGE_INFO_MAP: Record<SupportedLanguage, LanguageInfo> = SUPPORTED_LANGUAGES.reduce(
  (map, item) => {
    map[item.code] = item
    return map
  },
  {} as Record<SupportedLanguage, LanguageInfo>
)

/**
 * 根据语言代码获取语言元数据
 */
export const getLanguageInfo = (code: SupportedLanguage): LanguageInfo => {
  return LANGUAGE_INFO_MAP[code] || LANGUAGE_INFO_MAP['en']
}

// Unicode 正则表达式定义
const REGEX_JAPANESE_KANA = /[\u3040-\u309F\u30A0-\u30FF]/ // 平假名与片假名
const REGEX_KOREAN = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/ // 韩文谚文
const REGEX_CHINESE = /[\u4E00-\u9FFF\u3400-\u4DBF]/ // CJK 汉字
const REGEX_CYRILLIC = /[\u0400-\u04FF]/ // 西里尔字母（俄语等）

// 拉丁语族专属或高权重特征字符
const EXCLUSIVE_CHARS: Record<string, RegExp> = {
  de: /[äöüßÄÖÜ]/,
  fr: /[éèêëçîïôùûœæÉÈÊËÇÎÏÔÙÛŒÆ]/,
  es: /[ñ¿¡Ñ]/,
  pt: /[ãõÃÕ]/,
  vi: /[\u1EA0-\u1EF9]/
}

// 常见拉丁语系核心高频代表词汇库
const VOCABULARY: Record<string, ReadonlySet<string>> = {
  en: new Set([
    'the',
    'be',
    'to',
    'of',
    'and',
    'a',
    'in',
    'that',
    'have',
    'i',
    'it',
    'for',
    'not',
    'on',
    'with',
    'he',
    'as',
    'you',
    'do',
    'at',
    'this',
    'but',
    'his',
    'by',
    'from',
    'they',
    'we',
    'say',
    'her',
    'she',
    'or',
    'an',
    'will',
    'my',
    'one',
    'all',
    'would',
    'there',
    'their',
    'what',
    'so',
    'up',
    'out',
    'if',
    'about',
    'who',
    'get',
    'which',
    'go',
    'me',
    'when',
    'make',
    'can',
    'like',
    'time',
    'no',
    'just',
    'him',
    'know',
    'hello',
    'hi',
    'how',
    'are',
    'today',
    'is',
    'was',
    'were',
    'am',
    'yes',
    'please',
    'thanks',
    'thank'
  ]),
  de: new Set([
    'der',
    'die',
    'das',
    'und',
    'in',
    'zu',
    'den',
    'nicht',
    'von',
    'sie',
    'ist',
    'des',
    'sich',
    'mit',
    'dem',
    'dass',
    'er',
    'es',
    'ein',
    'ich',
    'auf',
    'so',
    'eine',
    'auch',
    'als',
    'an',
    'nach',
    'wie',
    'im',
    'für',
    'man',
    'aber',
    'aus',
    'durch',
    'wenn',
    'nur',
    'war',
    'noch',
    'werden',
    'bei',
    'hat',
    'wir',
    'was',
    'wird',
    'sein',
    'einen',
    'welche',
    'sind',
    'oder',
    'zur',
    'um',
    'haben',
    'hallo',
    'guten',
    'tag',
    'morgen',
    'abend',
    'danke',
    'bitte',
    'ja',
    'nein',
    'geht',
    'ihnen',
    'du'
  ]),
  fr: new Set([
    'le',
    'la',
    'les',
    'de',
    'des',
    'un',
    'une',
    'du',
    'et',
    'est',
    'en',
    'dans',
    'que',
    'qui',
    'pour',
    'pas',
    'sur',
    'avec',
    'ce',
    'plus',
    'par',
    'ne',
    'se',
    'au',
    'il',
    'elle',
    'aux',
    'sont',
    'on',
    'mais',
    'nous',
    'vous',
    'ils',
    'elles',
    'tout',
    'faire',
    'fait',
    'être',
    'avoir',
    'mon',
    'ton',
    'son',
    'sa',
    'ses',
    'comme',
    'ou',
    'si',
    'leur',
    'bien',
    'peut',
    'aussi',
    'bonjour',
    'salut',
    'merci',
    'oui',
    'non',
    'comment',
    'allez',
    "aujourd'hui",
    'aujourdhui',
    'ca',
    'va'
  ]),
  es: new Set([
    'el',
    'la',
    'los',
    'las',
    'un',
    'una',
    'de',
    'en',
    'y',
    'que',
    'es',
    'por',
    'con',
    'para',
    'como',
    'se',
    'su',
    'no',
    'del',
    'al',
    'lo',
    'más',
    'pero',
    'sus',
    'le',
    'ya',
    'o',
    'fue',
    'este',
    'ha',
    'si',
    'porque',
    'esta',
    'son',
    'entre',
    'está',
    'cuando',
    'muy',
    'sin',
    'sobre',
    'ser',
    'tiene',
    'también',
    'me',
    'hasta',
    'hay',
    'donde',
    'quien',
    'desde',
    'hola',
    'cómo',
    'como',
    'estás',
    'estas',
    'buenos',
    'días',
    'tardes',
    'noches',
    'gracias',
    'favor',
    'hoy',
    'amigo'
  ]),
  it: new Set([
    'il',
    'lo',
    'la',
    'i',
    'gli',
    'le',
    'un',
    'uno',
    'una',
    'di',
    'del',
    'della',
    'dei',
    'delle',
    'e',
    'ed',
    'è',
    'che',
    'non',
    'in',
    'per',
    'si',
    'con',
    'su',
    'da',
    'ma',
    'come',
    'sono',
    'io',
    'questo',
    'questa',
    'quello',
    'tutto',
    'fare',
    'fatto',
    'anche',
    'o',
    'se',
    'ci',
    'lei',
    'lui',
    'loro',
    'mio',
    'tuo',
    'suo',
    'più',
    'cosa',
    'quando',
    'molto',
    'ciao',
    'buongiorno',
    'buonasera',
    'grazie',
    'prego',
    'stai',
    'oggi',
    'bene',
    'dove',
    'perché',
    'perche'
  ]),
  pt: new Set([
    'o',
    'a',
    'os',
    'as',
    'um',
    'uma',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'que',
    'e',
    'é',
    'para',
    'com',
    'não',
    'por',
    'mais',
    'se',
    'como',
    'mas',
    'foi',
    'ao',
    'ele',
    'tem',
    'à',
    'seu',
    'sua',
    'ou',
    'quando',
    'muito',
    'já',
    'eu',
    'também',
    'só',
    'pelo',
    'pela',
    'até',
    'isso',
    'ela',
    'entre',
    'depois',
    'olá',
    'ola',
    'bom',
    'dia',
    'boa',
    'tarde',
    'noite',
    'obrigado',
    'obrigada',
    'você',
    'voce',
    'está',
    'esta',
    'tudo',
    'bem',
    'hoje'
  ])
}

/**
 * 对输入文本进行毫秒级语言检测
 * @param text 输入文本
 * @returns 检测结果对象
 */
export const detectLanguage = (text: string): DetectResult => {
  if (!text || !text.trim()) {
    return {
      detected: 'en',
      confidence: 0,
      languageInfo: getLanguageInfo('en')
    }
  }

  const trimmed = text.trim()

  // 1. 统计特定文字系统的字符频数
  let kanaCount = 0
  let hangulCount = 0
  let cjkCount = 0
  let cyrillicCount = 0
  let latinCount = 0

  for (const char of trimmed) {
    if (REGEX_JAPANESE_KANA.test(char)) {
      kanaCount++
    } else if (REGEX_KOREAN.test(char)) {
      hangulCount++
    } else if (REGEX_CHINESE.test(char)) {
      cjkCount++
    } else if (REGEX_CYRILLIC.test(char)) {
      cyrillicCount++
    } else if (/[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(char)) {
      latinCount++
    }
  }

  // 日语判定：只要出现平假名或片假名，即具有决定性意义
  if (kanaCount > 0) {
    return {
      detected: 'ja',
      confidence: 0.99,
      languageInfo: getLanguageInfo('ja')
    }
  }

  // 韩语判定：出现谚文字母
  if (hangulCount > 0) {
    return {
      detected: 'ko',
      confidence: 0.99,
      languageInfo: getLanguageInfo('ko')
    }
  }

  // 中文判定：包含汉字且无假名，且汉字数量大于等于拉丁字母数量
  if (cjkCount > 0 && cjkCount >= latinCount) {
    return {
      detected: 'zh',
      confidence: 0.98,
      languageInfo: getLanguageInfo('zh')
    }
  }

  // 西里尔文判定：俄语
  if (cyrillicCount > 0 && cyrillicCount >= latinCount) {
    return {
      detected: 'ru',
      confidence: 0.98,
      languageInfo: getLanguageInfo('ru')
    }
  }

  // 2. 拉丁字母语族多维度加权判定
  if (latinCount > 0) {
    const words: string[] = trimmed.toLowerCase().match(/[a-zäöüßéèêëàâçîïôùûœæñáíóúãõ]+/g) || []
    const scores: Record<'en' | 'de' | 'fr' | 'es' | 'it' | 'pt', number> = {
      en: 0,
      de: 0,
      fr: 0,
      es: 0,
      it: 0,
      pt: 0
    }

    // 专属特征字符加分
    if (EXCLUSIVE_CHARS.de.test(trimmed)) scores.de += 4
    if (EXCLUSIVE_CHARS.fr.test(trimmed)) scores.fr += 4
    if (EXCLUSIVE_CHARS.es.test(trimmed)) scores.es += 4
    if (EXCLUSIVE_CHARS.pt.test(trimmed)) scores.pt += 4
    if (/[¿¡]/.test(trimmed)) scores.es += 5

    // 核心词汇匹配加权
    for (const word of words) {
      for (const [lang, wordSet] of Object.entries(VOCABULARY)) {
        if (wordSet.has(word)) {
          scores[lang as keyof typeof scores] += 3
        }
      }
    }

    // 专属典型词汇直接强化
    if (
      words.includes('você') ||
      words.includes('voce') ||
      words.includes('olá') ||
      words.includes('ola')
    ) {
      scores.pt += 5
    }
    if (words.includes('ciao') || words.includes('stai') || words.includes('buongiorno')) {
      scores.it += 5
    }
    if (words.includes('hola') || words.includes('gracias')) {
      scores.es += 5
    }
    if (words.includes('bonjour') || words.includes('merci')) {
      scores.fr += 5
    }
    if (words.includes('danke') || words.includes('guten')) {
      scores.de += 5
    }

    let bestLang: 'en' | 'de' | 'fr' | 'es' | 'it' | 'pt' = 'en'
    let maxScore = scores.en

    for (const [lang, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score
        bestLang = lang as 'en' | 'de' | 'fr' | 'es' | 'it' | 'pt'
      }
    }

    return {
      detected: bestLang,
      confidence: maxScore > 0 ? 0.95 : 0.6,
      languageInfo: getLanguageInfo(bestLang)
    }
  }

  // 兜底策略：如果既没有汉字假名，也没有拉丁字符（如纯标点或数字），置信度为0
  return {
    detected: 'en',
    confidence: 0,
    languageInfo: getLanguageInfo('en')
  }
}

/**
 * 根据检测到的源语言，智能推荐适配的目标语言
 * 核心逻辑：源语言为中文时目标语言推荐为英文；源语言为非中文时目标语言推荐为中文
 */
export const resolveAutoTargetLanguage = (detectedLang: SupportedLanguage): SupportedLanguage => {
  if (detectedLang === 'zh') {
    return 'en'
  }
  return 'zh'
}

/**
 * 计算实际发送给大模型翻译接口的规范提示词语言名称
 * @param selectedLang 用户选定的语言模式（可能是 'auto' 或具体语言）
 * @param detectedLang 当前检测出的语言代码
 */
export const resolvePromptLanguage = (
  selectedLang: SupportedLanguage,
  detectedLang: SupportedLanguage
): string => {
  const actualLang = selectedLang === 'auto' ? detectedLang : selectedLang
  return getLanguageInfo(actualLang).promptName
}
