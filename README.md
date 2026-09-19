# rabbit-engine

LLM 롤플레잉 대화 엔진 — 대본 문법 · 프롬프트 조립 · 기억 층. 모델은 부르지 않는다.

아직 만드는 중이다. 공개 API 는 `v0.1.0` 전까지 예고 없이 바뀐다.

## 한 턴의 흐름

엔진은 LLM 호출의 앞과 뒤에만 관여한다. 앞에서는 `buildTurn()` 이 위치가 있는 블록 목록(`{ blocks, messages, manifest }`)을 만들고, `render()`(=`renderTurn`)가 그걸 공급자에 넣을 `{ system, messages }` 로 펼친다. 뒤에서는 방언이 모델이 쓴 대본을 조각으로 나누고, 응답이 끝난 뒤 한 번 더 작은 모델을 불러 장면 상태를 갱신한다. 모델 호출 자체는 항상 당신의 코드가 한다.

```mermaid
flowchart TB
    subgraph HOST_IN["당신의 코드 — 입력 준비"]
        U["사용자 입력<br>*주먹으로 때린다* 뭘 봐"]
        DB[("당신의 저장소: messages · sceneState<br>memoryContext · lorebookState")]
        CAT["당신의 설정 저장소: 카드 · 로어북 · 등급 · 지표 정의"]
    end

    subgraph ENGINE["RabbitEngine — buildTurn()"]
        direction TB
        P1["1. 입력 파싱 (방언)<br>행동 세그먼트 / 대사 세그먼트"]
        P2["2. 기억 선택<br>프리셋 · recipeHash 캐시"]
        P3["3. 로어북 발동<br>만료 · FIFO · depth"]
        P4["4. 블록 조립<br>system / depth N / post_history"]
        P5["5. 디렉티브 조립<br>등급 조각 + 행동 반응 조각 + 일관성 조각"]
        P1 --> P5
        P2 --> P4
        P3 --> P4
        P5 --> P4
    end

    OUT["{ blocks, messages, manifest }"]
    R["renderTurn(blocks, messages)<br>system 병합 · depth 삽입 · post_history 부착<br>user-first · 캐시 지점"]
    LLM["본 응답 호출 (스트리밍)<br>당신의 코드가 부른다"]
    PARSE["응답 파싱 (방언)<br>이름: 대사 / *지문* → 세그먼트"]
    UI["화면 · 저장"]

    subgraph BG["백그라운드 (응답 뒤, 1회)"]
        X["추출 호출<br>요약 + 장면 상태 + 감정 + 지표"]
        S[("당신의 저장소 갱신: sceneState · room_memory")]
        X --> S
    end

    U --> P1
    DB --> P2
    DB --> P3
    CAT --> P4
    DB --> P4
    ENGINE --> OUT --> R --> LLM --> PARSE --> UI
    PARSE --> X
    S -. 다음 턴 .-> DB

    style ENGINE fill:#f5f0ff,stroke:#7c5cff,color:#1a1a1a
    style BG fill:#e6f7ef,stroke:#1a9e6a,color:#1a1a1a
    style LLM fill:#fff7e6,stroke:#d99100,color:#1a1a1a
```

프롬프트에 실리는 순서(기본 배치):

```mermaid
flowchart LR
    SYS["system (캐시 접두)<br>instruction · character · cast · player<br>worldbook(고정) · user_boundary · output_contract"]
    H1["이력 (오래된 쪽)"]
    M["depth 4 · memory<br>요약 노트"]
    W["depth N · worldbook<br>항목별 depth"]
    ST["depth 2 · scene_state<br>지금: 현관, 자정. 긴장: 적대적 …"]
    EV["depth 0 · event<br>히든 사건 (있을 때만)"]
    H2["최근 이력 · 사용자 입력"]
    D["post_history · directive<br>등급 + 행동 반응 + 일관성 (≤300자)"]
    SYS --> H1 --> M --> W --> ST --> EV --> H2 --> D
```

