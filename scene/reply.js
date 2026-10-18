// 모델 응답 검사. user_boundary 블록과 디렉티브가 "유저의 대사를 대신 쓰지 않는다" 고
// 말해도 모델은 종종 유저 줄을 지어낸다. 프롬프트로는 못 막으므로 출력 쪽에서 결정론적으로
// 찾아 호스트에 넘긴다 — 자를지, 다시 부를지는 호스트가 정한다 (엔진은 모델을 부르지 않는다).

// 추론 모델이 본문 앞에 붙이는 생각 블록. 화면에도 기억에도 들어가면 안 된다.
const REASONING_TAGS = ['think', 'thinking', 'reasoning']
const PAIRED = new RegExp(`<(${REASONING_TAGS.join('|')})>[\\s\\S]*?<\\/\\1>`, 'giu')
const OPEN = new RegExp(`<(?:${REASONING_TAGS.join('|')})>`, 'iu')
const CLOSE = new RegExp(`<\\/(?:${REASONING_TAGS.join('|')})>`, 'iu')

/**
 * 응답에서 추론 블록(<think> · <thinking> · <reasoning>)을 떼어 낸다.
 * 닫히지 않은 여는 태그는 끝까지를 추론으로 본다 (스트리밍 중이거나 잘린 응답).
 * 여는 태그 없이 닫는 태그로 시작하는 응답은 그 앞까지를 추론으로 본다 — 여는 태그를
 * 채팅 템플릿이 넣어서 출력에는 닫는 쪽만 오는 모델이 있다.
 * @param {string} text
 * @returns {{ text: string, reasoning: string }}
 */
export function stripReasoning(text) {
  let rest = String(text || '')
  const parts = []
  const firstClose = rest.search(CLOSE)
  const firstOpen = rest.search(OPEN)
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    parts.push(rest.slice(0, firstClose))
    rest = rest.slice(firstClose).replace(CLOSE, '')
  }
  rest = rest.replace(PAIRED, (block) => { parts.push(block.replace(OPEN, '').replace(CLOSE, '')); return '' })
  const dangling = rest.search(OPEN)
  if (dangling !== -1) {
    parts.push(rest.slice(dangling).replace(OPEN, ''))
    rest = rest.slice(0, dangling)
  }
  return { text: rest.trim(), reasoning: parts.map((part) => part.trim()).filter(Boolean).join('\n\n') }
}

// 모델은 호스트가 정한 이름 대신 프롬프트에 보인 호칭("상대(유저)의 호칭")이나 치환 전
// 자리표시자를 화자로 쓰기도 한다. 등장인물 이름과 겹치는 별칭은 뺀다.
const USER_ALIASES = ['유저', 'user', '{{user}}']

