import { sha256Hex } from '../sha256.js'
import { canonical } from '../memory/recipe.js'

/** @typedef {import('../types.js').PromptProfile} PromptProfile */

export const PROMPT_PROFILE_VERSION = 1
export const PROMPT_PROFILE_KINDS = Object.freeze([
  'instruction', 'world', 'rating', 'pacing', 'character', 'cast', 'player',
  'context', 'worldbook', 'user_boundary', 'output_contract', 'memory',
  'scene_state', 'event', 'directive',
])
export const PROMPT_PROFILE_LIMITS = Object.freeze({ template: 20000, total: 80000, depth: 100 })

/** Fresh values, so editing one profile cannot change another. @returns {PromptProfile} */
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
  object(input, ['version', 'blocks'], '설정')
  if (input.version !== 1) throw new Error('PromptProfile: 지원하는 version은 1입니다')
  if (!Array.isArray(input.blocks) || input.blocks.length !== PROMPT_PROFILE_KINDS.length) {
    throw new Error(`PromptProfile: ${PROMPT_PROFILE_KINDS.length}개 블록이 각각 한 번씩 필요합니다`)
  }
  const seen = new Set()
  let total = 0
  const blocks = input.blocks.map((block) => {
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
    let slot = block.slot
    if (!['default', 'system', 'post_history'].includes(slot)) {
      object(slot, ['depth'], `${block.kind} 위치`)
      if (!Number.isInteger(slot.depth) || slot.depth < 0 || slot.depth > PROMPT_PROFILE_LIMITS.depth) {
        throw new Error(`PromptProfile: depth는 0~${PROMPT_PROFILE_LIMITS.depth} 정수여야 합니다`)
      }
      slot = { depth: slot.depth }
    }
    return { kind: block.kind, enabled: block.enabled, template: block.template, slot }
  })
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

/** Apply only to material emitted by the engine; empty optional material stays absent.
 * Instruction and pacing can be authored entirely in a profile even when their source is empty.
 * @param {object[]} blocks
 * @param {PromptProfile} profile
 * @param {{char:string,user:string}} names
 */
export function applyPromptProfile(blocks, profile, names) {
  return profile.blocks.flatMap((rule) => {
    if (!rule.enabled) return []
    let sources = blocks.filter((block) => (block.kind.startsWith('context_') ? 'context' : block.kind) === rule.kind)
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
}
