import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReply, stripReasoning, stopSequencesFor } from '../scene/reply.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { buildTurn } from '../build-turn.js'

const opts = { userNames: ['민준'], castNames: ['서연', '도윤'] }
const kinds = (result) => result.issues.map((issue) => `${issue.severity}:${issue.kind}`)

test('stripReasoning — 짝이 맞는 <think> 블록을 떼어 따로 돌려준다', () => {
  const out = stripReasoning('<think>\n유저가 화났다. 달래자.\n</think>\n서연: 미안해.')
  assert.equal(out.text, '서연: 미안해.')
  assert.equal(out.reasoning, '유저가 화났다. 달래자.')
})

test('stripReasoning — thinking · reasoning 태그와 대소문자도 받는다', () => {
  assert.equal(stripReasoning('<Thinking>a</Thinking>서연: 응').text, '서연: 응')
  assert.equal(stripReasoning('<reasoning>a</reasoning>서연: 응').text, '서연: 응')
})

test('stripReasoning — 닫히지 않은 여는 태그는 끝까지 추론이다 (스트리밍 중)', () => {
  const out = stripReasoning('서연: 잠깐.\n<think>아직 생각 중')
  assert.equal(out.text, '서연: 잠깐.')
  assert.equal(out.reasoning, '아직 생각 중')
})

test('stripReasoning — 여는 태그 없이 닫는 태그로 시작하면 그 앞이 추론이다', () => {
  const out = stripReasoning('템플릿이 연 생각\n</think>\n서연: 응.')
  assert.equal(out.text, '서연: 응.')
  assert.equal(out.reasoning, '템플릿이 연 생각')
})

test('stripReasoning — 태그가 없으면 그대로다', () => {
  assert.deepEqual(stripReasoning('서연: 안녕'), { text: '서연: 안녕', reasoning: '' })
})

test('checkReply — 깨끗한 응답은 ok 이고 이슈가 없다', () => {
  const out = checkReply(koreanPlayscript, '서연: 왔구나.\n(문을 닫는다)\n도윤: 늦었네.', opts)
  assert.equal(out.ok, true)
  assert.deepEqual(out.issues, [])
  assert.equal(out.safeSegments.length, 3)
})

test('checkReply — 유저 이름으로 된 대사는 error 이고 그 앞까지만 safe 다', () => {
  const out = checkReply(koreanPlayscript, '서연: 뭐라고?\n민준: 아무것도 아니야.\n서연: 그래.', opts)
  assert.equal(out.ok, false)
  assert.deepEqual(kinds(out), ['error:user_dialogue'])
  assert.equal(out.issues[0].index, 1)
  assert.deepEqual(out.safeSegments, [{ type: 'dialogue', speaker: '서연', text: '뭐라고?' }])
})

test('checkReply — 유저 속마음도 대필이다', () => {
  const out = checkReply(koreanPlayscript, '서연: 응.\n민준 (속마음): 수상해.', opts)
  assert.deepEqual(kinds(out), ['error:user_dialogue'])
})

test('checkReply — 호스트 이름이 아니어도 "유저" · "user" · 강조 라벨은 유저다', () => {
  for (const line of ['유저: 응', 'User: ok', '**민준**: 응', '{{user}}: 응']) {
    const out = checkReply(koreanPlayscript, `서연: 자.\n${line}`, opts)
    assert.deepEqual(kinds(out), ['error:user_dialogue'], line)
  }
})

test('checkReply — asteriskScript 는 이름 목록 밖 라벨을 나레이션으로 접지만 유저 라벨은 잡는다', () => {
  const out = checkReply(asteriskScript, '서연: 왔어?\n*고개를 든다*\n민준: 응, 왔어.', opts)
  assert.deepEqual(kinds(out), ['error:user_dialogue'])
  assert.equal(out.issues[0].speaker, '민준')
  assert.equal(out.safeSegments.length, 2)
})

