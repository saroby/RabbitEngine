# rabbit-engine

LLM 롤플레잉 대화 엔진 — 대본 문법 · 프롬프트 조립 · 기억 층. 모델은 부르지 않는다.

아직 만드는 중이다. 공개 API 는 `v0.1.0` 전까지 예고 없이 바뀐다.

## 한 턴의 흐름

엔진은 LLM 호출의 앞과 뒤에만 관여한다. 앞에서는 `buildTurn()` 이 요청을 만들고, 뒤에서는 방언이 모델이 쓴 대본을 조각으로 나눈다. 호출 자체는 당신의 코드가 한다.

```mermaid
flowchart TB
    IN["🧺 이야기 재료<br>주인공 카드 · 네가 한 말 · 놀이 규칙<br>세계 이야기책 · 지금까지 나눈 이야기"]

    subgraph E1["🐰 토끼가 편지를 준비해요 · buildTurn()"]
        direction TB
        SM["1️⃣ 기억 고르기<br><i>지난 이야기 중에 필요한 것만 골라서 접어요</i><br>selectMemory"] --> CP["2️⃣ 편지 쓰기<br><i>규칙 · 주인공 카드 · 이야기책 · 기억을<br>한 통의 편지로 모아요</i><br>compilePrompt"]
    end

    REQ["✉️ 완성된 편지<br>{ system, messages }"]
    MAN["📒 요리 기록장<br><i>편지에 무엇을 넣었는지 적어둬요</i><br>manifest"]
    LLM["🧠 똑똑한 친구에게 편지를 보내요<br><b>보내는 건 네가 해요 — 토끼는 안 해요!</b><br>OpenAI · Anthropic · 아무 친구나"]
    SCR["📜 친구가 써 준 대본<br>유리: 왔구나.<br>(문을 조용히 닫는다)"]

    subgraph E2["🐰 토끼가 대본을 잘라요"]
        PARSE["✂️ 말하는 부분과 행동하는 부분으로 나눠요<br>dialect.parse()"]
    end

    SEG["💬 말 · 유리 · 왔구나.<br>🏃 행동 · 문을 조용히 닫는다"]
    UI["🖥️ 네 화면에 그려요"]
    ST["🗄️ 네 서랍에 넣어 둬요"]

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
