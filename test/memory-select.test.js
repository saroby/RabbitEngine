import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMemory } from '../memory/index.js'
import { MEMORY_PRESETS } from '../memory/presets.js'

const messages = [
  { id: '1', role: 'user', text: '붉은 열쇠를 찾자' },
  { id: '2', role: 'assistant', text: '서랍을 열었다' },
  { id: '3', role: 'user', text: '창문을 봐' },
  { id: '4', role: 'assistant', text: '비가 내린다' },
  { id: '5', role: 'user', text: '열쇠는 어디 있지?' },
]

test('legacy 프리셋 다섯이 모두 등록되어 있다', () => {
  for (const id of ['legacy-full', 'legacy-window', 'legacy-summary', 'legacy-memory', 'legacy-retrieval']) {
    assert.ok(MEMORY_PRESETS[id], `${id} 가 없다`)
  }
})

test('legacy-full 은 전부 그대로 넘긴다', async () => {
  const out = await selectMemory(messages, { preset: 'legacy-full' }, {})
  assert.deepEqual(out.messages.map((m) => m.id), ['1', '2', '3', '4', '5'])
  assert.equal(out.manifest.preset, 'legacy-full')
})

test('legacy-window 는 최근 N 개만 남긴다', async () => {
  const out = await selectMemory(messages, { preset: 'legacy-window', assembly: { windowSize: 2 } }, {})
  assert.deepEqual(out.messages.map((m) => m.id), ['4', '5'])
})

test('legacy-summary 는 사용자 본문을 note 로 내보낸다', async () => {
  const out = await selectMemory(messages, { preset: 'legacy-summary', assembly: { windowSize: 2 }, summary: '열쇠를 찾는 중' }, {})
  assert.deepEqual(out.messages.map((m) => m.id), ['4', '5'])
  assert.equal(out.notes.length, 1)
  assert.equal(out.notes[0].kind, 'summary')
  assert.ok(out.notes[0].text.includes('열쇠를 찾는 중'))
})

test('manifest 는 선택 근거를 값으로 담는다', async () => {
  const out = await selectMemory(messages, { preset: 'legacy-window', assembly: { windowSize: 2 } }, {})
  assert.deepEqual(out.manifest.selectedOrdinals, [3, 4])
  assert.deepEqual(out.manifest.selectedMessageIds, ['4', '5'])
  assert.deepEqual(out.manifest.memoryCalls, [])
  assert.equal(out.manifest.cacheHit, true)
  assert.ok(out.manifest.chunkPolicy)
})

test('id 가 없는 경로에서도 retrieval 이 옛 메시지를 끌어온다', async () => {
  // Study 와 Batch 는 {role, text} 만 만든다. ordinal 로 고르지 않으면
  // 검색 결과가 통째로 사라지는데 아무 에러도 안 난다 — 가장 조용한 실패다.
  const noIds = messages.map(({ role, text }) => ({ role, text }))
  const out = await selectMemory(noIds, {
    preset: 'legacy-retrieval',
    assembly: { windowSize: 2, retrievalLimit: 2 },
  }, {})
  assert.deepEqual(out.messages.map((m) => m.text), ['붉은 열쇠를 찾자', '비가 내린다', '열쇠는 어디 있지?'])
  assert.deepEqual(out.manifest.retrievedOrdinals, [0])
})

test('알 수 없는 프리셋은 조용히 넘어가지 않는다', async () => {
  await assert.rejects(() => selectMemory(messages, { preset: '없는것' }, {}), /없는것/)
})

test('압축기 + cut 조합에서 창이 작으면 selectMemory 가 거부한다', async () => {
  // 등록 시점이 아니라 여기서 걸어야 한다 — 화면에서 창 크기를 바꾸는
  // runtime override 는 등록 검사를 지나오지 않는다.
  await assert.rejects(
    () => selectMemory(messages, {
      preset: 'memory-books',
      assembly: { windowMode: 'cut', windowSize: 5 },
    }, {}),
    /windowSize/,
  )
})

test('memory-books 는 protect 라 창을 줄여도 통과한다', async () => {
  const out = await selectMemory(messages, { preset: 'memory-books', assembly: { windowSize: 5 } }, {})
  assert.equal(out.manifest.assembly.windowMode, 'protect')
  assert.equal(out.manifest.preset, 'memory-books')
})
