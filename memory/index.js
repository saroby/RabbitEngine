// 기억 계층의 유일한 진입점. 대화·연구·배치가 전부 이 함수를 부른다.
// 부품이 없는 프리셋(legacy)은 여기서 조립만 하고 끝나므로 LLM 도 캐시도
// 타지 않는다 — 그래서 기존 동작을 그대로 재현할 수 있다.
import { projectMessages, activeTextOf, isReal } from './projection.js'
import { chunkEntries, assertWindowInvariant, policyWith, hashablePolicyOf } from './chunking.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { assemble, boundedSize } from './assemble.js'
import { presetOf } from './presets.js'
import { bigramRetrieve } from './retrievers/bigram.js'
import { embeddingRetriever } from './retrievers/embedding.js'
import { sceneCompactor } from './compactors/scene.js'
import { digestReducer, planFold, DEFAULT_FANOUT, DEFAULT_KEEP_LEAVES } from './reducers/digest.js'
import { recipeHashOf, withLock } from './recipe.js'
import { validateCalls } from './contract.js'
import { contentHashOf } from './artifact-store.js'
import { LEGACY_RETRIEVAL_LIMIT } from './defaults.js'

const COMPACTORS = { scene: sceneCompactor }
const REDUCERS = { digest: digestReducer }
const RETRIEVERS = { embedding: embeddingRetriever }

// 닫힌 chunk 마다 산출물을 얻는다. 캐시에 있으면 부품을 부르지 않는다 — 그게
// 증분의 전부다 (부품은 prior 를 모른다). buildIfMissing 이 false 면 만들지
// 않고 없는 채로 둔다: freeze 가 조용히 돈을 쓰지 않게 하는 자리다.
async function gatherArtifacts({ preset, closed, texts, chunkPolicy, ctx }) {
  const part = COMPACTORS[preset.compactor]
  if (!part) return { artifacts: [], calls: [], cold: [], cacheHit: true, recipeHashes: [] }

  const { artifacts: store = null, scope = 'session', scopeId = 'none', llm, buildIfMissing = true } = ctx
  const builderConfig = preset.builder || {}
  const artifacts = []
  const calls = []
  const cold = []
  const recipeHashes = []
  let cacheHit = true

  for (const chunk of closed) {
    const recipeHash = recipeHashOf({
      partId: part.partId,
      partVersion: part.partVersion,
      chunkPolicy: hashablePolicyOf(chunkPolicy),
      config: builderConfig,
      builder: {
        provider: builderConfig.provider ?? null,
        model: builderConfig.model ?? null,
        params: { maxTokens: builderConfig.maxTokens ?? null },
        promptTemplateHash: part.promptTemplateHash ?? null,
      },
      inputs: chunk.entries.map((entry) => ({
        ordinal: entry.ordinal, role: entry.role, textHash: entry.textHash,
      })),
    })

    recipeHashes.push(recipeHash)
    // await 한다 — 소비자의 저장소는 SQLite·네트워크처럼 비동기일 수 있고,
    // 안 기다리면 Promise 가 "캐시에 있다" 로 읽혀 요약이 통째로 사라진다.
    const cached = store ? await store.find({ scope, scopeId, recipeHash }) : null
    if (cached) { artifacts.push(cached); continue }

    cacheHit = false
    if (!buildIfMissing) { cold.push({ recipeHash, chunkOrdinal: chunk.ordinal, partId: part.partId }); continue }

    // 같은 재료를 동시에 만들면 요약을 두 번 사고 last-write-wins 가 난다.
    const built = await withLock(`${scope}:${scopeId}:${recipeHash}`, () =>
      part.build({ chunk, texts, config: builderConfig, llm }))
    validateCalls(built.calls, part.partId)
    calls.push(...built.calls)

    for (const draft of built.artifacts) {
      const record = {
        scope, scopeId, presetId: preset.id,
        partId: part.partId, partVersion: part.partVersion,
        recipeHash,
        chunkOrdinal: chunk.ordinal,
        coversOrdinals: chunk.coversOrdinals,
        coversMessageIds: chunk.entries.map((e) => e.messageId).filter(Boolean),
        kind: draft.kind, text: draft.text, keywords: draft.keywords || [],
        buildCalls: built.calls,
      }
      artifacts.push(store ? await store.put(record) : { ...record, id: null })
    }
  }
  return { artifacts, calls, cold, cacheHit, recipeHashes }
}

