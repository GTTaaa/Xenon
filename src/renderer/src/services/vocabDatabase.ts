import Dexie, { type Table, type Transaction } from 'dexie'
import type { WordLookupKind, WordLookupSide } from '../../../shared/wordLookup'

/** 本地生词主表记录 */
export interface VocabItem {
  /** 自增主键 */
  id?: number
  /** 展示用词元，保留模型返回的大小写 */
  lemma: string
  /** 查询与去重使用的归一化词元 */
  lemmaLower: string
  /** 当前词属于实义词还是语法词；旧数据缺省时按实义词处理 */
  kind?: WordLookupKind
  /** 最近一次遇到的词形 */
  surface: string
  /** 脱离本句时最常见的中文字面义 */
  literalMeaning?: string
  /** 简体中文语境释义 */
  meaning: string
  /** 为什么本句取当前释义 */
  contextNote?: string
  /** 该词为什么位于当前句法位置 */
  wordOrderNote?: string
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
  /** 用于去重的规范化英文原句键 */
  sourceSentenceKey: string
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
  /** 当前词属于实义词还是语法词 */
  kind?: WordLookupKind
  /** 当前英文词形或短语 */
  surface: string
  /** 脱离本句时最常见的中文字面义 */
  literalMeaning?: string
  /** 简体中文语境释义 */
  meaning: string
  /** 为什么本句取当前释义 */
  contextNote?: string
  /** 该词为什么位于当前句法位置 */
  wordOrderNote?: string
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

/** 清理句子首尾空白与连续空白，保留展示所需的原始大小写和标点 */
const normalizeSentence = (sentence: string): string => {
  return sentence.trim().replace(/\s+/g, ' ')
}

/**
 * 生成例句去重键。
 * 对齐片段可能时而包含句末标点，因此忽略大小写、空白、Unicode 差异和句末标点。
 */
export const normalizeVocabSentence = (sentence: string): string => {
  return sentence
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[\s.,!?;:，。！？；：、…]+(?:["'”’）)\]】》」』]+)?$/u, '')
}

/** 合并历史重复的主词记录，保留最早编号并累计真实查词次数 */
const migrateVocabItems = async (table: Table<VocabItem, number>): Promise<void> => {
  const allItems = await table.toArray()
  const itemsByLemma = new Map<string, VocabItem[]>()

  for (const item of allItems) {
    const lemmaLower = normalizeVocabLemma(item.lemmaLower || item.lemma)
    const group = itemsByLemma.get(lemmaLower) ?? []
    group.push(item)
    itemsByLemma.set(lemmaLower, group)
  }

  for (const [lemmaLower, group] of itemsByLemma) {
    const ordered = [...group].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    const canonical = ordered[0]
    const latest = [...group].sort(
      (a, b) => b.updatedAt - a.updatedAt || (b.id ?? 0) - (a.id ?? 0)
    )[0]
    if (!canonical || !latest || canonical.id === undefined) continue

    const merged: VocabItem = {
      ...latest,
      id: canonical.id,
      lemma: latest.lemma || canonical.lemma,
      lemmaLower,
      surface: latest.surface || canonical.surface,
      meaning: latest.meaning || canonical.meaning,
      targetText: latest.targetText || canonical.targetText,
      ...(latest.note || canonical.note ? { note: latest.note || canonical.note } : {}),
      side: latest.side || canonical.side,
      encounterCount: group.reduce(
        (total, item) => total + Math.max(1, item.encounterCount || 1),
        0
      ),
      createdAt: Math.min(...group.map((item) => item.createdAt || Number.MAX_SAFE_INTEGER)),
      updatedAt: Math.max(...group.map((item) => item.updatedAt || 0))
    }

    await table.put(merged)
    for (const duplicate of ordered.slice(1)) {
      if (duplicate.id !== undefined) await table.delete(duplicate.id)
    }
  }
}

/**
 * 合并同一词下仅因标点、大小写或空白差异产生的重复语境。
 * 同时为旧版本数据补齐 sourceSentenceKey，供后续唯一复合索引使用。
 */
const migrateVocabContexts = async (table: Table<VocabContext, number>): Promise<void> => {
  const allContexts = await table.toArray()
  const contextsByKey = new Map<string, VocabContext[]>()

  for (const context of allContexts) {
    const lemmaLower = normalizeVocabLemma(context.lemmaLower)
    const sourceSentenceKey = normalizeVocabSentence(context.sourceSentence)
    const groupKey = JSON.stringify([lemmaLower, sourceSentenceKey])
    const group = contextsByKey.get(groupKey) ?? []
    group.push({ ...context, lemmaLower, sourceSentenceKey })
    contextsByKey.set(groupKey, group)
  }

  for (const group of contextsByKey.values()) {
    const ordered = [...group].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    const canonical = ordered[0]
    if (!canonical || canonical.id === undefined) continue

    const bestDisplay = [...group].sort(
      (a, b) =>
        b.sourceSentence.length +
          b.targetSentence.length -
          (a.sourceSentence.length + a.targetSentence.length) || (a.id ?? 0) - (b.id ?? 0)
    )[0]
    const latest = [...group].sort(
      (a, b) => b.createdAt - a.createdAt || (b.id ?? 0) - (a.id ?? 0)
    )[0]
    const merged: VocabContext = {
      ...canonical,
      lemmaLower: normalizeVocabLemma(canonical.lemmaLower),
      sourceSentence: bestDisplay?.sourceSentence || canonical.sourceSentence,
      sourceSentenceKey: normalizeVocabSentence(
        bestDisplay?.sourceSentence || canonical.sourceSentence
      ),
      targetSentence: bestDisplay?.targetSentence || canonical.targetSentence,
      surface: latest?.surface || canonical.surface,
      createdAt: Math.min(...group.map((item) => item.createdAt || Number.MAX_SAFE_INTEGER))
    }

    await table.put(merged)
    for (const duplicate of ordered.slice(1)) {
      if (duplicate.id !== undefined) await table.delete(duplicate.id)
    }
  }
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
      // 旧版本可能因结构未升级而存在重复数据，先保持非唯一，留到迁移完成后再加回唯一约束。
      vocab_items: '++id,lemmaLower,updatedAt,createdAt',
      vocab_contexts: '++id,lemmaLower,createdAt,[lemmaLower+sourceSentence]'
    })
    this.version(2)
      .stores({
        vocab_items: '++id,lemmaLower,updatedAt,createdAt',
        vocab_contexts: '++id,lemmaLower,sourceSentenceKey,createdAt,[lemmaLower+sourceSentenceKey]'
      })
      .upgrade(async (transaction: Transaction) => {
        await migrateVocabItems(transaction.table('vocab_items'))
        await migrateVocabContexts(transaction.table('vocab_contexts'))
      })
    this.version(3).stores({
      vocab_items: '++id,&lemmaLower,updatedAt,createdAt',
      vocab_contexts: '++id,lemmaLower,createdAt,&[lemmaLower+sourceSentenceKey]'
    })
    this.vocabItems = this.table('vocab_items')
    this.vocabContexts = this.table('vocab_contexts')
  }
}

