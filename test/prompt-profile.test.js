import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn, compileBlocks, defaultPromptProfile, validatePromptProfile, promptProfileHash, asteriskScript, MEMORY_LABEL } from '../index.js'
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