// 저장소 없이 만든 산출물(id: null)은 contentHash 가 없다. 계층의 자식 식별자는
// 여기서 계산한다 — 저장소가 붙인 값과 같은 함수라 같은 값이 나온다.
const childHashOf = (artifact) => artifact.contentHash ?? contentHashOf(artifact)

// 씬 요약을 계층으로 접는다 (reducers/digest.js 의 planFold 가 계획, 여기는 실행).
// 최근 keepLeaves 개는 접지 않고, 나머지를 fanout 개씩 층층이 부모로 올린다.
// 돌려주는 nodes 는 시간 순서다: 높은 층(가장 오래된 구간)이 앞, 남은 잎이 뒤.
async function gatherDigests({ preset, leaves, ctx }) {
  const part = REDUCERS[preset.reducer]
  if (!part || !leaves.length) return { nodes: leaves, calls: [], cold: [], cacheHit: true, recipeHashes: [] }

  const { artifacts: store = null, scope = 'session', scopeId = 'none', llm, buildIfMissing = true } = ctx
  const config = preset.reducerBuilder || {}
  const fanout = Math.max(2, Number(config.fanout) || DEFAULT_FANOUT)
  const keepLeaves = Math.max(0, Number.isFinite(Number(config.keepLeaves)) ? Number(config.keepLeaves) : DEFAULT_KEEP_LEAVES)
  const recent = leaves.slice(Math.max(0, leaves.length - keepLeaves))
  let current = leaves.slice(0, Math.max(0, leaves.length - keepLeaves))

  const calls = []
  const cold = []
  const recipeHashes = []
  const leftovers = []
  let cacheHit = true
  let frozen = false

  for (const { level, groups } of planFold(current.length, fanout)) {
    const parents = []
    for (const group of groups) {
      const children = current.slice(group.start, group.end)
      const recipeHash = recipeHashOf({
        partId: part.partId,
        partVersion: part.partVersion,
        level,
        childHashes: children.map(childHashOf),
        config,
        builder: {
          provider: config.provider ?? null,
          model: config.model ?? null,
          params: { maxTokens: config.maxTokens ?? null },
          promptTemplateHash: part.promptTemplateHash ?? null,
        },
      })
      recipeHashes.push(recipeHash)
      const cached = store ? await store.find({ scope, scopeId, recipeHash }) : null
      if (cached) { parents.push(cached); continue }

      cacheHit = false
      // 부모 하나라도 못 만들면 이 층에서 멈춘다. 반쯤 접힌 층 위에 또 접으면
      // 자식 목록이 실행마다 달라져 캐시 키가 흔들린다.
      if (!buildIfMissing) { cold.push({ recipeHash, chunkOrdinal: null, partId: part.partId, level }); frozen = true; continue }

      const built = await withLock(`${scope}:${scopeId}:${recipeHash}`, () =>
        part.buildParent({ children, level, config, llm }))
      validateCalls(built.calls, part.partId)
      calls.push(...built.calls)

      for (const draft of built.artifacts) {
        const record = {
          scope, scopeId, presetId: preset.id,
          partId: part.partId, partVersion: part.partVersion,
          recipeHash,
          chunkOrdinal: children[0].chunkOrdinal ?? null,
          coversOrdinals: children.flatMap((child) => child.coversOrdinals || []),
          coversMessageIds: children.flatMap((child) => child.coversMessageIds || []),
          kind: draft.kind, text: draft.text, keywords: draft.keywords || [],
          level: draft.level ?? level,
          childHashes: children.map(childHashOf),
          buildCalls: built.calls,
        }
        parents.push(store ? await store.put(record) : { ...record, id: null })
      }
    }
    if (frozen) break
    leftovers.push(current.slice(groups.at(-1).end))
    current = parents
  }

  // frozen 이면 current 는 멈춘 층의 입력 전체다 — 반쯤 만든 부모는 버리고
  // 자식을 그대로 내보낸다 (만든 부모는 저장소에 남아 다음 턴에 캐시로 잡힌다).
  const nodes = [...current, ...leftovers.reverse().flat(), ...recent]
  return { nodes, calls, cold, cacheHit, recipeHashes }
}

