import Dexie, { type Table } from 'dexie'
import type { WordLookupSide } from '../../../shared/wordLookup'

/** 本地生词主表记录 */
export interface VocabItem {
  /** 自增主键 */
  id?: number
  /** 展示用词元，保留模型返回的大小写 */
  lemma: string
  /** 查询与去重使用的归一化词元 */
  lemmaLower: string
  /** 最近一次遇到的词形 */
  surface: string
  /** 简体中文语境释义 */
  meaning: string
  /** 对应中文片段 */
  targetText: string
  /** 中译英场景下的地道表达说明 */
  note?: string
  /** 英文词条位于原文还是译文 */
  side: WordLookupSide
  /** 遇到或主动查词的累计次数 */
  encounterCount: number
  /** 首次收录时间戳 */
  createdAt: number
  /** 最近更新时间戳 */
  updatedAt: number
}

/** 一个生词对应的真实双语语境 */
export interface VocabContext {
  /** 自增主键 */
  id?: number
  /** 关联的归一化词元 */
  lemmaLower: string
  /** 完整英文原句 */
  sourceSentence: string
  /** 对应中文译句 */
  targetSentence: string
  /** 该句中的具体英文词形 */
  surface: string
  /** 语境记录时间戳 */
  createdAt: number
}

/** 一次主动收录需要写入的完整快照 */
export interface VocabEncounterInput {
  /** 展示用词元 */
  lemma: string
  /** 当前英文词形或短语 */
  surface: string
  /** 简体中文语境释义 */
  meaning: string
  /** 对应中文片段 */
  targetText: string
  /** 中译英场景下的表达说明 */
  note?: string
  /** 英文词条所在侧 */
  side: WordLookupSide
  /** 完整英文原句 */
  englishSentence: string
  /** 完整中文译句 */
  chineseSentence: string
}

/** 空状态闪卡需要的主词条与语境 */
export interface VocabFlashcard {
  /** 生词主记录 */
  item: VocabItem
  /** 随机抽取的双语语境 */
  context: VocabContext
}

/** 把词元转换成唯一索引使用的稳定形式 */
export const normalizeVocabLemma = (lemma: string): string => {
  return lemma.trim().toLowerCase()
}

/** 清理句子首尾空白与连续空白，避免同一句仅因排版产生重复记录 */
const normalizeSentence = (sentence: string): string => {
  return sentence.trim().replace(/\s+/g, ' ')
}

/** 渲染进程专用生词库 */
export class VocabDatabase extends Dexie {
  /** 生词主表 */
  vocabItems!: Table<VocabItem, number>
  /** 生词语境表 */
  vocabContexts!: Table<VocabContext, number>

  constructor(databaseName = 'xenon-vocab') {
    super(databaseName)
    this.version(1).stores({
      vocab_items: '++id,&lemmaLower,updatedAt,createdAt',
      vocab_contexts: '++id,lemmaLower,createdAt,[lemmaLower+sourceSentence]'
    })
    this.vocabItems = this.table('vocab_items')
    this.vocabContexts = this.table('vocab_contexts')
  }
}

export const vocabDatabase = new VocabDatabase()

/**
 * 写入一次主动查词或收藏。
 * 主词与语境放在同一个事务中，避免只更新一半后留下孤立数据。
 */
