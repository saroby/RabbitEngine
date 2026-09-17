# rabbit-engine

LLM 롤플레잉 대화 엔진 — 대본 문법 · 프롬프트 조립 · 기억 층. 모델은 부르지 않는다.

아직 만드는 중이다. 공개 API 는 `v0.1.0` 전까지 예고 없이 바뀐다.

## 한 턴의 흐름

엔진은 LLM 호출의 앞과 뒤에만 관여한다. 앞에서는 `buildTurn()` 이 요청을 만들고, 뒤에서는 방언이 모델이 쓴 대본을 조각으로 나눈다. 호출 자체는 당신의 코드가 한다.

```mermaid
flowchart TB
    IN["카드 · 플레이어 · 지시문<br>로어북 · 대화 이력"]

    subgraph E1["rabbit-engine · buildTurn()"]
        direction TB
        SM["selectMemory<br><i>기억 프리셋대로 이력을 고르고 접는다</i>"] --> CP["compilePrompt<br><i>지시문 · 카드 · 로어북 · 기억 · 대본 규약</i>"]
    end

    REQ["{ system, messages }"]
    MAN["manifest<br><i>무엇으로 만들었는지 값으로 동결</i>"]
    LLM["당신의 LLM 호출<br><b>엔진은 관여하지 않는다</b><br>OpenAI · Anthropic · 무엇이든"]
    SCR["모델이 쓴 대본<br>유리: 왔구나.<br>(문을 조용히 닫는다)"]

    subgraph E2["rabbit-engine"]
        PARSE["dialect.parse()"]
    end

    SEG["dialogue · 유리 · 왔구나.<br>action · 문을 조용히 닫는다"]
    UI["당신의 화면이 그린다"]
    ST["당신의 저장소"]

    IN --> SM
    CP --> REQ
    CP --> MAN
    REQ --> LLM --> SCR --> PARSE --> SEG --> UI
    MAN --> ST

    style E1 fill:#f5f0ff,stroke:#7c5cff,color:#1a1a1a
    style E2 fill:#f5f0ff,stroke:#7c5cff,color:#1a1a1a
    style LLM fill:#fff7e6,stroke:#d99100,color:#1a1a1a
```

## 기억 층

긴 이력은 고정된 청크로 잘라 닫힌 청크만 요약한다. 같은 재료로 만든 요약은 `recipeHash` 로 캐시에서 꺼내므로 LLM 을 다시 부르지 않고, 부른 호출은 전부 manifest 의 장부에 남는다. 요약에 쓰는 LLM 도 엔진이 직접 부르지 않는다 — 당신이 `ctx.llm` 으로 건넨 호출자를 쓴다.

```mermaid
flowchart TB
    H["대화 이력"] --> P["projection<br><i>실제 메시지만 남긴다</i>"]
    P --> C["chunking<br><i>20개마다 닫는다 · 씬 표지를 만나면 일찍 닫는다</i>"]
    C -->|"열린 청크 — 진행 중인 부분은 원문 그대로"| A
    C -->|"닫힌 청크 — 압축기가 있는 프리셋만"| R{"recipeHash<br>캐시에 있나?"}
    R -->|"있다 — LLM 을 부르지 않는다"| AR
    R -->|"없다"| K["scene 압축기"]
    K -->|"ctx.llm — 당신이 건넨 호출자"| AR[("ctx.artifacts · 요약")]
    K --> L["호출 장부<br><i>토큰 · ms</i>"]
    AR --> A["assemble<br><i>요약한 원문은 숨기고 · 자리와 예산을 정한다</i>"]
    A --> OUT["{ messages, notes }"]
    L --> MAN["manifest"]

    style R fill:#fff7e6,stroke:#d99100,color:#1a1a1a
    style L fill:#e6f7ef,stroke:#1a9e6a,color:#1a1a1a
```
