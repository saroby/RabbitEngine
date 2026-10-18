// 엔진 블록 설명. 편집기의 블록 i 버튼과 엔진 스펙 탭이 같은 문장을 쓴다.
// slot · trust · dynamic 은 test/editor-spec.test.js 가 엔진과 맞춰 본다 — 엔진이 바뀌면 여기를 고친다(AGENTS.md).
import { DEFAULT_DEPTHS } from '../prompt/blocks.js'
import { NOTE_LABEL } from '../prompt/note.js'
import { MEMORY_LABEL } from '../memory/defaults.js'
import { DIRECTIVE_MAX_CHARS } from '../scene/directive.js'

export const POST_HISTORY = 'post_history'

/**
 * 블록 종류별 설명. slot 은 엔진 기본 위치, trust 는 블록의 출처 표시, dynamic 은 시스템 프롬프트에 있어도
 * 캐시 접두를 거기서 끊는지다. 세 값은 테스트가 엔진과 맞춰 본다.
 */
export const BLOCK_SPECS = Object.freeze({
  instruction: { slot: 'system', trust: 'engine', dynamic: false, input: '`instruction`', when: '문구가 있을 때', about: '작품·서비스 공통 지시문. 조건 문장·매크로와 `{{char}}`·`{{user}}` 를 펼친다.' },
  long_description: { slot: 'system', trust: 'curated', dynamic: false, input: '`longDescription`', when: '문구가 있을 때', about: '작품의 긴 소개. 지시문과 따로 두어 편집기에서 위치를 따로 정할 수 있다. 조건 문장·매크로를 펼친다.' },
  rating: { slot: 'system', trust: 'engine', dynamic: false, input: '`rating` — all · teen · adult', when: '항상 (생략하면 all, `manifest.scene.ratingDefaulted` 로 남긴다)', about: '묘사 수위 문장. 시스템 프롬프트에만 둔다 — 매 턴 사용자 메시지 끝에 붙이면 모델이 유저의 묘사 요구로 읽어 정당한 장면도 거부했다(gpt-4o 실측 3/10).' },
  pacing: { slot: 'system', trust: 'engine', dynamic: false, input: '`pacing` — slow · normal · eventful', when: 'normal 이 아닐 때 (normal 은 아무 문장도 넣지 않는다)', about: '응답의 호흡. 기본값이 프롬프트를 늘리지 않게 normal 은 비워 둔다.' },
  character: { slot: 'system', trust: 'curated', dynamic: false, input: '`cards[]` 의 각 카드 (첫 장이 `{{char}}`)', when: '카드마다 하나', about: '`[캐릭터]` 이름과 설명. 설명에 description · 성격(personality) · 상황(scenario) · 행동 기준(behavior) · 예시 대화(mes_example)를 잇는다. 이름에는 매크로를 돌리지 않는다 — 화자 이름이 턴마다 바뀌면 안 된다.' },
  cast: { slot: 'system', trust: 'curated', dynamic: false, input: '카드 이름 목록', when: '카드가 2장 이상', about: '장면에 있는 인물 수와 이름. 한 응답에서 여러 인물이 번갈아 말해도 되고, 모든 대사 줄에 화자를 밝힌다는 규칙을 함께 준다.' },
  player: { slot: 'system', trust: 'curated', dynamic: false, input: '`player` 카드', when: '플레이어 카드가 있을 때', about: '유저가 연기하는 인물. `{{user}}` 이름을 정한다(`usesSessionUserName` 이면 세션 이름).' },
  context: { slot: 'system', trust: 'curated', dynamic: true, input: '기억 프리셋이 고른 노트 (요약 · 줄거리 등)', when: '기억 층이 노트를 낼 때 (예: memory-books)', about: `\`${MEMORY_LABEL}\` 머리 아래 노트. 실제 종류는 \`context_summary\` 처럼 나뉘고, 설정의 context 문구는 모든 \`context_*\` 블록에 적용된다.` },
  worldbook: { slot: 'system', trust: 'curated', dynamic: true, input: '`worldbooks[]` 중 이번 턴에 발동한 항목', when: 'always 이거나, 키워드가 최근 6개 메시지에 보일 때', about: '항목의 `depth`(없으면 `worldbookDepth`)가 있으면 대화 안 그 자리에, 없으면 시스템 프롬프트에 들어간다.' },
  user_boundary: { slot: 'system', trust: 'engine', dynamic: false, input: '유저 호칭 (플레이어 카드 · `userName`)', when: '항상', about: '유저 호칭과 "유저의 행동과 대사를 대신 쓰지 않는다".' },
  output_contract: { slot: 'system', trust: 'engine', dynamic: false, input: '방언(`dialect`)의 규약', when: '항상 (`enforceFormat: false` 면 빠진다 — 프롬프트 설정과는 함께 쓸 수 없다)', about: '응답 대본 문법. 응답 파서와 짝이라 문법은 엔진이 소유한다. 문구는 `{{content}}` 를 정확히 한 번 넣어야 하고, 시스템 프롬프트 밖으로 옮길 수 없다.' },
  memory: { slot: { depth: DEFAULT_DEPTHS.memory }, trust: 'curated', dynamic: true, input: '`memoryNotes[]` (호스트가 고른 요약 노트)', when: '노트가 있을 때', about: `최근 대화 근처에 두는 \`${MEMORY_LABEL}\`. 모델이 쓴 문장이 섞이므로 매크로를 돌리지 않는다.` },
  scene_state: { slot: { depth: DEFAULT_DEPTHS.scene_state }, trust: 'engine', dynamic: true, input: '`sceneState` · `indicatorDefs`', when: '장면 상태가 있을 때', about: '장소 · 시간 · 긴장, 인물별 몸 상태 · 감정 · 태도, 미해결 실마리, 지표를 산문으로 렌더한다.' },
  event: { slot: { depth: DEFAULT_DEPTHS.event }, trust: 'engine', dynamic: true, input: '`events[]` (호스트가 넣는 히든 사건)', when: '사건마다 하나', about: '`[사건]` 머리. 이번 입력 바로 앞에 놓인다.' },
  directive: { slot: POST_HISTORY, trust: 'engine', dynamic: true, input: '이번 입력의 행동 분석 · 장면 상태 유무 · `continuing`', when: '매 턴', about: `\`[${NOTE_LABEL}: …]\` 로 감싸 이번 사용자 메시지 끝에 붙인다. ${DIRECTIVE_MAX_CHARS}자 상한.` },
})
