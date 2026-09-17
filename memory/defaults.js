// 엔진이 소유하는 기억 층 기본값. 모델에 실제로 나가거나 조립 계산에 쓰이는
// 값만 여기 둔다 — 화면 라벨과 렌더링 방식은 contract.js 에 남는다.
// Rabbit Engine 추출 시 이 파일이 통째로 엔진의 memory/defaults.js 가 된다.

// 기존 5종 전략의 기본 창 크기. server/context-strategies.js 의
// boundedSize(value, fallback = 12) 가 쓰던 값이다. 새 프리셋의 기본값과
// 반드시 갈라 둔다 — 합치면 "동작 변화 없음" 이라는 전제가 깨진다.
export const LEGACY_WINDOW_SIZE = 12
export const LEGACY_RETRIEVAL_LIMIT = 4

// 새 기억 프리셋의 조립 기본값.
export const DEFAULT_ASSEMBLY = {
  windowSize: 24,
  // 새 프리셋에서 창은 "압축하지 않을 최근 구간" 이다. 창 밖도 압축되지
  // 않았다면 남는다. legacy 의 'cut'(창 밖은 버린다)과 의미가 다르다.
  windowMode: 'protect',
  hideCompacted: true,
  placement: 'front',
  budgetChars: 6000,
  retain: 5,
  minScore: 1,
}

// 모델에 가는 기억 층 라벨은 모든 프리셋에 같다. 자동 생성 프리셋에만
// "부정확할 수 있음" 같은 문장을 붙이면, 기억 기법의 차이가 아니라
// 헤지 문장의 효과를 재게 된다 (spec: 기억 층 라벨).
export const MEMORY_LABEL = '[대화 참고 정보]'
