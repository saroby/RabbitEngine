import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { buildTurn } from '../build-turn.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'

const DIALECTS = { 'asterisk-script': asteriskScript, 'korean-playscript': koreanPlayscript }
const dir = new URL('../eval/scenarios/', import.meta.url)
const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()

test('평가 시나리오가 10개 이상이다', () => { assert.ok(files.length >= 10) })

for (const file of files) {
  test(`시나리오 ${file}`, async () => {
    const s = JSON.parse(await readFile(new URL(file, dir), 'utf8'))
    const turn = await buildTurn({
      cards: s.cards, dialect: DIALECTS[s.dialect], rating: s.rating, indicatorDefs: s.indicatorDefs ?? [],
      sceneState: s.sceneState ?? undefined, messages: s.history, userInput: s.userInput,
    })
    for (const needle of s.expect.directiveIncludes ?? []) assert.ok(turn.directive.includes(needle), `directive 에 "${needle}" 없음: ${turn.directive}`)
    for (const needle of s.expect.directiveExcludes ?? []) assert.ok(!turn.directive.includes(needle), `directive 에 "${needle}" 있음`)
    for (const needle of s.expect.systemIncludes ?? []) assert.ok(turn.system.includes(needle), `system 에 "${needle}" 없음`)
    for (const [kind, present] of Object.entries(s.expect.blocks ?? {})) assert.equal(turn.blocks.some((b) => b.kind === kind), present, `블록 ${kind}`)
  })
}
