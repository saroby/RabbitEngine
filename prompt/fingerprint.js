// 렌더 결과의 앞부분 지문. 공급자의 접두 캐시는 앞에서부터 글자가 같은 만큼만 다시 쓴다 —
// 지난 턴과 이번 턴의 지문을 견주면 원문을 저장하지 않고도 얼마나 이어 쓰이는지 잴 수 있다.
// 창이 한 칸씩 밀리거나 접두 안 조건이 바뀌어 캐시가 깨지는지를 고치기 전에 숫자로 보는 자리다.
//
// 해시는 진단용(FNV-1a 32bit)이다. 보안 비교나 저장소 키로 쓰지 않는다.

export const FINGERPRINT_VERSION = 1

function fnv(text, seed = 0x811c9dc5) {
  let h = seed
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * render() 결과의 지문. 조각은 [system 캐시 접두, system 나머지, 메시지…] 순서이고, 각 hash 는
 * 그 조각까지의 앞부분 전체를 덮는다 — 앞이 하나라도 다르면 뒤의 hash 도 다 다르다. 원문은 담지 않는다.
 * @param {{ system: string, messages: Array<{ role: string, text: string }>, cachePrefixLength: number }} rendered
 * @returns {{ version: number, parts: Array<{ hash: string, length: number }> }}
 */
export function prefixFingerprint(rendered) {
  if (typeof rendered?.system !== 'string' || !Array.isArray(rendered.messages)) {
    throw new Error('prefixFingerprint: turn.render() 의 결과를 넣는다')
  }
  const cut = Number.isInteger(rendered.cachePrefixLength) ? rendered.cachePrefixLength : 0
  const pieces = [
    { key: rendered.system.slice(0, cut), length: cut },
    { key: rendered.system.slice(cut), length: rendered.system.length - cut },
    // 역할이 바뀌어도 공급자에게는 다른 요청이다. 길이는 본문 글자 수만 센다.
    ...rendered.messages.map((message) => ({ key: `${message.role}\u0000${message.text}`, length: message.text.length })),
  ]
  let h = 0x811c9dc5
  return {
    version: FINGERPRINT_VERSION,
    // 조각 사이 경계도 hash 에 넣어 "ab"+"c" 와 "a"+"bc" 를 가른다.
    parts: pieces.map(({ key, length }) => {
      h = fnv(`\u0001${key}`, h)
      return { hash: h.toString(16).padStart(8, '0'), length }
    }),
  }
}

/**
 * 두 지문의 공통 앞부분. chars 는 이번 요청 중 지난 요청과 앞에서부터 같은 글자 수로,
 * 공급자 캐시가 다시 쓸 수 있는 최대치다 — 실제 적중은 공급자의 캐시 단위 · 수명 · 도구 정의에 달렸다.
 * system 은 'same'(전부 같다) · 'prefix'(캐시 접두만 같다) · 'changed'(접두부터 다르다) 중 하나다.
 * @param {{ version: number, parts: Array<{ hash: string, length: number }> } | null} previous 지난 턴 지문. 첫 턴이면 null
 * @param {{ version: number, parts: Array<{ hash: string, length: number }> }} current
 * @returns {{ chars: number, totalChars: number, messages: number, system: 'same' | 'prefix' | 'changed' }}
 */
export function sharedPrefix(previous, current) {
  for (const fingerprint of previous ? [previous, current] : [current]) {
    if (fingerprint?.version !== FINGERPRINT_VERSION || !Array.isArray(fingerprint.parts)) {
      throw new Error(`sharedPrefix: 지문 version 이 ${FINGERPRINT_VERSION} 이 아닙니다 — 같은 엔진 버전의 prefixFingerprint 로 다시 만든다`)
    }
  }
  const before = previous?.parts ?? []
  let same = 0
  while (same < current.parts.length && same < before.length && before[same].hash === current.parts[same].hash) same += 1
  const sum = (parts) => parts.reduce((total, part) => total + part.length, 0)
  return {
    chars: sum(current.parts.slice(0, same)),
    totalChars: sum(current.parts),
    messages: Math.max(0, same - 2),
    system: same >= 2 ? 'same' : same === 1 ? 'prefix' : 'changed',
  }
}
