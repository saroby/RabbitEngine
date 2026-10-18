import { mountPromptEditor, defaultPromptProfile, validatePromptProfile } from './index.js'
import { specHtml } from './spec.js'

const KEY = 'rabbit-engine.prompt-profiles.v1'
// 호스트가 관리하는 커스텀 블록 목록의 예시. 독립 페이지에서는 고칠 수 없고 미리보기에만 쓴다.
const SAMPLE_CUSTOM_BLOCKS = Object.freeze([
  { id: 'common-rules', name: '공통 규칙', content: '{{char}}의 말투와 성격을 끝까지 유지한다. {{user}}의 행동을 대신 정하지 않는다.' },
  { id: 'style-example', name: '문체 예시 (모델)', defaultRole: 'assistant', content: '*유리가 조용히 책장을 넘긴다.*\n유리: "그 이야기는 조금 뒤에 해도 될까요?"' },
  { id: 'example-pair', name: '대화 예시 한 쌍', messages: [{ role: 'user', content: '테스트 요청: 짧게 답해 줘.' }, { role: 'assistant', content: '테스트 응답: 알겠습니다.' }] },
])
const byId = (id) => document.getElementById(id)
const list = byId('profiles')
const listView = byId('list-view')
const editView = byId('edit-view')
const editTitle = byId('edit-title')
const name = byId('name')
const save = byId('save')
const cancel = byId('cancel')
const edit = byId('edit')
const duplicate = byId('duplicate')
const remove = byId('delete')
const more = byId('more')
const moreMenu = byId('more-menu')
const addSheet = byId('add-sheet')
const importFile = byId('import')
let profiles = []
let selectedId
// 편집 화면을 연 시점의 설정. 취소의 기준이며, 새 설정은 첫 저장 전까지 여기에만 있다.
let opened
// 설정은 읽기 모드로 연다. 수정을 눌러야 고칠 수 있고, 저장을 눌러야 적용된다.
let editing = false
let draft
let dirty = false
let valid = true
let editor
let addCard
let loadError

function readProfile(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error('설정 이름은 1~120자여야 합니다.')
  return { id: typeof value.id === 'string' && value.id.length < 100 ? value.id : crypto.randomUUID(), name: value.name, value: validatePromptProfile(value.value) }
}

try {
  const raw = localStorage.getItem(KEY)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('저장된 설정 목록 형식이 올바르지 않습니다.')
    profiles = parsed.map(readProfile)
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('저장된 설정 ID가 중복되었습니다.')
  }
} catch (error) {
  loadError = `저장된 설정을 읽을 수 없습니다. 기존 저장 데이터는 변경하지 않았습니다. ${error.message}`
}

if (!profiles.length) profiles = [{ id: crypto.randomUUID(), name: '기본 설정', value: defaultPromptProfile() }]

const unsaved = () => Boolean(selectedId) && !profiles.some((profile) => profile.id === selectedId)

function status() {
  // 바뀐 것이 없으면 저장을 끈다. 저장 전인 새 설정만은 바뀐 것이 없어도 저장할 수 있다.
  save.disabled = !selectedId || !valid || !name.value.trim() || (!dirty && !unsaved())
  byId('dirty').hidden = !dirty
  // 읽기 모드: 수정 · 복제 · JSON 내보내기 · 삭제. 수정 모드: 저장 · 취소. 복제 · 내보내기 · 삭제는 저장된 설정을 대상으로 한다.
  byId('read-actions').hidden = editing
  byId('edit-actions').hidden = !editing
  byId('more-actions').hidden = editing
  name.readOnly = !editing
  if (opened) editTitle.textContent = titleOf(opened)
}

// 더보기 메뉴: 복제 · JSON 내보내기 · 삭제. ↑/↓ · Home/End 로 옮기고 Esc 나 바깥을 누르면 닫는다.
const menuItems = () => [...moreMenu.querySelectorAll('[role="menuitem"]')]
function openMenu(index = 0) {
  moreMenu.hidden = false
  more.setAttribute('aria-expanded', 'true')
  menuItems().at(index)?.focus()
}
function closeMenu(focusButton = false) {
  if (moreMenu.hidden) return
  moreMenu.hidden = true
  more.setAttribute('aria-expanded', 'false')
  if (focusButton) more.focus()
}

function setEditing(next) {
  editing = next
  editor?.setDisabled(!editing)
  status()
}

// 카드에서 설정끼리 구별할 수 있도록 사용 중인 블록 수와 시스템 프롬프트 작성 여부를 보여 준다.
function profileSummary({ blocks, systemTemplate }) {
  const engine = blocks.filter((block) => block.kind !== 'custom')
  const custom = blocks.filter((block) => block.kind === 'custom' && block.enabled).length
  const used = `엔진 블록 ${engine.filter((block) => block.enabled).length}/${engine.length}개 사용${custom ? ` · 커스텀 블록 ${custom}개` : ''}`
  return [used, systemTemplate === undefined ? '기본 조립 순서' : '시스템 프롬프트 직접 작성']
}

