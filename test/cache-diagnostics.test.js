// 캐시 진단은 조립 결과를 바꾸지 않는다 — 경고와 지문만 더한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn, defaultPromptProfile, prefixFingerprint, sharedPrefix } from '../index.js'

const rule = (profile, kind) => profile.blocks.find((block) => block.kind === kind)
const indicatorDefs = [{ key: 'affection', label: '호감도', type: 'number', initial: 0 }]

test('cacheWarnings — 캐시 접두 안 문구의 random · 조건 · var 를 알린다', async () => {
  const turn = await buildTurn({
    cards: [{ name: '서연', description: '{{#if 호감도 >= 50}}다정하다{{else}}차갑다{{/if}}' }],
    instruction: '날씨: {{random::비::눈}}',
    indicatorDefs,
  })
  assert.deepEqual(turn.manifest.prompt.cacheWarnings.map(({ kind, id, reason }) => ({ kind, id, reason })), [
    { kind: 'instruction', id: null, reason: 'random' },
    { kind: 'character', id: null, reason: 'scene' },
  ])
  assert.match(turn.manifest.prompt.cacheWarnings[0].message, /^지시문: \{\{random\}\} 은 .*매 턴 깨집니다/)
  assert.match(turn.manifest.prompt.cacheWarnings[1].message, /^캐릭터 서연 · description: 조건 · \{\{var\}\} 가 장면 상태를 읽어/)
})

test('cacheWarnings — 경고가 없으면 manifest 모양은 이전과 같다', async () => {
  const turn = await buildTurn({ cards: [{ name: '서연', description: '사서' }], instruction: '지시' })
  assert.equal(Object.hasOwn(turn.manifest.prompt, 'cacheWarnings'), false)
})

test('cacheWarnings — 동적 블록과 그 뒤, 대화 안으로 옮긴 블록은 알리지 않는다', async () => {
  const base = {
    cards: [{ name: '서연', description: '사서' }],
    instruction: '{{var:호감도}}',
    worldbooks: [{ id: 'w', name: '항구', strategy: 'always', content: '항구 창고{{#if 호감도 >= 50}} 아래 비밀 통로{{/if}}' }],
    indicatorDefs,
  }
  // 로어북은 동적 블록이라 원래 접두 밖이다.
  assert.deepEqual((await buildTurn(base)).manifest.prompt.cacheWarnings.map((warning) => warning.kind), ['instruction'])

  const moved = defaultPromptProfile()
  rule(moved, 'instruction').slot = { depth: 1 }
  assert.equal(Object.hasOwn((await buildTurn({ ...base, promptProfile: moved })).manifest.prompt, 'cacheWarnings'), false)

  // 로어북을 맨 앞으로 올리면 접두가 비어 그 뒤 지시문은 어차피 매 턴 다시 계산된다.
  const lorebookFirst = defaultPromptProfile()
  lorebookFirst.blocks.unshift(lorebookFirst.blocks.splice(lorebookFirst.blocks.findIndex((block) => block.kind === 'worldbook'), 1)[0])
  assert.equal(Object.hasOwn((await buildTurn({ ...base, promptProfile: lorebookFirst })).manifest.prompt, 'cacheWarnings'), false)
})

test('cacheWarnings — 커스텀 블록은 id 로 가려 접두 안에 놓인 것만 알린다', async () => {
  const profile = defaultPromptProfile()
  profile.blocks.unshift({ kind: 'custom', id: 'mood', enabled: true, role: 'system', slot: 'system' })
  profile.blocks.push({ kind: 'custom', id: 'aside', enabled: true, role: 'user', slot: { depth: 1 } })
  const turn = await buildTurn({
    cards: [{ name: '서연' }],
    promptProfile: profile,
    customBlocks: [{ id: 'mood', content: '{{random::밝게::어둡게}}' }, { id: 'aside', content: '{{random::a::b}}' }],
  })
  assert.deepEqual(turn.manifest.prompt.cacheWarnings.map(({ kind, id, reason }) => ({ kind, id, reason })), [{ kind: 'custom', id: 'mood', reason: 'random' }])
})

