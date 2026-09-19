// 한 턴의 요청을 만드는 권장 진입점. 기억 층과 프롬프트 층을 올바른 순서로
// 부르고 manifest 를 하나로 합친다.
//
// 왜 합치나: selectMemory 의 manifest 는 injectedText 가 비어서 나온다 —
// note 층의 최종 문자열은 {{char}} 치환과 라벨을 거친 뒤에야 확정되기 때문이다.
// 호출자가 그 빈칸을 채우게 두면, 안 채워도 대화는 잘 돌아가고 증거만 반쪽이
// 된다. 조용히 틀리는 자리는 라이브러리가 닫는다.
import { selectMemory } from './memory/index.js'
import { selectContext } from './memory/legacy-strategies.js'
import { compileBlocks } from './prompt/blocks.js'
import { PROMPT_COMPILER_VERSION } from './prompt/compile.js'
import { renderTurn } from './prompt/render.js'
import { isReal } from './memory/projection.js'
import { koreanPlayscript } from './dialect/korean-playscript.js'
import { assertRating, ratingInstruction } from './scene/rating.js'
import { renderSceneState, validateIndicatorDefs } from './scene/state.js'
import { analyzeUserInput } from './scene/input.js'
import { buildDirective } from './scene/directive.js'

/** 응답의 호흡. normal 은 아무 문장도 넣지 않는다 — 기본값이 프롬프트를 늘리지 않게 한다. */
export const PACING_TEXT = Object.freeze({
  slow: '페이싱: 천천히. 한 응답에 작은 변화 하나.',
  normal: '',
  eventful: '페이싱: 적극적으로. 인물이 먼저 움직이고 사건을 만든다.',
})

/**
 * 한 턴의 요청을 만든다. 이 라이브러리의 권장 진입점이다.
 * 모델은 부르지 않는다 — 돌려받은 system 과 messages 를 당신의 LLM 호출에 넣는다.
 * @param {import('./types.js').TurnInput} input
 * @param {import('./types.js').EngineContext} [ctx]
 * @returns {Promise<import('./types.js').Turn>}
 */