// 목록 첫 칸의 + 카드. 새 설정·JSON 가져오기는 이 카드가 여는 시트에서 고른다.
function renderAddCard() {
  const item = document.createElement('li')
  const icon = document.createElement('span')
  const label = document.createElement('span')
  addCard = document.createElement('button')
  addCard.type = 'button'
  addCard.className = 'profile-item profile-add'
  addCard.setAttribute('aria-haspopup', 'dialog')
  icon.className = 'profile-add-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = '+'
  label.textContent = '설정 추가'
  addCard.append(icon, label)
  addCard.addEventListener('click', () => addSheet.showModal())
  item.append(addCard)
  list.append(item)
}

function renderList() {
  list.replaceChildren()
  renderAddCard()
  for (const profile of profiles) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    const title = document.createElement('span')
    const hint = document.createElement('span')
    button.type = 'button'
    button.className = 'profile-item'
    title.className = 'profile-name'
    title.textContent = profile.name
    title.title = profile.name // 긴 이름은 카드에서 두 줄로 잘린다
    const meta = profileSummary(profile.value).map((text) => {
      const line = document.createElement('span')
      line.className = 'profile-meta'
      line.textContent = text
      return line
    })
    hint.className = 'profile-open'
    hint.textContent = '열기 →'
    button.append(title, ...meta, hint)
    button.addEventListener('click', () => choose(profile.id))
    item.append(button)
    list.append(item)
  }
}

function choose(id, focus = true) {
  open(profiles.find((item) => item.id === id), { focus })
}

function open(profile, { focus = true, edit: startEditing = false } = {}) {
  closeMenu()
  opened = profile
  selectedId = profile.id
  name.value = profile.name
  draft = validatePromptProfile(profile.value)
  dirty = false
  valid = true
  editing = startEditing
  listView.hidden = true
  editView.hidden = false
  editor?.destroy()
  editor = mountPromptEditor(byId('editor'), {
    value: draft,
    disabled: !editing,
    customBlocks: SAMPLE_CUSTOM_BLOCKS,
    onChange(value) { draft = value; dirty = true; status() },
    onValidityChange(next) { valid = next; dirty = true; status() },
  })
  status()
  if (focus) editTitle.focus()
}

function titleOf(profile) {
  if (unsaved()) return `${profile.name} 만들기`
  return editing ? `${profile.name} 수정` : profile.name
}

function showList() {
  closeMenu()
  editor?.destroy()
  editor = undefined
  selectedId = undefined
  opened = undefined
  editing = false
  draft = undefined
  dirty = false
  valid = true
  editView.hidden = true
  listView.hidden = false
  renderList()
  status()
  byId('list-title').focus()
}

function persist(next) {
  if (next.length > 100) throw new Error('설정은 100개까지 저장할 수 있습니다.')
  // Assign only after storage succeeds; quota/private-mode failures retain the draft.
  localStorage.setItem(KEY, JSON.stringify(next))
  profiles = next
}

// 목록 위 상태·오류 줄을 두지 않으므로 오류는 이동 확인(confirm)처럼 알림 창으로 띄운다.
function attempt(action) {
  try { action() } catch (error) { alert(String(error.message)) }
}

function mayDiscard() {
  return !dirty || confirm('저장하지 않은 변경을 버리고 이동할까요?')
}

