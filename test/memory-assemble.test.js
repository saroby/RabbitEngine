import test from 'node:test'
import assert from 'node:assert/strict'
import { assemble, DEFAULT_ASSEMBLY, MEMORY_LABEL } from '../memory/assemble.js'

const messages = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `본문 ${i}` }))
const entries = messages.map((m, ordinal) => ({ ordinal, messageId: m.id, role: m.role }))
const closed = [{ ordinal: 0, coversOrdinals: [0, 1, 2], entries: entries.slice(0, 3) }]
const open = { ordinal: 1, coversOrdinals: [3, 4, 5], entries: entries.slice(3) }
const artifacts = [{ id: 'a1', kind: 'scene', coversOrdinals: [0, 1, 2], text: '첫 장면 요약' }]
const base = { ...DEFAULT_ASSEMBLY, windowSize: 3, windowMode: 'protect' }

test('hideCompacted 는 닫힌 chunk 원문을 빼고 요약을 note 로 넘긴다', () => {
  const out = assemble({ messages, entries, closed, open, artifacts, assembly: { ...base, placement: 'note' } })
  assert.deepEqual(out.messages.map((m) => m.id), ['m3', 'm4', 'm5'])
  assert.deepEqual(out.hiddenOrdinals, [0, 1, 2])
  assert.equal(out.notes.length, 1)
  assert.equal(out.notes[0].text, '첫 장면 요약')
})

test('note 본문에 라벨을 붙이지 않는다 — 라벨은 컴파일러가 한 번만 붙인다', () => {
  const out = assemble({ messages, entries, closed, open, artifacts, assembly: { ...base, placement: 'note' } })
  assert.ok(!out.notes[0].text.includes(MEMORY_LABEL))
})

test('hideCompacted 를 끄면 원문이 그대로 남는다', () => {
  const out = assemble({ messages, entries, closed, open, artifacts, assembly: { ...base, hideCompacted: false, placement: 'note' } })
  assert.deepEqual(out.messages.map((m) => m.id), messages.map((m) => m.id))
  assert.deepEqual(out.hiddenOrdinals, [])
})

test('placement both 는 앞뒤로 나눠 넣되 같은 항목을 두 번 넣지 않는다', () => {
  const two = [
    { id: 'a0', kind: 'scene', coversOrdinals: [0], text: '첫 요약' },
    { id: 'a1', kind: 'scene', coversOrdinals: [1], text: '둘째 요약' },
  ]
  const out = assemble({
    messages, entries, closed, artifacts: two,
    assembly: { ...base, hideCompacted: false, placement: 'both', retain: 1 },
  })
  const injected = out.messages.filter((m) => m.memoryInjected)
  assert.equal(injected.length, 2)
  assert.equal(new Set(injected.map((m) => m.text)).size, 2)
  // 앞뒤로 갈렸는지 — 둘이 붙어 있으면 나눈 것이 아니다.
  const positions = out.messages.map((m, i) => (m.memoryInjected ? i : -1)).filter((i) => i >= 0)
  assert.ok(positions[1] - positions[0] > 1)
})

test('budgetChars 를 넘으면 잘리고 잘린 수가 기록된다', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, kind: 'scene', coversOrdinals: [0], text: 'x'.repeat(100) }))
  const out = assemble({
    messages, entries, closed, open, artifacts: many,
    assembly: { ...base, placement: 'note', budgetChars: 250 },
  })
  assert.equal(out.truncated, 3)
})

test('산출물 종류나 출처가 달라도 note 모양이 같다', () => {
  const a = assemble({ messages, entries, closed, open, artifacts, assembly: { ...base, placement: 'note' } })
  const b = assemble({ messages, entries, closed, open, artifacts: [{ ...artifacts[0], kind: 'event', origin: 'user' }], assembly: { ...base, placement: 'note' } })
  assert.equal(a.notes[0].kind, b.notes[0].kind)
  assert.equal(a.notes[0].text, b.notes[0].text)
})

