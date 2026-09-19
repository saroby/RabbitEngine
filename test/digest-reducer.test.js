import test from 'node:test'
import assert from 'node:assert/strict'
import { digestReducer, planFold } from '../memory/reducers/digest.js'
import { selectMemory } from '../memory/index.js'
import { MEMORY_PRESETS } from '../memory/presets.js'
import { createMemoryArtifactStore } from '../memory/artifact-store.js'

// 씬 요약자와 줄거리 요약자를 구별하는 가짜 LLM. 어느 쪽이 몇 번 불렸는지 센다.
function makeLlm(counter) {
  return async ({ system, messages }) => {
    const isDigest = system.includes('여러 장면 요약')
    counter[isDigest ? 'reduce' : 'compact'] += 1
    const body = messages[0].text
    const text = isDigest
      ? `요약: 줄거리(${body.match(/\[구간 \d+\]/g)?.length ?? 0}구간).\n핵심어: 줄거리`
      : `요약: 장면 ${body.replace(/\n/g, ' / ')}.\n핵심어: 장면`
    return { text, provider: 'openai', latencyMs: 3, usage: { input: 10, output: 5 } }
  }
}

const history = (length) => Array.from({ length }, (_, i) => ({
  id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `대사 ${i}`,
}))

// chunk 를 2개 메시지마다 닫아 적은 메시지로 많은 씬을 만든다.
const tiered = (over = {}) => ({ preset: 'memory-books-tiered', chunkPolicy: { maxMessages: 2 }, ...over })

test('planFold — fanout 개씩 완성된 묶음만 부모가 되고 남는 것은 그 층에 남는다', () => {
  assert.deepEqual(planFold(0, 4), [])
  assert.deepEqual(planFold(3, 4), [])
  assert.deepEqual(planFold(11, 4), [
    { level: 1, groups: [{ start: 0, end: 4 }, { start: 4, end: 8 }], leftover: 3 },
  ])
  // 20 잎 → 5 부모 → 부모 4개가 또 묶여 층 2, 부모 1개가 남는다.
  assert.deepEqual(planFold(20, 4), [
    { level: 1, groups: [{ start: 0, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 12 }, { start: 12, end: 16 }, { start: 16, end: 20 }], leftover: 0 },
    { level: 2, groups: [{ start: 0, end: 4 }], leftover: 1 },
  ])
})

test('planFold — 잎이 하나 늘어도 이미 만든 묶음의 경계는 안 움직인다', () => {
  const before = planFold(9, 4)[0].groups
  const after = planFold(10, 4)[0].groups
  assert.deepEqual(after, before)
})

test('리듀서는 자식 둘 이상만 접고 비용을 계약대로 보고한다', async () => {
  const counter = { compact: 0, reduce: 0 }
  const children = [
    { text: '첫 장면', keywords: ['가'] },
    { text: '둘째 장면', keywords: [] },
  ]
  const out = await digestReducer.buildParent({ children, level: 1, config: { model: 'm', provider: 'openai' }, llm: makeLlm(counter) })
  assert.equal(out.artifacts[0].kind, 'digest')
  assert.equal(out.artifacts[0].level, 1)
  assert.equal(out.artifacts[0].text, '줄거리(2구간).')
  assert.equal(out.calls[0].partId, 'digest')
  assert.equal(out.calls[0].purpose, 'reduce')
  await assert.rejects(() => digestReducer.buildParent({ children: [children[0]], llm: makeLlm(counter) }), /둘 이상/)
  await assert.rejects(() => digestReducer.buildParent({ children }), /llm/)
})

