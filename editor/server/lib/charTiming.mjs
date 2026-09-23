// ローカルAIテロップ動画: 正本テキスト(既存文字起こし)の各文字へ、ローカルWhisperの
// トークン時刻を対応づけて「文字単位の発話時刻」を作る。
//
// 設計方針:
// - 本文の正本は既存の文字起こし。ローカル結果は「時刻アラインメント用途」だけに使う
//   （本文は一切置き換えない）。
// - 句読点・空白を除いた文字同士をLCS(最長共通部分列)で対応づけ、一致しない文字は
//   前後の一致文字の時刻から線形補間する。
// - DTWのトークン時刻は、発話再開直後のトークン開始が直前の無音の先頭へ引き寄せられる
//   癖があり、無音をまたぐトークンの文字が無音の中に置かれる問題もある。そのため、
//   トークン時間から実測の無音区間を除いた「発話時間」だけに文字を配分する。
//   また、無音明けの最初の文字がDTWで遅れて推定される場合は、無音の終わり(発話再開)へ前倒しする。
// - 純粋関数のみ。AI/LLMは使わない。

import { isSpeechChar } from './japaneseText.mjs'

const MAX_TOKEN_SEC = 1.5
const START_SNAP_TOLERANCE_SEC = 0.06
const RESUME_SNAP_MIN_DELAY_SEC = 0.05
const RESUME_SNAP_MAX_DELAY_SEC = 1.0
const RESUME_REDISTRIBUTE_CHARS = 4

function normKey(ch) {
  return ch.normalize('NFKC').toLowerCase()
}

/**
 * 区間 [startSec, endSec] を、実測の無音区間を除いた「発話時間」だけに count 個の等分区間として配る。
 * 無音をまたぐトークンの文字が、無音の中(語の途中の「間」)に置かれるのを防ぐ。
 * 無音の開始側は DTW が無音の先頭へ寄る癖を考慮して START_SNAP_TOLERANCE_SEC だけ広げて扱う。
 * 区間が全て無音に覆われる場合は、無音の終わりの位置へゼロ長で置く。
 *
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} count
 * @param {Array<{ startSec: number, endSec: number }>} silences 昇順
 * @returns {Array<{ startSec: number, endSec: number }>}
 */
export function distributeAcrossSpeech(startSec, endSec, count, silences) {
  if (count <= 0) return []
  const free = []
  let cur = startSec
  for (const sil of silences) {
    const a = sil.startSec - START_SNAP_TOLERANCE_SEC
    const b = sil.endSec
    if (b <= cur || a >= endSec) continue
    if (a > cur) free.push([cur, Math.min(a, endSec)])
    cur = Math.max(cur, b)
  }
  if (cur < endSec) free.push([cur, endSec])
  const usable = free.filter(([a, b]) => b - a > 1e-6)
  const total = usable.reduce((acc, [a, b]) => acc + (b - a), 0)
  if (total <= 1e-6) {
    const at = Math.min(Math.max(cur, startSec), Math.max(endSec, startSec))
    return Array.from({ length: count }, () => ({ startSec: at, endSec: at }))
  }
  // 発話時間上の位置 → 実時間へ
  const toReal = (offset) => {
    let rest = offset
    for (const [a, b] of usable) {
      const len = b - a
      if (rest <= len + 1e-9) return a + Math.min(rest, len)
      rest -= len
    }
    return usable[usable.length - 1][1]
  }
  const out = []
  for (let k = 0; k < count; k++) {
    let s = toReal((total * k) / count)
    let e = toReal((total * (k + 1)) / count)
    // 1文字が無音をまたぐ場合は、発話が多い側へ寄せて無音の外に置く
    for (const sil of silences) {
      const a = sil.startSec - START_SNAP_TOLERANCE_SEC
      if (s < a && e > sil.endSec) {
        if (a - s >= e - sil.endSec) e = a
        else s = sil.endSec
      }
    }
    out.push({ startSec: s, endSec: Math.max(s, e) })
  }
  return out
}

/**
 * トークン列を文字ごとの時刻(開始・終了)へ展開する。1トークンの発話時間(無音を除く)をその文字数で等分する。
 * 発話でない文字（句読点・空白）は除外する。
 *
 * @param {Array<{ text: string, startSec: number, endSec: number }>} tokens
 * @param {Array<{ startSec: number, endSec: number }>} [silences]
 * @returns {Array<{ ch: string, startSec: number, endSec: number }>}
 */
export function expandTokensToChars(tokens, silences = []) {
  const chars = []
  for (const t of tokens) {
    const list = Array.from(t.text ?? '').filter((c) => c !== '\ufffd' && isSpeechChar(c))
    if (list.length === 0) continue
    const end = Math.min(t.endSec, t.startSec + MAX_TOKEN_SEC * Math.max(1, list.length))
    const spans = distributeAcrossSpeech(t.startSec, end, list.length, silences)
    list.forEach((ch, i) => {
      chars.push({ ch, startSec: spans[i].startSec, endSec: spans[i].endSec })
    })
  }
  return chars
}

