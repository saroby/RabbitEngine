import test from 'node:test'
import assert from 'node:assert/strict'
import { createMacroExpander, macroVarsOf, checkMacros } from '../prompt/macros.js'
import { buildTurn } from '../build-turn.js'

const vars = { 호감도: 60, tension: 'hostile', place: '현관', 비밀공개: false, 별명: '토끼' }
const expand = createMacroExpander({ vars })

test('if — 숫자 비교가 참이면 본문, 거짓이면 else', () => {
  assert.equal(expand('{{#if 호감도 >= 50}}마음을 열었다{{else}}경계한다{{/if}}'), '마음을 열었다')
  assert.equal(expand('{{#if 호감도 > 80}}사랑{{else}}아직{{/if}}'), '아직')
  assert.equal(expand('{{#if 호감도 < 10}}적{{/if}}'), '')
})

test('if — 문자열 같음 · 다름, 따옴표 값', () => {
  assert.equal(expand('{{#if tension == hostile}}적대{{/if}}'), '적대')
  assert.equal(expand('{{#if tension != calm}}불안{{/if}}'), '불안')
  assert.equal(expand('{{#if place == "현관"}}문 앞{{/if}}'), '문 앞')
  assert.equal(expand('{{#if 호감도 == "60"}}딱 60{{/if}}'), '딱 60', '숫자 지표를 따옴표로 써도 같다')
})

test('if — 참거짓 그대로와 ! 부정', () => {
  assert.equal(expand('{{#if 비밀공개}}안다{{else}}모른다{{/if}}'), '모른다')
  assert.equal(expand('{{#if !비밀공개}}숨긴다{{/if}}'), '숨긴다')
  assert.equal(expand('{{#if 비밀공개 == false}}숨긴다{{/if}}'), '숨긴다')
})

test('if — 중첩되고, 꺼진 갈래 안의 조건 · 변수도 검사한다', () => {
  assert.equal(expand('{{#if 호감도 >= 50}}A{{#if tension == hostile}}B{{else}}C{{/if}}{{/if}}'), 'AB')
  // 꺼진 갈래 안의 오타도 지금 던진다 — 그 갈래가 처음 켜지는 턴까지 미루지 않는다.
  assert.throws(() => expand('{{#if 비밀공개}}{{#if 없는변수 > 1}}x{{/if}}{{/if}}끝'), /모르는 변수 없는변수/)
  assert.throws(() => expand('{{#if 비밀공개}}{{var:없는변수}}{{/if}}'), /모르는 변수 없는변수/)
  assert.throws(() => expand('{{#if 비밀공개}}x{{else if 호감도 >= }}y{{/if}}'), /읽을 수 없습니다/)
  assert.throws(() => expand('{{#if 비밀공개}}{{#if tension > 3}}x{{/if}}{{/if}}'), /숫자끼리만/)
})

test('if — 한 줄을 차지한 태그는 빈 줄을 남기지 않는다', () => {
  const text = '서연은 조용하다.\n{{#if 호감도 >= 50}}\n가끔 웃는다.\n{{else}}\n눈을 피한다.\n{{/if}}\n끝.'
  assert.equal(expand(text), '서연은 조용하다.\n가끔 웃는다.\n끝.')
})

test('else if — 위에서부터 처음 참인 갈래 하나만 낸다', () => {
  const tiers = '{{#if 호감도 >= 80}}애정{{else if 호감도 >= 50}}신뢰{{else if 호감도 >= 20}}호기심{{else}}경계{{/if}}'
  const at = (value) => createMacroExpander({ vars: { 호감도: value } })(tiers)
  assert.equal(at(90), '애정', '뒤 갈래도 참이지만 앞 갈래가 이긴다')
  assert.equal(at(60), '신뢰')
  assert.equal(at(30), '호기심')
  assert.equal(at(10), '경계')
  assert.equal(expand('{{#if 호감도 > 80}}a{{else if 호감도 > 90}}b{{/if}}끝'), '끝', 'else 없이 끝나도 된다')
  assert.equal(expand('{{#if 비밀공개}}{{#if 호감도 > 0}}a{{else if 호감도 > -1}}b{{else}}c{{/if}}{{/if}}끝'), '끝', '꺼진 부모 안에서는 어느 갈래도 안 낸다')
})

