import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryArtifactStore } from '../memory/artifact-store.js'

const record = (over = {}) => ({
  scope: 'session', scopeId: 's1', recipeHash: 'r1',
  presetId: 'memory-books', partId: 'scene', partVersion: 1,
  chunkOrdinal: 0, coversOrdinals: [0, 1], coversMessageIds: ['m0', 'm1'],
  kind: 'summary', text: '문을 열었다', keywords: ['문'], buildCalls: [],
  ...over,
})

test('put 한 것을 find 로 찾는다', () => {
  const store = createMemoryArtifactStore()
  store.put(record())
  assert.equal(store.find({ scope: 'session', scopeId: 's1', recipeHash: 'r1' }).text, '문을 열었다')
})

test('scope 가 다르면 섞이지 않는다', () => {
  const store = createMemoryArtifactStore()
  store.put(record())
  store.put(record({ scope: 'run', scopeId: 'run1', text: '다른 실험' }))
  assert.equal(store.find({ scope: 'run', scopeId: 'run1', recipeHash: 'r1' }).text, '다른 실험')
  assert.equal(store.find({ scope: 'run', scopeId: 'run2', recipeHash: 'r1' }), null)
})

test('없으면 null 을 준다', () => {
  const store = createMemoryArtifactStore()
  assert.equal(store.find({ scope: 'session', scopeId: 'x', recipeHash: 'y' }), null)
})

test('put 은 id 와 contentHash 를 붙인다', () => {
  const store = createMemoryArtifactStore()
  const artifact = store.put(record())
  assert.match(artifact.id, /.+/)
  assert.match(artifact.contentHash, /^[0-9a-f]{16}$/)
})

test('uid 와 now 를 주입하면 결정적이다', () => {
  const store = createMemoryArtifactStore({ uid: () => 'fixed-id', now: () => '2026-09-17T00:00:00.000Z' })
  const artifact = store.put(record())
  assert.equal(artifact.id, 'fixed-id')
  assert.equal(artifact.createdAt, '2026-09-17T00:00:00.000Z')
})

test('all 은 쌓인 것을 전부 주고, 돌려준 배열을 고쳐도 저장소는 안 바뀐다', () => {
  const store = createMemoryArtifactStore()
  store.put(record())
  store.put(record({ scopeId: 's2' }))
  const all = store.all()
  assert.equal(all.length, 2)
  all.pop()
  assert.equal(store.all().length, 2)
})

test('고정된 산출물은 재빌드가 밀어내지 않는다', () => {
  const store = createMemoryArtifactStore()
  store.put(record({ pinned: true, text: '사람이 고정한 요약' }))
  store.put(record({ text: '새로 만든 요약' }))
  assert.equal(store.find({ scope: 'session', scopeId: 's1', recipeHash: 'r1' }).text, '사람이 고정한 요약')
  assert.equal(store.all().length, 2)
})

test('내용이 같으면 contentHash 가 같고, 다르면 다르다', () => {
  const store = createMemoryArtifactStore()
  const a = store.put(record())
  const b = store.put(record({ scopeId: 's2' }))
  const c = store.put(record({ scopeId: 's3', text: '다른 본문' }))
  assert.equal(a.contentHash, b.contentHash)
  assert.notEqual(a.contentHash, c.contentHash)
})
