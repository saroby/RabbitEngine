import { buildTurn } from '../build-turn.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { emptySceneState } from '../scene/state.js'
import { DEFAULT_DEPTHS } from '../prompt/blocks.js'
import {
  defaultPromptProfile, validatePromptProfile, parseSystemTemplate, withoutSystemBlocks, isSystemRule,
  profileKeyOf, PROMPT_MESSAGE_KINDS, PROMPT_PROFILE_LIMITS,
} from '../prompt/profile.js'

const LABELS = {
  instruction: '엔진 지시문', world: '세계관', rating: '콘텐츠 등급', pacing: '진행 속도',
  character: '캐릭터', cast: '등장인물', player: '사용자 캐릭터', context: '선택된 기억',
  worldbook: '로어북', user_boundary: '사용자 역할 경계', output_contract: '출력 규약',
  memory: '기억 노트', scene_state: '장면 상태', event: '사건', directive: '턴 마무리 지시',
}
const BLOCK_DRAG_TYPE = 'application/x-rabbit-block'
const ROLE_LABELS = { system: '메모 (user로 전송)', user: '사용자 메시지', assistant: '모델 메시지' }
const isCustomKey = (key) => key.startsWith('custom:')

const defaultSystemTemplate = (blocks) => blocks
  .filter((block) => block.enabled && (block.kind === 'output_contract' || isSystemRule(block)))
  .map((block) => `{{block:${profileKeyOf(block)}}}`)
  .join('\n\n')

// 블록은 세 구역 중 한 곳에만 있다. 활성·위치·문서 태그를 따로 두지 않고 구역에서 파생한다.
const zoneOf = (rule) => (!rule.enabled ? 'off' : isSystemRule(rule) ? 'system' : 'conversation')
// 대화 안 자리. 클수록 대화 앞쪽이고 -1 은 마지막 사용자 메시지 뒤다.
const positionOf = (rule) => {
  if (rule.slot === 'post_history' || (rule.slot === 'default' && rule.kind === 'directive')) return -1
  if (typeof rule.slot === 'object') return Number.isInteger(rule.slot.depth) ? rule.slot.depth : 0
  return DEFAULT_DEPTHS[rule.kind] ?? 0
}
const positionText = (position) => (position < 0 ? '마지막 사용자 메시지 뒤'
  : position === 0 ? '마지막 사용자 메시지 바로 앞' : `마지막 사용자 메시지보다 ${position}개 앞`)
// 같은 자리를 가리키면 엔진 기본값(`default`)을 유지해 저장값이 불필요하게 바뀌지 않게 한다.
const slotAt = (kind, position) => {
  if (PROMPT_MESSAGE_KINDS.includes(kind) && positionOf({ kind, slot: 'default' }) === position) return 'default'
  return position < 0 ? 'post_history' : { depth: position }
}
const blockKindsIn = (text) => new Set([...text.matchAll(/\{\{\s*block:(custom:[a-z0-9][a-z0-9_-]{0,63}|[a-z_]+)\s*\}\}/g)].map((match) => match[1]))

const STYLE = `
.rabbit-prompt-editor{color:#18212b;font:14px/1.55 system-ui,sans-serif;--rabbit-border:#d4dce4;--rabbit-muted:#526171;max-width:100%}
.rabbit-prompt-editor *{box-sizing:border-box}.rabbit-prompt-editor [hidden]{display:none!important}.rabbit-prompt-editor h2,.rabbit-prompt-editor h3{margin:0 0 12px}
.rabbit-prompt-editor p{margin:8px 0}.rabbit-prompt-editor .rpe-help{color:var(--rabbit-muted)}
.rabbit-prompt-editor .rpe-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
.rabbit-prompt-editor .rpe-composer-pane{min-width:0}
.rabbit-prompt-editor .rpe-tags{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.rabbit-prompt-editor .rpe-composer{min-height:340px;max-height:65vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace;border:1px solid #8795a4;border-radius:7px;padding:14px;background:#fff;outline:none}
.rabbit-prompt-editor .rpe-composer.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px}
.rabbit-prompt-editor .rpe-chip{display:inline-block;vertical-align:baseline;white-space:nowrap;border:1px solid #a9c4ed;border-radius:999px;padding:0 7px;background:#eaf2ff;color:#164c9e;font:12px/1.7 system-ui,sans-serif;user-select:all;cursor:grab}
.rabbit-prompt-editor .rpe-chip:active{cursor:grabbing}
.rabbit-prompt-editor .rpe-tags button{border-radius:999px;background:#eaf2ff;border-color:#a9c4ed;color:#164c9e}
.rabbit-prompt-editor .rpe-tags button[data-custom],.rabbit-prompt-editor .rpe-chip[data-custom]{background:#fff3e0;border-color:#e8b46a;color:#7a4100}
.rabbit-prompt-editor .rpe-zone{margin-top:18px;border:1px dashed #a3b0bd;border-radius:8px;padding:12px;background:#fafbfc}
.rabbit-prompt-editor .rpe-zone.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px;background:#f2f7ff}
.rabbit-prompt-editor .rpe-zone h2{font-size:16px;margin:0}.rabbit-prompt-editor .rpe-zone h3{font-size:13px;color:var(--rabbit-muted);margin:12px 0 6px}
.rabbit-prompt-editor .rpe-item{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--rabbit-border);border-radius:7px;padding:6px 8px;margin:6px 0;background:#fff}
.rabbit-prompt-editor .rpe-item.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px}
.rabbit-prompt-editor .rpe-custom-swaps{margin-top:8px}.rabbit-prompt-editor .rpe-custom-swaps .rpe-item{background:#fffaf2}
.rabbit-prompt-editor .rpe-item-name{font-weight:600;flex:1 1 120px;min-width:0;overflow-wrap:anywhere}
.rabbit-prompt-editor .rpe-item label{display:flex;align-items:center;gap:6px;margin:0;font-weight:400}
.rabbit-prompt-editor .rpe-advanced{margin-top:18px;border-top:1px solid var(--rabbit-border)}
.rabbit-prompt-editor .rpe-block{border:1px solid var(--rabbit-border);border-radius:8px;margin:10px 0;background:#fff;overflow:hidden}
.rabbit-prompt-editor summary{cursor:pointer;font-weight:600;padding:12px;overflow-wrap:anywhere}
.rabbit-prompt-editor .rpe-block-body{padding:0 12px 12px}.rabbit-prompt-editor label{display:grid;gap:4px;margin:10px 0;font-weight:500}
.rabbit-prompt-editor .rpe-check{display:flex;align-items:center;gap:8px}.rabbit-prompt-editor .rpe-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rabbit-prompt-editor .rpe-handle{cursor:grab;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:16px;user-select:none}
.rabbit-prompt-editor .rpe-handle:active{cursor:grabbing}
.rabbit-prompt-editor .rpe-block.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px}
.rabbit-prompt-editor textarea,.rabbit-prompt-editor select,.rabbit-prompt-editor input[type=number]{font:inherit;border:1px solid #8795a4;border-radius:5px;padding:8px;background:white;color:#18212b;max-width:100%}
.rabbit-prompt-editor textarea{width:100%;resize:vertical;font:13px/1.6 ui-monospace,monospace}.rabbit-prompt-editor input[type=number]{width:100px}
.rabbit-prompt-editor button{font:inherit;border:1px solid #8795a4;border-radius:5px;padding:6px 10px;background:#f5f7fa;color:#18212b;cursor:pointer}
.rabbit-prompt-editor button:disabled{cursor:default;opacity:.5}.rabbit-prompt-editor :focus-visible{outline:3px solid #3874e5;outline-offset:2px}
.rabbit-prompt-editor .rpe-error{color:#a11a24;white-space:pre-wrap}.rabbit-prompt-editor pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;background:#f3f5f8;padding:12px;border-radius:5px;max-height:65vh;overflow:auto}
.rabbit-prompt-editor .rpe-preview{border:1px solid var(--rabbit-border);border-radius:8px;padding:14px;min-width:0;background:#fff}
.rabbit-prompt-editor .rpe-preview details{margin-top:12px}.rabbit-prompt-editor .rpe-preview summary{padding:8px 0}
.rabbit-prompt-editor .rpe-output-section{border:1px solid var(--rabbit-border);border-radius:6px;padding:12px;margin-top:12px;min-width:0}
.rabbit-prompt-editor .rpe-output-section h3{margin:0 0 8px}.rabbit-prompt-editor .rpe-output-section pre{margin:0}
.rabbit-prompt-editor .rpe-message+.rpe-message{border-top:1px solid var(--rabbit-border);padding-top:12px;margin-top:12px}
.rabbit-prompt-editor .rpe-message h4{margin:0 0 6px}
@media(max-width:850px){.rabbit-prompt-editor .rpe-layout{grid-template-columns:1fr}}
`