### buildTurn 입력

| 입력 | 의미 |
|---|---|
| `rating` | `'all' \| 'teen' \| 'adult'`. 묘사 수위 — instruction·directive 문구를 바꾼다 |
| `sceneState` | 장면 상태 객체(`scene/state.js`). 있으면 depth 2 에 산문으로 렌더돼 들어간다 |
| `indicatorDefs` | 작품별 지표 정의. `sceneState` 렌더와 추출 스키마 둘 다에 쓰인다 |
| `userInput` | 이번 턴 사용자 입력. 기억 선택·로어북 스캔엔 보이고, 행동/대사 분석과 디렉티브의 재료가 된다 |
| `memoryNotes` | 기억 층이 고른 요약 노트. depth 4 `memory` 블록으로 들어간다 |
| `events` | 당신의 코드가 넣는 히든 사건. depth 0 `event` 블록으로 들어간다 |
| `pacing` | `'slow' \| 'normal' \| 'eventful'`. instruction 블록 뒤에 별도 system 블록으로 붙는다 |
| `continuing` | `true` 면 디렉티브의 "행동 시도" 조각을 뺀다 (재생성 등, 이미 처리한 턴) |
| `worldbookDepth` | 로어북 항목이 발동했을 때 넣을 depth. 없으면 system 접두에 들어간다 |

### 사용 예

```js
import { buildTurn, asteriskScript, extractionRecipe, applyExtraction } from 'rabbit-engine'

const ctx = { artifacts: store, llm: yourSummaryLlm }                 // 기억 요약·추출에 쓸 호출자

const turn = await buildTurn(
  { cards, messages, rating: 'teen', sceneState, indicatorDefs, userInput, memoryNotes, dialect: asteriskScript },
  ctx,
)
const { system, messages: rendered } = turn.render({ userFirst: true })
const replyText = await callYourLLM({ system, messages: rendered })   // 호출은 당신이 한다

const segments = asteriskScript.parse(replyText)                      // 대사 / 행동 세그먼트
await saveToUI(segments)

const recipe = extractionRecipe({ state: sceneState, exchanges: [{ user: userInput, assistant: replyText }], names, indicatorDefs })
const raw = await ctx.llm(recipe)                                     // 작은 모델로 사실만 추출
const next = applyExtraction(sceneState, raw, { indicatorDefs, expectedRevision: sceneState.revision })
if (!next.stale) await saveSceneState(next.state)                     // CAS: revision 이 어긋나면 버린다
```

## 기억 층

긴 이력은 고정된 청크로 잘라 닫힌 청크만 요약한다. 같은 재료로 만든 요약은 `recipeHash` 로 캐시에서 꺼내므로 LLM 을 다시 부르지 않고, 부른 호출은 전부 manifest 의 장부에 남는다. 요약에 쓰는 LLM 도 엔진이 직접 부르지 않는다 — 당신이 `ctx.llm` 으로 건넨 호출자를 쓴다.

```mermaid
flowchart TB
    H["📚 지금까지 나눈 이야기 전부<br><i>엄청 길어요!</i>"] --> P["🧹 진짜 대화만 남겨요<br><i>낙서와 메모는 빼요</i><br>projection"]
    P --> C["📦 20장씩 상자에 담아요<br><i>장면이 바뀌면 거기서 상자를 닫아요</i><br>chunking"]
    C -->|"아직 안 닫힌 상자<br>지금 하는 이야기는 그대로 가져가요"| A
    C -->|"닫힌 상자<br>줄여 주는 담당이 있을 때만"| R{"🏷️ 이 상자, 전에<br>줄여 본 적 있나?<br>recipeHash"}
    R -->|"있다! 서랍에서 꺼내요<br>친구한테 다시 안 물어봐요"| AR
    R -->|"없다"| K["🧠 똑똑한 친구에게<br>짧게 줄여 달라고 해요<br>scene 압축기"]
    K -->|"전화기는 네가 빌려줘요<br>ctx.llm"| AR[("🗄️ 요약 쪽지 서랍<br>ctx.artifacts")]
    K --> L["📝 몇 번 물어봤는지 적어요<br><i>글자 수 · 걸린 시간</i><br>호출 장부"]
    AR --> A["🧩 다시 합쳐요<br><i>긴 원문은 숨기고 요약 쪽지를 붙여요<br>자리가 얼마나 남았는지도 재요</i><br>assemble"]
    A --> OUT["✉️ 편지에 넣을 이야기<br>{ messages, notes }"]
    L --> MAN["📒 요리 기록장<br>manifest"]

    style R fill:#fff7e6,stroke:#d99100,color:#1a1a1a
    style L fill:#e6f7ef,stroke:#1a9e6a,color:#1a1a1a
```

