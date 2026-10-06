import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTurn } from '../prompt/render.js'
import {
  POST_HISTORY, MAX_DEPTH, positionOf, slotAt, bubbleAt, historyLength, timelineRows, gapAbove, gapBelow, keyboardStep, positionText,
} from '../editor/timeline.js'

test('engine default slots map to the positions the old editor labelled', () => {
  assert.equal(positionOf({ kind: 'memory', slot: 'default' }), 4)
  assert.equal(positionOf({ kind: 'scene_state', slot: 'default' }), 2)
  assert.equal(positionOf({ kind: 'event', slot: 'default' }), 0)
  assert.equal(positionOf({ kind: 'directive', slot: 'default' }), POST_HISTORY)
  assert.equal(positionOf({ kind: 'custom', slot: { depth: 7 } }), 7)
  assert.equal(positionOf({ kind: 'custom', slot: 'post_history' }), POST_HISTORY)
})

test('slotAt keeps default for an engine block returning to its own position', () => {
  assert.equal(slotAt('memory', 4), 'default')
  assert.deepEqual(slotAt('memory', 3), { depth: 3 })
  assert.equal(slotAt('directive', POST_HISTORY), 'default')
  assert.equal(slotAt('event', POST_HISTORY), 'post_history')
  assert.deepEqual(slotAt('custom', 0), { depth: 0 })
  assert.equal(slotAt('custom', POST_HISTORY), 'post_history')
})

test('bubbles alternate upward from the last user message', () => {
  assert.deepEqual(bubbleAt(0), { role: 'user', label: '사용자 · 마지막 메시지(이번 입력)' })
  assert.equal(bubbleAt(1).role, 'assistant')
  assert.equal(bubbleAt(2).role, 'user')
  assert.equal(bubbleAt(3).role, 'assistant')
})

test('history covers the deepest block plus one, at least three, at most the depth limit', () => {
  assert.equal(historyLength(-1), 3)
  assert.equal(historyLength(0), 3)
  assert.equal(historyLength(4), 5)
  assert.equal(historyLength(4, 9), 9)
  assert.equal(historyLength(MAX_DEPTH), MAX_DEPTH)
  assert.equal(historyLength(2, 500), MAX_DEPTH)
})

test('timeline rows put gap N directly above bubble N and post_history last', () => {
  const rows = timelineRows(3)
  assert.deepEqual(rows.map((row) => (row.type === 'gap' ? `g${row.position}` : `m${row.index}`)),
    ['g3', 'm3', 'g2', 'm2', 'g1', 'm1', 'g0', 'm0', `g${POST_HISTORY}`])
})

test('gap order matches renderTurn: a block at gap N lands right above message N', () => {
  const messages = [{ role: 'user', text: 'u2' }, { role: 'assistant', text: 'a1' }]
  for (const depth of [0, 1, 2]) {
    const out = renderTurn([{ kind: 'custom', role: 'system', slot: { depth }, content: 'X' }], messages, { userInput: 'u0' }).messages
      .map((message) => message.text)
    // 타임라인: 말풍선 2(u2) · 1(a1) · 0(u0). 칸 N 은 말풍선 N 바로 위다.
    const bubbles = ['u0', 'a1', 'u2']
    assert.equal(out[out.indexOf('X') + 1], bubbles[depth], `depth ${depth}`)
  }
})

test('neighbouring gaps step through post_history and stop at the ends', () => {
  assert.equal(gapAbove(POST_HISTORY), 0)
  assert.equal(gapAbove(0), 1)
  assert.equal(gapAbove(MAX_DEPTH), undefined)
  assert.equal(gapBelow(1), 0)
  assert.equal(gapBelow(0), POST_HISTORY)
  assert.equal(gapBelow(POST_HISTORY), undefined)
})

test('keyboard steps reorder inside a gap first, then cross to the neighbouring gap edge', () => {
  const stack = ['scene_state', 'custom:a', 'custom:b']
  assert.deepEqual(keyboardStep({ position: 2, stack, key: 'custom:a', direction: 'up' }), { before: 'scene_state' })
  assert.deepEqual(keyboardStep({ position: 2, stack, key: 'scene_state', direction: 'up' }), { position: 3, edge: 'end' })
  assert.deepEqual(keyboardStep({ position: 2, stack, key: 'custom:a', direction: 'down' }), { after: 'custom:b' })
  assert.deepEqual(keyboardStep({ position: 2, stack, key: 'custom:b', direction: 'down' }), { position: 1, edge: 'start' })
  assert.deepEqual(keyboardStep({ position: 0, stack: ['event'], key: 'event', direction: 'down' }), { position: POST_HISTORY, edge: 'start' })
  assert.equal(keyboardStep({ position: POST_HISTORY, stack: ['directive'], key: 'directive', direction: 'down' }), undefined)
  assert.equal(keyboardStep({ position: MAX_DEPTH, stack: ['x'], key: 'x', direction: 'up' }), undefined)
})

test('position text is plain language', () => {
  assert.match(positionText(POST_HISTORY), /뒤/)
  assert.equal(positionText(0), '마지막 사용자 메시지(이번 입력) 바로 앞')
  assert.equal(positionText(1), '이전 모델 답변 바로 앞 (이번 입력보다 메시지 1개 앞)')
  assert.equal(positionText(2), '이전 사용자 메시지 바로 앞 (이번 입력보다 메시지 2개 앞)')
})