/** Local preview material. No model call or storage access is performed.
 * @returns {import('../types.js').TurnInput}
 */
export function promptEditorSampleInput() {
  return {
    instruction: '인물의 성격과 기존 사건을 지키며 한 장면씩 이야기를 이어 간다.',
    world: '## 세계관\n비 오는 밤, 작은 항구 마을의 오래된 도서관.',
    cards: [{ name: '유리', description: '기록을 지키는 사서. 낯선 사람에게도 차분하고 신중하다.' }, { name: '도윤', description: '사라진 항해일지를 찾는 선원.' }],
    player: { name: '여행자', description: '항구에 처음 도착했다.' },
    messages: [{ role: 'user', text: '이 책을 본 적 있나요?' }, { role: 'assistant', text: '유리: 이 표지는 기억나요. 어디서 찾으셨죠?\n*유리가 책 표지를 살핀다.*' }],
    userInput: '항구 창고에서 찾았어요.', rating: 'all', pacing: 'normal',
    worldbooks: [{ id: 'harbor', name: '항구', content: '항구 창고는 삼 년 전 폐쇄됐다.', strategy: 'always' }],
    memoryNotes: [{ kind: 'summary', text: '여행자는 유리와 책의 출처를 함께 조사하기로 했다.' }],
    sceneState: { ...emptySceneState(), place: '도서관', time: '비 오는 밤' },
    events: ['창밖에서 배의 종소리가 들린다.'],
  }
}

/**
 * Engine-owned UI with no framework dependency. Importing it does not access the DOM.
 * The host owns persistence, authentication and profile assignment.
 * @param {HTMLElement} container
 * @param {object} options
 * @param {import('../types.js').PromptProfile} options.value
 * @param {(value:import('../types.js').PromptProfile)=>void} options.onChange
 * @param {(valid:boolean)=>void} [options.onValidityChange]
 * @param {import('../types.js').TurnInput} [options.input] Initial preview material; defaults to local sample.
 * @param {Array<{id:string,name:string,content:string}>} [options.customBlocks] Host custom block library shown as tags and used for preview.
 * @returns {{setValue:(value:import('../types.js').PromptProfile)=>void,setCustomBlocks:(blocks:Array<{id:string,name:string,content:string}>)=>void,destroy:()=>void}}
 */
