// 의미로 찾는 검색기. bigram 은 글자가 겹쳐야 찾지만, 이것은 "열쇠" 로 물어도
// "자물쇠를 열었다" 를 찾는다. HypaMemory V3(RisuAI) 와 Memory Books 의
// 벡터화가 하는 일을 부품 하나로 옮겼다.
//
// 임베딩도 엔진이 부르지 않는다 — 호스트가 ctx.embed 로 건넨 호출자를 쓴다.
// 벡터는 산출물 저장소에 본문 해시로 캐시한다. 같은 대사를 턴마다 다시
// 임베딩하면 검색이 요약보다 비싸진다.
//
// 대상은 둘이다. 'messages' 는 창 밖 원문을 끌어온다(vector 프리셋의 의미판).
// 'artifacts' 는 요약 산출물 중 지금 상황과 닿는 것만 고른다 — 요약이 수십 개
// 쌓이면 전부 넣을 수 없고, 예산 순서로 앞부터 자르면 가장 최근 것이 먼저
// 떨어진다. 관련도로 고르는 것이 이 부품의 존재 이유다.
import { definePart } from '../contract.js'
import { recipeHashOf } from '../recipe.js'
import { hashText } from '../projection.js'

export const DEFAULT_MIN_SCORE = 0.35
export const DEFAULT_BATCH_SIZE = 64

export function cosineSimilarity(a = [], b = []) {
  const length = Math.min(a.length, b.length)
  if (!length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 벡터 하나의 캐시 키. 임베딩 모델이 바뀌면 같은 본문도 다른 벡터라 키에 넣는다.
function recipeOf(config, textHash) {
  return recipeHashOf({
    partId: 'embedding',
    partVersion: 1,
    embedder: { provider: config.provider ?? null, model: config.model ?? null },
    textHash,
  })
}

// 후보를 벡터로 바꾼다. 캐시에 있는 것은 부르지 않고, 없는 것만 한 번에 묶어 부른다.
async function embedAll(items, { config, embed, cache, buildIfMissing }) {
  const vectors = new Map()
  const calls = []
  const cold = []
  const recipeHashes = []
  const missing = []
  let cacheHit = true

  for (const item of items) {
    const recipeHash = recipeOf(config, item.textHash)
    recipeHashes.push(recipeHash)
    const cached = cache ? await cache.find(recipeHash) : null
    if (cached?.vector) { vectors.set(item.key, cached.vector); continue }
    cacheHit = false
    if (!buildIfMissing) { cold.push({ recipeHash, chunkOrdinal: null, partId: 'embedding', key: item.key }); continue }
    missing.push({ ...item, recipeHash })
  }

  if (missing.length && !embed) throw new Error('embedding 검색기에 임베딩 호출자(embed)가 없습니다')

  const batchSize = Math.max(1, Number(config.batchSize) || DEFAULT_BATCH_SIZE)
  for (let start = 0; start < missing.length; start += batchSize) {
    const batch = missing.slice(start, start + batchSize)
    const started = Date.now()
    const out = await embed({ texts: batch.map((item) => item.text), model: config.model, provider: config.provider })
    const produced = Array.isArray(out?.vectors) ? out.vectors : null
    if (!produced || produced.length !== batch.length) {
      throw new Error(`embedding 호출자가 ${batch.length}개를 받고 ${produced?.length ?? 0}개를 돌려줬습니다`)
    }
    calls.push({
      provider: out?.provider || config.provider || 'unknown',
      model: out?.model || config.model || 'unknown',
      partId: 'embedding',
      purpose: 'embed',
      promptTokens: out?.usage?.input ?? 0,
      completionTokens: 0,
      ms: out?.latencyMs ?? (Date.now() - started),
      outcome: 'success',
      cacheHit: false,
    })
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index]
      const vector = Array.from(produced[index], Number)
      vectors.set(item.key, vector)
      if (cache) await cache.put({ recipeHash: item.recipeHash, textHash: item.textHash, vector })
    }
  }
  return { vectors, calls, cold, recipeHashes, cacheHit }
}