test('cacheWarnings — 경고가 있어도 조립 결과는 같다', async () => {
  const input = { cards: [{ name: '서연', description: '{{random::a::b}}' }], messages: [{ role: 'user', text: '안녕' }] }
  const turn = await buildTurn(input)
  assert.equal(turn.manifest.prompt.cacheWarnings.length, 1)
  const { cacheWarnings, ...rest } = turn.manifest.prompt
  assert.deepEqual(Object.keys(rest), Object.keys((await buildTurn({ ...input, cards: [{ name: '서연', description: 'a' }] })).manifest.prompt))
})

const rendered = (system, cachePrefixLength, messages) => ({ system, cachePrefixLength, messages })

test('sharedPrefix — 같으면 전부, 뒤에 붙으면 앞 메시지까지 이어 쓴다', () => {
  const a = prefixFingerprint(rendered('고정\n\n로어북', 2, [{ role: 'user', text: '안녕' }, { role: 'assistant', text: '반가워' }]))
  assert.deepEqual(sharedPrefix(a, a), { chars: 12, totalChars: 12, messages: 2, system: 'same' })
  const b = prefixFingerprint(rendered('고정\n\n로어북', 2, [{ role: 'user', text: '안녕' }, { role: 'assistant', text: '반가워' }, { role: 'user', text: '응' }]))
  assert.deepEqual(sharedPrefix(a, b), { chars: 12, totalChars: 13, messages: 2, system: 'same' })
})

test('sharedPrefix — 동적 블록만 바뀌면 접두까지, 접두가 바뀌면 0', () => {
  const messages = [{ role: 'user', text: '안녕' }]
  const a = prefixFingerprint(rendered('고정\n\n로어북 A', 2, messages))
  const b = prefixFingerprint(rendered('고정\n\n로어북 B', 2, messages))
  assert.deepEqual(sharedPrefix(a, b), { chars: 2, totalChars: 11, messages: 0, system: 'prefix' })
  const c = prefixFingerprint(rendered('바뀜\n\n로어북 A', 2, messages))
  assert.equal(sharedPrefix(a, c).system, 'changed')
  assert.equal(sharedPrefix(a, c).chars, 0)
  assert.deepEqual(sharedPrefix(null, a), { chars: 0, totalChars: 11, messages: 0, system: 'changed' }, '첫 턴은 이어 쓸 것이 없다')
})

test('prefixFingerprint — 역할 · 경계를 가르고 원문은 담지 않는다', () => {
  const a = prefixFingerprint(rendered('S', 1, [{ role: 'user', text: '비밀 문장' }]))
  const b = prefixFingerprint(rendered('S', 1, [{ role: 'assistant', text: '비밀 문장' }]))
  assert.equal(sharedPrefix(a, b).messages, 0)
  const split = prefixFingerprint(rendered('S', 1, [{ role: 'user', text: 'ab' }, { role: 'user', text: 'c' }]))
  const joined = prefixFingerprint(rendered('S', 1, [{ role: 'user', text: 'a' }, { role: 'user', text: 'bc' }]))
  assert.equal(sharedPrefix(split, joined).messages, 0)
  assert.doesNotMatch(JSON.stringify(a), /비밀/)
  assert.throws(() => prefixFingerprint({}), /render\(\) 의 결과/)
  assert.throws(() => sharedPrefix({ version: 0, parts: [] }, a), /version/)
})

test('sharedPrefix — 창이 한 칸씩 밀리면 메시지는 하나도 이어 쓰지 못한다', async () => {
  const history = (count) => Array.from({ length: count }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `${index % 2 ? '서연' : '민준'}: 대사 ${index}` }))
  const card = { cards: [{ name: '서연' }] }
  const turnOf = async (count, memory) => prefixFingerprint((await buildTurn({ ...card, messages: history(count), memory })).render())
  const sliding = sharedPrefix(await turnOf(10, { strategy: 'window', windowSize: 4 }), await turnOf(11, { strategy: 'window', windowSize: 4 }))
  assert.equal(sliding.system, 'same')
  assert.equal(sliding.messages, 0)
  const full = sharedPrefix(await turnOf(10), await turnOf(11))
  assert.equal(full.messages, 10)
})
