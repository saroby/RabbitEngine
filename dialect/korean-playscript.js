import { defineDialect } from './define.js'
import { SCRIPT_FORMAT } from '../prompt/parts.js'

export const koreanPlayscript = defineDialect({
  id: 'korean-playscript',
  // 기존 SCRIPT_PARSER_VERSION('script-v1')과 같은 recipeHash 를 내야 저장된
  // 기억 산출물 캐시가 살아남는다. 문법을 고치면 여기를 올린다.
  version: 1,
  spec: SCRIPT_FORMAT,

  rules: [
    // 연출은 장면 전환과 다른 조각이다 — 장면은 이야기의 마디이고, 연출은 무대 지시다.
    { kind: 'stage',     match: /^\[\s*연출\s*[::]?\s*(.*?)\]$/,                   text: 1 },
    { kind: 'scene',     match: /^\[\s*장면\s*[::]?\s*(.*?)\]$/,                   text: 1 },
    { kind: 'action',    match: /^\((.*)\)$/,                                       text: 1 },
    { kind: 'inner',     match: /^(.+?)\s*\(\s*속마음\s*\)\s*[::]\s*(.*)$/,        speaker: 1, text: 2 },
    { kind: 'inner',     match: /^속마음\s*[::]\s*(.*)$/,                           text: 1 },
    { kind: 'narration', match: /^(?:나레이션|나레이터|Narration)\s*[::]\s*(.*)$/i, text: 1 },
    // `이름: 대사` — 이름은 공백 포함 20자까지. reject 는 URL 오탐 방지다.
    { kind: 'dialogue',  match: /^([^::]{1,20}?)\s*[::]\s*(.+)$/, speaker: 1, text: 2, reject: /https?$/ },
  ],

  blocks: [
    { kind: 'choice', open: /^선택지\s*[::]?\s*$/, item: /^(?:[-*•]|\d+[.)])\s*(.+)$/ },
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
