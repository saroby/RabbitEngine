// 부품이 만든 것을 실제 요청 모양으로 옮기는 자리. 여기 두 가지가
// SillyTavern 생태계가 시행착오로 얻은 성과다 — 요약했으면 원문을 숨겨라,
// 관련 정보는 맨 앞이나 맨 뒤에 놓아라(가운데는 모델이 덜 본다).
//
// 선택(무엇을 남길까)과 주입(어디에 넣을까)을 한 함수 안에서 이 순서로 한다.
// 선택을 밖으로 빼면 주입된 가짜 메시지 때문에 messages 배열과 entries 배열의
// 색인이 어긋나 엉뚱한 메시지를 고르게 된다.
import { DEFAULT_ASSEMBLY, MEMORY_LABEL } from './defaults.js'

export { DEFAULT_ASSEMBLY, MEMORY_LABEL }

// 기존 context-strategies.js 의 boundedSize 와 같은 정규화. parseInt 를 쓰는
// 이유는 그것이 기존 동작이기 때문이다 — Number() 로 바꾸면 0·"2abc"·Infinity
// 에서 선택 메시지 수가 조용히 달라진다.
export function boundedSize(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(1, parsed) : fallback
}

const renderMemory = (text) => `${MEMORY_LABEL}\n${text}`

// 예산은 실제로 프롬프트에 들어갈 문자열 길이로 센다. 본문만 세면 라벨과
// 줄바꿈이 빠져 manifest 가 초과를 감지하지 못한다.
//
// 다만 note 층은 항목들을 줄바꿈으로 이어 붙이고 라벨을 **한 번만** 단다.
// 항목마다 라벨을 세면 과대 계산이 되어 넣을 수 있는 것을 일찍 잘라낸다.
function fitBudget(items, budgetChars, placement) {
  const perItemLabel = placement !== 'note'
  const kept = []
  let used = perItemLabel ? 0 : MEMORY_LABEL.length
  for (const item of items) {
    const size = perItemLabel ? item.rendered.length : item.text.length + 1
    if (used + size > budgetChars) break
    kept.push(item)
    used += size
  }
  return { kept, truncated: items.length - kept.length, usedChars: kept.length ? used : 0 }
}

export function assemble({
  messages = [], entries = [], closed = [],
  artifacts = [], retrieved = [], retrievedArtifacts = null, trackerState = null,
  assembly = DEFAULT_ASSEMBLY,
} = {}) {
  // entries 와 messages 는 같은 predicate 로 걸러진 같은 길이의 배열이다.
  const messageByOrdinal = new Map(entries.map((entry, index) => [entry.ordinal, messages[index]]))

  const windowSize = boundedSize(assembly.windowSize, DEFAULT_ASSEMBLY.windowSize)
  const windowStart = Math.max(0, entries.length - windowSize)
  const pulled = new Set(retrieved.map((item) => item.ordinal))

  // 압축된 구간은 창 밖일 때만 숨긴다. 창 안은 원문이 남아야 한다.
  const compacted = assembly.hideCompacted
    ? new Set(closed.flatMap((chunk) => chunk.coversOrdinals))
    : new Set()
  const hiddenOrdinals = entries
    .filter((entry) => compacted.has(entry.ordinal) && entry.ordinal < windowStart)
    .map((entry) => entry.ordinal)
  const hidden = new Set(hiddenOrdinals)

  // windowMode 는 창의 의미를 명시한다. 두 의미가 실제로 다르므로 암묵에 두지 않는다.
  //  - cut     : 창 밖은 버린다 (기존 window·summary·memory·retrieval 전략의 동작)
  //  - protect : 창 밖도 남기되 압축된 것만 뺀다. 창은 "압축하지 않을 최근 구간"
  const selectedEntries = entries.filter((entry) => {
    if (hidden.has(entry.ordinal)) return false
    if (assembly.windowMode === 'protect') return true
    return entry.ordinal >= windowStart || pulled.has(entry.ordinal)
  })
  const kept = selectedEntries.map((entry) => messageByOrdinal.get(entry.ordinal)).filter(Boolean)

  // 검색으로 끌어온 **메시지**는 기억 층이 아니라 선택에 참여한다 — 위에서
  // 이미 원문으로 남았다. 여기서 또 넣으면 같은 대사가 두 번 들어간다
  // (기존 retrieval 전략은 note 를 만들지 않았다).
  // 검색으로 끌어온 **산출물**은 artifacts 로 들어와 기억 층이 된다.
  //
  // retrievedArtifacts 가 배열이면 검색기가 산출물을 골랐다는 뜻이다 — 그것만
  // 시간 순서로 넣는다. null 은 "고르지 않았다" 라 전부 들어간다. 빈 배열은
  // "골랐는데 닿는 것이 없다" 라 아무것도 안 들어간다. 둘을 섞으면 검색이
  // 0개를 찾은 턴에 요약이 전부 쏟아져 예산이 터진다.
  const chosen = Array.isArray(retrievedArtifacts)
    ? [...retrievedArtifacts].sort((a, b) => a.index - b.index).map((pick) => artifacts[pick.index]).filter(Boolean)
    : artifacts
  const memoryItems = [
    ...(trackerState ? [{ source: 'tracker', text: trackerState.text ?? JSON.stringify(trackerState) }] : []),
    ...chosen.map((artifact) => ({ source: 'artifact', id: artifact.id ?? null, text: artifact.text })),
  ].map((item) => ({ ...item, rendered: renderMemory(item.text) }))

  const { kept: fitted, truncated, usedChars } = fitBudget(memoryItems, assembly.budgetChars, assembly.placement)

  const notes = []
  let out = kept

  if (assembly.placement === 'note') {
    if (fitted.length) notes.push({ kind: 'memory', text: fitted.map((item) => item.text).join('\n') })
  } else {
    const injected = fitted.map((item) => ({ role: 'user', text: item.rendered, memoryInjected: true }))
    // retain 이 남은 메시지 수보다 크면 음수 slice 가 되어 배열 중간을 가리킨다.
    const retained = Math.min(kept.length, Math.max(0, Number(assembly.retain) || 0))
    const splitAt = kept.length - retained
    if (assembly.placement === 'front') out = [...injected, ...kept]
    else if (assembly.placement === 'back') out = [...kept.slice(0, splitAt), ...injected, ...kept.slice(splitAt)]
    else {
      // both — 같은 항목을 양쪽에 넣지 않는다. 반씩 갈라 앞뒤로 보낸다.
      const half = Math.ceil(injected.length / 2)
      out = [...injected.slice(0, half), ...kept.slice(0, splitAt), ...injected.slice(half), ...kept.slice(splitAt)]
    }
  }

  return {
    messages: out,
    selectedEntries,
    notes,
    hiddenOrdinals,
    injectedItems: fitted,
    truncated,
    usedChars,
  }
}
