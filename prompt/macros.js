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

/**
 * 매크로 확장기를 만든다. 변수 이름은 지표 key · 지표 label · place · time · tension 이다.
 * 모르는 변수와 짝이 안 맞는 if 는 던진다 — 오타가 조용히 빈칸이 되면 작가가 영영 모른다.
 * @param {{ vars?: Record<string, number | string | boolean | null>, seed?: number }} [options]
 * @returns {(text: string) => string}
 */
export function createMacroExpander({ vars = {}, seed = 0 } = {}) {
  const lookup = (name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`매크로: 모르는 변수 ${name} — 지표 key·label 또는 place · time · tension 을 쓴다`)
    return vars[name]
  }
  let randomIndex = 0

  const evaluate = (expression) => {
    const m = COMPARE.exec(expression.trim())
    if (!m) throw new Error(`매크로: 조건을 읽을 수 없습니다 — {{#if ${expression}}}`)
    const [, negate, name, op, right] = m
    if (negate && op) throw new Error(`매크로: ! 와 비교를 같이 쓸 수 없습니다 — {{#if ${expression}}}`)
    const value = lookup(name)
    const result = op ? compare(value, op, literal(right)) : truthy(value)
    return negate ? !result : result
  }

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
