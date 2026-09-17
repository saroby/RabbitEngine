import test from 'node:test'
import assert from 'node:assert/strict'
import { injectWorldbooksWithManifest, SCAN_DEPTH } from '../worldbook/strategies.js'

const books = [
  { id: 'a', name: '열쇠', strategy: 'keyword', keywords: '열쇠', content: '열쇠는 붉다' },
  { id: 'b', name: '학교', strategy: 'always', content: '교실은 3층이다' },
]
// 기억이 앞부분을 숨겼다고 하자 — 선택된 이력에는 '열쇠' 가 없다.
const raw = [
  { id: '1', text: '붉은 열쇠를 찾자' },
  { id: '2', text: '서랍을 열었다' },
  { id: '3', text: '창문을 봐' },
  { id: '4', text: '비가 내린다' },
  { id: '5', text: '밖으로 나가자' },
  { id: '6', text: '문이 잠겼다' },
  { id: '7', text: '어떻게 하지' },
]
const selected = raw.slice(-3)

test('scanSource 기본값은 선택된 이력을 본다 — 기존 동작', () => {
  const out = injectWorldbooksWithManifest(books, selected, {})
  assert.equal(out.scanSource, 'selected')
  assert.equal(out.manifest.find((m) => m.id === 'a').injected, false)
})

test('scanSource raw 는 기억 선택과 무관하게 원본을 본다', () => {
  // 원본에서도 최근 SCAN_DEPTH 개만 본다 — '열쇠' 는 창 밖이라 여전히 안 걸린다.
  const out = injectWorldbooksWithManifest(books, selected, {}, { scanSource: 'raw', rawMessages: raw })
  assert.equal(out.scanSource, 'raw')
  assert.equal(out.manifest.find((m) => m.id === 'a').injected, false)

  // 창 안에 있으면 걸린다. 핵심은 기억이 무엇을 숨겼든 결과가 같다는 것이다.
  const short = raw.slice(0, 3)
  const viaRaw = injectWorldbooksWithManifest(books, [], {}, { scanSource: 'raw', rawMessages: short })
  assert.equal(viaRaw.manifest.find((m) => m.id === 'a').injected, true)
})

test('직교성 — 기억이 무엇을 고르든 raw 스캔 결과는 같다', () => {
  const short = raw.slice(0, 3)
  const a = injectWorldbooksWithManifest(books, short, {}, { scanSource: 'raw', rawMessages: short })
  const b = injectWorldbooksWithManifest(books, [], {}, { scanSource: 'raw', rawMessages: short })
  const c = injectWorldbooksWithManifest(books, short.slice(-1), {}, { scanSource: 'raw', rawMessages: short })
  const ids = (o) => o.manifest.filter((m) => m.injected).map((m) => m.id)
  assert.deepEqual(ids(a), ids(b))
  assert.deepEqual(ids(a), ids(c))
})

test('예산을 넘으면 버리되 몇 개를 버렸는지 남긴다', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    id: `w${i}`, name: `설정${i}`, strategy: 'always', content: 'x'.repeat(100),
  }))
  const out = injectWorldbooksWithManifest(many, [], {}, { budgetChars: 250 })
  assert.equal(out.chunks.length, 2)
  assert.equal(out.truncated, 3)
  assert.ok(out.usedChars <= 250)
  assert.equal(out.manifest.filter((m) => m.overBudget).length, 3)
})

test('예산 0 은 무제한이다 — 기존 동작', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    id: `w${i}`, name: `설정${i}`, strategy: 'always', content: 'x'.repeat(100),
  }))
  const out = injectWorldbooksWithManifest(many, [])
  assert.equal(out.chunks.length, 5)
  assert.equal(out.truncated, 0)
})

test('스캔 깊이는 손잡이가 아니라 상수다', () => {
  assert.equal(SCAN_DEPTH, 6)
})
