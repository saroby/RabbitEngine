import {
  SCRIPT_FORMAT,
  namesOf,
  renderCard,
  renderCast,
  renderPlayerCard,
  substitute,
  substituteCard,
} from './parts.js'
import { injectWorldbooksWithManifest } from '../worldbook/strategies.js'
import { MEMORY_LABEL } from '../memory/defaults.js'

export const PROMPT_COMPILER_VERSION = 'prompt-v3'

// 라벨을 프리셋마다 다르게 하면 자동 생성 프리셋에만 "부정확할 수 있음" 류의
// 문장이 하나 더 붙는다. 그러면 기억 기법의 차이가 아니라 헤지 문장의 효과를
// 재게 된다. 출처는 manifest 와 화면에만 남긴다 (spec: 기억 층 라벨).
function noteLayer(note, names) {
  return { kind: `context_${note.kind}`, content: `${MEMORY_LABEL}\n${substitute(note.text, names)}` }
}

export function compilePrompt({
  cards,
  card,
  playerCard,
  instructionText,
  worldbooks = [],
  worldbookOverrides = {},
  worldbookOptions = {},
  messages = [],
  rawMessages = null,
  contextNotes = [],
  enforceFormat = true,
  userName = '유저',
} = {}) {
  const list = (cards?.length ? cards : [card]).filter(Boolean)
  const names = namesOf({ card: list[0], playerCard, userName })
  const layers = []

  if (instructionText) layers.push({ kind: 'instruction', content: substitute(instructionText, names) })
  for (const source of list) {
    const content = renderCard(substituteCard(source, names))
    if (content) layers.push({ kind: 'character', sourceId: source.id || null, revisionId: source.revisionId || null, content })
  }
  const cast = renderCast(list)
  if (cast) layers.push({ kind: 'cast', content: cast })
  const player = renderPlayerCard(substituteCard(playerCard, names), names)
  if (player) layers.push({ kind: 'player', sourceId: playerCard?.id || null, revisionId: playerCard?.revisionId || null, content: player })
  for (const note of contextNotes) if (String(note?.text || '').trim()) layers.push(noteLayer(note, names))

  // rawMessages 를 함께 넘긴다 — scanSource:'raw' 일 때 기억이 무엇을 숨겼든
  // 로어북 발동이 같아야 두 축이 직교한다 (spec: 로어북 축과의 직교성).
  const injected = injectWorldbooksWithManifest(worldbooks, messages, worldbookOverrides, {
    ...worldbookOptions,
    rawMessages: rawMessages || messages,
  })
  for (const entry of injected.manifest.filter((item) => item.injected)) {
    layers.push({
      kind: 'worldbook',
      sourceId: entry.id,
      revisionId: entry.revisionId,
      strategy: entry.strategy,
      content: substitute(entry.injectedText, names),
    })
  }
  layers.push({ kind: 'user_boundary', content: `상대(유저)의 호칭: ${names.user}. 유저의 행동과 대사를 대신 쓰지 않는다.` })
  if (enforceFormat) layers.push({ kind: 'output_contract', contract: 'script-v1', content: SCRIPT_FORMAT })

  return {
    system: layers.map((layer) => layer.content).join('\n\n'),
    layers,
    names,
    compilerVersion: PROMPT_COMPILER_VERSION,
    worldbookManifest: injected.manifest,
    worldbookScan: {
      scanSource: injected.scanSource,
      usedChars: injected.usedChars,
      truncated: injected.truncated,
      budgetChars: injected.budgetChars,
    },
  }
}
