// 응답 뒤 백그라운드 1회 호출의 레시피. 엔진은 프롬프트·스키마·검증만 갖고 호출은 호스트가 한다.
import { recipeHashOf, canonical } from '../memory/recipe.js'
import { sha256Hex } from '../sha256.js'
import { applySceneDelta, renderSceneState, validateIndicatorDefs, TENSIONS } from './state.js'

export const EXTRACTION_VERSION = 'extract-v2'
// 따라잡기(밀린 교환을 한 번에 추출) 상한. 이보다 길면 한 번의 호출로 사실을
// 가려내지 못하고 델타가 뭉개진다 — 조용히 자르지 말고 호스트가 나눠 부르게 한다.
export const MAX_EXTRACTION_EXCHANGES = 5

function schemaFor(names, defs) {
  const characterPatch = {
    type: 'object', additionalProperties: false,
    properties: {
      body: { type: 'object', additionalProperties: false, properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } } },
      emotion: { type: 'string' },
      toward: { type: 'object', additionalProperties: { type: 'string' } },
    },
  }
  return {
    type: 'object', additionalProperties: false, required: ['beat'],
    properties: {
      place: { type: 'string' }, time: { type: 'string' }, tension: { type: 'string', enum: [...TENSIONS] },
      characters: { type: 'object', properties: Object.fromEntries(names.map((n) => [n, characterPatch])), additionalProperties: characterPatch },
      threads: { type: 'object', additionalProperties: false, properties: { add: { type: 'array', items: { type: 'string' } }, resolve: { type: 'array', items: { type: 'string' } } } },
      indicators: { type: 'object', properties: Object.fromEntries(defs.filter((d) => d.inferred).map((d) => [d.key, { type: d.type === 'boolean' ? 'boolean' : d.type }])), additionalProperties: false },
      beat: { type: 'string' },
    },
  }
}

export function extractionRecipe({ state, exchanges = [], names = [], playerName = '유저', indicatorDefs = [] }) {
  if (exchanges.length > MAX_EXTRACTION_EXCHANGES) {
    throw new Error(`extractionRecipe: 한 번에 추출할 교환은 ${MAX_EXTRACTION_EXCHANGES}개까지입니다 (${exchanges.length}개) — 나눠서 부르세요`)
  }
  const defs = validateIndicatorDefs(indicatorDefs)
  const current = renderSceneState(state, { indicatorDefs: defs }) || '(아직 기록 없음)'
  const indicatorLines = defs.filter((d) => d.inferred).map((d) => `- ${d.key}: ${d.type}${d.type === 'number' ? ` ${d.min ?? '-∞'}~${d.max ?? '∞'}` : ''}`)
  const system = [
    '당신은 롤플레이 대화의 기록 담당이다. 방금 오간 교환을 읽고 장면 상태에서 바뀐 것만 JSON 으로 낸다.',
    `등장인물: ${names.join(', ') || '(없음)'}. 플레이어는 "${playerName}" 로 부른다. 목록에 없는 인물은 쓰지 않는다.`,
    `긴장도(tension)는 ${TENSIONS.join(' | ')} 중 하나다. 극적 사건이 있었으면 즉시 바꾼다.`,
    '사실만 기록한다. 시도와 실제 발생을 구분하고, 발생하지 않은 것은 기록하지 않는다. 사실을 꾸미거나 축소하지 않는다.',
    `${playerName}(플레이어)에 대해서는 명시적으로 말했거나 밖에서 관찰되는 것만 기록한다. 속마음을 추정하지 않는다.`,
    indicatorLines.length ? `바꿀 수 있는 지표:\n${indicatorLines.join('\n')}` : '',
    '규칙: 바뀌지 않은 필드는 쓰지 않는다. body 는 현재 몸 상태(부상·옷·자세)만, emotion 은 한 단어, toward 는 상대별 태도 한 구절. beat 는 이 교환을 한 줄로 요약한 사실 문장이다. JSON 외의 텍스트를 쓰지 않는다.',
    // 형태를 보여 주지 않으면 모델이 body·emotion·toward 를 최상위에 평평하게 낸다(gpt-4o 실측).
    // 인물 상태는 반드시 characters.<이름> 아래에 있어야 applySceneDelta 가 읽는다.
    [
      '출력 형태(<…> 는 자리표시이며 값이 아니다. 교환에 근거가 없는 것은 쓰지 않는다):',
      '{"tension":"<tension 값>","place":"<바뀐 장소>","time":"<바뀐 시간>","characters":{"<인물명>":{"body":{"add":["<새로 성립한 몸 상태>"],"remove":["<더는 성립하지 않는 기존 항목 그대로>"]},"emotion":"<한 단어>","toward":{"<상대명>":"<태도 한 구절>"}}},"threads":{"add":["<새 실마리>"],"resolve":["<끝난 실마리>"]},"beat":"<한 줄 사실>"}',
      '<인물명>·<상대명> 은 등장인물 목록의 실제 이름(플레이어는 "' + playerName + '")으로 바꾼다. emotion·toward 는 characters 안에만 쓰고 최상위에 쓰지 않는다. 전체 상태를 다시 내지 않고 바뀐 필드만 낸다. 바뀐 것이 없으면 {"beat":"<한 줄 사실>"} 만 낸다.',
    ].join('\n'),
    `현재 장면 상태:\n${current}`,
  ].filter(Boolean).join('\n\n')
  const body = exchanges.map((x) => `[${playerName}]\n${x.user}\n\n[응답]\n${x.assistant}`).join('\n\n---\n\n')
  const recipeHash = recipeHashOf({
    partId: 'scene-extractor', partVersion: EXTRACTION_VERSION,
    stateHash: sha256Hex(canonical(state ?? null)),
    exchangeHashes: exchanges.map((x) => sha256Hex(`${x.user}\u0000${x.assistant}`)),
    names, playerName,
    indicators: defs.map((d) => ({ key: d.key, type: d.type, min: d.min ?? null, max: d.max ?? null, inferred: d.inferred })),
  })
  return { system, messages: [{ role: 'user', text: body }], schema: schemaFor(names, defs), recipeHash, purpose: 'extract' }
}

