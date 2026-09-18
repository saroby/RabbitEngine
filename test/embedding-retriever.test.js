import test from 'node:test'
import assert from 'node:assert/strict'
import { embeddingRetriever, cosineSimilarity } from '../memory/retrievers/embedding.js'
import { selectMemory } from '../memory/index.js'
import { createMemoryArtifactStore } from '../memory/artifact-store.js'

// 결정적인 가짜 임베딩. 세 주제(열쇠·비·문)의 유무를 축으로 삼는다 — 글자가
// 안 겹쳐도 같은 주제면 가깝고, 글자가 겹쳐도 다른 주제면 멀다.
const AXES = [/열쇠|자물쇠|잠금/, /비|우산|젖/, /문|현관|출입/]
const vectorOf = (text) => AXES.map((axis) => (axis.test(text) ? 1 : 0)).concat([0.1])
function makeEmbed(counter) {
  return async ({ texts, model, provider }) => {
    counter.calls += 1
    counter.texts += texts.length
    return { vectors: texts.map(vectorOf), provider, model, latencyMs: 2, usage: { input: texts.length * 3 } }
  }
}

const messages = [
  { id: 'm0', role: 'user', text: '자물쇠가 잠겨 있어' },
  { id: 'm1', role: 'assistant', text: '우산을 편다' },
  { id: 'm2', role: 'user', text: '현관을 두드린다' },
  { id: 'm3', role: 'assistant', text: '비가 세차게 내린다' },
  { id: 'm4', role: 'user', text: '평범한 말' },
  { id: 'm5', role: 'assistant', text: '평범한 답' },
  { id: 'm6', role: 'user', text: '열쇠는 어디 있지?' },
]
const entries = messages.map((m, ordinal) => ({ ordinal, messageId: m.id, role: m.role, textHash: `h${ordinal}` }))
const texts = messages.map((m) => m.text)

test('코사인 유사도 — 같은 방향 1, 직교 0, 빈 벡터 0', () => {
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([], []), 0)
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0)
})

test('의미로 찾는다 — 글자가 안 겹치는 "자물쇠" 를 "열쇠" 로 끌어온다', async () => {
  const counter = { calls: 0, texts: 0 }
  const out = await embeddingRetriever.retrieve({
    entries, texts, windowSize: 3, limit: 2, config: { minScore: 0.5 }, embed: makeEmbed(counter),
  })
  assert.deepEqual(out.messages.map((m) => m.ordinal), [0])
  assert.equal(out.messages[0].ref, 'm0')
  assert.ok(out.messages[0].score > 0.9)
  // 질의 1 + 창 밖 후보 4 를 한 번에 임베딩한다.
  assert.equal(counter.calls, 1)
  assert.equal(counter.texts, 5)
  assert.equal(out.calls[0].purpose, 'embed')
  assert.equal(out.calls[0].partId, 'embedding')
  assert.equal(out.calls[0].promptTokens, 15)
})

test('캐시에 있는 벡터는 다시 임베딩하지 않는다', async () => {
  const counter = { calls: 0, texts: 0 }
  const vectors = new Map()
  const cache = {
    find: async (hash) => vectors.get(hash) ?? null,
    put: async (record) => { vectors.set(record.recipeHash, record); return record },
  }
  const input = { entries, texts, windowSize: 3, limit: 2, config: {}, embed: makeEmbed(counter), cache }
  const first = await embeddingRetriever.retrieve(input)
  assert.equal(first.cacheHit, false)
  assert.equal(counter.texts, 5)
  const second = await embeddingRetriever.retrieve(input)
  assert.equal(second.cacheHit, true)
  assert.equal(counter.texts, 5, '캐시가 있는데 다시 임베딩했다')
  assert.deepEqual(second.messages, first.messages)
})

test('buildIfMissing:false 면 임베딩하지 않고 cold 로 보고한다', async () => {
  const counter = { calls: 0, texts: 0 }
  const out = await embeddingRetriever.retrieve({
    entries, texts, windowSize: 3, limit: 2, config: {}, embed: makeEmbed(counter), cache: null, buildIfMissing: false,
  })
  assert.equal(counter.calls, 0)
  assert.deepEqual(out.messages, [])
  assert.equal(out.cold.length, 5)
  assert.equal(out.cacheHit, false)
})

test('임베딩 호출자가 없거나 개수가 안 맞으면 조용히 넘어가지 않는다', async () => {
  await assert.rejects(() => embeddingRetriever.retrieve({ entries, texts, windowSize: 3, limit: 2 }), /embed/)
  await assert.rejects(
    () => embeddingRetriever.retrieve({ entries, texts, windowSize: 3, limit: 2, embed: async () => ({ vectors: [[1]] }) }),
    /돌려줬습니다/,
  )
})

test('산출물을 대상으로 삼으면 keepKinds 는 항상 남고 나머지는 점수로 고른다', async () => {
  const artifacts = [
    { id: 'a0', kind: 'digest', text: '지금까지의 줄거리' },
    { id: 'a1', kind: 'scene', text: '문 앞에서 비를 맞았다' },
    { id: 'a2', kind: 'scene', text: '평범한 저녁 식사' },
    { id: 'a3', kind: 'scene', text: '자물쇠를 살펴봤다' },
  ]
  const out = await embeddingRetriever.retrieve({
    entries, texts, artifacts, windowSize: 3, limit: 1,
    config: { targets: ['artifacts'], keepKinds: ['digest'], minScore: 0.5 }, embed: makeEmbed({ calls: 0, texts: 0 }),
  })
  assert.deepEqual(out.messages, [])
  assert.deepEqual(out.artifacts.map((a) => a.id), ['a0', 'a3'])
  assert.equal(out.artifacts[0].score, null)
  assert.ok(out.artifacts[1].score > 0.9)
})

