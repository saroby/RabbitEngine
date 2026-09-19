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

const sys = (kind, content, extra = {}) => ({ kind, role: 'system', slot: 'system', content, ...extra })
const at = (kind, depth, content, extra = {}) => ({ kind, role: 'system', slot: { depth }, content, ...extra })

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
  for (const entry of injected.manifest.filter((item) => item.injected)) {
    const content = substitute(entry.injectedText, names)
    const extra = { sourceId: entry.id, revisionId: entry.revisionId, strategy: entry.strategy }
    blocks.push(Number.isInteger(worldbookDepth) ? at('worldbook', worldbookDepth, content, extra) : sys('worldbook', content, extra))
  }

  blocks.push(sys('user_boundary', `상대(유저)의 호칭: ${names.user}. 유저의 행동과 대사를 대신 쓰지 않는다.`))
  if (enforceFormat) blocks.push(sys('output_contract', dialect.spec, { contract: parserVersionOf(dialect) }))

  // 호스트가 준 기억 노트(memoryNotes)는 depth 슬롯이다 — 최근 대화 근처에 둔다.
  const memoryText = (memoryNotes || []).map((note) => substitute(String(note?.text || ''), names).trim()).filter(Boolean).join('\n')
  if (memoryText) blocks.push(at('memory', DEFAULT_DEPTHS.memory, `${MEMORY_LABEL}\n${memoryText}`))
  if (String(sceneStateText || '').trim()) blocks.push(at('scene_state', DEFAULT_DEPTHS.scene_state, `[장면 상태]\n${sceneStateText.trim()}`))
  for (const event of events) if (String(event || '').trim()) blocks.push(at('event', DEFAULT_DEPTHS.event, `[사건]\n${String(event).trim()}`))
  if (String(directive || '').trim()) blocks.push({ kind: 'directive', role: 'system', slot: 'post_history', content: directive.trim() })

  return {
    blocks, names, compilerVersion: BLOCK_COMPILER_VERSION,
    worldbookManifest: injected.manifest,
    worldbookScan: { scanSource: injected.scanSource, usedChars: injected.usedChars, truncated: injected.truncated, budgetChars: injected.budgetChars },
  }
}
