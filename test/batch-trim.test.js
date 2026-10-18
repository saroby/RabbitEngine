// 한꺼번에 자르는 창: 넘칠 때만 움직이고, 그 사이 턴은 앞부분이 그대로다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTurn, selectMemory, prefixFingerprint, sharedPrefix } from '../index.js'
import { batchTrimStart } from '../memory/assemble.js'

const history = (sizes) => sizes.map((size, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${i}:`.padEnd(size, '가') }))
const trim = (max, target) => ({ preset: 'batch-trim', assembly: { historyMaxChars: max, historyTargetChars: target } })

test('batchTrimStart — 넘기 전에는 전부, 넘으면 target 이하로 한 번에 줄인다', () => {
  assert.equal(batchTrimStart([30, 30, 30], 100, 50), 0)
  // 네 번째에서 120 > 100 → target 50 이하가 될 때까지 앞에서 버린다 → 마지막 하나(30)만 남는다
  assert.equal(batchTrimStart([30, 30, 30, 30], 100, 50), 3)
  // 그 뒤로는 다시 넘을 때까지 시작점이 그대로다
  assert.equal(batchTrimStart([30, 30, 30, 30, 30, 30], 100, 50), 3)
  assert.equal(batchTrimStart([30, 30, 30, 30, 30, 30, 30], 100, 50), 6)
  // 가장 최근 메시지는 target 보다 커도 남긴다
  assert.equal(batchTrimStart([10, 500], 100, 50), 1)
  assert.equal(batchTrimStart([], 100, 50), 0)
})

test('batchTrimStart — 이력이 뒤로 자라는 동안 시작점은 줄지 않고, 넘친 턴에만 움직인다', () => {
  const sizes = Array.from({ length: 300 }, (_, i) => 20 + ((i * 37) % 180))
  let previous = 0
  let moves = 0
  for (let n = 1; n <= sizes.length; n += 1) {
    const start = batchTrimStart(sizes.slice(0, n), 3000, 1500)
    assert.ok(start >= previous, `${n}번째에서 시작점이 뒤로 갔다`)
    const before = sizes.slice(previous, n - 1).reduce((a, b) => a + b, 0)
    if (start !== previous) {
      moves += 1
      assert.ok(before + sizes[n - 1] > 3000, `${n}번째: 넘치지 않았는데 움직였다`)
      assert.ok(sizes.slice(start, n).reduce((a, b) => a + b, 0) <= 1500 || start === n - 1)
    }
    previous = start
  }
  assert.ok(moves > 3 && moves < 40, `움직인 횟수 ${moves}`)
})

test('batch-trim — 매 턴 밀리는 창보다 캐시를 훨씬 덜 깨뜨린다', async () => {
  const sizes = Array.from({ length: 80 }, (_, i) => 300 + ((i * 53) % 400))
  const breaks = async (memory) => {
    let count = 0
    let previous = null
    for (let n = 30; n <= 80; n += 2) {
      const turn = await buildTurn({ cards: [{ name: '서연' }], messages: history(sizes.slice(0, n)), memory })
      const current = prefixFingerprint(turn.render())
      if (previous && sharedPrefix(previous, current).messages === 0) count += 1
      previous = current
    }
    return count
  }
  const sliding = await breaks({ preset: 'full', assembly: { windowSize: 20 } })
  const batched = await breaks(trim(12000, 6000))
  assert.equal(sliding, 25, '한 칸씩 미는 창은 매 턴 깨진다')
  assert.ok(batched <= 6, `batch-trim 이 ${batched}번 깨졌다`)
})

test('batch-trim — 고른 메시지와 기본값이 manifest 에 남는다', async () => {
  const out = await selectMemory(history([400, 400, 400, 400]), trim(1000, 500), {})
  // 세 번째(1200자)에서 넘쳐 500자 이하로 줄고(2번만), 네 번째는 800자라 그대로 붙는다
  assert.deepEqual(out.manifest.selectedOrdinals, [2, 3])
  assert.equal(out.manifest.preset, 'batch-trim')
  const defaults = await selectMemory(history([10]), { preset: 'batch-trim' }, {})
  assert.equal(defaults.manifest.assembly.historyMaxChars, 24000)
  assert.equal(defaults.manifest.assembly.historyTargetChars, 12000)
})

test('batch-trim — 이번 턴 입력도 길이에 들고, 돌려주는 이력에서는 빠진다', async () => {
  const turn = await buildTurn({ cards: [{ name: '서연' }], messages: history([400, 400]), userInput: '가'.repeat(400), memory: trim(1000, 500) })
  assert.equal(turn.messages.length, 0, '입력까지 1200자라 넘쳐서 입력만 남는다')
  assert.equal(turn.render().messages.at(-1).text.startsWith('가'), true)
})

test('batch-trim — 아무것도 안 자르거나 경계가 어긋나는 조합은 던진다', async () => {
  const messages = history([10, 10])
  await assert.rejects(selectMemory(messages, trim(500, 500), {}), /target 이 max 보다 작아야/)
  await assert.rejects(selectMemory(messages, trim(0, 0), {}), /양수/)
  await assert.rejects(selectMemory(messages, { preset: 'lorebook', assembly: { historyMaxChars: 500, historyTargetChars: 200 } }, {}), /windowMode 'cut'/)
  await assert.rejects(selectMemory(messages, { preset: 'vector', assembly: { historyMaxChars: 500, historyTargetChars: 200 } }, {}), /압축기 · 검색기/)
})
