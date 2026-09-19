import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn } from '../build-turn.js'
import { compilePrompt } from '../prompt/compile.js'
import { defineDialect } from '../dialect/define.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { createMemoryArtifactStore } from '../memory/artifact-store.js'
import { MEMORY_LABEL } from '../memory/defaults.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { emptySceneState, applySceneDelta } from '../scene/state.js'

const card = { name: '유리', description: '도서관 사서' }
const history = [
  { role: 'assistant', text: '유리: 어서 오세요.' },
  { role: 'user', text: '안녕하세요.' },
]

const custom = defineDialect({
  id: 'custom', version: 2, spec: '[커스텀 규약] 별표로 행동을 쓴다',
  rules: [{ kind: 'action', match: /^\*(.+)\*$/, text: 1 }],
  fallback: 'dialogue',
})

test('compilePrompt — 방언을 안 주면 지금과 같은 규약 층이 나온다', () => {
  const layer = compilePrompt({ cards: [card] }).layers.at(-1)
  assert.deepEqual(layer, { kind: 'output_contract', contract: 'script-v1', content: koreanPlayscript.spec })
})

test('compilePrompt — 방언을 주면 규약 층이 그 방언의 것이 된다', () => {
  const layer = compilePrompt({ cards: [card], dialect: custom }).layers.at(-1)
  assert.deepEqual(layer, { kind: 'output_contract', contract: 'custom-v2', content: custom.spec })
})

test('buildTurn — system 과 messages 와 manifest 를 준다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history })
  assert.equal(typeof turn.system, 'string')
  assert.deepEqual(turn.messages.map((m) => m.role), ['assistant', 'user'])
  assert.equal(turn.manifest.preset, 'legacy-full')
})

test('buildTurn — 기억 설정을 안 주면 이력을 전부 보낸다', async () => {
  const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: `줄 ${i}` }))
  const turn = await buildTurn({ cards: [card], messages: long })
  assert.equal(turn.messages.length, 40)
})

test('buildTurn — 옛 전략 이름도 받는다', async () => {
  const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: `줄 ${i}` }))
  const turn = await buildTurn({ cards: [card], messages: long, memory: { strategy: 'window', windowSize: 6 } })
  assert.equal(turn.messages.length, 6)
  assert.equal(turn.manifest.preset, 'legacy-window')
})

test('buildTurn — 대본 규약이 system 에 들어간다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history })
  assert.ok(turn.system.includes(koreanPlayscript.spec))
  assert.deepEqual(turn.manifest.dialect, { id: 'korean-playscript', version: 1 })
})

test('buildTurn — 방언을 바꾸면 규약과 manifest 가 같이 바뀐다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, dialect: custom })
  assert.ok(turn.system.includes('[커스텀 규약]'))
  assert.ok(!turn.system.includes(koreanPlayscript.spec))
  assert.deepEqual(turn.manifest.dialect, { id: 'custom', version: 2 })
  assert.equal(turn.manifest.chunkPolicy.parserVersion, 'custom-v2')
})

test('buildTurn — manifest.injectedText 가 모델에 나간 그대로 채워진다', async () => {
  const turn = await buildTurn({
    cards: [card], messages: history, userName: '루이',
    memory: { preset: 'legacy-summary', summary: '{{user}} 가 비 오는 날 왔다' },
  })
  assert.equal(turn.manifest.injectedText, `${MEMORY_LABEL}\n루이 가 비 오는 날 왔다`)
  assert.ok(turn.system.includes(turn.manifest.injectedText), 'manifest 의 증거가 실제 프롬프트와 다르다')
})

test('buildTurn — 기억 층이 없으면 injectedText 는 null 이다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history })
  assert.equal(turn.manifest.injectedText, null)
})

test('buildTurn — {{char}} 와 {{user}} 를 치환한다', async () => {
  const turn = await buildTurn({
    cards: [{ name: '유리', description: '{{user}} 를 아는 사서' }],
    userName: '루이',
    messages: history,
  })
  assert.ok(turn.system.includes('루이 를 아는 사서'))
  assert.ok(!turn.system.includes('{{user}}'))
})

test('buildTurn — manifest.prompt 에 층과 컴파일러 버전이 남는다', async () => {
  const turn = await buildTurn({ cards: [card], instruction: '장면을 전진시킨다.', messages: history })
  assert.equal(turn.manifest.prompt.layers[0].kind, 'instruction')
  assert.match(turn.manifest.prompt.compilerVersion, /^prompt-v/)
  assert.match(turn.manifest.prompt.blockCompilerVersion, /^blocks-v/)
  assert.deepEqual(turn.manifest.prompt.names, { char: '유리', user: '유저' })
})

