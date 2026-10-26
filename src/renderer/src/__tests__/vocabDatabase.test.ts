import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VocabDatabase,
  findCachedVocab,
  getRandomVocabFlashcard,
  getVocabFlashcards,
  getVocabItemCount,
  getVocabItems,
  getVocabItemsByWordForms,
  incrementPassiveVocabEncounters,
  incrementPassiveVocabEncountersInText,
  normalizeVocabSentence,
  recordVocabEncounter,
  removeVocabItem
} from '../services/vocabDatabase.ts'
import Dexie, { type Table } from 'dexie'

/** 模拟旧版本生词库，用于验证升级迁移会清理历史重复记录 */
interface LegacyVocabItem {
  id?: number
  lemma: string
  lemmaLower: string
  surface: string
  meaning: string
  targetText: string
  side: 'source' | 'target'
  encounterCount: number
  createdAt: number
  updatedAt: number
}

/** 旧版本语境记录尚未包含 sourceSentenceKey */
interface LegacyVocabContext {
  id?: number
  lemmaLower: string
  sourceSentence: string
  targetSentence: string
  surface: string
  createdAt: number
}

class LegacyVocabDatabase extends Dexie {
  vocabItems!: Table<LegacyVocabItem, number>
  vocabContexts!: Table<LegacyVocabContext, number>

  constructor(databaseName: string) {
    super(databaseName)
    this.version(1).stores({
      vocab_items: '++id,lemmaLower,updatedAt,createdAt',
      vocab_contexts: '++id,lemmaLower,createdAt,[lemmaLower+sourceSentence]'
    })
    this.vocabItems = this.table('vocab_items')
    this.vocabContexts = this.table('vocab_contexts')
  }
}

/** 每个测试使用独立数据库，避免并行执行时共享状态 */
const createTestDatabase = (): VocabDatabase => {
  return new VocabDatabase(`xenon-vocab-test-${Date.now()}-${Math.random()}`)
}

test('首次主动查词会同时写入主词与完整双语语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const item = await recordVocabEncounter(
    {
      lemma: 'Resilient',
      surface: 'resilient',
      meaning: '有韧性的',
      wordOrderNote: 'resilient 作表语，放在系动词 remained 之后。',
      targetText: '有韧性',
      side: 'source',
      englishSentence: 'She remained resilient through the crisis.',
      chineseSentence: '她在危机中始终很有韧性。'
    },
    database
  )

  assert.equal(item.lemma, 'Resilient')
  assert.equal(item.lemmaLower, 'resilient')
  assert.equal(item.encounterCount, 1)
  assert.equal(item.wordOrderNote, 'resilient 作表语，放在系动词 remained 之后。')
  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.vocabContexts.count(), 1)

  const savedContext = await database.vocabContexts.toCollection().first()
  assert.equal(savedContext?.sourceSentence, 'She remained resilient through the crisis.')
  assert.equal(savedContext?.targetSentence, '她在危机中始终很有韧性。')
  assert.equal(savedContext?.surface, 'resilient')
})

test('重复收藏同一词的同一例句不会累加次数，只更新最近词形', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'run',
      surface: 'run',
      meaning: '跑步',
      targetText: '跑',
      side: 'source',
      englishSentence: 'I run every morning.',
      chineseSentence: '我每天早上跑步。'
    },
    database
  )
  const updated = await recordVocabEncounter(
    {
      lemma: 'run',
      surface: 'running',
      meaning: '跑步',
      targetText: '跑',
      side: 'source',
      englishSentence: 'I run every morning.',
      chineseSentence: '我每天早上跑步。'
    },
    database
  )
  const repeated = await recordVocabEncounter(
    {
      lemma: 'run',
      surface: 'running',
      meaning: '跑步',
      targetText: '跑',
      side: 'source',
      englishSentence: 'I run every morning.',
      chineseSentence: '我每天早上跑步。'
    },
    database
  )

  assert.equal(updated.encounterCount, 1)
  assert.equal(updated.surface, 'running')
  assert.equal(repeated.encounterCount, 1)
  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.vocabContexts.count(), 1)
})

