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

export async function buildTurn(input = {}, ctx = {}) {
  const {
    dialect = koreanPlayscript,
    cards,
    player = null,
    instruction = '',
    worldbooks = [],
    worldbookOverrides = {},
    worldbookOptions = {},
    messages = [],
    memory = {},
    userName = '유저',
  } = input

  if (!Array.isArray(cards) || !cards.length) {
    throw new Error('buildTurn: cards 에 캐릭터 카드가 최소 하나 필요합니다')
  }

  // 프리셋이 있으면 그것이 이기고, 옛 전략 이름만 있으면 어댑터로 간다 —
  // 저장된 세션이 { strategy: 'window' } 꼴을 들고 있다. 둘 다 없으면 이력을
  // 전부 보낸다. 조용히 잘라내는 기본값은 "왜 앞 내용을 잊었지" 를 라이브러리
  // 탓으로 만든다.
  const select = !memory.preset && memory.strategy ? selectContext : selectMemory
  const config = memory.preset || memory.strategy ? memory : { ...memory, preset: 'legacy-full' }
  const selected = await select(messages, { ...config, dialect }, ctx)

  const compiled = compilePrompt({
    dialect,
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
