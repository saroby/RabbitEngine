import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn, compileBlocks, compilePrompt, defaultPromptProfile, validatePromptProfile, promptProfileHash, asteriskScript, MEMORY_LABEL } from '../index.js'
import { applyPromptProfile, parseSystemTemplate } from '../prompt/profile.js'
import { systemTextOf } from '../prompt/render.js'
import { mountPromptEditor, promptEditorSampleInput } from '../editor/index.js'

const sample = () => ({ ...promptEditorSampleInput(), dialect: asteriskScript })
const rule = (profile, kind) => profile.blocks.find((block) => block.kind === kind)

test('default profile preserves every generated block and rendered message, including worldbook depth', async () => {
  const input = sample()
  input.worldbooks[0].depth = 3
  const original = await buildTurn(input)
  const configured = await buildTurn({ ...input, promptProfile: defaultPromptProfile() })
  assert.deepEqual(configured.blocks, original.blocks)
  assert.deepEqual(configured.render(), original.render())
  assert.equal(configured.system, original.system)
  assert.deepEqual(configured.manifest.prompt.profile, { version: 1, hash: promptProfileHash(defaultPromptProfile()) })
  assert.equal(original.manifest.prompt.profile, undefined)
  assert.equal(typeof mountPromptEditor, 'function', 'editor import is safe without document or a browser')
})

test('two independent profiles control wording, order and placement without mutating source or each other', async () => {
  const calm = defaultPromptProfile()
  const active = defaultPromptProfile()
  rule(calm, 'instruction').template = '천천히 관찰한다.\n{{content}}'
  rule(active, 'instruction').template = '적극적으로 움직인다.'
  rule(active, 'character').template = '[인물 설정]\n{{content}}'
  rule(active, 'world').slot = { depth: 1 }
  rule(active, 'user_boundary').enabled = false
  rule(active, 'memory').slot = 'system'
  active.blocks.unshift(active.blocks.splice(active.blocks.findIndex((block) => block.kind === 'output_contract'), 1)[0])
  const input = sample()
  const before = JSON.stringify(input)
  const a = await buildTurn({ ...input, promptProfile: calm })
  const b = await buildTurn({ ...input, promptProfile: active })
  assert.ok(a.system.startsWith('천천히 관찰한다.'))
  assert.equal(b.blocks[0].kind, 'output_contract')
  assert.equal(b.blocks.find((block) => block.kind === 'instruction').content, '적극적으로 움직인다.')
  assert.equal(b.blocks.some((block) => block.kind === 'user_boundary'), false)
  assert.deepEqual(b.blocks.find((block) => block.kind === 'world').slot, { depth: 1 })
  assert.ok(b.render().messages.some((message) => message.text.includes('항구 마을')))
  assert.equal(b.blocks.filter((block) => block.kind === 'character').length, 2)
  assert.ok(b.blocks.filter((block) => block.kind === 'character').every((block) => block.content.startsWith('[인물 설정]')))
  assert.equal(JSON.stringify(input), before)
  assert.notEqual(a.manifest.prompt.profile.hash, b.manifest.prompt.profile.hash)
  assert.equal(rule(defaultPromptProfile(), 'instruction').template, '{{content}}')
  const rendered = b.render()
  assert.ok(rendered.cachePrefixLength <= rendered.system.indexOf(MEMORY_LABEL), 'memory moved to system must remain outside the cache prefix')
})

test('single pass substitution preserves literal replacement symbols and embedded template tokens', () => {
  const profile = defaultPromptProfile()
  rule(profile, 'instruction').template = '{{char}}|{{user}}|{{content}}'
  const out = compileBlocks({
    cards: [{ name: '$&{{user}}' }], playerCard: { name: '$`{{char}}' },
    instructionText: 'literal $& {{content}}', promptProfile: profile,
  })
  assert.equal(out.blocks[0].content, '$&{{user}}|$`{{char}}|literal $& {{content}}')
})

