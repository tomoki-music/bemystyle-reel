// ローカルAIテロップ動画: caption境界の「禁止境界」判定（厳密版と、節の頭を考慮した補正版）。
//
// classifyBoundaries（japaneseText.mjs）は「文字列だけ」から助詞始まり・複合語・断片始まりなどを判定する。
// これは、次の2つの場合に過検出になる:
// 1. 句点・読点の直後（=節の頭）で始まるページ。「で、その次」「ということで」「やってみて」のように、
//    節の先頭に来る接続語・動詞語頭が、ICUの語分割上は助詞・活用断片に見える。句読点が前の語との結びつきを
//    切っているため、「助詞を直前の語から引き離した」ことにはならない。
// 2. 実測で0.3秒以上の無音がある位置。複合語らしく見える漢字の連続でも、話者は実際に区切って発話している。
//
// 補正版では、この2つに限って複合・断片・助詞・活用語尾・形式名詞の理由を外す。
// 語の途中（midtoken）・小書き仮名/長音始まり（smallkana）・句読点/空白/開き括弧の直後は補正しない（常に不可）。
// 厳密版（補正なし）の件数も併せて報告できるよう、両方を提供する。純粋関数。AI/LLMは使わない。

import { classifyBoundaries, endsWithDanglingConjunction, STRONG_PUNCT, COMMA_PUNCT } from './japaneseText.mjs'

const CLOSING = new Set(['」', '』', '）', ')', '］', ']', '】', '〉', '》', '”', '’'])
/** 節の頭では免除する理由（=直前の語との結びつきが句読点で切れているため）。 */
export const CLAUSE_START_EXEMPT = ['particle', 'bound', 'fragment', 'okurigana', 'compound']
/** 実測の無音で免除する理由（=話者が実際に区切って発話している複合語らしい連続）。 */
export const SILENCE_EXEMPT = ['compound', 'okurigana']
/** 語の途中で切っていると数える理由（厳密版・補正版で共通）。 */
export const MID_WORD_REASONS = ['midtoken', 'compound', 'okurigana', 'fragment', 'bound', 'smallkana']
export const REFINE_SILENCE_SEC = 0.3

/** 位置 p（p文字目の直前）が「節の頭」か（直前が句点・読点、または句点+閉じ括弧）。 */
export function isClauseStart(text, p) {
  const prev = text[p - 1]
  if (STRONG_PUNCT.has(prev) || COMMA_PUNCT.has(prev)) return true
  return CLOSING.has(prev) && p >= 2 && STRONG_PUNCT.has(text[p - 2])
}

/**
 * 位置 p の禁止理由（補正版）。info は classifyBoundaries(text)[p]。
 * @param {string} text 連結済み本文
 * @param {number} p
 * @param {{ forbidden: string[] } | null} info
 * @param {{ gapSec?: number }} [opts] 位置pをまたぐ実測の発話間隔（秒）
 * @returns {string[]}
 */
export function refineForbidden(text, p, info, opts = {}) {
  if (!info) return []
  let reasons = [...info.forbidden]
  if (isClauseStart(text, p)) reasons = reasons.filter((r) => !CLAUSE_START_EXEMPT.includes(r))
  if ((opts.gapSec ?? 0) >= REFINE_SILENCE_SEC) reasons = reasons.filter((r) => !SILENCE_EXEMPT.includes(r))
  return reasons
}

/**
 * ページ列の禁止境界を数える（本文は返さない）。
 * @param {string[]} pageTexts 連結すると正本になる各ページ本文
 * @param {{ gaps?: number[] }} [opts] gaps[i] = ページiとi+1の間の実測の発話間隔（秒）。省略時は0
 * @returns {{ boundaries: number, strict: object, refined: object, danglingConjunction: number, positions: number[] }}
 */
export function countBoundaryProblems(pageTexts, opts = {}) {
  const joined = pageTexts.join('')
  const info = classifyBoundaries(joined)
  const tally = () => ({ forbidden: 0, midWord: 0, particleStart: 0, smallKanaStart: 0, byReason: {} })
  const strict = tally()
  const refined = tally()
  const positions = []
  let dangling = 0
  let pos = 0
  for (let i = 0; i < pageTexts.length - 1; i++) {
    pos += pageTexts[i].length
    const b = info[pos]
    if (endsWithDanglingConjunction(pageTexts[i])) dangling += 1
    if (!b) continue
    const add = (t, reasons) => {
      if (reasons.length === 0) return
      t.forbidden += 1
      for (const r of reasons) t.byReason[r] = (t.byReason[r] ?? 0) + 1
      if (reasons.some((r) => MID_WORD_REASONS.includes(r))) t.midWord += 1
      if (reasons.includes('particle')) t.particleStart += 1
      if (reasons.includes('smallkana')) t.smallKanaStart += 1
    }
    add(strict, b.forbidden)
    const r = refineForbidden(joined, pos, b, { gapSec: opts.gaps?.[i] ?? 0 })
    add(refined, r)
    if (r.length > 0) positions.push(i)
  }
  return { boundaries: Math.max(0, pageTexts.length - 1), strict, refined, danglingConjunction: dangling, positions }
}

/** 独立した相づち・感嘆・短い応答として、単独で短く表示してよいページか。 */
const STANDALONE_SHORT = /^(はい|ええ|うん|うーん|そう|そうです|そうですね|なるほど|いい|いや|いえ|まあ|ああ|えー|へー|おお|ありがとう|ありがとうございます)[。、！？!?]?$/
export function isStandaloneShort(pageText, startsAfterStrongPunct) {
  if (STANDALONE_SHORT.test(pageText)) return true
  // 前の文が終わった直後に始まり、句点系で終わる = 1文として完結している短文
  return startsAfterStrongPunct && /[。！？!?]$/.test(pageText) && Array.from(pageText).filter((c) => !/[。！？!?、,，\s]/.test(c)).length >= 2
}
