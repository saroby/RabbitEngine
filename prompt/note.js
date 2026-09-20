// 엔진이 대화 안에 끼워 넣는 메모의 라벨. 렌더가 붙이고, 파서가 모델이 흉내 낸 것을 걷어낸다.
// 실측(gpt-4o): "[진행 메모: …]" 를 유저 턴에 보여 주자 모델이 같은 형식으로 새 줄을 지어냈다.
// 프롬프트 지시("인용·언급하지 않는다")만으로는 못 막으므로 출력 쪽에서 결정론적으로 버린다.
export const NOTE_LABEL = '진행 메모'
export const SCENE_LABEL = '장면 상태'
const WRAP = '[\\s*_~「『」』"\'()\\u200b\\ufeff]*'
const LABELS = `(?:${NOTE_LABEL}|${SCENE_LABEL})`
// 메모 하나로만 이루어진 줄. 감싸는 기호(*…*·**…**·「…」·따옴표·제로폭)는 건너뛴다.
// 줄 끝까지 메모여야 한다 — "*[장면 상태: 위급] 경고등이 깜박인다*" 같은 이야기 줄은 남긴다.
const META_LINE = new RegExp(`^${WRAP}\\[\\s*${LABELS}\\s*(?:[:：][^\\]]*)?\\]${WRAP}$`, 'u')
// 줄 안에 끼어든 메모 조각. "하윤: [진행 메모: …]" 처럼 대사에 붙여 쓴 것을 걷어낸다.
// 진행 메모 라벨만 본다 — "[장면 상태: 위급] 경고등이…" 같은 이야기 속 표지판은 남긴다.
const META_INLINE = new RegExp(`\\[\\s*${NOTE_LABEL}\\s*(?:[:：][^\\]]*)?\\]`, 'gu')
/** 모델 출력의 한 줄이 엔진 메모만으로 이루어졌는가. 이야기가 아니므로 화면에 내지 않는다. */
export const isMetaLine = (line) => META_LINE.test(line)
// 메모를 지운 뒤 감싸는 기호나 나레이션 접두만 남은 줄. "@: **[진행 메모: x]**" → "@: ****".
const REMNANT = new RegExp(`^(?:@:)?${WRAP}$`, 'u')
/** 줄 안의 메모 조각을 지운다. 메모만 있던 줄(감싸는 기호·접두 포함)은 빈 문자열이 된다. */
export const stripMeta = (line) => {
  if (isMetaLine(line)) return ''
  const rest = line.replace(META_INLINE, '').trim()
  return REMNANT.test(rest) ? '' : rest
}
