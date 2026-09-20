import test from 'node:test'
import assert from 'node:assert/strict'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { verifyDialect } from '../dialect/define.js'

const NAMES = ['하윤', '서진']
const parse = (text, options = {}) => asteriskScript.parse(text, { names: NAMES, ...options })

test('asteriskScript — 예시가 규칙과 맞물린다', () => { verifyDialect(asteriskScript) })

test('이름: 대사 줄은 그 화자의 대사다', () => {
  assert.deepEqual(parse('하윤: 문 닫아요.\n서진: 어서 오세요.'), [
    { type: 'dialogue', speaker: '하윤', text: '문 닫아요.' },
    { type: 'dialogue', speaker: '서진', text: '어서 오세요.' },
  ])
})

test('*지문* 한 줄은 화자 없는 action 이다', () => {
  assert.deepEqual(parse('*바람이 분다.*'), [{ type: 'action', text: '바람이 분다.' }])
})

test('@: 줄은 화자 없는 narration 이고 화자를 초기화한다', () => {
  assert.deepEqual(parse('하윤: 안녕.\n@: 문이 닫힌다.\n둘째 줄'), [
    { type: 'dialogue', speaker: '하윤', text: '안녕.' },
    { type: 'narration', text: '문이 닫힌다.' },
    { type: 'narration', text: '둘째 줄' },
  ])
})

test('이어지는 줄은 현재 화자의 대사에 붙는다', () => {
  assert.deepEqual(parse('하윤: 첫 줄\n둘째 줄'), [{ type: 'dialogue', speaker: '하윤', text: '첫 줄\n둘째 줄' }])
})

test('대사 안의 *별표* 는 그대로 둔다', () => {
  assert.deepEqual(parse('하윤: 문을 열고 *미소 짓는다.* 어서 와.'), [
    { type: 'dialogue', speaker: '하윤', text: '문을 열고 *미소 짓는다.* 어서 와.' },
  ])
})

test('모르는 이름의 라벨은 화자가 아니다', () => {
  assert.deepEqual(parse('참고: 이건 대사가 아니다.'), [{ type: 'narration', text: '참고: 이건 대사가 아니다.' }])
})

test('names 를 안 주면 모든 라벨을 화자로 본다', () => {
  assert.deepEqual(asteriskScript.parse('아무개: 안녕'), [{ type: 'dialogue', speaker: '아무개', text: '안녕' }])
})

test('[[CHOICES]] 뒤 JSON 배열은 choice 조각이 된다', () => {
  assert.deepEqual(parse('하윤: 골라.\n[[CHOICES]] [{"title":"열기","text":"문을 연다"},{"title":"기다리기","text":"기다린다"}]'), [
    { type: 'dialogue', speaker: '하윤', text: '골라.' },
    { type: 'choice', text: '문을 연다', title: '열기' },
    { type: 'choice', text: '기다린다', title: '기다리기' },
  ])
})

test('partial 이면 마지막 줄을 버린다', () => {
  assert.deepEqual(parse('하윤: 안녕\n서진: 반', { partial: true }), [{ type: 'dialogue', speaker: '하윤', text: '안녕' }])
})

test('엔진 메모를 흉내 낸 [진행 메모: …]·[장면 상태] 줄은 버린다', () => {
  const out = asteriskScript.parse('[진행 메모: 직접적인 폭력 묘사를 피합니다.]\n@: [진행 메모: 결과에 초점을 맞춥니다.]\n하윤: 뭐, 괜찮아.\n[장면 상태]\n*고개를 돌린다*', { names: ['하윤'] })
  assert.deepEqual(out.map((s) => s.type), ['dialogue', 'action'])
  assert.equal(out[0].text, '뭐, 괜찮아.')
})

test('감싸거나 접두를 붙인 메모 줄도 버린다 — *…*, **…**, 「…」, 제로폭, @:', () => {
  for (const raw of ['*[진행 메모: x]*', '**[진행 메모: x]**', '「[진행 메모: x]」', '\u200b[진행 메모: x]', '@: **[진행 메모: x]**', '[장면 상태]', '*[장면 상태]*']) {
    const out = asteriskScript.parse(`${raw}\n하윤: 아니.`, { names: ['하윤'] })
    assert.deepEqual(out.map((s) => s.type), ['dialogue'], raw)
  }
  // 이야기 속 대괄호는 살아 있다. 라벨이 있어도 줄이 메모만으로 끝나지 않으면 이야기다.
  assert.equal(asteriskScript.parse('@: [문이 닫힌다]', { names: [] })[0].text, '[문이 닫힌다]')
  assert.deepEqual(asteriskScript.parse('*[장면 상태: 위급] 계기판의 경고등이 붉게 깜박인다.*', { names: [] }), [{ type: 'action', text: '[장면 상태: 위급] 계기판의 경고등이 붉게 깜박인다.' }])
  assert.equal(asteriskScript.parse('[장면 상태가 이상하다]', { names: [] })[0].text, '[장면 상태가 이상하다]')
})

test('대사에 붙인 메모 조각은 지우고, 라벨만 남으면 조각을 만들지 않는다', () => {
  const out = asteriskScript.parse('하윤: [진행 메모: 대사를 더하지 않는다.]\n하윤: 그래서?\n하윤: 알겠어 [진행 메모: x] 갈게', { names: ['하윤'] })
  assert.deepEqual(out, [{ type: 'dialogue', speaker: '하윤', text: '그래서?' }, { type: 'dialogue', speaker: '하윤', text: '알겠어  갈게' }])
  assert.deepEqual(asteriskScript.parse('[진행 메모: 전부 메모]', { names: [] }), [])
  // 원래부터 빈 라벨은 이전과 같다 — 다음 줄이 그 화자의 대사가 된다.
  assert.deepEqual(asteriskScript.parse('하윤:\n바로 다음 줄', { names: ['하윤'] }), [{ type: 'dialogue', speaker: '하윤', text: '바로 다음 줄' }])
  // 홀로 남은 * 도 이전과 같이 앞 대사에 붙는다 — 찌꺼기 규칙은 메모를 지운 줄에만 든다.
  assert.deepEqual(asteriskScript.parse('서진: 어서 와\n*', { names: ['서진'] }), [{ type: 'dialogue', speaker: '서진', text: '어서 와\n*' }])
})
