// 기억 계층이 보는 유일한 입력. message.text 를 직접 읽지 않는 이유는
// applyActive() 가 후보 전환·삭제·재생성 때마다 m.text 를 갈아치우기 때문이다
// (server/index.js:714). 후보 선택은 편집이 아니라 평가 동작이므로, 기억은
// "어느 후보를 보고 만들어졌는가"까지 값에 담아야 낡은 채로 살아남지 않는다.
import { sha256Hex } from '../sha256.js'

/**
 * 본문의 해시. chunk 재료와 기억 캐시 키가 이 값에 묶인다.
 * @param {string | null | undefined} text
 * @returns {string} 16자 16진수
 */
export function hashText(text) {
  return sha256Hex(String(text ?? '')).slice(0, 16)
}

/**
 * 그 메시지가 지금 보여 주고 있는 본문. 후보가 있으면 활성 후보의 것이다.
 * @param {object} message
 * @returns {string}
 */
export function activeTextOf(message) {
  const candidate = message?.candidates?.[message.activeIndex]
  return String((candidate ? candidate.text : message?.text) ?? '')
}

// 합성 턴(CONTINUE_TURN 등)은 모델에게만 보내는 임시 조각이다. 이력에 없는 것을
// 기억 경계나 해시에 넣으면 Chat 만 Study 와 다른 경계를 갖게 된다.
export const isReal = (message) => message?.synthetic !== true

/**
 * 기억 계층이 보는 모양으로 메시지를 투영한다. 합성 턴은 빠진다.
 * @param {object[]} [messages]
 * @returns {Array<{ ordinal: number, messageId: string | null, role: string, candidateId: string | null, textHash: string }>}
 */
export function projectMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter(isReal)
    .map((message, ordinal) => ({
      ordinal,
      messageId: message.id ?? null,
      role: message.role,
      candidateId: message.candidates?.[message.activeIndex]?.id ?? null,
      textHash: hashText(activeTextOf(message)),
    }))
}