export const vocabDatabase = new VocabDatabase()

/**
 * 写入一次主动查词或收藏。
 * 主词与语境放在同一个事务中，避免只更新一半后留下孤立数据。
 * 相同词元与相同例句重复调用时只更新展示信息，不再累加遇到次数。
 */
export const recordVocabEncounter = async (
  input: VocabEncounterInput,
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem> => {
  const lemma = input.lemma.trim()
  const kind = input.kind ?? 'lexical'
  const lemmaLower = normalizeVocabLemma(lemma)
  const surface = input.surface.trim()
  const literalMeaning = input.literalMeaning?.trim() || undefined
  const meaning = input.meaning.trim()
  const contextNote = input.contextNote?.trim() || undefined
  const wordOrderNote = input.wordOrderNote?.trim() || undefined
  const targetText = input.targetText.trim()
  const note = input.note?.trim() || undefined
  const englishSentence = normalizeSentence(input.englishSentence)
  const sourceSentenceKey = normalizeVocabSentence(englishSentence)
  const chineseSentence = normalizeSentence(input.chineseSentence)

  if (!lemmaLower || !surface || !meaning || !englishSentence || !chineseSentence) {
    throw new Error('生词收录缺少词元、释义或完整双语语境')
  }

  const now = Date.now()

  return database.transaction('rw', database.vocabItems, database.vocabContexts, async () => {
    const existingContext = await database.vocabContexts
      .where('[lemmaLower+sourceSentenceKey]')
      .equals([lemmaLower, sourceSentenceKey])
      .first()
    const isNewContext = !existingContext
    const existing = await database.vocabItems.where('lemmaLower').equals(lemmaLower).first()
    let item: VocabItem

    if (existing?.id !== undefined) {
      item = {
        ...existing,
        kind,
        surface,
        ...(literalMeaning ? { literalMeaning } : {}),
        meaning,
        ...(contextNote ? { contextNote } : {}),
        ...(wordOrderNote ? { wordOrderNote } : {}),
        encounterCount: existing.encounterCount + (isNewContext ? 1 : 0),
        updatedAt: now
      }
      await database.vocabItems.put(item)
    } else {
      item = {
        kind,
        lemma,
        lemmaLower,
        surface,
        ...(literalMeaning ? { literalMeaning } : {}),
        meaning,
        ...(contextNote ? { contextNote } : {}),
        ...(wordOrderNote ? { wordOrderNote } : {}),
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

    if (!existingContext) {
      await database.vocabContexts.add({
        lemmaLower,
        sourceSentence: englishSentence,
        sourceSentenceKey,
        targetSentence: chineseSentence,
        surface,
        createdAt: now
      })
    } else if (existingContext.id !== undefined) {
      // 同一语境再次出现时只更新更完整的展示文本，不新增第二条记录。
      const sourceSentence =
        englishSentence.length > existingContext.sourceSentence.length
          ? englishSentence
          : existingContext.sourceSentence
      const targetSentence =
        chineseSentence.length > existingContext.targetSentence.length
          ? chineseSentence
          : existingContext.targetSentence
      if (
        sourceSentence !== existingContext.sourceSentence ||
        targetSentence !== existingContext.targetSentence ||
        surface !== existingContext.surface
      ) {
        await database.vocabContexts.put({
          ...existingContext,
          sourceSentence,
          sourceSentenceKey,
          targetSentence,
          surface
        })
      }
    }

    return item
  })
}

/**
 * 从本地词库彻底移除一个词条及其全部语境。
 * 主词和语境必须在同一事务内删除，避免留下无法从界面清理的孤立例句。
 */
export const removeVocabItem = async (
  lemma: string,
  database: VocabDatabase = vocabDatabase
): Promise<boolean> => {
  const lemmaLower = normalizeVocabLemma(lemma)
  if (!lemmaLower) return false

  return database.transaction('rw', database.vocabItems, database.vocabContexts, async () => {
    const deletedContextCount = await database.vocabContexts
      .where('lemmaLower')
      .equals(lemmaLower)
      .delete()
    const deletedItemCount = await database.vocabItems
      .where('lemmaLower')
      .equals(lemmaLower)
      .delete()

    return deletedItemCount > 0 || deletedContextCount > 0
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

/**
 * 按文本中的实际词形批量查询本地词条。
 * 同时比对 lemmaLower 与最近词形 surface，解决 deprecated → deprecate 这类屈折变化。
 */
export const getVocabItemsByWordForms = async (
  wordForms: string[],
  database: VocabDatabase = vocabDatabase
): Promise<VocabItem[]> => {
  const uniqueWordForms = new Set(wordForms.map(normalizeVocabLemma).filter(Boolean))
  if (uniqueWordForms.size === 0) return []

  return database.vocabItems
    .filter(
      (item) =>
        uniqueWordForms.has(item.lemmaLower) ||
        uniqueWordForms.has(normalizeVocabLemma(item.surface))
    )
    .toArray()
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

/**
 * 从本地词库随机抽取一组互不重复的闪卡。
 * 以词条而不是语境作为随机单位，避免同一生词的多个例句占满整个轮播。
 */
export const getVocabFlashcards = async (
  limit = 8,
  database: VocabDatabase = vocabDatabase
): Promise<VocabFlashcard[]> => {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)))
  const itemCount = await database.vocabItems.count()
  if (itemCount === 0) return []

  const firstOffset = Math.floor(Math.random() * itemCount)
  const maximumAttempts = Math.min(itemCount, Math.max(safeLimit * 4, 24))
  const flashcards: VocabFlashcard[] = []

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const offset = (firstOffset + attempt) % itemCount
    const item = await database.vocabItems.orderBy('updatedAt').offset(offset).first()
    if (!item) continue

    const contextCount = await database.vocabContexts
      .where('lemmaLower')
      .equals(item.lemmaLower)
      .count()
    if (contextCount === 0) continue

    const contextOffset = Math.floor(Math.random() * contextCount)
    const context = await database.vocabContexts
      .where('lemmaLower')
      .equals(item.lemmaLower)
      .offset(contextOffset)
      .first()
    if (!context) continue

    flashcards.push({ item, context })
    if (flashcards.length >= safeLimit) break
  }

  return flashcards
}

/** 从本地库随机抽取一条带完整语境的闪卡 */
export const getRandomVocabFlashcard = async (
  database: VocabDatabase = vocabDatabase
): Promise<VocabFlashcard | null> => {
  const [flashcard] = await getVocabFlashcards(1, database)
  return flashcard ?? null
}
