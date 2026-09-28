import { buildTurn } from '../build-turn.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { emptySceneState } from '../scene/state.js'
import { defaultPromptProfile, validatePromptProfile, parseSystemTemplate, PROMPT_PROFILE_LIMITS } from '../prompt/profile.js'

const LABELS = {
  instruction: '공통 지시문', world: '세계관', rating: '콘텐츠 등급', pacing: '진행 속도',
  character: '캐릭터', cast: '등장인물', player: '사용자 캐릭터', context: '선택된 기억',
  worldbook: '로어북', user_boundary: '사용자 역할 경계', output_contract: '출력 규약',
  memory: '기억 노트', scene_state: '장면 상태', event: '사건', directive: '턴 마무리 지시',
}
const DEFAULT_MESSAGE_KINDS = new Set(['memory', 'scene_state', 'event', 'directive'])

const defaultSystemTemplate = (blocks) => blocks
  .filter((block) => block.enabled && (block.kind === 'output_contract'
    || block.slot === 'system' || (block.slot === 'default' && !DEFAULT_MESSAGE_KINDS.has(block.kind))))
  .map((block) => `{{block:${block.kind}}}`)
  .join('\n\n')

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
 * @returns {{setValue:(value:import('../types.js').PromptProfile)=>void,destroy:()=>void}}
 */
