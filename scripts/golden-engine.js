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
