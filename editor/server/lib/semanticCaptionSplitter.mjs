// ローカルAIテロップ動画: 語境界・実測無音・句読点に基づく「自然なページ分割」。
//
// 旧方式(captionSegmenter.mjs)は文字数だけで機械的に切るため、単語途中・助詞始まり・
// 2秒未満の点滅が発生していた。こちらは文字単位の発話時刻(charTiming.mjs)を使い、
// 動的計画法(DP)で「境界の自然さ + ページ長 + 表示時間 + 読み速度」の合計コストが
// 最小になる分割を全体最適で選ぶ。
//
// 境界の優先順位（コストが小さいほど優先）:
//   1. 0.3秒以上の実測無音  2. 句点・疑問符・感嘆符  3. 意味のまとまり(文末表現)
//   4. 読点  5. 接続詞の直前  6. 文節境界  7. 最後の手段として文字数境界
//
// 不変条件（テストで検証）:
// - 本文は削除・要約・言い換えしない: 全ページのtextを連結すると正本テキストと完全一致。
// - ページは昇順・非重複。次の発話開始を超えて表示しない。
// - 純粋関数。AI/LLMは使わない。

import { classifyBoundaries, endsWithDanglingConjunction, isSpeechChar, segmentWords, PARTICLES, BOUND_WORDS, CONJUNCTIONS } from './japaneseText.mjs'
import { breakIntoLines } from './lineBreaker.mjs'

export const SEMANTIC_DEFAULTS = {
  minPageSec: 2,
  softMaxPageSec: 5,
  hardMaxPageSec: 7,
  idealMinChars: 24,
  maxPageChars: 36,
  silenceBoundarySec: 0.3,
  leadSec: 0.05,
  tailSec: 0.3,
  maxExtendSec: 1.2,
  maxCharsPerSec: 8,
  maxLineChars: 18,
}

// 無音境界(=最優先)は0。それ以外は優先順位どおりに段階的に高くする。
const KIND_COST = { strong: 8, semantic: 12, comma: 14, conj: 16, phrase: 22, word: 34 }
const FORBIDDEN_COST = { particle: 400, bound: 400, fragment: 300, compound: 250, okurigana: 350, smallkana: 800, midtoken: 1000, punct: 5000, space: 200, openquote: 5000 }

function isFunctionOnlyPage(text) {
  const words = segmentWords(text).filter((w) => w.isWordLike)
  return words.length > 0 && words.every((w) => PARTICLES.has(w.segment) || BOUND_WORDS.has(w.segment) || CONJUNCTIONS.has(w.segment))
}

/**
 * 正本テキストを、発話時刻に合った自然なページへ分割する。
 *
 * @param {string} text 正本テキスト
 * @param {{ charStart: number[], charEnd: number[] }} timing 文字ごとの発話時刻（非発話文字はゼロ長）
 * @param {{ startSec: number, endSec: number }} bounds クリップの範囲
 * @param {Partial<typeof SEMANTIC_DEFAULTS>} [overrides]
 * @returns {Array<{
 *   text: string, lines: string[], startIndex: number, endIndex: number,
 *   speechStartSec: number, speechEndSec: number, startSec: number, endSec: number,
 *   boundaryKind: string,
 * }>}
 */
