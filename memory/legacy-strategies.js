// 기존 5종 전략 이름을 legacy 프리셋으로 옮기는 어댑터. 파일을 지우지 않는
// 이유는 저장된 세션과 과거 Study 가 아직 이 이름을 들고 있기 때문이다.
import { selectMemory } from './index.js'
import { LEGACY_WINDOW_SIZE, LEGACY_RETRIEVAL_LIMIT } from './defaults.js'
import { boundedSize } from './assemble.js'

const PRESET_OF = {
  full: 'legacy-full',
  window: 'legacy-window',
  summary: 'legacy-summary',
  memory: 'legacy-memory',
  retrieval: 'legacy-retrieval',
}

export const LEGACY_STRATEGIES = Object.keys(PRESET_OF)

export function selectContext(messages = [], config = {}, ctx = {}) {
  const preset = PRESET_OF[config.strategy] || PRESET_OF.full
  return selectMemory(messages, {
    preset,
    dialect: config.dialect,
    summary: config.summary,
    memoryNote: config.memoryNote,
    assembly: {
      // 기본값을 DEFAULT_ASSEMBLY 에서 끌어오면 12 가 24 로 바뀌어 저장된
      // 세션과 과거 Study 의 선택이 달라진다. legacy 는 legacy 기본값을 쓴다.
      // 정규화를 boundedSize 로 유지한다. Number() 로 바꾸면 0·"2abc"·Infinity
      // 에서 선택 메시지 수가 조용히 달라진다 — 기존 동작이 parseInt 였다.
      windowSize: config.strategy === 'full'
        ? Number.MAX_SAFE_INTEGER
        : boundedSize(config.windowSize, LEGACY_WINDOW_SIZE),
      retrievalLimit: boundedSize(config.retrievalLimit, LEGACY_RETRIEVAL_LIMIT),
    },
  }, ctx)
}