export async function buildTurn(input = {}, ctx = {}) {
  // 구조분해 기본값은 undefined 만 잡는다. 저장된 세션은 memory: null 을 들고
  // 있을 법하고, 그때 날것의 TypeError 가 나면 무엇이 잘못됐는지 안 보인다.
  const raw = input ?? {}
  const dialect = raw.dialect ?? koreanPlayscript
  const cards = raw.cards
  const player = raw.player ?? null
  const instruction = raw.instruction ?? ''
  const worldbooks = raw.worldbooks ?? []
  const worldbookOverrides = raw.worldbookOverrides ?? {}
  const worldbookOptions = raw.worldbookOptions ?? {}
  const messages = raw.messages ?? []
  const memory = raw.memory ?? {}
  const userName = raw.userName ?? '유저'
  const enforceFormat = raw.enforceFormat ?? true
  const context = ctx ?? {}

  if (!Array.isArray(cards) || !cards.length) {
    throw new Error('buildTurn: cards 에 캐릭터 카드가 최소 하나 필요합니다')
  }
  // 평범한 객체를 방언으로 받으면 parse 가 없어 청킹이 한참 뒤에서 터진다.
  if (typeof dialect.parse !== 'function') {
    throw new Error('buildTurn: dialect 는 defineDialect 로 만든 방언이어야 합니다')
  }

  // 프리셋이 있으면 그것이 이기고, 옛 전략 이름만 있으면 어댑터로 간다 —
  // 저장된 세션이 { strategy: 'window' } 꼴을 들고 있다. 둘 다 없으면 이력을
  // 전부 보낸다. 조용히 잘라내는 기본값은 "왜 앞 내용을 잊었지" 를 라이브러리
  // 탓으로 만든다.
  const select = !memory.preset && memory.strategy ? selectContext : selectMemory
  const config = memory.preset || memory.strategy ? memory : { ...memory, preset: 'legacy-full' }

  // 이번 턴 입력은 기억 선택과 로어북 스캔에는 보여야 한다 — 안 보이면 "정전이야?" 가
  // 정전 로어북을 못 깨우고 검색 질의가 직전 턴이 된다. 다만 돌려주는 messages 와
  // render() 에는 한 번만 들어가야 하므로 transient 표식을 달아 뒤에서 걷어낸다.
  const userInput = typeof raw.userInput === 'string' ? raw.userInput : null
  const transient = userInput !== null ? { role: 'user', text: userInput, transient: true } : null
  const scanMessages = transient ? [...messages, transient] : messages
  // manifest 의 ordinal 계열은 스캔 배열 기준이라 임시 턴이 유령으로 남는다. 그 번호를
  // projection 과 같은 방식(isReal 로 거른 뒤의 길이)으로 구해 두고 아래에서 걷어낸다.
  const transientOrdinal = transient ? messages.filter(isReal).length : null
  const selected = await select(scanMessages, { ...config, dialect }, context)
  // 참조 동일성이 아니라 표식으로 거른다 — 기억 층이 객체를 복사해도 살아남게.
  const visibleMessages = transient ? selected.messages.filter((m) => m?.transient !== true) : selected.messages

  const rating = assertRating(raw.rating ?? 'all')
  const pacing = raw.pacing ?? 'normal'
  if (!Object.hasOwn(PACING_TEXT, pacing)) throw new Error(`buildTurn: pacing 은 ${Object.keys(PACING_TEXT).join(' | ')} 중 하나여야 합니다`)
  const indicatorDefs = validateIndicatorDefs(raw.indicatorDefs ?? [])
  const sceneStateText = raw.sceneState ? renderSceneState(raw.sceneState, { indicatorDefs }) : ''
  const names = cards.map((c) => c.name)
  const analysis = userInput !== null ? analyzeUserInput(dialect, userInput, { names }) : { actions: [], speech: [] }
  const directive = buildDirective({
    rating,
    actions: analysis.actions,
    hasState: Boolean(sceneStateText),
    continuing: Boolean(raw.continuing),
  })

  const compiled = compileBlocks({
    dialect,
    enforceFormat,
    cards,
    playerCard: player,
    instructionText: instruction,
    ratingInstruction: ratingInstruction(rating),
    pacingText: PACING_TEXT[pacing],
    worldbooks,
    worldbookOverrides,
    // 로어북 스캔 설정은 기억 프리셋이 정한다. 호출자가 준 값이 그 위를 덮는다.
    worldbookOptions: { ...selected.manifest.worldbook, ...worldbookOptions },
    worldbookDepth: raw.worldbookDepth ?? null,
    messages: selected.messages,
    rawMessages: scanMessages,
    contextNotes: selected.notes,
    memoryNotes: raw.memoryNotes ?? [],
    sceneStateText,
    events: raw.events ?? [],
    directive,
    userName,
  })
  const systemBlocks = compiled.blocks.filter((block) => block.slot === 'system')

  // 임시 턴은 스캔에만 있었던 것이라 증거에 남기면 "있지도 않은 5번째 메시지를 골랐다" 가 된다.
  // 지운 사실 자체는 scene.userInputOrdinal 로 추적할 수 있게 남긴다.
  const dropTransient = (list) => (Array.isArray(list) ? list.filter((ordinal) => ordinal !== transientOrdinal) : list)
  const memoryManifest = transientOrdinal === null ? selected.manifest : {
    ...selected.manifest,
    chunkBoundaries: dropTransient(selected.manifest.chunkBoundaries),
    openChunkOrdinals: dropTransient(selected.manifest.openChunkOrdinals),
    selectedOrdinals: dropTransient(selected.manifest.selectedOrdinals),
    retrievedOrdinals: dropTransient(selected.manifest.retrievedOrdinals),
    hiddenOrdinals: dropTransient(selected.manifest.hiddenOrdinals),
    retrievalScores: Array.isArray(selected.manifest.retrievalScores)
      ? selected.manifest.retrievalScores.filter((score) => score.ordinal !== transientOrdinal)
      : selected.manifest.retrievalScores,
  }

  // 기억 층이 실제로 모델에 보낸 최종 문자열. 치환과 라벨을 거친 뒤의 값이라
  // selectMemory 혼자서는 알 수 없다. memoryNotes 로 온 것은 depth 슬롯이라
  // system 문자열 안에는 없다 — 그래도 "기억으로 보낸 것" 의 증거는 여기 모은다.
  const injectedText = compiled.blocks
    .filter((block) => block.kind.startsWith('context_') || block.kind === 'memory')
    .map((block) => block.content)
    .join('\n\n') || null

  return {
    system: systemBlocks.map((block) => block.content).join('\n\n'),
    blocks: compiled.blocks,
    messages: visibleMessages,
    directive,
    render: (options = {}) => renderTurn(compiled.blocks, visibleMessages, { userInput, ...options }),
    manifest: {
      ...memoryManifest,
      injectedText,
      // enforceFormat 이 false 여도 방언은 그대로 보고한다 — 규약 층만 빠질 뿐
      // 청킹은 여전히 이 방언으로 씬 경계를 잡고, 그 이름이 캐시 키에 들어간다.
      dialect: { id: dialect.id, version: dialect.version },
      // post_history 는 system 권한이 아니라 마지막 user 메시지에 붙는다. 그 사실을 값으로 남긴다.
      scene: {
        rating,
        pacing,
        hasState: Boolean(sceneStateText),
        actions: analysis.actions,
        userInputScanned: transient !== null,
        userInputOrdinal: transientOrdinal,
        renderedAs: { midRole: 'user', postHistory: 'appended-to-user' },
      },
      prompt: {
        layers: systemBlocks.map(({ role, slot, trust, ...layer }) => layer),
        blocks: compiled.blocks,
        names: compiled.names,
        // layers 의 의미가 그대로라 compilerVersion 은 유지한다. 실제로 조립한 것은
        // compileBlocks 이므로 그 버전은 옆에 따로 남긴다.
        compilerVersion: PROMPT_COMPILER_VERSION,
        blockCompilerVersion: compiled.compilerVersion,
        worldbookManifest: compiled.worldbookManifest,
        worldbookScan: compiled.worldbookScan,
      },
    },
  }
}
