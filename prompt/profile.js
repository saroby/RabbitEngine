import { sha256Hex } from '../sha256.js'
import { canonical } from '../memory/recipe.js'

/** @typedef {import('../types.js').PromptProfile} PromptProfile */

export const PROMPT_PROFILE_VERSION = 1
export const PROMPT_PROFILE_KINDS = Object.freeze([
  'instruction', 'world', 'rating', 'pacing', 'character', 'cast', 'player',
  'context', 'worldbook', 'user_boundary', 'output_contract', 'memory',
  'scene_state', 'event', 'directive',
])
export const PROMPT_PROFILE_LIMITS = Object.freeze({ template: 20000, total: 80000, depth: 100, custom: 50 })
// 엔진 기본 위치(`default`)가 시스템이 아니라 대화 안인 블록들 (prompt/blocks.js).
export const PROMPT_MESSAGE_KINDS = Object.freeze(['memory', 'scene_state', 'event', 'directive'])
// 호스트가 만든 커스텀 블록. 문구는 프로필이 아니라 buildTurn 의 customBlocks 라이브러리에 있고,
// 프로필은 id 로 참조해 자리·역할만 정한다 — 같은 블록을 여러 프리셋이 공유한다.
export const CUSTOM_BLOCK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const CUSTOM_BLOCK_ROLES = Object.freeze(['system', 'user', 'assistant'])
// 대화 블록: 역할이 정해진 메시지 여러 개를 한 번에 대화 안에 넣는다(예: user → assistant 예시 한 쌍).
export const CUSTOM_MESSAGE_ROLES = Object.freeze(['user', 'assistant'])
export const CUSTOM_MESSAGES_MAX = 20

/** Profile rules and assembled blocks share one identity: the kind, or `custom:<id>` for host blocks. */
export const profileKeyOf = (block) => block.kind === 'custom' ? `custom:${block.id ?? block.customId}`
  : String(block.kind).startsWith('context_') ? 'context' : block.kind

/** Whether a profile rule places its block in the system prompt. Worldbook entries with their own depth still follow that depth. */
export const isSystemRule = (rule) => rule.slot === 'system'
  || (rule.slot === 'default' && !PROMPT_MESSAGE_KINDS.includes(rule.kind))

/** Parse a system document without interpreting replacement text as template syntax. */
export function parseSystemTemplate(template) {
  if (typeof template !== 'string' || template.length > PROMPT_PROFILE_LIMITS.total) {
    throw new Error('PromptProfile: 시스템 문구는 문자열이며 80000자 이하여야 합니다')
  }
  const parts = []
  const seen = new Set()
  const tokens = /\{\{([\s\S]*?)\}\}/g
  let end = 0
  for (const match of template.matchAll(tokens)) {
    const plain = template.slice(end, match.index)
    if (plain.includes('{{') || plain.includes('}}')) throw new Error('PromptProfile: 잘못된 시스템 태그입니다')
    if (plain) parts.push({ type: 'text', value: plain })
    const token = match[1].trim()
    if (token === 'user' || token === 'char') parts.push({ type: 'name', value: token })
    else {
      const kind = /^block:(custom:[a-z0-9][a-z0-9_-]{0,63}|[a-z_]+)$/.exec(token)?.[1]
      if (!kind?.startsWith('custom:') && !PROMPT_PROFILE_KINDS.includes(kind)) throw new Error(`PromptProfile: 알 수 없는 시스템 태그입니다 (${token})`)
      if (seen.has(kind)) throw new Error(`PromptProfile: ${kind} 태그가 중복되었습니다`)
      seen.add(kind)
      parts.push({ type: 'block', value: kind })
    }
    end = match.index + match[0].length
  }
  const tail = template.slice(end)
  if (tail.includes('{{') || tail.includes('}}')) throw new Error('PromptProfile: 잘못된 시스템 태그입니다')
  if (tail) parts.push({ type: 'text', value: tail })
  if (!seen.has('output_contract')) throw new Error('PromptProfile: 출력 규약 태그가 필요합니다')
  return parts
}

/** Serialize parsed parts back to the stored document form. */
export function formatSystemTemplate(parts) {
  return parts.map((part) => part.type === 'text' ? part.value
    : part.type === 'name' ? `{{${part.value}}}` : `{{block:${part.value}}}`).join('')
}

// 비어 있는 태그는 자기 앞뒤 빈 문단 하나만 가져간다. 이웃 문단은 건드리지 않는다.
// 조립(applyPromptProfile)과 정규화(validatePromptProfile)가 같은 규칙을 써야 저장값을 정리해도 출력이 같다.
function dropBlockParts(parts, isEmpty) {
  for (const [index, part] of parts.entries()) {
    if (part.type !== 'block' || !isEmpty(part.value)) continue
    const before = parts[index - 1]?.type === 'text' ? parts[index - 1] : null
    const after = parts[index + 1]?.type === 'text' ? parts[index + 1] : null
    if (after?.value.startsWith('\n\n') && (!before?.value || before.value.endsWith('\n\n'))) after.value = after.value.slice(2)
    else if (!after && before?.value.endsWith('\n\n')) before.value = before.value.slice(0, -2)
  }
  return parts.filter((part) => part.type !== 'block' || !isEmpty(part.value))
}