test('profiles can author instruction and pacing without host text; absent scene data stays absent', async () => {
  const profile = defaultPromptProfile()
  rule(profile, 'instruction').template = '연기한다.'
  rule(profile, 'pacing').template = '한 사건씩 이어 간다.'
  rule(profile, 'scene_state').template = '존재하지 않는 장면을 만들면 안 된다.'
  const turn = await buildTurn({ cards: [{ name: '유리' }], promptProfile: profile })
  assert.equal(turn.blocks.find((block) => block.kind === 'instruction').content, '연기한다.')
  assert.equal(turn.blocks.find((block) => block.kind === 'pacing').content, '한 사건씩 이어 간다.')
  assert.equal(turn.blocks.some((block) => block.kind === 'scene_state'), false)
})

test('profile validation rejects malformed configuration and keeps parser grammar present', async () => {
  const invalid = [
    (profile) => { profile.extra = true },
    (profile) => { profile.version = 2 },
    (profile) => { profile.blocks.pop() },
    (profile) => { profile.blocks[0].kind = 'unknown' },
    (profile) => { profile.blocks[0].kind = profile.blocks[1].kind },
    (profile) => { profile.blocks[0].enabled = 'true' },
    (profile) => { profile.blocks[0].template = ' ' },
    (profile) => { profile.blocks[0].template = 'x'.repeat(20001) },
    (profile) => { profile.blocks.forEach((block) => { if (block.kind !== 'output_contract') block.template = 'x'.repeat(10000) }) },
    (profile) => { profile.blocks[0].template = '{{missing}}' },
    (profile) => { profile.blocks[0].slot = { depth: -1 } },
    (profile) => { profile.blocks[0].slot = { depth: 101 } },
    (profile) => { profile.blocks[0].slot = { depth: 1.5 } },
    (profile) => { profile.blocks[0].slot = { depth: 1, unknown: true } },
    (profile) => { rule(profile, 'output_contract').enabled = false },
    (profile) => { rule(profile, 'output_contract').template = '내 규칙만 사용한다.' },
    (profile) => { rule(profile, 'output_contract').template = '{{content}} {{ content }}' },
  ]
  for (const mutate of invalid) {
    const profile = defaultPromptProfile()
    mutate(profile)
    assert.throws(() => validatePromptProfile(profile), /PromptProfile/)
  }
  const profile = defaultPromptProfile()
  rule(profile, 'output_contract').template = '짧게 답한다.\n{{content}}\n마지막에는 행동을 묘사한다.'
  const turn = await buildTurn({ ...sample(), promptProfile: profile })
  const output = turn.blocks.find((block) => block.kind === 'output_contract')
  assert.ok(output.content.includes(asteriskScript.spec))
  assert.equal(output.contract, (await buildTurn(sample())).blocks.find((block) => block.kind === 'output_contract').contract)
  await assert.rejects(() => buildTurn({ ...sample(), promptProfile: profile, enforceFormat: false }), /출력 규약/)
  const detached = validatePromptProfile(profile)
  rule(detached, 'instruction').template = '변경'
  assert.equal(rule(profile, 'instruction').template, '{{content}}')
})

test('invalid profile fails before calling a host LLM for memory selection', async () => {
  let calls = 0
  const profile = defaultPromptProfile()
  rule(profile, 'output_contract').enabled = false
  await assert.rejects(() => buildTurn({ ...sample(), memory: { preset: 'memory-books' }, promptProfile: profile }, { llm: async () => { calls += 1; throw new Error('should not run') } }), /출력 규약/)
  assert.equal(calls, 0)
})

