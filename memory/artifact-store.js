// 산출물 저장은 엔진 밖의 일이다. 엔진이 요구하는 것은 두 가지뿐 —
// recipeHash 로 찾을 수 있을 것, 넣으면 id 와 contentHash 가 붙을 것.
// 소비자는 자기 저장소(JSON · SQLite · 무엇이든)를 이 모양으로 감싼다.
//
// contentHash 는 엔진이 정한다. text 만 해시하면 keywords·state·delta 가
// 달라져도 같은 값이 되어, 그 산출물을 자식으로 삼는 계층 노드가 갱신되지
// 않는다. 의미 payload 전체를 canonical 로 직렬화해서 해시한다.
import { canonical } from './recipe.js'
import { sha256Hex } from '../sha256.js'

export const indexKey = (scope, scopeId, recipeHash) => `${scope}:${scopeId}:${recipeHash}`

export function contentHashOf(record) {
  return sha256Hex(canonical({
    kind: record.kind ?? null,
    text: record.text ?? null,
    keywords: record.keywords ?? [],
    state: record.state ?? null,
    coversOrdinals: record.coversOrdinals ?? [],
  })).slice(0, 16)
}

// 산출물에 항상 붙는 필드. 저장소 구현이 달라도 이 모양은 같아야 한다.
export function decorate(record, { id, now }) {
  return {
    ...record,
    id,
    supersedesId: record.supersedesId ?? null,
    origin: record.origin ?? 'auto',
    editedAt: record.editedAt ?? null,
    retiredAt: null,
    pinned: Boolean(record.pinned),
    keywords: record.keywords ?? [],
    coversMessageIds: record.coversMessageIds ?? [],
    buildCalls: record.buildCalls ?? [],
    contentHash: contentHashOf(record),
    createdAt: now,
  }
}

// 참조 구현. 엔진 테스트가 쓰고, 소비자가 자기 저장소를 붙이기 전에 그대로
// 써 볼 수 있다. 프로세스가 죽으면 사라진다 — 영속이 필요하면 직접 구현한다.
export function createMemoryArtifactStore({ uid, now } = {}) {
  const artifacts = []
  const index = new Map()
  let counter = 0
  const nextId = uid || (() => { counter += 1; return `mem-${counter}` })
  const clock = now || (() => new Date().toISOString())

  return {
    // 검사용. 사본을 준다 — 밖에서 고쳐도 저장소는 안 바뀐다.
    all() { return [...artifacts] },
    find({ scope, scopeId, recipeHash }) {
      const id = index.get(indexKey(scope, scopeId, recipeHash))
      return id ? artifacts.find((a) => a.id === id) || null : null
    },
    put(record) {
      const key = indexKey(record.scope, record.scopeId, record.recipeHash)
      const currentId = index.get(key)
      const current = currentId ? artifacts.find((a) => a.id === currentId) : null
      const artifact = decorate(record, { id: nextId(), now: clock() })
      artifacts.push(artifact)
      // 사람이 고정한 것은 재빌드가 밀어내지 않는다. 자동 추출은 반드시 틀리고,
      // 고친 것이 덮이면 사람이 기억을 신뢰할 수 없게 된다.
      if (!current?.pinned) index.set(key, artifact.id)
      return artifact
    },
  }
}
