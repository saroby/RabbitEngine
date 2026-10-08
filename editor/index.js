import { buildTurn } from '../build-turn.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { emptySceneState } from '../scene/state.js'
import {
  defaultPromptProfile, validatePromptProfile, parseSystemTemplate, withoutSystemBlocks, isSystemRule,
  profileKeyOf, PROMPT_MESSAGE_KINDS, PROMPT_PROFILE_LIMITS,
} from '../prompt/profile.js'
import { blockSnippet } from './snippet.js'
import {
  POST_HISTORY, MAX_DEPTH, positionOf, positionText, slotAt, historyLength, timelineRows, foldRows, gapAbove, gapBelow, keyboardStep,
} from './timeline.js'

const LABELS = {
  instruction: '엔진 지시문', world: '세계관', rating: '콘텐츠 등급', pacing: '진행 속도',
  character: '캐릭터', cast: '등장인물', player: '사용자 캐릭터', context: '선택된 기억',
  worldbook: '로어북', user_boundary: '사용자 역할 경계', output_contract: '출력 규약',
  memory: '기억 노트', scene_state: '장면 상태', event: '사건', directive: '턴 마무리 지시',
}
const BLOCK_DRAG_TYPE = 'application/x-rabbit-block'
const ROLE_LABELS = { system: '메모 — 사용자 쪽 메시지로 보냄', user: '사용자 메시지로 보냄', assistant: '모델 답변으로 보냄' }
// 카드 배지. 블록이 실제로 어느 쪽 메시지로 들어가는지 말한다(메모도 user 로 간다).
const ROLE_BADGES = { system: '사용자 쪽 · 메모', user: '사용자 쪽 · 사용자 메시지', assistant: '모델 쪽 · 모델 답변' }
// 더 이전 대화 보기 한 번에 늘리는 말풍선 수.
const HISTORY_STEP = 4
const DROP_TEXT = '+ 여기에 넣기'
const isCustomKey = (key) => key.startsWith('custom:')

const defaultSystemTemplate = (blocks) => blocks
  .filter((block) => block.enabled && (block.kind === 'output_contract' || isSystemRule(block)))
  .map((block) => `{{block:${profileKeyOf(block)}}}`)
  .join('\n\n')

// 블록은 세 구역 중 한 곳에만 있다. 활성·위치·문서 태그를 따로 두지 않고 구역에서 파생한다.
const zoneOf = (rule) => (!rule.enabled ? 'off' : isSystemRule(rule) ? 'system' : 'conversation')
const blockKindsIn = (text) => new Set([...text.matchAll(/\{\{\s*block:(custom:[a-z0-9][a-z0-9_-]{0,63}|[a-z_]+)\s*\}\}/g)].map((match) => match[1]))

