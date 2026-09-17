import test from 'node:test'
import assert from 'node:assert/strict'
import { defineDialect, verifyDialect, parserVersionOf } from '../dialect/define.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { parseScript } from '../dialect/compat.js'
import { parseScript as legacyParseScript } from './fixtures/legacy-parse-script.js'

const SAMPLES = [
  '유리: 왔구나.',
  '유리:왔구나.',          // 전각 콜론
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
  assert.throws(() => defineDialect({ version: 1, spec: 'x', rules: [], fallback: 'narration' }), /id/)
  assert.throws(() => defineDialect({ id: 'x', spec: 'x', rules: [], fallback: 'narration' }), /version/)
  assert.throws(() => defineDialect({ id: 'x', version: 1, rules: [], fallback: 'narration' }), /spec/)
  assert.throws(() => defineDialect({ id: 'x', version: 1, spec: 'x', rules: [] }), /fallback/)
  assert.throws(() => defineDialect({ id: 'x', version: 1, spec: 'x', fallback: 'narration', rules: [{ kind: 'a', match: '문자열' }] }), /정규식/)
})

test('defineDialect — 얼어 있다', () => {
  assert.equal(Object.isFrozen(koreanPlayscript), true)
})
