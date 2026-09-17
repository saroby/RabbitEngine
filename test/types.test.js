// 공개 표면이 의도치 않게 넓어지거나 좁아지지 않았는지 본다.
// 이 목록을 고치는 것은 공개 API 를 바꾸는 일이다 — 의식적으로 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../index.js'

const PUBLIC = [
  'VERSION',
  'buildTurn',
  'defineDialect', 'verifyDialect', 'parserVersionOf', 'koreanPlayscript',
  'parseWith', 'parseScript', 'choicesOf', 'SCRIPT_PARSER_VERSION',
  'compilePrompt', 'selectMemory', 'selectContext', 'LEGACY_STRATEGIES',
  'definePart', 'validateCalls', 'PART_KINDS',
  'MEMORY_PRESETS', 'presetOf',
  'recipeHashOf', 'canonical', 'sha256Hex',
  'createMemoryArtifactStore', 'contentHashOf', 'indexKey', 'decorate',
  'MEMORY_LABEL', 'DEFAULT_ASSEMBLY', 'LEGACY_WINDOW_SIZE', 'LEGACY_RETRIEVAL_LIMIT',
  'SCRIPT_FORMAT', 'namesOf', 'renderCard', 'renderCast', 'renderPlayerCard',
  'substitute', 'substituteCard',
]

test('공개 표면이 목록과 같다', () => {
  assert.deepEqual(Object.keys(engine).sort(), [...PUBLIC].sort())
})

test('공개 표면에 undefined 가 없다', () => {
  for (const name of PUBLIC) {
    assert.notEqual(engine[name], undefined, `${name} 이 undefined 다`)
  }
})