// 화자 라벨에 붙은 마크다운 강조(**유저**:)는 같은 이름으로 본다. 라틴 이름은 대소문자를 안 가린다.
const normalize = (name) => String(name || '').normalize('NFC').replace(/[*_`~]/g, '').trim().toLowerCase()

function userNameSet(userNames, castNames) {
  const cast = new Set(castNames.map(normalize))
  const set = new Set()
  for (const name of [...userNames, ...USER_ALIASES]) {
    const key = normalize(name)
    if (key && !cast.has(key)) set.add(key)
  }
  return set
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 응답에서 유저를 대신 쓴 곳과 빈 응답을 찾는다.
 *
 * severity 'error' 는 그대로 내보내면 안 되는 것이고 ok 를 false 로 만든다.
 * 'warn' 은 오탐이 있을 수 있는 신호라 ok 에 영향을 주지 않는다.
 * - user_dialogue (error): 유저 이름(또는 '유저' · 'user')으로 된 대사·속마음
 * - empty (error): 추론 블록과 메모를 걷어낸 뒤 이야기 조각이 없다
 * - user_action (warn): 지문·나레이션에서 유저가 주어("민준이 …", "유저는 …")다
 * - unknown_speaker (warn): castNames 에 없는 화자의 대사. castNames 를 줘야 검사한다
 *
 * safeSegments 는 첫 error 조각 바로 앞까지다. 앞부분만 보여 주고 나머지를 버리는
 * 호스트가 그대로 쓰면 된다. 첫 조각부터 오류면 비어 있으니 다시 부르는 수밖에 없다.
 * @param {import('../types.js').ScriptDialect} dialect
 * @param {string} text 모델 응답 원문
 * @param {{ userNames?: string[], castNames?: string[] }} [options]
 * @returns {import('../types.js').ReplyCheck}
 */
export function checkReply(dialect, text, { userNames = [], castNames = [] } = {}) {
  if (!dialect || typeof dialect.parse !== 'function') throw new Error('checkReply: dialect 는 defineDialect 로 만든 방언이어야 합니다')
  const stripped = stripReasoning(text)
  const users = userNameSet(userNames, castNames)
  const cast = new Set(castNames.map(normalize))
  // 이름 목록으로 라벨을 거르는 방언(asteriskScript)은 모르는 라벨을 나레이션으로 접는다.
  // 유저 라벨도 화자로 읽혀야 잡을 수 있으므로 유저 이름을 목록에 같이 넣는다.
  const parseNames = castNames.length ? [...castNames, ...userNames, ...USER_ALIASES] : null
  const segments = dialect.parse(stripped.text, parseNames ? { names: parseNames } : undefined)

  const userList = [...users].map(escapeRegExp).join('|')
  // 라벨로 안 읽힌 유저 줄(나레이션으로 떨어진 것)도 잡는다.
  const userLabel = users.size ? new RegExp(`^[*_\\s]*(?:${userList})[*_\\s]*(?:\\(\\s*속마음\\s*\\))?\\s*[:\\uFF1A]`, 'iu') : null
  // 이름 바로 뒤 주격·보조사, 그 뒤 공백. "민준의 주먹이" 같은 소유격은 반응 묘사라 넘긴다.
  const userSubject = users.size ? new RegExp(`(?:^|[\\s"'「(])(?:${userList})(?:이가|이는|이|가|은|는|께서)\\s`, 'iu') : null

  const issues = []
  segments.forEach((segment, index) => {
    const speaker = segment.speaker ? normalize(segment.speaker) : null
    if (speaker && users.has(speaker)) {
      issues.push({ kind: 'user_dialogue', severity: 'error', index, speaker: segment.speaker, text: segment.text })
    } else if (!speaker && userLabel && userLabel.test(segment.text)) {
      issues.push({ kind: 'user_dialogue', severity: 'error', index, text: segment.text })
    } else if (speaker && cast.size && !cast.has(speaker)) {
      issues.push({ kind: 'unknown_speaker', severity: 'warn', index, speaker: segment.speaker, text: segment.text })
    } else if ((segment.type === 'action' || segment.type === 'narration') && userSubject && userSubject.test(segment.text)) {
      issues.push({ kind: 'user_action', severity: 'warn', index, text: segment.text })
    }
  })

  const story = segments.filter((segment) => segment.type !== 'choice' && String(segment.text || '').trim())
  if (!story.length) issues.push({ kind: 'empty', severity: 'error', index: 0, text: '' })

  const firstError = issues.find((issue) => issue.severity === 'error')
  return {
    ok: !firstError,
    issues,
    segments,
    safeSegments: firstError ? segments.slice(0, firstError.index) : segments,
    text: stripped.text,
    reasoning: stripped.reasoning,
  }
}

/**
 * 생성 API 의 stop 인자로 넘길 문자열. 모델이 새 줄에서 유저 라벨을 쓰기 시작하면 거기서 멈춘다.
 * 첫 줄부터 쓰는 경우는 못 막으므로 checkReply 와 함께 쓴다. OpenAI 한도에 맞춰 4개까지만 준다.
 * @param {{ userNames?: string[], castNames?: string[] }} [options]
 * @returns {string[]}
 */
export function stopSequencesFor({ userNames = [], castNames = [] } = {}) {
  const cast = new Set(castNames.map(normalize))
  const names = []
  for (const name of [...userNames, '유저']) {
    const trimmed = String(name || '').trim()
    if (trimmed && !cast.has(normalize(trimmed)) && !names.includes(trimmed)) names.push(trimmed)
  }
  return names.flatMap((name) => [`\n${name}:`, `\n${name}：`]).slice(0, 4)
}
