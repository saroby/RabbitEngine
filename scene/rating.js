// 등급이 문장에 어떻게 반영되는지의 정본. 누가 어떤 모델로 이 등급을 볼 수 있는지는 호스트 몫이다.
export const RATINGS = Object.freeze(['all', 'teen', 'adult'])

export const RATING_TEXT = Object.freeze({
  all: {
    instruction: '묘사 범위: 폭력·성적 장면은 직접 묘사하지 않는다. 장면 전환이나 여운으로 처리하되, 일어난 일과 그 결과(아픔·관계 변화)는 분명히 남긴다.',
    directive: '폭력·성적 상황은 직접 묘사 없이 결과 중심으로 처리한다.',
  },
  teen: {
    instruction: '묘사 범위: 폭력은 결과와 감각 중심으로 묘사하고, 성적 장면은 암시까지만 쓴다. 일어난 일과 그 결과는 회피하지 않는다.',
    directive: '폭력은 결과 중심으로, 성적 상황은 암시까지만 쓰되 회피하지 않는다.',
  },
  adult: {
    instruction: '묘사 범위: 폭력과 성적 장면을 회피하지 않고 직접 묘사한다. 장면 안에서 결과까지 이어 쓴다.',
    directive: '폭력과 성적 상황을 회피하지 않고 장면 안에서 결과까지 묘사한다.',
  },
})

export function assertRating(value) {
  if (!RATINGS.includes(value)) throw new Error(`rating 은 ${RATINGS.join(' | ')} 중 하나여야 합니다: ${String(value)}`)
  return value
}
export const ratingInstruction = (rating) => RATING_TEXT[assertRating(rating)].instruction
export const ratingDirective = (rating) => RATING_TEXT[assertRating(rating)].directive
