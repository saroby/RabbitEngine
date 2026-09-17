// 기억 빌드는 고정된 chunk 경계 위에서만 일어난다. 경계가 projection 의 순수
// 함수라서, 증분으로 만들든 통짜로 만들든 같은 chunk 집합이 나오고 같은
// recipeHash 를 조회한다 — 이것이 Chat 과 Study 가 갈리지 않는 유일한 근거다.
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { parserVersionOf } from '../dialect/define.js'

// 경계는 메시지 수가 정한다. 씬 표지는 있으면 경계를 그 지점으로 당겨 주는
// 보정이지 근거가 아니다 — 실측(2026-08-27)에서 씬 표지는 생성 턴 43개 중
// 1번(2.3%) 나왔고 가져온 자료에서는 0%였다. `by: 'scene'` 이라는 이름은
// 실제 동작을 잘못 말한다.
export const DEFAULT_CHUNK_POLICY = {
  by: 'messages',
  maxMessages: 20,
  sceneSnap: true,          // 씬 표지를 만나면 거기서 일찍 닫는다
  parserVersion: parserVersionOf(koreanPlayscript),
}

// 방언을 실은 정책. parserVersion 은 방언이 정한다 — 둘이 따로 놀면
// 문법은 바뀌었는데 캐시 키는 그대로인 상태가 된다.
export function policyWith(dialect, over = {}) {
  return { ...DEFAULT_CHUNK_POLICY, ...over, dialect, parserVersion: parserVersionOf(dialect) }
}

// 해시와 manifest 에 들어가는 모양. 방언 객체는 정규식과 함수를 들고 있어
// 직렬화하면 같은 문법도 다른 해시가 된다. 밖으로 나가는 것은 문자열 하나다.
export function hashablePolicyOf(policy) {
  const { dialect: _dialect, ...rest } = policy
  return rest
}

// 메시지 중간에서 자르지 않는다 — 자르면 user/assistant 교대가 깨져
// 일부 제공사가 요청 자체를 거부한다. 표지가 몇 개든 경계는 그 메시지 뒤 하나.
const closesChunk = (dialect, text) =>
  dialect.parse(text).some((segment) => segment.type === 'scene')

export function chunkEntries(entries = [], texts = [], policy = DEFAULT_CHUNK_POLICY) {
  const maxMessages = Math.max(1, Number(policy.maxMessages) || DEFAULT_CHUNK_POLICY.maxMessages)
  const dialect = policy.dialect || koreanPlayscript
  const closed = []
  let current = []

  const seal = () => {
    closed.push({
      ordinal: closed.length,
      coversOrdinals: current.map((entry) => entry.ordinal),
      entries: current,
    })
    current = []
  }

  for (let index = 0; index < entries.length; index += 1) {
    current.push(entries[index])
    // 옛 정책 이름 'scene' 도 받는다 — 저장된 세션과 과거 Study 가 들고 있다.
    const snap = policy.sceneSnap ?? policy.by === 'scene'
    if ((snap && closesChunk(dialect, texts[index])) || current.length >= maxMessages) seal()
  }

  return {
    closed,
    open: current.length
      ? { ordinal: closed.length, coversOrdinals: current.map((e) => e.ordinal), entries: current }
      : null,
  }
}

// 창 크기 검사. 무조건 거는 규칙이 아니다 — 실측으로 좁혔다 (2026-08-27).
//
//   protect              : 숨김이 언제나 요약이 덮는 범위의 부분집합이라 구멍이 없다
//   cut + 압축기 없음      : 옛 메시지를 버리는 것이 그 기법 자체다 (legacy-window 와 같다)
//   cut + 압축기 있음      : 여기서만 필요하다. 닫힌 chunk 는 요약이 덮지만 열린 chunk 는
//                          덮지 않으므로, 열린 chunk 가 창 밖으로 밀리면 그 내용은
//                          압축되지도 남지도 않고 조용히 사라진다
//
// 열린 chunk 의 최대 길이는 maxMessages - 1 이다 (maxMessages 에 닿으면 봉인되므로).
// 창이 그만큼이면 열린 chunk 가 통째로 창 안에 들어온다.
export function assertWindowInvariant(assembly = {}, policy = DEFAULT_CHUNK_POLICY, { hasCompactor = false } = {}) {
  if (!hasCompactor) return
  if (assembly.windowMode !== 'cut') return
  const windowSize = Number(assembly.windowSize)
  const maxMessages = Number(policy.maxMessages) || DEFAULT_CHUNK_POLICY.maxMessages
  const floor = maxMessages - 1
  if (!Number.isFinite(windowSize) || windowSize < floor) {
    throw new Error(
      `windowSize(${assembly.windowSize}) 가 너무 작습니다. 압축기를 쓰면서 windowMode 가 'cut' 이면 `
      + `열린 chunk(최대 ${floor}개)가 창 안에 들어와야 합니다 — 아니면 압축도 안 되고 남지도 않는 메시지가 생깁니다.`,
    )
  }
}
