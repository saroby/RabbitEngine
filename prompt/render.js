// 블록 + 이력 → 공급자에 넣을 { system, messages }. 위치 계산은 전부 여기서 한다.
// 공급자 SDK 형식(Anthropic content 배열 등)은 호스트가 이 결과를 다시 감싼다.

export function renderTurn(blocks = [], messages = [], { userInput = null, midRole = 'user', userFirst = false, openingTurn = '*(이야기 시작)*' } = {}) {
  const system = blocks.filter((b) => b.slot === 'system').map((b) => b.content).join('\n\n')
  const base = messages.map((m) => ({ role: m.role, text: m.text }))
  if (userFirst && base[0]?.role === 'assistant') base.unshift({ role: 'user', text: openingTurn })
  if (typeof userInput === 'string') base.push({ role: 'user', text: userInput })

  // depth 별로 모아 한 메시지로. 큰 depth 부터 끼워야 앞서 끼운 것이 색인을 안 밀어낸다.
  const byDepth = new Map()
  for (const b of blocks) {
    if (typeof b.slot !== 'object' || !Number.isInteger(b.slot.depth)) continue
    const key = b.slot.depth
    if (!byDepth.has(key)) byDepth.set(key, [])
    byDepth.get(key).push(b.content)
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
  return { system, messages: out, cachePrefixLength: system.length }
}
