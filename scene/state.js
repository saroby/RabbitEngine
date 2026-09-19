// 장면 상태의 코어 스키마. 추출기가 낸 델타를 검증해 적용하고, 프롬프트용 산문으로 렌더한다.
// 저장·복원은 호스트 몫이다 — 여기는 값만 다룬다 (spec: 섹션 2).
export const TENSIONS = Object.freeze(['calm', 'playful', 'tense', 'hostile', 'intimate', 'grief'])
const TENSION_KO = { calm: '평온', playful: '장난스러움', tense: '긴장', hostile: '적대적', intimate: '친밀', grief: '비탄' }
const INDICATOR_TYPES = new Set(['number', 'string', 'boolean'])

export function emptySceneState() {
  // revision 은 적용 횟수다. 호스트가 CAS 저장에 쓰고, 추출기는 expectedRevision 으로 낡은 결과를 거른다.
  return { version: 1, revision: 0, place: null, time: null, tension: 'calm', characters: {}, threads: [], indicators: {}, updatedAt: null }
}

export function validateIndicatorDefs(defs = []) {
  const seen = new Set()
  return defs.map((def) => {
    if (!def || typeof def.key !== 'string' || !def.key.trim()) throw new Error('지표 정의에 key 가 없습니다')
    if (seen.has(def.key)) throw new Error(`지표 key 중복: ${def.key}`)
    seen.add(def.key)
    if (!INDICATOR_TYPES.has(def.type)) throw new Error(`지표 ${def.key} 의 type 이 잘못됐습니다: ${def.type}`)
    if (typeof def.initial !== def.type) throw new Error(`지표 ${def.key} 의 initial 이 type 과 다릅니다`)
    return { label: def.key, inferred: true, visible: true, ...def }
  })
}

export function initialIndicators(defs = []) {
  return Object.fromEntries(validateIndicatorDefs(defs).map((def) => [def.key, def.initial]))
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])

export function applySceneDelta(state, delta = {}, { indicatorDefs = [], messageId = null, names = null } = {}) {
  const next = structuredClone(state ?? emptySceneState())
  const rejected = []
  const known = Array.isArray(names) ? new Set(names) : null
  const defs = new Map(validateIndicatorDefs(indicatorDefs).map((def) => [def.key, def]))

  if (delta.place !== undefined) { if (text(delta.place)) next.place = text(delta.place); else rejected.push('place: 문자열이 아님') }
  if (delta.time !== undefined) { if (text(delta.time)) next.time = text(delta.time); else rejected.push('time: 문자열이 아님') }
  if (delta.tension !== undefined) { if (TENSIONS.includes(delta.tension)) next.tension = delta.tension; else rejected.push(`tension: 허용값 아님 (${delta.tension})`) }

  for (const [name, patch] of Object.entries(delta.characters || {})) {
    if (known && !known.has(name)) { rejected.push(`characters.${name}: 모르는 인물`); continue }
    const current = next.characters[name] || { body: [], emotion: '', toward: {} }
    if (patch?.body) {
      const add = list(patch.body.add); const remove = new Set(list(patch.body.remove))
      current.body = [...new Set([...current.body.filter((item) => !remove.has(item)), ...add])]
    }
    if (patch?.emotion !== undefined) { if (text(patch.emotion)) current.emotion = text(patch.emotion); else rejected.push(`characters.${name}.emotion: 문자열이 아님`) }
    for (const [other, attitude] of Object.entries(patch?.toward || {})) {
      if (text(attitude)) current.toward[other] = text(attitude); else rejected.push(`characters.${name}.toward.${other}: 문자열이 아님`)
    }
    next.characters[name] = current
  }

  if (delta.threads) {
    const resolve = new Set(list(delta.threads.resolve))
    next.threads = [...new Set([...next.threads.filter((item) => !resolve.has(item)), ...list(delta.threads.add)])]
  }

  for (const [key, value] of Object.entries(delta.indicators || {})) {
    const def = defs.get(key)
    if (!def) { rejected.push(`indicators.${key}: 정의되지 않은 지표`); continue }
    if (!def.inferred) { rejected.push(`indicators.${key}: 추출기가 바꿀 수 없는 지표`); continue }
    if (typeof value !== def.type) { rejected.push(`indicators.${key}: 타입 불일치 (${typeof value})`); continue }
    if (def.type === 'number' && ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max))) {
      rejected.push(`indicators.${key}: 범위 밖 (${value})`); continue
    }
    next.indicators[key] = value
  }

  next.revision = (state?.revision ?? 0) + 1
  if (messageId) next.updatedAt = { messageId }
  return { state: next, rejected }
}

export function renderSceneState(state, { indicatorDefs = [] } = {}) {
  if (!state) return ''
  const lines = []
  const head = [[state.place, state.time].filter(Boolean).join(', ')].filter(Boolean).map((where) => `지금: ${where}.`)
  const tension = state.tension && state.tension !== 'calm' ? `긴장: ${TENSION_KO[state.tension] || state.tension}.` : ''
  if (head.length || tension) lines.push([...head, tension].filter(Boolean).join(' '))
  for (const [name, c] of Object.entries(state.characters || {})) {
    const parts = [c.body?.length ? c.body.join(', ') : '', c.emotion || '', ...Object.entries(c.toward || {}).map(([other, attitude]) => `${other}에게 ${attitude}`)].filter(Boolean)
    if (parts.length) lines.push(`${name}: ${parts.join('. ')}.`)
  }
  if (state.threads?.length) lines.push(`미해결: ${state.threads.join('; ')}.`)
  const labels = new Map(indicatorDefs.map((def) => [def.key, def.label || def.key]))
  const indicators = Object.entries(state.indicators || {}).map(([key, value]) => `${labels.get(key) || key} ${value}`)
  if (indicators.length) lines.push(`지표: ${indicators.join(', ')}.`)
  return lines.join('\n')
}