export function mountPromptEditor(container, options) {
  let value = validatePromptProfile(options.value)
  let input = options.input ?? promptEditorSampleInput()
  let library = options.customBlocks ?? []
  const labelOf = (key) => {
    if (!isCustomKey(key)) return LABELS[key]
    const id = key.slice(7)
    return library.find((block) => block.id === id)?.name ?? `목록에 없는 커스텀 블록 (${id})`
  }
  let destroyed = false
  let draggedChip
  let draggedKind
  let composerRange
  let previewRevision = 0
  let previewTimer
  const doc = container.ownerDocument
  const root = doc.createElement('div')
  root.className = 'rabbit-prompt-editor'
  const node = (tag, text, className) => {
    const result = doc.createElement(tag)
    if (text !== undefined) result.textContent = text
    if (className) result.className = className
    return result
  }
  const button = (text, callback) => {
    const result = node('button', text)
    result.type = 'button'
    result.addEventListener('click', callback)
    return result
  }
  const field = (text, control) => {
    const label = node('label', text)
    label.append(control)
    return label
  }
  root.append(node('style', STYLE))
  root.append(node('p', '블록은 시스템 프롬프트와 대화 안에 넣기 중 한 곳에만 있습니다. 커스텀 블록은 호스트의 커스텀 블록 목록에서 만든 문구이며, 대화 안에 넣으면 메시지 역할을 고를 수 있습니다. 두 구역 사이로 끌어 옮기거나 각 블록의 버튼을 쓰세요. 시스템 프롬프트의 캡슐은 Alt+←/→로 순서를 바꾸고 Backspace/Delete로 삭제합니다. 삭제한 블록은 + 태그 버튼이 다시 켜지며, 누르거나 원하는 구역으로 끌어 다시 넣습니다.', 'rpe-help'))
  const status = node('p')
  status.setAttribute('role', 'status')
  const errors = node('p', '', 'rpe-error')
  errors.setAttribute('role', 'alert')
  root.append(status, errors)
  const layout = node('div', undefined, 'rpe-layout')
  const composerPane = node('section', undefined, 'rpe-composer-pane')
  composerPane.setAttribute('aria-label', '시스템 프롬프트 편집')
  composerPane.append(node('h2', '시스템 프롬프트'))
  composerPane.append(node('p', '직접 쓴 문장과 태그가 표시된 순서대로 조립됩니다. 출력 규약 태그는 반드시 한 번 포함해야 합니다.', 'rpe-help'))
  const tagPalette = node('div', undefined, 'rpe-tags')
  tagPalette.setAttribute('aria-label', '태그 삽입')
  const composer = node('div', undefined, 'rpe-composer')
  composer.contentEditable = 'true'
  composer.spellcheck = false
  composer.setAttribute('role', 'textbox')
  composer.setAttribute('aria-label', '시스템 프롬프트 조립 문서')
  composer.setAttribute('aria-multiline', 'true')
  const zone = (title, help, name) => {
    const section = node('section', undefined, 'rpe-zone')
    section.dataset.zone = name
    section.setAttribute('aria-label', title)
    const list = node('div')
    section.append(node('h2', title), node('p', help, 'rpe-help'), list)
    return { section, list }
  }
  const conversationZone = zone('대화 안에 넣기', '모델이 최근 대화 가까이에서 읽을 블록입니다. 마지막 사용자 메시지 뒤에 놓은 블록은 [진행 메모]로 감싸 그 메시지에 붙습니다. 블록을 다른 블록 위에 놓으면 그 자리로 갑니다.', 'conversation')
  const advanced = node('details', undefined, 'rpe-advanced')
  advanced.append(node('summary', '태그별 문구'))
  advanced.append(node('p', '{{content}}는 해당 블록의 엔진 원문입니다. 블록의 자리는 위 구역에서 정합니다.', 'rpe-help'))
  const blockList = node('section')
  blockList.setAttribute('aria-label', '태그별 문구')
  advanced.append(blockList)
  // 시스템 프롬프트에 넣은 커스텀 블록은 캡슐이라 옆에 선택 상자를 둘 수 없다. 캡슐 아래에 교체 줄을 따로 둔다.
  const systemCustomList = node('div', undefined, 'rpe-custom-swaps')
  systemCustomList.setAttribute('aria-label', '시스템 프롬프트의 커스텀 블록 교체')
  composerPane.append(tagPalette, composer, systemCustomList, conversationZone.section, advanced)
  const preview = node('section', undefined, 'rpe-preview')
  preview.setAttribute('aria-label', '프롬프트 미리보기')
  preview.append(node('h2', '실제 조립 결과'))
  preview.append(node('p', '예시 데이터를 같은 RabbitEngine 조립 코드에 넣습니다. LLM 호출 없이 시스템과 대화 메시지를 확인합니다.', 'rpe-help'))
  const inputDetails = node('details')
  inputDetails.append(node('summary', '미리보기 데이터 수정'))
  const inputEditor = node('textarea')
  inputEditor.rows = 12
  inputEditor.maxLength = 80000
  // Dialects contain functions; the preview always uses the actual chosen dialect below.
  const { dialect, promptProfile, customBlocks, ...serializableInput } = input
  inputEditor.value = JSON.stringify(serializableInput, null, 2)
  inputDetails.append(field('캐릭터·세계관·대화 데이터 (JSON)', inputEditor))
  const inputError = node('p', '', 'rpe-error')
  inputError.setAttribute('role', 'alert')
  inputDetails.append(inputError)
  inputDetails.append(button('미리보기에 적용', () => {
    try {
      const parsed = JSON.parse(inputEditor.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.cards) || parsed.cards.length === 0) throw new Error('cards에 캐릭터를 한 명 이상 넣어 주세요.')
      input = { ...parsed, dialect: dialect ?? asteriskScript }
      inputError.textContent = ''
      schedulePreview()
    } catch (error) { inputError.textContent = String(error.message) }
  }))
  const previewStatus = node('p', '', 'rpe-help')
  previewStatus.setAttribute('role', 'status')
  const result = node('div')
  result.hidden = true
  const systemSection = node('section', undefined, 'rpe-output-section')
  const systemText = node('pre')
  systemSection.append(node('h3', '시스템 프롬프트'), systemText)
  const messageSection = node('section', undefined, 'rpe-output-section')
  const messageList = node('div')
  messageSection.append(node('h3', '대화 메시지'), messageList)
  result.append(systemSection, messageSection)
  const originals = node('details')
  originals.append(node('summary', '{{content}} 원문 확인'))
  const originalText = node('pre')
  originals.append(originalText)
  preview.append(inputDetails, previewStatus, result, originals)
  layout.append(composerPane, preview)
  root.append(layout)
  container.append(root)

  const tokenText = (token) => token.startsWith('{{block:')
    ? labelOf(token.slice(8, -2))
    : token === '{{user}}' ? '사용자 이름' : '캐릭터 이름'
  const chip = (token) => {
    const result = node('span', tokenText(token), 'rpe-chip')
    result.contentEditable = 'false'
    result.dataset.token = token
    if (token.startsWith('{{block:custom:')) result.dataset.custom = 'true'
    result.draggable = true
    result.tabIndex = 0
    const kind = token.startsWith('{{block:') ? token.slice(8, -2) : undefined
    result.title = kind
      ? `${tokenText(token)} · 드래그 또는 Alt+←/→로 이동, 대화 구역으로 끌어 옮기기, Backspace/Delete로 삭제`
      : `${tokenText(token)} · 드래그 또는 Alt+←/→로 이동, Backspace/Delete로 제거`
    result.addEventListener('dragstart', (event) => {
      draggedChip = result
      draggedKind = kind
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', token)
      if (kind) event.dataTransfer.setData(BLOCK_DRAG_TYPE, kind)
    })
    result.addEventListener('dragend', endDrag)
    result.addEventListener('keydown', (event) => {
      if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        const capsules = [...composer.querySelectorAll('.rpe-chip')]
        const index = capsules.indexOf(result)
        const neighbor = capsules[index + (event.key === 'ArrowLeft' ? -1 : 1)]
        if (neighbor) {
          reorderChip(result, neighbor, event.key === 'ArrowRight')
          result.focus()
        }
      } else if (['Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault()
        if (kind) placeBlock(kind, 'off')
        else { result.remove(); composerChanged() }
        composer.focus()
      }
    })
    return result
  }
  const caretStop = () => doc.createTextNode('\u200b')
  const ensureCaretStop = (capsule) => {
    const next = capsule.nextSibling
    if (next?.nodeType === 3) {
      if (!next.nodeValue.startsWith('\u200b')) next.nodeValue = `\u200b${next.nodeValue}`
      return next
    }
    const stop = caretStop()
    capsule.after(stop)
    return stop
  }
  const caretAfter = (capsule) => {
    const stop = ensureCaretStop(capsule)
    const range = doc.createRange()
    range.setStart(stop, 1)
    range.collapse(true)
    composer.focus()
    const selection = doc.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    composerRange = range.cloneRange()
  }
  const readComposer = (element = composer) => {
    let text = ''
    for (const child of element.childNodes) {
      if (child.nodeType === 3) text += child.nodeValue
      else if (child.dataset?.token) text += child.dataset.token
      else if (child.nodeName === 'BR') text += '\n'
      else {
        if (['DIV', 'P'].includes(child.nodeName) && text && !text.endsWith('\n')) text += '\n'
        text += readComposer(child)
      }
    }
    return text.replaceAll('\u200b', '')
  }
  const tagButtons = new Map()
  // 블록 태그 버튼은 삭제된(어느 구역에도 없는) 블록일 때만 켜진다.
  const refreshTagButtons = () => {
    for (const [token, control] of tagButtons) {
      if (!token.startsWith('{{block:')) continue
      const rule = ruleOf(token.slice(8, -2))
      control.disabled = Boolean(rule) && zoneOf(rule) !== 'off'
    }
  }
  const renderComposer = () => {
    const documentText = value.systemTemplate ?? defaultSystemTemplate(value.blocks)
    const parts = parseSystemTemplate(documentText)
    const children = [caretStop()]
    for (const part of parts) {
      if (part.type === 'text') children.push(doc.createTextNode(part.value))
      else {
        children.push(chip(part.type === 'block' ? `{{block:${part.value}}}` : `{{${part.value}}}`))
        children.push(caretStop())
      }
    }
    composer.replaceChildren(...children)
    composerRange = undefined
    draggedChip = undefined
    refreshTagButtons()
  }
  const selectionInsideComposer = (range) => range && composer.contains(range.commonAncestorContainer)
  const rememberRange = () => {
    const selection = doc.getSelection()
    if (selection?.rangeCount && selectionInsideComposer(selection.getRangeAt(0))) composerRange = selection.getRangeAt(0).cloneRange()
  }
  doc.addEventListener('selectionchange', rememberRange)
  const insertAtCaret = (inserted) => {
    const selection = doc.getSelection()
    const current = selection?.rangeCount ? selection.getRangeAt(0) : null
    const range = selectionInsideComposer(current) ? current.cloneRange()
      : selectionInsideComposer(composerRange) ? composerRange.cloneRange()
        : doc.createRange()
    if (!selectionInsideComposer(range)) range.selectNodeContents(composer)
    if (!selectionInsideComposer(current) && !selectionInsideComposer(composerRange)) range.collapse(false)
    range.deleteContents()
    range.insertNode(inserted)
    if (inserted.nodeType === 1 && inserted.classList.contains('rpe-chip')) {
      const stop = ensureCaretStop(inserted)
      range.setStart(stop, 1)
    } else range.setStartAfter(inserted)
    range.collapse(true)
    composer.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    composerRange = range.cloneRange()
  }
  // 문서를 직접 고쳐도(선택 삭제·붙여넣기) 구역이 어긋나지 않게, 태그 유무를 블록 상태에 되돌려 적는다.
  const syncFromDocument = () => {
    const tagged = blockKindsIn(value.systemTemplate)
    // 붙여넣기 등으로 들어온 라이브러리 블록 태그는 그 자리에 둔다. 목록에 없는 id 는 검증이 지운다.
    for (const key of tagged) {
      if (isCustomKey(key) && !ruleOf(key) && library.some((block) => block.id === key.slice(7))) {
        value.blocks.push({ kind: 'custom', id: key.slice(7), enabled: true, role: 'system', slot: 'system' })
      }
    }
    value.blocks = value.blocks.filter((rule) => {
      const key = profileKeyOf(rule)
      if (tagged.has(key)) {
        rule.enabled = true
        if (!isSystemRule(rule)) rule.slot = 'system'
      } else if (rule.enabled && isSystemRule(rule) && rule.kind !== 'output_contract') {
        // 커스텀 블록은 뺀 상태를 따로 두지 않는다 — 팔레트에서 다시 넣는다.
        if (rule.kind === 'custom') return false
        rule.enabled = false
      }
      return true
    })
  }
  const composerChanged = () => {
    value.systemTemplate = readComposer()
    syncFromDocument()
    refreshTagButtons()
    renderBlocks()
    changed()
  }
  const documentHas = (kind) => blockKindsIn(value.systemTemplate ?? defaultSystemTemplate(value.blocks)).has(kind)
  const ruleOf = (key) => value.blocks.find((block) => profileKeyOf(block) === key)
  const removeTag = (kind) => {
    if (!documentHas(kind)) return
    const text = value.systemTemplate ?? defaultSystemTemplate(value.blocks)
    try {
      value.systemTemplate = withoutSystemBlocks(text, (tagKind) => tagKind === kind)
    } catch {
      // 문서가 아직 잘못된 상태면 빈 문단 정리 없이 태그만 뺀다. 검증 오류는 그대로 보인다.
      value.systemTemplate = text.replace(new RegExp(`\\{\\{\\s*block:${kind}\\s*\\}\\}`), '')
    }
    renderComposer()
  }
  /**
   * 블록을 한 구역으로 옮긴다. 활성·위치·문서 태그는 여기서만 함께 바뀐다.
   * @param {string} kind
   * @param {'system'|'conversation'|'off'} target
   * @param {{range?:Range, before?:string, after?:string}} [where] 문서 안 위치, 또는 대화 구역에서 기준이 되는 블록
   */
  function placeBlock(kind, target, where = {}) {
    let rule = ruleOf(kind)
    if (!rule && isCustomKey(kind)) {
      if (target === 'off') return
      rule = { kind: 'custom', id: kind.slice(7), enabled: false, role: 'system', slot: 'system' }
      value.blocks.push(rule)
    }
    if (kind === 'output_contract' && target !== 'system') {
      errors.textContent = '출력 규약은 응답 파서와 맞물려 있어 시스템 프롬프트에만 둘 수 있습니다.'
      return
    }
    if (target === 'system') {
      if (!documentHas(kind)) {
        if (value.systemTemplate === undefined) renderComposer()
        const selection = doc.getSelection()
        if (where.range && selectionInsideComposer(where.range)) {
          selection.removeAllRanges()
          selection.addRange(where.range)
          composerRange = where.range.cloneRange()
        } else {
          const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null
          if (!selectionInsideComposer(activeRange) && !selectionInsideComposer(composerRange)
            && readComposer() && !readComposer().endsWith('\n\n')) insertAtCaret(doc.createTextNode('\n\n'))
        }
        insertAtCaret(chip(`{{block:${kind}}}`))
      }
      // 태그가 들어갔으므로 syncFromDocument 가 활성·시스템 위치로 맞춘다.
    } else {
      removeTag(kind)
      rule.enabled = target === 'conversation'
      if (target === 'off' && rule.kind === 'custom') value.blocks.splice(value.blocks.indexOf(rule), 1)
      if (target === 'conversation') {
        const anchor = where.before ?? where.after
        if (anchor && anchor !== kind) {
          rule.slot = slotAt(kind, positionOf(ruleOf(anchor)))
          const [moving] = value.blocks.splice(value.blocks.indexOf(rule), 1)
          const index = value.blocks.indexOf(ruleOf(anchor))
          value.blocks.splice(where.after ? index + 1 : index, 0, moving)
        } else if (isSystemRule(rule)) {
          rule.slot = PROMPT_MESSAGE_KINDS.includes(kind) ? 'default' : 'post_history'
        }
        // assistant 는 마지막 사용자 메시지 뒤(프리필 자리)에 둘 수 없다. 바로 앞자리로 옮긴다.
        if (rule.role === 'assistant' && rule.slot === 'post_history') rule.slot = { depth: 0 }
      }
    }
    composerChanged()
  }
  function endDrag() {
    draggedChip = undefined
    draggedKind = undefined
    root.querySelectorAll('.rpe-drag-over').forEach((element) => element.classList.remove('rpe-drag-over'))
  }
  const acceptBlockDrop = (element, onDrop) => {
    element.addEventListener('dragover', (event) => {
      if (!draggedKind) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      element.classList.add('rpe-drag-over')
    })
    element.addEventListener('dragleave', (event) => {
      if (!element.contains(event.relatedTarget)) element.classList.remove('rpe-drag-over')
    })
    element.addEventListener('drop', (event) => {
      if (!draggedKind) return
      event.preventDefault()
      event.stopPropagation()
      const kind = draggedKind
      endDrag()
      onDrop(kind, event)
    })
  }
  const dragSource = (element, kind) => {
    element.draggable = true
    element.addEventListener('dragstart', (event) => {
      draggedChip = undefined
      draggedKind = kind
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(BLOCK_DRAG_TYPE, kind)
      event.dataTransfer.setData('text/plain', labelOf(kind))
    })
    element.addEventListener('dragend', endDrag)
  }
  acceptBlockDrop(conversationZone.section, (kind) => placeBlock(kind, 'conversation'))
  const reorderChip = (moving, target, after) => {
    const capsules = [...composer.querySelectorAll('.rpe-chip')]
    const from = capsules.indexOf(moving)
    const destination = capsules.indexOf(target) + (after ? 1 : 0)
    if (destination === from || destination === from + 1) return
    const slots = capsules.map(() => doc.createComment('capsule-slot'))
    capsules.forEach((capsule, index) => capsule.replaceWith(slots[index]))
    capsules.splice(from, 1)
    capsules.splice(destination > from ? destination - 1 : destination, 0, moving)
    slots.forEach((slot, index) => slot.replaceWith(capsules[index]))
    caretAfter(moving)
    composerChanged()
  }
  composer.addEventListener('input', composerChanged)
  composer.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    insertAtCaret(doc.createTextNode('\n'))
    composerChanged()
  })
  composer.addEventListener('paste', (event) => {
    event.preventDefault()
    insertAtCaret(doc.createTextNode(event.clipboardData.getData('text/plain')))
    composerChanged()
  })
  const outsideBlockDrag = () => draggedKind && !(draggedChip && composer.contains(draggedChip))
  composer.addEventListener('dragover', (event) => {
    if (!(draggedChip && composer.contains(draggedChip)) && !outsideBlockDrag()) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    composer.classList.add('rpe-drag-over')
  })
  composer.addEventListener('dragleave', (event) => {
    if (!composer.contains(event.relatedTarget)) composer.classList.remove('rpe-drag-over')
  })
  composer.addEventListener('drop', (event) => {
    event.preventDefault()
    composer.classList.remove('rpe-drag-over')
    const target = event.target.nodeType === 1 ? event.target.closest('.rpe-chip') : event.target.parentElement?.closest('.rpe-chip')
    if (outsideBlockDrag()) {
      // 다른 구역에서 끌어 온 블록: 놓은 자리(캡슐 위면 그 앞뒤)에 태그를 넣는다.
      const kind = draggedKind
      endDrag()
      let range = null
      if (target && composer.contains(target)) {
        range = doc.createRange()
        const after = event.clientX >= target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2
        if (after) range.setStartAfter(ensureCaretStop(target))
        else range.setStartBefore(target)
        range.collapse(true)
      } else {
        const atPoint = doc.caretRangeFromPoint?.(event.clientX, event.clientY)
        if (selectionInsideComposer(atPoint)) range = atPoint
      }
      placeBlock(kind, 'system', range ? { range } : {})
      return
    }
    const moving = draggedChip
    endDrag()
    if (!moving || !composer.contains(moving)) return
    if (target === moving) return
    if (target && composer.contains(target)) {
      reorderChip(moving, target, event.clientX >= target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2)
      return
    }
    const range = doc.createRange()
    const atPoint = doc.caretRangeFromPoint?.(event.clientX, event.clientY)
    if (!selectionInsideComposer(atPoint)) return
    range.setStart(atPoint.startContainer, atPoint.startOffset)
    range.collapse(true)
    const marker = doc.createComment('capsule-drop')
    range.insertNode(marker)
    moving.remove()
    marker.replaceWith(moving)
    caretAfter(moving)
    composerChanged()
  })
  // 엔진 블록 → 호스트 커스텀 블록 → 이름 태그 순. 커스텀 목록이 바뀌면 다시 그린다.
  function renderPalette() {
    tagButtons.clear()
    tagPalette.replaceChildren()
    const keys = [...value.blocks.filter((block) => block.kind !== 'custom').map((block) => block.kind), ...library.map((block) => `custom:${block.id}`)]
    for (const kind of keys) {
      const token = `{{block:${kind}}}`
      const control = button(`+ ${labelOf(kind)}`, () => placeBlock(kind, 'system'))
      if (isCustomKey(kind)) control.dataset.custom = 'true'
      control.setAttribute('aria-label', `${isCustomKey(kind) ? '커스텀 블록 ' : ''}${labelOf(kind)} 태그를 커서 위치에 삽입`)
      control.title = '누르면 시스템 프롬프트 커서 위치에, 끌면 놓은 자리(시스템 프롬프트 또는 대화 안)에 넣습니다.'
      dragSource(control, kind)
      control.addEventListener('mousedown', (event) => event.preventDefault())
      tagButtons.set(token, control)
      tagPalette.append(control)
    }
    for (const [name, label] of [['char', '캐릭터 이름'], ['user', '사용자 이름']]) {
      const token = `{{${name}}}`
      const control = button(`+ ${label}`, () => { insertAtCaret(chip(token)); composerChanged() })
      control.setAttribute('aria-label', `${label} 태그를 커서 위치에 삽입`)
      control.addEventListener('mousedown', (event) => event.preventDefault())
      tagButtons.set(token, control)
      tagPalette.append(control)
    }
    refreshTagButtons()
  }

  function changed() {
    if (value.systemTemplate === undefined) renderComposer()
    try {
      const valid = validatePromptProfile(value)
      errors.textContent = ''
      status.textContent = '설정 형식이 올바릅니다. 저장하면 적용됩니다.'
      options.onValidityChange?.(true)
      options.onChange(valid)
      schedulePreview()
    } catch (error) {
      errors.textContent = String(error.message)
      status.textContent = ''
      options.onValidityChange?.(false)
      clearTimeout(previewTimer)
      previewRevision += 1
      previewStatus.textContent = '잘못된 항목을 고치면 미리보기가 갱신됩니다.'
      showOutput()
      originalText.textContent = ''
    }
  }

  // 대화 구역은 실제 대화 흐름 순서(앞쪽 자리 먼저)로 보여 준다. 같은 자리 안에서는 설정 순서가 조립 순서다.
  const conversationOrder = () => value.blocks
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => zoneOf(rule) === 'conversation')
    .sort((a, b) => positionOf(b.rule) - positionOf(a.rule) || a.index - b.index)
    .map(({ rule }) => rule)

  /**
   * 배치된 커스텀 블록을 같은 자리·역할 그대로 다른 커스텀 블록으로 바꾼다. 여러 버전의 지시문을 바꿔 끼우는 용도다.
   * @param {string} key 지금 배치된 블록의 키(custom:<id>)
   * @param {string} id 새로 넣을 커스텀 블록 id
   */
  function swapCustom(key, id) {
    const rule = ruleOf(key)
    const next = `custom:${id}`
    if (!rule || next === key) return
    if (ruleOf(next)) {
      errors.textContent = `${labelOf(next)}은(는) 이미 이 설정에 들어 있습니다. 한 설정에 같은 블록은 한 번만 넣을 수 있습니다.`
      return
    }
    const text = value.systemTemplate ?? (isSystemRule(rule) ? defaultSystemTemplate(value.blocks) : undefined)
    if (text !== undefined && blockKindsIn(text).has(key)) {
      value.systemTemplate = text.replace(new RegExp(`\\{\\{\\s*block:${key}\\s*\\}\\}`), `{{block:${next}}}`)
    }
    rule.id = id
    renderComposer()
    renderBlocks()
    changed()
  }

  /** 배치된 커스텀 블록의 교체 선택 상자. 현재 블록과, 아직 이 설정에 없는 목록의 블록만 고를 수 있다. */
  function swapSelect(rule) {
    const key = profileKeyOf(rule)
    const select = node('select')
    select.setAttribute('aria-label', `${labelOf(key)} 다른 커스텀 블록으로 교체`)
    const choices = library.filter((block) => block.id === rule.id || !ruleOf(`custom:${block.id}`))
    if (!choices.some((block) => block.id === rule.id)) choices.unshift({ id: rule.id, name: labelOf(key) })
    for (const block of choices) {
      const option = node('option', block.name)
      option.value = block.id
      select.append(option)
    }
    select.value = rule.id
    select.disabled = choices.length < 2
    select.title = select.disabled ? '바꿔 넣을 다른 커스텀 블록이 없습니다.' : '같은 자리·역할 그대로 다른 커스텀 블록으로 바꿉니다.'
    select.addEventListener('change', () => {
      swapCustom(key, select.value)
      root.querySelector(`[data-kind="custom:${select.value}"] select[aria-label$="교체"]`)?.focus()
    })
    return select
  }

  function renderSystemCustoms() {
    systemCustomList.replaceChildren()
    const rules = value.blocks.filter((rule) => rule.kind === 'custom' && zoneOf(rule) === 'system')
    if (!rules.length) return
    systemCustomList.append(node('p', '시스템 프롬프트에 넣은 커스텀 블록 — 같은 자리에서 다른 버전으로 바꿀 수 있습니다.', 'rpe-help'))
    for (const rule of rules) {
      const key = profileKeyOf(rule)
      const item = node('div', undefined, 'rpe-item')
      item.dataset.kind = key
      item.append(node('span', labelOf(key), 'rpe-item-name'), field('교체', swapSelect(rule)))
      systemCustomList.append(item)
    }
  }

  function renderConversation() {
    const list = conversationZone.list
    list.replaceChildren()
    const rules = conversationOrder()
    if (!rules.length) list.append(node('p', '대화 안에 넣은 블록이 없습니다. 블록을 여기로 끌어 오세요.', 'rpe-help'))
    let lastPosition
    rules.forEach((rule, order) => {
      const key = profileKeyOf(rule)
      const label = labelOf(key)
      const position = positionOf(rule)
      if (position !== lastPosition) list.append(node('h3', positionText(position)))
      lastPosition = position
      const item = node('div', undefined, 'rpe-item')
      item.dataset.kind = key
      // 마우스는 손잡이를 끌고, 키보드는 손잡이에서 위/아래 화살표로 이웃 블록의 자리로 옮긴다.
      const handle = node('span', '⠿', 'rpe-handle')
      handle.setAttribute('role', 'button')
      handle.tabIndex = 0
      handle.setAttribute('aria-label', `${label} 이동. 드래그하거나 위/아래 화살표.`)
      dragSource(handle, key)
      handle.addEventListener('keydown', (event) => {
        const neighbor = rules[order + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : NaN)]
        if (!neighbor) return
        event.preventDefault()
        placeBlock(key, 'conversation', event.key === 'ArrowUp' ? { before: profileKeyOf(neighbor) } : { after: profileKeyOf(neighbor) })
        list.querySelector(`[data-kind="${key}"] .rpe-handle`)?.focus()
      })
      acceptBlockDrop(item, (kind, event) => {
        if (kind === key) return
        const box = item.getBoundingClientRect()
        placeBlock(kind, 'conversation', event.clientY >= box.top + box.height / 2 ? { after: key } : { before: key })
      })
      const where = node('select')
      const choices = [['depth', '대화 중간']]
      if (rule.role !== 'assistant') choices.push(['post_history', '마지막 사용자 메시지 뒤'])
      if (PROMPT_MESSAGE_KINDS.includes(rule.kind)) choices.unshift(['default', `엔진 기본 · ${positionText(positionOf({ kind: rule.kind, slot: 'default' }))}`])
      for (const [key, text] of choices) {
        const option = node('option', text)
        option.value = key
        where.append(option)
      }
      where.value = typeof rule.slot === 'object' ? 'depth' : rule.slot
      const depth = node('input')
      depth.type = 'number'; depth.min = '0'; depth.max = String(PROMPT_PROFILE_LIMITS.depth); depth.step = '1'
      depth.value = String(typeof rule.slot === 'object' ? rule.slot.depth : Math.max(0, position))
      depth.setAttribute('aria-label', `${label}: 마지막 사용자 메시지보다 몇 개 앞`)
      const depthField = field('메시지 수', depth)
      depthField.hidden = where.value !== 'depth'
      where.setAttribute('aria-label', `${label} 대화 안 위치`)
      where.addEventListener('change', () => {
        rule.slot = where.value === 'depth' ? { depth: Math.max(0, position) } : where.value
        renderBlocks()
        changed()
        list.querySelector(`[data-kind="${key}"] select`)?.focus()
      })
      depth.addEventListener('input', () => { rule.slot = { depth: depth.value === '' ? NaN : Number(depth.value) }; changed() })
      // 입력 중에는 다시 그리지 않고, 값이 확정되면 새 자리 묶음으로 옮긴다.
      depth.addEventListener('change', () => {
        renderBlocks()
        list.querySelector(`[data-kind="${key}"] input[type=number]`)?.focus()
      })
      item.append(handle, node('span', label, 'rpe-item-name'))
      // 커스텀 블록만 역할을 고른다. 모델 메시지(assistant)는 대화 중간에만 둔다(프리필 금지).
      if (rule.kind === 'custom') {
        const role = node('select')
        for (const [key, text] of Object.entries(ROLE_LABELS)) {
          const option = node('option', text)
          option.value = key
          role.append(option)
        }
        role.value = rule.role
        role.setAttribute('aria-label', `${label} 메시지 역할`)
        role.addEventListener('change', () => {
          rule.role = role.value
          if (rule.role === 'assistant' && rule.slot === 'post_history') rule.slot = { depth: 0 }
          renderBlocks()
          changed()
          list.querySelector(`[data-kind="${key}"] select[aria-label$="메시지 역할"]`)?.focus()
        })
        item.append(role, field('교체', swapSelect(rule)))
      }
      item.append(where, depthField,
        button('시스템으로', () => placeBlock(key, 'system')),
        button('삭제', () => placeBlock(key, 'off')))
      list.append(item)
    })
  }

  const zoneText = (rule) => ({ system: '시스템 프롬프트', off: '삭제됨' })[zoneOf(rule)] ?? `대화 안 · ${positionText(positionOf(rule))}`

  function renderTemplates() {
    const opened = new Set([...blockList.querySelectorAll('details[open]')].map((element) => element.dataset.kind))
    blockList.replaceChildren()
    for (const block of value.blocks) {
      const key = profileKeyOf(block)
      const details = node('details', undefined, 'rpe-block')
      details.dataset.kind = key
      details.open = opened.has(key)
      details.append(node('summary', `${labelOf(key)} · ${zoneText(block)}`))
      const body = node('div', undefined, 'rpe-block-body')
      if (block.kind === 'custom') {
        const source = library.find((item) => item.id === block.id)
        body.append(node('p', source ? '커스텀 블록 문구는 이 설정이 아니라 커스텀 블록 목록에서 고칩니다. 고치면 이 블록을 쓰는 모든 설정에 반영됩니다.' : '커스텀 블록 목록에 이 블록이 없습니다. 삭제하거나 목록에 다시 만들어야 저장한 설정을 적용할 수 있습니다.', 'rpe-help'))
        if (source) body.append(node('pre', source.content))
        details.append(body)
        blockList.append(details)
        continue
      }
      const template = node('textarea')
      template.rows = block.kind === 'instruction' ? 5 : 3
      template.maxLength = PROMPT_PROFILE_LIMITS.template
      template.value = block.template
      template.spellcheck = false
      template.addEventListener('input', () => { block.template = template.value; changed() })
      body.append(field(`${LABELS[block.kind]} 문구`, template))
      if (block.kind === 'output_contract') body.append(node('p', '응답 파서와 맞물리는 출력 문법은 {{content}}로 한 번 유지합니다. 앞뒤의 추가 지시는 편집할 수 있습니다.', 'rpe-help'))
      if (['cast', 'context', 'worldbook', 'memory', 'scene_state', 'event'].includes(block.kind)) body.append(node('p', '해당 데이터가 있을 때만 생성됩니다. 같은 종류의 블록이 여러 개면 이 설정이 각각 적용됩니다.', 'rpe-help'))
      if (block.kind === 'worldbook') body.append(node('p', '시스템 프롬프트에 둔 로어북도 항목에 자체 depth가 있으면 그 항목만 대화 안의 해당 자리로 들어갑니다.', 'rpe-help'))
      details.append(body)
      blockList.append(details)
    }
  }

  function renderBlocks() {
    renderSystemCustoms()
    renderConversation()
    refreshTagButtons()
    renderTemplates()
  }

  const showOutput = (rendered) => {
    result.hidden = !rendered
    systemText.textContent = rendered?.system ?? ''
    messageList.replaceChildren()
    if (!rendered) return
    rendered.messages.forEach((message, index) => {
      const item = node('div', undefined, 'rpe-message')
      item.append(node('h4', `메시지 ${index + 1} · ${message.role}`), node('pre', message.text))
      messageList.append(item)
    })
    if (!rendered.messages.length) messageList.append(node('p', '대화 메시지 없음', 'rpe-help'))
  }

  function schedulePreview() {
    clearTimeout(previewTimer)
    const revision = ++previewRevision
    previewStatus.textContent = '미리보기 조립 중…'
    previewTimer = setTimeout(async () => {
      try {
        const valid = validatePromptProfile(value)
        // Preview never receives host LLM capabilities. Presets needing those fail visibly.
        const base = { ...input, dialect: input.dialect ?? dialect ?? asteriskScript }
        const [current, original] = await Promise.all([
          buildTurn({ ...base, promptProfile: valid, customBlocks: library.map(({ id, content }) => ({ id, content })) }),
          buildTurn({ ...base, promptProfile: undefined }),
        ])
        if (destroyed || revision !== previewRevision) return
        const currentRendered = current.render()
        showOutput(currentRendered)
        originalText.textContent = original.blocks.map((block) => `[${block.kind} · ${JSON.stringify(block.slot)}]\n${block.content}`).join('\n\n')
        previewStatus.textContent = `조립 완료 · 시스템 ${currentRendered.system.length.toLocaleString()}자 · 메시지 ${currentRendered.messages.length}개`
      } catch (error) {
        if (destroyed || revision !== previewRevision) return
        previewStatus.textContent = `미리보기를 만들 수 없습니다: ${error.message}`
        showOutput()
        originalText.textContent = ''
      }
    }, 150)
  }

  renderPalette()
  renderBlocks()
  renderComposer()
  schedulePreview()
  return {
    setValue(next) {
      value = validatePromptProfile(next)
      errors.textContent = ''
      status.textContent = ''
      options.onValidityChange?.(true)
      renderBlocks()
      renderComposer()
      schedulePreview()
    },
    setCustomBlocks(next) {
      library = next ?? []
      renderPalette()
      renderBlocks()
      renderComposer()
      schedulePreview()
    },
    destroy() {
      destroyed = true
      previewRevision += 1
      clearTimeout(previewTimer)
      doc.removeEventListener('selectionchange', rememberRange)
      root.remove()
    },
  }
}

export { defaultPromptProfile, validatePromptProfile }
