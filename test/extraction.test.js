import test from 'node:test'
import assert from 'node:assert/strict'
import { extractionRecipe, applyExtraction, parseExtractionOutput, EXTRACTION_VERSION, MAX_EXTRACTION_EXCHANGES } from '../scene/extraction.js'
import { emptySceneState } from '../scene/state.js'

const exchanges = [{ messageId: 'm2', user: '*주먹으로 때린다* 뭘 봐', assistant: '*유리가 뺨을 감싸 쥔다.*\n유리: …미쳤어?' }]

test('extractionRecipe — 인물·지표·현재 상태가 프롬프트에 들어가고 recipeHash 가 결정적이다', () => {
  const a = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리'], indicatorDefs: [{ key: '호감도', type: 'number', min: 0, max: 100, initial: 50 }] })
  const b = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리'], indicatorDefs: [{ key: '호감도', type: 'number', min: 0, max: 100, initial: 50 }] })
  assert.equal(a.recipeHash, b.recipeHash)
  assert.equal(a.purpose, 'extract')
  assert.match(a.system, /관찰되는 것만/)
  assert.match(a.system, /시도와 실제 발생을 구분/)
  assert.match(a.system, /유리/)
  assert.match(a.system, /호감도/)
  assert.equal(a.messages[0].role, 'user')
  assert.match(a.messages[0].text, /뭘 봐/)
  assert.equal(a.schema.type, 'object')
})

test('extractionRecipe — 상태가 다르면 recipeHash 가 다르다', () => {
  const a = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리'] })
  const b = extractionRecipe({ state: { ...emptySceneState(), place: '역' }, exchanges, names: ['유리'] })
  assert.notEqual(a.recipeHash, b.recipeHash)
})

test('extractionRecipe — names·playerName·지표 정의가 다르면 recipeHash 가 다르다', () => {
  const base = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리'] })
  const differentNames = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리', '민준'] })
  const differentPlayer = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리'], playerName: '플레이어' })
  const differentIndicators = extractionRecipe({ state: emptySceneState(), exchanges, names: ['유리'], indicatorDefs: [{ key: '호감도', type: 'number', min: 0, max: 100, initial: 50 }] })
  assert.notEqual(base.recipeHash, differentNames.recipeHash)
  assert.notEqual(base.recipeHash, differentPlayer.recipeHash)
  assert.notEqual(base.recipeHash, differentIndicators.recipeHash)
})

test('applyExtraction — expectedRevision 이 다르면 stale 로 거부한다', () => {
  const before = emptySceneState()
  const out = applyExtraction(before, JSON.stringify({ tension: 'hostile', beat: 'x' }), { names: ['유리'], messageId: 'm2', expectedRevision: 3 })
  assert.equal(out.stale, true)
  assert.equal(out.parsed, false)
  assert.deepEqual(out.state, before)
  assert.match(out.rejected.join(), /stale/)
})

test('parseExtractionOutput — 코드펜스와 잡문을 벗긴다', () => {
  assert.deepEqual(parseExtractionOutput('결과입니다:\n```json\n{"beat":"x"}\n```'), { beat: 'x' })
  assert.equal(parseExtractionOutput('json 아님'), null)
})

test('applyExtraction — 델타를 적용하고 beat 를 준다', () => {
  const raw = JSON.stringify({ tension: 'hostile', characters: { 유리: { body: { add: ['왼뺨에 멍'] }, emotion: '굴욕감', toward: { 유저: '경계' } } }, beat: '유저가 유리를 때렸다.' })
  const out = applyExtraction(emptySceneState(), raw, { names: ['유리'], messageId: 'm2' })
  assert.equal(out.parsed, true)
  assert.equal(out.beat, '유저가 유리를 때렸다.')
  assert.equal(out.stale, false)
  assert.equal(out.state.tension, 'hostile')
  assert.deepEqual(out.state.characters.유리.body, ['왼뺨에 멍'])
  assert.deepEqual(out.state.updatedAt, { messageId: 'm2' })
})

test('applyExtraction — 파싱 실패면 상태를 건드리지 않는다', () => {
  const before = emptySceneState()
  const out = applyExtraction(before, '못 알아듣겠다', { names: ['유리'], messageId: 'm2' })
  assert.equal(out.parsed, false)
  assert.deepEqual(out.state, before)
})

test('EXTRACTION_VERSION 이 문자열이다', () => { assert.equal(typeof EXTRACTION_VERSION, 'string') })

test('applyExtraction — ctx.llm 이 준 { text } 객체도 그대로 받는다', () => {
  const raw = { text: JSON.stringify({ tension: 'hostile', beat: '때렸다' }), provider: 'openai', usage: { input: 1, output: 1 }, latencyMs: 3 }
  const out = applyExtraction(emptySceneState(), raw, { names: ['유리'], messageId: 'm2' })
  assert.equal(out.parsed, true)
  assert.equal(out.state.tension, 'hostile')
  assert.equal(out.beat, '때렸다')
})

test('applyExtraction — stateHash 로 적용 전후를 비교할 수 있다', () => {
  const before = emptySceneState()
  const applied = applyExtraction(before, JSON.stringify({ tension: 'hostile', beat: 'x' }), { names: ['유리'] })
  assert.equal(typeof applied.stateHash.before, 'string')
  assert.notEqual(applied.stateHash.after, applied.stateHash.before)

  const failed = applyExtraction(before, '못 알아듣겠다', { names: ['유리'] })
  assert.equal(failed.stateHash.after, failed.stateHash.before)
  const stale = applyExtraction(before, JSON.stringify({ beat: 'x' }), { expectedRevision: 9 })
  assert.equal(stale.stateHash.after, stale.stateHash.before)
})

test('extractionRecipe — 따라잡기 상한을 넘는 교환은 던진다', () => {
  const many = Array.from({ length: MAX_EXTRACTION_EXCHANGES + 1 }, (_, i) => ({ user: `u${i}`, assistant: `a${i}` }))
  assert.equal(MAX_EXTRACTION_EXCHANGES, 5)
  assert.throws(() => extractionRecipe({ state: emptySceneState(), exchanges: many, names: ['유리'] }), /교환/)
  assert.ok(extractionRecipe({ state: emptySceneState(), exchanges: many.slice(0, MAX_EXTRACTION_EXCHANGES), names: ['유리'] }).recipeHash)
})

test('applyExtraction — version 이 다른 상태는 던지지 않고 거부한다', () => {
  const before = { ...emptySceneState(), version: 2 }
  const out = applyExtraction(before, JSON.stringify({ tension: 'hostile', beat: 'x' }), { names: ['유리'], messageId: 'm2' })
  assert.equal(out.parsed, false)
  assert.equal(out.stale, false)
  assert.match(out.rejected.join(), /version/)
  assert.deepEqual(out.state, before)
  assert.equal(out.stateHash.after, out.stateHash.before)
})