test('else if — 한 줄을 차지하면 빈 줄을 남기지 않는다', () => {
  const text = '서연은\n{{#if 호감도 >= 80}}\n웃는다.\n{{else if 호감도 >= 50}}\n고개를 끄덕인다.\n{{else}}\n눈을 피한다.\n{{/if}}\n끝.'
  assert.equal(expand(text), '서연은\n고개를 끄덕인다.\n끝.')
})

test('else if — 짝 없는 else if, else 뒤의 else if 는 던진다', () => {
  assert.throws(() => expand('a{{else if 호감도 > 1}}b'), /짝이 없는 \{\{else if\}\}/)
  assert.throws(() => expand('{{#if 호감도 > 1}}a{{else}}b{{else if 호감도 > 2}}c{{/if}}'), /\{\{else\}\} 뒤에는/)
})

test('모르는 제어 태그는 원문이 새지 않게 던진다', () => {
  for (const tag of ['{{elif 호감도 > 1}}', '{{elseif 호감도 > 1}}', '{{elsif 호감도 > 1}}', '{{else 호감도 > 1}}', '{{#unless 비밀공개}}', '{{/iff}}', '{{#if}}']) {
    assert.throws(() => expand(`{{#if 호감도 > 1}}a${tag}b{{/if}}`), /알 수 없는 태그/, tag)
  }
  assert.equal(expand('{{// 작가 메모}}본문'), '{{// 작가 메모}}본문', '다른 도구의 주석은 건드리지 않는다')
})

test('&& · || 는 조용히 틀리지 않고 던진다', () => {
  assert.throws(() => expand('{{#if tension == tense || tension == hostile}}x{{/if}}'), /&& · \|\|/)
  assert.throws(() => expand('{{#if 호감도 >= 50 && 비밀공개}}x{{/if}}'), /&& · \|\|/)
  assert.throws(() => expand('{{#if !비밀공개 && 호감도 > 1}}x{{/if}}'), /&& · \|\|/)
  assert.equal(expand('{{#if place != "a || b"}}따옴표 안은 글자{{/if}}'), '따옴표 안은 글자')
})

test('따옴표 없는 값 안의 비교 기호는 던진다', () => {
  assert.throws(() => expand('{{#if tension == hostile == calm}}x{{/if}}'), /비교 기호/)
  assert.equal(createMacroExpander({ vars: { place: 'a == b' } })('{{#if place == "a == b"}}같다{{/if}}'), '같다')
  assert.equal(createMacroExpander({ vars: { place: '안녕!' } })('{{#if place == 안녕!}}같다{{/if}}'), '같다', '! 하나는 비교 기호가 아니다')
})

test('같음 비교 — 숫자 변수는 숫자와, 참거짓 변수는 true · false 와만', () => {
  assert.throws(() => expand('{{#if 호감도 == 높음}}x{{/if}}'), /호감도 는 숫자라/)
  assert.throws(() => expand('{{#if 호감도 != ""}}x{{/if}}'), /호감도 는 숫자라/)
  assert.throws(() => expand('{{#if 비밀공개 == 1}}x{{/if}}'), /비밀공개 는 참거짓이라/)
  assert.throws(() => expand('{{#if 비밀공개 == "false"}}x{{/if}}'), /비밀공개 는 참거짓이라/)
  assert.equal(expand('{{#if 호감도 == "60"}}a{{/if}}{{#if 비밀공개 != true}}b{{/if}}'), 'ab')
  assert.equal(createMacroExpander({ vars: { place: null } })('{{#if place == "현관"}}x{{else}}아직{{/if}}'), '아직', '값이 없는 장소는 묻지 않는다')
})