test('memory-books-tiered — 오래된 씬은 줄거리로 접히고 최근 씬은 요약 그대로 남는다', async () => {
  const counter = { compact: 0, reduce: 0 }
  // 30 메시지 → 닫힌 씬 15. keepLeaves 4 → 접을 대상 11 → 부모 2 + 남는 잎 3 + 최근 4.
  const out = await selectMemory(history(30), tiered(), { llm: makeLlm(counter) })
  assert.equal(out.manifest.parts.reducer, 'digest')
  assert.equal(counter.compact, 15)
  assert.equal(counter.reduce, 2)
  const kinds = out.manifest.artifacts.map((a) => a.kind)
  assert.deepEqual(kinds, ['digest', 'digest', 'scene', 'scene', 'scene', 'scene', 'scene', 'scene', 'scene'])
  // 시간 순서 — 줄거리가 덮는 구간이 앞이고, 잎은 그 뒤를 이어 덮는다.
  assert.deepEqual(out.manifest.artifacts[0].coversOrdinals, [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(out.manifest.artifacts[1].coversOrdinals, [8, 9, 10, 11, 12, 13, 14, 15])
  assert.deepEqual(out.manifest.artifacts[2].coversOrdinals, [16, 17])
  assert.deepEqual(out.manifest.artifacts.at(-1).coversOrdinals, [28, 29])
  // note 에도 같은 순서로 들어간다.
  assert.ok(out.notes[0].text.startsWith('줄거리(4구간).\n줄거리(4구간).\n장면'))
  // 호출 장부에 두 부품이 다 있다.
  assert.equal(out.manifest.memoryCalls.filter((c) => c.partId === 'digest').length, 2)
  assert.equal(out.manifest.callsIncurredHere.calls, 17)
})

test('memory-books-tiered — 같은 재료면 줄거리도 다시 사지 않는다', async () => {
  const counter = { compact: 0, reduce: 0 }
  let seq = 0
  const store = createMemoryArtifactStore({ uid: () => `d${seq += 1}`, now: () => 'now' })
  const ctx = { artifacts: store, llm: makeLlm(counter), scope: 'session', scopeId: 't1' }
  const first = await selectMemory(history(30), tiered(), ctx)
  assert.equal(first.manifest.cacheHit, false)
  const spent = { ...counter }

  const second = await selectMemory(history(30), tiered(), ctx)
  assert.deepEqual(counter, spent)
  assert.equal(second.manifest.cacheHit, true)
  assert.deepEqual(second.manifest.artifacts, first.manifest.artifacts)
})

test('memory-books-tiered — 증분 = 통짜: 이력이 자라도 이미 만든 줄거리는 그대로 쓴다', async () => {
  const counter = { compact: 0, reduce: 0 }
  const store = createMemoryArtifactStore()
  const ctx = { artifacts: store, llm: makeLlm(counter), scope: 'session', scopeId: 't2' }
  const short = await selectMemory(history(30), tiered(), ctx)
  const spentReduce = counter.reduce

  // 씬 하나가 더 닫힌다 → 접을 대상 12 → 부모 3. 앞의 둘은 캐시, 셋째만 새로 만든다.
  const grown = await selectMemory(history(32), tiered(), ctx)
  assert.equal(counter.reduce, spentReduce + 1)
  // 씬 해시 뒤에 줄거리 해시가 온다 — 30 메시지는 씬 15, 32 메시지는 씬 16.
  assert.deepEqual(grown.manifest.recipeHashes.slice(16, 18), short.manifest.recipeHashes.slice(15, 17))
  assert.deepEqual(grown.manifest.artifacts.map((a) => a.kind).slice(0, 3), ['digest', 'digest', 'digest'])

  // 통짜로 처음 만든 것과 산출물이 같다.
  const fresh = await selectMemory(history(32), tiered(), { llm: makeLlm({ compact: 0, reduce: 0 }) })
  assert.deepEqual(
    fresh.manifest.artifacts.map(({ id: _id, ...rest }) => rest),
    grown.manifest.artifacts.map(({ id: _id, ...rest }) => rest),
  )
})

test('memory-books-tiered — 옛 메시지 하나가 바뀌면 그 조상 줄거리만 다시 만든다', async () => {
  const counter = { compact: 0, reduce: 0 }
  const store = createMemoryArtifactStore()
  const ctx = { artifacts: store, llm: makeLlm(counter), scope: 'session', scopeId: 't3' }
  await selectMemory(history(30), tiered(), ctx)
  const spent = { ...counter }

  const edited = history(30)
  edited[1].text = '대사 1 (고침)'
  await selectMemory(edited, tiered(), ctx)
  assert.equal(counter.compact, spent.compact + 1, '바뀐 씬 하나만 다시 요약해야 한다')
  assert.equal(counter.reduce, spent.reduce + 1, '그 씬을 덮는 줄거리 하나만 다시 접어야 한다')
})

test('memory-books-tiered — buildIfMissing:false 면 줄거리를 만들지 않고 잎을 그대로 내보낸다', async () => {
  const counter = { compact: 0, reduce: 0 }
  const store = createMemoryArtifactStore()
  const ctx = { artifacts: store, llm: makeLlm(counter), scope: 'session', scopeId: 't4' }
  // 씬 요약은 미리 만들어 두고 줄거리만 없는 상태를 만든다.
  await selectMemory(history(30), { preset: 'memory-books', chunkPolicy: { maxMessages: 2 } }, ctx)
  const out = await selectMemory(history(30), tiered(), { ...ctx, buildIfMissing: false })
  assert.equal(counter.reduce, 0)
  assert.ok(out.manifest.coldChunks.some((c) => c.partId === 'digest'))
  assert.equal(out.manifest.artifacts.length, 15)
  assert.ok(out.manifest.artifacts.every((a) => a.kind === 'scene'))
})

test('새 프리셋 셋이 등록되어 있고 로어북을 원본 이력에서 본다', () => {
  for (const id of ['memory-books-tiered', 'semantic', 'semantic-books']) {
    const preset = MEMORY_PRESETS[id]
    assert.ok(preset, `${id} 없음`)
    assert.equal(preset.usesLlm, true)
    assert.equal(preset.worldbook.scanSource, 'raw')
  }
  assert.equal(MEMORY_PRESETS['memory-books-tiered'].reducer, 'digest')
  assert.equal(MEMORY_PRESETS['semantic'].retriever, 'embedding')
  assert.deepEqual(MEMORY_PRESETS['semantic-books'].embedder.keepKinds, ['digest'])
})
