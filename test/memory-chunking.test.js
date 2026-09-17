import test from 'node:test'
import assert from 'node:assert/strict'
import { projectMessages, activeTextOf } from '../memory/projection.js'
import { chunkEntries, assertWindowInvariant, DEFAULT_CHUNK_POLICY } from '../memory/chunking.js'

const build = (messages, policy = DEFAULT_CHUNK_POLICY) => {
  const real = messages.filter((m) => m.synthetic !== true)
  return chunkEntries(projectMessages(messages), real.map(activeTextOf), policy)
}

const scene = (n) => ({ role: 'assistant', text: `[장면: ${n}]\n무언가 일어난다` })
const line = (n) => ({ role: 'user', text: `대사 ${n}` })

test('씬 표지가 있는 메시지 다음에서 chunk 가 닫힌다', () => {
  const { closed, open } = build([line(1), scene(1), line(2), line(3)])
  assert.deepEqual(closed.map((c) => c.coversOrdinals), [[0, 1]])
  assert.deepEqual(open.coversOrdinals, [2, 3])
})

test('한 메시지에 장면 표지가 여러 개여도 경계는 하나다', () => {
  const many = { role: 'assistant', text: '[장면: 가]\n대사\n[장면: 나]\n대사' }
  const { closed } = build([line(1), many, line(2)])
  assert.equal(closed.length, 1)
  assert.deepEqual(closed[0].coversOrdinals, [0, 1])
})

test('씬 표지가 없으면 maxMessages 에서 강제로 닫는다', () => {
  const policy = { ...DEFAULT_CHUNK_POLICY, maxMessages: 3 }
  const { closed, open } = build([line(1), line(2), line(3), line(4), line(5)], policy)
  assert.deepEqual(closed.map((c) => c.coversOrdinals), [[0, 1, 2]])
  assert.deepEqual(open.coversOrdinals, [3, 4])
})

test('메시지를 덧붙여도 앞선 경계는 움직이지 않는다', () => {
  const base = [line(1), scene(1), line(2)]
  const before = build(base).closed.map((c) => c.coversOrdinals)
  const after = build([...base, scene(2), line(3)]).closed.map((c) => c.coversOrdinals)
  assert.deepEqual(after.slice(0, before.length), before)
})

test('합성 턴이 있어도 같은 경계가 나온다', () => {
  const plain = build([line(1), scene(1), line(2)])
  const withSynthetic = build([line(1), scene(1), line(2), { role: 'user', text: '(합성)', synthetic: true }])
  assert.deepEqual(withSynthetic.closed.map((c) => c.coversOrdinals), plain.closed.map((c) => c.coversOrdinals))
})

test('창 검사는 압축기 + cut 조합에서만 건다', () => {
  const policy = { ...DEFAULT_CHUNK_POLICY, maxMessages: 20 }
  const small = { windowSize: 5, windowMode: 'cut' }

  // protect 는 숨김이 요약이 덮는 범위의 부분집합이라 구멍이 없다 — 실측 확인.
  assert.doesNotThrow(() => assertWindowInvariant({ ...small, windowMode: 'protect' }, policy, { hasCompactor: true }))
  // 압축기가 없으면 옛 메시지를 버리는 것이 그 기법 자체다 (legacy-window 와 같다).
  assert.doesNotThrow(() => assertWindowInvariant(small, policy, { hasCompactor: false }))
  // 압축기 + cut 에서만 열린 chunk 가 창 밖으로 밀려 조용히 사라질 수 있다.
  assert.throws(() => assertWindowInvariant(small, policy, { hasCompactor: true }), /windowSize/)
})

test('열린 chunk 는 최대 maxMessages-1 개이므로 창이 그만큼이면 통과한다', () => {
  const policy = { ...DEFAULT_CHUNK_POLICY, maxMessages: 20 }
  const opts = { hasCompactor: true }
  assert.throws(() => assertWindowInvariant({ windowSize: 18, windowMode: 'cut' }, policy, opts), /windowSize/)
  assert.doesNotThrow(() => assertWindowInvariant({ windowSize: 19, windowMode: 'cut' }, policy, opts))
})

test('기본 정책은 메시지 수가 정하고 씬 표지는 보정이다', () => {
  assert.equal(DEFAULT_CHUNK_POLICY.by, 'messages')
  assert.equal(DEFAULT_CHUNK_POLICY.sceneSnap, true)
})

test('sceneSnap 을 끄면 씬 표지를 무시하고 메시지 수로만 자른다', () => {
  const policy = { ...DEFAULT_CHUNK_POLICY, maxMessages: 3, sceneSnap: false }
  const { closed } = build([line(1), scene(1), line(2), line(3), line(4)], policy)
  assert.deepEqual(closed.map((c) => c.coversOrdinals), [[0, 1, 2]])
})

test('옛 정책 이름 by:scene 도 그대로 받는다', () => {
  const legacy = { maxMessages: 20, parserVersion: 'script-v1', by: 'scene' }
  const { closed } = build([line(1), scene(1), line(2)], legacy)
  assert.deepEqual(closed.map((c) => c.coversOrdinals), [[0, 1]])
})
