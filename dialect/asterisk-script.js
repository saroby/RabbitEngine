// ai-chat-lab 의 화면 형식. services/chat/src/llm/parser.ts 와 같은 규칙이다 —
// 이 파일이 정본이 되면 chat 쪽 parser 는 이 방언을 감싸기만 한다.
import { stripMeta } from '../prompt/note.js'
import { defineDialect } from './define.js'

export const ASTERISK_FORMAT = `[출력 형식 — 반드시 지킬 것]
- 대사: \`이름: 내용\` — 이름은 등장인물 중 하나. 한 번에 최대 3명까지만 말한다.
- 행동·배경: \`*묘사*\` 로만 이루어진 별도 줄. 지문을 대사 줄 안에 섞지 않는다.
- 이야기 내용만 출력한다. 규칙 설명, 답변 평가, 진행 요약을 덧붙이지 않는다.
- \`[진행 메모: …]\` 는 서술자의 기록이다. 이야기의 일부가 아니므로 인용·언급·답변하지 않고 그 형식의 줄을 새로 쓰지도 않는다. 등장인물은 그것을 모른다.`

const CHOICES_MARK = '[[CHOICES]]'
const LABEL = /^([^:*\n]{1,24}):\s*(.*)$/u
const STARRED = /^\*(.+?)\*$/u

function parseChoices(raw) {
  try {
    const list = JSON.parse(raw.trim())
    if (!Array.isArray(list)) return []
    return list
      .filter((item) => item && typeof item.text === 'string')
      .map((item) => ({ type: 'choice', text: item.text.trim(), title: typeof item.title === 'string' ? item.title.trim() : '' }))
  } catch { return [] }
}

function parseAsterisk(text, { partial = false, names = null } = {}) {
  const [body, choicesRaw] = String(text || '').split(CHOICES_MARK, 2)
  const lines = body.split('\n')
  if (partial && choicesRaw === undefined) lines.pop()
  const known = Array.isArray(names) ? new Set(names) : null
  const segments = []
  let speaker = null

  for (const raw of lines) {
    // 모델이 엔진 메모 형식을 흉내 낸 조각은 걷어낸다(prompt/note.js). 메모만 있던 줄은 사라지고,
    // "@: [진행 메모: …]"·"하윤: [진행 메모: …]" 처럼 접두에 붙인 것은 접두만 남아 아래에서 빈 조각이 된다.
    const trimmed = raw.trim()
    const line = stripMeta(trimmed)
    if (!line) continue
    const metaStripped = line !== trimmed
    if (line.startsWith('@:')) { segments.push({ type: 'narration', text: line.slice(2).trim() }); speaker = null; continue }
    const starred = STARRED.exec(line)
    if (starred) { segments.push({ type: 'action', text: starred[1].trim() }); speaker = null; continue }
    const labelled = LABEL.exec(line)
    if (labelled && (!known || known.has(labelled[1].trim()))) {
      speaker = labelled[1].trim()
      const text = (labelled[2] ?? '').trim()
      // 메모를 걷어내서 라벨만 남은 대사는 조각을 만들지 않는다. 원래부터 빈 라벨("하윤:" 뒤 개행)은
      // 이전 구현과 같이 빈 대사 조각이 되어 다음 줄이 그 화자에게 붙는다(chat 차등 테스트가 고정).
      if (text || !metaStripped) segments.push({ type: 'dialogue', speaker, text })
      continue
    }
    const last = segments.at(-1)
    if (speaker && last && last.type === 'dialogue' && last.speaker === speaker) { last.text = last.text ? `${last.text}\n${line}` : line; continue }
    segments.push({ type: 'narration', text: line })
    speaker = null
  }
  if (choicesRaw !== undefined && !partial) segments.push(...parseChoices(choicesRaw))
  return segments
}

const base = defineDialect({
  id: 'asterisk-script',
  version: 1,
  spec: ASTERISK_FORMAT,
  // 규칙 표는 문서용이다 — 실제 파싱은 화자 이어쓰기 때문에 parseAsterisk 가 한다.
  rules: [
    { kind: 'action', match: STARRED, text: 1 },
    { kind: 'narration', match: /^@:\s*(.*)$/u, text: 1 },
    { kind: 'dialogue', match: LABEL, speaker: 1, text: 2 },
  ],
  fallback: 'narration',
  examples: [
    { text: '유리: 왔구나.\n*문을 닫는다.*', segments: [
      { type: 'dialogue', speaker: '유리', text: '왔구나.' },
      { type: 'action', text: '문을 닫는다.' },
    ] },
    { text: '@: 비가 내린다.', segments: [{ type: 'narration', text: '비가 내린다.' }] },
  ],
})

export const asteriskScript = Object.freeze({ ...base, parse: parseAsterisk })
