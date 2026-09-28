import { mountPromptEditor, defaultPromptProfile, validatePromptProfile } from './index.js'

const KEY = 'rabbit-engine.prompt-profiles.v1'
// 호스트가 관리하는 커스텀 블록 목록의 예시. 독립 페이지에서는 고칠 수 없고 미리보기에만 쓴다.
const SAMPLE_CUSTOM_BLOCKS = Object.freeze([
  { id: 'common-rules', name: '공통 규칙', content: '{{char}}의 말투와 성격을 끝까지 유지한다. {{user}}의 행동을 대신 정하지 않는다.' },
  { id: 'style-example', name: '문체 예시 (모델)', defaultRole: 'assistant', content: '*유리가 조용히 책장을 넘긴다.*\n유리: "그 이야기는 조금 뒤에 해도 될까요?"' },
  { id: 'example-pair', name: '대화 예시 한 쌍', messages: [{ role: 'user', content: '테스트 요청: 짧게 답해 줘.' }, { role: 'assistant', content: '테스트 응답: 알겠습니다.' }] },
])
const byId = (id) => document.getElementById(id)
const message = byId('message')
const list = byId('profiles')
const listView = byId('list-view')
const editView = byId('edit-view')
const editTitle = byId('edit-title')
const name = byId('name')
const save = byId('save')
const revert = byId('revert')
let profiles = []
let selectedId
let draft
let dirty = false
let valid = true
let editor

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
  message.textContent = `저장된 설정을 읽을 수 없습니다. 기존 저장 데이터는 변경하지 않았습니다. ${error.message}`
}

if (!profiles.length) profiles = [{ id: crypto.randomUUID(), name: '기본 설정', value: defaultPromptProfile() }]

function status() {
  save.disabled = !selectedId || !valid || !name.value.trim()
  revert.disabled = !selectedId || !dirty
  const draftStatus = selectedId ? `${dirty ? '저장하지 않은 변경이 있습니다' : '선택한 설정과 같습니다'} · ` : ''
  byId('state').textContent = `${profiles.length}개 설정 · ${draftStatus}현재 브라우저에만 저장`
}

function renderList() {
  list.replaceChildren()
  for (const profile of profiles) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    const title = document.createElement('span')
    const hint = document.createElement('span')
    button.type = 'button'
    button.className = 'profile-item'
    title.textContent = profile.name
    hint.textContent = '편집 →'
    button.append(title, hint)
    button.addEventListener('click', () => choose(profile.id))
    item.append(button)
    list.append(item)
  }
}

function choose(id, focus = true) {
  const profile = profiles.find((item) => item.id === id)
  selectedId = id
  name.value = profile.name
  draft = validatePromptProfile(profile.value)
  dirty = false
  valid = true
  editTitle.textContent = `${profile.name} 편집`
  listView.hidden = true
  editView.hidden = false
  editor?.destroy()
  editor = mountPromptEditor(byId('editor'), {
    value: draft,
    customBlocks: SAMPLE_CUSTOM_BLOCKS,
    onChange(value) { draft = value; dirty = true; status() },
    onValidityChange(next) { valid = next; dirty = true; status() },
  })
  status()
  message.textContent = ''
  if (focus) editTitle.focus()
}

function showList() {
  editor?.destroy()
  editor = undefined
  selectedId = undefined
  draft = undefined
  dirty = false
  valid = true
  editView.hidden = true
  listView.hidden = false
  renderList()
  status()
  message.textContent = ''
  byId('list-title').focus()
}

function persist(next) {
  if (next.length > 100) throw new Error('설정은 100개까지 저장할 수 있습니다.')
  // Assign only after storage succeeds; quota/private-mode failures retain the draft.
  localStorage.setItem(KEY, JSON.stringify(next))
  profiles = next
}

function attempt(action) {
  try { action(); message.textContent = '' } catch (error) { message.textContent = String(error.message) }
}

function mayDiscard() {
  return !dirty || confirm('저장하지 않은 변경을 버리고 이동할까요?')
}

byId('back').addEventListener('click', () => { if (mayDiscard()) showList() })
name.addEventListener('input', () => { dirty = true; status() })
save.addEventListener('click', () => attempt(() => {
  if (!valid) throw new Error('잘못된 프롬프트 항목을 먼저 고쳐 주세요.')
  const next = readProfile({ id: selectedId, name: name.value.trim(), value: draft })
  persist(profiles.map((profile) => profile.id === selectedId ? next : profile))
  choose(selectedId, false)
}))
revert.addEventListener('click', () => attempt(() => {
  const profile = profiles.find((item) => item.id === selectedId)
  const restored = validatePromptProfile(profile.value)
  editor.setValue(restored)
  name.value = profile.name
  editTitle.textContent = `${profile.name} 편집`
  draft = restored
  dirty = false
  valid = true
  status()
}))
byId('new').addEventListener('click', () => attempt(() => {
  if (!mayDiscard()) return
  const profile = { id: crypto.randomUUID(), name: '새 설정', value: defaultPromptProfile() }
  persist([...profiles, profile])
  choose(profile.id)
}))
byId('duplicate').addEventListener('click', () => attempt(() => {
  if (!valid) throw new Error('잘못된 프롬프트 항목을 먼저 고쳐 주세요.')
  const profile = readProfile({ id: crypto.randomUUID(), name: `${name.value.trim() || '설정'} 복사`.slice(0, 120), value: draft })
  persist([...profiles, profile])
  choose(profile.id)
}))
byId('delete').addEventListener('click', () => attempt(() => {
  if (!confirm(`“${name.value}” 설정을 이 브라우저에서 삭제할까요?`)) return
  let next = profiles.filter((profile) => profile.id !== selectedId)
  if (!next.length) next = [{ id: crypto.randomUUID(), name: '기본 설정', value: defaultPromptProfile() }]
  persist(next)
  showList()
}))
byId('export').addEventListener('click', () => attempt(() => {
  if (!valid) throw new Error('잘못된 프롬프트 항목을 먼저 고쳐 주세요.')
  const profile = readProfile({ id: selectedId, name: name.value.trim(), value: draft })
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'rabbit-prompt-profile.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}))
byId('import').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  if (!file) return
  try {
    if (file.size > 1000000) throw new Error('1MB 이하의 JSON 파일을 선택해 주세요.')
    const profile = readProfile(JSON.parse(await file.text()))
    if (!mayDiscard()) return
    profile.id = crypto.randomUUID()
    persist([...profiles, profile])
    choose(profile.id)
    message.textContent = ''
  } catch (error) { message.textContent = String(error.message) }
  finally { event.target.value = '' }
})
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
renderList()
status()
