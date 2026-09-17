// Study 실행 전에 조건별 기억을 미리 만든다.
//
// 왜 미리 만드나. Study 는 조건 조합을 섞어서 실행한다 (research.js:78). 공유 캐시
// 위에서 그러면 첫 Trial 만 빌드 비용을 물고 나머지는 캐시 히트한다 — 실행 순서가
// 비용·지연 결과를 결정한다. 미리 다 만들어 두면 모든 Trial 이 warm 이고 기억 원가는
// 조건당 한 번만 잡힌다.
//
// 비용 장부의 키는 conditionKey 가 아니라 recipeHash 다. conditionKey 에는 모델·
// 출력계약처럼 기억과 무관한 축이 섞여 있어서, 그 키로 달면 같은 산출물을 공유하는
// 조건들 사이에서 비용이 중복되거나 첫 조건에만 붙는다.
import { validateCalls } from './contract.js'

const emptyCost = () => ({ calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 })

function addCost(target, calls) {
  for (const call of calls) {
    target.calls += 1
    target.promptTokens += call.promptTokens
    target.completionTokens += call.completionTokens
    target.ms += call.ms
  }
  return target
}

// buildForCondition(condition) → { recipeHashes, calls } 또는 throw.
// 지금 프리셋에는 LLM 부품이 없어 빈 결과를 낸다. 단계 5 가 이 자리를 채운다.
/**
 * @param {object[]} [cells]
 * @param {{ buildForCondition?: (condition: object) => Promise<{ recipeHashes: string[], calls: object[] }> }} [options]
 */
export async function prebuildMemory(cells = [], { buildForCondition } = {}) {
  const ledger = { builds: {}, conditions: {}, total: emptyCost() }
  const failures = []
  if (typeof buildForCondition !== 'function') return { ledger, failures }

  // 반복은 같은 조건이다. 조건마다 한 번만 만든다.
  const seen = new Map()
  for (const cell of cells) if (!seen.has(cell.conditionKey)) seen.set(cell.conditionKey, cell.condition)

  for (const [conditionKey, condition] of seen) {
    try {
      const result = await buildForCondition(condition, conditionKey)
      const recipeHashes = result?.recipeHashes || []
      // partId 를 null 로 넘긴다 — 여기는 여러 부품의 호출이 모이는 자리라
      // 소유권을 강제할 수 없다. 모양과 값은 그대로 본다.
      const calls = validateCalls(result?.calls || [], null)
      ledger.conditions[conditionKey] = { recipeHashes }

      // 같은 recipeHash 를 여러 조건이 공유하면 비용은 처음 만든 한 번만 센다.
      for (const hash of recipeHashes) {
        if (ledger.builds[hash]) continue
        ledger.builds[hash] = emptyCost()
      }
      const fresh = recipeHashes.filter((hash) => !ledger.builds[hash].counted)
      for (const hash of fresh) ledger.builds[hash].counted = true
      if (fresh.length) {
        // 이 조건이 실제로 만든 것만 장부에 단다.
        addCost(ledger.builds[fresh[0]], calls)
        addCost(ledger.total, calls)
      }
    } catch (error) {
      failures.push({
        conditionKey,
        condition,
        outcome: { type: 'memory_build_error', message: String(error?.message || error) },
      })
    }
  }
  return { ledger, failures }
}
