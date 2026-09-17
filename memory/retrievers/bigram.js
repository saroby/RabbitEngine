// 기존 retrieval 전략의 문자 bigram 겹침 검색. legacy 프리셋의 동작을
// 그대로 재현하는 것이 유일한 목적이라 알고리즘을 손대지 않는다.
function wordBigrams(text) {
  const words = String(text || '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []
  const grams = new Set()
  for (const word of words) {
    if (word.length <= 2) grams.add(word)
    else for (let index = 0; index < word.length - 1; index += 1) grams.add(word.slice(index, index + 2))
  }
  return grams
}

function overlapScore(left, right) {
  const a = wordBigrams(left)
  const b = wordBigrams(right)
  let score = 0
  for (const token of a) if (b.has(token)) score += 1
  return score
}

export function bigramRetrieve({ entries, texts, windowSize, limit }) {
  const splitAt = Math.max(0, entries.length - windowSize)
  const recent = entries.slice(splitAt)
  const query = [...recent].reverse().find((entry) => entry.role === 'user')
  const queryText = query ? texts[query.ordinal] : (texts[entries.at(-1)?.ordinal] || '')

  return entries.slice(0, splitAt)
    .map((entry) => ({ entry, score: overlapScore(queryText, texts[entry.ordinal]) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.ordinal - a.entry.ordinal)
    .slice(0, limit)
    .sort((a, b) => a.entry.ordinal - b.entry.ordinal)
    .map((row) => ({ ordinal: row.entry.ordinal, ref: row.entry.messageId, score: row.score, text: texts[row.entry.ordinal] }))
}
