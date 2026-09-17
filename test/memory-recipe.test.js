import test from 'node:test'
import assert from 'node:assert/strict'
import { canonical, recipeHashOf, withLock } from '../memory/recipe.js'

const base = {
  partId: 'passthrough', partVersion: 1,
  chunkPolicy: { by: 'scene', maxMessages: 20, parserVersion: 'script-v1' },
  config: { a: 1, b: 2 },
  builder: { provider: null, model: null, params: {}, promptTemplateHash: null },
  inputs: [{ ordinal: 0, role: 'user', textHash: 'aaaa' }],
}

test('키 순서가 달라도 같은 해시가 나온다', () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }))
  assert.equal(recipeHashOf(base), recipeHashOf({ ...base, config: { b: 2, a: 1 } }))
})

test('role 만 달라도 해시가 갈린다', () => {
  const flipped = { ...base, inputs: [{ ordinal: 0, role: 'assistant', textHash: 'aaaa' }] }
  assert.notEqual(recipeHashOf(base), recipeHashOf(flipped))
})

test('parserVersion 이 바뀌면 해시가 갈린다', () => {
  const next = { ...base, chunkPolicy: { ...base.chunkPolicy, parserVersion: 'script-v2' } }
  assert.notEqual(recipeHashOf(base), recipeHashOf(next))
})

test('partVersion 이 바뀌면 해시가 갈린다', () => {
  assert.notEqual(recipeHashOf(base), recipeHashOf({ ...base, partVersion: 2 }))
})

test('배열 순서는 의미를 가진다', () => {
  assert.notEqual(canonical([1, 2]), canonical([2, 1]))
})

test('같은 키의 동시 호출은 한 번만 실행된다', async () => {
  let runs = 0
  const slow = async () => { runs += 1; await new Promise((r) => setTimeout(r, 10)); return runs }
  const [a, b] = await Promise.all([withLock('k', slow), withLock('k', slow)])
  assert.equal(runs, 1)
  assert.equal(a, b)
})
