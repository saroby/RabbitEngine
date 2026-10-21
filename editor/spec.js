// 독립 페이지의 "엔진 스펙" 탭. 설명은 사람이 쓰지만 위치 · 출처 · 한도 · 방언 규약 · 예시 문구는
// 엔진 상수와 실제 buildTurn 결과에서 읽는다 — 문서가 코드와 어긋나면 test/editor-spec.test.js 가 잡는다.
// DOM 에 손대지 않고 HTML 문자열만 만든다.
import { buildTurn, PACING_TEXT } from '../build-turn.js'
import { DEFAULT_DEPTHS } from '../prompt/blocks.js'
import { NOTE_LABEL } from '../prompt/note.js'
import { PROMPT_PROFILE_KINDS, PROMPT_PROFILE_OPTIONAL_KINDS, PROMPT_PROFILE_LIMITS, PROMPT_PROFILE_VERSION, CUSTOM_MESSAGES_MAX, everyBlockPromptProfile } from '../prompt/profile.js'
import { MEMORY_PRESETS } from '../memory/presets.js'
import { RATING_TEXT } from '../scene/rating.js'
import { buildDirective, DIRECTIVE_MAX_CHARS } from '../scene/directive.js'
import { emptySceneState, renderSceneState, TENSIONS } from '../scene/state.js'
import { EXTRACTION_VERSION, MAX_EXTRACTION_EXCHANGES } from '../scene/extraction.js'
import { asteriskScript } from '../dialect/asterisk-script.js'
import { koreanPlayscript } from '../dialect/korean-playscript.js'
import { BLOCK_LABELS } from './labels.js'
import { BLOCK_SPECS, POST_HISTORY } from './block-docs.js'
import { promptEditorSampleInput } from './index.js'

/** 기억 프리셋 설명. 키는 MEMORY_PRESETS 와 같아야 한다. */
export const PRESET_SPECS = Object.freeze({
  full: { what: '받은 이력을 자르지 않고 그대로 조립한다. 기본값. 자르기를 호스트가 직접 할 때.', needs: '—' },
  'batch-trim': { what: '이력이 `historyMaxChars`(기본 24,000자)를 넘는 턴에만 오래된 메시지를 `historyTargetChars`(기본 12,000자) 이하로 한 번에 버린다. 그 사이 턴은 앞부분이 그대로라 접두 캐시가 이어진다.', needs: '—' },
  lorebook: { what: '이력은 그대로, 로어북 스캔 설정만 프리셋이 정한다.', needs: '—' },
  vector: { what: '창 밖 원문 중 마지막 유저 발화와 글자 bigram 이 닿는 것을 끌어온다.', needs: '—' },
  semantic: { what: '창 밖 원문을 임베딩 코사인으로 골라 끌어온다.', needs: '`ctx.embed`' },
  'memory-books': { what: '닫힌 씬을 요약해 노트로 붙이고 원문은 숨긴다.', needs: '`ctx.llm`' },
  'memory-books-tiered': { what: 'memory-books 에 더해 오래된 요약을 줄거리로 접는다(digest).', needs: '`ctx.llm`' },
  'semantic-books': { what: '요약 · 줄거리를 만들고 요약 중 질의에 닿는 것만 넣는다. 줄거리는 늘 넣는다.', needs: '`ctx.llm` · `ctx.embed`' },
})

