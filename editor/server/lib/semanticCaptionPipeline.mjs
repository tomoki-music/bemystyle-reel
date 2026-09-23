// ローカルAIテロップ動画: 比較検証用の「新方式caption」を組み立てる。
//
// 入力: 既存caption（正本本文・既存captionType）、ローカルWhisperのトークン時刻、実測無音区間。
// 出力: 新方式の表示用caption配列（検証用の別データ）。既存caption/rawSegmentsは変更しない
//       （入力は読み取り専用。deepFreezeしても壊れない純粋関数）。
//
// - 本文は既存captionの連結を正本にする（ローカルWhisperの本文では置き換えない）。
// - captionType は比較表示専用に、時間的な重なりが最大の既存captionから引き継ぐ。
//   正本データには保存しない。分類APIは呼ばない。
// - 改行位置は lines として別保持する（本文に \N を混ぜない）。レンダー時に \N へ変換する。

import { alignCanonicalToTokens } from './charTiming.mjs'
import { splitTextIntoSemanticPages } from './semanticCaptionSplitter.mjs'

/**
 * 区間 [startSec,endSec] と最も重なりが大きい既存captionのcaptionTypeを返す。無ければ 'normal'。
 * @param {{ startSec: number, endSec: number }} page
 * @param {Array<{ startSec: number, endSec: number, captionType?: string }>} legacyLocal クリップ先頭=0秒の既存caption
 */
export function inheritCaptionType(page, legacyLocal) {
  let best = null
  let bestOverlap = 0
  for (const c of legacyLocal) {
    const overlap = Math.min(page.endSec, c.endSec) - Math.max(page.startSec, c.startSec)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = c
    }
  }
  return best?.captionType ?? 'normal'
}

/**
 * @param {{
 *   legacyCaptions: Array<{ startSec: number, endSec: number, text: string, captionType?: string }>,
 *   windowStartSec: number,
 *   windowDurationSec: number,
 *   tokens: Array<{ text: string, startSec: number, endSec: number }>,
 *   silences: Array<{ startSec: number, endSec: number }>,
 *   splitOptions?: object,
 * }} p
 * @returns {{
 *   captions: Array<{ id: string, startSec: number, endSec: number, text: string, lines: string[], captionType: string, emphasisText: null, displayOrder: number }>,
 *   canonicalText: string,
 *   alignment: { matchedCount: number, canonicalSpeechCount: number, localSpeechCount: number },
 * }}
 *   captions の startSec/endSec はクリップ先頭=0秒の相対時刻。
 */
export function buildSemanticCaptions(p) {
  const { legacyCaptions, windowStartSec, windowDurationSec, tokens, silences } = p
  const legacyLocal = legacyCaptions.map((c) => ({
    startSec: c.startSec - windowStartSec,
    endSec: c.endSec - windowStartSec,
    captionType: c.captionType,
  }))
  const canonicalText = legacyCaptions.map((c) => c.text).join('')
  const bounds = { startSec: 0, endSec: windowDurationSec }

  const timing = alignCanonicalToTokens(canonicalText, tokens, silences, bounds)
  const pages = splitTextIntoSemanticPages(canonicalText, timing, bounds, p.splitOptions)

  const captions = pages.map((pg, i) => ({
    id: `semantic-${String(i).padStart(3, '0')}`,
    startSec: pg.startSec,
    endSec: pg.endSec,
    text: pg.text,
    lines: pg.lines,
    captionType: inheritCaptionType(pg, legacyLocal),
    emphasisText: null,
    displayOrder: i,
  }))

  return {
    captions,
    canonicalText,
    alignment: {
      matchedCount: timing.matchedCount,
      canonicalSpeechCount: timing.canonicalSpeechCount,
      localSpeechCount: timing.localSpeechCount,
    },
  }
}

/**
 * 新方式captionの不変条件を検証する。違反メッセージの配列を返す（空なら全て合格）。
 * @param {Array<{ startSec: number, endSec: number, text: string, lines?: string[] }>} captions
 * @param {string} canonicalText
 */
export function validateSemanticCaptions(captions, canonicalText, { maxLines = 2 } = {}) {
  const problems = []
  if (captions.map((c) => c.text).join('') !== canonicalText) problems.push('本文の連結が正本と一致しません')
  let prevEnd = -Infinity
  captions.forEach((c, i) => {
    if (/[\r\n]|\\N/.test(c.text)) problems.push(`caption[${i}] の本文に改行/\\Nが混入しています`)
    if (!(c.endSec >= c.startSec)) problems.push(`caption[${i}] の終了が開始より前です`)
    if (c.startSec < prevEnd - 1e-9) problems.push(`caption[${i}] が前のcaptionと重なっています`)
    prevEnd = c.endSec
    if (Array.isArray(c.lines)) {
      if (c.lines.length > maxLines) problems.push(`caption[${i}] の行数が${maxLines}を超えています`)
      if (c.lines.join('') !== c.text) problems.push(`caption[${i}] の行結合が本文と一致しません`)
    }
  })
  return problems
}
