// 닫힌 chunk 하나를 요약으로 접는다. Memory Books(SillyTavern) 가 보존 대상으로
// 못박은 여섯 가지를 그대로 가져온다 — 사건·결정·관계·발견·약속·미해결 떡밥.
// 롤플레이에서 실제로 필요한 것이 정확히 이 여섯이라는 것이 그 생태계의 결론이다.
//
// chunk-local 이다. 이 chunk 밖은 보지 않는다 — 그래야 증분 빌드와 통짜 빌드가
// 같은 산출물을 만든다 (spec: 증분 = 통짜).
import { definePart } from '../contract.js'

export const SCENE_PROMPT_VERSION = 'scene-v1'

const SYSTEM = `너는 롤플레잉 대화의 한 장면을 요약한다.

[보존할 것]
- 일어난 사건
- 인물이 내린 결정
- 관계의 변화
- 새로 밝혀진 사실
- 주고받은 약속
- 아직 풀리지 않은 것

[버릴 것]
- 장면을 앞으로 밀지 않는 묘사 ("그는 그녀를 바라본다", "잠시 침묵이 흘렀다")
- 같은 말의 반복

[형식]
요약: (3~6문장. 나중에 이것만 읽고도 이야기를 이어갈 수 있게)
핵심어: (쉼표로 구분한 3~8개. 인물 이름과 고유명사를 우선한다)`

function renderChunk(chunk, texts) {
  return chunk.entries
    .map((entry) => `${entry.role === 'user' ? '유저' : '상대'}: ${texts[entry.ordinal] ?? ''}`)
    .join('\n')
}

export function parseSummary(text) {
  const body = String(text || '')
  const summary = body.match(/요약\s*[::]\s*([\s\S]*?)(?=\n핵심어\s*[::]|$)/)?.[1]?.trim() || body.trim()
  const keywordLine = body.match(/핵심어\s*[::]\s*(.+)/)?.[1] || ''
  const keywords = keywordLine.split(',').map((k) => k.trim()).filter(Boolean)
  return { summary, keywords }
}

export const sceneCompactor = definePart({
  partId: 'scene',
  partVersion: 1,
  kind: 'compactor',
  promptTemplateHash: SCENE_PROMPT_VERSION,

  /**
   * @param {{ chunk: object, texts?: string[], config?: { provider?: string, model?: string, maxTokens?: number }, llm?: (request: object) => Promise<object> }} args
   */
  async build({ chunk, texts = [], config = {}, llm }) {
    if (!llm) throw new Error('scene 압축기에 요약 호출자(llm)가 없습니다')
    const started = Date.now()
    const out = await llm({
      model: config.model,
      provider: config.provider,
      system: SYSTEM,
      messages: [{ role: 'user', text: renderChunk(chunk, texts) }],
      maxTokens: config.maxTokens ?? 500,
    })
    const { summary, keywords } = parseSummary(out?.text)
    if (!summary) throw new Error('scene 압축기가 빈 요약을 받았습니다')

    return {
      artifacts: [{ kind: 'scene', text: summary, keywords }],
      // 계약이다. 안 내면 등록·실행 어디서든 걸린다 — 이걸 빠뜨리면
      // "요약 프리셋이 더 좋다" 는 결론이 숨은 호출을 공짜로 친 결과가 된다.
      calls: [{
        provider: out?.provider || config.provider || 'unknown',
        model: config.model || 'unknown',
        partId: 'scene',
        purpose: 'compact',
        promptTokens: out?.usage?.input ?? 0,
        completionTokens: out?.usage?.output ?? 0,
        ms: out?.latencyMs ?? (Date.now() - started),
        outcome: 'success',
        cacheHit: false,
      }],
    }
  },
})
