import { defineDialect } from './define.js'
import { SCRIPT_FORMAT } from '../prompt/parts.js'

export const koreanPlayscript = defineDialect({
  id: 'korean-playscript',
  // 기존 SCRIPT_PARSER_VERSION('script-v1')과 같은 recipeHash 를 내야 저장된
  // 기억 산출물 캐시가 살아남는다. 문법을 고치면 여기를 올린다.
  // 전각 콜론을 받게 고쳤을 때는 올리지 않았다 — 씬 규칙의 콜론은 원래 선택(`?`)이라
  // 어떤 줄이 scene 인지는 그대로이고, 따라서 청크 경계와 캐시 키가 유효하다.
  // 씬 판정이 달라지는 수정이면 반드시 올린다.
  version: 1,
  spec: SCRIPT_FORMAT,

  // 콜론은 ASCII 와 전각(U+FF1A) 둘 다 받는다. 전각은 화면에서 ASCII 와
  // 구별이 안 되므로 반드시 \uFF1A 이스케이프로 쓴다.
  rules: [
    // 연출은 장면 전환과 다른 조각이다 — 장면은 이야기의 마디이고, 연출은 무대 지시다.
    { kind: 'stage',     match: /^\[\s*연출\s*[:\uFF1A]?\s*(.*?)\]$/,                   text: 1 },
    { kind: 'scene',     match: /^\[\s*장면\s*[:\uFF1A]?\s*(.*?)\]$/,                   text: 1 },
    { kind: 'action',    match: /^\((.*)\)$/,                                       text: 1 },
    { kind: 'inner',     match: /^(.+?)\s*\(\s*속마음\s*\)\s*[:\uFF1A]\s*(.*)$/,        speaker: 1, text: 2 },
    { kind: 'inner',     match: /^속마음\s*[:\uFF1A]\s*(.*)$/,                           text: 1 },
    { kind: 'narration', match: /^(?:나레이션|나레이터|Narration)\s*[:\uFF1A]\s*(.*)$/i, text: 1 },
    // `이름: 대사` — 이름은 공백 포함 20자까지. reject 는 URL 오탐 방지다.
    { kind: 'dialogue',  match: /^([^:\uFF1A]{1,20}?)\s*[:\uFF1A]\s*(.+)$/, speaker: 1, text: 2, reject: /https?$/ },
  ],

  blocks: [
    { kind: 'choice', open: /^선택지\s*[:\uFF1A]?\s*$/, item: /^(?:[-*•]|\d+[.)])\s*(.+)$/ },
  ],

  fallback: 'narration',

  examples: [
    { text: '유리: 왔구나.\n(문을 닫는다)', segments: [
      { type: 'dialogue', speaker: '유리', text: '왔구나.' },
      { type: 'action', text: '문을 닫는다' },
    ] },
    { text: '나레이션: 비가 내린다.', segments: [{ type: 'narration', text: '비가 내린다.' }] },
    { text: '유리 (속마음): 왜 왔지.', segments: [{ type: 'inner', speaker: '유리', text: '왜 왔지.' }] },
    { text: '[장면: 저녁, 3층]', segments: [{ type: 'scene', text: '저녁, 3층' }] },
    { text: '선택지:\n- 올라간다\n- 돌아선다', segments: [
      { type: 'choice', text: '올라간다' },
      { type: 'choice', text: '돌아선다' },
    ] },
  ],
})
