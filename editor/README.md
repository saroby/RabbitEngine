# RabbitEngine 프롬프트 편집기

프롬프트 설정은 시스템 프롬프트 문서의 자유 문장과 태그, 엔진 블록의 문구·활성화·삽입 위치를 저장한다. 캐릭터별로 어떤 설정을 적용할지, 저장·인증·배포는 호스트 서비스가 담당한다. 편집기와 실제 대화는 같은 `buildTurn` / `compileBlocks` / `renderTurn`을 사용한다.

## 독립 실행

저장소 루트에서 `python3 -m http.server 3210 --bind 127.0.0.1`을 실행하고 `http://localhost:3210/editor/`를 연다. 빌드나 모델 키는 필요 없다. 여러 설정 생성·복제·삭제, JSON 가져오기·내보내기를 제공한다. **독립 페이지는 현재 브라우저 localStorage에만 저장**하며 서비스 캐릭터 설정을 바꾸지 않는다.

## Admin 등에 삽입

```js
import { mountPromptEditor, validatePromptProfile } from 'rabbit-engine/editor'

const editor = mountPromptEditor(container, {
  value: validatePromptProfile(savedProfile),
  onChange(profile) { draft = profile },
  onValidityChange(valid) { saveButton.disabled = !valid },
  // input: 실제 캐릭터·세계관·대화 등 buildTurn 입력 (선택)
  // customBlocks: 호스트가 관리하는 커스텀 블록 목록 [{ id, name, content }] (선택)
})
editor.setValue(newlySavedProfile) // 저장·다른 설정 선택 후 값 갱신
editor.setCustomBlocks(library)    // 호스트 커스텀 블록 목록 [{ id, name, content }] 갱신
editor.destroy()                  // 페이지 해제
```

모듈 import 시 DOM에 접근하지 않아 서버 렌더링 환경에서 안전하게 import할 수 있다. `mountPromptEditor`는 클라이언트에서 호출한다. 스타일은 마운트된 요소 내부에 제한된다. React, 외부 스타일시트, 네트워크 호출을 요구하지 않는다. 저장하지 못한 입력을 숨기지 않도록 호스트는 `onValidityChange`와 저장 버튼을 연결해야 한다.

## 설정 계약

`defaultPromptProfile()`은 `{version:1, blocks:[...]}`를 새 값으로 반환한다. `blocks`는 알려진 15개 종류를 각각 한 번 포함한다. 각 항목은 `{kind, enabled, template, slot}`이다. `validatePromptProfile(unknown)`은 엄격히 검사한 복사본을 반환하거나 오류를 던진다.

- `systemTemplate`은 선택적인 시스템 프롬프트 조립 문서다. 기존 설정에 이 필드가 없으면 종전의 블록 순서·위치로 조립한다. 편집기에서 문서를 수정하면 자유 문장과 `{{block:character}}` 같은 태그를 저장한다. 태그는 같은 종류당 한 번까지 사용할 수 있고 `{{block:output_contract}}`는 정확히 한 번 필요하다. `{{char}}`와 `{{user}}`는 이름을 넣는다.
- 블록의 자리는 한 곳에서만 정해진다: **활성인 시스템 위치 블록 ⇔ 문서에 태그가 있다.** `validatePromptProfile`은 어긋난 저장값을 정규화한다 — 대화 위치·비활성 블록의 태그는 지우고(조립과 같은 빈 문단 규칙), 태그 없는 시스템 블록은 비활성으로 둔다. 두 경우 모두 원래 아무것도 출력하지 않으므로 조립 결과는 바뀌지 않는다. 대화 중간이나 마지막 사용자 메시지 뒤에 놓인 블록은 대화 메시지에 들어간다. 태그가 가리키는 원본 데이터가 없으면 태그는 빈 내용으로 펼쳐진다.