test('같음 비교 — 문자열 변수와는 적힌 글자 그대로 비교한다', () => {
  const text = createMacroExpander({ vars: { place: '3', time: 'true', 별명: '007', 메모: null } })
  assert.equal(text('{{#if place == 3}}맞음{{/if}}'), '맞음', '3 을 숫자로 바꾸지 않는다')
  assert.equal(text('{{#if time == true}}맞음{{/if}}'), '맞음', 'true 를 참거짓으로 바꾸지 않는다')
  assert.equal(text('{{#if 별명 == 007}}맞음{{/if}}{{#if 별명 != 7}}!{{/if}}'), '맞음!', '앞자리 0 을 지우지 않는다')
  assert.equal(text('{{#if 메모 == 3}}x{{else}}없음{{/if}}'), '없음', '값이 없으면 무엇과도 같지 않다')
  assert.throws(() => text('{{#if place > 2}}x{{/if}}'), /숫자끼리만/, '크기 비교는 여전히 숫자끼리만')
})

test('} 하나를 빠뜨린 태그는 원문이 새지 않게 던진다', () => {
  for (const text of ['{{#if 호감도 > 1}}A{{else}B{{/if}}', '{{#if 호감도 > 1}A{{/if}', '호감도 {{var:호감도}', '{{random::a::b}', '{{#if 비밀공개}}{{elif x}{{/if}}']) {
    assert.throws(() => expand(text), /닫히지 않은 태그/, text)
  }
  assert.throws(() => expand('{{#if 비밀공개}}꺼진 갈래 {{else}}{{/if}}'.replace('{{else}}', '{{else}')), /닫히지 않은 태그/, '꺼진 갈래 안이어도 본다')
  assert.equal(expand('{{// 메모} 와 {{user} 는 매크로가 아니다'), '{{// 메모} 와 {{user} 는 매크로가 아니다')
})

test('choices — 허용값 밖의 값과 비교하면 던진다', () => {
  const scene = createMacroExpander({ vars: { tension: 'tense' }, choices: { tension: ['calm', 'tense'] } })
  assert.equal(scene('{{#if tension == tense}}긴장{{/if}}{{#if tension != "calm"}}!{{/if}}'), '긴장!')
  assert.throws(() => scene('{{#if tension == 긴장}}x{{/if}}'), /tension 는 calm · tense 중 하나와 비교합니다 \("긴장"\)/)
  assert.throws(() => scene('{{#if tension == calm}}{{else if tension == hostlie}}x{{/if}}'), /"hostlie"/)
})

test('checkMacros — 저장 전에 모든 갈래를 장면 상태 없이 검사한다', () => {
  const defs = [{ key: 'affection', label: '호감도', type: 'number', initial: 0 }, { key: 'secret', type: 'boolean', initial: false }]
  assert.deepEqual(checkMacros('{{#if 호감도 >= 80}}a{{else if affection >= 50}}b{{else}}c{{/if}} {{var:secret}}', { indicatorDefs: defs }), { ok: true })
  assert.deepEqual(checkMacros('그냥 문장'), { ok: true })
  assert.deepEqual(checkMacros(undefined), { ok: true })
  const typo = checkMacros('{{#if secret}}{{#if 호감두 > 1}}x{{/if}}{{/if}}', { indicatorDefs: defs })
  assert.equal(typo.ok, false)
  assert.match(typo.error, /모르는 변수 호감두/)
  assert.match(checkMacros('{{#if tension == 적대}}x{{/if}}').error, /tension 는 calm · playful · tense · hostile · intimate · grief 중 하나/)
  assert.match(checkMacros('{{#if 호감도 > 1}}x', { indicatorDefs: defs }).error, /닫히지 않은/)
  // 지표가 tension 이라는 key 를 쓰면 그 지표의 규칙을 따른다.
  assert.deepEqual(checkMacros('{{#if tension == 높음}}x{{/if}}', { indicatorDefs: [{ key: 'tension', type: 'string', initial: '낮음' }] }), { ok: true })
})

