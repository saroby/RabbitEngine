// 장면 렌더 문장과 등급 문구표의 골든 스냅샷 생성기.
// 사람이 fixtures 를 손으로 고치지 않는다 — 고쳐야 한다면 모델에 나가는 문장이
// 바뀐 것이고, 그러면 전후 실험 결과를 더 이상 나란히 놓을 수 없다.
import { writeFileSync } from 'node:fs'
import { renderSceneState } from '../scene/state.js'
import { RATING_TEXT } from '../scene/rating.js'

// 렌더의 모든 줄을 한 번씩 지나는 상태 — 장소·시각·긴장·인물(몸·감정·태도)·
// 미해결·라벨 있는 지표.
export const SCENE_CASE = {
  state: {
    version: 1,
    revision: 3,
    place: '도서관 3층',
    time: '자정',
    tension: 'hostile',
    characters: {
      유리: { body: ['왼뺨에 멍', '젖은 외투'], emotion: '굴욕감', toward: { 루이: '경계' } },
    },
    threads: ['3층 열쇠를 누가 가져갔나'],
    indicators: { 호감도: 20 },
    updatedAt: { messageId: 'm7' },
  },
  indicatorDefs: [{ key: '호감도', type: 'number', min: 0, max: 100, initial: 50, label: '호감' }],
}

export function snapshot() {
  return {
    renderSceneState: renderSceneState(SCENE_CASE.state, { indicatorDefs: SCENE_CASE.indicatorDefs }),
    ratingText: RATING_TEXT,
  }
}

if (process.argv[1]?.endsWith('scene-golden.js')) {
  writeFileSync(
    new URL('../test/fixtures/scene-golden.json', import.meta.url),
    `${JSON.stringify(snapshot(), null, 2)}\n`,
  )
  console.log('장면 골든을 기록했다')
}
