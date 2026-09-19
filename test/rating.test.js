import test from 'node:test'
import assert from 'node:assert/strict'
import { RATINGS, RATING_TEXT, assertRating, ratingInstruction, ratingDirective } from '../scene/rating.js'

test('RATINGS 세 단계와 문구 표가 대응한다', () => {
  assert.deepEqual(RATINGS, ['all', 'teen', 'adult'])
  for (const rating of RATINGS) for (const key of ['instruction', 'directive']) assert.ok(RATING_TEXT[rating][key].length > 10)
})
test('assertRating — 모르는 값은 던진다', () => {
  assert.equal(assertRating('teen'), 'teen')
  assert.throws(() => assertRating('r18'), /rating/)
})
test('adult 는 직접 묘사를, all 은 여운 처리를 지시한다', () => {
  assert.match(ratingInstruction('adult'), /직접/)
  assert.match(ratingInstruction('all'), /직접 묘사하지 않는다/)
  assert.match(ratingDirective('teen'), /암시/)
})
