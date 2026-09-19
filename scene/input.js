// 사용자 입력을 방언으로 파싱해 행동과 말을 가른다. 추가 모델 호출 없이 이번 턴부터
// "유저가 방금 행동했다" 를 디렉티브에 넣기 위한 결정론 층이다 (spec: B안).
export function analyzeUserInput(dialect, text, { names = null } = {}) {
  const raw = String(text || '')
  const segments = dialect.parse(raw, names ? { names } : undefined)
  const actions = segments.filter((s) => s.type === 'action').map((s) => s.text).filter(Boolean)
  const speech = segments.filter((s) => s.type === 'dialogue' || s.type === 'narration').map((s) => s.text).filter(Boolean)
  return { actions, speech, raw }
}
