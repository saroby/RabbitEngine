// 대화 구역 타임라인의 순수 계산. DOM 없이 자리(depth)·말풍선·칸 사이 이동을 정한다.
// 자리(position)는 정수다: N(0 이상)은 마지막 사용자 메시지보다 메시지 N개 앞(slot {depth:N}),
// POST_HISTORY(-1)는 마지막 사용자 메시지 뒤(slot post_history)다. renderTurn 의 삽입 규칙과 같다.
import { DEFAULT_DEPTHS } from '../prompt/blocks.js'
import { PROMPT_MESSAGE_KINDS, PROMPT_PROFILE_LIMITS } from '../prompt/profile.js'

export const POST_HISTORY = -1
// 블록이 없어도 보여 주는 이전 대화 말풍선 수(마지막 메시지 제외).
export const MIN_HISTORY = 3
export const MAX_DEPTH = PROMPT_PROFILE_LIMITS.depth

/**
 * 블록이 실제로 들어가는 대화 안 자리. `default`는 엔진 원래 위치로 계산한다.
 * @param {{kind:string, slot:unknown}} rule
 * @returns {number}
 */
export const positionOf = (rule) => {
  if (rule.slot === 'post_history' || (rule.slot === 'default' && rule.kind === 'directive')) return POST_HISTORY
  if (rule.slot && typeof rule.slot === 'object') return Number.isInteger(rule.slot.depth) ? rule.slot.depth : 0
  return DEFAULT_DEPTHS[rule.kind] ?? 0
}

/**
 * 자리를 저장할 slot 으로 바꾼다. 엔진 기본 위치와 같은 자리면 `default`를 유지해 저장값이 불필요하게 바뀌지 않게 한다.
 * @param {string} kind
 * @param {number} position
 */
export const slotAt = (kind, position) => {
  if (PROMPT_MESSAGE_KINDS.includes(kind) && positionOf({ kind, slot: 'default' }) === position) return 'default'
  return position < 0 ? 'post_history' : { depth: position }
}

/**
 * 타임라인의 말풍선. 0 은 마지막 사용자 메시지(이번 입력)이고, 위로 갈수록 사용자·모델이 번갈아 나온다.
 * @param {number} index 마지막 사용자 메시지에서 거슬러 올라간 메시지 수
 * @returns {{role:'user'|'assistant', label:string}}
 */
export const bubbleAt = (index) => {
  if (index === 0) return { role: 'user', label: '사용자 · 마지막 메시지(이번 입력)' }
  return index % 2 ? { role: 'assistant', label: '모델 · 이전 답변' } : { role: 'user', label: '사용자 · 이전 메시지' }
}

/**
 * 보여 줄 이전 대화 말풍선 수. 가장 앞쪽 블록 위에 말풍선 하나가 더 보이게 하고, 요청한 만큼 늘린다.
 * @param {number} deepest 배치된 블록 중 가장 큰 자리(없으면 음수)
 * @param {number} [requested] "더 이전 대화 보기"로 늘린 수
 */
export const historyLength = (deepest, requested = 0) => Math.min(MAX_DEPTH, Math.max(MIN_HISTORY, deepest + 1, requested))

/**
 * 위(오래된 것)에서 아래(최신)로 놓을 행. 칸(gap)의 자리 N 은 말풍선 N 바로 위다.
 * @param {number} history 이전 대화 말풍선 수
 * @returns {Array<{type:'gap', position:number} | {type:'message', index:number, role:'user'|'assistant', label:string}>}
 */
export function timelineRows(history) {
  const rows = []
  for (let index = history; index >= 0; index -= 1) {
    rows.push({ type: 'gap', position: index })
    rows.push({ type: 'message', index, ...bubbleAt(index) })
  }
  rows.push({ type: 'gap', position: POST_HISTORY })
  return rows
}

/**
 * 블록이 없는 이전 대화 구간을 한 줄로 접은 행. 블록을 100개 앞에 두면 말풍선 100개가 다 그려져
 * 화면이 끝없이 길어지므로, 보여야 할 자리가 아닌 칸·말풍선이 2쌍 이상 이어지면 접기 행 하나로 바꾼다.
 * 최근 말풍선(MIN_HISTORY 이하)·이번 입력 뒤 칸은 항상 보인다.
 * @param {ReturnType<typeof timelineRows>} rows
 * @param {(position:number)=>boolean} shown 칸 N 과 말풍선 N 을 보일지
 * @returns {Array<ReturnType<typeof timelineRows>[number] | {type:'fold', from:number, to:number, count:number}>}
 */
export function foldRows(rows, shown) {
  const visible = (position) => position <= MIN_HISTORY || shown(position)
  const result = []
  let run = []
  const flush = () => {
    if (run.length >= 4) result.push({ type: 'fold', from: run[0].position, to: run[run.length - 1].index, count: run.length / 2 })
    else result.push(...run)
    run = []
  }
  for (const row of rows) {
    const position = row.type === 'gap' ? row.position : row.index
    if (visible(position)) { flush(); result.push(row) } else run.push(row)
  }
  flush()
  return result
}

/** 한 칸 위(더 오래된 쪽) 자리. 더 갈 수 없으면 undefined. */
export const gapAbove = (position) => (position < 0 ? 0 : position < MAX_DEPTH ? position + 1 : undefined)
/** 한 칸 아래(더 최신 쪽) 자리. 더 갈 수 없으면 undefined. */
export const gapBelow = (position) => (position > 0 ? position - 1 : position === 0 ? POST_HISTORY : undefined)

/**
 * 사람이 읽는 자리 설명.
 * @param {number} position
 */
export const positionText = (position) => (position < 0 ? '마지막 사용자 메시지(이번 입력) 뒤 · [진행 메모]로 붙음'
  : position === 0 ? '마지막 사용자 메시지(이번 입력) 바로 앞'
    : `${bubbleAt(position).role === 'user' ? '이전 사용자 메시지' : '이전 모델 답변'} 바로 앞 (이번 입력보다 메시지 ${position}개 앞)`)

/**
 * Alt+↑/↓ 한 번의 이동. 같은 칸에 블록이 여러 개면 먼저 그 칸 안에서 한 칸씩 순서를 바꾸고,
 * 칸의 끝에 닿으면 이웃 칸으로 넘어간다(위로 가면 그 칸의 맨 아래, 아래로 가면 맨 위).
 * @param {{position:number, stack:string[], key:string, direction:'up'|'down'}} move stack 은 그 칸의 블록 키(조립 순서)
 * @returns {{before?:string, after?:string, position?:number, edge?:'start'|'end'} | undefined}
 */
export function keyboardStep({ position, stack, key, direction }) {
  const index = stack.indexOf(key)
  if (direction === 'up') {
    if (index > 0) return { before: stack[index - 1] }
    const target = gapAbove(position)
    return target === undefined ? undefined : { position: target, edge: 'end' }
  }
  if (index >= 0 && index < stack.length - 1) return { after: stack[index + 1] }
  const target = gapBelow(position)
  return target === undefined ? undefined : { position: target, edge: 'start' }
}
