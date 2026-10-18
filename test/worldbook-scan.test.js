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

test('제외 키워드가 보이면 키워드가 걸려도 넣지 않고 사유를 남긴다', () => {
  const book = { id: 'k', name: '열쇠', strategy: 'keyword', keywords: '열쇠', excludeKeywords: ['열쇠고리', '자동차 열쇠'], content: '열쇠는 붉다' }
  const hit = injectWorldbooksWithManifest([book], [{ text: '서랍에서 열쇠를 꺼냈다' }])
  assert.equal(hit.manifest[0].injected, true)
  assert.equal('excludedBy' in hit.manifest[0], false)

  const miss = injectWorldbooksWithManifest([book], [{ text: '가방에 열쇠고리가 달려 있다' }])
  assert.equal(miss.manifest[0].injected, false)
  assert.deepEqual(miss.manifest[0].matchedKeywords, ['열쇠'])
  assert.deepEqual(miss.manifest[0].excludedBy, ['열쇠고리'])
  assert.deepEqual(miss.chunks, [])
})

test('제외 키워드는 쉼표 문자열도 받고, 키워드가 안 걸리면 보지 않는다', () => {
  const book = { id: 'k', name: '열쇠', strategy: 'keyword', keywords: '열쇠', excludeKeywords: '열쇠고리, 고리', content: 'x' }
  assert.deepEqual(injectWorldbooksWithManifest([book], [{ text: '열쇠고리' }]).manifest[0].excludedBy, ['열쇠고리', '고리'])
  assert.equal('excludedBy' in injectWorldbooksWithManifest([book], [{ text: '고리만 있다' }]).manifest[0], false)
})

test('예산이 모자라면 priority 가 높은 항목이 먼저 자리를 차지한다', () => {
  const entry = (id, priority) => ({ id, name: id, strategy: 'always', content: 'x'.repeat(100), ...(priority === undefined ? {} : { priority }) })
  const out = injectWorldbooksWithManifest([entry('low'), entry('mid', 5), entry('high', 10)], [], {}, { budgetChars: 250 })
  const injected = out.manifest.filter((m) => m.injected).map((m) => m.id)
  assert.deepEqual(injected, ['mid', 'high'], '내보내는 순서는 원래 순서다')
  assert.equal(out.manifest.find((m) => m.id === 'low').overBudget, true)
  assert.equal(out.truncated, 1)
  assert.equal(out.chunks.length, 2)
  assert.ok(out.chunks[0].startsWith('[설정: mid]'))
})

test('priority 가 같거나 없으면 예전처럼 앞에서부터 채운다', () => {
  const many = ['a', 'b', 'c'].map((id) => ({ id, name: id, strategy: 'always', content: 'x'.repeat(100), priority: 1 }))
  const out = injectWorldbooksWithManifest(many, [], {}, { budgetChars: 250 })
  assert.deepEqual(out.manifest.filter((m) => m.injected).map((m) => m.id), ['a', 'b'])
})

test('숫자가 아닌 priority 는 0 으로 본다', () => {
  const books = [
    { id: 'str', name: 'str', strategy: 'always', content: 'x'.repeat(100), priority: '99' },
    { id: 'num', name: 'num', strategy: 'always', content: 'x'.repeat(100), priority: 1 },
  ]
  const out = injectWorldbooksWithManifest(books, [], {}, { budgetChars: 150 })
  assert.deepEqual(out.manifest.filter((m) => m.injected).map((m) => m.id), ['num'])
  assert.equal('priority' in out.manifest[0], false)
})
