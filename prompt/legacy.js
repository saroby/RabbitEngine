// 공개 호환 표면. 순수 프롬프트 부품과 compiler를 분리해 순환 의존 없이 기존 API를 유지한다.
import { injectWorldbooksWithManifest } from '../worldbook/strategies.js'
import { compilePrompt } from './compile.js'

export {
  SCRIPT_FORMAT,
  namesOf,
  renderCard,
  renderCast,
  renderPlayerCard,
  substitute,
  substituteCard,
} from './parts.js'

export function injectWorldbooks(worldbooks, messages) {
  return injectWorldbooksWithManifest(worldbooks, messages).chunks
}

export function buildSystem(options) {
  return compilePrompt(options).system
}
