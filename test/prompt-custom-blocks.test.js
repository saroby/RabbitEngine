import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn, defaultPromptProfile, validatePromptProfile, validateCustomBlocks, promptProfileHash, asteriskScript } from '../index.js'
import { renderTurn } from '../prompt/render.js'
import { promptEditorSampleInput } from '../editor/index.js'

const sample = () => ({ ...promptEditorSampleInput(), dialect: asteriskScript })
const withSystemDocument = (profile, prefix) => ({
  ...profile,
  systemTemplate: `${prefix}{{block:instruction}}\n\n{{block:character}}\n\n{{block:output_contract}}`,
})

test('시스템 문서의 커스텀 태그는 라이브러리 문구로 펼쳐지고 이름을 치환한다', async () => {
  const profile = withSystemDocument(defaultPromptProfile(), '{{block:custom:common}}\n\n')
  profile.blocks.push({ kind: 'custom', id: 'common', enabled: true, role: 'system', slot: 'system' })
  const turn = await buildTurn({ ...sample(), promptProfile: profile, customBlocks: [{ id: 'common', content: '{{user}}와 {{char}}의 공통 규칙' }] })
  assert.ok(turn.system.startsWith('여행자와 유리의 공통 규칙\n\n'))
  const block = turn.blocks.find((item) => item.kind === 'custom')
  assert.deepEqual({ customId: block.customId, slot: block.slot, trust: block.trust }, { customId: 'common', slot: 'system', trust: 'curated' })
})

test('같은 라이브러리 블록을 두 프리셋이 참조하면 문구를 고칠 때 둘 다 바뀐다', async () => {
  const a = withSystemDocument(defaultPromptProfile(), '{{block:custom:shared}}\n\n')
  a.blocks.push({ kind: 'custom', id: 'shared', enabled: true, role: 'system', slot: 'system' })
  const b = defaultPromptProfile()
  b.blocks.push({ kind: 'custom', id: 'shared', enabled: true, role: 'user', slot: { depth: 1 } })
  for (const content of ['첫 문구', '고친 문구']) {
    const library = [{ id: 'shared', content }]
    const [ta, tb] = await Promise.all([
      buildTurn({ ...sample(), promptProfile: a, customBlocks: library }),
      buildTurn({ ...sample(), promptProfile: b, customBlocks: library }),
    ])
    assert.ok(ta.system.includes(content))
    assert.ok(tb.render().messages.some((message) => message.role === 'user' && message.text === content))
  }
  assert.equal(promptProfileHash(a), promptProfileHash(structuredClone(a)), '문구는 프로필 해시에 들어가지 않는다')
})

test('대화 안 커스텀 블록은 역할대로 들어가고 같은 depth 에서 역할이 바뀌면 메시지를 나눈다', async () => {
  const profile = defaultPromptProfile()
  profile.blocks.push(
    { kind: 'custom', id: 'ask', enabled: true, role: 'user', slot: { depth: 1 } },
    { kind: 'custom', id: 'agree', enabled: true, role: 'assistant', slot: { depth: 1 } },
    { kind: 'custom', id: 'note', enabled: true, role: 'system', slot: 'post_history' },
  )
  const turn = await buildTurn({
    ...sample(),
    promptProfile: profile,
    customBlocks: [{ id: 'ask', content: '예시 요청' }, { id: 'agree', content: '예시 응답' }, { id: 'note', content: '마무리 메모' }],
  })
  const messages = turn.render().messages
  const ask = messages.findIndex((message) => message.text === '예시 요청')
  assert.equal(messages[ask].role, 'user')
  assert.deepEqual(messages[ask + 1], { role: 'assistant', text: '예시 응답' })
  assert.equal(messages.at(-1).role, 'user')
  assert.ok(messages.at(-1).text.includes('마무리 메모'))
})

test('assistant 커스텀 블록은 프리필 자리에 둘 수 없다', async () => {
  const profile = defaultPromptProfile()
  profile.blocks.push({ kind: 'custom', id: 'fill', enabled: true, role: 'assistant', slot: 'post_history' })
  assert.throws(() => validatePromptProfile(profile), /마지막 사용자 메시지 뒤에 둘 수 없습니다/)
  // userInput 없이 렌더하면 depth 0 이 마지막이 된다. 조용히 프리필로 보내지 않는다.
  const blocks = [{ kind: 'custom', customId: 'fill', role: 'assistant', slot: { depth: 0 }, content: '이어서' }]
  assert.throws(() => renderTurn(blocks, [{ role: 'user', text: '안녕' }]), /마지막 메시지가 될 수 없습니다/)
  assert.equal(renderTurn(blocks, [], { userInput: '안녕' }).messages.at(-1).role, 'user')
})