test('同一句仅大小写、空白和句末标点不同时不会重复写入语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'deprecate',
      surface: 'deprecated',
      meaning: '已弃用',
      targetText: '已弃用',
      side: 'source',
      englishSentence: 'The legacy API has been deprecated in the latest release.',
      chineseSentence: '旧版 API 在最新版本中已被弃用。'
    },
    database
  )
  const updated = await recordVocabEncounter(
    {
      lemma: 'deprecate',
      surface: 'deprecated',
      meaning: '已弃用',
      targetText: '已弃用',
      side: 'source',
      englishSentence: '  THE LEGACY API HAS BEEN DEPRECATED IN THE LATEST RELEASE ',
      chineseSentence: '旧版 API 在最新版本中已被弃用'
    },
    database
  )

  assert.equal(updated.encounterCount, 1)
  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.vocabContexts.count(), 1)
  assert.equal(
    normalizeVocabSentence('The legacy API has been deprecated in the latest release.'),
    normalizeVocabSentence(' THE LEGACY API HAS BEEN DEPRECATED IN THE LATEST RELEASE ')
  )
})

test('唯一索引会拒绝重复的主词和同词同句语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const item = await recordVocabEncounter(
    {
      lemma: 'deprecate',
      surface: 'deprecated',
      meaning: '已弃用',
      targetText: '已弃用',
      side: 'source',
      englishSentence: 'The legacy API has been deprecated in the latest release.',
      chineseSentence: '旧版 API 在最新版本中已被弃用。'
    },
    database
  )
  const savedContext = await database.vocabContexts.toCollection().first()
  assert.ok(savedContext)

  await assert.rejects(
    database.vocabItems.add({ ...item, id: undefined }),
    (error: unknown) => error instanceof Error && error.name === 'ConstraintError'
  )
  await assert.rejects(
    database.vocabContexts.add({ ...savedContext, id: undefined }),
    (error: unknown) => error instanceof Error && error.name === 'ConstraintError'
  )
})

test('同一个词遇到不同原句时会保留多个真实语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const baseInput = {
    lemma: 'charge',
    surface: 'charge',
    meaning: '收费',
    targetText: '收费',
    side: 'source' as const
  }

  await recordVocabEncounter(
    {
      ...baseInput,
      englishSentence: 'They charge a small fee.',
      chineseSentence: '他们收取少量费用。'
    },
    database
  )
  const updated = await recordVocabEncounter(
    {
      ...baseInput,
      surface: 'charged',
      englishSentence: 'The hotel charged us twice.',
      chineseSentence: '酒店向我们收了两次费。'
    },
    database
  )

  assert.equal(updated.encounterCount, 2)
  assert.equal(await database.vocabContexts.count(), 2)
})

test('移出生词库会级联删除主词及其全部语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const baseInput = {
    lemma: 'Deprecate',
    surface: 'deprecated',
    meaning: '已弃用',
    targetText: '已弃用',
    side: 'source' as const
  }

  await recordVocabEncounter(
    {
      ...baseInput,
      englishSentence: 'The legacy API has been deprecated in the latest release.',
      chineseSentence: '旧版 API 在最新版本中已被弃用。'
    },
    database
  )
  await recordVocabEncounter(
    {
      ...baseInput,
      surface: 'deprecates',
      englishSentence: 'The team deprecates unsafe defaults.',
      chineseSentence: '团队会弃用不安全的默认设置。'
    },
    database
  )

  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.vocabContexts.count(), 2)
  assert.equal(await removeVocabItem('  DEPRECATE ', database), true)
  assert.equal(await database.vocabItems.count(), 0)
  assert.equal(await database.vocabContexts.count(), 0)
  assert.equal(await removeVocabItem('deprecate', database), false)
})

test('本地缓存既支持归一化词元，也兼容最近一次词形', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'Run',
      surface: 'running',
      meaning: '跑步',
      targetText: '跑',
      side: 'source',
      englishSentence: 'She is running late.',
      chineseSentence: '她要迟到了。'
    },
    database
  )

  assert.equal((await findCachedVocab(' run ', database))?.lemma, 'Run')
  assert.equal((await findCachedVocab('RUNNING', database))?.lemma, 'Run')
  assert.equal(await findCachedVocab('walk', database), null)
})

