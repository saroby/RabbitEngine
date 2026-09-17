// 한 턴의 요청을 만드는 권장 진입점. 기억 층과 프롬프트 층을 올바른 순서로
// 부르고 manifest 를 하나로 합친다.
//
// 왜 합치나: selectMemory 의 manifest 는 injectedText 가 비어서 나온다 —
// note 층의 최종 문자열은 {{char}} 치환과 라벨을 거친 뒤에야 확정되기 때문이다.
// 호출자가 그 빈칸을 채우게 두면, 안 채워도 대화는 잘 돌아가고 증거만 반쪽이
// 된다. 조용히 틀리는 자리는 라이브러리가 닫는다.
import { selectMemory } from './memory/index.js'
import { selectContext } from './memory/legacy-strategies.js'
import { compilePrompt } from './prompt/compile.js'
import { koreanPlayscript } from './dialect/korean-playscript.js'

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
  const selected = await select(messages, { ...config, dialect }, context)

  const compiled = compilePrompt({
    dialect,
    enforceFormat,
    cards,
    playerCard: player,
    instructionText: instruction,
    worldbooks,
    worldbookOverrides,
    // 로어북 스캔 설정은 기억 프리셋이 정한다. 호출자가 준 값이 그 위를 덮는다.
    worldbookOptions: { ...selected.manifest.worldbook, ...worldbookOptions },
    messages: selected.messages,
    rawMessages: messages,
    contextNotes: selected.notes,
    userName,
  })

  // 기억 층이 실제로 모델에 보낸 최종 문자열. 치환과 라벨을 거친 뒤의 값이라
  // selectMemory 혼자서는 알 수 없다.
  const injectedText = compiled.layers
    .filter((layer) => layer.kind.startsWith('context_'))
    .map((layer) => layer.content)
    .join('\n\n') || null

  return {
    system: compiled.system,
    messages: selected.messages,
    manifest: {
      ...selected.manifest,
      injectedText,
      // enforceFormat 이 false 여도 방언은 그대로 보고한다 — 규약 층만 빠질 뿐
      // 청킹은 여전히 이 방언으로 씬 경계를 잡고, 그 이름이 캐시 키에 들어간다.
      dialect: { id: dialect.id, version: dialect.version },
      prompt: {
        layers: compiled.layers,
        names: compiled.names,
        compilerVersion: compiled.compilerVersion,
        worldbookManifest: compiled.worldbookManifest,
        worldbookScan: compiled.worldbookScan,
      },
    },
  }
}