export function mountPromptEditor(container, options) {
  let value = validatePromptProfile(options.value)
  let input = options.input ?? promptEditorSampleInput()
  let destroyed = false
  let dragIndex = null
  let draggedChip
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
  root.append(node('p', '시스템 프롬프트에 문장을 쓰고 태그를 커서 위치에 넣으세요. 캡슐은 드래그하거나 Alt+←/→로 옮기고 Backspace/Delete로 지울 수 있습니다.', 'rpe-help'))
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
  const advanced = node('details', undefined, 'rpe-advanced')
  advanced.append(node('summary', '태그별 문구와 대화 삽입 위치'))
  advanced.append(node('p', '{{content}}는 해당 태그의 엔진 원문입니다. 시스템 순서는 위 캡슐로, 대화 위치의 블록 순서는 여기 손잡이로 바꿉니다.', 'rpe-help'))
  const blockList = node('section')
  blockList.setAttribute('aria-label', '태그별 세부 설정')
  advanced.append(blockList)
  composerPane.append(tagPalette, composer, advanced)
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
  const { dialect, promptProfile, ...serializableInput } = input
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
    ? LABELS[token.slice(8, -2)]
    : token === '{{user}}' ? '사용자 이름' : '캐릭터 이름'
  const chip = (token) => {
    const result = node('span', tokenText(token), 'rpe-chip')
    result.contentEditable = 'false'
    result.dataset.token = token
    result.draggable = true
    result.tabIndex = 0
    result.title = `${tokenText(token)} · 드래그 또는 Alt+←/→로 이동, Backspace/Delete로 제거`
    result.addEventListener('dragstart', (event) => {
      draggedChip = result
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', token)
    })
    result.addEventListener('dragend', () => {
      draggedChip = undefined
      composer.classList.remove('rpe-drag-over')
    })
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
        result.remove()
        composerChanged()
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
  const refreshTagButtons = () => {
    const documentText = value.systemTemplate ?? defaultSystemTemplate(value.blocks)
    for (const [token, control] of tagButtons) {
      control.disabled = token.startsWith('{{block:') && documentText.includes(token)
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
  const composerChanged = () => {
    const firstDocument = value.systemTemplate === undefined
    value.systemTemplate = readComposer()
    refreshTagButtons()
    if (firstDocument) renderBlocks()
    changed()
  }
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
  composer.addEventListener('dragover', (event) => {
    if (!draggedChip || !composer.contains(draggedChip)) return
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
    const moving = draggedChip
    draggedChip = undefined
    if (!moving || !composer.contains(moving)) return
    const target = event.target.nodeType === 1 ? event.target.closest('.rpe-chip') : event.target.parentElement?.closest('.rpe-chip')
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
  for (const kind of value.blocks.map((block) => block.kind)) {
    const token = `{{block:${kind}}}`
    const control = button(`+ ${LABELS[kind]}`, () => {
      if ((value.systemTemplate ?? defaultSystemTemplate(value.blocks)).includes(token)) return
      const rule = value.blocks.find((block) => block.kind === kind)
      rule.enabled = true
      if (rule.slot === 'post_history' || typeof rule.slot === 'object' || (rule.slot === 'default' && DEFAULT_MESSAGE_KINDS.has(kind))) rule.slot = 'system'
      const selection = doc.getSelection()
      const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (!selectionInsideComposer(activeRange) && !selectionInsideComposer(composerRange)
        && readComposer() && !readComposer().endsWith('\n\n')) insertAtCaret(doc.createTextNode('\n\n'))
      insertAtCaret(chip(token))
      renderBlocks()
      composerChanged()
    })
    control.setAttribute('aria-label', `${LABELS[kind]} 태그를 커서 위치에 삽입`)
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

  // finalIndex 는 이동이 끝난 뒤 그 블록이 있어야 할 배열 인덱스다. 드롭 대상의 인덱스를
  // 이 값으로 바꾸는 계산은 각 호출부(드래그·화살표)가 맡는다 — splice 두 번이면 충분하다.
  function moveTo(from, finalIndex) {
    if (from === finalIndex || from == null || finalIndex == null) return
    const [item] = value.blocks.splice(from, 1)
    value.blocks.splice(finalIndex, 0, item)
    renderBlocks(item.kind)
    changed()
    blockList.querySelector(`[data-kind="${item.kind}"] .rpe-handle`)?.focus()
  }

  function renderBlocks(focusKind) {
    const opened = new Set([...blockList.querySelectorAll('details[open]')].map((element) => element.dataset.kind))
    blockList.replaceChildren()
    value.blocks.forEach((block, index) => {
      const details = node('details', undefined, 'rpe-block')
      details.dataset.kind = block.kind
      details.open = opened.has(block.kind) || block.kind === focusKind || block.kind === 'instruction'
      const summary = node('summary', `${index + 1}. ${LABELS[block.kind]}${block.enabled ? '' : ' · 비활성'}`)
      details.append(summary)
      const body = node('div', undefined, 'rpe-block-body')
      const controls = node('div', undefined, 'rpe-tools')
      const enabled = node('input')
      enabled.type = 'checkbox'
      enabled.checked = block.enabled
      enabled.disabled = block.kind === 'output_contract'
      const label = field('활성화', enabled)
      label.className = 'rpe-check'
      enabled.addEventListener('change', () => { block.enabled = enabled.checked; summary.textContent = `${index + 1}. ${LABELS[block.kind]}${block.enabled ? '' : ' · 비활성'}`; changed() })
      // 마우스는 드래그, 키보드는 이 손잡이에 초점을 두고 화살표로 인접 위치와 맞바꾼다 —
      // 버튼을 없애도 키보드·스크린리더 사용자가 순서를 바꿀 방법이 남아야 한다.
      const handle = node('span', '⠿', 'rpe-handle')
      handle.hidden = value.systemTemplate !== undefined
        && !(block.slot === 'post_history' || typeof block.slot === 'object'
          || (block.slot === 'default' && DEFAULT_MESSAGE_KINDS.has(block.kind)))
      handle.setAttribute('role', 'button')
      handle.tabIndex = 0
      handle.draggable = true
      handle.setAttribute('aria-label', `${LABELS[block.kind]} 순서 이동. 드래그하거나 위/아래 화살표.`)
      handle.addEventListener('dragstart', (event) => {
        dragIndex = index
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(index))
      })
      handle.addEventListener('dragend', () => {
        dragIndex = null
        blockList.querySelectorAll('.rpe-drag-over').forEach((element) => element.classList.remove('rpe-drag-over'))
      })
      handle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); moveTo(index, index - 1) }
        else if (event.key === 'ArrowDown' && index < value.blocks.length - 1) { event.preventDefault(); moveTo(index, index + 1) }
      })
      details.addEventListener('dragover', (event) => {
        if (dragIndex == null) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        details.classList.add('rpe-drag-over')
      })
      details.addEventListener('dragleave', () => details.classList.remove('rpe-drag-over'))
      details.addEventListener('drop', (event) => {
        event.preventDefault()
        details.classList.remove('rpe-drag-over')
        if (dragIndex == null) return
        moveTo(dragIndex, dragIndex < index ? index - 1 : index)
        dragIndex = null
      })
      controls.append(label, handle)
      const slot = node('select')
      for (const [key, text] of [['default', '엔진 기본 위치'], ['system', '시스템'], ['post_history', '마지막 사용자 메시지 뒤'], ['depth', '대화 중간']]) {
        const option = node('option', text)
        option.value = key
        slot.append(option)
      }
      slot.value = typeof block.slot === 'object' ? 'depth' : block.slot
      const depth = node('input')
      depth.type = 'number'; depth.min = '0'; depth.max = String(PROMPT_PROFILE_LIMITS.depth); depth.step = '1'
      depth.value = String(typeof block.slot === 'object' ? block.slot.depth : 0)
      const depthField = field('대화 끝에서 앞쪽으로 (메시지 수)', depth)
      depthField.hidden = slot.value !== 'depth'
      slot.addEventListener('change', () => {
        block.slot = slot.value === 'depth' ? { depth: Number(depth.value) } : slot.value
        depthField.hidden = slot.value !== 'depth'
        changed()
      })
      depth.addEventListener('input', () => { block.slot = { depth: depth.value === '' ? NaN : Number(depth.value) }; changed() })
      const template = node('textarea')
      template.rows = block.kind === 'instruction' ? 5 : 3
      template.maxLength = PROMPT_PROFILE_LIMITS.template
      template.value = block.template
      template.spellcheck = false
      template.addEventListener('input', () => { block.template = template.value; changed() })
      body.append(controls, field(`${LABELS[block.kind]} 삽입 위치`, slot), depthField, field(`${LABELS[block.kind]} 문구`, template))
      if (block.kind === 'output_contract') body.append(node('p', '응답 파서와 맞물리는 출력 문법은 {{content}}로 한 번 유지합니다. 앞뒤의 추가 지시는 편집할 수 있습니다.', 'rpe-help'))
      if (['cast', 'context', 'worldbook', 'memory', 'scene_state', 'event'].includes(block.kind)) body.append(node('p', '해당 데이터가 있을 때만 생성됩니다. 같은 종류의 블록이 여러 개면 이 설정이 각각 적용됩니다.', 'rpe-help'))
      details.append(body)
      blockList.append(details)
    })
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
          buildTurn({ ...base, promptProfile: valid }),
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
