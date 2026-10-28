import test from 'node:test'
import assert from 'node:assert/strict'
import { checkMacros, createMacroExpander, hostMacroOptions, macroVarsOf } from '../prompt/macros.js'
import { buildTurn } from '../build-turn.js'
import { defaultPromptProfile } from '../prompt/profile.js'

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

test('if — 중첩되고, 꺼진 갈래 안의 조건은 평가하지 않는다', () => {
  assert.equal(expand('{{#if 호감도 >= 50}}A{{#if tension == hostile}}B{{else}}C{{/if}}{{/if}}'), 'AB')
  // 꺼진 갈래 안에 모르는 변수가 있어도 던지지 않는다.
  assert.equal(expand('{{#if 비밀공개}}{{#if 없는변수 > 1}}x{{/if}}{{/if}}끝'), '끝')
})

test('if — 한 줄을 차지한 태그는 빈 줄을 남기지 않는다', () => {
  const text = '서연은 조용하다.\n{{#if 호감도 >= 50}}\n가끔 웃는다.\n{{else}}\n눈을 피한다.\n{{/if}}\n끝.'
  assert.equal(expand(text), '서연은 조용하다.\n가끔 웃는다.\n끝.')
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
  assert.throws(() => expand('{{#if 호감도}}a{{else}}b{{else}}c{{/if}}'), /짝이 없는 \{\{else\}\}/)
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

test('buildTurn — 이름에는 매크로를 돌리지 않는다', async () => {
  const turn = await buildTurn({ cards: [{ name: '{{random::a::b}}' }] })
  assert.match(turn.system, /이름: \{\{random::a::b\}\}/)
})

const DIFFICULTY = ['쉬운', '보통', '어려운', '극한']
const styleVars = (난이도 = '보통') => [
  { name: '난이도', value: 난이도, choices: DIFFICULTY },
  { name: '시점', value: '1인칭', choices: ['1인칭', '2인칭', '3인칭'] },
  { name: '분위기.로맨스', value: true },
  { name: '스토리텔링', value: null, choices: ['살롱 앤 티', '데드 타운'] },
]

test('hostMacroOptions — 선언을 변수와 허용값으로 바꾸고, 겹치거나 틀린 선언은 던진다', () => {
  const scene = macroVarsOf(null, [])
  assert.deepEqual(hostMacroOptions(scene, undefined), { vars: scene, choices: {} })
  assert.deepEqual(hostMacroOptions(scene, styleVars('어려운')), {
    vars: { ...scene, 난이도: '어려운', 시점: '1인칭', '분위기.로맨스': true, 스토리텔링: null },
    choices: { 난이도: DIFFICULTY, 시점: ['1인칭', '2인칭', '3인칭'], 스토리텔링: ['살롱 앤 티', '데드 타운'] },
  })
  assert.throws(() => hostMacroOptions(scene, [{ name: 'tension', value: 'hostile' }]), /tension 이 장면 변수와 겹칩니다/)
  assert.throws(() => hostMacroOptions(macroVarsOf(null, indicatorDefs), [{ name: '호감도', value: 1 }]), /호감도 이 장면 변수와 겹칩니다/)
  assert.throws(() => hostMacroOptions(scene, [{ name: '난이도', value: '보통' }, { name: '난이도', value: '쉬운' }]), /두 번 선언했습니다/)
  for (const name of ['전개 속도', '난이도!', 'a=b', '{x}', '', 3]) assert.throws(() => hostMacroOptions(scene, [{ name, value: 'v' }]), /부를 수 없습니다/, String(name))
  for (const value of [[], {}, Number.NaN, undefined]) assert.throws(() => hostMacroOptions(scene, [{ name: '난이도', value }]), /값은 문자열/)
  assert.throws(() => hostMacroOptions(scene, [{ name: '난이도', value: '어려움', choices: DIFFICULTY }]), /값 "어려움" 가 허용값 쉬운 · 보통 · 어려운 · 극한 에 없습니다/)
  for (const choices of [[], 'x', [''], [1]]) assert.throws(() => hostMacroOptions(scene, [{ name: '난이도', value: null, choices }]), /허용값은 빈 글자가 아닌 문자열 목록/)
  for (const macroVars of [null, {}, 'x']) assert.throws(() => hostMacroOptions(scene, macroVars), /목록이어야 합니다/)
  assert.throws(() => hostMacroOptions(scene, [null]), /객체여야 합니다/)
})

test('허용값 — == · != 의 값이 목록에 없으면 던지고, 숫자처럼 보이는 값도 글자 그대로 비교한다', () => {
  const { vars, choices } = hostMacroOptions(macroVarsOf(null, []), styleVars('어려운'))
  const expand = createMacroExpander({ vars, choices })
  assert.equal(expand('{{#if 난이도 == 어려운}}A{{/if}}{{#if 난이도 != 쉬운}}B{{/if}}{{#if 시점 == "1인칭"}}C{{/if}}'), 'ABC')
  assert.throws(() => expand('{{#if 난이도 == 어려움}}A{{/if}}'), /난이도 는 쉬운 · 보통 · 어려운 · 극한 중 하나와 비교합니다 \("어려움"\)/)
  assert.equal(expand('{{#if 스토리텔링}}있음{{else}}없음{{/if}}'), '없음', '값이 null 이면 거짓')
  assert.equal(expand('{{#if 스토리텔링 == "살롱 앤 티"}}A{{else}}B{{/if}}'), 'B')
})

test('checkMacros — 꺼진 갈래까지 변수 이름 · 허용값을 보고, 짝이 안 맞는 태그도 알린다', () => {
  const macroVars = styleVars('보통')
  assert.deepEqual(checkMacros('{{#if 난이도 == 쉬운}}A{{/if}}{{#if 난이도 == 극한}}{{var:시점}}{{/if}}', { macroVars }), { ok: true })
  assert.deepEqual(checkMacros('그냥 글', { macroVars }), { ok: true })
  // 확장기라면 꺼진 갈래라 그냥 넘어갈 오타도 잡는다.
  const typo = checkMacros('{{#if 난이도 == 쉬운}}{{#if 난이도 == 어려움}}X{{/if}}{{/if}}', { macroVars })
  assert.equal(typo.ok, false)
  assert.match(typo.error, /난이도 는 쉬운 · 보통 · 어려운 · 극한 중 하나와 비교합니다/)
  assert.match(checkMacros('{{#if 난이도 == 쉬운}}{{var:난이도x}}{{/if}}', { macroVars }).error, /모르는 변수 난이도x/)
  assert.match(checkMacros('{{#if 난이도 == 쉬운}}A', { macroVars }).error, /닫히지 않은/)
  assert.match(checkMacros('{{#if tension == hostile}}A{{/if}}{{#if 난이도}}B{{/if}}', { macroVars: [{ name: 'place', value: null }] }).error, /장면 변수와 겹칩니다/)
  assert.deepEqual(checkMacros('{{#if 호감도 >= 50}}A{{/if}}', { indicatorDefs }), { ok: true })
})

test('buildTurn — macroVars 로 커스텀 블록 · 지시문 · 카드의 문장이 바뀐다', async () => {
  const profile = defaultPromptProfile()
  profile.blocks.push({ kind: 'custom', id: 'difficulty', enabled: true, role: 'system', slot: 'system' })
  const input = (난이도) => ({
    cards: [{ name: '서연', description: '{{#if 분위기.로맨스}}설렌다{{else}}담담하다{{/if}}' }],
    instruction: '난이도는 {{var:난이도}}이다.',
    promptProfile: profile,
    customBlocks: [{ id: 'difficulty', content: '{{#if 난이도 == 어려운}}\n쉽게 양보하지 않는다.\n{{/if}}\n{{#if 난이도 == 쉬운}}\n순조롭게 풀린다.\n{{/if}}' }],
    macroVars: styleVars(난이도),
  })
  const hard = await buildTurn(input('어려운'))
  assert.match(hard.system, /쉽게 양보하지 않는다\./)
  assert.doesNotMatch(hard.system, /순조롭게/)
  assert.match(hard.system, /난이도는 어려운이다/)
  assert.match(hard.system, /설렌다/)
  const easy = await buildTurn(input('쉬운'))
  assert.match(easy.system, /순조롭게 풀린다\./)
  assert.doesNotMatch(easy.system, /양보/)
  // 모르는 변수 · 허용값에 없는 비교 · 장면 변수와 겹치는 선언은 던진다.
  await assert.rejects(buildTurn({ ...input('보통'), instruction: '{{var:난이도x}}' }), /모르는 변수 난이도x/)
  await assert.rejects(buildTurn({ ...input('보통'), instruction: '{{#if 난이도 == 어려움}}A{{/if}}' }), /중 하나와 비교합니다/)
  await assert.rejects(buildTurn({ ...input('보통'), macroVars: [{ name: 'place', value: '현관' }] }), /place 이 장면 변수와 겹칩니다/)
})
