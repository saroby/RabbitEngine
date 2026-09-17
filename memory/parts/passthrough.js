// 계약 증명용 가짜 부품. LLM 을 부르지 않고 입력을 그대로 접는다.
// 실제 부품이 없는 단계에서도 projection·청킹·해시·인덱스·무효화·전파를
// 끝까지 검증할 수 있게 하는 것이 목적이다.
import { definePart } from '../contract.js'

export const passthroughCompactor = definePart({
  partId: 'passthrough', partVersion: 1, kind: 'compactor',
  async build({ chunk, texts = [] }) {
    const covered = chunk.coversOrdinals.map((ordinal) => texts[ordinal] ?? '').join(' / ')
    return { artifacts: [{ kind: 'passthrough', text: covered, keywords: [] }], calls: [] }
  },
})

export const passthroughReducer = definePart({
  partId: 'passthrough-parent', partVersion: 1, kind: 'reducer',
  async buildParent({ children = [] }) {
    return { artifacts: [{ kind: 'passthrough-parent', text: children.map((c) => c.text).join(' | '), keywords: [] }], calls: [] }
  },
})