/** Remove block tags from a system document with the same blank-paragraph rule the assembler uses.
 * @param {string} template
 * @param {(kind:string)=>boolean} remove
 */
export function withoutSystemBlocks(template, remove) {
  return formatSystemTemplate(dropBlockParts(parseSystemTemplate(template), remove))
}

/** Fresh values, so editing one profile cannot change another. Only engine blocks; custom blocks are added by the host.
 * @returns {{ version: 1, blocks: import('../types.js').PromptProfileBlock[] }}
 */
export function defaultPromptProfile() {
  return {
    version: 1,
    blocks: PROMPT_PROFILE_KINDS.map((kind) => ({ kind, enabled: true, template: '{{content}}', slot: 'default' })),
  }
}

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`PromptProfile: ${label}은 객체여야 합니다`)
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`PromptProfile: ${label}에 알 수 없는 항목이 있습니다`)
}

/** Validate the complete public wire format and return a detached, normalized copy.
 * @param {unknown} input
 * @returns {PromptProfile}
 */
export function validatePromptProfile(input) {
  object(input, ['version', 'blocks', 'systemTemplate'], '설정')
  if (input.version !== 1) throw new Error('PromptProfile: 지원하는 version은 1입니다')
  if (!Array.isArray(input.blocks)) throw new Error(`PromptProfile: ${PROMPT_PROFILE_KINDS.length}개 블록이 각각 한 번씩 필요합니다`)
  const slotOf = (slot, label) => {
    if (['default', 'system', 'post_history'].includes(slot)) return slot
    object(slot, ['depth'], `${label} 위치`)
    if (!Number.isInteger(slot.depth) || slot.depth < 0 || slot.depth > PROMPT_PROFILE_LIMITS.depth) {
      throw new Error(`PromptProfile: depth는 0~${PROMPT_PROFILE_LIMITS.depth} 정수여야 합니다`)
    }
    return { depth: slot.depth }
  }
  const seen = new Set()
  let total = 0
  let customCount = 0
  const blocks = input.blocks.map((block) => {
    if (block?.kind === 'custom') {
      object(block, ['kind', 'id', 'enabled', 'role', 'slot'], '커스텀 블록')
      if (typeof block.id !== 'string' || !CUSTOM_BLOCK_ID.test(block.id)) throw new Error('PromptProfile: 커스텀 블록 id는 영문 소문자·숫자·-·_ 1~64자여야 합니다')
      const key = `custom:${block.id}`
      if (seen.has(key)) throw new Error(`PromptProfile: 커스텀 블록 ${block.id}가 중복되었습니다`)
      seen.add(key)
      if (++customCount > PROMPT_PROFILE_LIMITS.custom) throw new Error(`PromptProfile: 커스텀 블록은 ${PROMPT_PROFILE_LIMITS.custom}개까지 넣을 수 있습니다`)
      if (typeof block.enabled !== 'boolean') throw new Error(`PromptProfile: 커스텀 블록 ${block.id} enabled는 boolean이어야 합니다`)
      if (!CUSTOM_BLOCK_ROLES.includes(block.role)) throw new Error(`PromptProfile: 커스텀 블록 ${block.id}의 역할은 ${CUSTOM_BLOCK_ROLES.join('·')} 중 하나여야 합니다`)
      if (block.slot === 'default') throw new Error(`PromptProfile: 커스텀 블록 ${block.id}는 엔진 기본 위치가 없습니다`)
      const slot = slotOf(block.slot, `커스텀 블록 ${block.id}`)
      // 모델이 이어 쓸 마지막 자리(프리필)는 공급자마다 거부하거나 다르게 다룬다. assistant 는 대화 중간에만 둔다.
      if (block.role === 'assistant' && slot === 'post_history') throw new Error(`PromptProfile: assistant 역할인 ${block.id}는 마지막 사용자 메시지 뒤에 둘 수 없습니다`)
      return { kind: 'custom', id: block.id, enabled: block.enabled, role: block.role, slot }
    }
    object(block, ['kind', 'enabled', 'template', 'slot'], '블록')
    if (!PROMPT_PROFILE_KINDS.includes(block.kind) || seen.has(block.kind)) throw new Error('PromptProfile: 알 수 없거나 중복된 블록입니다')
    seen.add(block.kind)
    if (typeof block.enabled !== 'boolean') throw new Error(`PromptProfile: ${block.kind} enabled는 boolean이어야 합니다`)
    if (typeof block.template !== 'string' || !block.template.trim() || block.template.length > PROMPT_PROFILE_LIMITS.template) {
      throw new Error(`PromptProfile: ${block.kind} 문구는 1~${PROMPT_PROFILE_LIMITS.template}자여야 합니다`)
    }
    total += block.template.length
    if (total > PROMPT_PROFILE_LIMITS.total) throw new Error(`PromptProfile: 전체 문구는 ${PROMPT_PROFILE_LIMITS.total}자 이하여야 합니다`)
    const tokens = [...block.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].trim())
    if (tokens.some((token) => !['content', 'user', 'char'].includes(token))) throw new Error(`PromptProfile: ${block.kind}에 알 수 없는 변수가 있습니다`)
    if (block.kind === 'output_contract' && (!block.enabled || tokens.filter((token) => token === 'content').length !== 1)) {
      throw new Error('PromptProfile: 출력 규약은 활성화하고 {{content}}를 정확히 한 번 포함해야 합니다')
    }
    return { kind: block.kind, enabled: block.enabled, template: block.template, slot: slotOf(block.slot, block.kind) }
  })
  if (PROMPT_PROFILE_KINDS.some((kind) => !seen.has(kind))) {
    throw new Error(`PromptProfile: ${PROMPT_PROFILE_KINDS.length}개 블록이 각각 한 번씩 필요합니다`)
  }
  if (Object.hasOwn(input, 'systemTemplate')) {
    const systemTemplate = input.systemTemplate
    if (total + (typeof systemTemplate === 'string' ? systemTemplate.length : 0) > PROMPT_PROFILE_LIMITS.total) {
      throw new Error(`PromptProfile: 전체 문구는 ${PROMPT_PROFILE_LIMITS.total}자 이하여야 합니다`)
    }
    const tagged = new Set(parseSystemTemplate(systemTemplate).filter((part) => part.type === 'block').map((part) => part.value))
    if (!['default', 'system'].includes(blocks.find((block) => block.kind === 'output_contract').slot)) {
      throw new Error('PromptProfile: 출력 규약 태그는 시스템 위치여야 합니다')
    }
    // 블록의 자리는 한 곳에서만 정해진다: 활성인 시스템 블록 ⇔ 문서에 태그가 있다.
    // 어긋난 두 경우는 원래도 아무것도 출력하지 않으므로 출력은 그대로 두고 저장 형태만 맞춘다 —
    // 대화 위치·비활성 블록의 태그는 지우고, 태그 없는 시스템 블록은 비활성으로 둔다.
    // 프로필에 없는 커스텀 블록 태그도 아무것도 출력하지 않으므로 같은 규칙으로 지운다.
    const placed = (block) => Boolean(block) && block.enabled && isSystemRule(block)
    const byKey = new Map(blocks.map((block) => [profileKeyOf(block), block]))
    return {
      version: 1,
      blocks: blocks.map((block) => (placed(block) && !tagged.has(profileKeyOf(block)) ? { ...block, enabled: false } : block)),
      systemTemplate: withoutSystemBlocks(systemTemplate, (key) => !placed(byKey.get(key))),
    }
  }
  return { version: 1, blocks }
}

