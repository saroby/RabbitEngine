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
 * 저장소가 동기든 비동기든 받는다 — 엔진이 await 한다.
 * @property {(key: { scope: string, scopeId: string, recipeHash: string }) => (object | null | Promise<object | null>)} find
 * @property {(record: object) => (object | Promise<object>)} put id 와 contentHash 를 붙여 돌려준다
 */

/**
 * 엔진이 밖에서 받는 능력. 엔진은 네트워크도 저장소도 직접 만지지 않는다.
 * @typedef {object} EngineContext
 * @property {(request: object) => Promise<object>} [llm] 기억 부품이 쓸 LLM 호출자. 없으면 LLM 부품이 있는 프리셋을 쓸 수 없다
 * @property {(request: { texts: string[], model?: string, provider?: string }) => Promise<{ vectors: number[][], provider?: string, model?: string, usage?: { input?: number }, latencyMs?: number }>} [embed] 임베딩 호출자. embedding 검색기를 쓰는 프리셋(semantic · semantic-books)에 필요하다. vectors 는 texts 와 같은 길이·순서
 * @property {ArtifactStore} [artifacts] 산출물 캐시. 없으면 매번 새로 만든다
 * @property {string} [scope] 캐시 범위의 종류 (예: 'session')
 * @property {string} [scopeId] 캐시 범위의 식별자
 * @property {boolean} [buildIfMissing] false 면 없는 산출물을 만들지 않는다 — 조용히 돈을 쓰지 않게 하는 자리
 */

/**
 * 프롬프트 조각 하나와 그것이 놓일 자리. system 한 문자열 대신 이 목록이 정본이다.
 * @typedef {object} Block
 * @property {string} kind instruction · rating · pacing · character · cast · player · context_* · worldbook · user_boundary · output_contract · memory · scene_state · event · directive
 * @property {string} role 공급자에 넣을 역할. 지금은 모두 'system'
 * @property {'system' | 'post_history' | { depth: number }} slot 놓일 자리. depth N 은 이력 끝에서 N 번째 앞
 * @property {'engine' | 'curated' | 'external'} trust 문장의 출처. engine 은 엔진이 쓴 것,
 * curated 는 사람이 쓴 카드·로어북·기억, external 은 검증되지 않은 바깥 텍스트다.
 * 지금 compileBlocks 는 external 을 내지 않는다 — 호스트가 그런 블록을 붙일 때를 위한 자리다
 * @property {string} content
 * @property {string} [sourceId] 카드·로어북 원본 식별자
 * @property {string} [revisionId]
 * @property {string} [contract] output_contract 층의 파서 버전
 * @property {string} [strategy] worldbook 층의 주입 전략
 */

/**
 * 장면 상태. 저장·복원은 호스트 몫이고 엔진은 값만 다룬다.
 * @typedef {object} SceneState
 * @property {number} version
 * @property {number} revision 적용 횟수. 낡은 추출 결과를 거르는 데 쓴다
 * @property {string | null} place
 * @property {string | null} time
 * @property {string} tension calm · playful · tense · hostile · intimate · grief
 * @property {Record<string, { body: string[], emotion: string, toward: Record<string, string> }>} characters
 * @property {string[]} threads 미해결 갈래
 * @property {Record<string, number | string | boolean>} indicators
 * @property {{ messageId: string } | null} updatedAt
 */

/**
 * 호스트가 정의하는 지표. 호감도·체력처럼 작품마다 다른 수치를 스키마로 못박는다.
 * @typedef {object} IndicatorDef
 * @property {string} key
 * @property {'number' | 'string' | 'boolean'} type
 * @property {number | string | boolean} initial type 과 같은 종류여야 한다
 * @property {string} [label] 프롬프트에 쓸 이름. 없으면 key
 * @property {boolean} [inferred] false 면 추출기가 바꿀 수 없다. 기본 true
 * @property {boolean} [visible] 기본 true
 * @property {number} [min] type 이 number 일 때의 하한
 * @property {number} [max] type 이 number 일 때의 상한
 */

/**
 * 묘사 수위. 누가 어떤 등급을 볼 수 있는지는 호스트가 정한다.
 * @typedef {'all' | 'teen' | 'adult'} Rating
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
 * @property {boolean} [enforceFormat] false 면 대본 규약 층을 넣지 않는다. 기본 true
 * @property {string} [userName] {{user}} 에 들어갈 이름
 * @property {Rating} [rating] 묘사 수위. 기본 'all'
 * @property {SceneState | null} [sceneState] 있으면 depth 슬롯 블록으로 들어간다
 * @property {IndicatorDef[]} [indicatorDefs] 지표 정의. sceneState 의 indicators 를 사람이 읽는 줄로 만든다
 * @property {string | null} [userInput] 이번 턴의 사용자 입력. messages 에는 넣지 않고 render 가 마지막 user 로 붙인다.
 * 기억 선택과 로어북 스캔에는 보이므로, 창 기반 프리셋에서는 창 크기를 1 늘려 이번 턴 입력이 이력 한 칸을 밀어내지 않게 한다
 * @property {Array<{ kind: string, text: string }>} [memoryNotes] 호스트가 고른 기억 노트. depth 슬롯으로 들어간다
 * @property {string[]} [events] 이번 턴에 일어난 사건. 이력 끝(depth 0)에 붙는다
 * @property {'slow' | 'normal' | 'eventful'} [pacing] 응답의 호흡. 기본 'normal'
 * @property {boolean} [continuing] 이어쓰기면 true — 사용자 행동 지시를 디렉티브에 넣지 않는다
 * @property {number | null} [worldbookDepth] 정수면 로어북을 system 이 아니라 그 depth 에 둔다
 */

/**
 * buildTurn 의 출력. system 과 messages 를 당신의 LLM 호출에 그대로 넣는다.
 * @typedef {object} Turn
 * @property {string} system system 슬롯 블록만 이어 붙인 하위 호환 문자열
 * @property {Block[]} blocks 위치를 가진 전체 블록 목록. render 의 입력이다
 * @property {Array<{ role: string, text: string }>} messages
 * @property {string} directive 이력 뒤에 붙는 짧은 지시
 * @property {(options?: { midRole?: string, userFirst?: boolean, openingTurn?: string, userInput?: string | null }) => { system: string, messages: Array<{ role: string, text: string }>, cachePrefixLength: number }} render 블록과 이력을 공급자에 넣을 모양으로 편다
 * @property {object} manifest 이 턴을 무엇으로 만들었는지. ID 가 아니라 값으로 동결돼 있다
 */

export {}