test('批量偶遇扫描会同时按原形与最近词形命中词条', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'deprecate',
      surface: 'deprecated',
      meaning: '已弃用的',
      targetText: '已弃用',
      side: 'source',
      englishSentence: 'The legacy API has been deprecated in the latest release.',
      chineseSentence: '旧版 API 在最新版本中已被弃用。'
    },
    database
  )

  const byLemma = await getVocabItemsByWordForms(['deprecate'], database)
  const bySurface = await getVocabItemsByWordForms(['DEPRECATED'], database)

  assert.equal(byLemma.length, 1)
  assert.equal(bySurface.length, 1)
  assert.equal(bySurface[0].lemmaLower, 'deprecate')
  assert.equal(bySurface[0].surface, 'deprecated')
})

test('被动偶遇会批量增加计数且不会创建新词条', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'subtle',
      surface: 'subtle',
      meaning: '微妙的',
      targetText: '微妙',
      side: 'source',
      englishSentence: 'There is a subtle difference.',
      chineseSentence: '这里有一个微妙的区别。'
    },
    database
  )

  const updatedItems = await incrementPassiveVocabEncounters(['subtle', 'missing'], database)

  const item = await database.vocabItems.where('lemmaLower').equals('subtle').first()
  assert.equal(item?.encounterCount, 2)
  assert.equal(updatedItems.length, 1)
  assert.equal(updatedItems[0].encounterCount, 2)
  assert.equal(await database.vocabItems.count(), 1)
})

test('文本级被动偶遇会匹配原形与最近词形，并按文本和单词持久去重', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'deprecate',
      surface: 'deprecated',
      meaning: '已弃用的',
      targetText: '已弃用',
      side: 'source',
      englishSentence: 'This function is deprecated.',
      chineseSentence: '这个函数已弃用。'
    },
    database
  )

  const first = await incrementPassiveVocabEncountersInText(
    'This function is deprecated.',
    database
  )
  const repeated = await incrementPassiveVocabEncountersInText(
    '  This   function is deprecated.  ',
    database
  )
  const differentText = await incrementPassiveVocabEncountersInText(
    'The deprecated function is still available.',
    database
  )

  assert.equal(first.length, 1)
  assert.equal(first[0].lemmaLower, 'deprecate')
  assert.equal(first[0].encounterCount, 2)
  assert.equal(repeated.length, 0)
  assert.equal(differentText.length, 1)
  assert.equal(differentText[0].encounterCount, 3)
  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.passiveEncounters.count(), 2)
})

test('文本级被动偶遇不会为未收藏词创建记录', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const updated = await incrementPassiveVocabEncountersInText(
    'A subtle difference appears here.',
    database
  )

  assert.deepEqual(updated, [])
  assert.equal(await database.vocabItems.count(), 0)
  assert.equal(await database.passiveEncounters.count(), 0)
})

test('随机闪卡会返回互相关联的主词与完整语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  await recordVocabEncounter(
    {
      lemma: 'craft',
      surface: 'crafted',
      meaning: '精心制作',
      targetText: '精心打磨',
      side: 'target',
      englishSentence: 'The speech was carefully crafted.',
      chineseSentence: '这篇演讲经过精心打磨。'
    },
    database
  )

  const flashcard = await getRandomVocabFlashcard(database)
  assert.equal(flashcard?.item.lemmaLower, 'craft')
  assert.equal(flashcard?.context.lemmaLower, 'craft')
  assert.equal(flashcard?.context.surface, 'crafted')
})

test('批量闪卡按词条去重，并为每张卡保留对应语境', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const words = [
    ['craft', '精心制作', 'The speech was carefully crafted.'],
    ['subtle', '微妙的', 'There is a subtle difference.'],
    ['resilient', '有韧性的', 'She remained resilient through the crisis.'],
    ['tender', '温柔的', 'He gave her a tender look.'],
    ['vivid', '生动的', 'The memory is still vivid.'],
    ['stern', '严厉的', 'Her tone was unusually stern.']
  ]

  for (const [lemma, meaning, sentence] of words) {
    await recordVocabEncounter(
      {
        lemma,
        surface: lemma,
        meaning,
        targetText: meaning,
        side: 'source',
        englishSentence: sentence,
        chineseSentence: `这是 ${lemma} 的中文语境。`
      },
      database
    )
  }

  const flashcards = await getVocabFlashcards(4, database)
  assert.equal(flashcards.length, 4)
  assert.equal(new Set(flashcards.map((flashcard) => flashcard.item.lemmaLower)).size, 4)

  for (const flashcard of flashcards) {
    assert.equal(flashcard.item.lemmaLower, flashcard.context.lemmaLower)
  }
})

