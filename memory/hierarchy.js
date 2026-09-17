// 계층 압축은 요약을 다시 요약하는 것이라 부품이 chunk-local 이 아니다.
// 그 예외를 숨기지 않고 입력을 "순서 있는 자식 contentHash 목록"으로 못박는다.
// 자식이 바뀌면 그 조상 그룹의 recipe 가 자동으로 달라져 무효화된다.
export function buildLevels(childHashes = [], fanout = 4) {
  const width = Math.max(2, Number(fanout) || 4)
  const levels = []
  let current = [...childHashes]
  while (current.length > 1) {
    const groups = []
    for (let index = 0; index < current.length; index += width) {
      groups.push({ childHashes: current.slice(index, index + width) })
    }
    levels.push({ level: levels.length + 1, groups })
    // 다음 층의 자식 식별자는 이 층 그룹의 자식 목록을 이어붙인 것이다.
    // 실제 실행에서는 만들어진 부모의 contentHash 로 대체된다.
    current = groups.map((group) => group.childHashes.join('|'))
  }
  return levels
}
