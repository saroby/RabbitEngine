// 공개 표면. 여기 없는 것은 공개 API 가 아니다.
// 공개 타입은 types.js 에 있다.
export const VERSION = '0.0.2'

export { defineDialect, verifyDialect, parserVersionOf } from './dialect/define.js'
export { koreanPlayscript } from './dialect/korean-playscript.js'
export { asteriskScript, ASTERISK_FORMAT } from './dialect/asterisk-script.js'
export { parseWith } from './dialect/parse.js'
export { parseScript, choicesOf, SCRIPT_PARSER_VERSION } from './dialect/compat.js'
export { compilePrompt, PROMPT_COMPILER_VERSION } from './prompt/compile.js'
export { compileBlocks, BLOCK_COMPILER_VERSION, DEFAULT_DEPTHS } from './prompt/blocks.js'
export { renderTurn } from './prompt/render.js'
export { SCRIPT_FORMAT, namesOf, renderCard, renderCast, renderPlayerCard, substitute, substituteCard } from './prompt/parts.js'
export { selectMemory } from './memory/index.js'
export { selectContext, LEGACY_STRATEGIES } from './memory/legacy-strategies.js'
export { definePart, validateCalls, PART_KINDS } from './memory/contract.js'
export { MEMORY_PRESETS, presetOf } from './memory/presets.js'
export { recipeHashOf, canonical } from './memory/recipe.js'
export { sha256Hex } from './sha256.js'
export { MEMORY_LABEL, DEFAULT_ASSEMBLY, LEGACY_WINDOW_SIZE, LEGACY_RETRIEVAL_LIMIT } from './memory/defaults.js'
export { createMemoryArtifactStore, contentHashOf, indexKey, decorate } from './memory/artifact-store.js'
export { prebuildMemory } from './memory/prebuild.js'
// 호스트가 기억 재료를 직접 다뤄야 하는 자리들 — 골든 생성기와 씬 표지 조사가
// 여기에 묶여 있다. exports 가 "." 하나뿐이라 깊은 import 로는 닿을 수 없다.
export { hashText, projectMessages, activeTextOf } from './memory/projection.js'
export { chunkEntries } from './memory/chunking.js'
// 장면 층 — 등급 · 상태 · 사용자 입력 해석 · 이력 뒤 지시 · 추출 레시피.
export { emptySceneState, renderSceneState, applySceneDelta, validateIndicatorDefs, initialIndicators, TENSIONS } from './scene/state.js'
export { RATINGS, RATING_TEXT, assertRating, ratingInstruction, ratingDirective } from './scene/rating.js'
export { analyzeUserInput } from './scene/input.js'
export { buildDirective, DIRECTIVE_MAX_CHARS } from './scene/directive.js'
export { extractionRecipe, applyExtraction, parseExtractionOutput, EXTRACTION_VERSION } from './scene/extraction.js'
export { buildTurn, PACING_TEXT } from './build-turn.js'