// 검색기 실행. bigram 은 옛 전략의 재현이라 부품이 아니고, embedding 은 부품이다.
async function gatherRetrieval({ preset, entries, texts, artifacts, assembly, ctx }) {
  const empty = { messages: [], artifacts: null, calls: [], cold: [], cacheHit: true, recipeHashes: [] }
  const windowSize = boundedSize(assembly.windowSize, assembly.windowSize)
  const limit = boundedSize(assembly.retrievalLimit, LEGACY_RETRIEVAL_LIMIT)

  if (preset.retriever === 'bigram') {
    return { ...empty, messages: bigramRetrieve({ entries, texts, windowSize, limit }) }
  }
  const part = RETRIEVERS[preset.retriever]
  if (!part) return empty

  const { artifacts: store = null, scope = 'session', scopeId = 'none', embed = null, buildIfMissing = true } = ctx
  const config = preset.embedder || {}
  // 벡터 캐시는 산출물 저장소를 그대로 쓴다. 저장소 계약은 recipeHash 로 찾고
  // put 하면 id 가 붙는 것뿐이라, 벡터도 그 모양에 들어간다.
  const cache = store ? {
    find: (recipeHash) => store.find({ scope, scopeId, recipeHash }),
    put: ({ recipeHash, textHash, vector }) => store.put({
      scope, scopeId, presetId: preset.id,
      partId: part.partId, partVersion: part.partVersion,
      recipeHash, chunkOrdinal: null, coversOrdinals: [], coversMessageIds: [],
      kind: 'embedding', text: '', keywords: [], state: { textHash, dim: vector.length },
      vector, buildCalls: [],
    }),
  } : null

  const out = await part.retrieve({
    entries, texts, artifacts, windowSize, limit, config, embed, cache, buildIfMissing,
  })
  validateCalls(out.calls, part.partId)
  const targets = Array.isArray(config.targets) && config.targets.length ? config.targets : ['messages']
  return {
    messages: out.messages,
    // 산출물을 대상으로 삼지 않았으면 null — assemble 이 "고르지 않았다" 와
    // "골랐는데 0개" 를 구별해야 한다.
    artifacts: targets.includes('artifacts') ? out.artifacts : null,
    calls: out.calls, cold: out.cold, cacheHit: out.cacheHit, recipeHashes: out.recipeHashes,
  }
}

/**
 * 긴 이력을 접는다. 프리셋이 정한 방식으로 메시지를 고르고 기억 노트를 만든다.
 * @param {Array<{ role: string, text: string }>} messages
 * @param {object} [config] `{ preset, dialect, assembly, chunkPolicy, worldbook, summary, memoryNote }`
 * @param {import('../types.js').EngineContext} [ctx]
 * @returns {Promise<{ messages: object[], notes: Array<{ kind: string, text: string }>, manifest: object }>}
 */
