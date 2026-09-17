// node:crypto 와 같은 다이제스트를 내야 한다. 다르면 기억 산출물 캐시가
// 통째로 무효가 되고, 저장된 세션의 요약을 전부 다시 사게 된다.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { sha256Hex } from '../sha256.js'

const reference = (text) => crypto.createHash('sha256').update(text).digest('hex')

const SAMPLES = [
  '',
  'a',
  'abc',
  '유리: 왔구나.',
  '가'.repeat(55),   // 블록 경계 직전
  '가'.repeat(56),   // 길이 필드가 다음 블록으로 밀리는 지점
  'x'.repeat(64),    // 정확히 한 블록
  'x'.repeat(1000),
  JSON.stringify({ a: 1, b: [null, '한글', true] }),
]

test('sha256Hex — node:crypto 와 같은 다이제스트를 낸다', () => {
  for (const sample of SAMPLES) {
    assert.equal(sha256Hex(sample), reference(sample), `입력 길이 ${sample.length}`)
  }
})

test('sha256Hex — 64자 소문자 hex 를 낸다', () => {
  assert.match(sha256Hex('아무거나'), /^[0-9a-f]{64}$/)
})
