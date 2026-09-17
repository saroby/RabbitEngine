// 공개 표면. 여기 없는 것은 공개 API 가 아니다.
export const VERSION = '0.0.1'

export { parseScript, choicesOf, SCRIPT_PARSER_VERSION } from './dialect/parse.js'
export { compilePrompt } from './prompt/compile.js'
export { SCRIPT_FORMAT, namesOf, renderCard, renderCast, renderPlayerCard, substitute, substituteCard } from './prompt/parts.js'
export { selectMemory } from './memory/index.js'
export { selectContext, LEGACY_STRATEGIES } from './memory/legacy-strategies.js'
export { definePart, validateCalls, PART_KINDS } from './memory/contract.js'
export { MEMORY_PRESETS, presetOf } from './memory/presets.js'
export { recipeHashOf, canonical } from './memory/recipe.js'
export { sha256Hex } from './sha256.js'
export { MEMORY_LABEL, DEFAULT_ASSEMBLY, LEGACY_WINDOW_SIZE, LEGACY_RETRIEVAL_LIMIT } from './memory/defaults.js'
