// 엔진 추출 전후로 출력이 한 바이트도 달라지지 않았음을 본다.
// 이 테스트가 깨지면 되돌린다 — 고쳐서 통과시키지 않는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { snapshot } from '../scripts/golden-engine.js'

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-engine.json', import.meta.url)))

test('골든 — 엔진 출력이 스냅샷과 같다', async () => {
  const now = await snapshot()
  for (const name of Object.keys(golden)) {
    assert.deepEqual(now[name], golden[name], `${name} 의 출력이 달라졌다`)
  }
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort(), '케이스 목록이 달라졌다')
})
