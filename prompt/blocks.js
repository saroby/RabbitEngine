// 프롬프트를 "위치가 있는 블록" 으로 조립한다. system 한 문자열이 아니라
// system / depth N / post_history 슬롯이 있어야 이력 뒤 지시와 장면 상태가
// 모델에 가까운 자리에 갈 수 있다 (spec: 섹션 1).
import { namesOf, renderCard, renderCast, renderPlayerCard, substitute, substituteCard } from './parts.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { parserVersionOf } from '../dialect/define.js'
import { injectWorldbooksWithManifest } from '../worldbook/strategies.js'
import { MEMORY_LABEL } from '../memory/defaults.js'

export const BLOCK_COMPILER_VERSION = 'blocks-v1'
export const DEFAULT_DEPTHS = Object.freeze({ memory: 4, scene_state: 2, event: 0 })

// 블록의 출처 신뢰도. 'engine' 은 엔진이 쓴 문장, 'curated' 는 사람이 쓴 카드·로어북·기억이다.
// 프롬프트 주입 방어의 근거라 값으로 남긴다 — 분류가 아니라 증거다.
const ENGINE_KINDS = new Set(['instruction', 'rating', 'pacing', 'user_boundary', 'output_contract', 'scene_state', 'event', 'directive'])
const trustOf = (kind) => (ENGINE_KINDS.has(kind) ? 'engine' : 'curated')
const sys = (kind, content, extra = {}) => ({ kind, role: 'system', slot: 'system', trust: trustOf(kind), content, ...extra })
const at = (kind, depth, content, extra = {}) => ({ kind, role: 'system', slot: { depth }, trust: trustOf(kind), content, ...extra })

/**
 * 프롬프트를 위치가 있는 블록 목록으로 조립한다.
 * @param {object} [options]
 * @param {object[]} [options.cards] 캐릭터 카드 목록. 첫 장이 주인공이다
 * @param {object} [options.card] 카드 한 장만 줄 때의 하위 호환 입력
 * @param {object} [options.playerCard] 플레이어(유저) 카드
 * @param {string} [options.instructionText] 시스템 지시문
 * @param {string} [options.ratingInstruction] 등급 문장 (scene/rating.js)
 * @param {string} [options.pacingText] 호흡 문장
 * @param {object[]} [options.worldbooks] 로어북. 항목에 정수 depth 가 있으면 그 항목만 그 자리로 간다
 * @param {object} [options.worldbookOverrides] 항목별 전략 덮어쓰기
 * @param {object} [options.worldbookOptions] 스캔 설정 (scanSource·budgetChars)
 * @param {number | null} [options.worldbookDepth] 항목별 depth 가 없을 때 쓰는 전역 depth
 * @param {Array<{ role: string, text: string }>} [options.messages] 기억 층이 고른 이력
 * @param {Array<{ role: string, text: string }> | null} [options.rawMessages] 로어북 raw 스캔용 원본 이력
 * @param {Array<{ kind: string, text: string }>} [options.contextNotes] 기억 층 노트 (system 슬롯 context_*)
 * @param {Array<{ kind: string, text: string }> | null} [options.memoryNotes] 호스트 기억 노트 (depth 슬롯)
 * @param {string} [options.sceneStateText] 렌더된 장면 상태
 * @param {string[]} [options.events] 히든 사건
 * @param {string} [options.directive] 이력 뒤에 붙는 짧은 지시
 * @param {object} [options.dialect] 대본 방언
 * @param {boolean} [options.enforceFormat] false 면 규약 블록을 넣지 않는다
 * @param {string} [options.userName] {{user}} 에 들어갈 이름
 * @returns {{ blocks: object[], names: { char: string, user: string }, compilerVersion: string, worldbookManifest: object[], worldbookScan: object }}
 */