test('참조한 커스텀 블록이 라이브러리에 없으면 기억 선택 전에 오류를 낸다', async () => {
  const profile = defaultPromptProfile()
  profile.blocks.push({ kind: 'custom', id: 'gone', enabled: true, role: 'system', slot: { depth: 2 } })
  let called = false
  const ctx = { llm: async () => { called = true; return '' } }
  await assert.rejects(buildTurn({ ...sample(), promptProfile: profile, memory: { preset: 'memory-books' } }, ctx), /gone의 내용이 없습니다/)
  assert.equal(called, false)
  // 꺼 둔 블록은 라이브러리에 없어도 된다.
  profile.blocks.at(-1).enabled = false
  await buildTurn({ ...sample(), promptProfile: profile })
})

test('프로필 검증은 커스텀 블록 형식·중복·개수와 엔진 블록 누락을 막고, 없는 태그는 지운다', () => {
  const base = defaultPromptProfile()
  const add = (...blocks) => ({ ...base, blocks: [...base.blocks, ...blocks] })
  const ok = { kind: 'custom', id: 'a', enabled: true, role: 'system', slot: 'system' }
  assert.throws(() => validatePromptProfile(add({ ...ok, id: 'Bad Id' })), /id는/)
  assert.throws(() => validatePromptProfile(add(ok, ok)), /중복/)
  assert.throws(() => validatePromptProfile(add({ ...ok, role: 'tool' })), /역할은/)
  assert.throws(() => validatePromptProfile(add({ ...ok, slot: 'default' })), /엔진 기본 위치가 없습니다/)
  assert.throws(() => validatePromptProfile(add({ ...ok, template: 'x' })), /알 수 없는 항목/)
  assert.throws(() => validatePromptProfile(add(...Array.from({ length: 51 }, (_, index) => ({ ...ok, id: `b${index}` })))), /50개까지/)
  assert.throws(() => validatePromptProfile({ ...base, blocks: [...base.blocks.slice(1), ok] }), /15개 블록/)
  const normalized = validatePromptProfile({ ...withSystemDocument(base, '{{block:custom:missing}}\n\n') })
  assert.equal(normalized.systemTemplate.includes('custom:missing'), false)
})

test('customBlocks 라이브러리 입력을 검증한다', () => {
  assert.deepEqual([...validateCustomBlocks([{ id: 'a', content: '문구' }])], [['a', { content: '문구' }]])
  assert.deepEqual([...validateCustomBlocks([{ id: 'p', messages: [{ role: 'user', content: '질문' }, { role: 'assistant', content: '답' }] }])],
    [['p', { messages: [{ role: 'user', content: '질문' }, { role: 'assistant', content: '답' }] }]])
  assert.throws(() => validateCustomBlocks([{ id: 'p', content: 'x', messages: [{ role: 'user', content: 'y' }] }]), /하나만/)
  assert.throws(() => validateCustomBlocks([{ id: 'p', messages: [{ role: 'system', content: 'y' }] }]), /user·assistant/)
  assert.throws(() => validateCustomBlocks([{ id: 'p', messages: [] }]), /1~20개/)
  assert.throws(() => validateCustomBlocks([{ id: 'a', content: 'x' }, { id: 'a', content: 'y' }]), /중복/)
  assert.throws(() => validateCustomBlocks([{ id: 'a', content: 'x'.repeat(20001) }]), /20000자/)
  assert.throws(() => validateCustomBlocks({}), /배열/)
})

test('대화 블록은 메시지를 역할 그대로 대화 중간에 넣고, 시스템·마지막 메모 자리는 거부한다', async () => {
  const library = [{ id: 'pair', messages: [{ role: 'user', content: '{{char}}에게 묻는 예시' }, { role: 'assistant', content: '예시 답변' }] }]
  const profile = defaultPromptProfile()
  profile.blocks.push({ kind: 'custom', id: 'pair', enabled: true, role: 'system', slot: { depth: 0 } })
  const turn = await buildTurn({ ...sample(), promptProfile: profile, customBlocks: library })
  const messages = turn.render().messages
  const ask = messages.findIndex((message) => message.text === '유리에게 묻는 예시')
  assert.ok(ask > 0)
  assert.deepEqual(messages.slice(ask, ask + 2), [{ role: 'user', text: '유리에게 묻는 예시' }, { role: 'assistant', text: '예시 답변' }])
  assert.equal(messages.at(-1).role, 'user', '이번 입력이 마지막이다')
  for (const slot of ['system', 'post_history']) {
    const placed = defaultPromptProfile()
    placed.blocks.push({ kind: 'custom', id: 'pair', enabled: true, role: 'system', slot })
    await assert.rejects(buildTurn({ ...sample(), promptProfile: placed, customBlocks: library }), /대화 중간\(depth\)에만/)
  }
})
