// 희곡 파서 — 모델 출력 ≠ 화면 표현의 경계(원칙 ④). SCRIPT_FORMAT 이 약속한 줄 모양이 깨지면 여기서 잡힌다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseScript, choicesOf } from '../dialect/compat.js'

test('희곡 형식 6종을 가른다', () => {
  const segs = parseScript([
    '[장면: 밤, 야영지]',
    '나레이션: 모닥불이 타닥거린다.',
    '(조용히 다가온다)',
    '서윤: 아직 안 자?',
    '서윤 (속마음): 들키면 안 되는데.',
    '속마음: 그냥 속마음 줄.',
    '',
    '선택지:',
    '- 대답한다',
    '- 모른 척한다',
  ].join('\n'))
  assert.deepEqual(segs.map((s) => s.type), ['scene', 'narration', 'action', 'dialogue', 'inner', 'inner', 'choice', 'choice'])
  assert.equal(segs[0].text, '밤, 야영지')
  assert.equal(segs[3].speaker, '서윤')
  assert.equal(segs[3].text, '아직 안 자?')
  assert.equal(segs[4].speaker, '서윤')
  assert.deepEqual(choicesOf(segs), ['대답한다', '모른 척한다'])
})

test('형식을 안 지킨 줄은 나레이션으로 떨어지고, URL 은 대사로 오인하지 않는다', () => {
  const segs = parseScript('그냥 산문 한 줄.\nhttps://example.com/x')
  assert.deepEqual(segs.map((s) => s.type), ['narration', 'narration'])
})

test('선택지 블록은 빈 줄에서 끝난다', () => {
  const segs = parseScript('선택지:\n- 하나\n\n서윤: 다시 대사')
  assert.deepEqual(segs.map((s) => s.type), ['choice', 'dialogue'])
})

// 인라인 연출 태그 — 한 턴 안에서 무대를 여러 번 바꾼다.
// 이 줄이 완성되어 도착하는 시점과 다음 지문 줄이 오기까지 토큰 수십 개가 비므로
// 페이드에 충분한 선행이 생긴다 (ssot: 무대는 대본보다 먼저 선다).
test('[연출: …] 을 stage 조각으로 잡는다', () => {
  const segments = parseScript('[연출: 객잔 이층, 밤. 긴장]\n서윤: 늦었군.')

  assert.deepEqual(segments[0], { type: 'stage', text: '객잔 이층, 밤. 긴장' })
  assert.equal(segments[1].type, 'dialogue')
})

test('연출 태그는 장면 전환과 다른 조각이다', () => {
  const segments = parseScript('[장면: 객잔]\n[연출: 등불만 켜져 있다]')

  assert.deepEqual(segments.map((s) => s.type), ['scene', 'stage'])
})

// 스트리밍 중에는 마지막 줄이 아직 오는 중일 수 있다 — 완성된 줄만 연출로 친다.
test('완성된 줄만 돌려주는 모드가 있다', () => {
  const partial = '[연출: 객잔 이층, 밤]\n서윤: 늦었'
  assert.equal(parseScript(partial, { completeLinesOnly: true }).length, 1)
  assert.equal(parseScript(partial).length, 2)
})
