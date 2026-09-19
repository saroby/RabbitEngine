import test from 'node:test'
import assert from 'node:assert/strict'
import { emptySceneState, renderSceneState, applySceneDelta, validateIndicatorDefs, initialIndicators, TENSIONS } from '../scene/state.js'

const defs = [{ key: '호감도', label: '호감도', type: 'number', min: 0, max: 100, initial: 50, inferred: true, visible: true }]

test('emptySceneState — 빈 상태는 렌더하면 빈 문자열이다', () => {
  assert.equal(renderSceneState(emptySceneState()), '')
})

test('renderSceneState — 채워진 필드만 산문으로 낸다', () => {
  const { state } = applySceneDelta(emptySceneState(), {
    place: '자취방 현관', time: '자정 직후', tension: 'hostile',
    characters: { 유리: { body: { add: ['왼뺨에 멍'] }, emotion: '굴욕감', toward: { 유저: '경계' } } },
    threads: { add: ['유리가 사과를 요구함'] },
  }, { messageId: 'm1' })
  assert.equal(renderSceneState(state), '지금: 자취방 현관, 자정 직후. 긴장: 적대적.\n유리: 왼뺨에 멍. 굴욕감. 유저에게 경계.\n미해결: 유리가 사과를 요구함.')
})

test('applySceneDelta — 원본을 바꾸지 않고 updatedAt 을 찍는다', () => {
  const before = emptySceneState()
  const { state } = applySceneDelta(before, { place: '역' }, { messageId: 'm2' })
  assert.equal(before.place, null)
  assert.deepEqual(state.updatedAt, { messageId: 'm2' })
  assert.equal(before.revision, 0)
  assert.equal(state.revision, 1)
})

test('applySceneDelta — body remove 와 threads resolve 가 동작한다', () => {
  const s1 = applySceneDelta(emptySceneState(), { characters: { 유리: { body: { add: ['멍', '젖은 옷'] } } }, threads: { add: ['A', 'B'] } }, { messageId: 'm1' }).state
  const s2 = applySceneDelta(s1, { characters: { 유리: { body: { remove: ['젖은 옷'] } } }, threads: { resolve: ['A'] } }, { messageId: 'm2' }).state
  assert.deepEqual(s2.characters.유리.body, ['멍'])
  assert.deepEqual(s2.threads, ['B'])
})

test('applySceneDelta — 잘못된 값은 거부하고 이유를 남긴다', () => {
  const { state, rejected } = applySceneDelta(emptySceneState(), { tension: '분노', indicators: { 호감도: 150, 없는키: 1 } }, { indicatorDefs: defs, messageId: 'm1' })
  assert.equal(state.tension, 'calm')
  assert.deepEqual(state.indicators, {})
  assert.equal(rejected.length, 3)
  assert.match(rejected.join('\n'), /tension/)
  assert.match(rejected.join('\n'), /범위 밖/)
})

test('applySceneDelta — names 를 주면 모르는 인물은 거부한다', () => {
  const { state, rejected } = applySceneDelta(emptySceneState(), { characters: { 외부인: { emotion: '분노' } } }, { messageId: 'm1', names: ['유리'] })
  assert.deepEqual(state.characters, {})
  assert.equal(rejected.length, 1)
})

test('validateIndicatorDefs — 키 중복·타입 오류를 던지고 initialIndicators 가 초기값을 준다', () => {
  assert.throws(() => validateIndicatorDefs([...defs, ...defs]), /중복/)
  assert.throws(() => validateIndicatorDefs([{ key: 'x', type: 'date', initial: 1 }]), /type/)
  assert.deepEqual(initialIndicators(defs), { 호감도: 50 })
})

test('TENSIONS 가 여섯 가지다', () => { assert.equal(TENSIONS.length, 6) })

test('applySceneDelta — NaN·Infinity 지표는 거부한다', () => {
  const { state: s1, rejected: r1 } = applySceneDelta(emptySceneState(), { indicators: { 호감도: NaN } }, { indicatorDefs: defs, messageId: 'm1' })
  assert.deepEqual(s1.indicators, {})
  assert.equal(r1.length, 1)
  assert.match(r1.join('\n'), /유한한 숫자/)

  const { state: s2, rejected: r2 } = applySceneDelta(emptySceneState(), { indicators: { 호감도: Infinity } }, { indicatorDefs: defs, messageId: 'm2' })
  assert.deepEqual(s2.indicators, {})
  assert.equal(r2.length, 1)
  assert.match(r2.join('\n'), /유한한 숫자/)
})

test('applySceneDelta — __proto__ 같은 키는 거부한다', () => {
  const delta = JSON.parse('{"characters":{"__proto__":{"emotion":"위험"}},"indicators":{"constructor":1}}')
  const { state, rejected } = applySceneDelta(emptySceneState(), delta, { indicatorDefs: defs, messageId: 'm1' })
  assert.deepEqual(Object.keys(state.characters), [])
  assert.equal(Object.getPrototypeOf(state.characters), Object.prototype)
  assert.equal(rejected.length, 2)
  assert.match(rejected.join('\n'), /허용되지 않는 키/)
})
