// 블록 + 이력 → 공급자에 넣을 { system, messages }. 위치 계산은 전부 여기서 한다.
// 공급자 SDK 형식(Anthropic content 배열 등)은 호스트가 이 결과를 다시 감싼다.

// system 슬롯 안에서도 매 턴 달라질 수 있는 블록. 로어북은 키워드로 발동하고
// context_* 는 기억 층이 고른 것이라, 이 블록부터 뒤는 캐시 접두가 될 수 없다.
// 편집기로 system에 옮긴 기억·장면·사건·턴 지시도 같은 동적 경계를 지킨다.
const DYNAMIC_KINDS = new Set(['worldbook', 'memory', 'scene_state', 'event', 'directive'])
const isDynamicSystem = (kind) => DYNAMIC_KINDS.has(kind) || String(kind ?? '').startsWith('context_')

/** Keep legacy block spacing while allowing exact inline system documents. */
export function systemTextOf(blocks) {
  return blocks.map((block, index) => `${index ? block.separatorBefore ?? '\n\n' : ''}${block.content}`).join('')
}

/**
 * 블록과 이력을 공급자에 넣을 { system, messages } 로 편다.
 * @param {Array<{ kind: string, slot: string | { depth: number }, content: string }>} [blocks]
 * @param {Array<{ role: string, text: string }>} [messages]
 * @param {{ userInput?: string | null, midRole?: string, userFirst?: boolean, openingTurn?: string, mergeSameRole?: boolean }} [options]
 * @returns {{ system: string, messages: Array<{ role: string, text: string }>, cachePrefixLength: number, cachePrefixKinds: string[] }}
 */
import { NOTE_LABEL } from './note.js'
export { NOTE_LABEL }

export function renderTurn(blocks = [], messages = [], { userInput = null, midRole = 'user', userFirst = false, openingTurn = '*(이야기 시작)*', mergeSameRole = false } = {}) {
  const systemBlocks = blocks.filter((b) => b.slot === 'system')
  const system = systemTextOf(systemBlocks)
  // 접두는 첫 동적 블록 앞까지다. 블록 순서는 그대로 두고 길이만 정직하게 센다 —
  // system.length 를 접두라고 하면 로어북이 하나 발동한 턴에 캐시가 통째로 깨진다.
  const cut = systemBlocks.findIndex((b) => isDynamicSystem(b.kind))
  const prefixBlocks = cut < 0 ? systemBlocks : systemBlocks.slice(0, cut)
  // join 이므로 마지막 블록 뒤의 구분자(\n\n)는 접두에 들어가지 않는다.
  const cachePrefixLength = systemTextOf(prefixBlocks).length
  const base = messages.map((m) => ({ role: m.role, text: m.text }))
  if (userFirst && base[0]?.role === 'assistant') base.unshift({ role: 'user', text: openingTurn })
  if (typeof userInput === 'string') base.push({ role: 'user', text: userInput })

  // depth 별로 모아 한 메시지로. 큰 depth 부터 끼워야 앞서 끼운 것이 색인을 안 밀어낸다.
  // 엔진 블록은 midRole 로 가고, 호스트 커스텀 블록만 자기 역할(user·assistant)을 가진다 —
  // 같은 depth 안에서 역할이 바뀌는 곳마다 메시지를 나눈다.
  const byDepth = new Map()
  for (const b of blocks) {
    if (typeof b.slot !== 'object' || b.slot === null) continue
    const depth = b.slot.depth
    // 상류(compileBlocks 의 worldbookDepth 등)가 depth 를 검증하지 않으므로 여기가 마지막
    // 방어선이다. 음수·비정수를 조용히 버리면 anchor 뒤로 삽입되거나 위치가 뒤틀린다.
    if (!Number.isInteger(depth) || depth < 0) throw new Error(`renderTurn: depth 는 0 이상의 정수여야 합니다 (${depth})`)
    if (!byDepth.has(depth)) byDepth.set(depth, [])
    const group = byDepth.get(depth)
    // 대화 블록은 자기 메시지들을 역할 그대로 순서대로 넣고, 앞뒤 블록과 합치지 않는다 — 합치면 예시 대화의 턴 경계가 사라진다.
    if (b.kind === 'custom' && Array.isArray(b.messages)) {
      for (const message of b.messages) group.push({ role: message.role, text: message.content, sealed: true })
      continue
    }
    const role = b.kind === 'custom' && (b.role === 'user' || b.role === 'assistant') ? b.role : midRole
    const last = group.at(-1)
    if (last && !last.sealed && last.role === role) last.text += `\n\n${b.content}`
    else group.push({ role, text: b.content })
  }
  const out = base.slice()
  const inserted = new Set()
  let anchor = typeof userInput === 'string' ? out.length - 1 : out.length
  // 이력이 depth 보다 짧아 index 0 으로 클램프되는 depth 가 둘 이상이면, floor 를 밀어
  // 먼저 처리한(더 큰) depth 가 더 앞자리를 지키게 한다 — 안 그러면 나중 삽입이 항상
  // index 0 을 차지해 순서가 뒤집힌다.
  let floor = 0
  for (const depth of [...byDepth.keys()].sort((a, b) => b - a)) {
    const raw = anchor - depth
    const index = Math.max(floor, raw)
    const group = byDepth.get(depth).map(({ role, text }) => ({ role, text }))
    out.splice(index, 0, ...group)
    for (const message of group) inserted.add(message)
    anchor += group.length
    if (raw < floor) floor += group.length
  }

  // 유저 턴 끝에 맨몸으로 이어 붙이면 모델이 유저의 말로 인용한다("…라고 했지", 실측).
  // 대괄호 메모로 감싸고, 방언 spec 이 "대괄호 메모는 인용·언급하지 않는다" 를 지시한다.
  const post = blocks.filter((b) => b.slot === 'post_history').map((b) => b.content).join('\n\n')
  if (post) {
    const note = `[${NOTE_LABEL}: ${post}]`
    if (typeof userInput === 'string') { const last = out.at(-1); last.text = last.text ? `${last.text}\n\n${note}` : note }
    else out.push({ role: midRole, text: note })
  }
  // 끼운 assistant 가 마지막이면 공급자는 그것을 프리필로 받는다(거부하는 모델도 있다). 대화 중간에만 허용한다.
  if (out.at(-1)?.role === 'assistant' && inserted.has(out.at(-1))) {
    throw new Error('renderTurn: assistant 커스텀 블록은 마지막 메시지가 될 수 없습니다 (프리필 미지원)')
  }
  // 같은 역할이 연달아 나오는 것을 막는 공급자(Anthropic 등)가 있다. 기본값은
  // 그대로 두고 — 자리(depth)를 바꾸면 골든이 흔들린다 — 필요할 때만 켠다.
  const merged = mergeSameRole ? out.reduce((acc, message) => {
    const last = acc.at(-1)
    if (last && last.role === message.role) last.text = [last.text, message.text].filter(Boolean).join('\n\n')
    else acc.push({ ...message })
    return acc
  }, []) : out

  return { system, messages: merged, cachePrefixLength, cachePrefixKinds: prefixBlocks.map((b) => b.kind) }
}
