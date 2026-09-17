import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneCompactor, parseSummary } from '../memory/compactors/scene.js'
import { selectMemory } from '../memory/index.js'
import { MEMORY_PRESETS } from '../memory/presets.js'
import { createMemoryArtifactStore } from '../memory/artifact-store.js'

const chunk = { ordinal: 0, coversOrdinals: [0, 1], entries: [
  { ordinal: 0, role: 'user', messageId: 'm0', textHash: 'h0' },
  { ordinal: 1, role: 'assistant', messageId: 'm1', textHash: 'h1' },
] }
const texts = ['문을 열었다', '안에는 아무도 없었다']

const fakeLlm = async () => ({
  text: '요약: 문을 열었지만 방은 비어 있었다.\n핵심어: 문, 빈 방',
  provider: 'openai', latencyMs: 120, usage: { input: 40, output: 12 },
})

test('요약과 핵심어를 형식에서 뽑는다', () => {
  const { summary, keywords } = parseSummary('요약: 첫 줄.\n둘째 줄.\n핵심어: 가, 나, 다')
  assert.equal(summary, '첫 줄.\n둘째 줄.')
  assert.deepEqual(keywords, ['가', '나', '다'])
})

// 전각 콜론(U+FF1A)은 화면에서 ASCII 콜론과 똑같이 보인다. 문자로 쓰면 편집
// 도구가 바꿔 버리므로 이스케이프로만 선언하고 보간해서 쓴다.
const FW = '\uFF1A'

test('전각 콜론으로 쓴 머리도 ASCII 콜론과 같게 읽는다', () => {
  const { summary, keywords } = parseSummary(`요약${FW} 첫 줄.\n둘째 줄.\n핵심어${FW} 가, 나, 다`)
  assert.equal(summary, '첫 줄.\n둘째 줄.')
  assert.deepEqual(keywords, ['가', '나', '다'])
})

test('형식을 안 지켜도 본문 전체를 요약으로 삼는다', () => {
  const { summary, keywords } = parseSummary('그냥 줄글로 왔다')
  assert.equal(summary, '그냥 줄글로 왔다')
  assert.deepEqual(keywords, [])
})

test('압축기는 호출 비용을 계약대로 보고한다', async () => {
  const out = await sceneCompactor.build({ chunk, texts, config: { model: 'gpt-5.4-mini', provider: 'openai' }, llm: fakeLlm })
  assert.equal(out.artifacts[0].kind, 'scene')
  assert.deepEqual(out.artifacts[0].keywords, ['문', '빈 방'])
  const [call] = out.calls
  assert.equal(call.partId, 'scene')
  assert.equal(call.promptTokens, 40)
  assert.equal(call.cacheHit, false)
})

test('llm 없이 부르면 조용히 넘어가지 않는다', async () => {
  await assert.rejects(() => sceneCompactor.build({ chunk, texts, config: {} }), /llm/)
})

test('빈 요약이 오면 실패한다 — 조용히 빈 기억을 만들지 않는다', async () => {
  await assert.rejects(
    () => sceneCompactor.build({ chunk, texts, config: {}, llm: async () => ({ text: '' }) }),
    /빈 요약/,
  )
})

test('memory-books 는 LLM 프리셋이고 요약 모델이 본편과 분리되어 있다', () => {
  const preset = MEMORY_PRESETS['memory-books']
  assert.equal(preset.usesLlm, true)
  assert.equal(preset.compactor, 'scene')
  assert.ok(preset.builder.model, '요약 모델이 지정되지 않았다')
})

test('같은 재료면 두 번 만들지 않는다 — 캐시가 증분을 대신한다', async () => {
  let builds = 0
  let seq = 0
  const store = createMemoryArtifactStore({ uid: () => `a${seq += 1}`, now: () => 'now' })
  const llm = async () => { builds += 1; return fakeLlm() }
  const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `대사 ${i}` }))
  const ctx = { artifacts: store, llm, scope: 'session', scopeId: 's1' }

  const first = await selectMemory(messages, { preset: 'memory-books' }, ctx)
  assert.equal(first.manifest.cacheHit, false)
  assert.ok(builds > 0)
  const spent = builds

  const second = await selectMemory(messages, { preset: 'memory-books' }, ctx)
  assert.equal(builds, spent, '같은 재료인데 다시 만들었다')
  assert.equal(second.manifest.cacheHit, true)
  assert.equal(second.manifest.callsIncurredHere.calls, 0)
  assert.deepEqual(second.manifest.artifacts.map((a) => a.text), first.manifest.artifacts.map((a) => a.text))
})

// 소비자의 저장소는 SQLite·네트워크처럼 비동기일 수 있다. 엔진이 await 하지
// 않으면 find 가 돌려준 Promise 가 "캐시에 있다" 로 읽혀 요약이 통째로 사라진다.
test('find·put 이 Promise 를 돌려주는 저장소도 캐시로 쓴다', async () => {
  let builds = 0
  let seq = 0
  const inner = createMemoryArtifactStore({ uid: () => `b${seq += 1}`, now: () => 'now' })
  const store = { find: async (key) => inner.find(key), put: async (record) => inner.put(record) }
  const llm = async () => { builds += 1; return fakeLlm() }
  const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `대사 ${i}` }))
  const ctx = { artifacts: store, llm, scope: 'session', scopeId: 's3' }

  const first = await selectMemory(messages, { preset: 'memory-books' }, ctx)
  assert.equal(first.manifest.cacheHit, false)
  assert.ok(builds > 0, '비동기 저장소인데 처음부터 캐시 적중으로 읽었다')
  const spent = builds
  assert.deepEqual(first.manifest.artifacts.map((a) => a.kind), ['scene'])

  const second = await selectMemory(messages, { preset: 'memory-books' }, ctx)
  assert.equal(builds, spent, '비동기 저장소에서 캐시가 안 돌았다')
  assert.equal(second.manifest.cacheHit, true)
  assert.deepEqual(second.manifest.artifacts.map((a) => a.text), first.manifest.artifacts.map((a) => a.text))
})

test('buildIfMissing:false 면 만들지 않고 cold 로 보고한다 — freeze 가 쓰는 자리', async () => {
  let builds = 0
  const store = createMemoryArtifactStore({ uid: () => 'x', now: () => 'now' })
  const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `대사 ${i}` }))
  const out = await selectMemory(messages, { preset: 'memory-books' }, {
    artifacts: store,
    llm: async () => { builds += 1; return fakeLlm() },
    scope: 'session', scopeId: 's2', buildIfMissing: false,
  })
  assert.equal(builds, 0, 'freeze 가 돈을 썼다')
  assert.ok(out.manifest.coldChunks.length > 0)
  assert.equal(out.manifest.cacheHit, false)
  assert.equal(out.manifest.artifacts.length, 0)
})
