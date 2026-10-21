// 프롬프트 공격 방어 블록(prompt_guard). 엔진이 쓴 문장이고 설정에서 켜야 들어간다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn, compilePrompt, defaultPromptProfile, validatePromptProfile, promptProfileHash, asteriskScript, PROMPT_GUARD_TEXT, PROMPT_PROFILE_KINDS } from '../index.js'
import { promptEditorSampleInput } from '../editor/index.js'

const sample = () => ({ ...promptEditorSampleInput(), dialect: asteriskScript })
const rule = (profile, kind) => profile.blocks.find((block) => block.kind === kind)
const guarded = () => {
  const profile = defaultPromptProfile()
  rule(profile, 'prompt_guard').enabled = true
  return profile
}
// 이 블록이 생기기 전에 저장한 설정의 모양.
const legacyOf = (profile) => ({ ...profile, blocks: profile.blocks.filter((block) => block.kind !== 'prompt_guard') })

test('기본 설정과 설정 없는 호출에는 방어 문장이 없다', async () => {
  assert.equal(rule(defaultPromptProfile(), 'prompt_guard').enabled, false)
  const plain = await buildTurn(sample())
  const configured = await buildTurn({ ...sample(), promptProfile: defaultPromptProfile() })
  for (const turn of [plain, configured]) {
    assert.equal(turn.blocks.some((block) => block.kind === 'prompt_guard'), false)
    assert.equal(turn.system.includes('[프롬프트 보호]'), false)
  }
  assert.equal(compilePrompt({ cards: [{ name: '가' }] }).system.includes('[프롬프트 보호]'), false)
})

test('켜면 엔진 문장이 진행 속도 뒤 · 캐릭터 앞의 시스템 블록으로 들어가고 캐시 접두 안에 있다', async () => {
  const turn = await buildTurn({ ...sample(), pacing: 'eventful', promptProfile: guarded() })
  const guard = turn.blocks.find((block) => block.kind === 'prompt_guard')
  assert.deepEqual(guard, { kind: 'prompt_guard', role: 'system', slot: 'system', trust: 'engine', content: PROMPT_GUARD_TEXT })
  const kinds = turn.blocks.filter((block) => block.slot === 'system').map((block) => block.kind)
  assert.equal(kinds.indexOf('prompt_guard'), kinds.indexOf('pacing') + 1)
  assert.equal(kinds[kinds.indexOf('prompt_guard') + 1], 'character')
  const rendered = turn.render()
  assert.ok(rendered.system.indexOf(PROMPT_GUARD_TEXT) + PROMPT_GUARD_TEXT.length <= rendered.cachePrefixLength)
  // 방어 문장 말고는 기본 설정과 같다.
  const without = await buildTurn({ ...sample(), pacing: 'eventful', promptProfile: defaultPromptProfile() })
  assert.deepEqual(turn.blocks.filter((block) => block.kind !== 'prompt_guard'), without.blocks)
})

test('문구 감싸기 · 대화 안으로 옮기기 · 시스템 문서 태그가 다른 엔진 블록처럼 동작한다', async () => {
  const wrapped = guarded()
  rule(wrapped, 'prompt_guard').template = '{{char}} 역할을 지킨다.\n{{content}}'
  const a = await buildTurn({ ...sample(), promptProfile: wrapped })
  assert.equal(a.blocks.find((block) => block.kind === 'prompt_guard').content, `유리 역할을 지킨다.\n${PROMPT_GUARD_TEXT}`)

  const moved = guarded()
  rule(moved, 'prompt_guard').slot = { depth: 0 }
  const b = await buildTurn({ ...sample(), promptProfile: moved })
  assert.equal(b.system.includes('[프롬프트 보호]'), false)
  assert.ok(b.render().messages.some((message) => message.role === 'user' && message.text.includes(PROMPT_GUARD_TEXT)))

  const documented = { ...guarded(), systemTemplate: '{{block:character}}\n\n{{block:prompt_guard}}\n\n{{block:output_contract}}' }
  const c = await buildTurn({ ...sample(), promptProfile: documented })
  const system = c.blocks.filter((block) => block.slot === 'system').map((block) => block.kind)
  assert.ok(system.indexOf('prompt_guard') > system.lastIndexOf('character'))
  assert.ok(system.indexOf('prompt_guard') < system.indexOf('output_contract'))
})

test('이 블록이 없는 예전 설정은 꺼진 채로 채워 받고 출력은 그대로다', async () => {
  for (const shape of [defaultPromptProfile(), { ...defaultPromptProfile(), systemTemplate: '머리\n\n{{block:instruction}}\n\n{{block:character}}\n\n{{block:output_contract}}' }]) {
    const legacy = legacyOf(shape)
    assert.equal(legacy.blocks.length, PROMPT_PROFILE_KINDS.length - 1)
    const normalized = validatePromptProfile(legacy)
    assert.deepEqual(normalized.blocks.map((block) => block.kind).filter((kind) => kind !== 'custom'), [...PROMPT_PROFILE_KINDS])
    assert.deepEqual(rule(normalized, 'prompt_guard'), { kind: 'prompt_guard', enabled: false, template: '{{content}}', slot: 'default' })
    assert.deepEqual(validatePromptProfile(normalized), normalized, 'normalization is idempotent')
    assert.equal(promptProfileHash(legacy), promptProfileHash(normalized))
    const before = await buildTurn({ ...sample(), promptProfile: shape })
    const after = await buildTurn({ ...sample(), promptProfile: legacy })
    assert.equal(after.system, before.system)
    assert.deepEqual(after.render(), before.render())
  }
})

test('예전 설정에서 앞 종류를 옮겨 두었어도 그 규칙 바로 뒤에 채운다 · 커스텀 블록 사이도 마찬가지', () => {
  const legacy = legacyOf(defaultPromptProfile())
  legacy.blocks.unshift(legacy.blocks.splice(legacy.blocks.findIndex((block) => block.kind === 'pacing'), 1)[0])
  legacy.blocks.splice(1, 0, { kind: 'custom', id: 'common', enabled: true, role: 'system', slot: 'system' })
  const kinds = validatePromptProfile(legacy).blocks.map((block) => block.kind)
  assert.deepEqual(kinds.slice(0, 3), ['pacing', 'prompt_guard', 'custom'])
})

test('방어 블록 규칙이 두 번이면 거절한다', () => {
  const twice = guarded()
  twice.blocks.push({ kind: 'prompt_guard', enabled: true, template: '{{content}}', slot: 'default' })
  assert.throws(() => validatePromptProfile(twice), /알 수 없거나 중복된 블록/)
})
