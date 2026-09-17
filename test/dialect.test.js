import test from 'node:test'
import assert from 'node:assert/strict'
import { defineDialect, verifyDialect, parserVersionOf } from '../dialect/define.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { parseScript } from '../dialect/compat.js'
import { parseScript as legacyParseScript } from './fixtures/legacy-parse-script.js'

// 여기는 옛 파서와 결과가 같아야 하는 입력만 둔다. 전각 콜론은 옛 파서가
// 틀리던 입력이라 아래 별도 테스트에 있다.
const SAMPLES = [
  '유리: 왔구나.',
  '(문을 조용히 닫는다)',
  '(가)(나)',
  '나레이션: 비가 내린다.',
  '나레이터: 비가 내린다.',
  'Narration: rain falls.',
  '유리 (속마음): 왜 왔지.',
  '속마음: 왜 왔지.',
  '[장면: 저녁, 3층 계단]',
  '[연출: 조명을 낮춘다]',
  '선택지:\n- 올라간다\n- 돌아선다',
  '선택지:\n- 올라간다\n\n- 빈 줄 뒤는 선택지가 아니다',
  'https://example.com 을 본다',
  '이름이스무글자를넘어가는아주아주긴화자이름입니다: 대사',
  '유리: 왔구나.\n(문을 닫는다)\n선택지:\n1. 인사한다\n2) 무시한다',
  '아무 표지 없는 줄',
  '',
]

test('koreanPlayscript — 옮기기 전 파서와 같은 결과를 낸다', () => {
  for (const sample of SAMPLES) {
    assert.deepEqual(koreanPlayscript.parse(sample), legacyParseScript(sample), JSON.stringify(sample))
  }
})

test('koreanPlayscript — partial 은 마지막 줄을 버린다', () => {
  const text = '유리: 왔구나.\n(문을 닫는'
  assert.deepEqual(
    koreanPlayscript.parse(text, { partial: true }),
    legacyParseScript(text, { completeLinesOnly: true }),
  )
})

test('parseScript 호환 래퍼 — 옛 시그니처 그대로 돈다', () => {
  const text = '유리: 왔구나.\n(문을 닫는'
  assert.deepEqual(parseScript(text), legacyParseScript(text))
  assert.deepEqual(parseScript(text, { completeLinesOnly: true }), legacyParseScript(text, { completeLinesOnly: true }))
})

test('koreanPlayscript — 버전은 1 이고 parserVersion 은 script-v1 이다 (기억 캐시가 여기에 묶여 있다)', () => {
  assert.equal(koreanPlayscript.version, 1)
  assert.equal(parserVersionOf(koreanPlayscript), 'script-v1')
})

test('parserVersionOf — 다른 방언은 id 와 버전으로 이름을 짓는다', () => {
  assert.equal(parserVersionOf({ id: 'asterisk', version: 3 }), 'asterisk-v3')
  assert.equal(parserVersionOf({ id: 'korean-playscript', version: 2 }), 'korean-playscript-v2')
})

test('verifyDialect — examples 가 맞으면 통과한다', () => {
  assert.doesNotThrow(() => verifyDialect(koreanPlayscript))
})

test('verifyDialect — examples 가 어긋나면 던진다', () => {
  const broken = defineDialect({
    id: 'broken', version: 1, spec: '아무거나',
    rules: [{ kind: 'dialogue', match: /^(.+?):\s*(.+)$/, speaker: 1, text: 2 }],
    fallback: 'narration',
    examples: [{ text: '유리: 안녕', segments: [{ type: 'narration', text: '틀린 기대값' }] }],
  })
  assert.throws(() => verifyDialect(broken), /예시/)
})

test('defineDialect — 필수 항목이 없으면 던진다', () => {
  assert.throws(() => defineDialect(), /방언에 id/)
  assert.throws(() => defineDialect({ version: 1, spec: 'x', rules: [], fallback: 'narration' }), /id/)
  assert.throws(() => defineDialect({ id: 'x', spec: 'x', rules: [], fallback: 'narration' }), /version/)
  assert.throws(() => defineDialect({ id: 'x', version: 1, rules: [], fallback: 'narration' }), /spec/)
  assert.throws(() => defineDialect({ id: 'x', version: 1, spec: 'x', rules: [] }), /fallback/)
  assert.throws(() => defineDialect({ id: 'x', version: 1, spec: 'x', fallback: 'narration', rules: [{ kind: 'a', match: '문자열' }] }), /정규식/)
})

