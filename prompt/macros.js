// 사람이 쓴 문구(카드·지시문·소개·로어북·프로필 템플릿) 안의 조건과 값 매크로.
// "호감도가 50 이상이면 이 문장을 넣는다" 를 호스트 코드 없이 작가가 쓰게 한다.
//
// 모델이 쓴 문장(기억 요약·대화 이력)에는 절대 돌리지 않는다. 그쪽에서 {{var:…}} 가
// 펼쳐지면 숨긴 지표가 프롬프트로 새고, 조건문은 모델이 프롬프트를 조종하는 문이 된다.
// 그래서 이 모듈은 문자열만 받고, 무엇에 돌릴지는 compileBlocks 가 출처를 보고 정한다.
//
// {{user}} · {{char}} · {{content}} · {{block:…}} 은 건드리지 않는다 — 그 치환은 뒤에서 한다.

const TAG = /\{\{\s*(#if\s+[^}]*?|else|\/if|var:[^}]*?|random::[^}]*?)\s*\}\}/gu
// 한 줄을 통째로 차지한 제어 태그는 그 줄바꿈까지 지운다. 안 그러면 꺼진 조건마다 빈 줄이 남는다.
const LONE_CONTROL = /^[ \t]*(\{\{\s*(?:#if\s+[^}]*?|else|\/if)\s*\}\})[ \t]*\r?\n/gmu
// 값은 연산자 기호로 시작할 수 없다 — 안 그러면 `호감도 >= ` 를 `>` 와 값 `=` 로 잘못 읽는다.
const COMPARE = /^(!?)\s*([^\s=!<>]+)\s*(?:(>=|<=|==|!=|>|<)\s*([^\s=!<>].*))?$/u

// 같은 시드면 같은 결과. 암호용이 아니라 고르게 흩어지기만 하면 된다 (FNV-1a 32bit).
function hash32(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function literal(raw) {
  const text = raw.trim()
  const quoted = /^"(.*)"$/u.exec(text) || /^'(.*)'$/u.exec(text)
  if (quoted) return quoted[1]
  if (text === 'true') return true
  if (text === 'false') return false
  if (text !== '' && Number.isFinite(Number(text))) return Number(text)
  return text
}

const truthy = (value) => (typeof value === 'number' ? value !== 0 : Boolean(value))

function compare(left, op, right) {
  if (['>', '<', '>=', '<='].includes(op)) {
    if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`매크로: ${op} 는 숫자끼리만 비교합니다 (${JSON.stringify(left)} ${op} ${JSON.stringify(right)})`)
    return op === '>' ? left > right : op === '<' ? left < right : op === '>=' ? left >= right : left <= right
  }
  // 숫자 지표를 "50" 처럼 따옴표로 써도 같게 본다. 나머지는 값 그대로 비교한다.
  const same = typeof left === 'number' && typeof right === 'string' && right !== '' ? left === Number(right) : left === right
  return op === '==' ? same : !same
}

// 변수 이름 → 값 읽기와 조건 평가. 확장기와 저장 전 검사(checkMacros)가 같은 규칙을 쓰게 한 자리에 둔다.
function macroScope({ vars = {}, choices = {} }) {
  const lookup = (name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`매크로: 모르는 변수 ${name} — 지표 key·label 또는 place · time · tension 을 쓴다`)
    return vars[name]
  }
  const evaluate = (expression) => {
    const m = COMPARE.exec(expression.trim())
    if (!m) throw new Error(`매크로: 조건을 읽을 수 없습니다 — {{#if ${expression}}}`)
    const [, negate, name, op, right] = m
    if (negate && op) throw new Error(`매크로: ! 와 비교를 같이 쓸 수 없습니다 — {{#if ${expression}}}`)
    const value = lookup(name)
    const allowed = Object.hasOwn(choices, name) ? choices[name] : null
    // 허용값이 있는 변수는 적힌 글자 그대로 비교한다 — "1인칭" 같은 값이 숫자로 읽히지 않게.
    const operand = op && allowed ? literalText(right) : op ? literal(right) : null
    if (allowed && (op === '==' || op === '!=') && !allowed.includes(operand)) {
      throw new Error(`매크로: ${name} 는 ${allowed.join(' · ')} 중 하나와 비교합니다 (${JSON.stringify(operand)}) — {{#if ${expression}}}`)
    }
    const result = op ? compare(value, op, operand) : truthy(value)
    return negate ? !result : result
  }
  return { lookup, evaluate }
}

function literalText(raw) {
  const text = raw.trim()
  return (/^"(.*)"$/u.exec(text) || /^'(.*)'$/u.exec(text))?.[1] ?? text
}

/**
 * 매크로 확장기를 만든다. 변수 이름은 지표 key · 지표 label · place · time · tension, 그리고 호스트가 선언한 이름이다.
 * 모르는 변수와 짝이 안 맞는 if 는 던진다 — 오타가 조용히 빈칸이 되면 작가가 영영 모른다.
 * @param {{ vars?: Record<string, number | string | boolean | null>, seed?: number, choices?: Record<string, readonly string[]> }} [options]
 * choices 는 변수별 허용값이다. == · != 의 값이 목록에 없으면 던진다
 * @returns {(text: string) => string}
 */
export function createMacroExpander({ vars = {}, seed = 0, choices = {} } = {}) {
  const { lookup, evaluate } = macroScope({ vars, choices })
  let randomIndex = 0

  return function expand(text) {
    if (typeof text !== 'string' || !text.includes('{{')) return text
    const source = text.replace(LONE_CONTROL, '$1')
    // 바깥부터 열린 조건을 쌓는다. 각 칸은 "지금 이 갈래를 내보내는가" 다.
    const stack = []
    const emitting = () => stack.every((frame) => frame.active)
    let out = ''
    let last = 0
    for (const match of source.matchAll(TAG)) {
      if (emitting()) out += source.slice(last, match.index)
      last = match.index + match[0].length
      const tag = match[1]
      if (tag.startsWith('#if')) {
        // 꺼진 갈래 안의 조건은 평가하지 않는다 — 거기서 쓰는 변수가 아직 없을 수 있다.
        const parentOn = emitting()
        stack.push({ active: parentOn ? evaluate(tag.slice(3)) : false, parentOn, sawElse: false })
      } else if (tag === 'else') {
        const frame = stack.at(-1)
        if (!frame || frame.sawElse) throw new Error('매크로: 짝이 없는 {{else}}')
        frame.sawElse = true
        frame.active = frame.parentOn && !frame.active
      } else if (tag === '/if') {
        if (!stack.pop()) throw new Error('매크로: 짝이 없는 {{/if}}')
      } else if (emitting()) {
        if (tag.startsWith('var:')) {
          const value = lookup(tag.slice(4).trim())
          out += value === null || value === undefined ? '' : String(value)
        } else {
          const options = tag.slice('random::'.length).split('::')
          // 위치까지 시드에 섞어 한 문구 안의 두 random 이 늘 같은 값을 고르지 않게 한다.
          out += options[hash32(`${seed}:${randomIndex}:${options.join('::')}`) % options.length]
          randomIndex += 1
        }
      }
    }
    if (stack.length) throw new Error('매크로: 닫히지 않은 {{#if}}')
    return out + source.slice(last)
  }
}

/**
 * 장면 상태와 지표 정의로 매크로 변수를 만든다. 지표는 key 와 label 둘 다로 부를 수 있고,
 * 장면 상태에 값이 없으면 정의의 initial 을 쓴다.
 * @param {import('../types.js').SceneState | null} sceneState
 * @param {import('../types.js').IndicatorDef[]} indicatorDefs
 * @returns {Record<string, number | string | boolean | null>}
 */
export function macroVarsOf(sceneState, indicatorDefs = []) {
  const vars = { place: sceneState?.place ?? null, time: sceneState?.time ?? null, tension: sceneState?.tension ?? 'calm' }
  for (const def of indicatorDefs) {
    const value = sceneState?.indicators && Object.hasOwn(sceneState.indicators, def.key) ? sceneState.indicators[def.key] : def.initial
    vars[def.key] = value
    if (def.label && !Object.hasOwn(vars, def.label)) vars[def.label] = value
  }
  return vars
}

// 조건과 {{var:…}} 가 읽을 수 있는 이름 — 공백 · 비교 기호 · ! · 중괄호가 끼면 COMPARE · TAG 가 다르게 자른다.
const HOST_VAR_NAME = /^[^\s=!<>{}]+$/u

/**
 * 장면 변수에 호스트가 선언한 변수를 더한다. 작품 설정처럼 장면 밖에서 정해지는 값이라 턴마다 바뀌지 않는다.
 * 선언은 이름 · 이번 값 · (있으면) 허용값이다. 허용값이 있으면 조건의 == · != 값이 그 목록에 있어야 한다.
 * 이름이 장면 변수(지표 key · label · place · time · tension)와 겹치거나 두 번 선언되면 던진다 — 어느 값이 들어갈지 작가가 알 수 없다.
 * @param {Record<string, number | string | boolean | null>} sceneVars macroVarsOf 의 결과
 * @param {import('../types.js').MacroVar[] | undefined} macroVars
 * @returns {{ vars: Record<string, number | string | boolean | null>, choices: Record<string, string[]> }}
 */
export function hostMacroOptions(sceneVars, macroVars) {
  const vars = { ...sceneVars }
  /** @type {Record<string, string[]>} */
  const choices = {}
  if (macroVars === undefined) return { vars, choices }
  if (!Array.isArray(macroVars)) throw new Error('macroVars: { name, value, choices? } 목록이어야 합니다')
  for (const declaration of macroVars) {
    if (!declaration || typeof declaration !== 'object') throw new Error('macroVars: 선언은 { name, value, choices? } 객체여야 합니다')
    const { name, value, choices: allowed } = declaration
    if (typeof name !== 'string' || !HOST_VAR_NAME.test(name)) throw new Error(`macroVars: 이름 ${JSON.stringify(name)} 은 매크로에서 부를 수 없습니다`)
    if (Object.hasOwn(sceneVars, name)) throw new Error(`macroVars: ${name} 이 장면 변수와 겹칩니다`)
    if (Object.hasOwn(vars, name)) throw new Error(`macroVars: ${name} 을 두 번 선언했습니다`)
    const scalar = value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    if (!scalar) throw new Error(`macroVars: ${name} 의 값은 문자열 · 유한한 숫자 · 참거짓 · null 이어야 합니다`)
    if (allowed !== undefined) {
      if (!Array.isArray(allowed) || !allowed.length || !allowed.every((choice) => typeof choice === 'string' && choice !== '')) {
        throw new Error(`macroVars: ${name} 의 허용값은 빈 글자가 아닌 문자열 목록이어야 합니다`)
      }
      if (value !== null && !allowed.includes(value)) throw new Error(`macroVars: ${name} 의 값 ${JSON.stringify(value)} 가 허용값 ${allowed.join(' · ')} 에 없습니다`)
      choices[name] = [...allowed]
    }
    vars[name] = value
  }
  return { vars, choices }
}

/**
 * 저장하기 전에 사람이 쓴 문구의 매크로를 검사한다. 확장기는 꺼진 갈래의 조건을 평가하지 않지만,
 * 여기서는 모든 갈래의 조건 · {{var}} 를 보고 변수 이름과 허용값을 확인한다 — 다른 값의 작품에서 처음 켜질 때 터지지 않게.
 * @param {string} text
 * @param {{ indicatorDefs?: import('../types.js').IndicatorDef[], macroVars?: import('../types.js').MacroVar[] }} [options]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkMacros(text, { indicatorDefs = [], macroVars } = {}) {
  try {
    const options = hostMacroOptions(macroVarsOf(null, indicatorDefs), macroVars)
    if (typeof text === 'string' && text.includes('{{')) {
      const { lookup, evaluate } = macroScope(options)
      for (const [, tag] of text.matchAll(TAG)) {
        if (tag.startsWith('#if')) evaluate(tag.slice(3))
        else if (tag.startsWith('var:')) lookup(tag.slice(4).trim())
      }
    }
    // 짝이 안 맞는 if · else 는 확장기가 잡는다.
    createMacroExpander(options)(text)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true }
}
