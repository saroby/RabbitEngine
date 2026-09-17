// 공개 타입. 런타임 코드는 없다 — JSDoc typedef 만 있고, tsc 가 여기서
// 선언 파일을 뽑는다. 다른 파일은 import('./types.js').이름 으로 참조한다.

/**
 * 대본 한 조각. 모델 출력을 방언이 파싱한 결과이고, 화면 렌더링의 입력이다.
 * @typedef {object} ScriptSegment
 * @property {string} type 조각의 종류. 기본 방언은 dialogue · action · narration · inner · scene · choice · stage
 * @property {string} [speaker] 화자. 대사와 (화자가 있는) 속마음에만 있다
 * @property {string} text 본문
 */

/**
 * 한 줄을 조각 하나로 바꾸는 규칙. 위에서부터 첫 매치가 이긴다.
 * @typedef {object} DialectRule
 * @property {string} kind 만들 조각의 종류
 * @property {RegExp} match 줄 전체에 대는 정규식
 * @property {number} text 본문이 들어 있는 캡처 그룹 번호
 * @property {number} [speaker] 화자가 들어 있는 캡처 그룹 번호
 * @property {RegExp} [reject] 매치했지만 이 규칙이 아닌 경우를 거른다 (예: URL 오탐)
 */

/**
 * 상태를 갖는 블록. 여는 줄 뒤에 항목 줄이 이어진다 (예: `선택지:` 뒤의 목록).
 * @typedef {object} DialectBlock
 * @property {string} kind 항목마다 만들 조각의 종류
 * @property {RegExp} open 블록을 여는 줄
 * @property {RegExp} item 항목 한 줄. 캡처 1 이 본문
 */

/**
 * 출력 문법. 프롬프트에 넣을 규약 텍스트와 그걸 되읽는 규칙을 함께 소유한다.
 * @typedef {object} ScriptDialect
 * @property {string} id
 * @property {number} version 문법을 고치면 올린다. 기억 산출물 캐시의 키에 들어간다
 * @property {string} spec 프롬프트에 주입되는 출력 규약 텍스트
 * @property {DialectRule[]} rules
 * @property {DialectBlock[]} blocks
 * @property {string} fallback 어느 규칙에도 안 걸린 줄의 종류
 * @property {Array<{ text: string, segments: ScriptSegment[] }>} examples 규약과 규칙이 맞물린다는 실행 가능한 증거
 * @property {(text: string, options?: { partial?: boolean }) => ScriptSegment[]} parse
 */

/**
 * 기억 부품이 보고하는 LLM 호출 한 건. 비용 비교의 근거라 타입까지 검사한다.
 * @typedef {object} LlmCall
 * @property {string} provider
 * @property {string} model
 * @property {string} partId 호출한 부품
 * @property {string} purpose
 * @property {number} promptTokens 0 이상의 정수
 * @property {number} completionTokens 0 이상의 정수
 * @property {number} ms 0 이상의 유한한 수
 * @property {string} outcome
 * @property {boolean} cacheHit
 */

/**
 * 산출물 저장소. 소비자가 자기 저장소(JSON · SQLite · 무엇이든)를 이 모양으로 감싼다.
 * @typedef {object} ArtifactStore
 * @property {(key: { scope: string, scopeId: string, recipeHash: string }) => (object | null)} find
 * @property {(record: object) => object} put id 와 contentHash 를 붙여 돌려준다
 */

/**
 * 엔진이 밖에서 받는 능력. 엔진은 네트워크도 저장소도 직접 만지지 않는다.
 * @typedef {object} EngineContext
 * @property {(request: object) => Promise<object>} [llm] 기억 부품이 쓸 LLM 호출자. 없으면 LLM 부품이 있는 프리셋을 쓸 수 없다
 * @property {ArtifactStore} [artifacts] 산출물 캐시. 없으면 매번 새로 만든다
 * @property {string} [scope] 캐시 범위의 종류 (예: 'session')
 * @property {string} [scopeId] 캐시 범위의 식별자
 * @property {boolean} [buildIfMissing] false 면 없는 산출물을 만들지 않는다 — 조용히 돈을 쓰지 않게 하는 자리
 */

/**
 * buildTurn 의 입력.
 * @typedef {object} TurnInput
 * @property {ScriptDialect} [dialect] 출력 문법. 기본은 koreanPlayscript
 * @property {object[]} cards 등장 캐릭터 카드. 최소 하나
 * @property {object | null} [player] 플레이어 슬롯
 * @property {string} [instruction] 시스템 지시문
 * @property {object[]} [worldbooks] 로어북
 * @property {object} [worldbookOverrides]
 * @property {object} [worldbookOptions]
 * @property {Array<{ role: string, text: string }>} [messages] 대화 이력
 * @property {object} [memory] 기억 설정. `{ preset: 'memory-books' }` 처럼. 없으면 이력을 전부 보낸다
 * @property {string} [userName] {{user}} 에 들어갈 이름
 */

/**
 * buildTurn 의 출력. system 과 messages 를 당신의 LLM 호출에 그대로 넣는다.
 * @typedef {object} Turn
 * @property {string} system
 * @property {Array<{ role: string, text: string }>} messages
 * @property {object} manifest 이 턴을 무엇으로 만들었는지. ID 가 아니라 값으로 동결돼 있다
 */

export {}
