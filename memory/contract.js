// 부품이 지켜야 하는 것은 둘이다. 입력이 자기 chunk(또는 명시된 자식)뿐일 것,
// 그리고 자기가 쓴 LLM 호출을 전부 보고할 것. 앞의 것이 없으면 증분과 통짜가
// 갈리고, 뒤의 것이 없으면 "요약 프리셋이 더 좋다"는 결론이 숨은 호출을
// 공짜로 친 결과가 된다.
export const PART_KINDS = ['compactor', 'reducer', 'retriever', 'tracker']

// prior 를 코드 검사로 막지 않는다. 함수 본문을 정규식으로 훑으면 주석과
// 문자열에 오탐하고, 전역 상태 접근은 못 잡는다 — 순수성 검증 장치가 아니다.
// 대신 selectMemory 가 허용된 인자만 넘기고(구조적 강제), 증분 = 통짜 회귀
// 테스트가 실제 동일성을 증명한다.
const ENTRY_OF = { compactor: 'build', reducer: 'buildParent', retriever: 'retrieve', tracker: 'extract' }

export const CALL_FIELDS = [
  'provider', 'model', 'partId', 'purpose',
  'promptTokens', 'completionTokens', 'ms', 'outcome', 'cacheHit',
]

/**
 * 기억 부품을 정의한다. kind 에 맞는 진입 함수가 있는지 검사하고 얼려서 돌려준다.
 * @param {{ partId: string, partVersion: number, kind: 'compactor' | 'reducer' | 'retriever' | 'tracker' } & Record<string, unknown>} spec
 * @returns {Readonly<object>}
 */
export function definePart(spec) {
  if (!spec.partId) throw new Error('부품에 partId 가 없습니다')
  if (!PART_KINDS.includes(spec.kind)) throw new Error(`알 수 없는 부품 kind: ${spec.kind}`)
  if (!Number.isInteger(spec.partVersion)) throw new Error(`${spec.partId}: partVersion 은 정수여야 합니다`)

  const entry = ENTRY_OF[spec.kind]
  if (typeof spec[entry] !== 'function') throw new Error(`${spec.partId}: ${spec.kind} 는 ${entry}() 가 필요합니다`)

  if (spec.kind === 'tracker' && typeof spec.reduce !== 'function') {
    throw new Error(`${spec.partId}: tracker 는 순수 함수 reduce() 가 필요합니다`)
  }
  return Object.freeze({ ...spec })
}

// 등록 시 검사는 실행 중 누락을 못 막는다. 결과가 돌아올 때마다 본다.
// 필드 존재만 보면 undefined·NaN·음수 토큰·문자열 cacheHit 이 그대로 통과해
// 비용 집계가 조용히 거짓이 된다. 비교의 근거가 되는 숫자라 타입까지 본다.
const NUMERIC = ['promptTokens', 'completionTokens', 'ms']

// partId 를 넘기면 소유권까지 본다(부품이 자기 호출을 낼 때). null 이면 모양만
// 본다 — prebuild 처럼 여러 부품의 호출을 모으는 자리는 소유권을 강제할 수 없다.
export function validateCalls(calls, partId) {
  const label = partId || 'calls'
  if (!Array.isArray(calls)) throw new Error(`${label}: calls 를 배열로 보고해야 합니다`)
  for (const call of calls) {
    for (const field of CALL_FIELDS) {
      if (!Object.hasOwn(call, field)) throw new Error(`${label}: calls 에 ${field} 가 없습니다`)
    }
    for (const field of NUMERIC) {
      const value = call[field]
      // 토큰은 개수라 정수여야 한다. ms 는 소수를 허용한다.
      const ok = field === 'ms' ? Number.isFinite(value) : Number.isInteger(value)
      if (!ok || value < 0) {
        throw new Error(`${label}: calls.${field} 는 0 이상의 ${field === 'ms' ? '유한한 수' : '정수'}여야 합니다 (받은 값: ${value})`)
      }
    }
    for (const field of ['provider', 'model', 'outcome', 'purpose']) {
      if (typeof call[field] !== 'string' || !call[field]) {
        throw new Error(`${label}: calls.${field} 는 비어 있지 않은 문자열이어야 합니다 (받은 값: ${call[field]})`)
      }
    }
    if (typeof call.cacheHit !== 'boolean') throw new Error(`${label}: calls.cacheHit 은 boolean 이어야 합니다`)
    if (partId && call.partId !== partId) throw new Error(`${label}: calls.partId 가 다릅니다 (${call.partId})`)
  }
  return calls
}