// 컴팩터가 도는 프리셋으로 본다. lorebook 은 저장소도 llm 도 안 쓰기 때문에
// ctx 가 통째로 버려져도 통과해 버린다 — 그러면 아무것도 증명하지 못한다.
test('buildTurn — ctx 를 기억 층에 그대로 넘긴다', async () => {
  let builds = 0
  const store = createMemoryArtifactStore({ uid: () => `t${builds}`, now: () => 'now' })
  const llm = async () => {
    builds += 1
    return { text: '요약: 서고에서 이야기가 이어졌다.\n핵심어: 서고', provider: 'openai', latencyMs: 5, usage: { input: 10, output: 3 } }
  }
  const long = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'user' : 'assistant', text: `줄 ${i}` }))
  const input = { cards: [card], messages: long, memory: { preset: 'memory-books' } }
  const ctx = { artifacts: store, llm, scope: 'session', scopeId: 's1' }

  const first = await buildTurn(input, ctx)
  assert.equal(first.manifest.preset, 'memory-books')
  assert.ok(store.all().length > 0, 'ctx.artifacts 가 기억 층에 닿지 않았다')
  assert.ok(builds > 0, 'ctx.llm 이 기억 층에 닿지 않았다')
  const spent = builds

  const second = await buildTurn(input, ctx)
  assert.equal(second.manifest.cacheHit, true)
  assert.equal(builds, spent, '같은 입력인데 요약을 다시 샀다')
})

test('buildTurn — enforceFormat:false 면 대본 규약 층이 빠진다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, enforceFormat: false })
  assert.ok(!turn.system.includes(koreanPlayscript.spec))
  assert.notEqual(turn.manifest.prompt.layers.at(-1).kind, 'output_contract')
  // 규약 층을 빼도 청킹은 여전히 이 방언으로 씬 경계를 잡는다 — manifest 는 그대로 보고한다.
  assert.deepEqual(turn.manifest.dialect, { id: 'korean-playscript', version: 1 })
})

test('buildTurn — memory·ctx·dialect 가 null 이어도 견딘다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, memory: null, dialect: null }, null)
  assert.equal(turn.manifest.preset, 'legacy-full')
  assert.deepEqual(turn.manifest.dialect, { id: 'korean-playscript', version: 1 })
})

test('buildTurn — messages 와 로어북 인자가 null 이어도 견딘다', async () => {
  const turn = await buildTurn({
    cards: [card], messages: null,
    worldbooks: null, worldbookOverrides: null, worldbookOptions: null,
    instruction: null, userName: null,
  })
  assert.deepEqual(turn.messages, [])
  assert.equal(turn.manifest.prompt.names.user, '유저')
})

test('buildTurn — defineDialect 로 만들지 않은 객체는 방언으로 받지 않는다', async () => {
  await assert.rejects(
    () => buildTurn({ cards: [card], messages: history, dialect: { id: '가짜', version: 1, spec: '규약' } }),
    /defineDialect/,
  )
})

test('buildTurn — cards 가 비면 던진다', async () => {
  await assert.rejects(() => buildTurn({ messages: history }), /cards/)
  await assert.rejects(() => buildTurn({ cards: [], messages: history }), /cards/)
})

test('buildTurn — rating 없이도 돌고 all 로 기록된다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history })
  assert.equal(turn.manifest.scene.rating, 'all')
  assert.ok(Array.isArray(turn.blocks))
})

test('buildTurn — userInput 의 행동이 디렉티브에 들어가고 render 가 마지막 user 에 붙인다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, dialect: asteriskScript, rating: 'adult', userInput: '*밀친다*\n비켜' })
  assert.match(turn.directive, /행동 시도: 「밀친다」/)
  const rendered = turn.render()
  assert.equal(rendered.messages.at(-1).role, 'user')
  assert.match(rendered.messages.at(-1).text, /^\*밀친다\*\n비켜\n\n/)
})

test('buildTurn — sceneState 가 있으면 depth 2 블록으로 들어가고 hasState 가 참이다', async () => {
  const { state } = applySceneDelta(emptySceneState(), { place: '현관', tension: 'hostile' }, { messageId: 'm1' })
  const turn = await buildTurn({ cards: [card], messages: history, sceneState: state, userInput: '뭐야' })
  const block = turn.blocks.find((b) => b.kind === 'scene_state')
  assert.deepEqual(block.slot, { depth: 2 })
  assert.match(block.content, /현관/)
  assert.equal(turn.manifest.scene.hasState, true)
})