## 기억 프리셋

`buildTurn({ memory: { preset: '…' } })` 로 고른다. 없으면 `legacy-full`(이력 전부).

| 프리셋 | 압축 | 접기 | 검색 | 밖에서 받는 것 |
|---|---|---|---|---|
| `lorebook` | — | — | — | — |
| `vector` | — | — | 글자 bigram | — |
| `semantic` | — | — | 임베딩 코사인 | `ctx.embed` |
| `memory-books` | 닫힌 씬 → 요약 | — | — | `ctx.llm` |
| `memory-books-tiered` | 닫힌 씬 → 요약 | 오래된 요약 → 줄거리 | — | `ctx.llm` |
| `semantic-books` | 닫힌 씬 → 요약 | 오래된 요약 → 줄거리 | 요약 중 닿는 것만 | `ctx.llm` · `ctx.embed` |
| `legacy-*` | — | — | (`legacy-retrieval` 만 bigram) | — |

**접기(digest)** 는 이진 카운터처럼 돈다. 최근 `keepLeaves` 개 씬 요약은 그대로 두고, 그보다 오래된 것을 앞에서부터 `fanout` 개씩 묶어 줄거리 하나로 접는다. 줄거리가 `fanout` 개 모이면 또 접는다. 묶음 경계가 0번 씬부터 고정이라 새 씬이 닫혀도 이미 만든 줄거리의 재료는 안 바뀌고, 캐시 키는 자식 요약의 `contentHash` 목록이라 옛 대사를 고치면 그 조상만 다시 만든다.

**검색(embedding)** 은 창 안의 마지막 유저 발화를 질의로 삼는다. `semantic` 은 창 밖 원문을, `semantic-books` 는 요약 산출물을 후보로 본다 (줄거리는 점수와 무관하게 항상 넣는다 — `keepKinds`). 벡터는 산출물 저장소에 본문 해시로 캐시되므로 같은 대사를 두 번 임베딩하지 않는다.

```js
const turn = await buildTurn(
  { cards, messages, memory: { preset: 'semantic-books' } },
  {
    artifacts: store,                       // 요약·줄거리·벡터 캐시. 없으면 매 턴 새로 만든다
    scope: 'session', scopeId: sessionId,
    llm: async ({ system, messages, model, maxTokens }) => { /* 요약 모델 호출 */ },
    embed: async ({ texts, model }) => ({ vectors: /* texts 와 같은 길이 */ [], usage: { input: 0 } }),
  },
)
turn.manifest.memoryCalls          // 이 턴이 산 호출 전부 — purpose: 'compact' | 'reduce' | 'embed'
turn.manifest.retrievalScores      // 무엇을 왜 골랐는지
```

## 평가

`eval/README.md` 를 봐라. `eval/scenarios/*.json` 의 결정론 검사(블록·디렉티브·system 조립)는 `npm test` 에 포함된다. 실제 응답 품질은 `node scripts/eval-judge.js --variant full|no-directive|no-state` 로 수동 실행한다 — 모델 키(`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`)가 필요하고 `npm test` 에는 없다.
