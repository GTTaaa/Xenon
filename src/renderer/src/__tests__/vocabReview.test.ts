import assert from 'node:assert/strict'
import test from 'node:test'
import type { VocabFlashcard, VocabItem } from '../services/vocabDatabase.ts'
import {
  filterVocabItems,
  getVocabPagerMode,
  removeVocabFlashcardFromQueue
} from '../vocabReview.ts'

/** 构造列表与队列测试所需的最小词条 */
const createItem = (lemma: string, surface = lemma): VocabItem => ({
  lemma,
  lemmaLower: lemma.toLowerCase(),
  surface,
  meaning: '释义',
  targetText: '释义',
  side: 'source',
  encounterCount: 1,
  createdAt: 1,
  updatedAt: 1
})

/** 为一个词条补上闪卡所需的语境 */
const createCard = (lemma: string): VocabFlashcard => {
  const item = createItem(lemma)
  return {
    item,
    context: {
      lemmaLower: item.lemmaLower,
      sourceSentence: `${lemma} sentence.`,
      sourceSentenceKey: `${lemma.toLowerCase()} sentence`,
      targetSentence: '例句。',
      surface: lemma,
      createdAt: 1
    }
  }
}

test('单卡隐藏翻页组，6 张以内显示圆点，超过 6 张显示页码', () => {
  assert.equal(getVocabPagerMode(0), 'hidden')
  assert.equal(getVocabPagerMode(1), 'hidden')
  assert.equal(getVocabPagerMode(2), 'dots')
  assert.equal(getVocabPagerMode(4), 'dots')
  assert.equal(getVocabPagerMode(6), 'dots')
  assert.equal(getVocabPagerMode(7), 'page')
  assert.equal(getVocabPagerMode(12), 'page')
})

test('生词列表搜索同时匹配词元和最近词形', () => {
  const items = [createItem('migrate', 'migrated'), createItem('deprecate', 'deprecated')]

  assert.deepEqual(
    filterVocabItems(items, 'MIGR').map((item) => item.lemma),
    ['migrate']
  )
  assert.deepEqual(
    filterVocabItems(items, 'precat').map((item) => item.lemma),
    ['deprecate']
  )
  assert.equal(filterVocabItems(items, '').length, 2)
})

test('移出当前闪卡后落在下一张，末张被移除时回退到新的末张', () => {
  const cards = [createCard('alpha'), createCard('beta'), createCard('gamma')]

  const middleRemoved = removeVocabFlashcardFromQueue(cards, 1, 'beta')
  assert.deepEqual(
    middleRemoved.cards.map((card) => card.item.lemma),
    ['alpha', 'gamma']
  )
  assert.equal(middleRemoved.activeIndex, 1)

  const lastRemoved = removeVocabFlashcardFromQueue(cards, 2, 'gamma')
  assert.deepEqual(
    lastRemoved.cards.map((card) => card.item.lemma),
    ['alpha', 'beta']
  )
  assert.equal(lastRemoved.activeIndex, 1)
})

test('移出队列最后一条闪卡后返回空队列', () => {
  const result = removeVocabFlashcardFromQueue([createCard('alpha')], 0, 'alpha')

  assert.deepEqual(result.cards, [])
  assert.equal(result.activeIndex, 0)
})

test('移出非当前卡时保持当前单词不变并修正页码', () => {
  const cards = [createCard('alpha'), createCard('beta'), createCard('gamma')]

  const beforeCurrent = removeVocabFlashcardFromQueue(cards, 2, 'alpha')
  assert.equal(beforeCurrent.cards[beforeCurrent.activeIndex].item.lemma, 'gamma')
  assert.equal(beforeCurrent.activeIndex, 1)

  const afterCurrent = removeVocabFlashcardFromQueue(cards, 1, 'gamma')
  assert.equal(afterCurrent.cards[afterCurrent.activeIndex].item.lemma, 'beta')
  assert.equal(afterCurrent.activeIndex, 1)
})