test('buildTurn — memoryNotes 는 depth 4, events 는 depth 0, pacing 은 system', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, memoryNotes: [{ kind: 'summary', text: '지난 일' }], events: ['정전'], pacing: 'eventful' })
  const slot = (kind) => turn.blocks.find((b) => b.kind === kind).slot
  assert.deepEqual(slot('memory'), { depth: 4 })
  assert.deepEqual(slot('event'), { depth: 0 })
  assert.equal(slot('pacing'), 'system')
  assert.ok(turn.system.includes('적극적으로'))
})

test('buildTurn — 모르는 rating·pacing 은 던진다', async () => {
  await assert.rejects(() => buildTurn({ cards: [card], messages: history, rating: 'nsfw' }), /rating/)
  await assert.rejects(() => buildTurn({ cards: [card], messages: history, pacing: 'fast' }), /pacing/)
  // `in` 은 프로토타입까지 본다 — Object.hasOwn 이 아니면 여기가 통과한다.
  await assert.rejects(() => buildTurn({ cards: [card], messages: history, pacing: 'toString' }), /pacing/)
})

test('buildTurn — system 문자열에는 depth·post_history 블록이 없다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, dialect: asteriskScript, userInput: '*친다*' })
  // 디렉티브가 실제로 생겼는지 먼저 본다 — 안 그러면 "행동이 안 잡혀서" 통과한다.
  assert.match(turn.directive, /행동 시도/)
  assert.ok(!turn.system.includes('행동 시도'))
})

test('buildTurn — userInput 이 로어북 키워드 스캔에 보인다', async () => {
  const worldbooks = [{ id: 'w1', name: '정전', keywords: ['정전'], content: '건물 전체가 정전이다', strategy: 'keyword' }]
  const without = await buildTurn({ cards: [card], messages: history, worldbooks })
  assert.equal(without.blocks.find((b) => b.kind === 'worldbook'), undefined)
  const turn = await buildTurn({ cards: [card], messages: history, worldbooks, userInput: '정전이야?' })
  assert.match(turn.blocks.find((b) => b.kind === 'worldbook').content, /건물 전체가 정전이다/)
  assert.equal(turn.manifest.scene.userInputScanned, true)
  assert.equal(without.manifest.scene.userInputScanned, false)
})

test('buildTurn — userInput 은 messages 와 render 에 한 번만 들어간다', async () => {
  const turn = await buildTurn({ cards: [card], messages: history, userInput: '정전이야?' })
  assert.notEqual(turn.messages.at(-1).text, '정전이야?')
  assert.equal(turn.messages.length, history.length)
  const seen = turn.render().messages.filter((m) => m.text.startsWith('정전이야?'))
  assert.equal(seen.length, 1)
})

test('buildTurn — 모든 블록에 trust 가 있고 카드의 behavior 가 렌더된다', async () => {
  const turn = await buildTurn({ cards: [{ ...card, behavior: '위협받으면 물러선다' }], messages: history, userInput: '뭐야' })
  assert.ok(turn.blocks.every((b) => ['engine', 'curated', 'external'].includes(b.trust)))
  assert.equal(turn.blocks.find((b) => b.kind === 'directive').trust, 'engine')
  assert.equal(turn.blocks.find((b) => b.kind === 'character').trust, 'curated')
  assert.match(turn.system, /행동 기준: 위협받으면 물러선다/)
  assert.ok(!('trust' in turn.manifest.prompt.layers[0]))
  assert.deepEqual(turn.manifest.scene.renderedAs, { midRole: 'user', postHistory: 'appended-to-user' })
})

test('buildTurn — userInput 의 임시 턴은 manifest ordinal 에 남지 않는다', async () => {
  const four = Array.from({ length: 4 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: `줄 ${i}` }))
  const turn = await buildTurn({ cards: [card], messages: four, userInput: '정전이야?' })
  const { selectedOrdinals, openChunkOrdinals } = turn.manifest
  assert.equal(Math.max(...selectedOrdinals), 3)
  assert.equal(Math.max(...openChunkOrdinals), 3)
  assert.equal(turn.manifest.scene.userInputOrdinal, 4)

  const plain = await buildTurn({ cards: [card], messages: four })
  assert.equal(plain.manifest.scene.userInputOrdinal, null)
  assert.deepEqual(plain.manifest.selectedOrdinals, selectedOrdinals)
})
