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
  assert.deepEqual(out.messages.at(-1), { role: 'user', text: '입력\n\nD' })
})

test('renderTurn — userInput 이 없으면 post_history 는 별도 메시지다', () => {
  const out = renderTurn([post('D')], history, {})
  assert.deepEqual(out.messages.at(-1), { role: 'user', text: 'D' })
})

test('renderTurn — 이력이 depth 보다 짧으면 맨 앞에 둔다', () => {
  const out = renderTurn([at('s', 9, 'S')], history.slice(0, 2), { userInput: '입력' })
  assert.equal(out.messages[0].text, 'S')
})

test('renderTurn — userFirst 면 assistant 로 시작하는 이력 앞에 여는 턴을 둔다', () => {
  const out = renderTurn([], history, { userInput: '입력', userFirst: true })
  assert.deepEqual(out.messages[0], { role: 'user', text: '*(이야기 시작)*' })
})
