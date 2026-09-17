// 희곡 형식 대본 파서 — server/prompt.js 의 SCRIPT_FORMAT 과 짝 (ssot: ScriptSegment)
// 종류: dialogue(대사) · action(지문) · narration(나레이션) · inner(속마음) · scene(장면 전환) · choice(선택지) · stage(연출)

// completeLinesOnly: 스트리밍 중에는 마지막 줄이 아직 오는 중이다.
// 연출을 거는 쪽은 완성된 줄만 봐야 반쪽 태그로 무대를 갈아끼우지 않는다.
export function parseScript(text, { completeLinesOnly = false } = {}) {
  const segments = []
  let choiceMode = false
  const lines = (text || '').split('\n')
  if (completeLinesOnly) lines.pop()
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { choiceMode = false; continue }

    if (choiceMode) {
      const m = line.match(/^(?:[-*•]|\d+[.)])\s*(.+)$/)
      if (m) { segments.push({ type: 'choice', text: m[1].trim() }); continue }
      choiceMode = false
    }

    if (/^선택지\s*[::]?\s*$/.test(line)) { choiceMode = true; continue }

    let m
    // 연출은 장면 전환과 다른 조각이다 — 장면은 이야기의 마디이고, 연출은 무대 지시다.
    if ((m = line.match(/^\[\s*연출\s*[::]?\s*(.*?)\]$/))) {
      segments.push({ type: 'stage', text: m[1].trim() }); continue
    }
    if ((m = line.match(/^\[\s*장면\s*[::]?\s*(.*?)\]$/))) {
      segments.push({ type: 'scene', text: m[1].trim() }); continue
    }
    if (/^\(.*\)$/.test(line)) {
      segments.push({ type: 'action', text: line.slice(1, -1).trim() }); continue
    }
    if ((m = line.match(/^(.+?)\s*\(\s*속마음\s*\)\s*[::]\s*(.*)$/))) {
      segments.push({ type: 'inner', speaker: m[1].trim(), text: m[2].trim() }); continue
    }
    if ((m = line.match(/^속마음\s*[::]\s*(.*)$/))) {
      segments.push({ type: 'inner', text: m[1].trim() }); continue
    }
    if ((m = line.match(/^(?:나레이션|나레이터|Narration)\s*[::]\s*(.*)$/i))) {
      segments.push({ type: 'narration', text: m[1].trim() }); continue
    }
    // `이름: 대사` — 이름은 공백 포함 20자까지, URL 오탐 방지
    if ((m = line.match(/^([^::]{1,20}?)\s*[::]\s*(.+)$/)) && !/https?$/.test(m[1])) {
      segments.push({ type: 'dialogue', speaker: m[1].trim(), text: m[2].trim() }); continue
    }
    segments.push({ type: 'narration', text: line })
  }
  return segments
}

export function choicesOf(segments) {
  return segments.filter((s) => s.type === 'choice').map((s) => s.text)
}

// 파서가 바뀌면 씬 경계가 달라진다 — 기억 산출물의 recipe 에 이 값이 들어가
// 옛 캐시를 재사용하지 않게 한다 (spec: 씬 경계 청킹).
export const SCRIPT_PARSER_VERSION = 'script-v1'