/**
 * 2つの文字列(発話文字のみ)をLCSで対応づける。
 * @param {string[]} a 正本側の比較キー配列
 * @param {string[]} b ローカル側の比較キー配列
 * @returns {Array<[number, number]>} 対応する (aのindex, bのindex) の昇順ペア
 */
export function lcsPairs(a, b) {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * 正本テキストの各文字の時刻を求める。
 *
 * @param {string} canonicalText 正本テキスト（句読点・空白を含む）
 * @param {Array<{ text: string, startSec: number, endSec: number }>} tokens ローカルWhisperのトークン(時刻はクリップ先頭=0秒)
 * @param {Array<{ startSec: number, endSec: number }>} silences 実測の無音区間
 * @param {{ startSec: number, endSec: number }} bounds クリップの範囲（0〜長さ）
 * @returns {{
 *   charStart: number[], charEnd: number[],
 *   matchedCount: number, canonicalSpeechCount: number, localSpeechCount: number,
 * }}
 *   発話でない文字(句読点・空白)は、直前の発話文字の終了時刻と同じ(ゼロ長)。
 */
export function alignCanonicalToTokens(canonicalText, tokens, silences, bounds) {
  const n = canonicalText.length
  const local = expandTokensToChars(tokens, silences)

  // 正本側の発話文字だけを取り出す（元インデックスを保持）
  const speechIdx = []
  const aKeys = []
  for (let i = 0; i < n; i++) {
    if (isSpeechChar(canonicalText[i])) {
      speechIdx.push(i)
      aKeys.push(normKey(canonicalText[i]))
    }
  }
  const bKeys = local.map((c) => normKey(c.ch))
  const pairs = lcsPairs(aKeys, bKeys)

  // 発話文字ごとの (start, end) を、一致=ローカル時刻 / 不一致=補間 で埋める
  const sN = speechIdx.length
  const sStart = new Array(sN).fill(NaN)
  const sEnd = new Array(sN).fill(NaN)
  for (const [ai, bi] of pairs) {
    sStart[ai] = local[bi].startSec
    sEnd[ai] = local[bi].endSec
  }

  let k = 0
  while (k < sN) {
    if (!Number.isNaN(sStart[k])) {
      k++
      continue
    }
    let e = k
    while (e < sN && Number.isNaN(sStart[e])) e++
    const leftEnd = k > 0 ? sEnd[k - 1] : bounds.startSec
    const rightStart = e < sN ? sStart[e] : bounds.endSec
    const spans = distributeAcrossSpeech(leftEnd, Math.max(leftEnd, rightStart), e - k, silences)
    for (let q = 0; q < e - k; q++) {
      sStart[k + q] = spans[q].startSec
      sEnd[k + q] = spans[q].endSec
    }
    k = e
  }

  // 無音明けの最初の発話文字は、DTWが遅れて推定することがある（実測では無音が終わった瞬間に
  // 発話が再開している）。無音明けの最初の文字を無音の終わりへ前倒しし、続く数文字を均等に再配分する。
  for (const sil of silences) {
    const q = sStart.findIndex((t) => t >= sil.startSec - START_SNAP_TOLERANCE_SEC)
    if (q < 0) continue
    const delay = sStart[q] - sil.endSec
    if (delay <= RESUME_SNAP_MIN_DELAY_SEC || delay > RESUME_SNAP_MAX_DELAY_SEC) continue
    if (q > 0 && sEnd[q - 1] > sil.endSec) continue
    const last = Math.min(sN - 1, q + RESUME_REDISTRIBUTE_CHARS - 1)
    const span = sEnd[last] - sil.endSec
    const count = last - q + 1
    for (let k = 0; k < count; k++) {
      sStart[q + k] = sil.endSec + (span * k) / count
      sEnd[q + k] = sil.endSec + (span * (k + 1)) / count
    }
  }

  // 単調増加・範囲内へ整える（無音の考慮はトークン展開・補間の段階で済んでいる）
  let prevEnd = bounds.startSec
  for (let q = 0; q < sN; q++) {
    const s = Math.min(Math.max(sStart[q], prevEnd, bounds.startSec), bounds.endSec)
    const e = Math.min(Math.max(sEnd[q], s), bounds.endSec)
    sStart[q] = s
    sEnd[q] = e
    prevEnd = e
  }

  // 全文字へ展開（非発話文字はゼロ長で直前の終了時刻に置く）
  const charStart = new Array(n)
  const charEnd = new Array(n)
  let cursor = bounds.startSec
  let sPos = 0
  for (let i = 0; i < n; i++) {
    if (sPos < sN && speechIdx[sPos] === i) {
      charStart[i] = sStart[sPos]
      charEnd[i] = sEnd[sPos]
      cursor = sEnd[sPos]
      sPos++
    } else {
      charStart[i] = cursor
      charEnd[i] = cursor
    }
  }

  return {
    charStart,
    charEnd,
    matchedCount: pairs.length,
    canonicalSpeechCount: sN,
    localSpeechCount: local.length,
  }
}