// g·y 가 붙은 정규식은 lastIndex 를 들고 다닌다 — 같은 텍스트를 두 번 파싱하면
// 두 번째가 다른 결과를 낸다. 방언은 순수해야 해서 등록 자체를 막는다.
test('defineDialect — g·y 플래그가 붙은 정규식은 거부한다', () => {
  const base = { id: 'x', version: 1, spec: '규약', fallback: 'narration' }
  const ok = [{ kind: 'action', match: /^\*(.+)\*$/, text: 1 }]
  assert.throws(() => defineDialect({ ...base, rules: [{ kind: 'action', match: /^\*(.+)\*$/g, text: 1 }] }), /플래그/)
  assert.throws(() => defineDialect({ ...base, rules: [{ kind: 'action', match: /^\*(.+)\*$/y, text: 1 }] }), /플래그/)
  assert.throws(() => defineDialect({ ...base, rules: [{ kind: 'action', match: /^\*(.+)\*$/, text: 1, reject: /https/g }] }), /플래그/)
  assert.throws(() => defineDialect({ ...base, rules: ok, blocks: [{ kind: 'choice', open: /^선택지$/g, item: /^- (.+)$/ }] }), /플래그/)
  assert.throws(() => defineDialect({ ...base, rules: ok, blocks: [{ kind: 'choice', open: /^선택지$/, item: /^- (.+)$/y }] }), /플래그/)
  // i·m 처럼 상태가 없는 플래그는 그대로 받는다.
  assert.doesNotThrow(() => defineDialect({ ...base, rules: [{ kind: 'action', match: /^\*(.+)\*$/i, text: 1 }] }))
})

test('defineDialect — 얼어 있다', () => {
  assert.equal(Object.isFrozen(koreanPlayscript), true)
})

// 전각 콜론(U+FF1A)은 화면에서 ASCII 콜론과 구별되지 않는다. 옛 파서는 문자
// 클래스에 ASCII 콜론을 두 번 적어 놓고 전각을 받는 줄 알았다. 그래서 여기서는
// 글자 그대로 쓰지 않고 항상 이스케이프로 쓴다.
const FW = '\uFF1A'

test('전각 콜론 — 테스트가 쓰는 글자가 정말 U+FF1A 다', () => {
  assert.equal(FW.codePointAt(0), 0xFF1A)
  assert.notEqual(FW, ':')
})

test('전각 콜론 — 모든 종류에서 ASCII 콜론과 같은 조각이 나온다', () => {
  const cases = [
    `유리${FW}왔구나.`,
    `유리 ${FW} 왔구나.`,
    `나레이션${FW} 비가 내린다.`,
    `유리 (속마음)${FW} 왜 왔지.`,
    `속마음${FW} 왜 왔지.`,
    `[장면${FW} 저녁, 3층 계단]`,
    `[연출${FW} 조명을 낮춘다]`,
    `선택지${FW}\n- 올라간다\n- 돌아선다`,
    `유리${FW} 시각은 12:30 이다`,
  ]
  for (const text of cases) {
    const ascii = text.replaceAll(FW, ':')
    assert.deepEqual(koreanPlayscript.parse(text), koreanPlayscript.parse(ascii), JSON.stringify(text))
  }
})

test('전각 콜론 — 옛 파서는 대사를 나레이션으로 떨어뜨렸고, 지금은 대사다', () => {
  const text = `유리${FW}왔구나.`
  assert.deepEqual(legacyParseScript(text), [{ type: 'narration', text }])
  assert.deepEqual(koreanPlayscript.parse(text), [{ type: 'dialogue', speaker: '유리', text: '왔구나.' }])
})

test('전각 콜론 — 메시지에 씬 표지가 있는지는 옛 파서와 같다 (버전을 안 올린 근거)', () => {
  // 청킹이 보는 것은 조각 배열이 아니라 "이 메시지에 scene 조각이 하나라도 있나" 다
  // (memory/chunking.js 의 closesChunk). 조각 개수는 달라져도 된다 — 예를 들어
  // 전각 콜론을 쓴 `선택지` 줄은 이제 블록을 열어 뒤 줄을 선택지로 묶는다.
  const hasScene = (segments) => segments.some((s) => s.type === 'scene')
  const messages = [
    `[장면${FW} 밤]`, `[장면${FW}밤]`, `[ 장면 ${FW} 밤 ]`, '[장면: 밤]', '[장면 밤]', '[장면]',
    `장면${FW} 밤`, `[연출${FW} 밤]`, `([장면${FW} 밤])`, `유리${FW} [장면${FW} 밤]`, `나레이션${FW} [장면: 밤]`,
    `선택지${FW}\n- [장면${FW} 밤]`, `선택지${FW}\n[장면${FW} 밤]`, `선택지${FW}\n- 하나\n\n[장면${FW} 밤]`,
    `[장면${FW} 밤] 뒤에 글자`, `유리${FW} 왔구나.\n[장면${FW} 밤]\n유리${FW} 가자.`, `유리${FW} 왔구나.\n(문을 닫는다)`,
  ]
  for (const message of messages) {
    assert.equal(hasScene(koreanPlayscript.parse(message)), hasScene(legacyParseScript(message)), JSON.stringify(message))
  }
})