- **커스텀 블록**: 호스트(예: admin)가 따로 관리하는 문구를 id로 참조한다. `blocks`에 `{kind:'custom', id, enabled, role, slot}`을 50개까지 섞을 수 있고, 시스템 문서에서는 `{{block:custom:<id>}}` 태그를 쓴다. 문구는 프로필에 저장하지 않고 `buildTurn({ customBlocks:[{id, content}] })`로 받으므로, 목록에서 문구를 고치면 그 블록을 참조하는 모든 설정에 반영된다. 참조한 id가 목록에 없으면 기억 선택 전에 오류를 낸다. `slot`은 `system`·`post_history`·`{depth}`이며 `default`는 없다. `role`은 대화 안에서 보낼 역할이다: `system`은 엔진 블록처럼 `midRole`(user)로, `user`·`assistant`는 그 역할 그대로 들어간다. 같은 depth 안에서 역할이 바뀌면 메시지를 나눈다. `assistant`는 `post_history`에 둘 수 없고, 렌더 결과의 마지막 메시지가 되면 `renderTurn`이 오류를 낸다 — 프리필은 공급자마다 거부하거나 다르게 다루기 때문이다. `{{user}}`·`{{char}}`만 치환한다. 편집기에서는 태그 버튼(주황색)으로 넣고, 대화 구역에서 메시지 역할을 고른다. 빼면 설정에서 항목이 사라지고 태그 버튼이 다시 켜진다. 배치한 커스텀 블록은 **교체** 선택 상자로 같은 자리·역할 그대로 다른 커스텀 블록으로 바꿀 수 있다(시스템 프롬프트에 넣은 것은 캡슐 아래 줄에서, 대화 안의 것은 항목에서). 같은 지시문의 여러 버전을 만들어 두고 바꿔 끼우는 용도다. 이미 설정에 들어 있는 블록으로는 바꿀 수 없다. 라이브러리 항목에 `defaultRole: 'user'|'assistant'`가 있으면 태그를 누를 때 시스템 프롬프트가 아니라 대화 안(마지막 사용자 메시지 바로 앞)에 그 역할로 들어간다. **대화 블록**은 `content` 대신 `messages: [{ role: 'user'|'assistant', content }]`(1~20개, 합계 20,000자)를 가진 항목이다. 메시지를 역할 그대로 순서대로 넣고 앞뒤 블록과 합치지 않으며, 대화 중간(depth)에만 둘 수 있다 — 시스템 프롬프트나 마지막 사용자 메시지 뒤에 두면 조립이 오류를 낸다. 편집기는 대화 블록을 시스템 프롬프트로 옮기거나 그 자리에 교체해 넣지 않는다.
- `template`: `{{content}}`는 해당 블록의 엔진 원문, `{{char}}`는 첫 캐릭터 이름, `{{user}}`는 사용자 이름이다. 치환은 한 번만 수행하며 삽입된 내용은 다시 템플릿으로 해석하지 않는다. 문구당 20,000자, 전체 80,000자 제한이다.
- `slot`: `default`는 로어북 개별 depth 등 엔진 원래 위치를 그대로 보존한다. `system`, `post_history`, `{depth:0..100}`으로 바꿀 수 있다. 서로 다른 슬롯 사이의 물리적 위치는 슬롯이 결정하고, 같은 위치에서는 설정 순서가 적용된다.
- 블록은 원본 데이터가 있을 때만 생성된다. `instruction`, `pacing`은 원본이 없어도 독립 문구를 작성할 수 있다. 이 조건으로 없는 장면이나 기억을 생성하지 않는다.
- `context`는 모든 `context_*` 블록에 적용된다. 캐릭터/사건/로어북 등 여러 원본 블록은 순서를 유지하며 각 원본에 문구가 적용된다.
- `output_contract`는 항상 활성화하며 `{{content}}`를 정확히 한 번 포함한다. 문법 자체는 응답 파서와 함께 엔진이 소유한다. 앞뒤 지시는 편집할 수 있다. 프롬프트 설정과 `enforceFormat:false`는 함께 사용할 수 없다.
- `world` 입력은 세계관을 엔진 지시문(instruction)과 분리한다. 설정을 생략하면 기존 동작은 그대로다. 기본 설정을 명시해도 블록 출력은 동일하다.
- 적용된 설정의 버전과 SHA-256은 `turn.manifest.prompt.profile`에 남는다. 이 해시는 설정 식별 증거이며 사용자 권한이나 서비스 저장 버전을 대신하지 않는다.

독립 페이지는 등록된 설정 목록에서 항목을 선택해 편집 화면으로 들어간다. 시스템 프롬프트는 여러 줄 편집 영역에 문장을 쓰고 태그 버튼으로 캡슐을 커서 위치에 넣는다. 캡슐은 드래그하거나 초점을 맞춘 뒤 Alt+←/→로 순서를 바꿀 수 있고, 캡슐 뒤에서 바로 문장을 이어 쓸 수 있다. 블록은 **시스템 프롬프트 / 대화 안에 넣기** 두 구역 중 한 곳에 있거나 삭제된 상태다. 구역 사이로 끌어 옮기거나 각 블록의 버튼(키보드 대안)으로 옮긴다. 캡슐의 Backspace/Delete와 대화 블록의 삭제 버튼은 블록을 뺀다. 삭제된 블록만 `+ 태그` 버튼이 켜지며, 누르면 시스템 프롬프트 커서 위치에, 끌면 놓은 구역에 다시 넣는다. 대화 구역은 실제 대화 순서로 자리별로 묶어 보여 주며, 다른 블록 위에 놓거나 손잡이에서 위/아래 화살표를 누르면 그 블록의 자리로 옮긴다. 출력 규약은 시스템 프롬프트 밖으로 옮길 수 없다. `태그별 문구`에서는 원문 포장만 편집한다. 편집 화면에서는 마지막 저장 상태로 되돌리거나 저장할 수 있다. 미리보기는 실제 `system`과 대화 메시지를 별도 영역에 표시하고, `{{content}}` 원문도 볼 수 있다. 기본 예시는 asteriskScript를 사용하며 호스트가 `input.dialect`를 주면 그 방언을 사용한다. 미리보기에는 LLM 능력을 전달하지 않으므로 LLM이 필요한 기억 프리셋은 오류를 표시한다.
