import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMemory } from '../memory/index.js'
import { MEMORY_PRESETS } from '../memory/presets.js'
import { compilePrompt } from '../prompt/compile.js'

const messages = Array.from({ length: 20 }, (_, i) => ({
  id: `m${i}`, role: i % 2 ? 'assistant' : 'user',
  text: i === 0 ? '붉은 열쇠를 찾자' : `평범한 대사 ${i}`,
}))

test('lorebook 과 vector 가 등록되어 있고 LLM 을 쓰지 않는다', () => {
  for (const id of ['lorebook', 'vector']) {
    assert.ok(MEMORY_PRESETS[id], `${id} 없음`)
    assert.equal(MEMORY_PRESETS[id].usesLlm, false)
  }
})

test('lorebook 은 기억 압축을 하지 않는 대조군이다', async () => {
  const out = await selectMemory(messages, { preset: 'lorebook' }, {})
  assert.equal(out.manifest.parts.compactor, null)
  assert.equal(out.manifest.parts.retriever, null)
  assert.deepEqual(out.manifest.hiddenOrdinals, [])
  assert.equal(out.messages.length, messages.length)
})

test('vector 는 옛 메시지를 끌어와 앞뒤로 재배치한다', async () => {
  const out = await selectMemory(messages, {
    preset: 'vector',
    assembly: { windowSize: 4, retain: 1, retrievalLimit: 2 },
  }, {})
  // 창(4) 밖인 옛 메시지가 검색으로 살아 돌아온다.
  assert.ok(out.manifest.retrievedOrdinals.length > 0, '검색이 아무것도 못 끌어왔다')
  assert.ok(out.manifest.selectedOrdinals.includes(out.manifest.retrievedOrdinals[0]))
  // 그리고 점수가 근거로 남는다.
  assert.equal(out.manifest.retrievalScores.length, out.manifest.retrievedOrdinals.length)
})

test('두 프리셋은 로어북을 원본 이력에서 스캔한다 — 기억 축과 직교', async () => {
  for (const preset of ['lorebook', 'vector']) {
    const out = await selectMemory(messages, { preset }, {})
    assert.equal(out.manifest.worldbook.scanSource, 'raw', `${preset} 이 선택된 이력을 본다`)
    assert.ok(out.manifest.worldbook.budgetChars > 0, `${preset} 에 로어북 예산이 없다`)
  }
})

test('legacy 프리셋은 기존대로 선택된 이력을 스캔한다', async () => {
  const out = await selectMemory(messages, { preset: 'legacy-window' }, {})
  assert.equal(out.manifest.worldbook.scanSource, 'selected')
  assert.equal(out.manifest.worldbook.budgetChars, 0)
})

test('로어북 예산이 실제로 주입량을 자르고 근거를 남긴다', () => {
  const worldbooks = Array.from({ length: 40 }, (_, i) => ({
    id: `w${i}`, name: `설정${i}`, strategy: 'always', content: 'x'.repeat(400),
  }))
  const unlimited = compilePrompt({ cards: [{ name: '서윤' }], worldbooks, messages })
  const capped = compilePrompt({
    cards: [{ name: '서윤' }], worldbooks, messages,
    worldbookOptions: { budgetChars: 3000 },
  })
  assert.equal(unlimited.worldbookScan.truncated, 0)
  assert.ok(capped.worldbookScan.truncated > 0, '예산이 아무것도 자르지 않았다')
  assert.ok(capped.worldbookScan.usedChars <= 3000)
  assert.ok(capped.system.length < unlimited.system.length)
})