// 창 검사는 assemble 이 아니라 selectMemory 가 프리셋+override 를 해석한 뒤에 건다.
// 여기서 걸면 호출자 override 를 못 보고, 실제로 chunkPolicy:null 로 넘어와
// 죽은 코드였다 (2026-08-27).
test('조립기는 창 크기를 스스로 검사하지 않는다', () => {
  assert.doesNotThrow(() => assemble({
    messages, entries, closed, artifacts,
    assembly: { ...DEFAULT_ASSEMBLY, windowSize: 2 },
  }))
})

test('retain 이 남은 메시지보다 크면 음수 slice 로 순서가 깨지지 않는다', () => {
  const out = assemble({
    messages, entries, closed, artifacts,
    assembly: { ...base, hideCompacted: false, placement: 'back', retain: 99 },
  })
  // retain 이 전부를 덮으면 주입은 맨 앞에 온다. 중간에 끼어들면 안 된다.
  assert.ok(out.messages[0].memoryInjected)
  assert.deepEqual(out.messages.filter((m) => !m.memoryInjected).map((m) => m.id), messages.map((m) => m.id))
})

test('검색으로 끌어온 메시지는 선택에만 쓰이고 기억 층에 또 들어가지 않는다', () => {
  const retrieved = [{ ordinal: 0, ref: 'm0', text: '본문 0' }]
  const out = assemble({
    messages, entries, closed, artifacts: [], retrieved,
    assembly: { ...base, hideCompacted: false, placement: 'note', windowMode: 'cut' },
  })
  // 창(3) 밖인 m0 가 검색 덕분에 원문으로 남는다.
  assert.deepEqual(out.messages.map((m) => m.id), ['m0', 'm3', 'm4', 'm5'])
  // 그리고 note 로 또 들어가지 않는다.
  assert.deepEqual(out.notes, [])
})

test('note 예산은 라벨을 한 번만 센다', () => {
  const body = 'x'.repeat(40)
  const three = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, kind: 'scene', coversOrdinals: [i], text: body }))
  // 라벨 1회 + (본문 40 + 줄바꿈 1) × 3 = 딱 맞는다. 항목마다 라벨을 세면
  // 과대 계산이 되어 들어갈 수 있는 것을 일찍 잘라낸다.
  const budgetChars = MEMORY_LABEL.length + (body.length + 1) * 3
  const out = assemble({
    messages, entries, closed, artifacts: three,
    assembly: { ...base, hideCompacted: false, placement: 'note', budgetChars },
  })
  assert.equal(out.truncated, 0)
})

test('메시지 층 예산은 항목마다 라벨과 줄바꿈을 센다', () => {
  const body = 'x'.repeat(50)
  const two = [
    { id: 'a0', kind: 'scene', coversOrdinals: [0], text: body },
    { id: 'a1', kind: 'scene', coversOrdinals: [1], text: body },
  ]
  // 본문만 세면 100 이라 둘 다 들어가지만, 라벨+줄바꿈을 세면 넘친다.
  const budgetChars = 100 + MEMORY_LABEL.length + 1
  const out = assemble({
    messages, entries, closed, artifacts: two,
    assembly: { ...base, hideCompacted: false, placement: 'front', budgetChars },
  })
  assert.equal(out.truncated, 1)
  assert.ok(out.usedChars <= budgetChars)
})

test('windowMode cut 은 창 밖을 버리고 protect 는 남긴다', () => {
  const cut = assemble({ messages, entries, closed, artifacts: [], assembly: { ...base, hideCompacted: false, placement: 'note', windowMode: 'cut' } })
  const protect = assemble({ messages, entries, closed, artifacts: [], assembly: { ...base, hideCompacted: false, placement: 'note', windowMode: 'protect' } })
  assert.deepEqual(cut.messages.map((m) => m.id), ['m3', 'm4', 'm5'])
  assert.deepEqual(protect.messages.map((m) => m.id), messages.map((m) => m.id))
})

test('선택 결과와 entries 가 함께 나와 색인이 어긋나지 않는다', () => {
  const out = assemble({
    messages, entries, closed, artifacts,
    assembly: { ...base, hideCompacted: false, placement: 'front', windowMode: 'cut' },
  })
  const real = out.messages.filter((m) => !m.memoryInjected)
  assert.deepEqual(real.map((m) => m.id), out.selectedEntries.map((e) => e.messageId))
})
