// 방언은 "프롬프트에 넣을 규약 텍스트 + 파싱 규칙 + 버전" 을 한 덩어리로
// 소유한다. 셋이 흩어져 있으면 주석이 동기화를 부탁할 뿐이고, 실제로 어긋난다.
// memory/contract.js 의 definePart 와 같은 집 스타일이다.
import { parseWith, SCRIPT_PARSER_VERSION } from './parse.js'

/**
 * 방언을 정의한다. 검증하고 얼려서 돌려준다.
 * @param {Omit<import('../types.js').ScriptDialect, 'parse' | 'blocks' | 'examples'> & Partial<Pick<import('../types.js').ScriptDialect, 'blocks' | 'examples'>>} spec
 * @returns {import('../types.js').ScriptDialect}
 */
export function defineDialect(spec = {}) {
  if (!spec.id) throw new Error('방언에 id 가 없습니다')
  if (!Number.isInteger(spec.version)) throw new Error(`${spec.id}: version 은 정수여야 합니다`)
  if (typeof spec.spec !== 'string' || !spec.spec) throw new Error(`${spec.id}: spec(규약 텍스트)이 필요합니다`)
  if (!Array.isArray(spec.rules)) throw new Error(`${spec.id}: rules 는 배열이어야 합니다`)
  if (!spec.fallback) throw new Error(`${spec.id}: fallback(어느 규칙에도 안 걸린 줄의 종류)이 필요합니다`)

  // g·y 가 붙은 정규식은 lastIndex 를 들고 다닌다. .test()/.match() 가 그 상태를
  // 옮겨 다니므로 같은 텍스트의 두 번째 파싱이 다른 결과를 낸다 — 같은 이력에서
  // 씬 경계가 흔들리고 기억 캐시가 갈린다. 등록 자체를 막는다.
  const assertStateless = (regexp, where) => {
    if (/[gy]/.test(regexp.flags)) {
      throw new Error(`${spec.id}: ${where} 에 g·y 플래그를 쓸 수 없습니다 — lastIndex 가 두 번째 파싱을 바꿉니다`)
    }
  }

  for (const rule of spec.rules) {
    if (!rule.kind) throw new Error(`${spec.id}: 규칙에 kind 가 없습니다`)
    if (!(rule.match instanceof RegExp)) throw new Error(`${spec.id}: ${rule.kind} 규칙의 match 는 정규식이어야 합니다`)
    if (!Number.isInteger(rule.text)) throw new Error(`${spec.id}: ${rule.kind} 규칙의 text 는 캡처 그룹 번호여야 합니다`)
    assertStateless(rule.match, `${rule.kind} 규칙의 match`)
    if (rule.reject instanceof RegExp) assertStateless(rule.reject, `${rule.kind} 규칙의 reject`)
  }
  for (const block of spec.blocks || []) {
    if (!(block.open instanceof RegExp) || !(block.item instanceof RegExp)) {
      throw new Error(`${spec.id}: ${block.kind} 블록의 open·item 은 정규식이어야 합니다`)
    }
    assertStateless(block.open, `${block.kind} 블록의 open`)
    assertStateless(block.item, `${block.kind} 블록의 item`)
  }

  const dialect = {
    blocks: [],
    examples: [],
    ...spec,
    parse(text, options) { return parseWith(dialect, text, options) },
  }
  return Object.freeze(dialect)
}

// 규약 텍스트는 사람이 쓴다 — 규칙에서 자연어를 생성하면 프롬프트 품질이
// 나빠지고, 프롬프트 품질이 이 엔진의 존재 이유다. 대신 예시를 돌려서
// "규약이 약속한 형태가 실제로 파싱되는지" 를 증명한다.
/**
 * 방언의 examples 를 돌려 규약 텍스트와 규칙이 맞물리는지 본다. 어긋나면 던진다.
 * @param {import('../types.js').ScriptDialect} dialect
 * @returns {void}
 */
export function verifyDialect(dialect) {
  for (const example of dialect.examples) {
    const actual = dialect.parse(example.text)
    if (JSON.stringify(actual) !== JSON.stringify(example.segments)) {
      throw new Error(
        `${dialect.id}: 예시가 규칙과 어긋납니다\n  입력: ${JSON.stringify(example.text)}\n` +
        `  기대: ${JSON.stringify(example.segments)}\n  실제: ${JSON.stringify(actual)}`,
      )
    }
  }
}

// 방언이 바뀌면 씬 경계가 달라지므로 recipeHash 와 output_contract 가 달라져야
// 한다. 다만 korean-playscript v1 은 기존 'script-v1' 을 그대로 쓴다 — 저장된
// 기억 산출물 캐시와 과거 스냅샷이 그 문자열에 묶여 있고, 바꾸면 요약을 전부
// 다시 사게 된다. 보기 싫은 특례지만 대안이 캐시 전량 폐기다.
//
// 특례는 id 와 version 만 본다 — 규칙은 보지 않는다. 그래서 koreanPlayscript 를
// 복제해 규칙을 바꾸면서 id/version 을 그대로 두면, 문법이 달라졌는데도 같은
// 캐시 키('script-v1')를 쓰게 되어 옛 문법으로 만든 요약을 잘못 재사용한다.
// 방언을 포크하면 id 를 바꿔라.
/**
 * 기억 산출물 캐시 키와 output_contract 에 들어가는 문법 이름.
 * @param {Pick<import('../types.js').ScriptDialect, 'id' | 'version'>} dialect
 * @returns {string}
 */
export function parserVersionOf(dialect) {
  if (dialect.id === 'korean-playscript' && dialect.version === 1) return SCRIPT_PARSER_VERSION
  return `${dialect.id}-v${dialect.version}`
}
