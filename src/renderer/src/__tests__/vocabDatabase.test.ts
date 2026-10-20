import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VocabDatabase,
  findCachedVocab,
  getRandomVocabFlashcard,
  incrementPassiveVocabEncounters,
  recordVocabEncounter
} from '../services/vocabDatabase.ts'

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
  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.vocabContexts.count(), 1)

  const savedContext = await database.vocabContexts.toCollection().first()
  assert.equal(savedContext?.sourceSentence, 'She remained resilient through the crisis.')
  assert.equal(savedContext?.targetSentence, '她在危机中始终很有韧性。')
  assert.equal(savedContext?.surface, 'resilient')
})

test('重复遇到同一词会累加次数并更新最近词形', async (context) => {
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

  assert.equal(updated.encounterCount, 2)
  assert.equal(updated.surface, 'running')
  assert.equal(await database.vocabItems.count(), 1)
  assert.equal(await database.vocabContexts.count(), 1)
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
