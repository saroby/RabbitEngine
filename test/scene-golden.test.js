// 장면 렌더와 등급 문구의 골든. 문구가 바뀌면 실험 결과가 비교 불가능해지므로
// 스냅샷으로 못 박는다 — 고쳐서 통과시키지 않는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderSceneState } from '../scene/state.js'
import { RATING_TEXT } from '../scene/rating.js'
import { SCENE_CASE } from '../scripts/scene-golden.js'

const golden = JSON.parse(readFileSync(new URL('./fixtures/scene-golden.json', import.meta.url)))

test('골든 — renderSceneState 출력이 스냅샷과 같다', () => {
  assert.equal(renderSceneState(SCENE_CASE.state, { indicatorDefs: SCENE_CASE.indicatorDefs }), golden.renderSceneState)
})

test('골든 — 등급 문구표가 스냅샷과 같다', () => {
  assert.deepEqual(RATING_TEXT, golden.ratingText)
})