test('system document expands inline text, names and repeated source blocks without changing message slots', async () => {
  const profile = defaultPromptProfile()
  profile.systemTemplate = '시작 {{user}}/{{char}}:{{block:character}}{{block:memory}}|{{block:output_contract}} 끝'
  rule(profile, 'memory').slot = { depth: 1 }
  const turn = await buildTurn({ cards: [{ name: '가' }, { name: '나' }], userName: '손님', memoryNotes: [{ text: '기억' }], promptProfile: profile })
  const characters = turn.blocks.filter((block) => block.kind === 'character')
  const contract = turn.blocks.find((block) => block.kind === 'output_contract')
  assert.equal(turn.system, `시작 손님/가:${characters.map((block) => block.content).join('\n\n')}|${contract.content} 끝`)
  assert.equal(turn.render().system, turn.system)
  assert.deepEqual(turn.blocks.filter((block) => block.kind === 'memory').map((block) => block.slot), [{ depth: 1 }])
  assert.ok(turn.render().messages.some((message) => message.text.includes('기억')))
  assert.equal(turn.blocks.some((block) => block.kind === 'user_boundary'), false)
  assert.deepEqual(parseSystemTemplate('A{{block:character}}{{user}}{{block:output_contract}}'), [
    { type: 'text', value: 'A' }, { type: 'block', value: 'character' }, { type: 'name', value: 'user' }, { type: 'block', value: 'output_contract' },
  ])
})

test('system document preserves dynamic cache boundary and compilePrompt text', async () => {
  const profile = defaultPromptProfile()
  profile.systemTemplate = '고정{{block:character}}끝{{block:memory}}후속{{block:output_contract}}'
  rule(profile, 'memory').slot = 'system'
  const turn = await buildTurn({ cards: [{ name: '가' }], memoryNotes: [{ text: '동적' }], promptProfile: profile })
  const character = turn.blocks.find((block) => block.kind === 'character')
  assert.equal(turn.render().cachePrefixLength, `고정${character.content}끝`.length)
  assert.equal(turn.render().system, turn.system)
  const compiled = compilePrompt({ cards: [{ name: '가' }], promptProfile: profile })
  assert.equal(compiled.system, `고정${character.content}끝후속${turn.blocks.find((block) => block.kind === 'output_contract').content}`)
})

test('missing optional capsule removes its blank paragraph', async () => {
  const profile = defaultPromptProfile()
  profile.systemTemplate = '{{block:character}}\n\n{{block:world}}\n\n{{block:cast}}\n\n{{block:output_contract}}'
  const turn = await buildTurn({ cards: [{ name: '가' }], promptProfile: profile })
  const character = turn.blocks.find((block) => block.kind === 'character')
  const contract = turn.blocks.find((block) => block.kind === 'output_contract')
  assert.equal(turn.system, `${character.content}\n\n${contract.content}`)
})

test('the editor default capsule order keeps the existing system and message output', async () => {
  const profile = defaultPromptProfile()
  profile.systemTemplate = profile.blocks
    .filter((block) => !['memory', 'scene_state', 'event', 'directive'].includes(block.kind))
    .map((block) => `{{block:${block.kind}}}`)
    .join('\n\n')
  const original = await buildTurn(sample())
  const composed = await buildTurn({ ...sample(), promptProfile: profile })
  assert.equal(composed.system, original.system)
  assert.deepEqual(composed.render().messages, original.render().messages)
})

// 검증(정규화)을 거치지 않은 조립 결과. 저장값을 정리해도 출력이 같다는 기준으로 쓴다.
const assembleRaw = (options, profile) => {
  const raw = compileBlocks(options)
  return applyPromptProfile(raw.blocks, profile, raw.names)
}