test('semantic 프리셋 — 창 밖 원문을 의미로 끌어와 앞뒤에 놓고 근거를 남긴다', async () => {
  const counter = { calls: 0, texts: 0 }
  const out = await selectMemory(messages, {
    preset: 'semantic',
    assembly: { windowSize: 3, retain: 1, retrievalLimit: 2 },
    embedder: { minScore: 0.5 },
  }, { embed: makeEmbed(counter) })
  assert.equal(out.manifest.parts.retriever, 'embedding')
  assert.deepEqual(out.manifest.retrievedOrdinals, [0])
  assert.ok(out.manifest.selectedOrdinals.includes(0))
  assert.equal(out.manifest.retrievalScores[0].ref, 'm0')
  assert.equal(out.manifest.memoryCalls[0].purpose, 'embed')
  assert.equal(out.manifest.cacheHit, false)
  assert.ok(out.manifest.recipeHashes.length >= 5)
})

test('semantic 프리셋 — 저장소가 있으면 벡터가 캐시돼 다음 턴엔 새 대사만 임베딩한다', async () => {
  const counter = { calls: 0, texts: 0 }
  const store = createMemoryArtifactStore()
  const ctx = { artifacts: store, embed: makeEmbed(counter), scope: 'session', scopeId: 'e1' }
  const config = { preset: 'semantic', assembly: { windowSize: 3, retrievalLimit: 2 } }
  await selectMemory(messages, config, ctx)
  const spent = counter.texts
  assert.ok(store.all().every((a) => a.kind === 'embedding' && Array.isArray(a.vector)))

  const grown = [...messages, { id: 'm7', role: 'assistant', text: '서랍 안에 있다' }, { id: 'm8', role: 'user', text: '문을 열자' }]
  const out = await selectMemory(grown, config, ctx)
  // 새 질의(m8) 와 새로 창 밖으로 밀린 후보(m4·m5) 만 임베딩한다. m6 은 지난
  // 턴의 질의로 이미 캐시에 있고 m0~m3 도 그대로다.
  assert.equal(counter.texts - spent, 3)
  assert.deepEqual(out.manifest.retrievedOrdinals, [2])
})

test('semantic-books 프리셋 — 줄거리는 항상 넣고 씬 요약은 닿는 것만 넣는다', async () => {
  const llm = async ({ system, messages: [{ text }] }) => ({
    text: system.includes('여러 장면 요약')
      ? '요약: 지금까지의 줄거리.\n핵심어: 줄거리'
      : `요약: ${text.includes('자물쇠') ? '자물쇠를 살펴본 장면' : text.includes('현관') ? '현관에서 비를 맞은 장면' : '평범한 장면'}.\n핵심어: 장면`,
    provider: 'openai', latencyMs: 1, usage: { input: 5, output: 2 },
  })
  // 씬 14개 → keepLeaves 4 → 접을 대상 10 → 줄거리 2 + 잎 2 + 최근 4 = 8 노드.
  const history = Array.from({ length: 29 }, (_, i) => ({
    id: `m${i}`, role: i % 2 ? 'assistant' : 'user',
    text: i === 20 ? '자물쇠가 잠겨 있어' : i === 10 ? '현관을 두드린다' : i === 28 ? '열쇠는 어디 있지?' : `평범한 말 ${i}`,
  }))
  const out = await selectMemory(history, {
    preset: 'semantic-books',
    chunkPolicy: { maxMessages: 2 },
    assembly: { windowSize: 3, retrievalLimit: 1 },
    reducerBuilder: { fanout: 4, keepLeaves: 4 },
  }, { llm, embed: makeEmbed({ calls: 0, texts: 0 }) })

  assert.deepEqual(out.manifest.artifacts.map((a) => a.kind), ['digest', 'digest', 'scene', 'scene', 'scene', 'scene', 'scene', 'scene'])
  // 잎 6개(씬 8~13) 중 '자물쇠' 씬(m20·m21 = 씬 10, 노드 색인 4)만 '열쇠' 에 닿는다.
  // 줄거리 둘은 점수와 무관하게 남는다.
  const kept = out.manifest.retrievalScores.filter((s) => s.ordinal === null)
  assert.deepEqual(kept.map((s) => s.artifactIndex), [0, 1, 4])
  assert.deepEqual(kept.slice(0, 2).map((s) => s.score), [null, null])
  assert.ok(kept[2].score > 0.9)
  // note 에 줄거리 둘과 골라낸 씬 하나만, 시간 순서로 들어간다.
  assert.deepEqual(out.notes[0].text.split('\n'), ['지금까지의 줄거리.', '지금까지의 줄거리.', '자물쇠를 살펴본 장면.'])
  assert.deepEqual(out.manifest.retrievedArtifactIds, [], '저장소가 없으면 id 는 없다')
  assert.ok(out.manifest.memoryCalls.some((c) => c.purpose === 'embed'))
  assert.ok(out.manifest.memoryCalls.some((c) => c.purpose === 'reduce'))
})
