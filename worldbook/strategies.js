// 로어북 주입. ST 의 World Info 를 그대로 옮기지 않는다 — 실제 자료 430개를 재보고
// 재귀 스캔·scanDepth·minActivations 를 의도적으로 뺐다 (spec: 실측 2026-08-27).
// 재귀는 keyword 를 always 로 되돌리고(94~100% 발동), scanDepth 는 지금 자료에서
// 아무것도 바꾸지 않는다. 없는 손잡이를 만들어 두면 의미 있어 보이면서 아무 일도
// 하지 않는다.

// 최근 몇 개를 스캔하는가. 손잡이로 내지 않는 이유는 위와 같다.
export const SCAN_DEPTH = 6

function keywordsOf(worldbook) {
  const raw = Array.isArray(worldbook.keywords) ? worldbook.keywords : String(worldbook.keywords || '').split(',')
  return raw.map((keyword) => String(keyword).trim()).filter(Boolean)
}

export const WORLDBOOK_INJECTORS = {
  always(worldbook) {
    return { injected: Boolean(String(worldbook.content || '').trim()), matchedKeywords: [] }
  },
  keyword(worldbook, recentText) {
    // 정규화된 substring OR. 한국어는 어절 경계가 없어 과매칭하지만 그대로 둔다 —
    // 과활성 자체가 이 기법의 성질이고, 최소 길이나 stopword 필터를 넣으면
    // 코퍼스에 따라 같은 전략의 의미가 달라져 재현성이 깨진다.
    const matchedKeywords = keywordsOf(worldbook).filter((keyword) => recentText.includes(keyword))
    return { injected: matchedKeywords.length > 0 && Boolean(String(worldbook.content || '').trim()), matchedKeywords }
  },
}

// scanSource 가 이 함수의 존재 이유다. 기본값 'selected' 는 기억이 고른 이력을
// 스캔한다 — 기존 동작이지만, 기억 프리셋이 메시지를 숨기면 로어북 발동이 같이
// 바뀌어 두 축이 직교하지 않는다. 'raw' 는 기억 선택과 무관하게 원본 이력을 본다.
export function injectWorldbooksWithManifest(worldbooks = [], messages = [], overrides = {}, options = {}) {
  const { scanSource = 'selected', rawMessages = null, budgetChars = 0 } = options
  const source = scanSource === 'raw' && Array.isArray(rawMessages) ? rawMessages : messages
  const recentText = source.slice(-SCAN_DEPTH).map((message) => message.text || '').join('\n')

  const chunks = []
  const manifest = []
  let usedChars = 0
  let truncated = 0

  for (const worldbook of worldbooks) {
    const strategy = overrides[worldbook.id] || worldbook.strategy || 'always'
    const injector = WORLDBOOK_INJECTORS[strategy] || WORLDBOOK_INJECTORS.always
    const decision = injector(worldbook, recentText)
    let injectedText = decision.injected ? `[설정: ${worldbook.name}]\n${worldbook.content}` : null

    // always 는 강태오 하나에서 37,904자를 넣는다 — 상한이 없으면 어떤 컨텍스트든
    // 지배한다. 넘으면 버리되 몇 개를 버렸는지 남긴다 (조용히 자르지 않는다).
    let overBudget = false
    if (injectedText && budgetChars > 0 && usedChars + injectedText.length > budgetChars) {
      overBudget = true
      truncated += 1
      injectedText = null
    }
    if (injectedText) { chunks.push(injectedText); usedChars += injectedText.length }

    manifest.push({
      id: worldbook.id,
      revisionId: worldbook.revisionId || null,
      name: worldbook.name,
      strategy,
      injected: Boolean(injectedText),
      matchedKeywords: decision.matchedKeywords,
      overBudget,
      injectedText,
    })
  }
  return { chunks, manifest, scanSource, usedChars, truncated, budgetChars }
}