test('生词数量按唯一词条统计', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  assert.equal(await getVocabItemCount(database), 0)

  const encounter = {
    lemma: 'craft',
    surface: 'crafted',
    meaning: '精心制作',
    targetText: '精心打磨',
    side: 'source' as const,
    englishSentence: 'The speech was carefully crafted.',
    chineseSentence: '这篇演讲经过精心打磨。'
  }
  await recordVocabEncounter(encounter, database)
  await recordVocabEncounter(
    {
      ...encounter,
      englishSentence: 'She crafted a careful response.',
      chineseSentence: '她精心拟了一份回复。'
    },
    database
  )

  assert.equal(await getVocabItemCount(database), 1)
})

test('生词列表按偶遇次数降序排列，次数相同时最近收藏的在前', async (context) => {
  const database = createTestDatabase()
  context.after(() => database.delete())

  const baseItem = {
    surface: 'word',
    meaning: '释义',
    targetText: '释义',
    side: 'source' as const,
    updatedAt: 1
  }
  await database.vocabItems.bulkAdd([
    {
      ...baseItem,
      lemma: 'alpha',
      lemmaLower: 'alpha',
      encounterCount: 2,
      createdAt: 100
    },
    {
      ...baseItem,
      lemma: 'beta',
      lemmaLower: 'beta',
      encounterCount: 8,
      createdAt: 50
    },
    {
      ...baseItem,
      lemma: 'gamma',
      lemmaLower: 'gamma',
      encounterCount: 2,
      createdAt: 300
    }
  ])

  const items = await getVocabItems(database)
  assert.deepEqual(
    items.map((item) => item.lemma),
    ['beta', 'gamma', 'alpha']
  )
})

test('旧数据库升级时会合并重复主词与重复语境', async (context) => {
  const databaseName = `xenon-vocab-legacy-${Date.now()}-${Math.random()}`
  const legacyDatabase = new LegacyVocabDatabase(databaseName)
  context.after(async () => {
    legacyDatabase.close()
    await Dexie.delete(databaseName)
  })

  const firstItemId = await legacyDatabase.vocabItems.add({
    lemma: 'deprecate',
    lemmaLower: 'deprecate',
    surface: 'deprecated',
    meaning: '已弃用',
    targetText: '已弃用',
    side: 'source',
    encounterCount: 2,
    createdAt: 100,
    updatedAt: 200
  })
  await legacyDatabase.vocabItems.add({
    lemma: 'deprecate',
    lemmaLower: 'deprecate',
    surface: 'deprecated',
    meaning: '被弃用',
    targetText: '已弃用',
    side: 'source',
    encounterCount: 3,
    createdAt: 150,
    updatedAt: 300
  })
  await legacyDatabase.vocabContexts.add({
    lemmaLower: 'deprecate',
    sourceSentence: 'The legacy API has been deprecated in the latest release.',
    targetSentence: '旧版 API 在最新版本中已被弃用。',
    surface: 'deprecated',
    createdAt: 100
  })
  await legacyDatabase.vocabContexts.add({
    lemmaLower: 'deprecate',
    sourceSentence: 'The legacy API has been deprecated in the latest release',
    targetSentence: '旧版 API 在最新版本中已被弃用',
    surface: 'deprecated',
    createdAt: 200
  })
  legacyDatabase.close()

  const migratedDatabase = new VocabDatabase(databaseName)
  context.after(() => migratedDatabase.delete())
  await migratedDatabase.open()

  const items = await migratedDatabase.vocabItems.toArray()
  const contexts = await migratedDatabase.vocabContexts.toArray()
  assert.equal(items.length, 1)
  assert.equal(items[0].id, firstItemId)
  assert.equal(items[0].encounterCount, 5)
  assert.equal(items[0].meaning, '被弃用')
  assert.equal(contexts.length, 1)
  assert.equal(
    contexts[0].sourceSentence,
    'The legacy API has been deprecated in the latest release.'
  )
  assert.equal(contexts[0].sourceSentenceKey, normalizeVocabSentence(contexts[0].sourceSentence))
})
