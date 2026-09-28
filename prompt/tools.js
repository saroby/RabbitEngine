// 인물별 도구. 카드는 도구 ID 만 들고, 스키마는 호스트가 준 명세에서 온다 —
// 카드 작성자가 실행 코드나 임의 스키마를 넣을 수 없게 하는 자리다. 실행은 호스트 몫이다.
//
// 한 번의 호출이 여러 인물을 연기하므로 도구는 인물이 아니라 호출 단위로 열린다.
// 그래서 모든 도구에 actor 인자를 박고 그 값을 소유자로 묶는다. 스키마(enum)는
// 모델을 좁히는 장치일 뿐이고, 실제 문은 authorizeToolCall 이다.
//
// 사용 지침을 별도 프롬프트 블록이 아니라 description 에 두는 이유: 블록 종류를
// 늘리면 PromptProfile 이 "모든 종류를 한 번씩" 요구해 저장된 프로필이 깨지고,
// 프로필을 쓰는 턴에서는 모르는 블록이 버려진다.

export const TOOL_ACTOR_KEY = 'actor'
// 공급자 공통 제약(Anthropic·OpenAI 도구 이름).
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function validateSpecs(specs) {
  if (!Array.isArray(specs)) throw new Error('toolSpecs 는 배열이어야 합니다')
  const seen = new Set()
  return specs.map((spec) => {
    if (!isPlainObject(spec) || typeof spec.id !== 'string' || !TOOL_NAME.test(spec.id)) {
      throw new Error(`도구 id 는 영문·숫자·_·- 로 된 1~64자여야 합니다 (${spec?.id})`)
    }
    if (seen.has(spec.id)) throw new Error(`도구 id 중복: ${spec.id}`)
    seen.add(spec.id)
    if (typeof spec.description !== 'string' || !spec.description.trim()) throw new Error(`도구 ${spec.id} 에 description 이 없습니다`)
    const parameters = spec.parameters ?? { type: 'object', properties: {} }
    if (!isPlainObject(parameters) || parameters.type !== 'object') throw new Error(`도구 ${spec.id} 의 parameters 는 type 이 object 인 JSON 스키마여야 합니다`)
    // 호스트 인자가 actor 를 덮으면 소유자 제한이 사라진다.
    if (Object.hasOwn(parameters.properties ?? {}, TOOL_ACTOR_KEY)) throw new Error(`도구 ${spec.id} 의 parameters 에 예약된 ${TOOL_ACTOR_KEY} 가 있습니다`)
    return { id: spec.id, description: spec.description.trim(), parameters }
  })
}

/**
 * 장면의 카드와 호스트 도구 명세로 이번 턴에 열 도구를 만든다.
 * 순서는 명세 순서를 따른다 — 카드 순서가 바뀌어도 도구 정의가 흔들려 캐시가 깨지지 않게.
 * @param {Array<{ name: string, tools?: string[] }>} cards
 * @param {import('../types.js').ToolSpec[]} [specs]
 * @returns {import('../types.js').ToolDefinition[]}
 */
export function resolveTools(cards = [], specs = []) {
  const valid = validateSpecs(specs)
  const byId = new Map(valid.map((spec) => [spec.id, spec]))
  const owners = new Map()
  for (const card of cards) {
    if (card?.tools === undefined || card?.tools === null) continue
    if (!Array.isArray(card.tools) || card.tools.some((id) => typeof id !== 'string')) throw new Error(`카드 ${card?.name} 의 tools 는 도구 id 문자열 배열이어야 합니다`)
    for (const id of card.tools) {
      // 모르는 id 를 조용히 버리면 "왜 도구를 안 쓰지" 가 카드 오타로 남는다.
      if (!byId.has(id)) throw new Error(`카드 ${card.name} 이 모르는 도구를 가리킵니다: ${id}`)
      if (!owners.has(id)) owners.set(id, [])
      if (!owners.get(id).includes(card.name)) owners.get(id).push(card.name)
    }
  }
  return valid.filter((spec) => owners.has(spec.id)).map((spec) => {
    const who = owners.get(spec.id)
    const { parameters } = spec
    return {
      name: spec.id,
      description: `${spec.description}\n사용할 수 있는 인물: ${who.join(', ')}. ${TOOL_ACTOR_KEY} 에는 이 도구를 쓰는 인물을 넣고, 그 인물이 결과를 말하고 행동한다.`,
      parameters: {
        ...parameters,
        properties: { [TOOL_ACTOR_KEY]: { type: 'string', enum: [...who], description: '이 도구를 쓰는 인물' }, ...(parameters.properties ?? {}) },
        required: [TOOL_ACTOR_KEY, ...(parameters.required ?? []).filter((key) => key !== TOOL_ACTOR_KEY)],
      },
      owners: [...who],
    }
  })
}

/**
 * 모델이 낸 도구 호출을 실행 전에 검사한다. 모델 출력이라 던지지 않고 결과로 돌려준다 —
 * 거부 사유를 tool_result 로 돌려주면 모델이 다시 고를 수 있다.
 * 인자 스키마 검증(actor 외)은 호스트가 한다.
 * @param {import('../types.js').ToolDefinition[]} tools 이번 턴의 turn.tools
 * @param {{ name: string, input?: unknown }} call
 * @returns {import('../types.js').ToolCallCheck}
 */
export function authorizeToolCall(tools = [], call = {}) {
  const tool = (Array.isArray(tools) ? tools : []).find((item) => item.name === call?.name)
  if (!tool) return { ok: false, reason: 'unknown_tool', message: `이번 턴에 열리지 않은 도구입니다: ${call?.name}` }
  if (!isPlainObject(call.input)) return { ok: false, reason: 'invalid_input', message: `도구 ${tool.name} 의 입력이 객체가 아닙니다` }
  const { [TOOL_ACTOR_KEY]: actor, ...args } = call.input
  if (typeof actor !== 'string' || !tool.owners.includes(actor)) {
    return { ok: false, reason: 'actor_not_allowed', message: `${actor} 은(는) ${tool.name} 을(를) 쓸 수 없습니다. 사용할 수 있는 인물: ${tool.owners.join(', ')}` }
  }
  return { ok: true, name: tool.name, actor, args }
}
