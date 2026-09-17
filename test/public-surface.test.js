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
  // 호스트가 실제로 쓰는 이름들. exports 가 "." 하나뿐이라 깊은 import 가
  // 막히므로, index.js 에 없으면 소비자가 쓸 방법이 아예 없다.
  'PROMPT_COMPILER_VERSION', 'prebuildMemory',
  'hashText', 'projectMessages', 'activeTextOf', 'chunkEntries',
]

test('공개 표면이 목록과 같다', () => {
  assert.deepEqual(Object.keys(engine).sort(), [...PUBLIC].sort())
})

test('런타임 의존성이 없다', async () => {
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [])
})