test('var — 값을 넣고, null 은 빈칸이다', () => {
  assert.equal(expand('호감도 {{var:호감도}}, 별명 {{var:별명}}'), '호감도 60, 별명 토끼')
  assert.equal(createMacroExpander({ vars: { time: null } })('[{{var:time}}]'), '[]')
})

test('random — 같은 시드면 같은 값, 시드가 바뀌면 고르게 흩어진다', () => {
  const text = '{{random::비::눈::맑음}}'
  const a = createMacroExpander({ seed: 7 })(text)
  assert.equal(createMacroExpander({ seed: 7 })(text), a)
  assert.ok(['비', '눈', '맑음'].includes(a))
  const seen = new Set(Array.from({ length: 30 }, (_, seed) => createMacroExpander({ seed })(text)))
  assert.equal(seen.size, 3)
})

test('random — 한 문구 안의 두 random 은 같은 시드여도 따로 고른다', () => {
  const results = Array.from({ length: 20 }, (_, seed) => createMacroExpander({ seed })('{{random::a::b}}{{random::a::b}}'))
  assert.ok(results.some((pair) => pair[0] !== pair[1]))
})

test('이름 · 블록 태그와 매크로가 없는 문구는 그대로 둔다', () => {
  assert.equal(expand('{{user}} 와 {{char}} — {{content}} {{block:long_description}}'), '{{user}} 와 {{char}} — {{content}} {{block:long_description}}')
  assert.equal(expand('그냥 문장'), '그냥 문장')
})

test('오류 — 모르는 변수, 짝 안 맞는 태그, 읽을 수 없는 조건, 숫자 아닌 크기 비교', () => {
  assert.throws(() => expand('{{var:호감돈}}'), /모르는 변수 호감돈/)
  assert.throws(() => expand('{{#if 호감도 > 1}}x'), /닫히지 않은/)
  assert.throws(() => expand('x{{/if}}'), /짝이 없는 \{\{\/if\}\}/)
  assert.throws(() => expand('{{#if 호감도}}a{{else}}b{{else}}c{{/if}}'), /\{\{else\}\} 는 하나만/)
  assert.throws(() => expand('a{{else}}b'), /짝이 없는 \{\{else\}\}/)
  assert.throws(() => expand('{{#if 호감도 >= }}x{{/if}}'), /읽을 수 없습니다/)
  assert.throws(() => expand('{{#if tension > 3}}x{{/if}}'), /숫자끼리만/)
  assert.throws(() => expand('{{#if !호감도 > 3}}x{{/if}}'), /같이 쓸 수 없습니다/)
})

test('macroVarsOf — 지표는 key 와 label 로, 값이 없으면 initial, 장면 필드도 들어간다', () => {
  const defs = [{ key: 'affection', label: '호감도', type: 'number', initial: 10 }, { key: 'trust', type: 'number', initial: 0 }]
  const out = macroVarsOf({ place: '현관', time: '자정', tension: 'tense', indicators: { affection: 55 } }, defs)
  assert.deepEqual(out, { place: '현관', time: '자정', tension: 'tense', affection: 55, 호감도: 55, trust: 0 })
  assert.deepEqual(macroVarsOf(null, []), { place: null, time: null, tension: 'calm' })
})

const indicatorDefs = [{ key: 'affection', label: '호감도', type: 'number', initial: 0 }]
const sceneState = (affection) => ({ version: 1, revision: 1, place: null, time: null, tension: 'calm', characters: {}, threads: [], indicators: { affection }, updatedAt: null })

