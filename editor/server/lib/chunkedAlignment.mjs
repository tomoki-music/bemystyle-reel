// ローカルAIテロップ動画: 5分規模の区間を「区間単位」で正本文字へ時刻合わせする。
//
// 5分全体を巨大な1つのLCSで処理しない。既存の文字起こしのrawSegment(Whisper APIの区間。数十秒単位)ごとに
// 正本テキストを切り出し、その区間の時刻付近のローカルWhisperトークンだけとLCSで対応づける。
// - 本文の正本は既存文字起こしのまま（ローカル結果は時刻合わせにだけ使う）。
// - 認識結果が大きく異なる区間(一致率が minMatchRatio 未満・トークンなし)は「低信頼区間」として検出し、
//   その区間の文字はローカル時刻を使わず、rawSegmentの時間範囲へ発話文字数に応じて配る（元時刻へフォールバック）。
//   その文字は charMatched=false になるので、ページ分割側で lowConfidence として扱われる。
// - 区間の境界付近では前後の区間のトークンを混ぜないよう、トークンは中点で振り分ける（margin秒の重なりを許す）。
// 純粋関数のみ。AI/LLMは使わない。

import { alignCanonicalToTokens, distributeAcrossSpeech } from './charTiming.mjs'
import { isSpeechChar } from './japaneseText.mjs'

export const CHUNK_DEFAULTS = { marginSec: 1.0, minMatchRatio: 0.5 }

/**
 * rawSegment 列から、窓の正本テキスト上の区間計画を作る。
 *
 * @param {{
 *   rawSegments: Array<{ startSec: number, endSec: number, text: string }>,
 *   globalOffset: number,   // 窓の正本テキストが、全体の正本テキストの何文字目から始まるか
 *   textLength: number,     // 窓の正本テキストの長さ
 *   windowStartSec: number, // 窓の開始秒（元動画の時刻）
 *   windowDurationSec: number,
 * }} p
 * @returns {Array<{ index: number, startIndex: number, endIndex: number, startSec: number, endSec: number }>}
 *   startSec/endSec は窓の先頭=0秒の相対時刻。窓の外の区間は含まない。
 */
export function planChunksFromRawSegments(p) {
  const chunks = []
  let cursor = 0
  for (const seg of p.rawSegments) {
    const len = seg.text.length
    const a = Math.max(0, cursor - p.globalOffset)
    const b = Math.min(p.textLength, cursor + len - p.globalOffset)
    cursor += len
    if (b <= a) continue
    chunks.push({
      index: chunks.length,
      startIndex: a,
      endIndex: b,
      startSec: Math.max(0, seg.startSec - p.windowStartSec),
      endSec: Math.min(p.windowDurationSec, seg.endSec - p.windowStartSec),
    })
  }
  return chunks
}

/**
 * 区間単位のアラインメント。alignCanonicalToTokens と同じ形の結果（+ chunks の報告）を返す。
 *
 * @param {{
 *   canonicalText: string,
 *   chunks: ReturnType<typeof planChunksFromRawSegments>,
 *   tokens: Array<{ text: string, startSec: number, endSec: number, p?: number }>,
 *   silences: Array<{ startSec: number, endSec: number }>,
 *   bounds: { startSec: number, endSec: number },
 *   marginSec?: number, minMatchRatio?: number,
 * }} p
 */
export function alignCanonicalByChunks(p) {
  const o = { ...CHUNK_DEFAULTS, marginSec: p.marginSec ?? CHUNK_DEFAULTS.marginSec, minMatchRatio: p.minMatchRatio ?? CHUNK_DEFAULTS.minMatchRatio }
  const n = p.canonicalText.length
  const charStart = new Array(n).fill(p.bounds.startSec)
  const charEnd = new Array(n).fill(p.bounds.startSec)
  const charMatched = new Array(n).fill(false)
  const charTokenP = new Array(n).fill(null)
  const reports = []
  let matchedCount = 0
  let speechCount = 0
  let localCount = 0

  for (const c of p.chunks) {
    const text = p.canonicalText.slice(c.startIndex, c.endIndex)
    const lo = Math.max(p.bounds.startSec, c.startSec - o.marginSec)
    const hi = Math.min(p.bounds.endSec, c.endSec + o.marginSec)
    const chunkTokens = p.tokens.filter((t) => (t.startSec + t.endSec) / 2 >= lo && (t.startSec + t.endSec) / 2 <= hi)
    const local = alignCanonicalToTokens(text, chunkTokens, p.silences, { startSec: lo, endSec: hi })
    const ratio = local.canonicalSpeechCount ? local.matchedCount / local.canonicalSpeechCount : 1
    const diverged = local.canonicalSpeechCount > 0 && (chunkTokens.length === 0 || ratio < o.minMatchRatio)
    speechCount += local.canonicalSpeechCount
    localCount += local.localSpeechCount
    if (!diverged) matchedCount += local.matchedCount

    if (diverged) {
      // 元時刻へフォールバック: rawSegmentの時間範囲に、発話文字数に応じて配る。ローカル時刻は使わない。
      const idx = []
      for (let i = 0; i < text.length; i++) if (isSpeechChar(text[i])) idx.push(i)
      const spans = distributeAcrossSpeech(c.startSec, Math.max(c.startSec, c.endSec), idx.length, p.silences)
      let cursor = c.startSec
      let k = 0
      for (let i = 0; i < text.length; i++) {
        if (k < idx.length && idx[k] === i) {
          charStart[c.startIndex + i] = spans[k].startSec
          charEnd[c.startIndex + i] = spans[k].endSec
          cursor = spans[k].endSec
          k++
        } else {
          charStart[c.startIndex + i] = cursor
          charEnd[c.startIndex + i] = cursor
        }
        charMatched[c.startIndex + i] = false
        charTokenP[c.startIndex + i] = null
      }
    } else {
      for (let i = 0; i < text.length; i++) {
        charStart[c.startIndex + i] = local.charStart[i]
        charEnd[c.startIndex + i] = local.charEnd[i]
        charMatched[c.startIndex + i] = local.charMatched[i]
        charTokenP[c.startIndex + i] = local.charTokenP[i]
      }
    }
    reports.push({ index: c.index, chars: text.length, speechChars: local.canonicalSpeechCount, matchedChars: diverged ? 0 : local.matchedCount, matchRatio: ratio, tokens: chunkTokens.length, fallback: diverged })
  }

  // 区間の重なり(margin)で生じた逆転を直す: 時刻は単調非減少・範囲内にする。
  let prev = p.bounds.startSec
  for (let i = 0; i < n; i++) {
    const s = Math.min(Math.max(charStart[i], prev), p.bounds.endSec)
    const e = Math.min(Math.max(charEnd[i], s), p.bounds.endSec)
    charStart[i] = s
    charEnd[i] = e
    prev = e
  }

  return { charStart, charEnd, charMatched, charTokenP, matchedCount, canonicalSpeechCount: speechCount, localSpeechCount: localCount, chunks: reports }
}
