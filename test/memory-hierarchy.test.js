import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLevels } from '../memory/hierarchy.js'
import { recipeHashOf } from '../memory/recipe.js'

const hashes = ['h0', 'h1', 'h2', 'h3', 'h4']

test('자식들을 fanout 크기로 묶어 하나가 남을 때까지 올린다', () => {
  const levels = buildLevels(hashes, 2)
  assert.deepEqual(levels[0].groups.map((g) => g.childHashes), [['h0', 'h1'], ['h2', 'h3'], ['h4']])
  assert.equal(levels.at(-1).groups.length, 1)
})

test('자식 하나가 바뀌면 그 조상 그룹만 달라진다', () => {
  const before = buildLevels(hashes, 2)
  const after = buildLevels(['h0', 'hX', 'h2', 'h3', 'h4'], 2)
  assert.notDeepEqual(after[0].groups[0], before[0].groups[0])
  assert.deepEqual(after[0].groups[1], before[0].groups[1])
})

test('자식 순서가 바뀌면 부모 recipe 가 달라진다', () => {
  const a = recipeHashOf({ partId: 'p', partVersion: 1, level: 1, childHashes: ['h0', 'h1'] })
  const b = recipeHashOf({ partId: 'p', partVersion: 1, level: 1, childHashes: ['h1', 'h0'] })
  assert.notEqual(a, b)
})
