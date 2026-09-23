// ローカルAIテロップ動画: caption配列の「読みにくさ」問題を機械的に数える。
//
// 旧方式(文字数ベース分割)と新方式(語境界・無音ベース分割)の比較、および
// 比較検証用60秒区間の選定に使う。純粋関数のみ。AI/LLMは使わない。
// 旧・新の両方を同一の基準(japaneseText.mjs)で採点する。
//
// 検出する問題:
// - forcedSplit   : 句読点なしの30文字強制分割（最大文字数ちょうどで切れている）
// - midWord       : 単語途中と推定される分割（語の内部・複合語・活用断片・小書き仮名始まり）
// - particleStart : 次ページ先頭が助詞
// - short         : 2秒未満のcaption
// - long          : 30文字超のcaption
// - danglingConj  : ページ末尾が接続詞だけで終わる（補助指標）

import {
  boundaryProblems,
  endsWithDanglingConjunction,
  STRONG_PUNCT,
  COMMA_PUNCT,
} from './japaneseText.mjs'

export const FORCED_SPLIT_LENGTH = 30
export const MIN_DISPLAY_SEC = 2
export const MAX_CHARS = 30

const ISSUE_KEYS = ['forcedSplit', 'midWord', 'particleStart', 'short', 'long']

/**
 * caption配列（時刻順）に対して、caption単位の問題フラグを返す。
 * 境界系の問題(midWord/particleStart/forcedSplit)は「そのcaptionの末尾」に帰属させる。
 *
 * @param {Array<{ startSec: number, endSec: number, text: string }>} captions
 */
export function analyzeCaptionIssues(captions) {
  return captions.map((c, i) => {
    const text = c.text ?? ''
    const next = captions[i + 1]
    const lastChar = text[text.length - 1]
    const b = next ? boundaryProblems(text, next.text ?? '') : { midWord: false, particleStart: false }
    return {
      forcedSplit: Boolean(next) && text.length === FORCED_SPLIT_LENGTH && !STRONG_PUNCT.has(lastChar) && !COMMA_PUNCT.has(lastChar),
      midWord: b.midWord,
      particleStart: b.particleStart,
      short: c.endSec - c.startSec < MIN_DISPLAY_SEC - 1e-9,
      long: text.length > MAX_CHARS,
      danglingConj: Boolean(next) && endsWithDanglingConjunction(text),
    }
  })
}

/**
 * @param {ReturnType<typeof analyzeCaptionIssues>} flags
 */
export function summarizeIssues(flags) {
  const summary = { forcedSplit: 0, midWord: 0, particleStart: 0, short: 0, long: 0, danglingConj: 0, total: 0 }
  for (const f of flags) {
    for (const k of [...ISSUE_KEYS, 'danglingConj']) if (f[k]) summary[k] += 1
  }
  summary.total = ISSUE_KEYS.reduce((a, k) => a + summary[k], 0)
  return summary
}

/**
 * 問題数(total)が最も多い windowSec 秒の区間を選ぶ。開始は各captionの開始時刻を候補とする。
 * 同点なら最も早い区間。区間内 = 開始・終了とも区間に収まるcaption。
 *
 * @param {Array<{ startSec: number, endSec: number, text: string }>} captions 時刻順
 * @param {{ windowSec?: number, totalDurationSec?: number }} [options]
 */
export function selectMostProblematicWindow(captions, options = {}) {
  const windowSec = options.windowSec ?? 60
  const sorted = [...captions].sort((a, b) => a.startSec - b.startSec)
  if (sorted.length === 0) return null
  const flags = analyzeCaptionIssues(sorted)
  const totalEnd = Number.isFinite(options.totalDurationSec) ? options.totalDurationSec : sorted[sorted.length - 1].endSec

  let best = null
  for (const c of sorted) {
    const start = c.startSec
    const end = start + windowSec
    if (end > totalEnd + 1e-9) continue
    const idx = []
    sorted.forEach((cc, i) => {
      if (cc.startSec >= start - 1e-9 && cc.endSec <= end + 1e-9) idx.push(i)
    })
    const summary = summarizeIssues(idx.map((i) => flags[i]))
    if (!best || summary.total > best.issueTotal) {
      best = { startSec: start, endSec: end, issueTotal: summary.total, summary, captionCount: idx.length }
    }
  }
  return best
}