test('buildTurn — 카드 · 지시문 · 소개 · 로어북 · 커스텀 블록에서 지표로 문장이 바뀐다', async () => {
  const input = (affection) => ({
    cards: [{ name: '서연', description: '{{#if 호감도 >= 50}}{{user}}에게 마음을 열었다{{else}}{{user}}를 경계한다{{/if}}' }],
    userName: '민준',
    instruction: '호감도는 {{var:호감도}}이다.',
    longDescription: '{{#if affection >= 50}}봄{{else}}겨울{{/if}}',
    worldbooks: [{ id: 'w', name: '비밀', strategy: 'always', content: '{{#if 호감도 >= 80}}서연은 공주다{{/if}}' }],
    indicatorDefs,
    sceneState: sceneState(affection),
  })
  const low = await buildTurn(input(10))
  assert.match(low.system, /민준를 경계한다/)
  assert.match(low.system, /호감도는 10이다/)
  assert.match(low.system, /겨울/)
  assert.equal(low.blocks.some((block) => block.kind === 'worldbook'), false, '펼쳐서 빈 로어북은 넣지 않는다')

  const high = await buildTurn(input(90))
  assert.match(high.system, /민준에게 마음을 열었다/)
  assert.match(high.system, /봄/)
  assert.match(high.system, /서연은 공주다/)
})

test('buildTurn — 모델이 쓴 기억 노트와 이력의 매크로는 펼치지 않는다', async () => {
  const turn = await buildTurn({
    cards: [{ name: '서연' }],
    indicatorDefs: [{ key: 'secret', type: 'string', initial: '보물 위치는 지하실' }],
    memoryNotes: [{ kind: 'summary', text: '요약: {{var:secret}}' }],
    messages: [{ role: 'assistant', text: '서연: {{var:secret}}' }],
  })
  const memory = turn.blocks.find((block) => block.kind === 'memory')
  assert.match(memory.content, /\{\{var:secret\}\}/)
  assert.doesNotMatch(JSON.stringify(turn.render()), /지하실/)
})

test('buildTurn — random 은 macroSeed 로 정해지고 manifest 에 남는다', async () => {
  const input = { cards: [{ name: '서연', description: '날씨: {{random::비::눈::맑음::안개}}' }], messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] }
  const a = await buildTurn(input)
  const b = await buildTurn(input)
  assert.equal(a.system, b.system)
  assert.equal(a.manifest.prompt.macroSeed, 2, '기본 시드는 이력 길이다')
  assert.equal((await buildTurn({ ...input, macroSeed: 99 })).manifest.prompt.macroSeed, 99)
  await assert.rejects(buildTurn({ ...input, macroSeed: 1.5 }), /macroSeed 는 정수/)
})

test('buildTurn — 카드의 매크로 오타는 조용히 넘어가지 않고 던진다', async () => {
  await assert.rejects(buildTurn({ cards: [{ name: '서연', description: '{{var:호감돈}}' }], indicatorDefs }), /모르는 변수 호감돈/)
})

test('buildTurn — 꺼진 갈래의 오타와 허용값 밖의 tension 도 첫 턴에 던진다', async () => {
  const card = (description) => ({ cards: [{ name: '서연', description }], indicatorDefs, sceneState: sceneState(10) })
  await assert.rejects(buildTurn(card('{{#if 호감도 >= 50}}{{var:호감돈}}{{/if}}')), /모르는 변수 호감돈/)
  await assert.rejects(buildTurn(card('{{#if tension == 긴장}}x{{/if}}')), /tension 는 calm/)
  const turn = await buildTurn(card('{{#if 호감도 >= 50}}신뢰{{else if 호감도 >= 5}}호기심{{else}}경계{{/if}}'))
  assert.match(turn.system, /호기심/)
  assert.doesNotMatch(turn.system, /\{\{/)
})

test('buildTurn — 이름에는 매크로를 돌리지 않는다', async () => {
  const turn = await buildTurn({ cards: [{ name: '{{random::a::b}}' }] })
  assert.match(turn.system, /이름: \{\{random::a::b\}\}/)
})
