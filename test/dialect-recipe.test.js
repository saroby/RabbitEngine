import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CHUNK_POLICY, chunkEntries, policyWith, hashablePolicyOf } from '../memory/chunking.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { defineDialect } from '../dialect/define.js'
import { recipeHashOf } from '../memory/recipe.js'
import { selectMemory } from '../memory/index.js'
import { selectContext } from '../memory/legacy-strategies.js'

const asterisk = defineDialect({
  id: 'asterisk', version: 1, spec: '*행동* 으로 쓴다. 장면이 바뀌면 --- 한 줄을 쓴다.',
  rules: [
    { kind: 'scene', match: /^---\s*(.*)$/, text: 1 },
    { kind: 'action', match: /^\*(.+)\*$/, text: 1 },
  ],
  fallback: 'dialogue',
})

test('기본 청크 정책은 옛 모양 그대로다 (기존 캐시와의 약속)', () => {
  assert.deepEqual(DEFAULT_CHUNK_POLICY, {
    by: 'messages', maxMessages: 20, sceneSnap: true, parserVersion: 'script-v1',
  })
})

test('koreanPlayscript 를 명시해도 같은 해시가 나온다', () => {
  const before = recipeHashOf({ chunkPolicy: DEFAULT_CHUNK_POLICY })
  const after = recipeHashOf({ chunkPolicy: hashablePolicyOf(policyWith(koreanPlayscript)) })
  assert.equal(after, before, '방언을 명시하면 해시가 달라졌다 — 저장된 캐시가 죽는다')
})

test('다른 방언은 다른 해시를 낸다', () => {
  const korean = recipeHashOf({ chunkPolicy: hashablePolicyOf(policyWith(koreanPlayscript)) })
  const other = recipeHashOf({ chunkPolicy: hashablePolicyOf(policyWith(asterisk)) })
  assert.notEqual(other, korean, '방언이 달라도 같은 해시면 옛 요약을 잘못 재사용한다')
})

test('hashablePolicyOf — 방언 객체를 남기지 않는다', () => {
  const hashable = hashablePolicyOf(policyWith(asterisk))
  assert.equal('dialect' in hashable, false)
  assert.equal(hashable.parserVersion, 'asterisk-v1')
})

test('씬 경계 판정에 방언을 쓴다', () => {
  const entries = [{ ordinal: 0 }, { ordinal: 1 }, { ordinal: 2 }]

  const korean = chunkEntries(entries, ['[장면: 밤]', '--- 밤', '유리: 왔구나.'], policyWith(koreanPlayscript))
  assert.deepEqual(korean.closed.map((c) => c.coversOrdinals), [[0]], '한국어 희곡은 [장면:] 에서만 닫는다')

  const other = chunkEntries(entries, ['[장면: 밤]', '--- 밤', '유리: 왔구나.'], policyWith(asterisk))
  assert.deepEqual(other.closed.map((c) => c.coversOrdinals), [[0, 1]], '별표 방언은 --- 에서 닫는다')
})

test('selectMemory — manifest 에 방언 객체가 새지 않는다', async () => {
  const messages = [
    { role: 'assistant', text: '유리: 어서 오세요.' },
    { role: 'user', text: '안녕하세요.' },
  ]
  const result = await selectMemory(messages, { preset: 'lorebook', dialect: asterisk })
  assert.equal('dialect' in result.manifest.chunkPolicy, false)
  assert.equal(result.manifest.chunkPolicy.parserVersion, 'asterisk-v1')
  assert.doesNotThrow(() => JSON.stringify(result.manifest))
})

test('selectContext — 옛 전략 이름으로 불러도 방언이 전달된다', async () => {
  const messages = [{ role: 'assistant', text: '유리: 어서 오세요.' }]
  const result = await selectContext(messages, { strategy: 'window', dialect: asterisk })
  assert.equal(result.manifest.chunkPolicy.parserVersion, 'asterisk-v1')
})