test('each block has one place: stale tags and untagged system blocks are normalized without changing output', () => {
  const options = { cards: [{ name: '가' }], instructionText: '지시', worldText: '세계', pacingText: '호흡', memoryNotes: [{ text: '기억' }] }
  const stale = defaultPromptProfile()
  // pacing: 비활성인데 태그가 남았다. memory: 대화 위치인데 태그가 남았다. world: 시스템 위치인데 태그가 없다.
  stale.systemTemplate = '머리\n\n{{block:instruction}}\n\n{{block:pacing}}\n\n{{block:character}}{{block:memory}}\n\n{{block:output_contract}}'
  rule(stale, 'pacing').enabled = false
  rule(stale, 'memory').slot = { depth: 1 }
  const normalized = validatePromptProfile(stale)
  // memory 앞은 캡슐이라 뒤쪽 빈 문단을 가져간다 — 조립할 때 비는 태그와 같은 규칙이다.
  assert.equal(normalized.systemTemplate, '머리\n\n{{block:instruction}}\n\n{{block:character}}{{block:output_contract}}')
  assert.equal(rule(normalized, 'world').enabled, false)
  assert.equal(rule(normalized, 'user_boundary').enabled, false)
  assert.equal(rule(normalized, 'memory').enabled, true)
  assert.deepEqual(rule(normalized, 'memory').slot, { depth: 1 })
  assert.equal(rule(normalized, 'output_contract').enabled, true)
  assert.deepEqual(validatePromptProfile(normalized), normalized, 'normalization is idempotent')

  const before = assembleRaw(options, stale)
  const after = compileBlocks({ ...options, promptProfile: stale }).blocks
  assert.equal(systemTextOf(after.filter((block) => block.slot === 'system')), systemTextOf(before.filter((block) => block.slot === 'system')))
  assert.deepEqual(after.filter((block) => block.slot !== 'system'), before.filter((block) => block.slot !== 'system'))
})

test('normalizing a stale tag keeps the blank-paragraph result of assembling it', () => {
  const options = { cards: [{ name: '가' }], memoryNotes: [{ text: '기억' }] }
  // cast 는 원본 데이터가 없어 비는 태그, memory 는 대화 위치라 정리되는 태그다.
  const cases = [
    'A\n\n{{block:cast}}\n\n{{block:memory}}\n\nB{{block:output_contract}}',
    'A\n\n{{block:memory}}\n\n{{block:cast}}\n\nB{{block:output_contract}}',
    '{{block:memory}}\n\nA{{block:character}}{{block:output_contract}}',
    'A{{block:output_contract}}\n\n{{block:memory}}',
    'A\n\n{{block:memory}}{{block:output_contract}}',
    'A\n\n{{block:memory}}\n\n{{block:character}}\n\n{{block:output_contract}}',
  ]
  for (const systemTemplate of cases) {
    const profile = { ...defaultPromptProfile(), systemTemplate }
    rule(profile, 'memory').slot = { depth: 2 }
    for (const kind of ['instruction', 'world', 'rating', 'pacing', 'player', 'context', 'worldbook', 'user_boundary']) rule(profile, kind).enabled = false
    const before = systemTextOf(assembleRaw(options, profile).filter((block) => block.slot === 'system'))
    const after = systemTextOf(compileBlocks({ ...options, promptProfile: profile }).blocks.filter((block) => block.slot === 'system'))
    assert.equal(after, before, systemTemplate)
  }
})

test('system document rejects unknown, duplicate and malformed tags and preserves legacy shape', () => {
  const invalid = [
    '{{block:character}}{{block:character}}{{block:output_contract}}',
    '{{block:unknown}}{{block:output_contract}}',
    '{{block:character}}',
    '{{unknown}}{{block:output_contract}}',
    '{{block:character{{block:output_contract}}',
    '{{block:output_contract}}}}',
    `${'x'.repeat(80000)}{{block:output_contract}}`,
  ]
  for (const systemTemplate of invalid) {
    const profile = defaultPromptProfile()
    profile.systemTemplate = systemTemplate
    assert.throws(() => validatePromptProfile(profile), /PromptProfile/)
  }
  const legacy = defaultPromptProfile()
  const misplacedContract = defaultPromptProfile()
  misplacedContract.systemTemplate = '{{block:output_contract}}'
  rule(misplacedContract, 'output_contract').slot = 'post_history'
  assert.throws(() => validatePromptProfile(misplacedContract), /시스템 위치/)
  assert.equal(Object.hasOwn(validatePromptProfile(legacy), 'systemTemplate'), false)
  assert.equal(Object.hasOwn(legacy, 'systemTemplate'), false)
})
