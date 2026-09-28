# RabbitEngine 프롬프트 편집기

프롬프트 설정은 엔진이 만든 블록의 문구·순서·활성화·삽입 위치를 바꾼다. 캐릭터별로 어떤 설정을 적용할지, 저장·인증·배포는 호스트 서비스가 담당한다. 편집기와 실제 대화는 같은 `buildTurn` / `compileBlocks` / `renderTurn`을 사용한다.

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
})
editor.setValue(newlySavedProfile) // 저장·다른 설정 선택 후 값 갱신
editor.destroy()                  // 페이지 해제
```

모듈 import 시 DOM에 접근하지 않아 서버 렌더링 환경에서 안전하게 import할 수 있다. `mountPromptEditor`는 클라이언트에서 호출한다. 스타일은 마운트된 요소 내부에 제한된다. React, 외부 스타일시트, 네트워크 호출을 요구하지 않는다. 저장하지 못한 입력을 숨기지 않도록 호스트는 `onValidityChange`와 저장 버튼을 연결해야 한다.

## 설정 계약

`defaultPromptProfile()`은 `{version:1, blocks:[...]}`를 새 값으로 반환한다. `blocks`는 알려진 15개 종류를 각각 한 번 포함한다. 각 항목은 `{kind, enabled, template, slot}`이다. `validatePromptProfile(unknown)`은 엄격히 검사한 복사본을 반환하거나 오류를 던진다.

- `template`: `{{content}}`는 해당 블록의 엔진 원문, `{{char}}`는 첫 캐릭터 이름, `{{user}}`는 사용자 이름이다. 치환은 한 번만 수행하며 삽입된 내용은 다시 템플릿으로 해석하지 않는다. 문구당 20,000자, 전체 80,000자 제한이다.
- `slot`: `default`는 로어북 개별 depth 등 엔진 원래 위치를 그대로 보존한다. `system`, `post_history`, `{depth:0..100}`으로 바꿀 수 있다. 서로 다른 슬롯 사이의 물리적 위치는 슬롯이 결정하고, 같은 위치에서는 설정 순서가 적용된다.
- 블록은 원본 데이터가 있을 때만 생성된다. `instruction`, `pacing`은 원본이 없어도 독립 문구를 작성할 수 있다. 이 조건으로 없는 장면이나 기억을 생성하지 않는다.
- `context`는 모든 `context_*` 블록에 적용된다. 캐릭터/사건/로어북 등 여러 원본 블록은 순서를 유지하며 각 원본에 문구가 적용된다.
- `output_contract`는 항상 활성화하며 `{{content}}`를 정확히 한 번 포함한다. 문법 자체는 응답 파서와 함께 엔진이 소유한다. 앞뒤 지시는 편집할 수 있다. 프롬프트 설정과 `enforceFormat:false`는 함께 사용할 수 없다.
- `world` 입력은 세계관을 공통 지시문과 분리한다. 설정을 생략하면 기존 동작은 그대로다. 기본 설정을 명시해도 블록 출력은 동일하다.
- 적용된 설정의 버전과 SHA-256은 `turn.manifest.prompt.profile`에 남는다. 이 해시는 설정 식별 증거이며 사용자 권한이나 서비스 저장 버전을 대신하지 않는다.

독립 페이지는 등록된 설정 목록에서 항목을 선택해 편집 화면으로 들어간다. 편집 화면에서는 마지막 저장 상태로 되돌리거나 저장할 수 있다. 미리보기는 실제 `system`과 대화 메시지를 별도 영역에 표시하고, `{{content}}` 원문도 볼 수 있다. 기본 예시는 asteriskScript를 사용하며 호스트가 `input.dialect`를 주면 그 방언을 사용한다. 미리보기에는 LLM 능력을 전달하지 않으므로 LLM이 필요한 기억 프리셋은 오류를 표시한다.
