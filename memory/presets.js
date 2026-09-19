// 겉으로 갈아끼우는 단위는 프리셋이다. 기존 5종을 "매핑" 이 아니라 일급
// 프리셋으로 두는 이유는 summary·memory 가 사용자 작성 본문을 그대로
// 주입하는 것이라 새 기법 중 정확한 등가물이 없기 때문이다. 없는 등가물을
// 억지로 만들면 하위호환이 아니라 조용한 동작 변경이 된다.
import { DEFAULT_ASSEMBLY, LEGACY_WINDOW_SIZE } from './defaults.js'

const legacyAssembly = (over = {}) => ({
  ...DEFAULT_ASSEMBLY,
  windowSize: LEGACY_WINDOW_SIZE,
  hideCompacted: false,
  placement: 'note',
  // 기존 5종은 창 밖을 버린다 (messages.slice(-windowSize)). 새 프리셋의
  // 'protect'(창 밖도 남기되 압축된 것만 뺀다)와 의미가 다르므로 명시한다.
  windowMode: 'cut',
  ...over,
})

const legacy = (id, over = {}) => ({
  id,
  compactor: null, reducer: null, retriever: null, tracker: null,
  usesLlm: false,
  assembly: legacyAssembly(),
  ...over,
})

// 비-LLM 신규 프리셋 둘. 기억 압축은 없고 조립 정책만 다르다 — 그래서 LLM
// 부품이 하나도 없는 지금 단계에서 이미 비교 가능하다.
const modern = (id, over = {}) => ({
  id,
  compactor: null, reducer: null, retriever: null, tracker: null,
  usesLlm: false,
  assembly: { ...DEFAULT_ASSEMBLY },
  // 로어북 스캔이 기억 선택이 아니라 원본 이력을 보게 한다. 이래야 두 축이 직교한다.
  worldbook: { scanSource: 'raw', budgetChars: 8000 },
  ...over,
})

export const MEMORY_PRESETS = {
  // 기억 압축 0. 로어북 축만 켠 대조군이다.
  lorebook: modern('lorebook', {
    assembly: { ...DEFAULT_ASSEMBLY, hideCompacted: false, placement: 'note' },
  }),
  // 닫힌 씬을 요약으로 접고 원문을 숨긴다. 요약 모델은 본편 모델과 분리한다 —
  // 본편은 큰 모델, 요약은 싸고 빠른 모델이 SillyTavern 생태계의 결론이다.
  'memory-books': modern('memory-books', {
    compactor: 'scene',
    usesLlm: true,
    builder: { provider: 'openai', model: 'gpt-5.4-mini', maxTokens: 500 },
    assembly: { ...DEFAULT_ASSEMBLY, hideCompacted: true, placement: 'note' },
  }),
  // 검색해 온 옛 메시지를 컨텍스트 맨 앞/맨 뒤로 재배치한다. 가운데는 모델이 덜
  // 보므로(lost-in-the-middle) 위치 자체가 기법이다. 최근 retain 개는 건드리지 않는다.
  vector: modern('vector', {
    retriever: 'bigram',
    assembly: { ...DEFAULT_ASSEMBLY, hideCompacted: false, placement: 'both', windowMode: 'cut', retain: 5 },
  }),
  // 씬 요약을 계층으로 접는다. 최근 keepLeaves 개 씬은 요약 그대로(단기), 그보다
  // 오래된 것은 fanout 개씩 묶어 줄거리로(장기). SupaMemory·Memory Books 의
  // "요약의 요약" 을 캐시 가능한 고정 경계 위에 올린 것이다.
  'memory-books-tiered': modern('memory-books-tiered', {
    compactor: 'scene',
    reducer: 'digest',
    usesLlm: true,
    builder: { provider: 'openai', model: 'gpt-5.4-mini', maxTokens: 500 },
    reducerBuilder: { provider: 'openai', model: 'gpt-5.4-mini', maxTokens: 700, fanout: 4, keepLeaves: 4 },
    assembly: { ...DEFAULT_ASSEMBLY, hideCompacted: true, placement: 'note' },
  }),
  // vector 의 의미판. 글자 겹침 대신 임베딩 코사인 유사도로 옛 원문을 끌어온다.
  // 임베딩 호출자는 호스트가 ctx.embed 로 준다 — 엔진은 부르지 않는다.
  semantic: modern('semantic', {
    retriever: 'embedding',
    usesLlm: true,
    embedder: { provider: 'openai', model: 'text-embedding-3-small', minScore: 0.35, targets: ['messages'] },
    assembly: { ...DEFAULT_ASSEMBLY, hideCompacted: false, placement: 'both', windowMode: 'cut', retain: 5 },
  }),
  // HypaMemory V3 와 같은 발상. 씬 요약을 계층으로 접고, 줄거리(digest)는 항상
  // 넣되 씬 요약은 지금 상황과 닿는 것만 임베딩으로 고른다.
  'semantic-books': modern('semantic-books', {
    compactor: 'scene',
    reducer: 'digest',
    retriever: 'embedding',
    usesLlm: true,
    builder: { provider: 'openai', model: 'gpt-5.4-mini', maxTokens: 500 },
    reducerBuilder: { provider: 'openai', model: 'gpt-5.4-mini', maxTokens: 700, fanout: 4, keepLeaves: 4 },
    embedder: { provider: 'openai', model: 'text-embedding-3-small', minScore: 0.35, targets: ['artifacts'], keepKinds: ['digest'] },
    assembly: { ...DEFAULT_ASSEMBLY, hideCompacted: true, placement: 'note' },
  }),
  'legacy-full': legacy('legacy-full', { assembly: legacyAssembly({ windowSize: Number.MAX_SAFE_INTEGER }) }),
  'legacy-window': legacy('legacy-window'),
  'legacy-summary': legacy('legacy-summary', { userNote: 'summary' }),
  'legacy-memory': legacy('legacy-memory', { userNote: 'memoryNote' }),
  'legacy-retrieval': legacy('legacy-retrieval', { retriever: 'bigram' }),
}

export function presetOf(id) {
  const preset = MEMORY_PRESETS[id]
  if (!preset) throw new Error(`알 수 없는 기억 프리셋: ${id}`)
  return preset
}