export function splitTextIntoSemanticPages(text, timing, bounds, overrides = {}) {
  const opt = { ...SEMANTIC_DEFAULTS, ...overrides }
  const n = text.length
  if (n === 0) return []

  const { charStart, charEnd } = timing
  const boundaryInfo = classifyBoundaries(text)

  // 発話文字のprefix: 「位置p以降で最初の発話文字」「位置p未満で最後の発話文字」
  const speech = Array.from(text, (ch) => isSpeechChar(ch))
  const nextSpeech = new Array(n + 1).fill(-1) // p以降の最初の発話文字index
  for (let i = n - 1; i >= 0; i--) nextSpeech[i] = speech[i] ? i : nextSpeech[i + 1]
  const prevSpeech = new Array(n + 1).fill(-1) // p未満の最後の発話文字index
  for (let i = 1; i <= n; i++) prevSpeech[i] = speech[i - 1] ? i - 1 : prevSpeech[i - 1]

  // 位置pをまたぐ発話の間隔(秒)。境界の「無音らしさ」と、ページ内部の無音ペナルティに使う。
  const gapAt = new Array(n + 1).fill(0)
  for (let p = 1; p < n; p++) {
    const a = prevSpeech[p]
    const b = nextSpeech[p]
    gapAt[p] = a >= 0 && b >= 0 ? Math.max(0, charStart[b] - charEnd[a]) : 0
  }

  const nextSpeechStart = (j) => {
    const idx = j < n ? nextSpeech[j] : -1
    return idx >= 0 ? charStart[idx] : bounds.endSec
  }

  function boundaryCost(j) {
    if (j <= 0 || j >= n) return { cost: 0, kind: 'edge' }
    const info = boundaryInfo[j]
    let cost = 0
    let kind = info?.kind ?? 'word'
    for (const r of info?.forbidden ?? []) cost += FORBIDDEN_COST[r] ?? 300
    if (gapAt[j] >= opt.silenceBoundarySec) {
      kind = 'silence'
    } else {
      cost += KIND_COST[kind] ?? 20
    }
    return { cost, kind }
  }

  // ページ(i,j)の表示区間: 発話区間 + 先頭リード/末尾テール。2秒未満なら次の発話開始まで(上限あり)延長。
  function displayRange(i, j) {
    const first = nextSpeech[i]
    const last = prevSpeech[j]
    if (first < 0 || first >= j || last < first) return null
    const speechStart = charStart[first]
    const speechEnd = charEnd[last]
    const nextStart = nextSpeechStart(j)
    const start = speechStart - opt.leadSec
    let end = Math.min(speechEnd + opt.tailSec, nextStart)
    if (end - start < opt.minPageSec) {
      end = Math.min(start + opt.minPageSec, nextStart, speechEnd + opt.maxExtendSec)
    }
    end = Math.max(end, speechEnd)
    return { speechStart, speechEnd, start, end }
  }

  function pageCost(i, j) {
    const len = j - i
    if (len <= 0 || len > opt.maxPageChars) return Infinity
    const r = displayRange(i, j)
    if (!r) return Infinity
    const dur = Math.max(0.01, r.end - r.start)
    let cost = 8 // ページ数を無闇に増やさない基本コスト

    if (len < opt.idealMinChars) cost += (opt.idealMinChars - len) * 0.7
    if (dur < opt.minPageSec) cost += (opt.minPageSec - dur) * 40
    if (dur > opt.softMaxPageSec) cost += (dur - opt.softMaxPageSec) * 10
    if (dur > opt.hardMaxPageSec) cost += (dur - opt.hardMaxPageSec) * 40
    const cps = len / Math.max(dur, 0.5)
    if (cps > opt.maxCharsPerSec) cost += (cps - opt.maxCharsPerSec) * 6

    // ページの途中に無音を抱え込むことへのペナルティ（無音の位置で切れる方が自然）
    for (let p = i + 1; p < j; p++) {
      const g = gapAt[p]
      if (g >= 1.0) cost += 90
      else if (g >= 0.6) cost += 40
      else if (g >= opt.silenceBoundarySec) cost += 24
    }

    const pageText = text.slice(i, j)
    if (len < 4) cost += 200
    if (isFunctionOnlyPage(pageText)) cost += 500
    if (j < n && endsWithDanglingConjunction(pageText)) cost += 300
    return cost
  }

  // DP: dp[j] = 先頭から位置jまでを分割したときの最小コスト
  const dp = new Array(n + 1).fill(Infinity)
  const back = new Array(n + 1).fill(-1)
  dp[0] = 0
  for (let j = 1; j <= n; j++) {
    const bc = boundaryCost(j).cost
    const lo = Math.max(0, j - opt.maxPageChars)
    for (let i = lo; i < j; i++) {
      if (dp[i] === Infinity) continue
      const pc = pageCost(i, j)
      if (pc === Infinity) continue
      const total = dp[i] + pc + bc
      if (total < dp[j]) {
        dp[j] = total
        back[j] = i
      }
    }
  }

  // 万一、到達不能なら(発話文字が無い等)、全文を1ページにして返す（本文は保持）
  const cuts = []
  if (dp[n] === Infinity) {
    cuts.push([0, n])
  } else {
    for (let j = n; j > 0; j = back[j]) cuts.push([back[j], j])
    cuts.reverse()
  }

  // ページ列の生成 + 表示時刻の確定（昇順・非重複）
  const pages = []
  let prevEnd = bounds.startSec
  cuts.forEach(([i, j], idx) => {
    const r = displayRange(i, j)
    const speechStart = r ? r.speechStart : prevEnd
    const speechEnd = r ? r.speechEnd : prevEnd
    let start = r ? Math.max(r.start, prevEnd, bounds.startSec) : prevEnd
    let end = r ? Math.min(r.end, bounds.endSec) : prevEnd
    // 次の発話開始を超えて表示しない
    const nextStart = idx < cuts.length - 1 ? nextSpeechStart(j) : bounds.endSec
    end = Math.min(end, Math.max(nextStart, start))
    start = Math.round(start * 100) / 100
    end = Math.round(end * 100) / 100
    if (end < start) end = start
    prevEnd = end
    const pageText = text.slice(i, j)
    pages.push({
      text: pageText,
      lines: breakIntoLines(pageText, { maxLineChars: opt.maxLineChars }),
      startIndex: i,
      endIndex: j,
      speechStartSec: speechStart,
      speechEndSec: speechEnd,
      startSec: start,
      endSec: end,
      boundaryKind: idx === 0 ? 'edge' : boundaryCost(i).kind,
    })
  })
  return pages
}
