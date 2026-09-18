// 요약을 다시 요약한다. SupaMemory(RisuAI)와 Memory Books(SillyTavern) 가
// "요약이 쌓이면 그것을 또 접는다" 로 수렴한 자리다. 접는 규칙은 이진 카운터와
// 같다 — 닫힌 씬 요약을 앞에서부터 fanout 개씩 묶어 부모를 만들고, 부모가
// fanout 개 모이면 또 묶는다. 경계가 0번 씬부터 고정이라 새 씬이 하나 닫혀도
// 이미 만든 부모의 재료는 바뀌지 않는다 (증분 = 통짜).
//
// 최근 keepLeaves 개 씬은 접지 않는다. 방금 지난 장면은 세부가 필요하고, 오래된
// 장면은 줄거리만 있으면 된다 — Qvink 의 단기/장기 구분을 같은 이유로 가져온다.
//
// chunk-local 이 아니다. 대신 입력을 "순서 있는 자식 contentHash 목록" 으로
// 못박아(hierarchy.js) 자식이 바뀌면 그 조상만 무효화되게 한다.
import { definePart } from '../contract.js'
import { parseSummary } from '../compactors/scene.js'

export const DIGEST_PROMPT_VERSION = 'digest-v1'
export const DEFAULT_FANOUT = 4
export const DEFAULT_KEEP_LEAVES = 4

const SYSTEM = `너는 롤플레잉 대화의 여러 장면 요약을 시간 순서대로 하나의 줄거리로 합친다.

[보존할 것]
- 일어난 사건과 그 순서
- 인물이 내린 결정
- 관계의 변화 (처음과 지금이 어떻게 다른지)
- 새로 밝혀진 사실
- 주고받은 약속
- 아직 풀리지 않은 것

[버릴 것]
- 같은 사실의 반복
- 이미 해소된 떡밥의 과정 (결말만 남긴다)

[형식]
요약: (4~8문장. 나중에 이것만 읽고도 이야기를 이어갈 수 있게)
핵심어: (쉼표로 구분한 3~10개. 인물 이름과 고유명사를 우선한다)`

function renderChildren(children) {
  return children
    .map((child, index) => {
      const keywords = child.keywords?.length ? `\n핵심어: ${child.keywords.join(', ')}` : ''
      return `[구간 ${index + 1}]\n${child.text}${keywords}`
    })
    .join('\n\n')
}

/**
 * 접는 계획. 순수 함수라 LLM 없이도 "무엇이 무엇의 부모가 되는가" 를 검증한다.
 * 층마다 완성된 묶음만 부모를 만들고, 남는 것은 그 층에 그대로 둔다.
 * @param {number} count 접을 대상(오래된 씬)의 수
 * @param {number} fanout
 * @returns {Array<{ level: number, groups: Array<{ start: number, end: number }>, leftover: number }>}
 *   level 은 1부터. groups 의 start/end 는 그 층 입력 배열의 색인(end 미포함).
 */
export function planFold(count, fanout = DEFAULT_FANOUT) {
  const width = Math.max(2, Number(fanout) || DEFAULT_FANOUT)
  const levels = []
  let remaining = Math.max(0, Number(count) || 0)
  let level = 1
  while (remaining >= width) {
    const complete = Math.floor(remaining / width)
    const groups = Array.from({ length: complete }, (_, g) => ({ start: g * width, end: (g + 1) * width }))
    levels.push({ level, groups, leftover: remaining - complete * width })
    remaining = complete
    level += 1
  }
  return levels
}

export const digestReducer = definePart({
  partId: 'digest',
  partVersion: 1,
  kind: 'reducer',
  promptTemplateHash: DIGEST_PROMPT_VERSION,

  async buildParent({ children = [], level = 1, config = {}, llm }) {
    if (!llm) throw new Error('digest 리듀서에 요약 호출자(llm)가 없습니다')
    if (children.length < 2) throw new Error('digest 리듀서는 자식이 둘 이상이어야 합니다 — 하나면 접을 것이 없습니다')
    const started = Date.now()
    const out = await llm({
      model: config.model,
      provider: config.provider,
      system: SYSTEM,
      messages: [{ role: 'user', text: renderChildren(children) }],
      maxTokens: config.maxTokens ?? 700,
    })
    const { summary, keywords } = parseSummary(out?.text)
    if (!summary) throw new Error('digest 리듀서가 빈 요약을 받았습니다')

    return {
      artifacts: [{ kind: 'digest', text: summary, keywords, level }],
      calls: [{
        provider: out?.provider || config.provider || 'unknown',
        model: config.model || 'unknown',
        partId: 'digest',
        purpose: 'reduce',
        promptTokens: out?.usage?.input ?? 0,
        completionTokens: out?.usage?.output ?? 0,
        ms: out?.latencyMs ?? (Date.now() - started),
        outcome: 'success',
        cacheHit: false,
      }],
    }
  },
})
