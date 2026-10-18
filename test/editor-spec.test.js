import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK_SPECS, PRESET_SPECS, specHtml, specSampleTurn } from '../editor/spec.js'
import { BLOCK_LABELS } from '../editor/labels.js'
import { PROMPT_PROFILE_KINDS } from '../prompt/profile.js'
import { MEMORY_PRESETS } from '../memory/presets.js'
import { cachePrefixBlocks } from '../prompt/render.js'

// 스펙 탭은 손으로 쓴 설명이라 엔진이 바뀌면 조용히 낡는다. 위치 · 출처 · 캐시 경계처럼 값으로 맞춰 볼 수 있는 것은 여기서 잡는다.
test('스펙 탭은 엔진 블록 종류를 빠짐없이 같은 순서로 설명한다', () => {
  assert.deepEqual(Object.keys(BLOCK_SPECS), [...PROMPT_PROFILE_KINDS])
  assert.deepEqual(Object.keys(BLOCK_LABELS), [...PROMPT_PROFILE_KINDS])
})

test('스펙의 기본 위치와 trust 는 예시 턴에서 엔진이 만든 블록과 같다', async () => {
  const turn = await specSampleTurn()
  const seen = new Set()
  for (const block of turn.blocks) {
    const kind = block.kind.startsWith('context_') ? 'context' : block.kind
    seen.add(kind)
    assert.deepEqual(block.slot, BLOCK_SPECS[kind].slot, `${kind} 의 위치`)
    assert.equal(block.trust, BLOCK_SPECS[kind].trust, `${kind} 의 trust`)
  }
  // 예시 턴은 기억 프리셋 노트(context)만 빼고 모든 블록을 낸다 — 빠지면 위 검사가 그만큼 비는 것이다.
  assert.deepEqual(PROMPT_PROFILE_KINDS.filter((kind) => !seen.has(kind)), ['context'])
})

test('스펙의 캐시 접두 경계 표시는 렌더의 동적 블록 판정과 같다', () => {
  for (const kind of PROMPT_PROFILE_KINDS) {
    const actual = kind === 'context' ? 'context_summary' : kind
    const prefix = cachePrefixBlocks([{ kind: 'instruction', slot: 'system' }, { kind: actual, slot: 'system' }])
    assert.equal(prefix.length === 1, BLOCK_SPECS[kind].dynamic, `${kind} 가 캐시 접두를 끊는가`)
  }
})

test('스펙은 기억 프리셋을 빠짐없이 설명한다', () => {
  assert.deepEqual(Object.keys(PRESET_SPECS).sort(), Object.keys(MEMORY_PRESETS).sort())
})

test('스펙 HTML 은 모든 블록과 목차 절을 담고 빈 값을 흘리지 않는다', async () => {
  const html = await specHtml()
  for (const kind of PROMPT_PROFILE_KINDS) assert.match(html, new RegExp(`id="spec-block-${kind}"`))
  for (const href of html.matchAll(/href="#(spec-[a-z_-]+)"/g)) assert.match(html, new RegExp(`id="${href[1]}"`), `${href[1]} 로 가는 링크`)
  assert.doesNotMatch(html, /undefined|\[object Object\]/)
})
