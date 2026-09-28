import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTools, authorizeToolCall } from '../prompt/tools.js'
import { buildTurn } from '../build-turn.js'

const specs = [
  { id: 'manseryeok', description: '사주 원국을 계산한다.', parameters: { type: 'object', properties: { birth: { type: 'string' } }, required: ['birth'] } },
  { id: 'tarot_draw', description: '타로 카드를 뽑는다.' },
  { id: 'shop_sell', description: '물건을 판다.', parameters: { type: 'object', properties: { item: { type: 'string' } }, additionalProperties: false } },
]
const seoyeon = { name: '서연', tools: ['manseryeok', 'tarot_draw'] }
const doyun = { name: '도윤', tools: ['shop_sell', 'tarot_draw'] }
const harin = { name: '하린' }

test('resolveTools — 장면 카드가 가리킨 도구만 명세 순서로 열고 소유자를 모은다', () => {
  const tools = resolveTools([doyun, seoyeon, harin], specs)
  assert.deepEqual(tools.map((t) => [t.name, t.owners]), [
    ['manseryeok', ['서연']],
    ['tarot_draw', ['도윤', '서연']],
    ['shop_sell', ['도윤']],
  ])
})

test('resolveTools — actor 가 소유자 enum 인 필수 인자로 들어가고 호스트 스키마는 보존된다', () => {
  const [manseryeok, , shop] = resolveTools([seoyeon, doyun], specs)
  assert.deepEqual(manseryeok.parameters.properties.actor.enum, ['서연'])
  assert.deepEqual(manseryeok.parameters.required, ['actor', 'birth'])
  assert.deepEqual(manseryeok.parameters.properties.birth, { type: 'string' })
  assert.equal(shop.parameters.additionalProperties, false)
  assert.match(manseryeok.description, /사용할 수 있는 인물: 서연/)
  // 명세를 건드리지 않는다.
  assert.equal(specs[0].parameters.properties.actor, undefined)
})

test('resolveTools — 소유자가 장면에 없는 도구는 열지 않는다', () => {
  assert.deepEqual(resolveTools([harin], specs), [])
  assert.deepEqual(resolveTools([seoyeon], specs).map((t) => t.name), ['manseryeok', 'tarot_draw'])
})

test('resolveTools — 잘못된 명세와 카드 참조는 조용히 버리지 않고 던진다', () => {
  assert.throws(() => resolveTools([{ name: 'x', tools: ['없는도구'] }], specs), /모르는 도구/)
  assert.throws(() => resolveTools([{ name: 'x', tools: 'manseryeok' }], specs), /문자열 배열/)
  assert.throws(() => resolveTools([], [{ id: '사주', description: 'x' }]), /영문/)
  assert.throws(() => resolveTools([], [specs[1], specs[1]]), /중복/)
  assert.throws(() => resolveTools([], [{ id: 'a', description: '' }]), /description/)
  assert.throws(() => resolveTools([], [{ id: 'a', description: 'x', parameters: { type: 'object', properties: { actor: {} } } }]), /예약/)
})

test('authorizeToolCall — 소유자만 통과하고 actor 를 뺀 인자를 돌려준다', () => {
  const tools = resolveTools([seoyeon, doyun], specs)
  assert.deepEqual(authorizeToolCall(tools, { name: 'manseryeok', input: { actor: '서연', birth: '1990-03-15' } }),
    { ok: true, name: 'manseryeok', actor: '서연', args: { birth: '1990-03-15' } })
  const denied = authorizeToolCall(tools, { name: 'manseryeok', input: { actor: '도윤', birth: '1990-03-15' } })
  assert.equal(denied.ok, false)
  assert.equal(denied.reason, 'actor_not_allowed')
  assert.equal(authorizeToolCall(tools, { name: 'manseryeok', input: { birth: 'x' } }).reason, 'actor_not_allowed')
  assert.equal(authorizeToolCall(tools, { name: 'rm_rf', input: { actor: '서연' } }).reason, 'unknown_tool')
  assert.equal(authorizeToolCall(tools, { name: 'shop_sell', input: '{"actor":"도윤"}' }).reason, 'invalid_input')
})

test('buildTurn — turn.tools 와 manifest.tools 를 내고, 도구가 없으면 빈 목록이다', async () => {
  const turn = await buildTurn({ cards: [seoyeon, harin], toolSpecs: specs })
  assert.deepEqual(turn.tools.map((t) => t.name), ['manseryeok', 'tarot_draw'])
  assert.deepEqual(turn.manifest.tools, [{ name: 'manseryeok', owners: ['서연'] }, { name: 'tarot_draw', owners: ['서연'] }])
  const plain = await buildTurn({ cards: [harin] })
  assert.deepEqual(plain.tools, [])
  assert.deepEqual(plain.manifest.tools, [])
})

test('buildTurn — 모르는 도구 참조는 기억 층 LLM 을 부르기 전에 던진다', async () => {
  let called = false
  const llm = async () => { called = true; return { text: '' } }
  await assert.rejects(buildTurn({ cards: [{ name: 'x', tools: ['nope'] }], memory: { preset: 'memory-books' } }, { llm }), /모르는 도구/)
  assert.equal(called, false)
})
