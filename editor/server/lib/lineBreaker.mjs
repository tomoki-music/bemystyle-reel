// ローカルAIテロップ動画: ページ内の改行位置を決める。
//
// ページ分割(semanticCaptionSplitter)とは別に決定する。
// - 最大2行。行の文字数をなるべく均等にする。
// - 読点・文節・語境界を優先。単語途中では改行しない。
// - 助詞・活用語尾・小書き仮名から2行目を始めない。1行目末尾を接続詞だけにしない。
// - 本文は一切変更しない: lines.join('') は常に元のページ本文と完全一致する
//   （canonical text に \N は保存しない。\N はレンダー時に lines から挿入する）。
// - AI/LLM は使わない。純粋関数のみ。

import { classifyBoundaries, endsWithDanglingConjunction } from './japaneseText.mjs'

export const DEFAULT_LINE_TARGET_MAX = 18
export const DEFAULT_LINE_HARD_MAX = 20

const KIND_COST = { strong: 0, semantic: 2, comma: 3, conj: 4, phrase: 8, word: 16 }
const FORBIDDEN_COST = { particle: 400, bound: 400, fragment: 300, compound: 250, okurigana: 350, smallkana: 800, midtoken: 900, punct: 5000, space: 200, openquote: 5000 }

/**
 * ページ本文を最大2行に分ける。
 *
 * @param {string} text ページ本文（改行を含まない）
 * @param {{ maxLineChars?: number, hardMaxLineChars?: number }} [options]
 * @returns {string[]} 1〜2要素。join('') === text
 */
export function breakIntoLines(text, options = {}) {
  const maxLine = options.maxLineChars ?? DEFAULT_LINE_TARGET_MAX
  const hardMax = options.hardMaxLineChars ?? DEFAULT_LINE_HARD_MAX
  const n = text.length
  if (n <= maxLine) return [text]

  const info = classifyBoundaries(text)
  let best = null
  for (let p = 1; p < n; p++) {
    const len1 = p
    const len2 = n - p
    let cost = Math.abs(len1 - len2) * 1.5
    // 各行が最大文字数を超える分割は強く避ける（ハード上限は最終手段）
    if (len1 > maxLine) cost += (len1 - maxLine) * 40
    if (len2 > maxLine) cost += (len2 - maxLine) * 40
    if (len1 > hardMax) cost += 5000
    if (len2 > hardMax) cost += 5000
    const b = info[p]
    if (b) {
      cost += KIND_COST[b.kind] ?? 16
      for (const r of b.forbidden) cost += FORBIDDEN_COST[r] ?? 300
    }
    if (endsWithDanglingConjunction(text.slice(0, p))) cost += 300
    // 1行目・2行目が極端に短い(4文字未満)のは避ける
    if (len1 < 4) cost += 200
    if (len2 < 4) cost += 200
    if (!best || cost < best.cost) best = { cost, p }
  }
  if (!best) return [text]
  return [text.slice(0, best.p), text.slice(best.p)]
}
