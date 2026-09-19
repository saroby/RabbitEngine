#!/usr/bin/env node
// LLM 심사. 수동 실행 전용 — npm test 에 넣지 않는다. 키가 없으면 종료 코드 2.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildTurn } from '../build-turn.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { extractionRecipe, applyExtraction } from '../scene/extraction.js'
import { emptySceneState } from '../scene/state.js'
import { renderTurn } from '../prompt/render.js'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length))
const provider = args.provider ?? 'openai'
const model = args.model ?? 'gpt-4o'
const judgeModel = args['judge-model'] ?? model
if (args.variant && !['full', 'no-directive', 'no-state'].includes(args.variant)) { console.error(`--variant 는 full | no-directive | no-state 중 하나여야 합니다: ${args.variant}`); process.exit(2) }
const key = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
if (!key) { console.error(`${provider} 키가 없습니다.`); process.exit(2) }

async function call({ system, messages, model: m, json = false }) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: m, max_tokens: 1024, system, messages: messages.map((x) => ({ role: x.role === 'system' ? 'user' : x.role, content: x.text })) }) })
    const data = await res.json(); if (!res.ok) throw new Error(JSON.stringify(data)); return data.content.map((c) => c.text || '').join('')
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: m, messages: [{ role: 'system', content: system }, ...messages.map((x) => ({ role: x.role, content: x.text }))], ...(json ? { response_format: { type: 'json_object' } } : {}) }) })
  const data = await res.json(); if (!res.ok) throw new Error(JSON.stringify(data)); return data.choices[0].message.content
}

const DIALECTS = { 'asterisk-script': asteriskScript, 'korean-playscript': koreanPlayscript }
const dir = new URL('../eval/scenarios/', import.meta.url)
const results = []

// 결과 경로는 --out 도 기본값도 모두 실행 위치(process.cwd()) 기준이다. 예전에는
// mkdir 만 모듈 기준이라 레포 루트 밖에서 돌리면 엉뚱한 곳에 폴더가 생겼다.
const outPath = resolve(args.out ?? `eval/results/${new Date().toISOString().slice(0, 10)}-${args.label ?? model}.json`)
const scored = () => results.filter((r) => typeof r.total === 'number')
const meanOf = () => (scored().length ? scored().reduce((a, r) => a + r.total, 0) / scored().length : 0)
// 시나리오마다 통째로 다시 쓴다. 뒤에서 한 건이 터져도 이미 돈을 쓴 앞의 호출은 남는다.
async function save() {
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify({ provider, model, judgeModel, variant: args.variant ?? 'full', mean: meanOf(), scenarios: results }, null, 2))
}
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
  const s = JSON.parse(await readFile(new URL(file, dir), 'utf8'))
  const turn = await buildTurn({ cards: s.cards, dialect: DIALECTS[s.dialect], rating: s.rating, indicatorDefs: s.indicatorDefs ?? [], sceneState: s.sceneState ?? undefined, messages: s.history, userInput: s.userInput })
  const variant = args.variant ?? 'full'
  const kept = turn.blocks.filter((b) => variant === 'full' || (variant === 'no-directive' ? b.slot !== 'post_history' : b.kind !== 'scene_state'))
  const rendered = renderTurn(kept, turn.messages, { userInput: s.userInput, userFirst: true, mergeSameRole: true })
  const response = await call({ system: rendered.system, messages: rendered.messages, model })
  const recipe = extractionRecipe({ state: s.sceneState ?? emptySceneState(), exchanges: [{ messageId: 'x', user: s.userInput, assistant: response }], names: s.cards.map((c) => c.name), indicatorDefs: s.indicatorDefs ?? [] })
  const extracted = applyExtraction(s.sceneState ?? emptySceneState(), await call({ system: recipe.system, messages: recipe.messages, model: judgeModel, json: true }), { indicatorDefs: s.indicatorDefs ?? [], names: s.cards.map((c) => c.name), messageId: 'x' })
  const rubric = s.judge.rubric
  const judgeText = await call({ model: judgeModel, json: true, system: '당신은 롤플레이 응답 심사위원이다. 각 항목을 0(못함)·1(부분)·2(충족)으로 채점해 {"scores":{항목:점수},"reason":"한 줄"} JSON 만 낸다.',
    messages: [{ role: 'user', text: `시나리오: ${s.id}\n등급: ${s.rating}\n장면 상태: ${JSON.stringify(s.sceneState)}\n유저 입력: ${s.userInput}\n응답:\n${response}\n\n항목: ${rubric.join(', ')}` }] })
  // 심사 모델이 JSON 을 안 낼 때가 있다. 거기서 멈추면 앞 시나리오의 유료 호출까지 잃는다.
  let scores = null
  let judgeError = null
  try {
    const value = JSON.parse(judgeText)?.scores
    if (value && typeof value === 'object') scores = value
    else judgeError = String(judgeText).slice(0, 200)
  } catch { judgeError = String(judgeText).slice(0, 200) }
  const want = s.judge.stateDelta ?? {}
  const tensionOk = !want.tension || [].concat(want.tension).includes(extracted.state.tension)
  const bodyOk = Object.entries(want.bodyAddAny ?? {}).every(([name, patterns]) => !patterns.length || patterns.some((p) => (extracted.state.characters[name]?.body ?? []).some((b) => new RegExp(p, 'u').test(b))))
  const stateMatch = tensionOk && bodyOk
  const total = scores ? Object.values(scores).reduce((a, b) => a + b, 0) : null
  results.push({ id: s.id, response, scores, total, judgeError, stateDelta: extracted.state, stateMatch })
  await save()
  console.log(`${s.id}: ${total === null ? '심사 실패' : `${total}/${rubric.length * 2}`} state=${stateMatch ? 'ok' : 'miss'}`)
}
await save()
console.log(`평균 ${meanOf().toFixed(2)} (채점 ${scored().length}/${results.length}) → ${outPath}`)
if (args.baseline) {
  const base = JSON.parse(await readFile(args.baseline, 'utf8'))
  for (const r of scored()) { const b = base.scenarios.find((x) => x.id === r.id); if (b && typeof b.total === 'number') console.log(`${r.id}: ${b.total} → ${r.total} (${r.total - b.total >= 0 ? '+' : ''}${r.total - b.total})`) }
}
