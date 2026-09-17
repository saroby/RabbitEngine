// 옛 호출부를 위한 표면. parseScript(text, { completeLinesOnly }) 시그니처를
// 그대로 지킨다 — ModelChat 의 화면과 스트리밍 코드가 이 모양으로 부른다.
import { koreanPlayscript } from './korean-playscript.js'

export { choicesOf, SCRIPT_PARSER_VERSION } from './parse.js'

export function parseScript(text, { completeLinesOnly = false } = {}) {
  return koreanPlayscript.parse(text, { partial: completeLinesOnly })
}
