// 기억 계층의 유일한 진입점. 대화·연구·배치가 전부 이 함수를 부른다.
// 부품이 없는 프리셋(legacy)은 여기서 조립만 하고 끝나므로 LLM 도 캐시도
// 타지 않는다 — 그래서 기존 동작을 그대로 재현할 수 있다.
import { projectMessages, activeTextOf, isReal } from './projection.js'
import { chunkEntries, assertWindowInvariant, policyWith, hashablePolicyOf } from './chunking.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { assemble, boundedSize } from './assemble.js'
import { presetOf } from './presets.js'
import { bigramRetrieve } from './retrievers/bigram.js'
import { sceneCompactor } from './compactors/scene.js'
import { recipeHashOf, withLock } from './recipe.js'
import { validateCalls } from './contract.js'
import { LEGACY_RETRIEVAL_LIMIT } from './defaults.js'

const COMPACTORS = { scene: sceneCompactor }

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
    const cached = store ? store.find({ scope, scopeId, recipeHash }) : null
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
      artifacts.push(store ? store.put(record) : { ...record, id: null })
    }
  }
  return { artifacts, calls, cold, cacheHit, recipeHashes }
}

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
  const artifacts = gathered.artifacts
  const retrieved = preset.retriever === 'bigram'
    ? bigramRetrieve({
        entries, texts,
        windowSize: boundedSize(assembly.windowSize, assembly.windowSize),
        limit: boundedSize(assembly.retrievalLimit, LEGACY_RETRIEVAL_LIMIT),
      })
    : []

  // 선택과 주입을 assemble 이 한 번에 한다. 선택을 밖으로 빼면 주입된 가짜
  // 메시지 때문에 messages 와 entries 의 색인이 어긋난다.
  const assembled = assemble({
    messages: real, entries, closed, artifacts, retrieved, assembly,
  })

  // legacy 프리셋은 사용자가 쓴 본문 하나만 note 로 나간다. kind 를 보존하는
  // 이유는 prompt-compiler 가 층 이름(`context_summary` / `context_memory`)을
  // 그것으로 만들기 때문이다 — 층 이름이 바뀌면 과거 스냅샷과 구조 비교가 안 된다.
  const userNoteText = preset.userNote ? String(config[preset.userNote] || '').trim() : ''
  const notes = userNoteText
    ? [{ kind: preset.userNote === 'summary' ? 'summary' : 'memory', text: userNoteText }]
    : assembled.notes

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
      retrievedArtifactIds: [],
      retrievalScores: retrieved.map((item) => ({ ref: item.ref, ordinal: item.ordinal, score: item.score })),
      hiddenOrdinals: assembled.hiddenOrdinals,
      // 값으로 복사한다 — 나중에 산출물을 고치거나 지워도 과거 근거는 안 바뀐다 (원칙 5).
      artifacts: artifacts.map((a) => ({
        id: a.id, kind: a.kind, coversOrdinals: a.coversOrdinals,
        text: a.text, origin: a.origin ?? 'auto', editedAt: a.editedAt ?? null,
      })),
      coldChunks: gathered.cold,
      // 비용 장부가 조건끼리 dedupe 하려면 무엇을 만들었는지 알아야 한다.
      recipeHashes: gathered.recipeHashes,
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
      memoryCalls: gathered.calls,
      cacheHit: gathered.cacheHit,
      callsIncurredHere: gathered.calls.reduce((acc, call) => ({
        calls: acc.calls + 1,
        promptTokens: acc.promptTokens + call.promptTokens,
        completionTokens: acc.completionTokens + call.completionTokens,
        ms: acc.ms + call.ms,
      }), { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 }),
    },
  }
}