/** @param {PromptProfile} profile */
export function promptProfileHash(profile) {
  return sha256Hex(canonical(validatePromptProfile(profile)))
}

// One replacement pass: neither source text nor a name becomes template syntax.
const renderTemplate = (template, content, names) => template.replace(
  /\{\{\s*(content|user|char)\s*\}\}/g,
  (_, key) => key === 'content' ? content : names[key],
)

/** Validate the host's custom block library and return a detached copy keyed by id.
 * 항목은 텍스트 블록 `{ id, content }` 또는 대화 블록 `{ id, messages: [{ role, content }] }` 중 하나다.
 * @param {unknown} input
 * @returns {Map<string, { content: string } | { messages: Array<{ role: 'user'|'assistant', content: string }> }>}
 */
export function validateCustomBlocks(input = []) {
  if (!Array.isArray(input)) throw new Error('customBlocks: 배열이어야 합니다')
  const library = new Map()
  for (const block of input) {
    if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !CUSTOM_BLOCK_ID.test(block.id)) {
      throw new Error('customBlocks: 각 항목은 영문 소문자·숫자·-·_ 1~64자 id가 필요합니다')
    }
    if (library.has(block.id)) throw new Error(`customBlocks: ${block.id}가 중복되었습니다`)
    if (block.messages !== undefined) {
      if (block.content !== undefined) throw new Error(`customBlocks: ${block.id}는 content 와 messages 중 하나만 가져야 합니다`)
      if (!Array.isArray(block.messages) || !block.messages.length || block.messages.length > CUSTOM_MESSAGES_MAX) {
        throw new Error(`customBlocks: ${block.id} 메시지는 1~${CUSTOM_MESSAGES_MAX}개여야 합니다`)
      }
      let total = 0
      const messages = block.messages.map((message) => {
        if (!message || !CUSTOM_MESSAGE_ROLES.includes(message.role) || typeof message.content !== 'string') {
          throw new Error(`customBlocks: ${block.id} 메시지는 user·assistant 역할과 문자열 내용이 필요합니다`)
        }
        total += message.content.length
        return { role: message.role, content: message.content }
      })
      if (total > PROMPT_PROFILE_LIMITS.template) throw new Error(`customBlocks: ${block.id} 내용은 ${PROMPT_PROFILE_LIMITS.template}자 이하여야 합니다`)
      library.set(block.id, { messages })
      continue
    }
    if (typeof block.content !== 'string' || block.content.length > PROMPT_PROFILE_LIMITS.template) {
      throw new Error(`customBlocks: ${block.id} 내용은 ${PROMPT_PROFILE_LIMITS.template}자 이하 문자열이어야 합니다`)
    }
    library.set(block.id, { content: block.content })
  }
  return library
}

