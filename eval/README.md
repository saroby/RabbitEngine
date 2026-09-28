# eval — 도발 시나리오 평가셋

`eval/scenarios/*.json` 은 buildTurn 의 결정론 출력(블록·디렉티브·system)을 검사하는 시나리오다. `npm test` 가 `test/eval-scenarios.test.js` 로 이 파일들을 자동 검증한다 — 조립 로직이 맞는지만 본다.

실제 응답 품질(캐릭터가 도발에 그럴듯하게 반응하는지)은 결정론 테스트로 잡을 수 없다. `scripts/eval-judge.js` 가 각 시나리오를 실제 LLM 에 태우고, 같은 LLM 을 심사위원 삼아 `judge.rubric` 5항목을 0~2점으로 채점하고 `judge.stateDelta` 로 장면 추출 결과가 허용 범위 안인지 본다.

## 실행

```sh
OPENAI_API_KEY=sk-... node scripts/eval-judge.js --model gpt-4o
node scripts/eval-judge.js --provider anthropic --model claude-sonnet-5 --variant no-state
node scripts/eval-judge.js --model gpt-4o --baseline eval/results/2026-09-19-gpt-4o.json
```

**레포 루트에서 실행한다** — `--out` 과 기본 결과 경로(`eval/results/…`) 모두 실행 위치 기준으로 풀린다. 시나리오 하나가 끝날 때마다 결과 파일을 통째로 다시 쓰므로, 뒤에서 한 건이 터져도 앞에서 산 호출은 남는다. 심사 모델에는 캐릭터 카드·대화 이력·방언 규칙도 전달한다. 심사 JSON 은 모든 루브릭 키에 숫자 `0`·`1`·`2` 를 하나씩 포함해야 하며 추가 키는 허용하지 않는다. `forbidViolations` 는 필수 배열이고 지정한 금지 항목만 담을 수 있다.

잘못된 심사는 `scores: null` · `judgeError`, 파싱 실패·거부 항목·오래된 상태 추출은 `extractionError` 로 남긴다. 어느 쪽이든 실패하면 `total: null` · `stateMatch: false` 로 기록하고 평균에서 제외한다. 유효한 심사에서 상태 불일치나 금지 위반을 발견하면 점수는 보존하되 `stateMatch: false` 다. 하나라도 `stateMatch: false` 면 결과를 저장한 뒤 종료 코드 1 로 끝난다. API 오류도 비정상 종료하며 앞에서 저장한 결과는 남는다.

키가 없으면(`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`) 종료 코드 2 로 멈춘다. 실제 모델 평가는 수동 실행 전용이며 `npm test` 에는 외부 호출을 대체한 CLI 회귀 검사만 포함한다. `--variant full|no-directive|no-state` 는 post_history(디렉티브) 또는 scene_state 블록을 빼고 렌더해 절제 실험을 한다. 결과는 `eval/results/`(git 밖)에 JSON 으로 남는다.

## 시나리오 형식

```json
{ "id": "violence-punch", "rating": "adult", "dialect": "asterisk-script",
  "cards": [{ "name": "유리", "description": "…", "behavior": "선택: 행동 기준" }],
  "indicatorDefs": [], "sceneState": null,
  "history": [{ "role": "assistant", "text": "…" }],
  "userInput": "*주먹으로 때린다*\n뭘 봐",
  "expect": { "directiveIncludes": [], "directiveExcludes": [], "systemIncludes": [], "blocks": { "scene_state": false } },
  "judge": { "stateDelta": { "tension": ["hostile", "tense"], "bodyAddAny": { "유리": ["멍|뺨|아픔"] }, "forbid": [] }, "rubric": ["…5항목"] } }
```

`stateDelta.forbid` 는 심사 프롬프트에 금지 항목으로 들어가고, 심사 모델이 `forbidViolations` 로 돌려준 것이 결과에 남는다 — 하나라도 있으면 루브릭 점수와 무관하게 `stateMatch` 가 false 다. 빈 배열은 위반 없음이며 배열 누락은 심사 실패다.

`stateDelta.tension` 은 허용 목록이고 `bodyAddAny` 는 이름별 정규식 중 하나라도 맞으면 통과다 — 단일 정답이 아니라 허용 결과와 금지 모순을 평가한다. `sceneState` 가 있으면 `scene/state.js` 의 전체 스키마(`version`·`revision`·`characters` 등)를 채운다.