export function compileBlocks({
  cards, card, playerCard, instructionText, ratingInstruction, pacingText,
  worldbooks = [], worldbookOverrides = {}, worldbookOptions = {}, worldbookDepth = null,
  messages = [], rawMessages = null,
  contextNotes = [], memoryNotes = null,
  sceneStateText = '', events = [], directive = '',
  dialect = koreanPlayscript, enforceFormat = true, userName = '유저',
} = {}) {
  const list = (cards?.length ? cards : [card]).filter(Boolean)
  const names = namesOf({ card: list[0], playerCard, userName })
  const blocks = []

  if (instructionText) blocks.push(sys('instruction', substitute(instructionText, names)))
  if (ratingInstruction) blocks.push(sys('rating', ratingInstruction))
  if (pacingText) blocks.push(sys('pacing', pacingText))
  for (const source of list) {
    const content = renderCard(substituteCard(source, names))
    if (content) blocks.push(sys('character', content, { sourceId: source.id || null, revisionId: source.revisionId || null }))
  }
  const cast = renderCast(list)
  if (cast) blocks.push(sys('cast', cast))
  const player = renderPlayerCard(substituteCard(playerCard, names), names)
  if (player) blocks.push(sys('player', player, { sourceId: playerCard?.id || null, revisionId: playerCard?.revisionId || null }))

  // contextNotes(기억 층이 고른 노트)는 하위 호환으로 system 슬롯의 context_* 로 남긴다.
  for (const note of contextNotes) {
    if (String(note?.text || '').trim()) blocks.push(sys(`context_${note.kind}`, `${MEMORY_LABEL}\n${substitute(note.text, names)}`))
  }

  const injected = injectWorldbooksWithManifest(worldbooks, messages, worldbookOverrides, { ...worldbookOptions, rawMessages: rawMessages || messages })
  // manifest 는 worldbooks 와 1:1 로 같은 순서로 쌓이므로 색인으로 원본 항목을 찾는다.
  // manifest 에 depth 를 얹지 않는 이유는 그것이 증거 스냅샷의 모양을 바꾸기 때문이다.
  for (const [index, entry] of injected.manifest.entries()) {
    if (!entry.injected) continue
    const content = substitute(entry.injectedText, names)
    const extra = { sourceId: entry.id, revisionId: entry.revisionId, strategy: entry.strategy }
    // 항목별 depth 가 전역 worldbookDepth 를 이긴다 — "이 설정만 최근 대화 옆에" 가
    // 로어북의 실제 쓰임이라, 전부 같은 자리로 보내면 손잡이가 무의미해진다.
    const own = worldbooks[index]?.depth
    const depth = Number.isInteger(own) && own >= 0 ? own : worldbookDepth
    blocks.push(Number.isInteger(depth) ? at('worldbook', depth, content, extra) : sys('worldbook', content, extra))
  }

  blocks.push(sys('user_boundary', `상대(유저)의 호칭: ${names.user}. 유저의 행동과 대사를 대신 쓰지 않는다.`))
  if (enforceFormat) blocks.push(sys('output_contract', dialect.spec, { contract: parserVersionOf(dialect) }))

  // 호스트가 준 기억 노트(memoryNotes)는 depth 슬롯이다 — 최근 대화 근처에 둔다.
  const memoryText = (memoryNotes || []).map((note) => substitute(String(note?.text || ''), names).trim()).filter(Boolean).join('\n')
  if (memoryText) blocks.push(at('memory', DEFAULT_DEPTHS.memory, `${MEMORY_LABEL}\n${memoryText}`))
  if (String(sceneStateText || '').trim()) blocks.push(at('scene_state', DEFAULT_DEPTHS.scene_state, `[장면 상태]\n${sceneStateText.trim()}`))
  for (const event of events) if (String(event || '').trim()) blocks.push(at('event', DEFAULT_DEPTHS.event, `[사건]\n${String(event).trim()}`))
  if (String(directive || '').trim()) blocks.push({ kind: 'directive', role: 'system', slot: 'post_history', trust: 'engine', content: directive.trim() })

  return {
    blocks, names, compilerVersion: BLOCK_COMPILER_VERSION,
    worldbookManifest: injected.manifest,
    worldbookScan: { scanSource: injected.scanSource, usedChars: injected.usedChars, truncated: injected.truncated, budgetChars: injected.budgetChars },
  }
}