export const recordVocabEncounter = async (
  input: VocabEncounterInput,
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem> => {
  const lemma = input.lemma.trim()
  const lemmaLower = normalizeVocabLemma(lemma)
  const surface = input.surface.trim()
  const meaning = input.meaning.trim()
  const targetText = input.targetText.trim()
  const note = input.note?.trim() || undefined
  const englishSentence = normalizeSentence(input.englishSentence)
  const chineseSentence = normalizeSentence(input.chineseSentence)

  if (!lemmaLower || !surface || !meaning || !englishSentence || !chineseSentence) {
    throw new Error('生词收录缺少词元、释义或完整双语语境')
  }

  const now = Date.now()

  return database.transaction('rw', database.vocabItems, database.vocabContexts, async () => {
    const existing = await database.vocabItems.where('lemmaLower').equals(lemmaLower).first()
    let item: VocabItem

    if (existing?.id !== undefined) {
      item = {
        ...existing,
        surface,
        encounterCount: existing.encounterCount + 1,
        updatedAt: now
      }
      await database.vocabItems.put(item)
    } else {
      item = {
        lemma,
        lemmaLower,
        surface,
        meaning,
        targetText,
        ...(note ? { note } : {}),
        side: input.side,
        encounterCount: 1,
        createdAt: now,
        updatedAt: now
      }
      const id = await database.vocabItems.add(item)
      item = { ...item, id }
    }

    const existingContext = await database.vocabContexts
      .where('[lemmaLower+sourceSentence]')
      .equals([lemmaLower, englishSentence])
      .first()

    if (!existingContext) {
      await database.vocabContexts.add({
        lemmaLower,
        sourceSentence: englishSentence,
        targetSentence: chineseSentence,
        surface,
        createdAt: now
      })
    }

    return item
  })
}

/**
 * 按当前点击词优先查找本地释义。
 * 先精确匹配 lemmaLower，再扫描最近词形，兼容 running → run 这类变体。
 */
export const findCachedVocab = async (
  word: string,
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem | null> => {
  const normalizedWord = normalizeVocabLemma(word)
  if (!normalizedWord) return null

  const exactLemma = await database.vocabItems.where('lemmaLower').equals(normalizedWord).first()
  if (exactLemma) return exactLemma

  const matchedSurface = await database.vocabItems
    .filter((item) => normalizeVocabLemma(item.surface) === normalizedWord)
    .first()

  return matchedSurface ?? null
}

/** 批量查询当前英文文本中已经收录的词 */
export const getVocabItemsByLemma = async (
  lemmaLowers: string[],
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem[]> => {
  const uniqueLemmaLowers = Array.from(
    new Set(lemmaLowers.map(normalizeVocabLemma).filter(Boolean))
  )
  if (uniqueLemmaLowers.length === 0) return []

  return database.vocabItems.where('lemmaLower').anyOf(uniqueLemmaLowers).toArray()
}

/** 查询多词短语词条，供二次偶遇高亮补充匹配 */
export const getPhraseVocabItems = async (
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem[]> => {
  return database.vocabItems.filter((item) => item.lemmaLower.includes(' ')).toArray()
}

/**
 * 翻译完成后批量增加被动偶遇次数。
 * 调用方必须先在单次翻译内去重，避免同一句重复出现时反复累加。
 * 返回事务内更新后的主词，界面可据此显示准确次数。
 */
export const incrementPassiveVocabEncounters = async (
  lemmaLowers: string[],
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem[]> => {
  const uniqueLemmaLowers = Array.from(
    new Set(lemmaLowers.map(normalizeVocabLemma).filter(Boolean))
  )
  if (uniqueLemmaLowers.length === 0) return []

  const now = Date.now()
  return database.transaction('rw', database.vocabItems, async () => {
    await database.vocabItems
      .where('lemmaLower')
      .anyOf(uniqueLemmaLowers)
      .modify((item) => {
        item.encounterCount += 1
        item.updatedAt = now
      })

    return database.vocabItems.where('lemmaLower').anyOf(uniqueLemmaLowers).toArray()
  })
}

/** 从本地库随机抽取一条带完整语境的闪卡 */
export const getRandomVocabFlashcard = async (
  database: VocabDatabase = vocabDatabase
): Promise<VocabFlashcard | null> => {
  const contextCount = await database.vocabContexts.count()
  if (contextCount === 0) return null

  const firstOffset = Math.floor(Math.random() * contextCount)
  const maximumAttempts = Math.min(contextCount, 12)

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const offset = (firstOffset + attempt) % contextCount
    const context = await database.vocabContexts.orderBy('createdAt').offset(offset).first()
    if (!context) continue

    const item = await database.vocabItems.where('lemmaLower').equals(context.lemmaLower).first()
    if (item) return { item, context }
  }

  return null
}
