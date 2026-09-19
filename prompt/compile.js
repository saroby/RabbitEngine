import { compileBlocks } from './blocks.js'

export const PROMPT_COMPILER_VERSION = 'prompt-v3'

/**
 * 프롬프트층을 쌓는다 — 지시문 · 카드 · 등장인물 · 플레이어 · 기억 노트 · 로어북 · 호칭 경계 · 대본 규약.
 * 실제 조립은 compileBlocks 가 한다. 이 함수는 system 슬롯 블록만 이어 붙인
 * 하위 호환 문자열/layers 뷰를 준다 (spec: 섹션 1 — 블록 모델로의 이행).
 * @param {object} [options]
 * @returns {{ system: string, layers: object[], names: { char: string, user: string }, compilerVersion: string, worldbookManifest: object[], worldbookScan: object }}
 */
export function compilePrompt(options = {}) {
  const out = compileBlocks(options)
  const systemBlocks = out.blocks.filter((block) => block.slot === 'system')
  // role·slot·trust 는 블록 모델의 위치 정보다. 하위 호환 layers 뷰는 이전과 같은 모양을 유지한다.
  const layers = systemBlocks.map(({ role, slot, trust, ...layer }) => layer)
  return {
    system: systemBlocks.map((b) => b.content).join('\n\n'),
    layers,
    names: out.names,
    compilerVersion: PROMPT_COMPILER_VERSION,
    worldbookManifest: out.worldbookManifest,
    worldbookScan: out.worldbookScan,
  }
}
