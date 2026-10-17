import test from 'node:test'
import assert from 'node:assert/strict'
import { blockSnippet, SNIPPET_LENGTH } from '../editor/snippet.js'

test('engine block snippet shows {{content}} as the original-text marker on one line', () => {
  assert.equal(blockSnippet({ template: '{{content}}' }), '‹원문›')
  assert.equal(blockSnippet({ template: '[세계관]\n{{ content }}\n\n끝' }), '[세계관] ‹원문› 끝')
})

test('custom text block shows its content and a message block shows its count', () => {
  assert.equal(blockSnippet({ content: '  {{char}}의 말투를 유지한다.  ' }), '{{char}}의 말투를 유지한다.')
  assert.equal(blockSnippet({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }), '메시지 2개')
})

test('long wording is ellipsized to the snippet length and empty wording is labelled', () => {
  const snippet = blockSnippet({ content: '가'.repeat(80) })
  assert.equal([...snippet].length, SNIPPET_LENGTH)
  assert.ok(snippet.endsWith('…'))
  assert.equal(blockSnippet({ content: '가'.repeat(SNIPPET_LENGTH) }), '가'.repeat(SNIPPET_LENGTH))
  assert.equal(blockSnippet({ template: '  \n ' }), '(빈 문구)')
  assert.equal(blockSnippet(undefined), '')
})
