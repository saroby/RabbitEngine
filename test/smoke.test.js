import test from 'node:test'
import assert from 'node:assert/strict'
import { VERSION } from '../index.js'

test('패키지가 로드된다', () => {
  assert.equal(typeof VERSION, 'string')
})