/**
 * 추출 응답에서 JSON 델타를 꺼낸다. ctx.llm 이 돌려주는 `{ text, provider, usage, latencyMs }`
 * 객체도 그대로 받는다 — 문자열만 받으면 호스트가 넘긴 결과가 "[object Object]" 가 돼
 * 조용히 null 이 되고, 델타가 통째로 사라진 것을 아무도 모른다.
 * @param {string | { text?: string } | null} output
 * @returns {object | null}
 */
export function parseExtractionOutput(output) {
  const raw = typeof output === 'string' ? output : (typeof output?.text === 'string' ? output.text : '')
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { const value = JSON.parse(raw.slice(start, end + 1)); return value && typeof value === 'object' ? value : null } catch { return null }
}

export function applyExtraction(state, rawText, { indicatorDefs = [], names = null, messageId = null, expectedRevision = null } = {}) {
  // 늦게 도착한 추출 결과가 그 사이 갱신된 상태를 덮어쓰면 안 된다. 호스트는 저장 시 revision CAS 를 함께 건다.
  // 무엇이 실제로 바뀌었는지의 증거. 적용하지 않은 경로에서는 after 가 before 와 같다.
  const before = sha256Hex(canonical(state ?? null))
  if (expectedRevision !== null && (state?.revision ?? 0) !== expectedRevision) {
    return { state, beat: '', rejected: [`stale: revision 불일치 (기대 ${expectedRevision}, 현재 ${state?.revision ?? 0})`], parsed: false, stale: true, stateHash: { before, after: before } }
  }
  // applySceneDelta 는 낯선 version 에 던지지만, 이 함수는 백그라운드 추출의
  // 종착점이라 거부 객체로 돌려준다 — 호스트가 저장을 건너뛰면 되는 일이
  // 대화 전체를 죽이는 예외가 되면 안 된다.
  if (state && state.version !== 1) {
    return { state, beat: '', rejected: [`state: version 이 1 이 아님 (${state.version})`], parsed: false, stale: false, stateHash: { before, after: before } }
  }
  const parsed = parseExtractionOutput(rawText)
  if (!parsed) return { state, beat: '', rejected: ['output: JSON 파싱 실패'], parsed: false, stale: false, stateHash: { before, after: before } }
  const { beat, ...delta } = parsed
  const applied = applySceneDelta(state, delta, { indicatorDefs, names, messageId })
  return {
    state: applied.state, beat: typeof beat === 'string' ? beat.trim() : '', rejected: applied.rejected,
    parsed: true, stale: false, stateHash: { before, after: sha256Hex(canonical(applied.state)) },
  }
}
