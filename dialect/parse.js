// 대본 파서 엔진. 문법 자체는 방언이 소유한다 (dialect/korean-playscript.js).
// 여기는 "줄 단위로 규칙을 순서대로 대 본다" 는 기계일 뿐이고, 어떤 방언도 모른다.

// partial: 스트리밍 중에는 마지막 줄이 아직 오는 중이다. 연출을 거는 쪽은
// 완성된 줄만 봐야 반쪽 태그로 무대를 갈아끼우지 않는다.
/**
 * 방언으로 대본을 파싱한다.
 * @param {import('../types.js').ScriptDialect} dialect
 * @param {string} text 모델이 쓴 대본
 * @param {{ partial?: boolean }} [options] partial 이면 마지막 줄을 버린다 (스트리밍 중)
 * @returns {import('../types.js').ScriptSegment[]}
 */
export function parseWith(dialect, text, { partial = false } = {}) {
  const segments = []
  const lines = (text || '').split('\n')
  if (partial) lines.pop()

  let openBlock = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { openBlock = null; continue }

    if (openBlock) {
      const item = line.match(openBlock.item)
      if (item) { segments.push({ type: openBlock.kind, text: item[1].trim() }); continue }
      openBlock = null
    }

    const opened = (dialect.blocks || []).find((block) => block.open.test(line))
    if (opened) { openBlock = opened; continue }

    segments.push(applyRules(dialect.rules, line) || { type: dialect.fallback, text: line })
  }

  return segments
}

function applyRules(rules, line) {
  for (const rule of rules) {
    const m = line.match(rule.match)
    if (!m) continue
    // reject 는 오탐 가드다 — 매치했지만 이 규칙이 아닌 경우 다음 규칙으로 넘긴다.
    if (rule.reject && rule.reject.test(m[rule.speaker ?? rule.text])) continue
    // 키 순서를 type → speaker → text 로 지킨다. verifyDialect 가 직렬화해서
    // 비교하므로 순서가 흔들리면 같은 조각을 다르다고 본다.
    const segment = { type: rule.kind }
    if (rule.speaker) segment.speaker = m[rule.speaker].trim()
    segment.text = (m[rule.text] ?? '').trim()
    return segment
  }
  return null
}

export function choicesOf(segments) {
  return segments.filter((s) => s.type === 'choice').map((s) => s.text)
}

// 파서가 바뀌면 씬 경계가 달라진다 — 기억 산출물의 recipe 에 이 값이 들어가
// 옛 캐시를 재사용하지 않게 한다 (spec: 씬 경계 청킹).
export const SCRIPT_PARSER_VERSION = 'script-v1'
