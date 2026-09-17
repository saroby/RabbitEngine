import test from 'node:test'
import assert from 'node:assert/strict'

import { selectContext } from '../memory/legacy-strategies.js'
import { injectWorldbooksWithManifest } from '../worldbook/strategies.js'

const messages = [
  { id: '1', role: 'user', text: '붉은 열쇠를 찾자' },
  { id: '2', role: 'assistant', text: '서랍을 열었다' },
  { id: '3', role: 'user', text: '창문을 봐' },
  { id: '4', role: 'assistant', text: '비가 내린다' },
  { id: '5', role: 'user', text: '열쇠는 어디 있지?' },
]

test('legacy 5종이 프리셋 위에서 같은 메시지를 고른다', async () => {
  assert.deepEqual((await selectContext(messages, { strategy: 'full' })).messages.map((m) => m.id), ['1', '2', '3', '4', '5'])
  assert.deepEqual((await selectContext(messages, { strategy: 'window', windowSize: 2 })).messages.map((m) => m.id), ['4', '5'])
})

test('windowSize 를 안 주면 legacy 기본값 12 가 쓰인다', async () => {
  const out = await selectContext(messages, { strategy: 'window' })
  assert.equal(out.manifest.assembly.windowSize, 12)
})

// manifest 는 연구 기록의 근거다. 프리셋 이름은 legacy-full 이라고 찍으면서
// 실제로는 12개만 보내면 기록이 거짓말을 한다.
test('모르는 strategy 는 legacy-full 로 떨어지고 정말로 전부 보낸다', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, role: i % 2 ? 'assistant' : 'user', text: `대사 ${i}` }))
  const out = await selectContext(many, { strategy: '오타난전략' })
  assert.equal(out.manifest.preset, 'legacy-full')
  assert.equal(out.messages.length, 40)
})

test('summary 와 memory 는 사용자 본문을 note 로 분리해 내보낸다', async () => {
  const summary = await selectContext(messages, { strategy: 'summary', windowSize: 2, summary: '열쇠를 찾는 중' })
  const memory = await selectContext(messages, { strategy: 'memory', windowSize: 1, memoryNote: '서윤은 비를 싫어한다' })
  assert.deepEqual(summary.messages.map((m) => m.id), ['4', '5'])
  assert.deepEqual(summary.notes, [{ kind: 'summary', text: '열쇠를 찾는 중' }])
  assert.deepEqual(memory.messages.map((m) => m.id), ['5'])
  assert.deepEqual(memory.notes, [{ kind: 'memory', text: '서윤은 비를 싫어한다' }])
})

test('retrieval 이 옛 메시지를 끌어오되 최근 것을 중복시키지 않는다', async () => {
  const selected = await selectContext(messages, { strategy: 'retrieval', windowSize: 2, retrievalLimit: 2 })
  assert.deepEqual(selected.messages.map((m) => m.id), ['1', '4', '5'])
  assert.deepEqual(selected.manifest.retrievedMessageIds, ['1'])
  assert.deepEqual(selected.manifest.retrievalScores.map((s) => s.ref), ['1'])
  // 끌어온 메시지는 원문으로 들어간다. note 로 또 넣으면 같은 대사가 두 번
  // 들어가고, 기존 retrieval 전략은 note 를 만들지 않았다.
  assert.deepEqual(selected.notes, [])
})

test('WorldBook registry records the actual strategy, matches, and injected text', () => {
  const worldbooks = [
    { id: 'always', name: '학교', strategy: 'always', content: '교실은 3층이다' },
    { id: 'hit', name: '마법', strategy: 'keyword', keywords: '열쇠, 검', content: '열쇠는 붉다' },
    { id: 'miss', name: '바다', strategy: 'keyword', keywords: '파도', content: '파도가 높다' },
  ]
  const result = injectWorldbooksWithManifest(worldbooks, messages, { hit: 'keyword' })

  assert.deepEqual(result.chunks, ['[설정: 학교]\n교실은 3층이다', '[설정: 마법]\n열쇠는 붉다'])
  assert.deepEqual(result.manifest.map((entry) => [entry.id, entry.strategy, entry.injected]), [
    ['always', 'always', true],
    ['hit', 'keyword', true],
    ['miss', 'keyword', false],
  ])
  assert.deepEqual(result.manifest[1].matchedKeywords, ['열쇠'])
})
