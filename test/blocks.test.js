import test from 'node:test'
import assert from 'node:assert/strict'
import { compileBlocks } from '../prompt/blocks.js'
import { compilePrompt } from '../prompt/compile.js'

const card = { name: '유리', description: '도서관 사서' }

test('compileBlocks — 기본 블록은 system 슬롯이고 순서가 고정이다', () => {
  const { blocks } = compileBlocks({ cards: [card] })
  assert.deepEqual(blocks.map((b) => b.kind), ['character', 'user_boundary', 'output_contract'])
  assert.ok(blocks.every((b) => b.slot === 'system' && b.role === 'system'))
})

test('compileBlocks — 기억 노트는 depth 4, 장면 상태는 depth 2, 사건은 depth 0, 디렉티브는 post_history', () => {
  const { blocks } = compileBlocks({
    cards: [card],
    memoryNotes: [{ kind: 'summary', text: '지난 일' }],
    sceneStateText: '지금: 현관.',
    events: ['밖에서 유리창 깨지는 소리'],
    directive: '결과를 확정한다.',
  })
  const slotOf = (kind) => blocks.find((b) => b.kind === kind).slot
  assert.deepEqual(slotOf('memory'), { depth: 4 })
  assert.deepEqual(slotOf('scene_state'), { depth: 2 })
  assert.deepEqual(slotOf('event'), { depth: 0 })
  assert.equal(slotOf('directive'), 'post_history')
})

test('compileBlocks — 등급 문장과 페이싱은 instruction 블록 뒤 system 슬롯에 들어간다', () => {
  const { blocks } = compileBlocks({ cards: [card], instructionText: '연기해라', ratingInstruction: '직접 묘사한다.', pacingText: '천천히 간다.' })
  const kinds = blocks.map((b) => b.kind)
  assert.deepEqual(kinds.slice(0, 3), ['instruction', 'rating', 'pacing'])
})

test('compileBlocks — worldbookDepth 를 주면 로어북 블록이 그 depth 로 간다', () => {
  const { blocks } = compileBlocks({ cards: [card], worldbooks: [{ id: 'w1', name: '왕국', content: '왕은 죽었다', strategy: 'always' }], worldbookDepth: 3 })
  assert.deepEqual(blocks.find((b) => b.kind === 'worldbook').slot, { depth: 3 })
})

test('compilePrompt — system 슬롯 밖 블록이 생기는 입력은 조용히 버리지 않고 던진다', () => {
  assert.throws(() => compilePrompt({ cards: [card], sceneStateText: '지금: 현관.' }), /compileBlocks/)
  assert.throws(() => compilePrompt({ cards: [card], directive: '결과.' }), /compileBlocks/)
  assert.throws(() => compilePrompt({ cards: [card], events: ['정전'] }), /compileBlocks/)
  assert.ok(compilePrompt({ cards: [card] }).system.includes('유리'))
})

test('compilePrompt — 기존 layers 계약이 유지된다', () => {
  const out = compilePrompt({ cards: [card], contextNotes: [{ kind: 'summary', text: '지난 일' }] })
  assert.ok(out.layers.some((l) => l.kind === 'context_summary'))
  assert.equal(out.layers.at(-1).kind, 'output_contract')
})

test('compileBlocks — 항목별 depth 가 전역 worldbookDepth 를 이긴다', () => {
  const worldbooks = [
    { id: 'w1', name: '왕국', content: '왕은 죽었다', strategy: 'always', depth: 1 },
    { id: 'w2', name: '기후', content: '겨울이 길다', strategy: 'always' },
  ]
  const { blocks } = compileBlocks({ cards: [card], worldbooks, worldbookDepth: null })
  const found = blocks.filter((b) => b.kind === 'worldbook')
  assert.deepEqual(found[0].slot, { depth: 1 })
  assert.equal(found[1].slot, 'system')
})