/** Apply only to material emitted by the engine; empty optional material stays absent.
 * Instruction and pacing can be authored entirely in a profile even when their source is empty.
 * Custom rules take their text from the host library; a referenced id missing from it is an error,
 * because silently dropping a block the operator placed changes the prompt without a trace.
 * @param {object[]} blocks
 * @param {PromptProfile} profile
 * @param {{char:string,user:string}} names
 * @param {Map<string, string>} [library] validateCustomBlocks 결과
 */
export function applyPromptProfile(blocks, profile, names, library = new Map()) {
  const applied = profile.blocks.flatMap((rule) => {
    if (!rule.enabled) return []
    if (rule.kind === 'custom') {
      if (!library.has(rule.id)) throw new Error(`PromptProfile: 커스텀 블록 ${rule.id}의 내용이 없습니다`)
      // {{content}} 는 엔진 원문 자리라 커스텀 블록에는 없다. 이름만 한 번 치환한다.
      const named = (text) => text.replace(/\{\{\s*(user|char)\s*\}\}/g, (_, key) => names[key])
      const source = library.get(rule.id)
      const slot = typeof rule.slot === 'object' ? { ...rule.slot } : rule.slot
      if (source.messages) {
        // 역할이 박힌 메시지는 시스템 문서나 마지막 사용자 메시지 뒤 메모로 풀 수 없다. 대화 중간에만 둔다.
        if (typeof slot !== 'object') throw new Error(`PromptProfile: 대화 블록 ${rule.id}는 대화 중간(depth)에만 둘 수 있습니다`)
        const messages = source.messages.map((message) => ({ role: message.role, content: named(message.content) })).filter((message) => message.content.trim())
        if (!messages.length) return []
        return [{ kind: 'custom', customId: rule.id, role: rule.role, slot, trust: 'curated', messages,
          content: messages.map((message) => `[${message.role}] ${message.content}`).join('\n\n') }]
      }
      const content = named(source.content)
      if (!content.trim()) return []
      return [{ kind: 'custom', customId: rule.id, role: rule.role, slot, trust: 'curated', content }]
    }
    let sources = blocks.filter((block) => profileKeyOf(block) === rule.kind)
    if (!sources.length && ['instruction', 'pacing'].includes(rule.kind)
      && renderTemplate(rule.template, '', names).trim()) {
      sources = [{ kind: rule.kind, role: 'system', slot: 'system', trust: 'engine', content: '' }]
    }
    return sources.map((block) => ({
      ...block,
      slot: rule.slot === 'default' ? block.slot : typeof rule.slot === 'object' ? { ...rule.slot } : rule.slot,
      content: renderTemplate(rule.template, block.content, names),
    }))
  })
  if (profile.systemTemplate === undefined) return applied
  // A missing optional source removes its own blank paragraph, not its neighbors.
  const parts = dropBlockParts(parseSystemTemplate(profile.systemTemplate), (key) => !applied.some((block) => block.slot === 'system'
    && profileKeyOf(block) === key))
  const system = parts.flatMap((part) => {
    if (part.type === 'block') {
      return applied.filter((block) => block.slot === 'system' && profileKeyOf(block) === part.value)
        .map((block, index) => ({ ...block, separatorBefore: index === 0 ? '' : '\n\n' }))
    }
    const content = part.type === 'name' ? names[part.value] : part.value
    return content ? [{ kind: 'profile_text', role: 'system', slot: 'system', trust: 'curated', content, separatorBefore: '' }] : []
  })
  return [...system, ...applied.filter((block) => block.slot !== 'system')]
}
