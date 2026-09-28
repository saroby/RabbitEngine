import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asteriskScript } from '../dialect/asterisk-script.js'

const dir = new URL('../eval/scenarios/', import.meta.url)
const scenarios = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json')).sort().map(async (f) => JSON.parse(await readFile(new URL(f, dir), 'utf8'))))

test('평가 CLI는 유효한 심사만 집계하고 실패 결과와 중간 결과를 보존한다 (외부 호출 없음)', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'rabbit-eval-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  async function run(mode, invalidOffset = 0) {
    const output = join(temp, `${mode}-${invalidOffset}.json`)
    const fixtures = scenarios.map((s, i) => {
      const scores = Object.fromEntries(s.judge.rubric.map((key) => [key, 2]))
      let judge = { scores, forbidViolations: [] }
      let extraction = JSON.stringify({
        tension: s.judge.stateDelta.tension?.[0] ?? 'calm',
        characters: Object.fromEntries(Object.entries(s.judge.stateDelta.bodyAddAny ?? {}).map(([name, patterns]) => [name, { body: { add: patterns.slice(0, 1).map((p) => p.split('|')[0]) } }])),
      })
      if (mode === 'invalid-judge') {
        const key = s.judge.rubric[0]
        const invalid = [
          null, { scores: [], forbidViolations: [] },
          { scores: {}, forbidViolations: [] }, { scores: { ...scores, unknown: 2 }, forbidViolations: [] },
          ...['2', -1, 3, 1.5].map((value) => ({ scores: { ...scores, [key]: value }, forbidViolations: [] })),
          { scores }, { scores, forbidViolations: 'none' },
          { scores, forbidViolations: [1] }, { scores, forbidViolations: ['unknown'] },
        ]
        judge = invalid[(i + invalidOffset) % invalid.length]
      }
      if (mode === 'invalid-extraction' && i < 2) extraction = i === 0 ? 'not-json' : '{"tension":"unknown"}'
      if (mode === 'violation') judge.forbidViolations = (s.judge.stateDelta.forbid ?? []).slice(0, 1)
      return { extraction, judge: judge === null ? 'not-json' : JSON.stringify(judge) }
    })
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const fixtures = ${JSON.stringify(fixtures)};
      const scenarios = ${JSON.stringify(scenarios)};
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        const index = Math.floor(calls / 3), stage = calls++ % 3;
        if (${JSON.stringify(mode)} === 'interrupted' && index === 1) throw new Error('offline interruption');
        if (stage === 2 && ${JSON.stringify(mode)} === 'valid') {
          const prompt = JSON.parse(options.body).messages.at(-1).content;
          for (const value of [JSON.stringify(scenarios[index].cards), JSON.stringify(scenarios[index].history), scenarios[index].dialect, ${JSON.stringify(asteriskScript.spec)}]) assert.ok(prompt.includes(value), 'judge context missing');
        }
        const content = stage === 0 ? '유리: 응답' : stage === 1 ? fixtures[index].extraction : fixtures[index].judge;
        return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
      };
      process.argv = ['node', 'eval-judge.js', '--out', ${JSON.stringify(output)}];
      await import(${JSON.stringify(new URL('../scripts/eval-judge.js', import.meta.url).href)});
      assert.equal(calls, fixtures.length * 3);
    `], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: 'offline-placeholder' }, timeout: 10000 })
    assert.ifError(child.error)
    assert.notEqual(child.status, null, child.stderr)
    const saved = await readFile(output, 'utf8').catch((error) => assert.fail(child.stderr || error.message))
    return { status: child.status, data: JSON.parse(saved), stderr: child.stderr }
  }

  await t.test('정상 점수와 심사 문맥', async () => {
    const { status, data, stderr } = await run('valid')
    assert.equal(status, 0, stderr)
    assert.equal(data.mean, 10)
    assert.ok(data.scenarios.every((s) => s.total === 10 && s.stateMatch))
  })
  await t.test('잘못된 점수 및 금지 항목은 평균과 성공 판정에서 제외', async () => {
    for (const offset of [0, 10]) {
      const { status, data } = await run('invalid-judge', offset)
      assert.equal(status, 1)
      assert.equal(data.scenarios.length, scenarios.length)
      assert.equal(data.mean, 0)
      assert.ok(data.scenarios.every((s) => s.total === null && s.scores === null && s.judgeError && !s.stateMatch))
    }
  })
  await t.test('JSON 파싱 실패와 거부된 상태 추출도 실패', async () => {
    const { status, data } = await run('invalid-extraction')
    assert.equal(status, 1)
    assert.ok(data.scenarios.slice(0, 2).every((s) => s.total === null && s.extractionError && !s.stateMatch))
    assert.ok(data.scenarios.slice(2).every((s) => s.total === 10 && s.stateMatch))
    assert.equal(data.mean, 10)
  })
  await t.test('유효한 심사가 금지 위반을 발견하면 점수는 보존하고 실패로 종료', async () => {
    const { status, data } = await run('violation')
    assert.equal(status, 1)
    assert.equal(data.mean, 10)
    assert.ok(data.scenarios.some((s) => s.forbidViolations.length && !s.stateMatch))
  })
  await t.test('뒤의 API 실패가 앞의 결과를 지우지 않는다', async () => {
    const { status, data } = await run('interrupted')
    assert.equal(status, 1)
    assert.equal(data.scenarios.length, 1)
    assert.equal(data.scenarios[0].total, 10)
  })
})