export async function selectMemory(messages = [], config = {}, ctx = {}) {
  const preset = presetOf(config.preset)
  const assembly = { ...preset.assembly, ...(config.assembly || {}) }
  // 로어북 설정은 기억 프리셋이 정한다. 기본은 'selected'(기존 동작)이고 새
  // 프리셋만 'raw' 를 쓴다 — 그래야 저장된 세션의 발동 결과가 안 바뀐다.
  const worldbook = { scanSource: 'selected', budgetChars: 0, ...(preset.worldbook || {}), ...(config.worldbook || {}) }
  // 방언은 엔진 층 설정이다 — 프롬프트 규약과 씬 경계가 같은 문법을 봐야 한다.
  const chunkPolicy = policyWith(config.dialect || koreanPlayscript, config.chunkPolicy || {})
  // 프리셋과 호출자 override 를 합친 뒤에 검사한다. 등록 시점 검사만으로는
  // 화면에서 창 크기를 바꾸는 runtime override 를 못 잡는다.
  assertWindowInvariant(assembly, chunkPolicy, { hasCompactor: Boolean(preset.compactor) })

  const real = (Array.isArray(messages) ? messages : []).filter(isReal)
  const entries = projectMessages(messages)
  const texts = real.map(activeTextOf)
  const { closed, open } = chunkEntries(entries, texts, chunkPolicy)

  const gathered = await gatherArtifacts({ preset, closed, texts, chunkPolicy, ctx })
  const folded = await gatherDigests({ preset, leaves: gathered.artifacts, ctx })
  const artifacts = folded.nodes
  const retrieval = await gatherRetrieval({ preset, entries, texts, artifacts, assembly, ctx })
  const retrieved = retrieval.messages

  // 선택과 주입을 assemble 이 한 번에 한다. 선택을 밖으로 빼면 주입된 가짜
  // 메시지 때문에 messages 와 entries 의 색인이 어긋난다.
  const assembled = assemble({
    messages: real, entries, closed, artifacts, retrieved, assembly,
    retrievedArtifacts: retrieval.artifacts,
  })

  // legacy 프리셋은 사용자가 쓴 본문 하나만 note 로 나간다. kind 를 보존하는
  // 이유는 prompt-compiler 가 층 이름(`context_summary` / `context_memory`)을
  // 그것으로 만들기 때문이다 — 층 이름이 바뀌면 과거 스냅샷과 구조 비교가 안 된다.
  const userNoteText = preset.userNote ? String(config[preset.userNote] || '').trim() : ''
  const notes = userNoteText
    ? [{ kind: preset.userNote === 'summary' ? 'summary' : 'memory', text: userNoteText }]
    : assembled.notes

  const stages = [gathered, folded, retrieval]
  const memoryCalls = stages.flatMap((stage) => stage.calls)

  return {
    messages: assembled.messages,
    notes,
    manifest: {
      preset: preset.id,
      worldbook,
      parts: { compactor: preset.compactor, reducer: preset.reducer, retriever: preset.retriever, tracker: preset.tracker },
      assembly, chunkPolicy: hashablePolicyOf(chunkPolicy),
      chunkBoundaries: closed.map((chunk) => chunk.coversOrdinals.at(-1)),
      openChunkOrdinals: open ? open.coversOrdinals : [],
      selectedOrdinals: assembled.selectedEntries.map((entry) => entry.ordinal),
      selectedMessageIds: assembled.selectedEntries.map((entry) => entry.messageId).filter(Boolean),
      retrievedOrdinals: retrieved.map((item) => item.ordinal),
      retrievedMessageIds: retrieved.map((item) => item.ref).filter(Boolean),
      retrievedArtifactIds: (retrieval.artifacts || []).map((item) => item.id).filter(Boolean),
      // 메시지 점수와 산출물 점수를 한 목록에 둔다. 산출물 항목은 ordinal 이 null 이고
      // artifactIndex 가 manifest.artifacts 의 색인이다. keepKinds 로 남은 것은 score 가 null.
      retrievalScores: [
        ...retrieved.map((item) => ({ ref: item.ref, ordinal: item.ordinal, score: item.score })),
        ...(retrieval.artifacts || []).map((item) => ({ ref: null, ordinal: null, artifactIndex: item.index, artifactId: item.id, score: item.score })),
      ],
      hiddenOrdinals: assembled.hiddenOrdinals,
      // 값으로 복사한다 — 나중에 산출물을 고치거나 지워도 과거 근거는 안 바뀐다 (원칙 5).
      artifacts: artifacts.map((a) => ({
        id: a.id, kind: a.kind, coversOrdinals: a.coversOrdinals,
        text: a.text, origin: a.origin ?? 'auto', editedAt: a.editedAt ?? null,
      })),
      coldChunks: stages.flatMap((stage) => stage.cold),
      // 비용 장부가 조건끼리 dedupe 하려면 무엇을 만들었는지 알아야 한다.
      recipeHashes: stages.flatMap((stage) => stage.recipeHashes),
      trackerState: null,
      // 메시지 층으로 주입된 것도 증거다. note 층만 기록하면 front/back/both
      // 프리셋이 무엇을 넣었는지 연구 기록에서 통째로 빠진다.
      injectedMessages: assembled.injectedItems.map((item) => item.rendered),
      // note 층의 최종 문자열은 {{char}} 치환과 라벨을 거친 뒤에야 확정되므로
      // 호출부(compilePrompt 결과)에서 채운다.
      injectedText: null,
      budgetChars: assembly.budgetChars,
      usedChars: assembled.usedChars,
      truncated: assembled.truncated,
      memoryCalls,
      cacheHit: stages.every((stage) => stage.cacheHit),
      callsIncurredHere: memoryCalls.reduce((acc, call) => ({
        calls: acc.calls + 1,
        promptTokens: acc.promptTokens + call.promptTokens,
        completionTokens: acc.completionTokens + call.completionTokens,
        ms: acc.ms + call.ms,
      }), { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 }),
    },
  }
}
