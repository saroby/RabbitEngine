// 캡슐·대화 블록 옆에 보이는 짧은 문구 미리보기. 표시 전용이며 저장값에는 들어가지 않는다.
export const SNIPPET_LENGTH = 30

/**
 * 블록이 실제로 내놓는 문구를 한 줄로 줄여 보여 준다.
 * 엔진 블록은 template(`{{content}}`는 ‹원문›), 커스텀 블록은 content, 대화 블록은 메시지 수다.
 * @param {{template?:string,content?:string,messages?:unknown[]}|undefined} source
 * @param {number} [max] 말줄임표를 포함한 최대 글자 수
 * @returns {string}
 */
export function blockSnippet(source, max = SNIPPET_LENGTH) {
  if (!source) return ''
  if (Array.isArray(source.messages)) return `메시지 ${source.messages.length}개`
  const text = typeof source.template === 'string'
    ? source.template.replace(/\{\{\s*content\s*\}\}/g, '‹원문›')
    : String(source.content ?? '')
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return '(빈 문구)'
  const chars = [...flat]
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat
}
