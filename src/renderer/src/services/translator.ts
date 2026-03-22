const sleep = (num: number): Promise<void> => {
  return new Promise((resolve) => {
    window.setTimeout(resolve, num)
  })
}

export const fakeTranslate = async (text: string): Promise<string> => {
  if (!text.trim()) return '等待翻译结果...'

  await sleep(800)

  const shouldFail = Math.random() < 0.3

  if (shouldFail) {
    throw new Error('翻译失败')
  }

  return `翻译结果:${text}`
}
