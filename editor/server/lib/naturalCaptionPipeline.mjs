// ローカルAIテロップ動画: 「発話時刻優先」の比較用captionを組み立てる（検証用の別データ）。
//
// 入力(既存caption・ローカルWhisperトークン・実測無音)は読み取り専用。本文は既存captionの連結を正本にし、
// ローカル結果で置き換えない。captionTypeは比較表示では全て 'normal'（統一されたベースデザイン）。
// 強調は emphasisSelector で検証した比較専用データ（既存ジョブへは保存しない）。

import { alignCanonicalToTokens } from './charTiming.mjs'
import { splitTextIntoNaturalPages } from './naturalCaptionSplitter.mjs'
import { assignEmphasis } from './emphasisSelector.mjs'

/**
 * @param {{
 *   legacyCaptions: Array<{ startSec: number, endSec: number, text: string }>,
 *   windowStartSec: number, windowDurationSec: number,
 *   tokens: Array<{ text: string, startSec: number, endSec: number, p?: number }>,
 *   silences: Array<{ startSec: number, endSec: number }>,
 *   emphasisCandidates?: string[],
 *   timing?: object, // 区間単位のアラインメント結果（省略時は tokens 全体を1回でアラインする）
 *   splitOptions?: object,
 * }} p
 */
export function buildNaturalCaptions(p) {
  const { legacyCaptions, windowStartSec, windowDurationSec, tokens, silences } = p
  const canonicalText = legacyCaptions.map((c) => c.text).join('')
  const bounds = { startSec: 0, endSec: windowDurationSec }

  // 旧captionの正本上の範囲と元時刻（低信頼区間のフォールバック用）
  const legacyRanges = []
  let idx = 0
  for (const c of legacyCaptions) {
    legacyRanges.push({ startIndex: idx, endIndex: idx + c.text.length, startSec: c.startSec - windowStartSec, endSec: c.endSec - windowStartSec })
    idx += c.text.length
  }

  const timing = p.timing ?? alignCanonicalToTokens(canonicalText, tokens, silences, bounds)
  const pages = splitTextIntoNaturalPages(canonicalText, timing, bounds, { ...(p.splitOptions ?? {}), legacyRanges })

  const base = pages.map((pg, i) => ({
    id: `natural-${String(i).padStart(3, '0')}`,
    startSec: pg.startSec,
    endSec: pg.endSec,
    text: pg.text,
    lines: pg.lines,
    startIndex: pg.startIndex,
    captionType: 'normal',
    emphasisText: null,
    lowConfidence: pg.lowConfidence,
    boundaryKind: pg.boundaryKind,
    displayOrder: i,
  }))
  const emphasis = assignEmphasis(base, p.emphasisCandidates ?? [])

  return {
    captions: emphasis.captions,
    emphasis: { appliedCount: emphasis.applied.length, appliedLengths: emphasis.applied.map((t) => Array.from(t).length), rejected: emphasis.rejected },
    canonicalText,
    timing,
    alignment: { matchedCount: timing.matchedCount, canonicalSpeechCount: timing.canonicalSpeechCount, localSpeechCount: timing.localSpeechCount },
  }
}
