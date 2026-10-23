import test from 'node:test'
import assert from 'node:assert/strict'
import { isGrammarContraction, isGrammarContractionPhrase } from '../englishGrammar.ts'

test('否定助动词和常见代词缩写会被识别为语法缩写', () => {
  assert.equal(isGrammarContraction("didn't"), true)
  assert.equal(isGrammarContraction('didn’t'), true)
  assert.equal(isGrammarContraction("I'm"), true)
  assert.equal(isGrammarContraction("they've"), true)
  assert.equal(isGrammarContraction("let's"), true)
})

test('名词所有格和普通单词不会被误判为语法缩写', () => {
  assert.equal(isGrammarContraction("agent's"), false)
  assert.equal(isGrammarContraction('take'), false)
  assert.equal(isGrammarContraction('eat'), false)
})

test('只有以语法缩写开头的多词片段会被判定为语法加实义词组合', () => {
  assert.equal(isGrammarContractionPhrase("didn't eat"), true)
  assert.equal(isGrammarContractionPhrase('I won’t go'), true)
  assert.equal(isGrammarContractionPhrase('take off'), false)
  assert.equal(isGrammarContractionPhrase('eat today'), false)
  assert.equal(isGrammarContractionPhrase("didn't"), false)
})
