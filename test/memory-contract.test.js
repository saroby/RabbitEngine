import test from 'node:test'
import assert from 'node:assert/strict'
import { definePart, validateCalls } from '../memory/contract.js'
import { passthroughCompactor } from '../memory/parts/passthrough.js'

const ok = { partId: 'x', partVersion: 1, kind: 'compactor', build: async () => ({ artifacts: [], calls: [] }) }

test('알 수 없는 종류의 부품은 등록을 거부한다', () => {
  assert.throws(() => definePart({ ...ok, kind: 'summarizer' }), /kind/)
})

test('partVersion 이 없는 부품은 등록을 거부한다', () => {
  assert.throws(() => definePart({ ...ok, partVersion: undefined }), /partVersion/)
})

test('종류에 맞는 함수가 없으면 등록을 거부한다', () => {
  assert.throws(() => definePart({ partId: 'y', partVersion: 1, kind: 'reducer', build: ok.build }), /buildParent/)
})

test('tracker 는 순수 reduce 가 없으면 등록을 거부한다', () => {
  assert.throws(() => definePart({ partId: 'z', partVersion: 1, kind: 'tracker', extract: ok.build }), /reduce/)
})

test('calls 를 안 내면 런타임에서 걸린다', () => {
  assert.throws(() => validateCalls(undefined, 'x'), /calls/)
  assert.throws(() => validateCalls([{ model: 'm' }], 'x'), /provider/)
  assert.doesNotThrow(() => validateCalls([], 'x'))
  assert.doesNotThrow(() => validateCalls([{
    provider: 'anthropic', model: 'claude-opus-5', partId: 'x', purpose: 'compact',
    promptTokens: 10, completionTokens: 5, ms: 100, outcome: 'success', cacheHit: false,
  }], 'x'))
})

test('숫자가 아닌 비용, 음수 토큰, 문자열 cacheHit 은 통과하지 못한다', () => {
  const ok = {
    provider: 'anthropic', model: 'claude-opus-5', partId: 'x', purpose: 'compact',
    promptTokens: 10, completionTokens: 5, ms: 100, outcome: 'success', cacheHit: false,
  }
  assert.throws(() => validateCalls([{ ...ok, promptTokens: undefined }], 'x'), /promptTokens/)
  assert.throws(() => validateCalls([{ ...ok, completionTokens: NaN }], 'x'), /completionTokens/)
  assert.throws(() => validateCalls([{ ...ok, ms: -1 }], 'x'), /ms/)
  assert.throws(() => validateCalls([{ ...ok, cacheHit: 'no' }], 'x'), /cacheHit/)
  assert.throws(() => validateCalls([{ ...ok, partId: 'other' }], 'x'), /partId/)
  assert.throws(() => validateCalls([{ ...ok, purpose: '' }], 'x'), /purpose/)
  assert.throws(() => validateCalls([{ ...ok, provider: null }], 'x'), /provider/)
  assert.throws(() => validateCalls([{ ...ok, model: 42 }], 'x'), /model/)
  assert.throws(() => validateCalls([{ ...ok, outcome: undefined }], 'x'), /outcome/)
  assert.throws(() => validateCalls([{ ...ok, promptTokens: 1.5 }], 'x'), /promptTokens/)
  assert.doesNotThrow(() => validateCalls([{ ...ok, ms: 12.5 }], 'x'))
})

test('가짜 압축기는 결정론적이고 호출을 0 으로 보고한다', async () => {
  const chunk = { ordinal: 0, coversOrdinals: [0, 1], entries: [] }
  const a = await passthroughCompactor.build({ chunk, config: {}, llm: null, texts: ['하나', '둘'] })
  const b = await passthroughCompactor.build({ chunk, config: {}, llm: null, texts: ['하나', '둘'] })
  assert.deepEqual(a.artifacts, b.artifacts)
  assert.deepEqual(a.calls, [])
})
