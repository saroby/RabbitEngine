// 프롬프트의 순수 부품. compiler를 참조하지 않아 prompt.js ↔ compiler 순환 의존을 막는다.

// 희곡 형식 출력 규약 — 클라이언트 parser.js 와 짝을 이룬다 (ssot: 모델 출력 ≠ 화면 표현)
export const SCRIPT_FORMAT = `[출력 형식 — 반드시 지킬 것]
연극 대본 형식으로만 응답한다. 마크다운 헤딩·코드블록을 쓰지 않는다.
- 대사: \`캐릭터명: 대사 내용\` — 한 줄에 하나
- 행동·지문: 괄호로만 이루어진 줄 \`(문을 조용히 연다)\`
- 나레이션·장면 서술: \`나레이션: 서술 내용\`
- 캐릭터 속마음: \`캐릭터명 (속마음): 내용\` 또는 \`속마음: 내용\`
- 장면 전환(시간·장소가 바뀔 때): \`[장면: 새 장소와 시간]\`
- 유저에게 선택지를 제안할 때는 응답 맨 끝에:
선택지:
- 첫 번째 선택지
- 두 번째 선택지`

const SUBST = /\{\{\s*(char|user)\s*\}\}/gi
export function substitute(text, { char = '', user = '' } = {}) {
  if (typeof text !== 'string' || !text) return text
  return text.replace(SUBST, (_, key) => (key.toLowerCase() === 'char' ? char : user))
}

const CARD_TEXT_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'behavior']
export function substituteCard(card, names) {
  if (!card) return card
  const output = { ...card }
  for (const field of CARD_TEXT_FIELDS) output[field] = substitute(output[field], names)
  return output
}

export function namesOf({ card, playerCard, userName }) {
  const user = playerCard?.usesSessionUserName ? userName : playerCard?.name || userName
  return { char: card?.name || '캐릭터', user: user || '유저' }
}

// behavior 는 카드 작성자가 목표·위협 대응·접촉 경계·분노 표현·회복 조건을 적는 자리다.
const LEGACY_CARD_FIELDS = [['personality', '성격'], ['scenario', '상황'], ['behavior', '행동 기준'], ['mes_example', '예시 대화']]
export function renderCard(card) {
  if (!card) return ''
  const lines = ['[캐릭터]', `이름: ${card.name}`]
  const description = [
    String(card.description || '').trim(),
    ...LEGACY_CARD_FIELDS
      .filter(([key]) => String(card[key] || '').trim())
      .map(([key, label]) => `${label}: ${card[key]}`),
  ].filter(Boolean).join('\n')
  if (description) lines.push(`설명: ${description}`)
  return lines.join('\n')
}

export function renderPlayerCard(card, names = {}) {
  if (!card) return ''
  const displayName = card.usesSessionUserName ? names.user || '유저' : card.name
  const lines = ['[플레이어 캐릭터 — 유저가 연기하는 인물]', `이름: ${displayName}`]
  const description = [substitute(card.description, names), substitute(card.personality, names)]
    .map((text) => String(text || '').trim()).filter(Boolean).join('\n')
  if (description) lines.push(`설명: ${description}`)
  return lines.join('\n')
}

export function renderCast(cards) {
  if (cards.length < 2) return ''
  return [
    `[등장인물 — 이 장면에는 ${cards.length}명이 있다]`,
    ...cards.map((card) => `- ${card.name}`),
    '한 응답 안에서 여러 인물이 번갈아 말해도 된다. 다만 모든 대사 줄은 반드시 `이름: 내용` 으로 화자를 밝힌다.',
    '유저가 말을 건 상대만 답해도 되고, 상황에 맞으면 다른 인물이 끼어들어도 된다.',
  ].join('\n')
}
