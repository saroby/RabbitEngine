import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTurn } from '../prompt/render.js'

const sys = (kind, content) => ({ kind, role: 'system', slot: 'system', content })
const at = (kind, depth, content) => ({ kind, role: 'system', slot: { depth }, content })
const post = (content) => ({ kind: 'directive', role: 'system', slot: 'post_history', content })
const history = [
  { role: 'assistant', text: 'a1' }, { role: 'user', text: 'u1' },
  { role: 'assistant', text: 'a2' }, { role: 'user', text: 'u2' },
  { role: 'assistant', text: 'a3' },
]

test('renderTurn — system 슬롯은 system 문자열이 되고 전체가 캐시 접두다', () => {
  const out = renderTurn([sys('a', 'A'), sys('b', 'B')], history, { userInput: '입력' })
  assert.equal(out.system, 'A\n\nB')
  assert.equal(out.cachePrefixLength, out.system.length)
})

test('renderTurn — depth 0 은 사용자 입력 바로 앞, depth 2 는 두 메시지 앞', () => {
  const out = renderTurn([at('event', 0, 'E'), at('scene_state', 2, 'S')], history, { userInput: '입력' })
  const texts = out.messages.map((m) => m.text)
  assert.deepEqual(texts, ['a1', 'u1', 'a2', 'S', 'u2', 'a3', 'E', '입력'])
})

test('renderTurn — 같은 depth·role 은 한 메시지로 합친다', () => {
  const out = renderTurn([at('x', 0, 'X'), at('y', 0, 'Y')], history, { userInput: '입력' })
  assert.equal(out.messages.at(-2).text, 'X\n\nY')
})

test('renderTurn — midRole 로 중간 블록의 역할을 정한다', () => {
  assert.equal(renderTurn([at('s', 2, 'S')], history, { userInput: '입력' }).messages[3].role, 'user')
  assert.equal(renderTurn([at('s', 2, 'S')], history, { userInput: '입력', midRole: 'system' }).messages[3].role, 'system')
})

test('renderTurn — post_history 는 사용자 입력 본문 뒤에 붙는다', () => {
  const out = renderTurn([post('D')], history, { userInput: '입력' })
  assert.deepEqual(out.messages.at(-1), { role: 'user', text: '입력\n\n[진행 메모: D]' })
})

test('renderTurn — userInput 이 없으면 post_history 는 별도 메시지다', () => {
  const out = renderTurn([post('D')], history, {})
  assert.deepEqual(out.messages.at(-1), { role: 'user', text: '[진행 메모: D]' })
})

test('renderTurn — 이력이 depth 보다 짧으면 맨 앞에 둔다', () => {
  const out = renderTurn([at('s', 9, 'S')], history.slice(0, 2), { userInput: '입력' })
  assert.equal(out.messages[0].text, 'S')
})

test('renderTurn — userFirst 면 assistant 로 시작하는 이력 앞에 여는 턴을 둔다', () => {
  const out = renderTurn([], history, { userInput: '입력', userFirst: true })
  assert.deepEqual(out.messages[0], { role: 'user', text: '*(이야기 시작)*' })
})

test('renderTurn — 여러 depth 가 모두 클램프돼도 큰 depth 가 앞에 온다', () => {
  const out = renderTurn([at('a', 4, 'D4'), at('b', 6, 'D6')], [{ role: 'assistant', text: 'm0' }], { userInput: '입력' })
  assert.deepEqual(out.messages.map((m) => m.text), ['D6', 'D4', 'm0', '입력'])
})

test('renderTurn — 음수·비정수 depth 는 던진다', () => {
  assert.throws(() => renderTurn([at('s', -1, 'S')], history, { userInput: '입력' }), /depth/)
  assert.throws(() => renderTurn([at('s', 1.5, 'S')], history, { userInput: '입력' }), /depth/)
})

test('renderTurn — 캐시 접두는 첫 동적 system 블록 앞까지다', () => {
  const blocks = [sys('instruction', 'A'), sys('character', 'B'), sys('worldbook', 'W'), sys('user_boundary', 'U'), sys('output_contract', 'O')]
  const out = renderTurn(blocks, history, { userInput: '입력' })
  assert.equal(out.cachePrefixLength, 'A\n\nB'.length)
  assert.deepEqual(out.cachePrefixKinds, ['instruction', 'character'])
  assert.equal(out.system.slice(0, out.cachePrefixLength), 'A\n\nB')
})

test('renderTurn — 동적 블록이 없으면 system 전체가 캐시 접두다', () => {
  const out = renderTurn([sys('instruction', 'A'), sys('character', 'B')], history, { userInput: '입력' })
  assert.equal(out.cachePrefixLength, out.system.length)
  assert.deepEqual(out.cachePrefixKinds, ['instruction', 'character'])
})

test('renderTurn — context_* 도 동적 블록이라 접두를 끊는다', () => {
  const out = renderTurn([sys('instruction', 'A'), sys('context_summary', 'C'), sys('output_contract', 'O')], history, {})
  assert.equal(out.cachePrefixLength, 'A'.length)
  assert.deepEqual(out.cachePrefixKinds, ['instruction'])
})

test('renderTurn — mergeSameRole 은 이웃한 같은 역할을 한 메시지로 합친다', () => {
  const blocks = [at('scene_state', 2, 'S')]
  const plain = renderTurn(blocks, history, { userInput: '입력' })
  const roles = plain.messages.map((m) => m.role)
  assert.ok(roles.some((role, i) => i > 0 && role === roles[i - 1]), '기본값에서는 같은 역할이 이어진다')

  const merged = renderTurn(blocks, history, { userInput: '입력', mergeSameRole: true })
  const mergedRoles = merged.messages.map((m) => m.role)
  assert.ok(mergedRoles.every((role, i) => i === 0 || role !== mergedRoles[i - 1]), '합친 뒤에는 역할이 번갈아 나온다')
  assert.ok(merged.messages.some((m) => m.text === 'S\n\nu2'), '합친 본문은 순서를 지킨다')
})