byId('back').addEventListener('click', () => { if (mayDiscard()) showList() })
name.addEventListener('input', () => { dirty = true; status() })
save.addEventListener('click', () => attempt(() => {
  if (!valid) throw new Error('잘못된 프롬프트 항목을 먼저 고쳐 주세요.')
  const next = readProfile({ id: selectedId, name: name.value.trim(), value: draft })
  persist(unsaved() ? [...profiles, next] : profiles.map((profile) => profile.id === selectedId ? next : profile))
  // 저장하면 읽기 모드로 돌아간다.
  choose(selectedId, false)
  edit.focus()
}))
more.addEventListener('click', () => (moreMenu.hidden ? openMenu() : closeMenu()))
more.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  openMenu(event.key === 'ArrowUp' ? -1 : 0)
})
moreMenu.addEventListener('keydown', (event) => {
  const items = menuItems()
  const index = items.indexOf(document.activeElement)
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key]
  if (next !== undefined) {
    event.preventDefault()
    items[(next + items.length) % items.length].focus()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'Tab') closeMenu()
})
// 항목을 고르면 메뉴부터 닫고(캡처 단계) 동작한다 — 삭제 확인 창이 열린 메뉴 위에 뜨지 않게.
moreMenu.addEventListener('click', (event) => { if (event.target.closest('[role="menuitem"]')) closeMenu(true) }, true)
document.addEventListener('pointerdown', (event) => { if (!moreMenu.hidden && !event.target.closest('.menu-wrap')) closeMenu() })
edit.addEventListener('click', () => {
  setEditing(true)
  name.focus()
})
// 취소는 마지막 저장 상태로 돌리고 읽기 모드로 돌아간다. 저장 전인 새 설정은 버리고 목록으로 간다.
cancel.addEventListener('click', () => attempt(() => {
  if (dirty && !confirm('저장하지 않은 변경을 버릴까요?')) return
  if (unsaved()) return showList()
  const restored = validatePromptProfile(opened.value)
  editor.setValue(restored)
  name.value = opened.name
  draft = restored
  // setValue 가 유효성 알림을 보내 dirty 를 켜므로 그 뒤에 끈다.
  dirty = false
  valid = true
  setEditing(false)
  edit.focus()
}))
addSheet.addEventListener('click', (event) => { if (event.target === addSheet) addSheet.close() }) // 배경을 누르면 닫는다
// 고르지 않고 닫으면 + 카드로 초점을 돌린다. 새 설정을 고른 경우에는 편집 화면이 초점을 가져간다.
addSheet.addEventListener('close', () => { if (!listView.hidden) addCard.focus() })
byId('sheet-cancel').addEventListener('click', () => addSheet.close())
// 새 설정은 편집 화면만 열고, 첫 저장 때 목록에 넣는다.
byId('new').addEventListener('click', () => attempt(() => {
  addSheet.close()
  open({ id: crypto.randomUUID(), name: '새 설정', value: defaultPromptProfile() }, { edit: true })
}))
duplicate.addEventListener('click', () => attempt(() => {
  const profile = readProfile({ id: crypto.randomUUID(), name: `${opened.name} 복사`.slice(0, 120), value: opened.value })
  persist([...profiles, profile])
  choose(profile.id)
}))
remove.addEventListener('click', () => attempt(() => {
  if (!confirm(`“${opened.name}” 설정을 이 브라우저에서 삭제할까요?`)) return
  let next = profiles.filter((profile) => profile.id !== selectedId)
  if (!next.length) next = [{ id: crypto.randomUUID(), name: '기본 설정', value: defaultPromptProfile() }]
  persist(next)
  showList()
}))
byId('export').addEventListener('click', () => attempt(() => {
  const profile = readProfile({ id: opened.id, name: opened.name, value: opened.value })
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'rabbit-prompt-profile.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}))
byId('import-start').addEventListener('click', () => {
  addSheet.close()
  importFile.click()
})
importFile.addEventListener('change', async (event) => {
  const file = event.target.files[0]
  if (!file) return
  try {
    if (file.size > 1000000) throw new Error('1MB 이하의 JSON 파일을 선택해 주세요.')
    const profile = readProfile(JSON.parse(await file.text()))
    profile.id = crypto.randomUUID()
    persist([...profiles, profile])
    choose(profile.id)
  } catch (error) { alert(String(error.message)) }
  finally { event.target.value = '' }
})
// 탭: 프롬프트 설정 / 엔진 스펙. 스펙 탭은 처음 열 때 한 번 만들고, 주소의 #spec… 으로 다시 열 수 있다.
// 탭을 바꿔도 편집 화면은 그대로 남아 저장하지 않은 변경을 잃지 않는다.
const tabs = [...document.querySelectorAll('[role="tab"]')]
const specTab = byId('tab-spec')
const specPanel = byId('panel-spec')
let specReady

function renderSpec() {
  specReady ??= specHtml().then((html) => { specPanel.innerHTML = html }).catch((error) => { specPanel.textContent = `엔진 스펙을 만들지 못했습니다. ${error.message}` })
  return specReady
}

function selectTab(tab, focus = false) {
  for (const each of tabs) {
    const selected = each === tab
    each.setAttribute('aria-selected', String(selected))
    each.tabIndex = selected ? 0 : -1
    byId(each.getAttribute('aria-controls')).hidden = !selected
  }
  if (focus) tab.focus()
  if (tab === specTab) return renderSpec()
}

const isSpecHash = () => location.hash.startsWith('#spec')
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    selectTab(tab)
    // 탭 전환은 기록을 쌓지 않고 주소만 바꾼다 — 새로고침해도 같은 탭이 열린다.
    history.replaceState(null, '', tab === specTab ? '#spec' : location.pathname + location.search)
  })
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab)
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    tabs[(next + tabs.length) % tabs.length].click()
    tabs[(next + tabs.length) % tabs.length].focus()
  })
}
// 목차 링크(#spec-…)나 뒤로 가기로 주소가 바뀌면 그 탭을 연다.
window.addEventListener('hashchange', () => selectTab(isSpecHash() ? specTab : tabs[0]))
if (isSpecHash()) {
  // 스펙은 비동기로 그려지므로, #spec-blocks 처럼 절을 가리키면 다 그린 뒤 그 절로 옮긴다.
  selectTab(specTab)?.then(() => byId(location.hash.slice(1))?.scrollIntoView())
}

window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
renderList()
status()
// 목록을 먼저 그린 뒤 알린다.
if (loadError) setTimeout(() => alert(loadError))
