// 로어북 주입. ST 의 World Info 를 그대로 옮기지 않는다 — 실제 자료 430개를 재보고
// 재귀 스캔·scanDepth·minActivations 를 의도적으로 뺐다 (spec: 실측 2026-08-27).
// 재귀는 keyword 를 always 로 되돌리고(94~100% 발동), scanDepth 는 지금 자료에서
// 아무것도 바꾸지 않는다. 없는 손잡이를 만들어 두면 의미 있어 보이면서 아무 일도
// 하지 않는다.

// 최근 몇 개를 스캔하는가. 손잡이로 내지 않는 이유는 위와 같다.
export const SCAN_DEPTH = 6

function listOf(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',')
  return raw.map((keyword) => String(keyword).trim()).filter(Boolean)
}
const keywordsOf = (worldbook) => listOf(worldbook.keywords)

// 우선순위는 예산을 나눌 때만 쓴다. 숫자가 아니면 0 — 저장된 항목이 문자열을 들고 있어도
// 조용히 맨 뒤로 밀리지 않고 지금과 같은 자리에 선다.
const priorityOf = (worldbook) => (Number.isFinite(worldbook.priority) ? worldbook.priority : 0)

export const WORLDBOOK_INJECTORS = {
  always(worldbook) {
    return { injected: Boolean(String(worldbook.content || '').trim()), matchedKeywords: [] }
  },
  keyword(worldbook, recentText) {
    // 정규화된 substring OR. 한국어는 어절 경계가 없어 과매칭하지만 그대로 둔다 —
    // 과활성 자체가 이 기법의 성질이고, 최소 길이나 stopword 필터를 넣으면
    // 코퍼스에 따라 같은 전략의 의미가 달라져 재현성이 깨진다.
    const matchedKeywords = keywordsOf(worldbook).filter((keyword) => recentText.includes(keyword))
    // 제외 키워드는 과매칭을 깎는 손잡이다. "열쇠" 로 깨우되 "열쇠고리" 가 보이면 재운다.
    // 키워드가 걸렸을 때만 본다 — 안 걸린 항목에 제외 사유를 적으면 증거가 시끄러워진다.
    const excludedBy = matchedKeywords.length ? listOf(worldbook.excludeKeywords).filter((keyword) => recentText.includes(keyword)) : []
    return {
      injected: matchedKeywords.length > 0 && excludedBy.length === 0 && Boolean(String(worldbook.content || '').trim()),
      matchedKeywords,
      excludedBy,
    }
  },
}

// scanSource 가 이 함수의 존재 이유다. 기본값 'selected' 는 기억이 고른 이력을
// 스캔한다 — 기존 동작이지만, 기억 프리셋이 메시지를 숨기면 로어북 발동이 같이
// 바뀌어 두 축이 직교하지 않는다. 'raw' 는 기억 선택과 무관하게 원본 이력을 본다.
export function injectWorldbooksWithManifest(worldbooks = [], messages = [], overrides = {}, options = {}) {
  const { scanSource = 'selected', rawMessages = null, budgetChars = 0 } = options
  const source = scanSource === 'raw' && Array.isArray(rawMessages) ? rawMessages : messages
  const recentText = source.slice(-SCAN_DEPTH).map((message) => message.text || '').join('\n')

  const decided = worldbooks.map((worldbook, index) => {
    const strategy = overrides[worldbook.id] || worldbook.strategy || 'always'
    const injector = WORLDBOOK_INJECTORS[strategy] || WORLDBOOK_INJECTORS.always
    const decision = injector(worldbook, recentText)
    const text = decision.injected ? `[설정: ${worldbook.name}]\n${worldbook.content}` : null
    return { worldbook, index, strategy, decision, text, priority: priorityOf(worldbook), overBudget: false }
  })

  // always 는 강태오 하나에서 37,904자를 넣는다 — 상한이 없으면 어떤 컨텍스트든
  // 지배한다. 넘으면 버리되 몇 개를 버렸는지 남긴다 (조용히 자르지 않는다).
  // 예산은 우선순위가 높은 항목부터 나눈다. 같으면 원래 순서다 — sort 는 안정 정렬이라
  // priority 를 아무도 안 쓰면 예전과 똑같이 앞에서부터 채운다.
  let usedChars = 0
  let truncated = 0
  if (budgetChars > 0) {
    const byPriority = decided.filter((item) => item.text).sort((a, b) => b.priority - a.priority)
    for (const item of byPriority) {
      if (usedChars + item.text.length > budgetChars) {
        item.overBudget = true
        item.text = null
        truncated += 1
      } else {
        usedChars += item.text.length
      }
    }
  } else {
    usedChars = decided.reduce((sum, item) => sum + (item.text ? item.text.length : 0), 0)
  }

  // 내보내는 순서는 원래 순서다. 우선순위가 프롬프트 안의 자리까지 흔들면 캐시 접두가
  // 매 턴 달라지고, compileBlocks 는 manifest 를 worldbooks 와 같은 색인으로 읽는다.
  const chunks = decided.filter((item) => item.text).map((item) => item.text)
  const manifest = decided.map(({ worldbook, strategy, decision, text, priority, overBudget }) => ({
    id: worldbook.id,
    revisionId: worldbook.revisionId || null,
    name: worldbook.name,
    strategy,
    injected: Boolean(text),
    matchedKeywords: decision.matchedKeywords,
    ...(decision.excludedBy?.length ? { excludedBy: decision.excludedBy } : {}),
    ...(priority !== 0 ? { priority } : {}),
    overBudget,
    injectedText: text,
  }))
  return { chunks, manifest, scanSource, usedChars, truncated, budgetChars }
}
