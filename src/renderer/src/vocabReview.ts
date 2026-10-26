import type { VocabFlashcard, VocabItem } from './services/vocabDatabase'

/** 按词元或最近词形做大小写不敏感的模糊筛选 */
export const filterVocabItems = (items: VocabItem[], query: string): VocabItem[] => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return items

  return items.filter(
    (item) =>
      item.lemma.toLowerCase().includes(normalizedQuery) ||
      item.surface.toLowerCase().includes(normalizedQuery)
  )
}

interface VocabFlashcardRemovalResult {
  cards: VocabFlashcard[]
  activeIndex: number
}

/**
 * 从当前复习队列移除一个词条。
 * 移除非当前卡时按词元重新定位当前卡；移除当前卡时优先落在原位置的下一张。
 */
export const removeVocabFlashcardFromQueue = (
  cards: VocabFlashcard[],
  activeIndex: number,
  lemmaLower: string
): VocabFlashcardRemovalResult => {
  const activeCard = cards[activeIndex] ?? cards[0]
  const remainingCards = cards.filter((card) => card.item.lemmaLower !== lemmaLower)
  if (remainingCards.length === cards.length) {
    return { cards, activeIndex }
  }
  if (remainingCards.length === 0) {
    return { cards: [], activeIndex: 0 }
  }

  // 当前卡未被移除时跟随同一词条，避免前方的卡片被删后页码发生偏移
  if (activeCard && activeCard.item.lemmaLower !== lemmaLower) {
    const preservedIndex = remainingCards.findIndex(
      (card) => card.item.lemmaLower === activeCard.item.lemmaLower
    )
    if (preservedIndex >= 0) {
      return { cards: remainingCards, activeIndex: preservedIndex }
    }
  }

  return {
    cards: remainingCards,
    activeIndex: Math.min(activeIndex, remainingCards.length - 1)
  }
}
