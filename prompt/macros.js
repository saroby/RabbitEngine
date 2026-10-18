// 사람이 쓴 문구(카드·지시문·소개·로어북·프로필 템플릿) 안의 조건과 값 매크로.
// "호감도가 50 이상이면 이 문장을 넣는다" 를 호스트 코드 없이 작가가 쓰게 한다.
//
// 모델이 쓴 문장(기억 요약·대화 이력)에는 절대 돌리지 않는다. 그쪽에서 {{var:…}} 가
// 펼쳐지면 숨긴 지표가 프롬프트로 새고, 조건문은 모델이 프롬프트를 조종하는 문이 된다.
// 그래서 이 모듈은 문자열만 받고, 무엇에 돌릴지는 compileBlocks 가 출처를 보고 정한다.
//
// {{user}} · {{char}} · {{content}} · {{block:…}} 은 건드리지 않는다 — 그 치환은 뒤에서 한다.
import { TENSIONS } from '../scene/state.js'

// 마지막 갈래들은 제어 태그처럼 생겼지만 모르는 태그다({{elif}} · {{#unless}} · {{/iff}} …).
// 그대로 두면 태그 원문이 프롬프트로 새므로 잡아서 던진다. {{// …}} 는 다른 도구의 주석이라 둔다.
const TAG = /\{\{\s*(#if\s+[^}]*?|else\s+if\s+[^}]*?|else|\/if|var:[^}]*?|random::[^}]*?|#[^}]*?|\/(?!\/)[^}]*?|el(?:se?)?if\b[^}]*?|else\b[^}]*?)\s*\}\}/gu
// 한 줄을 통째로 차지한 제어 태그는 그 줄바꿈까지 지운다. 안 그러면 꺼진 조건마다 빈 줄이 남는다.
const LONE_CONTROL = /^[ \t]*(\{\{\s*(?:#if\s+[^}]*?|else\s+if\s+[^}]*?|else|\/if)\s*\}\})[ \t]*\r?\n/gmu
// 값은 연산자 기호로 시작할 수 없다 — 안 그러면 `호감도 >= ` 를 `>` 와 값 `=` 로 잘못 읽는다.
const COMPARE = /^(!?)\s*([^\s=!<>]+)\s*(?:(>=|<=|==|!=|>|<)\s*([^\s=!<>].*))?$/u
const QUOTED = /^(?:"[^"]*"|'[^']*')$/u
const QUOTED_PARTS = /"[^"]*"|'[^']*'/gu
// 따옴표 없는 값 안의 비교 기호. `tension == tense == calm` 을 값 "tense == calm" 으로 읽지 않게 한다.
const OPERATOR_IN_VALUE = /==|!=|>=|<=|[<>]/u

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

// 값의 종류가 맞지 않는 같음 비교는 늘 거짓(!= 면 늘 참)이라 조용히 틀린다. 숫자 지표는 숫자와,
// 참거짓 지표는 true · false 와만 비교한다. 문자열 변수와 아직 값이 없는(null) 장소·시각은 묻지 않는다.
function checkEquality(name, value, right, expression) {
  const numeric = typeof right === 'number' || (typeof right === 'string' && right.trim() !== '' && Number.isFinite(Number(right)))
  if (typeof value === 'number' && !numeric) throw new Error(`매크로: ${name} 는 숫자라 숫자와 비교합니다 — {{#if ${expression}}}`)
  if (typeof value === 'boolean' && typeof right !== 'boolean') throw new Error(`매크로: ${name} 는 참거짓이라 true · false 와 비교합니다 — {{#if ${expression}}}`)
}

/**
 * 매크로 확장기를 만든다. 변수 이름은 지표 key · 지표 label · place · time · tension 이다.
 * 모르는 변수 · 짝이 안 맞는 태그 · 읽을 수 없는 조건은 꺼진 갈래 안에 있어도 던진다 —
 * 오타가 조용히 빈칸이 되거나, 그 갈래가 처음 켜지는 턴에야 터지면 작가가 제때 모른다.
 * @param {{ vars?: Record<string, number | string | boolean | null>, seed?: number, choices?: Record<string, readonly string[]> }} [options]
 * choices 는 변수별 허용값이다. == · != 의 값이 목록에 없으면 던진다 (예: tension 은 TENSIONS)
 * @returns {(text: string) => string}
 */
export function createMacroExpander({ vars = {}, seed = 0, choices = {} } = {}) {
  const lookup = (name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`매크로: 모르는 변수 ${name} — 지표 key·label 또는 place · time · tension 을 쓴다`)
    return vars[name]
  }
  let randomIndex = 0

  const evaluate = (expression) => {
    const text = expression.trim()
    // 우변을 통째로 값으로 읽으므로 `a == b || a == c` 는 값 "b || a == c" 와의 비교가 돼 조용히 틀린다.
    if (/&&|\|\|/u.test(text.replace(QUOTED_PARTS, ''))) {
      throw new Error(`매크로: 조건에 && · || 를 쓸 수 없습니다 — {{#if}} 를 겹치거나 {{else if}} 로 나눈다 — {{#if ${text}}}`)
    }
    const m = COMPARE.exec(text)
    if (!m) throw new Error(`매크로: 조건을 읽을 수 없습니다 — {{#if ${text}}}`)
    const [, negate, name, op, raw] = m
    if (negate && op) throw new Error(`매크로: ! 와 비교를 같이 쓸 수 없습니다 — {{#if ${text}}}`)
    const value = lookup(name)
    if (!op) return negate ? !truthy(value) : truthy(value)
    if (!QUOTED.test(raw.trim()) && OPERATOR_IN_VALUE.test(raw)) {
      throw new Error(`매크로: 값에 비교 기호가 있습니다 — 글자 그대로 비교하려면 따옴표로 감싼다 — {{#if ${text}}}`)
    }
    const right = literal(raw)
    if (op === '==' || op === '!=') {
      const allowed = Object.hasOwn(choices, name) ? choices[name] : null
      if (allowed && !allowed.includes(right)) throw new Error(`매크로: ${name} 는 ${allowed.join(' · ')} 중 하나와 비교합니다 (${JSON.stringify(right)}) — {{#if ${text}}}`)
      checkEquality(name, value, right, text)
    }
    return compare(value, op, right)
  }

  return function expand(text) {
    if (typeof text !== 'string' || !text.includes('{{')) return text
    const source = text.replace(LONE_CONTROL, '$1')
    // 바깥부터 열린 조건을 쌓는다. active 는 "지금 이 갈래를 내보내는가",
    // taken 은 "이 if 묶음에서 이미 한 갈래를 냈는가" 다 — else if · else 는 앞 갈래가 안 났을 때만 난다.
    const stack = []
    const emitting = () => stack.every((frame) => frame.active)
    let out = ''
    let last = 0
    for (const match of source.matchAll(TAG)) {
      if (emitting()) out += source.slice(last, match.index)
      last = match.index + match[0].length
      const tag = match[1]
      // 꺼진 갈래 안의 조건과 변수도 평가한다 — 값은 버리고 오류만 본다. 변수는 지표 정의에서
      // 늘 채워지므로 미룰 이유가 없고, 미루면 오타가 그 갈래가 처음 켜지는 턴(세션 한가운데)에 터진다.
      if (/^#if\s/u.test(tag)) {
        const parentOn = emitting()
        const result = evaluate(tag.slice(3))
        const active = parentOn && result
        stack.push({ active, taken: active, parentOn, sawElse: false })
      } else if (/^else\s+if\s/u.test(tag)) {
        const frame = stack.at(-1)
        if (!frame) throw new Error('매크로: 짝이 없는 {{else if}}')
        if (frame.sawElse) throw new Error('매크로: {{else}} 뒤에는 {{else if}} 를 쓸 수 없습니다')
        const result = evaluate(tag.replace(/^else\s+if/u, ''))
        frame.active = frame.parentOn && !frame.taken && result
        frame.taken ||= frame.active
      } else if (tag === 'else') {
        const frame = stack.at(-1)
        if (!frame) throw new Error('매크로: 짝이 없는 {{else}}')
        if (frame.sawElse) throw new Error('매크로: 한 {{#if}} 에 {{else}} 는 하나만 씁니다')
        frame.sawElse = true
        frame.active = frame.parentOn && !frame.taken
      } else if (tag === '/if') {
        if (!stack.pop()) throw new Error('매크로: 짝이 없는 {{/if}}')
      } else if (tag.startsWith('var:')) {
        const value = lookup(tag.slice(4).trim())
        if (emitting()) out += value === null || value === undefined ? '' : String(value)
      } else if (tag.startsWith('random::')) {
        if (emitting()) {
          const options = tag.slice('random::'.length).split('::')
          // 위치까지 시드에 섞어 한 문구 안의 두 random 이 늘 같은 값을 고르지 않게 한다.
          out += options[hash32(`${seed}:${randomIndex}:${options.join('::')}`) % options.length]
          randomIndex += 1
        }
      } else {
        throw new Error(`매크로: 알 수 없는 태그 {{${tag}}} — {{#if 조건}} · {{else if 조건}} · {{else}} · {{/if}} 를 쓴다`)
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

/**
 * 장면 상태와 지표 정의로 확장기를 만든다. buildTurn 과 checkMacros 가 같은 규칙을 쓰게 하는 자리다.
 * @param {import('../types.js').SceneState | null} sceneState
 * @param {import('../types.js').IndicatorDef[]} [indicatorDefs]
 * @param {number} [seed]
 * @returns {(text: string) => string}
 */
export function sceneMacroExpander(sceneState, indicatorDefs = [], seed = 0) {
  // 지표 key 가 tension 이면 장면 긴장도를 가린다(macroVarsOf) — 그때는 허용값을 묻지 않는다.
  const shadowed = indicatorDefs.some((def) => def.key === 'tension')
  return createMacroExpander({ vars: macroVarsOf(sceneState, indicatorDefs), seed, choices: shadowed ? {} : { tension: TENSIONS } })
}

/**
 * 저장하기 전에 사람이 쓴 문구의 매크로를 검사한다. 지금 장면 상태와 상관없이 모든 갈래의
 * 문법 · 변수 이름 · 비교 값을 본다 — 같은 문구로 buildTurn 이 던질 오류를 미리 낸다.
 * @param {string} text
 * @param {{ indicatorDefs?: import('../types.js').IndicatorDef[] }} [options]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkMacros(text, { indicatorDefs = [] } = {}) {
  try {
    sceneMacroExpander(null, indicatorDefs)(text)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