export const embeddingRetriever = definePart({
  partId: 'embedding',
  partVersion: 1,
  kind: 'retriever',

  /**
   * @param {object} input
   * @param {object[]} input.entries projectMessages 의 결과
   * @param {string[]} input.texts 같은 순서의 본문
   * @param {object[]} [input.artifacts] 요약 산출물 (targets 에 'artifacts' 가 있을 때 후보)
   * @param {number} input.windowSize 창 크기 — 창 안은 후보가 아니다
   * @param {number} input.limit 대상마다 최대 몇 개를 끌어올지
   * @param {object} [input.config] `{ provider, model, minScore, targets, keepKinds, batchSize }`
   * @param {Function} [input.embed] 호스트의 임베딩 호출자
   * @param {{ find: Function, put: Function } | null} [input.cache] 벡터 캐시
   * @param {boolean} [input.buildIfMissing]
   */
  async retrieve({
    entries = [], texts = [], artifacts = [], windowSize, limit,
    config = {}, embed = null, cache = null, buildIfMissing = true,
  }) {
    const empty = { messages: [], artifacts: [], calls: [], cold: [], recipeHashes: [], cacheHit: true }
    const targets = Array.isArray(config.targets) && config.targets.length ? config.targets : ['messages']
    const keepKinds = new Set(config.keepKinds || [])
    const minScore = Number.isFinite(config.minScore) ? config.minScore : DEFAULT_MIN_SCORE

    // 질의는 창 안의 마지막 유저 발화다 — bigram 과 같은 규칙. 유저가 없으면 마지막 줄.
    const splitAt = Math.max(0, entries.length - windowSize)
    const recent = entries.slice(splitAt)
    const query = [...recent].reverse().find((entry) => entry.role === 'user') ?? entries.at(-1)
    const queryText = query ? texts[query.ordinal] ?? '' : ''
    if (!String(queryText).trim()) return empty

    const items = [{ key: 'query', text: queryText, textHash: hashText(queryText) }]
    const messageCandidates = targets.includes('messages')
      ? entries.slice(0, splitAt).filter((entry) => String(texts[entry.ordinal] ?? '').trim())
      : []
    for (const entry of messageCandidates) {
      items.push({ key: `m:${entry.ordinal}`, text: texts[entry.ordinal], textHash: entry.textHash })
    }
    const artifactCandidates = targets.includes('artifacts')
      ? artifacts.map((artifact, index) => ({ artifact, index })).filter(({ artifact }) => String(artifact?.text ?? '').trim())
      : []
    for (const { artifact, index } of artifactCandidates) {
      if (keepKinds.has(artifact.kind)) continue
      items.push({ key: `a:${index}`, text: artifact.text, textHash: hashText(artifact.text) })
    }
    if (items.length === 1 && !artifactCandidates.length) return empty

    const embedded = await embedAll(items, { config, embed, cache, buildIfMissing })
    const queryVector = embedded.vectors.get('query')
    const report = { calls: embedded.calls, cold: embedded.cold, recipeHashes: embedded.recipeHashes, cacheHit: embedded.cacheHit }
    if (!queryVector) return { ...empty, ...report }

    const scoreOf = (key) => {
      const vector = embedded.vectors.get(key)
      return vector ? cosineSimilarity(queryVector, vector) : null
    }

    const messages = messageCandidates
      .map((entry) => ({ entry, score: scoreOf(`m:${entry.ordinal}`) }))
      .filter((row) => row.score !== null && row.score >= minScore)
      .sort((a, b) => b.score - a.score || b.entry.ordinal - a.entry.ordinal)
      .slice(0, limit)
      .sort((a, b) => a.entry.ordinal - b.entry.ordinal)
      .map((row) => ({ ordinal: row.entry.ordinal, ref: row.entry.messageId, score: row.score, text: texts[row.entry.ordinal] }))

    // keepKinds 는 점수와 무관하게 남는다 — 전체 줄거리(digest)는 지금 질문과
    // 닮지 않아도 있어야 한다. HypaMemory 의 "최근 비율 + 유사 비율" 과 같은 발상.
    const kept = artifactCandidates
      .filter(({ artifact }) => keepKinds.has(artifact.kind))
      .map(({ artifact, index }) => ({ index, id: artifact.id ?? null, kind: artifact.kind, score: null }))
    const picked = artifactCandidates
      .filter(({ artifact }) => !keepKinds.has(artifact.kind))
      .map(({ artifact, index }) => ({ index, id: artifact.id ?? null, kind: artifact.kind, score: scoreOf(`a:${index}`) }))
      .filter((row) => row.score !== null && row.score >= minScore)
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, limit)
    const pickedArtifacts = [...kept, ...picked].sort((a, b) => a.index - b.index)

    return { messages, artifacts: pickedArtifacts, ...report }
  },
})
