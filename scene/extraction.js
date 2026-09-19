// 응답 뒤 백그라운드 1회 호출의 레시피. 엔진은 프롬프트·스키마·검증만 갖고 호출은 호스트가 한다.
import { recipeHashOf } from '../memory/recipe.js'
import { sha256Hex } from '../sha256.js'
import { applySceneDelta, renderSceneState, validateIndicatorDefs, TENSIONS } from './state.js'

export const EXTRACTION_VERSION = 'extract-v1'

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
  const defs = validateIndicatorDefs(indicatorDefs)
  const current = renderSceneState(state, { indicatorDefs: defs }) || '(아직 기록 없음)'
  const indicatorLines = defs.filter((d) => d.inferred).map((d) => `- ${d.key}: ${d.type}${d.type === 'number' ? ` ${d.min ?? '-∞'}~${d.max ?? '∞'}` : ''}`)
  const system = [
    '당신은 롤플레이 대화의 기록 담당이다. 방금 오간 교환을 읽고 장면 상태에서 바뀐 것만 JSON 으로 낸다.',
    `등장인물: ${names.join(', ') || '(없음)'}. 플레이어는 "${playerName}" 로 부른다. 목록에 없는 인물은 쓰지 않는다.`,
    `긴장도(tension)는 ${TENSIONS.join(' | ')} 중 하나다. 극적 사건이 있었으면 즉시 바꾼다.`,
    '사실만 기록한다. 시도와 실제 발생을 구분하고, 발생하지 않은 것은 기록하지 않는다. 묘사 수위를 꾸미거나 약화하지 않는다.',
    `${playerName}(플레이어)에 대해서는 명시적으로 말했거나 밖에서 관찰되는 것만 기록한다. 속마음을 추정하지 않는다.`,
    indicatorLines.length ? `바꿀 수 있는 지표:\n${indicatorLines.join('\n')}` : '',
    '규칙: 바뀌지 않은 필드는 쓰지 않는다. body 는 현재 몸 상태(부상·옷·자세)만, emotion 은 한 단어, toward 는 상대별 태도 한 구절. beat 는 이 교환을 한 줄로 요약한 사실 문장이다. JSON 외의 텍스트를 쓰지 않는다.',
    `현재 장면 상태:\n${current}`,
  ].filter(Boolean).join('\n\n')
  const body = exchanges.map((x) => `[${playerName}]\n${x.user}\n\n[응답]\n${x.assistant}`).join('\n\n---\n\n')
  const recipeHash = recipeHashOf({
    partId: 'scene-extractor', partVersion: EXTRACTION_VERSION,
    stateHash: sha256Hex(JSON.stringify(state ?? null)),
    exchangeHashes: exchanges.map((x) => sha256Hex(`${x.user}\u0000${x.assistant}`)),
    indicatorKeys: defs.map((d) => d.key),
  })
  return { system, messages: [{ role: 'user', text: body }], schema: schemaFor(names, defs), recipeHash, purpose: 'extract' }
}

export function parseExtractionOutput(text) {
  const raw = String(text || '')
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { const value = JSON.parse(raw.slice(start, end + 1)); return value && typeof value === 'object' ? value : null } catch { return null }
}

export function applyExtraction(state, rawText, { indicatorDefs = [], names = null, messageId = null, expectedRevision = null } = {}) {
  // 늦게 도착한 추출 결과가 그 사이 갱신된 상태를 덮어쓰면 안 된다. 호스트는 저장 시 revision CAS 를 함께 건다.
  if (expectedRevision !== null && (state?.revision ?? 0) !== expectedRevision) {
    return { state, beat: '', rejected: [`stale: revision 불일치 (기대 ${expectedRevision}, 현재 ${state?.revision ?? 0})`], parsed: false, stale: true }
  }
  const parsed = parseExtractionOutput(rawText)
  if (!parsed) return { state, beat: '', rejected: ['output: JSON 파싱 실패'], parsed: false, stale: false }
  const { beat, ...delta } = parsed
  const applied = applySceneDelta(state, delta, { indicatorDefs, names, messageId })
  return { state: applied.state, beat: typeof beat === 'string' ? beat.trim() : '', rejected: applied.rejected, parsed: true, stale: false }
}
