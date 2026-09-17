// 프롬프트 조립 — 2층 구조 · 이름 치환 · 세계관 주입. 순수 함수라 서버 없이 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { substitute, namesOf, buildSystem, injectWorldbooks, renderCard, renderPlayerCard, SCRIPT_FORMAT } from '../prompt/legacy.js'
import { compilePrompt } from '../prompt/compile.js'

test('{{char}}/{{user}} 치환 — 대소문자·공백 허용, 비문자열은 그대로', () => {
  const names = { char: '서윤', user: '민준' }
  assert.equal(substitute('{{char}}와 {{ USER }} 가 {{Char}}', names), '서윤와 민준 가 서윤')
  assert.equal(substitute(undefined, names), undefined)
})

test('namesOf — 플레이어 카드 > userName > 기본값', () => {
  assert.deepEqual(namesOf({ card: { name: 'A' }, playerCard: { name: 'P' }, userName: 'U' }), { char: 'A', user: 'P' })
  assert.deepEqual(namesOf({ card: null, playerCard: null, userName: 'U' }), { char: '캐릭터', user: 'U' })
})

test('Zeta 기본 플레이어 프로필은 세션 userName을 이름과 설명에 쓴다', () => {
  const player = { name: '플레이어', usesSessionUserName: true, description: '{{user}}는 기자다' }
  const rendered = renderPlayerCard(player, { char: '경희', user: '루이스' })
  assert.match(rendered, /이름: 루이스/)
  assert.match(rendered, /설명: 루이스는 기자다/)
  assert.deepEqual(namesOf({ card: { name: '경희' }, playerCard: player, userName: '루이스' }), { char: '경희', user: '루이스' })
})

test('buildSystem — 지시문 → 카드들 → 등장인물 → 플레이어 → 세계관 → 호칭 → 형식 순서, 치환은 매 턴', () => {
  const sys = buildSystem({
    cards: [{ name: '서윤', description: '{{user}}의 언니' }, { name: '하린', description: '' }],
    playerCard: { name: '민준', description: '동생' },
    instructionText: '{{char}}답게 말한다',
    worldbooks: [{ name: '학교', strategy: 'always', content: '{{char}}는 3학년' }],
    messages: [],
  })
  const order = ['서윤답게 말한다', '[캐릭터]\n이름: 서윤\n설명: 민준의 언니', '[등장인물 — 이 장면에는 2명이 있다]', '[플레이어 캐릭터', '[설정: 학교]\n서윤는 3학년', '상대(유저)의 호칭: 민준', SCRIPT_FORMAT]
  let last = -1
  for (const piece of order) {
    const i = sys.indexOf(piece)
    assert.ok(i > last, `순서/포함 위반: ${piece.slice(0, 20)}`)
    last = i
  }
  assert.ok(!buildSystem({ cards: [], enforceFormat: false }).includes('[출력 형식'))
})

test('renderCard — 옛 필드는 설명 뒤에 라벨을 붙여 이어 붙는다', () => {
  assert.equal(renderCard({ name: 'A', description: '소개', personality: '차분' }), '[캐릭터]\n이름: A\n설명: 소개\n성격: 차분')
})

test('injectWorldbooks — keyword 전략은 최근 6턴에 키워드가 있을 때만', () => {
  const wb = { name: 'W', strategy: 'keyword', keywords: '검, 마법', content: 'C' }
  const recent = (t) => [{ text: t }]
  assert.deepEqual(injectWorldbooks([wb], recent('마법을 쓴다')), ['[설정: W]\nC'])
  assert.deepEqual(injectWorldbooks([wb], recent('평범한 하루')), [])
  assert.deepEqual(injectWorldbooks([{ ...wb, strategy: 'always' }], []), ['[설정: W]\nC'])
})

test('compilePrompt exposes every hidden prompt layer and WorldBook manifest', () => {
  const result = compilePrompt({
    cards: [{ id: 'card-a', name: '서윤', description: '탐정' }],
    instructionText: '장면을 전진시킨다',
    contextNotes: [{ kind: 'memory', text: '비를 싫어한다' }],
    worldbooks: [{ id: 'wb-a', name: '도시', strategy: 'always', content: '밤이다' }],
    messages: [],
    enforceFormat: true,
  })

  assert.equal(result.compilerVersion, 'prompt-v3')
  assert.deepEqual(result.layers.map((layer) => layer.kind), [
    'instruction', 'character', 'context_memory', 'worldbook', 'user_boundary', 'output_contract',
  ])
  assert.equal(result.worldbookManifest[0].id, 'wb-a')
  assert.equal(result.worldbookManifest[0].injected, true)
  assert.equal(buildSystem({
    cards: [{ id: 'card-a', name: '서윤', description: '탐정' }],
    instructionText: '장면을 전진시킨다',
    contextNotes: [{ kind: 'memory', text: '비를 싫어한다' }],
    worldbooks: [{ id: 'wb-a', name: '도시', strategy: 'always', content: '밤이다' }],
  }), result.system)
})
