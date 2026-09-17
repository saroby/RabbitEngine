import test from 'node:test'
import assert from 'node:assert/strict'
import { projectMessages, activeTextOf, hashText } from '../memory/projection.js'

test('활성 후보의 본문을 보고, 표면 text 는 믿지 않는다', () => {
  const message = {
    id: 'm1', role: 'assistant', text: '낡은 표면 값',
    activeIndex: 1,
    candidates: [{ id: 'c0', text: '첫 응답' }, { id: 'c1', text: '두번째 응답' }],
  }
  assert.equal(activeTextOf(message), '두번째 응답')
  const [entry] = projectMessages([message])
  assert.equal(entry.candidateId, 'c1')
  assert.equal(entry.textHash, hashText('두번째 응답'))
})

test('후보가 없는 메시지는 text 를 쓰고 candidateId 는 null 이다', () => {
  const [entry] = projectMessages([{ id: 'u1', role: 'user', text: '문을 연다' }])
  assert.equal(entry.candidateId, null)
  assert.equal(entry.textHash, hashText('문을 연다'))
})

test('합성 턴은 projection 에서 빠지고 ordinal 을 소비하지 않는다', () => {
  const entries = projectMessages([
    { id: 'a', role: 'user', text: '하나' },
    { role: 'user', text: '(합성)', synthetic: true },
    { id: 'b', role: 'assistant', text: '둘' },
  ])
  assert.deepEqual(entries.map((e) => e.ordinal), [0, 1])
  assert.deepEqual(entries.map((e) => e.messageId), ['a', 'b'])
})

test('id 가 없는 경로(Study·Batch)에서도 ordinal 로 동작한다', () => {
  const entries = projectMessages([
    { role: 'user', text: '시드 1' },
    { role: 'assistant', text: '시드 2' },
  ])
  assert.deepEqual(entries.map((e) => e.ordinal), [0, 1])
  assert.deepEqual(entries.map((e) => e.messageId), [null, null])
})
