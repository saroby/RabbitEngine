// 산출물은 불변이다. 사람이 고쳐도, force 로 다시 빌드해도, 지워도 과거
// Trial 이 무엇을 보고 있었는지는 바뀌면 안 된다 (원칙 5). 그래서 변경은
// 전부 새 레코드거나 플래그이고, 물리 삭제는 없다.
import { sha256Hex } from '../sha256.js'
import { canonical } from './recipe.js'

export const indexKey = (scope, scopeId, recipeHash) => `${scope}:${scopeId}:${recipeHash}`

// text 만 해시하면 keywords·state·delta 가 달라져도 같은 contentHash 가 되어,
// 그 산출물을 자식으로 삼는 계층 노드가 갱신되지 않는다. 의미 payload 전체를
// canonical 로 직렬화해서 해시한다.
const contentHashOf = (record) => sha256Hex(canonical({
  kind: record.kind ?? null,
  text: record.text ?? null,
  keywords: record.keywords ?? [],
  state: record.state ?? null,
  coversOrdinals: record.coversOrdinals ?? [],
})).slice(0, 16)

const byId = (db, id) => db.memoryArtifacts.find((artifact) => artifact.id === id) || null

export function findArtifact(db, { scope, scopeId, recipeHash }) {
  const id = db.memoryIndex[indexKey(scope, scopeId, recipeHash)]
  return id ? byId(db, id) : null
}

// 생성 필드가 spread 뒤에 온다. 앞에 두면 record 가 id 를 들고 있을 때
// (편집처럼 기존 레코드에서 파생될 때) 새 uid 를 덮어써 같은 id 가 둘 생긴다.
export function putArtifact(db, record, helpers) {
  const key = indexKey(record.scope, record.scopeId, record.recipeHash)
  const current = db.memoryIndex[key] ? byId(db, db.memoryIndex[key]) : null
  const artifact = {
    ...record,
    id: helpers.uid(),
    supersedesId: record.supersedesId ?? null,
    origin: record.origin ?? 'auto',
    editedAt: record.editedAt ?? null,
    retiredAt: null,
    pinned: Boolean(record.pinned),
    keywords: record.keywords ?? [],
    coversMessageIds: record.coversMessageIds ?? [],
    buildCalls: record.buildCalls ?? [],
    contentHash: contentHashOf(record),
    createdAt: helpers.now(),
  }
  db.memoryArtifacts.push(artifact)
  // 사람이 고정한 것은 재빌드가 밀어내지 않는다. 자동 추출은 반드시 틀리고,
  // 고친 것이 덮이면 사람이 기억을 신뢰할 수 없게 된다.
  if (!current?.pinned) db.memoryIndex[key] = artifact.id
  return artifact
}

// 편집은 필드를 골라 넘긴다. `{ ...current }` 를 통째로 넘기면 id·createdAt·
// retiredAt 같은 생성 필드가 따라와 의미가 꼬인다.
export function editArtifact(db, id, text, helpers) {
  const current = byId(db, id)
  if (!current) throw new Error(`memory artifact 없음: ${id}`)
  const next = putArtifact(db, {
    scope: current.scope, scopeId: current.scopeId,
    presetId: current.presetId, partId: current.partId, partVersion: current.partVersion,
    recipeHash: current.recipeHash,
    chunkOrdinal: current.chunkOrdinal,
    coversOrdinals: current.coversOrdinals, coversMessageIds: current.coversMessageIds,
    kind: current.kind, keywords: current.keywords, buildCalls: current.buildCalls,
    text,
    supersedesId: current.id, origin: 'user', editedAt: helpers.now(), pinned: current.pinned,
  }, helpers)
  // 고정돼 있었더라도 사람이 명시적으로 고친 것은 인덱스가 따라간다.
  db.memoryIndex[indexKey(next.scope, next.scopeId, next.recipeHash)] = next.id
  return next
}

export function retireArtifact(db, id, helpers) {
  const artifact = byId(db, id)
  if (!artifact) throw new Error(`memory artifact 없음: ${id}`)
  artifact.retiredAt = helpers.now()
  const key = indexKey(artifact.scope, artifact.scopeId, artifact.recipeHash)
  if (db.memoryIndex[key] === id) delete db.memoryIndex[key]
  return artifact
}

export function pinArtifact(db, id, pinned) {
  const artifact = byId(db, id)
  if (!artifact) throw new Error(`memory artifact 없음: ${id}`)
  artifact.pinned = Boolean(pinned)
  return artifact
}