test('checkReply — 첫 줄부터 대필이면 safeSegments 가 비어 있다', () => {
  const out = checkReply(koreanPlayscript, '민준: 안녕.\n서연: 응.', opts)
  assert.deepEqual(out.safeSegments, [])
})

test('checkReply — 지문에서 유저가 주어면 warn 이고 ok 는 유지된다', () => {
  const out = checkReply(koreanPlayscript, '(민준이 고개를 끄덕인다)\n서연: 좋아.', opts)
  assert.equal(out.ok, true)
  assert.deepEqual(kinds(out), ['warn:user_action'])
})

test('checkReply — 유저에 대한 반응 묘사(소유격·목적격)는 잡지 않는다', () => {
  const text = '(민준의 주먹을 피한다)\n(민준을 노려본다)\n나레이션: 민준에게 시선이 쏠린다.\n서연: 그만해.'
  assert.deepEqual(checkReply(koreanPlayscript, text, opts).issues, [])
})

test('checkReply — 등장인물에 없는 화자는 warn 이다', () => {
  const out = checkReply(koreanPlayscript, '서연: 누구야?\n경비원: 출입증 보여 주세요.', opts)
  assert.equal(out.ok, true)
  assert.deepEqual(kinds(out), ['warn:unknown_speaker'])
})

test('checkReply — 등장인물 이름이 별칭과 겹치면 별칭으로 보지 않는다', () => {
  const out = checkReply(koreanPlayscript, '유저: 나는 이 세계의 관리자다.', { userNames: ['민준'], castNames: ['유저'] })
  assert.equal(out.ok, true)
})

test('checkReply — 추론 블록만 있거나 비어 있으면 empty error 다', () => {
  assert.deepEqual(kinds(checkReply(koreanPlayscript, '<think>음</think>', opts)), ['error:empty'])
  assert.deepEqual(kinds(checkReply(koreanPlayscript, '   ', opts)), ['error:empty'])
})

test('checkReply — 추론 블록은 검사 전에 떼어 내고 reasoning 으로 돌려준다', () => {
  const out = checkReply(koreanPlayscript, '<think>민준: 이렇게 말하게 할까</think>\n서연: 응.', opts)
  assert.equal(out.ok, true)
  assert.equal(out.text, '서연: 응.')
  assert.equal(out.reasoning, '민준: 이렇게 말하게 할까')
})

test('checkReply — 방언이 아니면 던진다', () => {
  assert.throws(() => checkReply({}, '서연: 응'), /defineDialect/)
})

test('stopSequencesFor — 유저 이름과 "유저" 라벨을 줄머리로, 4개까지', () => {
  assert.deepEqual(stopSequencesFor({ userNames: ['민준'] }), ['\n민준:', '\n민준：', '\n유저:', '\n유저：'])
  assert.deepEqual(stopSequencesFor({ userNames: ['유저'] }), ['\n유저:', '\n유저：'])
  assert.deepEqual(stopSequencesFor({ userNames: ['민준'], castNames: ['유저'] }), ['\n민준:', '\n민준：'])
})

test('buildTurn — turn.checkReply 는 턴의 방언·등장인물·유저 이름을 쓴다', async () => {
  const turn = await buildTurn({
    cards: [{ name: '서연' }],
    player: { name: '하준' },
    userName: '민준',
    dialect: asteriskScript,
    userInput: '*문을 연다*',
  })
  assert.equal(turn.checkReply('서연: 왔어?').ok, true)
  assert.deepEqual(kinds(turn.checkReply('서연: 왔어?\n하준: 응.')), ['error:user_dialogue'])
  assert.deepEqual(kinds(turn.checkReply('서연: 왔어?\n민준: 응.')), ['error:user_dialogue'])
  assert.deepEqual(turn.stopSequences, ['\n하준:', '\n하준：', '\n민준:', '\n민준：'])
})