const esc = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
// 설명 문자열 안의 `코드` 만 <code> 로 바꾼다.
const inline = (value) => esc(value).replace(/`([^`]+)`/g, '<code>$1</code>')
const p = (text) => `<p>${inline(text)}</p>`
const ul = (items) => `<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`
const pre = (text) => `<pre>${esc(text)}</pre>`
const table = (head, rows) => `<div class="spec-table"><table><thead><tr>${head.map((cell) => `<th scope="col">${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const section = (id, title, body) => `<section id="spec-${id}" class="spec-section" aria-labelledby="spec-${id}-title"><h2 id="spec-${id}-title">${esc(title)}</h2>${body}</section>`
const badge = (text, tone = '') => `<span class="spec-badge${tone ? ` spec-badge-${tone}` : ''}">${esc(text)}</span>`

/** @param {unknown} slot */
export function slotText(slot) {
  if (slot === 'system') return '시스템 프롬프트'
  if (slot === POST_HISTORY) return '이번 입력 끝 · [진행 메모]'
  if (slot && typeof slot === 'object' && 'depth' in slot) return `대화 안 · depth ${slot.depth}`
  return String(slot)
}

/** 스펙의 예시 턴. 편집기 미리보기 재료에 행동 · 진행 속도 · 장면 상태를 더해 블록이 최대한 많이 나오게 한다. */
export function specSampleInput() {
  const sample = promptEditorSampleInput()
  return {
    ...sample,
    dialect: asteriskScript,
    pacing: 'eventful',
    userInput: '*책을 내민다*\n항구 창고에서 찾았어요.',
    sceneState: {
      ...emptySceneState(), revision: 3, place: '도서관', time: '비 오는 밤', tension: 'tense',
      characters: { 유리: { body: ['젖은 소매'], emotion: '경계', toward: { 여행자: '반신반의' } } },
      threads: ['사라진 항해일지의 행방'],
    },
  }
}

// 모든 엔진 블록을 켠 설정으로 돌린다 — 설정이 켜야 생기는 블록(프롬프트 공격 방어)도 예시 문구가 보이게.
export const specSampleTurn = () => buildTurn({ ...specSampleInput(), promptProfile: everyBlockPromptProfile() })

const exampleOf = (turn, kind) => turn.blocks
  .filter((block) => block.kind === kind || (kind === 'context' && block.kind.startsWith('context_')))
  .map((block) => block.content)

function blockCards(turn) {
  return PROMPT_PROFILE_KINDS.map((kind) => {
    const spec = BLOCK_SPECS[kind]
    const examples = exampleOf(turn, kind)
    const example = examples.length
      ? `<details><summary>예시 턴의 실제 문구${examples.length > 1 ? ` (${examples.length}개)` : ''}</summary>${examples.map(pre).join('')}</details>`
      : `<p class="spec-muted">예시 턴에는 없다 — ${inline(spec.when)}.</p>`
    return `<article class="spec-block" id="spec-block-${kind}">
<h3>${esc(BLOCK_LABELS[kind])} <code>${esc(kind)}</code></h3>
<p class="spec-badges">${badge(slotText(spec.slot), 'slot')}${badge(`trust: ${spec.trust}`)}${spec.dynamic ? badge('캐시 접두를 끊음', 'warn') : ''}</p>
${p(spec.about)}
<dl><dt>재료</dt><dd>${inline(spec.input)}</dd><dt>생기는 조건</dt><dd>${inline(spec.when)}</dd></dl>
${example}
</article>`
  }).join('')
}

function renderedExample(turn) {
  const rendered = turn.render({ userFirst: true })
  const messages = rendered.messages.map((message) => `<li><span class="spec-role">${esc(message.role)}</span>${pre(message.text)}</li>`).join('')
  return `<details><summary>예시 턴을 실제로 펼친 결과 — system ${rendered.system.length.toLocaleString('ko-KR')}자 · 캐시 접두 ${rendered.cachePrefixLength.toLocaleString('ko-KR')}자 · 메시지 ${rendered.messages.length}개</summary>
<h3>system</h3>${pre(rendered.system)}
<h3>messages</h3><ol class="spec-messages">${messages}</ol></details>`
}

const TOC = [
  ['overview', '개요'], ['flow', '한 턴의 흐름'], ['slots', '블록 위치'], ['blocks', '블록 15종'], ['custom', '커스텀 블록'],
  ['directive', '턴 마무리 지시'], ['rating', '등급과 진행 속도'], ['scene', '장면 상태'], ['dialect', '대본 방언과 응답 검사'],
  ['worldbook', '로어북'], ['macros', '조건 문장과 매크로'], ['memory', '기억 층과 프리셋'], ['tools', '인물별 도구'],
  ['profile', '프롬프트 설정 계약'], ['evidence', '증거와 캐시 진단'],
]

/** 스펙 탭 전체 HTML. 예시 턴을 실제로 조립하므로 비동기다. */
export async function specHtml() {
  const turn = await specSampleTurn()
  const sample = specSampleInput()
  const directives = [
    ['행동 없음 · 장면 상태 없음', buildDirective({ rating: 'all' })],
    ['행동 `*고개를 끄덕인다*` · 장면 상태 있음', buildDirective({ rating: 'all', actions: ['고개를 끄덕인다'], hasState: true })],
    ['같은 입력의 재생성 (`continuing: true`)', buildDirective({ rating: 'all', actions: ['고개를 끄덕인다'], hasState: true, continuing: true })],
  ]
  const limits = PROMPT_PROFILE_LIMITS
  const body = [
    section('overview', '개요', [
      p('RabbitEngine 은 LLM 롤플레잉 대화 엔진이다. 대본 문법(방언) · 프롬프트 조립 · 기억 층 · 장면 상태를 맡고, 모델은 부르지 않는다 — 엔진은 LLM 호출의 앞(요청 조립)과 뒤(응답 파싱 · 검사 · 장면 상태 추출 레시피)에만 관여하고, 호출과 저장은 호스트 코드가 한다.'),
      ul([
        '진입점은 `buildTurn(input, ctx)` 다. 위치가 있는 블록 목록과 이력, 그리고 그 턴의 근거(`manifest`)를 돌려준다.',
        '`turn.render()` 가 블록을 공급자에 넣을 `{ system, messages }` 로 편다. 공급자 SDK 형식으로 감싸는 일은 호스트 몫이다.',
        '같은 입력이면 같은 프롬프트가 나온다. `{{random}}` 도 시드(`macroSeed`, 기본: 이력 길이)로 정해 턴을 재현할 수 있다.',
        '공개 API 는 `0.x` 동안 예고 없이 바뀔 수 있다.',
      ]),
    ].join('')),
    section('flow', '한 턴의 흐름', `<ol class="spec-flow">${[
      ['엔진', '입력 파싱', '방언으로 이번 입력을 행동 · 대사 조각으로 나눈다(`analyzeUserInput`). 추가 모델 호출 없이 이번 턴부터 "유저가 방금 행동했다" 를 지시에 넣는 결정론 층이다.'],
      ['엔진', '기억 선택', '기억 프리셋이 이력을 고르고 필요하면 요약 · 검색한다. 요약 · 임베딩 호출은 호스트가 준 `ctx.llm` · `ctx.embed` 로 하고, 같은 재료의 요약은 `recipeHash` 로 캐시에서 꺼낸다.'],
      ['엔진', '로어북 발동', '최근 6개 메시지(이번 입력 포함)를 스캔해 항목을 고르고 예산을 넘으면 우선순위로 자른다.'],
      ['엔진', '블록 조립', '카드 · 지시문 · 등급 · 기억 · 장면 상태 · 사건을 위치가 있는 블록으로 만들고 프롬프트 설정을 적용한다(`compileBlocks`).'],
      ['엔진', '턴 마무리 지시', '행동 판정 · 일관성 · 진척 조각을 300자 안으로 만든다(`buildDirective`).'],
      ['엔진', '렌더', '시스템 블록을 합치고, depth 블록을 이력 사이에 끼우고, 턴 마무리 지시를 `[진행 메모: …]` 로 이번 입력 끝에 붙인다(`renderTurn`).'],
      ['호스트', '본 응답 호출', '`turn.stopSequences` 를 넘기면 유저 대사를 지어내는 줄에서 생성을 멈춘다.'],
      ['엔진', '응답 검사 · 파싱', '`turn.checkReply` 가 대필 · 빈 응답 · 모르는 화자를 찾고, 방언이 응답을 대사 · 지문 조각으로 나눈다.'],
      ['호스트', '장면 상태 갱신 (백그라운드 1회)', '`extractionRecipe` 로 만든 요청을 작은 모델에 보내고 `applyExtraction` 으로 검증 · 적용한다. 다음 턴의 `sceneState` 가 된다.'],
    ].map(([who, title, text]) => `<li>${badge(who, who === '엔진' ? 'slot' : 'warn')}<strong>${esc(title)}</strong> — ${inline(text)}</li>`).join('')}</ol>`),
    section('slots', '블록 위치', [
      p('프롬프트는 문자열 하나가 아니라 "위치가 있는 블록" 으로 조립한다. 이력 뒤 지시와 장면 상태가 모델에 가까운 자리에 가야 하기 때문이다.'),
      table(['위치', '렌더 결과'], [
        ['`system`', '시스템 프롬프트. 블록 순서대로 빈 줄 하나를 두고 잇는다.'],
        ['`{ depth: N }`', '대화 안, 이번 입력보다 메시지 N개 앞. 엔진 블록은 user 역할 메시지로 들어가고, 같은 depth 의 블록은 한 메시지로 합친다. 이력이 짧으면 맨 앞에 놓인다.'],
        ['`post_history`', `이번 사용자 메시지 끝에 \`[${NOTE_LABEL}: …]\` 로 붙는다. 맨몸으로 붙이면 모델이 유저의 말로 인용해서 감싼다(실측). 출력 규약이 이 메모를 인용 · 언급하지 말라고 지시한다.`],
      ]),
      '<h3>프롬프트에 실리는 순서 (기본 배치)</h3>',
      `<ol class="spec-order">${[
        ['system · 캐시 접두', PROMPT_PROFILE_KINDS.filter((kind) => BLOCK_SPECS[kind].slot === 'system' && !BLOCK_SPECS[kind].dynamic && !['user_boundary', 'output_contract'].includes(kind))],
        ['system · 첫 동적 블록부터 (동적 블록이 없으면 여기도 캐시 접두)', ['context', 'worldbook', 'user_boundary', 'output_contract']],
        ['이력 (오래된 쪽)', []],
        [`depth ${DEFAULT_DEPTHS.memory}`, ['memory']],
        ['항목 depth', ['worldbook']],
        [`depth ${DEFAULT_DEPTHS.scene_state}`, ['scene_state']],
        [`depth ${DEFAULT_DEPTHS.event}`, ['event']],
        ['이번 사용자 입력 + 진행 메모', ['directive']],
      ].map(([where, kinds]) => `<li><span class="spec-where">${esc(where)}</span><span>${kinds.map((kind) => `<a href="#spec-block-${kind}">${esc(BLOCK_LABELS[kind])}</a>`).join(' · ') || '<span class="spec-muted">대화 이력</span>'}</span></li>`).join('')}</ol>`,
      p('공급자의 접두 캐시는 앞에서부터 같은 만큼만 다시 쓴다. 시스템 프롬프트에서 매 턴 달라질 수 있는 첫 블록(기억 노트 · 로어북 · 장면 상태 · 사건 · 턴 마무리 지시 · `context_*`) 앞까지가 캐시 접두이고, `render()` 가 그 길이를 `cachePrefixLength` 로 준다.'),
      renderedExample(turn),
    ].join('')),
    section('blocks', `블록 ${PROMPT_PROFILE_KINDS.length}종`, [
      p(`엔진이 만드는 블록은 ${PROMPT_PROFILE_KINDS.length}종이다. 재료가 있을 때만 생기고, 없는 장면이나 기억을 지어내지 않는다. \`trust\` 는 출처 표시다 — engine 은 엔진이 쓴 문장, curated 는 사람이 쓴 카드 · 로어북 · 기억이며 프롬프트 주입 방어의 근거로 값에 남긴다. 예시는 아래 재료에 모든 블록을 켠 설정으로 실제 \`buildTurn\` 을 돌린 결과다.`),
      `<details><summary>예시 턴의 재료</summary>${pre(JSON.stringify({ ...sample, dialect: sample.dialect.id }, null, 2))}</details>`,
      `<div class="spec-blocks">${blockCards(turn)}</div>`,
    ].join('')),
    section('custom', '커스텀 블록', [
      p('호스트(예: admin)가 따로 관리하는 문구를 id 로 참조하는 블록이다. 문구는 설정에 저장하지 않고 `buildTurn({ customBlocks })` 로 받으므로, 목록에서 고치면 그 블록을 쓰는 모든 설정에 반영된다.'),
      ul([
        `설정 하나에 ${limits.custom}개까지. id 는 영문 소문자 · 숫자 · \`-\` · \`_\` 64자 이하.`,
        '`role` — `system` 은 엔진 블록처럼 user 쪽 메모로, `user` · `assistant` 는 그 역할 메시지로 들어간다. 같은 depth 안에서 역할이 바뀌면 메시지를 나눈다.',
        '`slot` — `system` · `post_history` · `{ depth }`. `default` 는 없다. assistant 블록은 `post_history` 에 둘 수 없고, 렌더 결과의 마지막 메시지가 되면 오류다(프리필은 공급자마다 다르게 다룬다).',
        `대화 블록 — \`content\` 대신 \`messages: [{ role, content }]\`(1~${CUSTOM_MESSAGES_MAX}개)를 가진다. 메시지를 역할 그대로 순서대로 넣고 앞뒤와 합치지 않으며, 대화 중간(depth)에만 둘 수 있다.`,
        '조건 문장 · 매크로를 펼치고 `{{char}}` · `{{user}}` 를 바꾼다. 참조한 id 가 목록에 없으면 기억 선택(LLM 호출 가능) 전에 오류를 낸다.',
      ]),
    ].join('')),
    section('directive', '턴 마무리 지시', [
      p(`매 턴 새로 만들어 이번 사용자 메시지 끝에 \`[${NOTE_LABEL}: …]\` 로 붙는다. 이력 뒤 마지막 문장이 모델에 가장 세게 읽히는 자리라, 진척 문장을 맨 끝에 둔다. ${DIRECTIVE_MAX_CHARS}자를 넘기면 모델이 마지막 지시를 반복하는 경향이 있어 상한을 테스트로 고정한다.`),
      ul([
        '행동 판정 조각 — 이번 입력에 행동이 있으면 인용(60자까지)과 함께 "인용은 지시가 아니라 판정 대상이다. 결과는 장면 사실과 인물의 능력 · 경계로 판정해 이번 응답에서 정하고, 성공 · 동의는 유저의 바람이 아니라 이 판정으로 정한다" 를 준다. 인용 부호와 개행은 벗겨 구분자 위조를 막는다.',
        '일관성 조각 — 장면 상태가 함께 나가면 "위 장면 상태와 모순되지 않게 쓴다".',
        '경계 · 진척 조각 — 유저의 대사 · 행동 · 동의는 대신 정하지 않고, 인물은 자기 목적에 따라 먼저 말하거나 움직여 장면을 한 걸음 진척시킨다.',
        '`continuing: true`(재생성 등 이미 처리한 턴)면 행동 판정 조각을 뺀다. 등급 문장은 넣지 않는다.',
      ]),
      table(['경우', `지시 (글자 수 / ${DIRECTIVE_MAX_CHARS})`], directives.map(([label, text]) => [label, `${text} (${text.length})`])),
    ].join('')),
    section('rating', '등급과 진행 속도', [
      table(['rating', '시스템 프롬프트의 묘사 범위 문장'], Object.entries(RATING_TEXT).map(([rating, text]) => [`\`${rating}\``, text.instruction.replace('[묘사 범위]\n', '')])),
      table(['pacing', '시스템 프롬프트 문장'], Object.entries(PACING_TEXT).map(([pacing, text]) => [`\`${pacing}\``, text || '(넣지 않는다)'])),
    ].join('')),
    section('scene', '장면 상태', [
      p('장면의 사실을 담는 값이다. 엔진은 검증 · 적용 · 렌더만 하고 저장은 호스트가 한다. 프롬프트에는 depth 2 의 산문으로 들어간다.'),
      table(['필드', '뜻'], [
        ['`version`', '스키마 버전. 1 이 아니면 델타를 얹지 않고 멈춘다.'],
        ['`revision`', '적용 횟수. 호스트가 CAS 저장에 쓰고, 추출 결과는 `expectedRevision` 이 어긋나면 `stale` 로 버린다.'],
        ['`place` · `time`', '장소와 시간 (문자열).'],
        ['`tension`', `${TENSIONS.map((value) => `\`${value}\``).join(' · ')} 중 하나.`],
        ['`characters`', '이름별 `{ body: [], emotion, toward: { 상대: 태도 } }`. 카드에 없는 이름은 거부한다.'],
        ['`threads`', '미해결 실마리 목록. 추출기가 add · resolve 로 바꾼다.'],
        ['`indicators`', '작품별 지표 값. 정의(`indicatorDefs`)는 `key` · `type`(number · string · boolean) · `initial` · `min`/`max` · `label` · `inferred`(추출기가 바꿀 수 있는지) · `visible`.'],
      ]),
      '<h3>렌더 예시</h3>',
      pre(`[장면 상태]\n${renderSceneState(sample.sceneState)}`),
      '<h3>추출 (응답 뒤 백그라운드 1회)</h3>',
      ul([
        `\`extractionRecipe({ state, exchanges, names, indicatorDefs })\` 가 요청과 JSON 스키마를 만든다(버전 \`${EXTRACTION_VERSION}\`). 호출은 호스트가 한다.`,
        '`applyExtraction(state, raw, { expectedRevision })` 이 응답을 검증해 적용한다. 허용값이 아닌 항목은 `rejected` 로 남기고 버린다.',
        `밀린 교환을 한 번에 따라잡는 것은 ${MAX_EXTRACTION_EXCHANGES}개까지다. 더 길면 조용히 자르지 않고 호스트가 나눠 부르게 한다.`,
      ]),
    ].join('')),
    section('dialect', '대본 방언과 응답 검사', [
      p('방언은 모델이 쓸 대본 문법(출력 규약)과 그 파서를 한 쌍으로 묶는다. 규약 문구는 출력 규약 블록으로 들어가고, 같은 파서가 사용자 입력과 모델 응답을 대사 · 지문 조각으로 나눈다. `defineDialect` 로 새 방언을 만들 수 있다.'),
      ...[asteriskScript, koreanPlayscript].map((dialect) => `<h3><code>${esc(dialect.id)}</code> v${esc(dialect.version)}</h3>${pre(dialect.spec)}`),
      p('asterisk-script 는 줄 전체가 `*…*` 일 때만 행동으로 읽는다. 한 줄 안의 `*행동* 대사` 는 행동으로 잡지 않는다.'),
      '<h3>응답 검사</h3>',
      table(['kind', '심각도', '뜻'], [
        ['`user_dialogue`', 'error', '유저 이름(또는 유저 · user)으로 된 대사 · 속마음'],
        ['`empty`', 'error', '추론 블록을 떼고 나면 이야기가 없다'],
        ['`user_action`', 'warn', '지문에서 유저가 주어. 오탐이 있을 수 있어 `ok` 에 영향 없음'],
        ['`unknown_speaker`', 'warn', '카드에 없는 화자'],
      ]),
      p('`turn.stopSequences` 로 생성 중에 유저 줄을 막고, 끝난 응답은 `turn.checkReply` 로 확인한다. 대필 직전까지의 조각은 `safeSegments` 로 준다. `<think>` 추론 블록은 떼어 `reasoning` 으로 따로 준다. 자를지 다시 부를지는 호스트가 정한다.'),
    ].join('')),
    section('worldbook', '로어북', [
      ul([
        '최근 6개 메시지(이번 입력 포함)를 스캔한다. `always` 는 늘, `keyword` 는 키워드가 하나라도 보이면 들어간다.',
        '한국어는 어절 경계가 없어 키워드가 넓게 걸리므로 `excludeKeywords` 로 깎는다.',
        '`worldbookOptions.budgetChars` 를 넘으면 `priority` 가 큰 항목부터 자리를 차지하고, 밀려난 항목은 `overBudget` 으로 남는다. 프롬프트 안 순서는 원래 순서 그대로다(캐시 접두가 흔들리지 않게).',
        '항목 `depth` 가 전역 `worldbookDepth` 를 이긴다. 둘 다 없으면 시스템 프롬프트에 들어간다.',
        '재귀 스캔과 scanDepth 는 실측 후 일부러 뺐다.',
        '항목별 근거(`injected` · `matchedKeywords` · `excludedBy` · `overBudget`)는 `manifest.prompt.worldbookManifest` 에 남는다.',
      ]),
    ].join('')),
    section('macros', '조건 문장과 매크로', [
      p('사람이 쓴 문구(카드 설명 필드 · 지시문 · 소개 · 로어북 · 커스텀 블록) 안에서 장면 상태로 문장을 켜고 끈다. 변수는 지표 `key` · `label` 과 `place` · `time` · `tension` 이다.'),
      pre('{{#if 호감도 >= 80}}…{{else if 호감도 >= 50}}…{{else}}…{{/if}}\n{{#if tension == hostile}}…{{/if}}    {{#if !비밀공개}}…{{/if}}\n지금 호감도: {{var:호감도}}\n{{random::비가 온다::눈이 온다::맑다}}'),
      ul([
        '비교는 `>=` `<=` `>` `<`(숫자) · `==` `!=`, 변수만 쓰면 참거짓, `!` 은 부정. `&&` · `||` 는 없다 — 쓰면 던진다.',
        '`{{else if}}` 는 위에서부터 처음 참인 갈래 하나만 낸다. 앞 갈래에 가려 영영 안 나오는 갈래는 `checkMacros` 가 경고한다.',
        '모르는 변수 · 짝 안 맞는 태그는 꺼진 갈래 안에 있어도 던진다 — 그 갈래가 처음 켜지는 턴에야 터지지 않게.',
        '모델이 쓴 문장(기억 노트 · 이력)과 카드 이름에는 돌리지 않는다. 모델이 `{{var:…}}` 로 숨긴 지표를 빼내지 못하게 하려는 것이다.',
        '캐시 접두 안 문구가 조건 · `{{var}}` · `{{random}}` 을 쓰면 `manifest.prompt.cacheWarnings` 에 남는다. 자주 바뀌는 문장은 대화 안 블록으로 옮기는 편이 싸다.',
        '프롬프트 설정의 블록 문구 · 시스템 문서에는 아직 쓸 수 없다. 거기서는 커스텀 블록에 쓴다.',
      ]),
    ].join('')),
    section('memory', '기억 층과 프리셋', [
      p('긴 이력은 고정된 청크(장면이 바뀌면 거기서 닫는다)로 잘라 닫힌 청크만 요약한다. 같은 재료의 요약은 `recipeHash` 로 캐시(`ctx.artifacts`)에서 꺼내 LLM 을 다시 부르지 않고, 부른 호출은 `manifest.memoryCalls` 장부에 남는다. 프리셋은 `buildTurn({ memory: { preset } })` 로 고른다.'),
      table(['프리셋', '하는 일', '밖에서 받는 것'], Object.keys(MEMORY_PRESETS).map((id) => [`\`${id}\``, PRESET_SPECS[id]?.what ?? '', PRESET_SPECS[id]?.needs ?? ''])),
      p('최근 N개만 남기는 창은 `{ preset: \'full\', assembly: { windowSize: N } }` 이다. 다만 맨 앞 메시지가 매 턴 바뀌어 접두 캐시를 매 턴 버린다 — 호스트가 자르지 않는다면 batch-trim 이 낫다.'),
    ].join('')),
    section('tools', '인물별 도구', [
      ul([
        '카드는 도구 id 만 든다(`tools: [\'manseryeok\']`). 스키마는 호스트가 `toolSpecs` 로 주고, 실행도 호스트가 한다.',
        '한 번의 호출이 여러 인물을 연기하므로 도구는 호출 단위로 열리고, 모든 도구에 `actor`(소유자 enum) 인자가 붙는다. `turn.tools` 에는 소유자가 장면에 있는 도구만 들어간다.',
        '실행 전 `authorizeToolCall` 이 소유자를 다시 확인한다 — 스키마는 모델을 좁히는 장치일 뿐이고 실제 문은 이 검사다. 거부도 tool_result 로 돌려준다.',
      ]),
    ].join('')),
    section('profile', '프롬프트 설정 계약', [
      p(`\`buildTurn({ promptProfile })\` 로 작품마다 블록 문구 · 순서 · 위치를 바꾼다. 형식은 \`{ version: ${PROMPT_PROFILE_VERSION}, blocks, systemTemplate? }\` 이고 \`validatePromptProfile\` 이 엄격히 검사한다. 이 편집기가 만드는 값이 이것이다.`),
      ul([
        `\`blocks\` 는 엔진 블록 ${PROMPT_PROFILE_KINDS.length}종을 각각 한 번씩 \`{ kind, enabled, template, slot }\` 으로 담는다. 커스텀 블록은 \`{ kind: 'custom', id, enabled, role, slot }\` 으로 섞는다.`,
        `나중에 더한 선택 블록(${PROMPT_PROFILE_OPTIONAL_KINDS.map((kind) => `\`${kind}\``).join(' · ')})은 \`defaultPromptProfile()\` 에서 꺼져 있다. 이 블록이 생기기 전에 저장한 설정은 규칙이 없어도 받고, 앞 종류의 규칙 바로 뒤에 꺼진 채로 채운다 — 조립 결과는 그대로다.`,
        '`template` 의 `{{content}}` 는 엔진 원문, `{{char}}` · `{{user}}` 는 이름이다. 치환은 한 번만 하고 삽입된 내용을 다시 템플릿으로 읽지 않는다.',
        `\`slot\` 은 \`default\`(엔진 기본 위치) · \`system\` · \`post_history\` · \`{ depth: 0..${limits.depth} }\`.`,
        '`systemTemplate` 은 시스템 프롬프트 문서다. 자유 문장 사이에 `{{block:character}}` 같은 태그를 넣고, 활성 시스템 블록 ⇔ 문서의 태그다. `{{block:output_contract}}` 는 정확히 한 번 필요하다.',
        `한도: 문구당 ${limits.template.toLocaleString('ko-KR')}자, 전체 ${limits.total.toLocaleString('ko-KR')}자, 커스텀 블록 ${limits.custom}개.`,
        '적용한 설정의 버전과 SHA-256 이 `manifest.prompt.profile` 에 남는다. 설정 저장과 캐릭터 연결은 호스트 몫이다.',
      ]),
    ].join('')),
    section('evidence', '증거와 캐시 진단', [
      ul([
        '`turn.manifest` 는 그 턴의 근거다 — 고른 메시지 · 노트, 기억 호출 장부, 로어북 발동 근거, 방언 버전, 등급 · 행동 분석, 블록 본문까지 값으로 담는다. 턴마다 저장하면 프롬프트 한 벌만큼 커진다.',
        '`prefixFingerprint(turn.render())` 로 지문(해시와 길이만, 원문 없음)을 남기고 `sharedPrefix(지난, 이번)` 으로 견주면 접두 캐시가 얼마나 이어지는지 `{ chars, totalChars, messages, system }` 으로 나온다.',
        '`system` 은 same · prefix(캐시 접두만 같다) · changed 중 하나다. 실제 적중은 공급자의 캐시 단위 · 수명에 달렸으니 `chars` 는 상한으로 읽는다.',
      ]),
    ].join('')),
  ].join('')

  return `<div class="spec">
<nav class="spec-toc" aria-label="스펙 목차"><ol>${TOC.map(([id, title]) => `<li><a href="#spec-${id}">${esc(title)}</a></li>`).join('')}</ol></nav>
<div class="spec-body">${body}</div>
</div>`
}

export { BLOCK_SPECS }
