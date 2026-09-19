// 블록 + 이력 → 공급자에 넣을 { system, messages }. 위치 계산은 전부 여기서 한다.
// 공급자 SDK 형식(Anthropic content 배열 등)은 호스트가 이 결과를 다시 감싼다.

// system 슬롯 안에서도 매 턴 달라질 수 있는 블록. 로어북은 키워드로 발동하고
// context_* 는 기억 층이 고른 것이라, 이 블록부터 뒤는 캐시 접두가 될 수 없다.
const isDynamicSystem = (kind) => kind === 'worldbook' || String(kind ?? '').startsWith('context_')

/**
 * 블록과 이력을 공급자에 넣을 { system, messages } 로 편다.
 * @param {Array<{ kind: string, slot: string | { depth: number }, content: string }>} [blocks]
 * @param {Array<{ role: string, text: string }>} [messages]
 * @param {{ userInput?: string | null, midRole?: string, userFirst?: boolean, openingTurn?: string, mergeSameRole?: boolean }} [options]
 * @returns {{ system: string, messages: Array<{ role: string, text: string }>, cachePrefixLength: number, cachePrefixKinds: string[] }}
 */
export function renderTurn(blocks = [], messages = [], { userInput = null, midRole = 'user', userFirst = false, openingTurn = '*(이야기 시작)*', mergeSameRole = false } = {}) {
  const systemBlocks = blocks.filter((b) => b.slot === 'system')
  const system = systemBlocks.map((b) => b.content).join('\n\n')
  // 접두는 첫 동적 블록 앞까지다. 블록 순서는 그대로 두고 길이만 정직하게 센다 —
  // system.length 를 접두라고 하면 로어북이 하나 발동한 턴에 캐시가 통째로 깨진다.
  const cut = systemBlocks.findIndex((b) => isDynamicSystem(b.kind))
  const prefixBlocks = cut < 0 ? systemBlocks : systemBlocks.slice(0, cut)
  // join 이므로 마지막 블록 뒤의 구분자(\n\n)는 접두에 들어가지 않는다.
  const cachePrefixLength = prefixBlocks.map((b) => b.content).join('\n\n').length
  const base = messages.map((m) => ({ role: m.role, text: m.text }))
  if (userFirst && base[0]?.role === 'assistant') base.unshift({ role: 'user', text: openingTurn })
  if (typeof userInput === 'string') base.push({ role: 'user', text: userInput })

  // depth 별로 모아 한 메시지로. 큰 depth 부터 끼워야 앞서 끼운 것이 색인을 안 밀어낸다.
  const byDepth = new Map()
  for (const b of blocks) {
    if (typeof b.slot !== 'object' || b.slot === null) continue
    const depth = b.slot.depth
    // 상류(compileBlocks 의 worldbookDepth 등)가 depth 를 검증하지 않으므로 여기가 마지막
    // 방어선이다. 음수·비정수를 조용히 버리면 anchor 뒤로 삽입되거나 위치가 뒤틀린다.
    if (!Number.isInteger(depth) || depth < 0) throw new Error(`renderTurn: depth 는 0 이상의 정수여야 합니다 (${depth})`)
    if (!byDepth.has(depth)) byDepth.set(depth, [])
    byDepth.get(depth).push(b.content)
  }
  const out = base.slice()
  let anchor = typeof userInput === 'string' ? out.length - 1 : out.length
  // 이력이 depth 보다 짧아 index 0 으로 클램프되는 depth 가 둘 이상이면, floor 를 하나씩
  // 밀어 먼저 처리한(더 큰) depth 가 더 앞자리를 지키게 한다 — 안 그러면 나중 삽입이 항상
  // index 0 을 차지해 순서가 뒤집힌다.
  let floor = 0
  for (const depth of [...byDepth.keys()].sort((a, b) => b - a)) {
    const raw = anchor - depth
    const index = Math.max(floor, raw)
    out.splice(index, 0, { role: midRole, text: byDepth.get(depth).join('\n\n') })
    anchor += 1
    if (raw < floor) floor += 1
  }

  const post = blocks.filter((b) => b.slot === 'post_history').map((b) => b.content).join('\n\n')
  if (post) {
    if (typeof userInput === 'string') { const last = out.at(-1); last.text = last.text ? `${last.text}\n\n${post}` : post }
    else out.push({ role: midRole, text: post })
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