const STYLE = `
.rabbit-prompt-editor{color:#18212b;background:#fff;color-scheme:light;padding:20px;border-radius:12px;font:14px/1.55 system-ui,sans-serif;--rabbit-border:#d4dce4;--rabbit-muted:#526171;max-width:100%}
.rabbit-prompt-editor *{box-sizing:border-box}.rabbit-prompt-editor [hidden]{display:none!important}.rabbit-prompt-editor h2,.rabbit-prompt-editor h3{margin:0 0 12px}
.rabbit-prompt-editor p{margin:8px 0}.rabbit-prompt-editor .rpe-help{color:var(--rabbit-muted)}
.rabbit-prompt-editor .rpe-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
.rabbit-prompt-editor .rpe-composer-pane{min-width:0}
.rabbit-prompt-editor .rpe-tags{margin:12px 0}
.rabbit-prompt-editor .rpe-tag-group{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}
.rabbit-prompt-editor .rpe-tag-group-label{flex:0 0 76px;font-size:12px;font-weight:600;color:var(--rabbit-muted)}
.rabbit-prompt-editor .rpe-tag-empty{font-size:12px;margin:0}
.rabbit-prompt-editor .rpe-guide{margin:4px 0 12px}.rabbit-prompt-editor .rpe-guide summary{padding:2px 0;font-weight:500;color:var(--rabbit-muted)}
.rabbit-prompt-editor .rpe-guide ul{margin:6px 0;padding-left:20px;color:var(--rabbit-muted)}
.rabbit-prompt-editor .rpe-composer{min-height:340px;max-height:65vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace;border:1px solid #8795a4;border-radius:7px;padding:14px;background:#fff;outline:none}
.rabbit-prompt-editor .rpe-composer.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px}
.rabbit-prompt-editor .rpe-chip{display:inline-block;vertical-align:baseline;white-space:nowrap;border:1px solid #a9c4ed;border-radius:999px;padding:0 7px;background:#eaf2ff;color:#164c9e;font:12px/1.7 system-ui,sans-serif;user-select:all;cursor:grab}
.rabbit-prompt-editor .rpe-chip:active{cursor:grabbing}
.rabbit-prompt-editor .rpe-chip-snippet{margin-left:6px;color:#5d6b7a;user-select:none}
.rabbit-prompt-editor .rpe-chip.rpe-selected{outline:2px solid #245dbd;outline-offset:1px;background:#d3e3ff}
.rabbit-prompt-editor .rpe-chip[data-custom].rpe-selected{outline-color:#b06a00;background:#ffe2b8}
.rabbit-prompt-editor .rpe-tags button{border-radius:999px;background:#eaf2ff;border-color:#a9c4ed;color:#164c9e}
.rabbit-prompt-editor .rpe-tags button[data-custom],.rabbit-prompt-editor .rpe-chip[data-custom]{background:#fff3e0;border-color:#e8b46a;color:#7a4100}
.rabbit-prompt-editor .rpe-chip[data-custom] .rpe-chip-snippet{color:#8a5a20}
.rabbit-prompt-editor .rpe-tags button[data-variable],.rabbit-prompt-editor .rpe-chip[data-variable]{background:#e6f6f1;border-color:#8fd1bc;color:#0b5e47}
.rabbit-prompt-editor .rpe-block-panel{width:min(640px,calc(100vw - 48px));max-height:calc(100vh - 96px);overflow:auto;border:1px solid var(--rabbit-border);border-radius:12px;padding:18px 20px;background:#fff;color:#18212b;color-scheme:light;box-shadow:0 12px 40px rgba(0,0,0,.25)}.rabbit-prompt-editor .rpe-block-panel::backdrop{background:rgba(0,0,0,.45)}.rabbit-prompt-editor .rpe-block-panel textarea{width:100%}
.rabbit-prompt-editor .rpe-block-panel-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.rabbit-prompt-editor .rpe-original{margin-top:8px}.rabbit-prompt-editor .rpe-original summary{cursor:pointer;color:var(--rabbit-muted);font-size:13px}.rabbit-prompt-editor .rpe-original pre{max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;padding:8px 10px;border-radius:6px;background:#f1f4f8;font:12px/1.6 ui-monospace,monospace}
.rabbit-prompt-editor .rpe-block-panel h3{margin:0;font-size:14px}.rabbit-prompt-editor .rpe-block-panel label{margin-top:6px}
.rabbit-prompt-editor .rpe-link{color:#245dbd;font-weight:600}
.rabbit-prompt-editor .rpe-zone{margin-top:18px;border:1px dashed #a3b0bd;border-radius:8px;padding:12px;background:#fafbfc}
.rabbit-prompt-editor .rpe-zone.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px;background:#f2f7ff}
.rabbit-prompt-editor .rpe-zone h2{font-size:16px;margin:0}
.rabbit-prompt-editor .rpe-zone-note{font-size:12px;color:var(--rabbit-muted);margin:4px 0}.rabbit-prompt-editor .rpe-zone-note[data-warn]{color:#a11a24}.rabbit-prompt-editor .rpe-zone-note:empty{display:none}
.rabbit-prompt-editor .rpe-timeline{display:flex;flex-direction:column;margin-top:8px}
.rabbit-prompt-editor .rpe-history-controls{align-self:center;display:flex;gap:6px}
.rabbit-prompt-editor .rpe-fold{align-self:stretch;margin:4px 18px 8px;padding:6px 10px;font-size:12px;color:var(--rabbit-muted);background:#f4f6f8;border:1px dashed var(--rabbit-border);border-radius:8px;cursor:pointer}
.rabbit-prompt-editor .rpe-fold:hover{color:#245dbd;border-color:#a9c4ed;background:#f5f8ff}
.rabbit-prompt-editor .rpe-more{font-size:12px;padding:2px 10px;border-style:dashed;background:#fff;color:var(--rabbit-muted)}
.rabbit-prompt-editor .rpe-bubble{display:flex;align-items:center;gap:6px;max-width:80%;padding:5px 12px;border-radius:14px;font-size:12px;color:#3f4d5b;background:#eceff3;user-select:none}
.rabbit-prompt-editor .rpe-bubble[data-role=user]{align-self:flex-end;background:#e4edfb;color:#24466f;border-bottom-right-radius:4px}
.rabbit-prompt-editor .rpe-bubble[data-role=assistant]{align-self:flex-start;border-bottom-left-radius:4px}
.rabbit-prompt-editor .rpe-bubble.rpe-bubble-last{background:#d6e4ff;color:#123f85;font-weight:600;box-shadow:inset 0 0 0 1px #8fb0ea}
.rabbit-prompt-editor .rpe-gap{position:relative;display:flex;flex-direction:column;gap:4px;padding:3px 0 25px}
.rabbit-prompt-editor .rpe-gap-drop{position:absolute;left:18px;right:18px;bottom:2px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#245dbd;border:1px dashed #a9c4ed;border-radius:6px;background:#f5f8ff;opacity:0;transition:opacity .12s;pointer-events:none}
.rabbit-prompt-editor .rpe-gap:hover>.rpe-gap-drop,.rabbit-prompt-editor.rpe-dragging .rpe-gap-drop{opacity:1}
.rabbit-prompt-editor .rpe-gap.rpe-drag-over>.rpe-gap-drop{border-style:solid;border-color:#3874e5;background:#e3edff;font-weight:600}
.rabbit-prompt-editor .rpe-gap.rpe-drop-blocked>.rpe-gap-drop{opacity:1;color:#a11a24;border-color:#e3a1a7;background:#fff3f4}
.rabbit-prompt-editor .rpe-gap-caption{font-size:11px;color:var(--rabbit-muted);text-align:center;margin-top:2px}
.rabbit-prompt-editor .rpe-card{display:flex;align-items:center;gap:8px;margin:0 18px;padding:5px 10px;border:1px solid var(--rabbit-border);border-left:3px solid #3874e5;border-radius:7px;background:#fff;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.rabbit-prompt-editor .rpe-card:hover{background:#f8fbff;border-color:#a9c4ed;border-left-color:#3874e5}
.rabbit-prompt-editor .rpe-card[data-custom]{border-left-color:#e08a1e}.rabbit-prompt-editor .rpe-card[data-custom]:hover{border-left-color:#e08a1e}
.rabbit-prompt-editor .rpe-card.rpe-selected{box-shadow:0 0 0 2px #3874e5}.rabbit-prompt-editor .rpe-card[data-side=user]{align-self:flex-end;width:82%;margin:0 0 0 auto}.rabbit-prompt-editor .rpe-card[data-side=assistant]{align-self:flex-start;width:82%;margin:0 auto 0 0}
.rabbit-prompt-editor .rpe-card-grip{color:#9aa6b2;cursor:grab;user-select:none;font-size:13px}
.rabbit-prompt-editor .rpe-card-name{font-weight:600;white-space:nowrap}
.rabbit-prompt-editor .rpe-badge{font-size:11px;padding:0 7px;border-radius:999px;background:#eef1f5;color:#3f4d5b;white-space:nowrap}
.rabbit-prompt-editor .rpe-badge[data-role=user]{background:#e4edfb;color:#164c9e}.rabbit-prompt-editor .rpe-badge[data-role=assistant]{background:#efe9fb;color:#5a3c99}
.rabbit-prompt-editor .rpe-card-snippet{flex:1 1 60px;min-width:0;font-size:12px;color:var(--rabbit-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rabbit-prompt-editor .rpe-default-tag{font-size:11px;color:#6b7785;border:1px dashed #b7c1cc;border-radius:999px;padding:0 6px;white-space:nowrap}
.rabbit-prompt-editor .rpe-panel-section{margin-top:14px;padding-top:10px;border-top:1px solid var(--rabbit-border)}
.rabbit-prompt-editor .rpe-panel-section h4{margin:0 0 4px;font-size:13px}
.rabbit-prompt-editor .rpe-panel-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.rabbit-prompt-editor .rpe-danger{color:#a11a24;border-color:#e3a1a7;background:#fff}
.rabbit-prompt-editor .rpe-advanced{margin-top:18px;border-top:1px solid var(--rabbit-border)}
.rabbit-prompt-editor .rpe-block{border:1px solid var(--rabbit-border);border-radius:8px;margin:10px 0;background:#fff;overflow:hidden}
.rabbit-prompt-editor summary{cursor:pointer;font-weight:600;padding:12px;overflow-wrap:anywhere}
.rabbit-prompt-editor .rpe-block-body{padding:0 12px 12px}.rabbit-prompt-editor label{display:grid;gap:4px;margin:10px 0;font-weight:500}
.rabbit-prompt-editor .rpe-check{display:flex;align-items:center;gap:8px}.rabbit-prompt-editor .rpe-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rabbit-prompt-editor .rpe-block.rpe-drag-over{outline:2px dashed #3874e5;outline-offset:2px}
.rabbit-prompt-editor textarea,.rabbit-prompt-editor select{font:inherit;border:1px solid #8795a4;border-radius:5px;padding:8px;background:white;color:#18212b;max-width:100%}
.rabbit-prompt-editor textarea{width:100%;resize:vertical;font:13px/1.6 ui-monospace,monospace}
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
 * @param {boolean} [options.disabled] Disable editing while keeping block inspection and dialog dismissal available.
 * @param {import('../types.js').TurnInput} [options.input] Initial preview material; defaults to local sample.
 * @param {Array<{id:string,name:string,content?:string,messages?:Array<{role:'user'|'assistant',content:string}>,defaultRole?:'system'|'user'|'assistant'}>} [options.customBlocks] Host custom block library shown as tags and used for preview. Text blocks have content; message blocks have messages and live only in the conversation. defaultRole user/assistant sends a text block into the conversation with that role.
 * @param {(id:string)=>string} [options.customBlockHref] Link to the host's edit page for a custom block. When given, the custom block's wording panel shows its text read-only with a "커스텀 블록에서 편집" link (same tab; the host handles unsaved-change confirmation).
 * @returns {{setValue:(value:import('../types.js').PromptProfile)=>void,setCustomBlocks:(blocks:Array<{id:string,name:string,content:string}>)=>void,setDisabled:(disabled:boolean)=>void,destroy:()=>void}}
 */
export function mountPromptEditor(container, options) {
  let value = validatePromptProfile(options.value)
  let disabled = Boolean(options.disabled)
  let input = options.input ?? promptEditorSampleInput()
  let library = options.customBlocks ?? []
  const sourceOf = (key) => (isCustomKey(key) ? library.find((block) => block.id === key.slice(7)) : undefined)
  // 대화 블록(역할이 정해진 메시지 묶음)과 기본 역할이 사용자·모델인 블록은 시스템 프롬프트가 아니라 대화 안이 제자리다.
  const isMessageBlock = (key) => Array.isArray(sourceOf(key)?.messages)
  const belongsInConversation = (key) => isMessageBlock(key) || ['user', 'assistant'].includes(sourceOf(key)?.defaultRole)
  const labelOf = (key) => {
    if (!isCustomKey(key)) return LABELS[key]
    const id = key.slice(7)
    return library.find((block) => block.id === id)?.name ?? `목록에 없는 커스텀 블록 (${id})`
  }
  let destroyed = false
  // 문구 패널이 열린 블록의 키. 캡슐이나 대화 블록을 누르면 정해진다.
  let selectedKey
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
  root.append(node('p', '태그로 블록을 배치하고, 캡슐이나 대화 안 카드를 누르면 팝업에서 문구를 고칩니다.', 'rpe-help'))
  const guide = node('details', undefined, 'rpe-guide')
  const guideList = node('ul')
  for (const text of [
    '블록은 시스템 프롬프트와 대화 안에 넣기 중 한 곳에만 있습니다. 두 구역 사이로 끌어 옮기거나 팝업의 버튼을 쓰세요.',
    '캡슐을 누르거나 초점을 맞춘 뒤 Enter를 누르면 블록 문구가 열립니다. Esc나 닫기 버튼으로 닫습니다.',
    '시스템 프롬프트의 캡슐은 Alt+←/→로 순서를 바꾸고 Backspace/Delete로 뺍니다. 뺀 블록은 위 태그 줄에 + 버튼으로 다시 나타나며, 누르거나 원하는 구역으로 끌어 다시 넣습니다.',
    '대화 안에 넣기는 위가 오래된 대화, 맨 아래가 이번 입력인 대화 흐름입니다. 카드를 말풍선 사이 칸에 끌어 놓으면 그 자리에 들어갑니다.',
    '카드에 초점을 맞추고 Alt+↑/↓를 누르면 같은 칸 안에서 먼저 순서를 바꾸고, 칸의 맨 위·맨 아래에서는 이웃 칸으로 넘어갑니다. 카드를 누르거나 Enter를 누르면 팝업에서 문구·역할·위치를 고칩니다.',
    '커스텀 블록은 호스트의 커스텀 블록 목록에서 만든 문구입니다. 대화 안에 넣으면 카드 팝업에서 메시지 역할을 고르거나 다른 커스텀 블록으로 교체합니다.',
  ]) guideList.append(node('li', text))
  guide.append(node('summary', '도움말'), guideList)
  root.append(guide)
  const status = node('p')
  status.setAttribute('role', 'status')
  const errors = node('p', '', 'rpe-error')
  errors.setAttribute('role', 'alert')
  root.append(status, errors)
  const layout = node('fieldset', undefined, 'rpe-layout')
  layout.style.border = '0'
  layout.style.padding = '0'
  layout.style.margin = '0'
  layout.style.minWidth = '0'
  layout.disabled = disabled
  const composerPane = node('section', undefined, 'rpe-composer-pane')
  composerPane.setAttribute('aria-label', '시스템 프롬프트 편집')
  composerPane.append(node('h2', '시스템 프롬프트'))
  composerPane.append(node('p', '직접 쓴 문장과 태그가 표시된 순서대로 조립됩니다. 출력 규약 태그는 반드시 한 번 포함해야 합니다.', 'rpe-help'))
  const tagPalette = node('div', undefined, 'rpe-tags')
  tagPalette.setAttribute('aria-label', '태그 삽입')
  const composer = node('div', undefined, 'rpe-composer')
  composer.contentEditable = String(!disabled)
  composer.setAttribute('aria-readonly', String(disabled))
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
  const conversationZone = zone('대화 안에 넣기', '모델이 최근 대화 가까이에서 읽을 블록입니다. 위가 오래된 대화, 맨 아래가 이번 입력입니다. 블록 하나가 대화 메시지 하나로 들어갑니다 — 오른쪽 카드는 사용자 쪽, 왼쪽 카드는 모델 쪽 메시지입니다(메모도 사용자 쪽). 같은 쪽 메시지가 이어지면 공급자에 따라 하나로 합쳐 보내질 수 있습니다. 마지막 메시지 뒤 칸의 블록은 따로 메시지가 되지 않고 [진행 메모]로 감싸 이번 입력 끝에 붙습니다.', 'conversation')
  conversationZone.list.className = 'rpe-timeline'
  conversationZone.list.setAttribute('role', 'group')
  conversationZone.list.setAttribute('aria-label', '대화 흐름 (위가 오래된 대화)')
  // 이동이 막힌 이유 등 대화 구역 안내. 설정 검증 결과(status·errors)와 섞이지 않게 따로 둔다.
  const zoneNote = node('p', '', 'rpe-zone-note')
  zoneNote.setAttribute('role', 'status')
  conversationZone.list.before(zoneNote)
  // "더 이전 대화 보기"로 늘린 말풍선 수. 배치가 바뀌어도 이 화면에서는 유지한다.
  let requestedHistory = 0
  // 블록이 없어 접혀 있던 구간 중 펼친 자리. "이전 대화 접기"가 비운다.
  const unfolded = new Set()
  const advanced = node('details', undefined, 'rpe-advanced')
  advanced.append(node('summary', '모든 블록 문구'))
  advanced.append(node('p', '{{content}}는 해당 블록의 엔진 원문입니다. 블록의 자리는 위 구역에서 정합니다. 캡슐이나 대화 안 카드를 누르면 그 블록의 문구만 팝업으로 열립니다.', 'rpe-help'))
  const blockList = node('section')
  blockList.setAttribute('aria-label', '모든 블록 문구')
  advanced.append(blockList)
  // 선택한 블록의 문구는 팝업(모달 dialog)으로 연다. 화면 안에 끼워 넣으면 누를 때마다 레이아웃이 밀린다.
  const blockPanel = node('dialog', undefined, 'rpe-block-panel')
  blockPanel.setAttribute('aria-label', '블록 문구')
  blockPanel.addEventListener('cancel', (event) => {
    event.preventDefault()
    closePanel(true)
  })
  // 바깥(배경)을 누르면 닫는다. dialog 자신이 눌린 경우만 배경이다.
  blockPanel.addEventListener('click', (event) => { if (event.target === blockPanel) closePanel(true) })
  composerPane.append(tagPalette, composer, conversationZone.section, advanced)
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
  preview.append(inputDetails, previewStatus, result)
  // 블록 종류별 {{content}} 원문(미리보기 데이터 기준). 문구를 고치는 바로 그 자리에서 보여 준다.
  let originalsByKind = new Map()
  layout.append(composerPane, preview)
  root.append(layout, blockPanel)
  container.append(root)

  // Fieldsets disable native controls, but not editable documents, capsule shortcuts or dragging.
  // Inspection (click/Enter) and dismissal (close/Escape) remain available while editing is locked.
  const preventEditing = (event) => {
    if (!disabled) return
    if (event.type === 'keydown' && !event.altKey && !['Backspace', 'Delete'].includes(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  for (const type of ['beforeinput', 'input', 'paste', 'cut', 'dragstart', 'dragover', 'drop', 'keydown']) {
    root.addEventListener(type, preventEditing, true)
  }

  const tokenText = (token) => token.startsWith('{{block:')
    ? labelOf(token.slice(8, -2))
    : token === '{{user}}' ? '사용자 이름' : '캐릭터 이름'
  // 표시용 문구 미리보기. 커스텀 블록은 목록의 문구, 엔진 블록은 이 설정의 template 이다.
  const snippetOf = (key) => blockSnippet(isCustomKey(key) ? sourceOf(key) : ruleOf(key))
  const snippetNode = (key, className) => {
    const result = node('span', snippetOf(key), className)
    result.dataset.snippetFor = key
    result.setAttribute('aria-hidden', 'true')
    return result
  }
  // 캡슐 텍스트는 readComposer 가 읽지 않는다(data-token 만 저장). 미리보기 문구도 저장값에 섞이지 않는다.
  const chip = (token) => {
    const result = node('span', tokenText(token), 'rpe-chip')
    result.contentEditable = 'false'
    result.dataset.token = token
    if (token.startsWith('{{block:custom:')) result.dataset.custom = 'true'
    result.draggable = true
    result.tabIndex = 0
    const kind = token.startsWith('{{block:') ? token.slice(8, -2) : undefined
    if (kind) result.append(snippetNode(kind, 'rpe-chip-snippet'))
    else result.dataset.variable = 'true'
    if (kind && kind === selectedKey) result.classList.add('rpe-selected')
    result.title = kind
      ? `${tokenText(token)} · 누르거나 Enter로 문구 편집, 드래그 또는 Alt+←/→로 이동, 대화 구역으로 끌어 옮기기, Backspace/Delete로 삭제`
      : `${tokenText(token)} · 드래그 또는 Alt+←/→로 이동, Backspace/Delete로 제거`
    if (kind) {
      result.addEventListener('click', () => {
        // 캡슐은 통째로 선택되는데(user-select:all), 그대로 두면 다음 태그 삽입이 이 캡슐을 덮어쓴다. 캐럿을 캡슐 뒤로 접는다.
        const selection = doc.getSelection()
        if (selection?.rangeCount && !selection.isCollapsed && selection.getRangeAt(0).intersectsNode(result)) {
          const range = doc.createRange()
          range.setStart(ensureCaretStop(result), 1)
          range.collapse(true)
          selection.removeAllRanges()
          selection.addRange(range)
          composerRange = range.cloneRange()
        }
        selectBlock(kind)
      })
    }
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
      } else if (kind && event.key === 'Enter' && !event.isComposing) {
        // 문서의 Enter(줄바꿈)로 번지지 않게 막고 문구 패널을 연다.
        event.preventDefault()
        event.stopPropagation()
        selectBlock(kind, { focus: true })
      } else if (kind && event.key === 'Escape' && selectedKey === kind) {
        event.preventDefault()
        closePanel(false)
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
  // 태그 줄은 삭제된(어느 구역에도 없는) 블록만 보여 주므로 배치가 바뀔 때마다 다시 그린다.
  const refreshTagButtons = () => renderPalette()
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
    markSelection()
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
      const defaultRole = sourceOf(kind)?.defaultRole
      rule = { kind: 'custom', id: kind.slice(7), enabled: false, role: ['user', 'assistant'].includes(defaultRole) ? defaultRole : 'system', slot: 'system' }
      value.blocks.push(rule)
    }
    if (isMessageBlock(kind) && target === 'system') {
      errors.textContent = `${labelOf(kind)}은(는) 역할이 정해진 대화 블록이라 대화 안에만 둘 수 있습니다.`
      if (!rule.enabled) value.blocks.splice(value.blocks.indexOf(rule), 1)
      return
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
        if (where.position !== undefined) {
          // 타임라인의 칸에 놓았다: 그 칸의 자리로 바꾸고, 칸 안에서는 기준 블록 앞이나 칸의 처음·끝에 둔다.
          rule.slot = slotAt(kind, where.position)
          const stack = conversationOrder().filter((other) => other !== rule && positionOf(other) === where.position)
          const before = where.before && where.before !== kind ? ruleOf(where.before) : undefined
          const reference = before ?? (where.edge === 'start' ? stack[0] : stack.at(-1))
          if (reference && stack.includes(reference)) {
            const [moving] = value.blocks.splice(value.blocks.indexOf(rule), 1)
            const index = value.blocks.indexOf(reference)
            value.blocks.splice(before || where.edge === 'start' ? index : index + 1, 0, moving)
          }
        } else if (anchor && anchor !== kind) {
          rule.slot = slotAt(kind, positionOf(ruleOf(anchor)))
          const [moving] = value.blocks.splice(value.blocks.indexOf(rule), 1)
          const index = value.blocks.indexOf(ruleOf(anchor))
          value.blocks.splice(where.after ? index + 1 : index, 0, moving)
        } else if (isSystemRule(rule)) {
          rule.slot = PROMPT_MESSAGE_KINDS.includes(kind) ? 'default' : belongsInConversation(kind) ? { depth: 0 } : 'post_history'
        }
        // assistant·대화 블록은 마지막 사용자 메시지 뒤(프리필·메모 자리)에 둘 수 없다. 바로 앞자리로 옮긴다.
        if ((rule.role === 'assistant' || isMessageBlock(kind)) && rule.slot === 'post_history') rule.slot = { depth: 0 }
      }
    }
    composerChanged()
  }
  function endDrag() {
    draggedChip = undefined
    draggedKind = undefined
    root.classList.remove('rpe-dragging')
    root.querySelectorAll('.rpe-drag-over, .rpe-drop-blocked').forEach((element) => element.classList.remove('rpe-drag-over', 'rpe-drop-blocked'))
    root.querySelectorAll('.rpe-gap-drop').forEach((element) => { element.textContent = DROP_TEXT })
  }
  // 블록을 끄는 동안에는 타임라인의 "+ 여기에 넣기" 칸을 모두 드러낸다.
  root.addEventListener('dragstart', () => { if (draggedKind) root.classList.add('rpe-dragging') })
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
  // 엔진 블록 · 커스텀 블록 · 변수 세 줄로 나눈다. 블록 줄에는 아직 배치하지 않은 것만 + 버튼으로 둔다.
  function renderPalette() {
    tagPalette.replaceChildren()
    const group = (title, controls, emptyText) => {
      const row = node('div', undefined, 'rpe-tag-group')
      row.setAttribute('role', 'group')
      row.setAttribute('aria-label', title)
      row.append(node('span', title, 'rpe-tag-group-label'))
      if (controls.length) row.append(...controls)
      else row.append(node('span', emptyText, 'rpe-help rpe-tag-empty'))
      tagPalette.append(row)
    }
    const unplaced = (key) => { const rule = ruleOf(key); return !rule || zoneOf(rule) === 'off' }
    const blockControl = (kind) => {
      // 대화용 블록은 누르면 대화 안(마지막 사용자 메시지 바로 앞)에 들어간다. 나머지는 시스템 프롬프트 커서 위치다.
      const toConversation = belongsInConversation(kind)
      const control = button(`+ ${labelOf(kind)}`, () => placeBlock(kind, toConversation ? 'conversation' : 'system'))
      if (isCustomKey(kind)) control.dataset.custom = 'true'
      control.dataset.kind = kind
      control.setAttribute('aria-label', `${isCustomKey(kind) ? '커스텀 블록' : '엔진 블록'} ${labelOf(kind)}을(를) ${toConversation ? '대화 안에' : '시스템 프롬프트 커서 위치에'} 넣기`)
      control.title = `${toConversation ? '누르면 대화 안(마지막 사용자 메시지 바로 앞)에' : '누르면 시스템 프롬프트 커서 위치에'}, 끌면 놓은 자리(시스템 프롬프트 또는 대화 안)에 넣습니다.`
      // mousedown 의 기본 동작을 막으면 끌기가 시작되지 않는다. 커서 위치는 composerRange 가 기억하므로 막지 않는다.
      dragSource(control, kind)
      return control
    }
    group('엔진 블록', value.blocks.filter((block) => block.kind !== 'custom' && unplaced(block.kind)).map((block) => blockControl(block.kind)), '모두 배치됨')
    if (library.length) group('커스텀 블록', library.map((block) => `custom:${block.id}`).filter(unplaced).map(blockControl), '모두 배치됨')
    group('변수', [['char', '캐릭터 이름'], ['user', '사용자 이름']].map(([name, label]) => {
      const token = `{{${name}}}`
      const control = button(`+ ${label}`, () => { insertAtCaret(chip(token)); composerChanged() })
      control.dataset.variable = 'true'
      control.setAttribute('aria-label', `${label} 변수 ${token}를 커서 위치에 삽입`)
      control.title = `대화할 때 ${label}으로 바뀝니다.`
      control.addEventListener('mousedown', (event) => event.preventDefault())
      return control
    }), '')
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
      setOriginals([])
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
    if (selectedKey === key) selectedKey = next
    if (isMessageBlock(next) && rule.slot === 'post_history') rule.slot = { depth: 0 }
    renderComposer()
    renderBlocks()
    changed()
  }

  /** 배치된 커스텀 블록의 교체 선택 상자. 현재 블록과, 아직 이 설정에 없는 목록의 블록만 고를 수 있다. */
  function swapSelect(rule) {
    const key = profileKeyOf(rule)
    const select = node('select')
    select.setAttribute('aria-label', `${labelOf(key)} 다른 커스텀 블록으로 교체`)
    const inSystem = zoneOf(rule) === 'system'
    const choices = library.filter((block) => block.id === rule.id
      || (!ruleOf(`custom:${block.id}`) && !(inSystem && Array.isArray(block.messages))))
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
      focusPanelControl('swap')
    })
    return select
  }

  // 끌고 있거나 옮기려는 블록을 이 자리에 둘 수 없으면 그 이유. 둘 수 있으면 빈 문자열.
  const dropBlockReason = (kind, position) => {
    if (kind === 'output_contract') return '출력 규약은 시스템 프롬프트에만 둘 수 있습니다.'
    if (position !== POST_HISTORY) return ''
    if (isMessageBlock(kind)) return '대화 블록은 마지막 메시지 뒤에 둘 수 없습니다.'
    if ((ruleOf(kind)?.role ?? sourceOf(kind)?.defaultRole) === 'assistant') return '모델 메시지는 마지막 메시지 뒤에 둘 수 없습니다 (프리필 미지원).'
    return ''
  }
  const note = (text, warn = false) => {
    zoneNote.textContent = text
    zoneNote.toggleAttribute('data-warn', warn)
  }
  /**
   * 대화 안에서 블록을 옮긴다. 둘 수 없는 자리면 이유를 알리고 그대로 둔다.
   * @param {string} key
   * @param {{position?:number, edge?:'start'|'end', before?:string, after?:string}} where
   */
  const moveInConversation = (key, where) => {
    const reason = where.position !== undefined ? dropBlockReason(key, where.position) : ''
    if (reason) {
      note(reason, true)
      return false
    }
    placeBlock(key, 'conversation', where)
    const rule = ruleOf(key)
    if (rule && zoneOf(rule) === 'conversation') note(`${labelOf(key)} · ${positionText(positionOf(rule))}`)
    return true
  }
  const focusCard = (key) => conversationZone.list.querySelector(`.rpe-card[data-kind="${key}"]`)?.focus()

  // 대화 구역은 위(오래된 대화)에서 아래(이번 입력)로 흐르는 타임라인이다. 말풍선 사이 칸이 자리(depth)이고,
  // 같은 칸 안에서는 설정 순서가 조립 순서다.
  function renderConversation() {
    const list = conversationZone.list
    list.replaceChildren()
    const rules = conversationOrder()
    const deepest = Math.max(-1, ...rules.map(positionOf))
    const history = historyLength(deepest, requestedHistory)
    // 블록이 있는 칸과 그 바로 위 말풍선, 가장 앞쪽 블록보다 더 앞(더 보기로 늘린 것)은 보이고,
    // 그 사이의 빈 구간은 접는다. 펼친 구간은 unfolded 에 남는다.
    const occupied = new Set(rules.map(positionOf))
    const shown = (position) => occupied.has(position) || occupied.has(position - 1) || position > deepest || unfolded.has(position)
    const rows = foldRows(timelineRows(history), shown)
    const floor = historyLength(deepest)
    const more = button(history >= MAX_DEPTH ? `더 이전 대화 없음 (최대 ${MAX_DEPTH}개 앞)` : '더 이전 대화 보기', () => {
      requestedHistory = Math.min(MAX_DEPTH, history + HISTORY_STEP)
      renderConversation()
      list.querySelector('.rpe-more')?.focus()
    })
    more.className = 'rpe-more'
    more.disabled = history >= MAX_DEPTH
    more.title = '위쪽에 이전 대화 말풍선을 더 보여 줘서 더 앞자리에도 블록을 놓을 수 있게 합니다.'
    const less = button('이전 대화 접기', () => {
      requestedHistory = 0
      unfolded.clear()
      renderConversation()
      list.querySelector('.rpe-more')?.focus()
    })
    less.className = 'rpe-more rpe-less'
    less.disabled = history <= floor && !unfolded.size
    less.title = less.disabled
      ? '더 접을 이전 대화가 없습니다. 블록이 없는 구간은 이미 접혀 있습니다.'
      : '더 보기로 늘리거나 펼친 말풍선을 다시 접습니다. 놓은 블록은 그대로입니다.'
    const controls = node('div', undefined, 'rpe-history-controls')
    controls.append(more, less)
    list.append(controls)
    if (!rules.length) list.append(node('p', '대화 안에 넣은 블록이 없습니다. 태그나 캡슐을 말풍선 사이 칸으로 끌어 오세요.', 'rpe-help'))
    for (const row of rows) {
      if (row.type === 'fold') {
        const fold = button(`⋯ 이전 대화 말풍선 ${row.count}개 접힘 · 펼치기`, () => {
          for (let position = row.to; position <= row.from; position += 1) unfolded.add(position)
          renderConversation()
          list.querySelector(`.rpe-gap[data-position="${row.from}"]`)?.scrollIntoView({ block: 'nearest' })
          list.querySelector('.rpe-less')?.focus()
        })
        fold.className = 'rpe-fold'
        fold.title = `이번 입력보다 메시지 ${row.to}~${row.from}개 앞 구간입니다. 블록이 없어 접어 두었습니다. 펼치면 이 구간의 칸에도 블록을 놓을 수 있습니다.`
        list.append(fold)
        continue
      }
      if (row.type === 'gap') {
        list.append(gapNode(row.position, rules.filter((rule) => positionOf(rule) === row.position)))
        continue
      }
      const bubble = node('div', undefined, 'rpe-bubble')
      bubble.dataset.role = row.role
      if (row.index === 0) bubble.classList.add('rpe-bubble-last')
      const icon = node('span', row.role === 'user' ? '👤' : '🤖')
      icon.setAttribute('aria-hidden', 'true')
      bubble.append(icon, node('span', row.label))
      list.append(bubble)
    }
  }

  /** 말풍선 사이 칸. 블록 카드를 설정 순서대로 쌓고, 끌어 온 블록을 받는다. */
  function gapNode(position, stack) {
    const gap = node('div', undefined, 'rpe-gap')
    gap.dataset.position = String(position)
    gap.setAttribute('role', 'group')
    gap.setAttribute('aria-label', positionText(position))
    if (position === POST_HISTORY) gap.append(node('div', '↓ 뒤에 붙임 ([진행 메모])', 'rpe-gap-caption'))
    const keys = stack.map(profileKeyOf)
    for (const rule of stack) gap.append(cardNode(rule, position, keys))
    const drop = node('div', DROP_TEXT, 'rpe-gap-drop')
    drop.setAttribute('aria-hidden', 'true')
    gap.append(drop)
    gap.addEventListener('dragover', (event) => {
      if (!draggedKind) return
      // 구역 전체의 받기(엔진 기본 자리)로 번지지 않게 한다. 막힌 칸은 놓을 수 없음으로 남는다.
      event.stopPropagation()
      const reason = dropBlockReason(draggedKind, position)
      gap.classList.toggle('rpe-drop-blocked', Boolean(reason))
      drop.textContent = reason || DROP_TEXT
      if (reason) {
        event.dataTransfer.dropEffect = 'none'
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      gap.classList.add('rpe-drag-over')
    })
    gap.addEventListener('dragleave', (event) => {
      if (gap.contains(event.relatedTarget)) return
      gap.classList.remove('rpe-drag-over', 'rpe-drop-blocked')
      drop.textContent = DROP_TEXT
    })
    gap.addEventListener('drop', (event) => {
      if (!draggedKind) return
      event.preventDefault()
      event.stopPropagation()
      const kind = draggedKind
      endDrag()
      // 놓은 높이보다 아래쪽 절반에 걸친 첫 카드 앞에 둔다. 없으면 칸의 끝이다.
      const below = [...gap.querySelectorAll('.rpe-card')].find((card) => {
        const box = card.getBoundingClientRect()
        return card.dataset.kind !== kind && event.clientY < box.top + box.height / 2
      })
      if (moveInConversation(kind, { position, ...(below ? { before: below.dataset.kind } : { edge: 'end' }) })) focusCard(kind)
    })
    return gap
  }

  /** 대화 안 블록 카드. 행 안에는 조작 요소를 두지 않고, 누르면 팝업에서 문구·역할·위치를 고친다. */
  function cardNode(rule, position, stack) {
    const key = profileKeyOf(rule)
    const label = labelOf(key)
    const card = node('div', undefined, 'rpe-card')
    card.dataset.kind = key
    if (rule.kind === 'custom') card.dataset.custom = 'true'
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.setAttribute('aria-haspopup', 'dialog')
    const grip = node('span', '⠿', 'rpe-card-grip')
    grip.setAttribute('aria-hidden', 'true')
    const message = isMessageBlock(key)
    const role = rule.kind === 'custom' ? rule.role : 'system'
    const appended = position === POST_HISTORY
    const badge = node('span', message ? `대화 블록 · 메시지 ${sourceOf(key).messages.length}개` : appended ? '이번 입력 끝에 붙음' : ROLE_BADGES[role], 'rpe-badge')
    if (!message) badge.dataset.role = role
    // 보내지는 쪽에 붙인다: 모델 답변은 왼쪽, 메모·사용자 메시지·이번 입력에 붙는 블록은 오른쪽. 대화 블록은 양쪽을 담아 가운데.
    card.dataset.side = message ? 'both' : role === 'assistant' ? 'assistant' : 'user'
    card.append(grip, node('span', label, 'rpe-card-name'), badge)
    if (!message) card.append(snippetNode(key, 'rpe-card-snippet'))
    const engineDefault = rule.slot === 'default'
    if (engineDefault) card.append(node('span', '엔진 기본 위치', 'rpe-default-tag'))
    card.setAttribute('aria-label', `${label} · ${badge.textContent} · ${positionText(position)}${engineDefault ? ' · 엔진 기본 위치' : ''}`)
    card.title = '누르거나 Enter로 문구·역할·위치 편집 · 말풍선 사이 칸으로 끌거나 Alt+↑/↓로 이동'
    if (selectedKey === key) card.classList.add('rpe-selected')
    dragSource(card, key)
    card.addEventListener('click', () => selectBlock(key))
    card.addEventListener('keydown', (event) => {
      if (event.target !== card || event.isComposing) return
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const up = event.key === 'ArrowUp'
        const step = keyboardStep({ position, stack, key, direction: up ? 'up' : 'down' })
        if (!step) note(up ? `더 앞으로 옮길 수 없습니다 (최대 ${MAX_DEPTH}개 앞).` : '이미 맨 아래(마지막 메시지 뒤)입니다.', true)
        else moveInConversation(key, step)
        focusCard(key)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectBlock(key, { focus: true })
      }
    })
    return card
  }

  const zoneText = (rule) => ({ system: '시스템 프롬프트', off: '삭제됨' })[zoneOf(rule)] ?? `대화 안 · ${positionText(positionOf(rule))}`

  // 팝업 안에서 다시 그린 뒤 같은 조작 요소로 초점을 돌린다. 막혀 있으면 다음 후보로 간다.
  const focusPanelControl = (...names) => {
    for (const name of names) {
      const element = blockPanel.querySelector(`[data-panel-control="${name}"]`)
      if (element && !element.disabled) return element.focus()
    }
    blockPanel.querySelector('button')?.focus()
  }

  /** 대화 안 블록의 팝업 조작: 역할·교체(커스텀), 위치, 시스템으로 옮기기·빼기. 카드 행에 있던 조작을 모두 여기로 모은다. */
  function conversationControls(rule) {
    const key = profileKeyOf(rule)
    const position = positionOf(rule)
    const control = (element, name) => {
      element.dataset.panelControl = name
      return element
    }
    const parts = []
    if (rule.kind === 'custom') {
      const section = node('div', undefined, 'rpe-panel-section')
      section.append(node('h4', '메시지'))
      if (isMessageBlock(key)) {
        section.append(node('p', `대화 블록 · 메시지 ${sourceOf(key).messages.length}개. 메시지마다 역할이 정해져 있어 그대로 들어갑니다.`, 'rpe-help'))
      } else {
        const role = node('select')
        for (const [name, text] of Object.entries(ROLE_LABELS)) {
          const option = node('option', text)
          option.value = name
          role.append(option)
        }
        role.value = rule.role
        role.setAttribute('aria-label', `${labelOf(key)} 메시지 역할`)
        role.addEventListener('change', () => {
          rule.role = role.value
          // 모델 메시지는 마지막 메시지 뒤(프리필 자리)에 둘 수 없다. 바로 앞자리로 옮긴다.
          if (rule.role === 'assistant' && rule.slot === 'post_history') rule.slot = { depth: 0 }
          renderBlocks()
          changed()
          focusPanelControl('role')
        })
        section.append(field('역할', control(role, 'role')))
      }
      const swap = control(swapSelect(rule), 'swap')
      section.append(field('교체', swap))
      parts.push(section)
    }
    const where = node('div', undefined, 'rpe-panel-section')
    where.append(node('h4', '위치'), node('p', `${positionText(position)}${rule.slot === 'default' ? ' · 엔진 기본 위치' : ''}`, 'rpe-help'))
    const actions = node('div', undefined, 'rpe-panel-actions')
    const above = gapAbove(position)
    const below = gapBelow(position)
    const up = control(button('한 칸 위로', () => {
      moveInConversation(key, { position: above, edge: 'end' })
      focusPanelControl('up', 'down')
    }), 'up')
    up.disabled = above === undefined
    up.title = up.disabled ? `더 앞으로 옮길 수 없습니다 (최대 ${MAX_DEPTH}개 앞).` : '말풍선 하나만큼 더 오래된 쪽 칸으로 옮깁니다.'
    const blocked = below === undefined ? '이미 맨 아래(마지막 메시지 뒤)입니다.' : dropBlockReason(key, below)
    const down = control(button('한 칸 아래로', () => {
      moveInConversation(key, { position: below, edge: 'start' })
      focusPanelControl('down', 'up')
    }), 'down')
    down.disabled = Boolean(blocked)
    down.title = blocked || '말풍선 하나만큼 이번 입력 쪽 칸으로 옮깁니다.'
    actions.append(up, down)
    if (PROMPT_MESSAGE_KINDS.includes(rule.kind) && rule.slot !== 'default') {
      actions.append(control(button('엔진 기본 위치로 되돌리기', () => {
        rule.slot = 'default'
        renderBlocks()
        changed()
        note(`${labelOf(key)} · ${positionText(positionOf(rule))}`)
        focusPanelControl('up', 'down')
      }), 'reset'))
    }
    where.append(actions)
    if (blocked && below !== undefined) where.append(node('p', blocked, 'rpe-help'))
    parts.push(where)
    const out = node('div', undefined, 'rpe-panel-section')
    const row = node('div', undefined, 'rpe-panel-actions')
    if (!isMessageBlock(key)) {
      row.append(control(button('시스템 프롬프트로 옮기기', () => {
        placeBlock(key, 'system')
        closePanel(true)
      }), 'system'))
    }
    const remove = control(button('빼기', () => {
      placeBlock(key, 'off')
      note(`${labelOf(key)}을(를) 뺐습니다. 위 태그 줄에서 다시 넣을 수 있습니다.`)
      tagPalette.querySelector(`button[data-kind="${key}"]`)?.focus()
    }), 'remove')
    remove.classList.add('rpe-danger')
    row.append(remove)
    out.append(row)
    parts.push(out)
    return parts
  }

  // 패널과 `모든 블록 문구`가 같은 편집 부품을 쓴다. 문구 입력은 다른 쪽 입력란과 캡슐 미리보기에 바로 반영한다.
  function blockEditorParts(block) {
    const key = profileKeyOf(block)
    const parts = []
    if (block.kind === 'custom') {
      const source = library.find((item) => item.id === block.id)
      const href = source ? options.customBlockHref?.(block.id) : undefined
      parts.push(node('p', !source ? '커스텀 블록 목록에 이 블록이 없습니다. 삭제하거나 목록에 다시 만들어야 저장한 설정을 적용할 수 있습니다.'
        : href ? '커스텀 블록 문구는 여기서 읽기만 합니다. 커스텀 블록에서 고치면 이 블록을 쓰는 모든 설정에 반영됩니다.'
          : '커스텀 블록 문구는 이 설정이 아니라 커스텀 블록 목록에서 고칩니다. 고치면 이 블록을 쓰는 모든 설정에 반영됩니다.', 'rpe-help'))
      if (source) parts.push(node('pre', Array.isArray(source.messages)
        ? source.messages.map((message) => `[${message.role}] ${message.content}`).join('\n\n')
        : source.content))
      if (href) {
        const link = node('a', '커스텀 블록에서 편집 ↗', 'rpe-link')
        link.href = href
        const line = node('p')
        line.append(link)
        parts.push(line)
      }
      return parts
    }
    const template = node('textarea')
    template.rows = block.kind === 'instruction' ? 5 : 3
    template.maxLength = PROMPT_PROFILE_LIMITS.template
    template.value = block.template
    template.spellcheck = false
    template.dataset.templateFor = key
    template.addEventListener('input', () => {
      block.template = template.value
      changed()
      for (const other of root.querySelectorAll('textarea[data-template-for]')) {
        if (other !== template && other.dataset.templateFor === key) other.value = block.template
      }
      refreshSnippets()
    })
    parts.push(field(`${LABELS[block.kind]} 문구`, template))
    const original = node('details', undefined, 'rpe-original')
    original.append(node('summary', '{{content}} 원문 — 미리보기 데이터에서 이 자리에 들어가는 내용'), node('pre'))
    original.dataset.originalFor = block.kind
    fillOriginal(original)
    parts.push(original)
    if (block.kind === 'output_contract') parts.push(node('p', '응답 파서와 맞물리는 출력 문법은 {{content}}로 한 번 유지합니다. 앞뒤의 추가 지시는 편집할 수 있습니다.', 'rpe-help'))
    if (['cast', 'context', 'worldbook', 'memory', 'scene_state', 'event'].includes(block.kind)) parts.push(node('p', '해당 데이터가 있을 때만 생성됩니다. 같은 종류의 블록이 여러 개면 이 설정이 각각 적용됩니다.', 'rpe-help'))
    if (block.kind === 'worldbook') parts.push(node('p', '시스템 프롬프트에 둔 로어북도 항목에 자체 depth가 있으면 그 항목만 대화 안의 해당 자리로 들어갑니다.', 'rpe-help'))
    return parts
  }

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
      body.append(...blockEditorParts(block))
      details.append(body)
      blockList.append(details)
    }
  }

  function fillOriginal(element) {
    const text = originalsByKind.get(element.dataset.originalFor)
    element.querySelector('pre').textContent = text ?? '이 미리보기 데이터에는 이 블록의 원문이 없습니다. 원본 데이터가 있을 때만 생성됩니다.'
  }

  function setOriginals(blocks) {
    originalsByKind = new Map()
    for (const block of blocks) originalsByKind.set(block.kind, [originalsByKind.get(block.kind), block.content].filter(Boolean).join('\n\n'))
    for (const element of root.querySelectorAll('[data-original-for]')) fillOriginal(element)
  }

  const refreshSnippets = () => {
    for (const element of root.querySelectorAll('[data-snippet-for]')) element.textContent = snippetOf(element.dataset.snippetFor)
  }

  // 선택 표시: 캡슐과 대화 안 카드에 강조 테두리.
  function markSelection() {
    for (const capsule of composer.querySelectorAll('.rpe-chip')) {
      capsule.classList.toggle('rpe-selected', Boolean(selectedKey) && capsule.dataset.token === `{{block:${selectedKey}}}`)
    }
    for (const card of conversationZone.list.querySelectorAll('.rpe-card[data-kind]')) card.classList.toggle('rpe-selected', card.dataset.kind === selectedKey)
  }

  function renderPanel() {
    const rule = selectedKey ? ruleOf(selectedKey) : undefined
    if (!rule || zoneOf(rule) === 'off') {
      selectedKey = undefined
      if (blockPanel.open) blockPanel.close()
      blockPanel.replaceChildren()
      markSelection()
      return
    }
    const head = node('div', undefined, 'rpe-block-panel-head')
    head.append(node('h3', `블록 문구 · ${labelOf(selectedKey)}`), button('닫기', () => closePanel(true)))
    blockPanel.dataset.panelFor = selectedKey
    const inConversation = zoneOf(rule) === 'conversation'
    const controls = node('fieldset')
    controls.style.border = '0'
    controls.style.padding = '0'
    controls.style.margin = '0'
    controls.style.minWidth = '0'
    controls.disabled = disabled
    controls.append(...blockEditorParts(rule), ...(inConversation ? conversationControls(rule) : []))
    blockPanel.replaceChildren(head, node('p', `${inConversation ? '대화 안' : '시스템 프롬프트'} · ${isCustomKey(selectedKey) ? '커스텀 블록' : '엔진 블록'}`, 'rpe-help'), controls)
    if (!blockPanel.open && blockPanel.isConnected) blockPanel.showModal()
    markSelection()
  }

  /** 블록을 선택해 문구 팝업을 연다. 키보드로 열었으면 첫 입력란으로 초점을 옮긴다. */
  function selectBlock(key, { focus = false } = {}) {
    selectedKey = key
    renderPanel()
    if (focus) (blockPanel.querySelector('textarea') ?? blockPanel.querySelector('a') ?? blockPanel.querySelector('[data-panel-control]:not(:disabled)') ?? blockPanel.querySelector('button'))?.focus()
  }

  function closePanel(restoreFocus) {
    const key = selectedKey
    selectedKey = undefined
    renderPanel()
    if (!restoreFocus || !key) return
    const origin = composer.querySelector(`.rpe-chip[data-token="{{block:${key}}}"]`)
      ?? conversationZone.list.querySelector(`.rpe-card[data-kind="${key}"]`)
    origin?.focus()
  }

  function renderBlocks() {
    renderConversation()
    refreshTagButtons()
    renderTemplates()
    renderPanel()
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
          buildTurn({ ...base, promptProfile: valid, customBlocks: library.map(({ id, content, messages }) => (Array.isArray(messages) ? { id, messages } : { id, content })) }),
          buildTurn({ ...base, promptProfile: undefined }),
        ])
        if (destroyed || revision !== previewRevision) return
        const currentRendered = current.render()
        showOutput(currentRendered)
        setOriginals(original.blocks)
        previewStatus.textContent = `조립 완료 · 시스템 ${currentRendered.system.length.toLocaleString()}자 · 메시지 ${currentRendered.messages.length}개`
      } catch (error) {
        if (destroyed || revision !== previewRevision) return
        previewStatus.textContent = `미리보기를 만들 수 없습니다: ${error.message}`
        showOutput()
        setOriginals([])
      }
    }, 150)
  }

  renderPalette()
  renderBlocks()
  renderComposer()
  schedulePreview()
  return {
    setDisabled(next) {
      disabled = Boolean(next)
      layout.disabled = disabled
      composer.contentEditable = String(!disabled)
      composer.setAttribute('aria-readonly', String(disabled))
      const controls = blockPanel.querySelector('fieldset')
      if (controls) controls.disabled = disabled
    },
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
      if (blockPanel.open) blockPanel.close()
      previewRevision += 1
      clearTimeout(previewTimer)
      doc.removeEventListener('selectionchange', rememberRange)
      root.remove()
    },
  }
}

export { defaultPromptProfile, validatePromptProfile }
