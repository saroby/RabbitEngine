// 엔진 추출이 동작을 바꾸지 않았음을 증명하는 골든 스냅샷 생성기.
// 사람이 fixtures 를 손으로 고치지 않는다 — 고쳐야 한다면 동작이 바뀐 것이고,
// 그건 이 작업에서 일어나면 안 되는 일이다.
import { writeFileSync } from 'node:fs'
import { compilePrompt } from '../prompt/compile.js'
import { selectContext } from '../memory/legacy-strategies.js'
import { selectMemory } from '../memory/index.js'
import { recipeHashOf } from '../memory/recipe.js'
import { hashText } from '../memory/projection.js'

const card = {
  name: '유리',
  description: '도서관 사서. 말수가 적다.',
  personality: '차분하고 관찰이 빠르다',
  scenario: '비 오는 오후의 도서관',
  first_mes: '{{user}} 씨, 또 오셨네요.',
  mes_example: '유리: 여기 앉으세요.',
}

const playerCard = { name: '루이', description: '단골 손님', usesSessionUserName: false }

// worldbook-strategies.js 의 실제 시그니처는 ST 식 entries 배열이 아니라
// content·keywords·strategy 를 최상위 필드로 둔다 (server/worldbook-strategies.js 확인).
const worldbooks = [
  { id: 'wb1', name: '도서관', content: '3층은 폐가다.', keywords: ['3층', '도서관'], strategy: 'keyword' },
]

// 씬 표지가 하나 들어간 이력 — chunking 의 sceneSnap 경로를 탄다.
// message.text 를 읽는다 (server/memory/projection.js 의 activeTextOf) — content 가 아니다.
const messages = [
  { role: 'assistant', text: '유리: 어서 오세요.' },
  { role: 'user', text: '오늘도 비가 오네요.' },
  { role: 'assistant', text: '(창밖을 본다)\n유리: 그러네요.' },
  { role: 'user', text: '3층에 가봐도 될까요?' },
  { role: 'assistant', text: '[장면: 같은 날 저녁, 3층 계단]\n유리: 조심하세요.' },
  { role: 'user', text: '고마워요.' },
]

// 컴팩터가 실제로 도는 유일한 케이스. 나머지 15건은 전부 압축기 없는
// 프리셋이라 recipeHashes 가 [] 였다 — 캐시 키의 재료가 어디에도 못박히지
// 않았다는 뜻이다. 42개 중 21번째에 씬 표지를 하나 넣어 chunking 의 sceneSnap
// 경로까지 함께 지난다 (닫힌 chunk 3개 → recipeHash 3개).
const compactorMessages = Array.from({ length: 42 }, (_, i) => (
  i === 20
    ? { id: 'c20', role: 'assistant', text: '[장면: 다음 날 아침, 서고]\n유리: 여기까지 오셨네요.' }
    : { id: `c${i}`, role: i % 2 ? 'assistant' : 'user', text: `대사 ${i}` }
))

// 결정적인 가짜 요약자. latencyMs 를 고정하므로 sceneCompactor 가 내는
// calls[].ms 도 실행마다 같다 — 골든에서 덮어써야 하는 필드가 없다.
// (덮었다면 recipeHashes·chunkBoundaries·산출물의 text/keywords/coversOrdinals
//  는 덮지 않았을 자리다. 지금은 아무것도 덮지 않는다.)
const fixedLlm = async () => ({
  text: '요약: 두 사람은 서고에서 3층 이야기를 마쳤다.\n핵심어: 유리, 서고, 3층',
  provider: 'openai',
  latencyMs: 7,
  usage: { input: 100, output: 20 },
})

export const CASES = {
  'compile:최소': () => compilePrompt({ cards: [card], instructionText: '장면을 전진시킨다.' }),
  'compile:전체': () => compilePrompt({
    cards: [card], playerCard, instructionText: '장면을 전진시킨다.',
    worldbooks, messages, userName: '루이',
    contextNotes: [{ kind: 'summary', text: '{{char}} 와 처음 만났다.' }],
  }),
  'compile:치환없음': () => compilePrompt({ cards: [card], messages, enforceFormat: false }),
  'context:full': () => selectContext(messages, { strategy: 'full' }),
  'context:window': () => selectContext(messages, { strategy: 'window', windowSize: 3 }),
  'context:summary': () => selectContext(messages, { strategy: 'summary', summary: '비가 왔다' }),
  'context:memory': () => selectContext(messages, { strategy: 'memory', memoryNote: '3층은 폐가' }),
  'context:retrieval': () => selectContext(messages, { strategy: 'retrieval', retrievalLimit: 2 }),
  'memory:lorebook': () => selectMemory(messages, { preset: 'lorebook' }),
  'memory:vector': () => selectMemory(messages, { preset: 'vector' }),
  'memory:memory-books': () => selectMemory(compactorMessages, { preset: 'memory-books' }, {
    llm: fixedLlm, scope: 'session', scopeId: 'golden',
  }),
  'hash:빈값': () => recipeHashOf({}),
  'hash:중첩': () => recipeHashOf({ b: [1, 2, { c: null }], a: '한글', d: undefined }),
  'hash:키순서': () => recipeHashOf({ z: 1, a: 2 }),
  'hash:본문': () => hashText('유리: 왔구나.'),
  'hash:본문없음': () => hashText(null),
}

export async function snapshot() {
  const out = {}
  for (const [name, run] of Object.entries(CASES)) out[name] = await run()
  return out
}

if (process.argv[1]?.endsWith('golden-engine.js')) {
  const out = await snapshot()
  writeFileSync(
    new URL('../test/fixtures/golden-engine.json', import.meta.url),
    `${JSON.stringify(out, null, 2)}\n`,
  )
  console.log(`골든 ${Object.keys(out).length}건을 기록했다`)
}
