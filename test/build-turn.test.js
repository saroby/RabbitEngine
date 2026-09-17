import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn } from '../build-turn.js'
import { compilePrompt } from '../prompt/compile.js'
import { defineDialect } from '../dialect/define.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { createMemoryArtifactStore } from '../memory/artifact-store.js'
import { MEMORY_LABEL } from '../memory/defaults.js'

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
  assert.deepEqual(turn.manifest.prompt.names, { char: '유리', user: '유저' })
})

test('buildTurn — ctx 를 기억 층에 그대로 넘긴다', async () => {
  const store = createMemoryArtifactStore()
  const turn = await buildTurn(
    { cards: [card], messages: history, memory: { preset: 'lorebook' } },
    { artifacts: store, scope: 'session', scopeId: 's1' },
  )
  assert.equal(turn.manifest.preset, 'lorebook')
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
