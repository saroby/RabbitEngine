// recipeHash 는 determinism 이 아니라 memoization 이다. LLM 요약은 다시 부르면
// 다른 결과를 내지만, 같은 재료면 다시 부르지 않는다는 규칙이 비결정론적
// 부품 위에서 재현 가능한 실험을 성립시킨다.
import { sha256Hex } from '../sha256.js'

// JSON.stringify 는 키 순서와 undefined 생략 때문에 의미가 같은 config 에
// 다른 문자열을 준다. 정렬해서 직렬화해야 해시가 재료를 가리킨다.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

export function recipeHashOf(input) {
  return sha256Hex(canonical(input)).slice(0, 32)
}

// 같은 재료를 동시에 빌드하면 LLM 을 두 번 사고 last-write-wins 가 난다.
const inflight = new Map()

export function withLock(key, fn) {
  if (inflight.has(key)) return inflight.get(key)
  const promise = Promise.resolve().then(fn).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
