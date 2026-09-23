// ローカルAIテロップ動画: 旧方式/新方式・既存文字起こし/ローカル文字起こしの比較指標。
//
// すべて数値のみを返す（字幕本文は返さない）。純粋関数。AI/LLMは使わない。

import { lcsPairs } from './charTiming.mjs'
import { classifyBoundaries, isSpeechChar, STRONG_PUNCT, COMMA_PUNCT } from './japaneseText.mjs'

/** 比較用の正規化: NFKC・小文字化し、句読点/空白/記号を除いた文字配列にする。 */
export function normalizeForCompare(text) {
  return Array.from(text.normalize('NFKC').toLowerCase()).filter((c) => isSpeechChar(c))
}

/**
 * 正規化後の一致率 = 2 * LCS / (|a| + |b|)。0〜1。
 */
export function normalizedSimilarity(a, b) {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  if (na.length + nb.length === 0) return 1
  const pairs = lcsPairs(na, nb)
  return (2 * pairs.length) / (na.length + nb.length)
}

export function countPunctuation(text) {
  let n = 0
  for (const ch of text) if (STRONG_PUNCT.has(ch) || COMMA_PUNCT.has(ch)) n += 1
  return n
}

/**
 * 既存本文(正本)に対する「認識結果の欠落」の推定。
 * 正本の発話文字のうちローカル結果に対応が無いものの割合と、連続して欠けている最長の長さ。
 * @returns {{ missingRatio: number, extraRatio: number, longestMissingRun: number, missingRunsOver8: number }}
 */
export function analyzeMissing(canonicalText, localText) {
  const a = normalizeForCompare(canonicalText)
  const b = normalizeForCompare(localText)
  const pairs = lcsPairs(a, b)
  const matchedA = new Set(pairs.map((p) => p[0]))
  let longest = 0
  let over8 = 0
  let run = 0
  for (let i = 0; i <= a.length; i++) {
    if (i < a.length && !matchedA.has(i)) {
      run += 1
    } else {
      if (run > longest) longest = run
      if (run >= 8) over8 += 1
      run = 0
    }
  }
  return {
    missingRatio: a.length ? (a.length - pairs.length) / a.length : 0,
    extraRatio: b.length ? (b.length - pairs.length) / b.length : 0,
    longestMissingRun: longest,
    missingRunsOver8: over8,
  }
}

/**
 * 固有名詞らしい語（カタカナ・英数字の連続3文字以上）が、ローカル結果にそのまま含まれる割合。
 * 本文は返さず、件数と割合のみ。
 */
export function properNounPreservation(canonicalText, localText) {
  const terms = canonicalText.normalize('NFKC').match(/[ァ-ヿー]{3,}|[A-Za-z0-9]{3,}/g) ?? []
  const local = localText.normalize('NFKC').toLowerCase()
  const kept = terms.filter((t) => local.includes(t.toLowerCase())).length
  return { total: terms.length, kept, ratio: terms.length ? kept / terms.length : 1 }
}

/**
 * caption境界（正本テキスト上の切断位置）の不自然さを、旧・新で同じ基準で数える。
 * 「禁止境界」= 助詞/活用断片/複合語/送り仮名/小書き仮名始まり/語の途中で切っている位置。
 *
 * @param {string[]} pageTexts 連結すると正本になる各ページ本文
 * @returns {{ boundaries: number, forbidden: number, byReason: Record<string, number> }}
 */
export function countForbiddenBoundaries(pageTexts) {
  const joined = pageTexts.join('')
  const info = classifyBoundaries(joined)
  const byReason = {}
  let forbidden = 0
  let pos = 0
  for (let i = 0; i < pageTexts.length - 1; i++) {
    pos += pageTexts[i].length
    const b = info[pos]
    if (b && b.forbidden.length > 0) {
      forbidden += 1
      for (const r of b.forbidden) byReason[r] = (byReason[r] ?? 0) + 1
    }
  }
  return { boundaries: Math.max(0, pageTexts.length - 1), forbidden, byReason }
}

/** 数値配列の基本統計。 */
export function stats(values) {
  if (values.length === 0) return { count: 0, min: 0, max: 0, mean: 0, median: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { count: values.length, min: sorted[0], max: sorted[sorted.length - 1], mean, median }
}

/**
 * caption表示と実測の音声(フレームdB)との同期を測る。
 * - silentDisplayRatio: 表示時間のうち、無音(しきい値未満)だった割合
 * - leadingSilentSec  : 表示開始直後から続く無音の長さ（字幕が発話より早く出ている量）
 * - trailingSilentSec : 表示終了直前まで続く無音の長さ（発話が終わった後も残っている量）
 *
 * @param {Array<{ startSec: number, endSec: number }>} captions クリップ先頭=0秒
 * @param {number[]} frameDb
 * @param {number} frameSec
 * @param {number} thresholdDb
 */
export function measureSyncAgainstAudio(captions, frameDb, frameSec, thresholdDb) {
  const isSilent = (idx) => idx < 0 || idx >= frameDb.length || frameDb[idx] < thresholdDb
  const leading = []
  const trailing = []
  let displayed = 0
  let displayedSilent = 0
  for (const c of captions) {
    const a = Math.max(0, Math.floor(c.startSec / frameSec))
    const b = Math.min(frameDb.length, Math.ceil(c.endSec / frameSec))
    if (b <= a) continue
    let silentFrames = 0
    for (let i = a; i < b; i++) if (isSilent(i)) silentFrames += 1
    displayed += b - a
    displayedSilent += silentFrames
    let lead = 0
    while (a + lead < b && isSilent(a + lead)) lead += 1
    let trail = 0
    while (b - 1 - trail >= a && isSilent(b - 1 - trail)) trail += 1
    leading.push(lead * frameSec)
    trailing.push(trail * frameSec)
  }
  return {
    silentDisplayRatio: displayed ? displayedSilent / displayed : 0,
    leadingSilentSec: stats(leading),
    trailingSilentSec: stats(trailing),
  }
}

/** 表示時間・文字数・読み速度(文字/秒)の統計。 */
export function readabilityStats(captions) {
  const durations = captions.map((c) => c.endSec - c.startSec)
  const cps = captions.map((c) => c.text.length / Math.max(0.01, c.endSec - c.startSec))
  return {
    duration: stats(durations),
    chars: stats(captions.map((c) => c.text.length)),
    charsPerSec: stats(cps),
    over8cps: cps.filter((v) => v > 8).length,
    over10cps: cps.filter((v) => v > 10).length,
  }
}

/**
 * 表示区間が「実測の発話」の切れ目と合っているかを、音声由来の無音区間で測る。
 * - startsAtSpeechOnset : captionの開始が、発話再開(無音の終わり)の±0.15秒以内にある数
 * - onsetOffsetSec      : 発話再開の±0.6秒以内にあるcaption開始の、開始-発話再開(秒)の統計（正=遅れ）
 * - endsAtPause         : captionの終了が、発話停止(無音の始まり)の -0.1〜+0.4秒以内にある数
 * - shownThroughSilence : 0.3秒以上の無音を丸ごと表示し続けているcaptionの延べ数
 *
 * @param {Array<{ startSec: number, endSec: number }>} captions クリップ先頭=0秒
 * @param {Array<{ startSec: number, endSec: number }>} silences 実測の無音区間(0.3秒以上)
 */
export function measureBoundaryAlignment(captions, silences) {
  const onsets = silences.map((s) => s.endSec)
  const pauses = silences.map((s) => s.startSec)
  let startsAtSpeechOnset = 0
  const offsets = []
  for (const c of captions) {
    let best = null
    for (const e of onsets) {
      const d = c.startSec - e
      if (Math.abs(d) <= 0.6 && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
    if (best !== null) {
      offsets.push(best)
      if (Math.abs(best) <= 0.15) startsAtSpeechOnset += 1
    }
  }
  const endsAtPause = captions.filter((c) => pauses.some((p) => c.endSec - p >= -0.1 && c.endSec - p <= 0.4)).length
  let shownThroughSilence = 0
  for (const c of captions) {
    for (const s of silences) if (c.startSec <= s.startSec && c.endSec >= s.endSec) shownThroughSilence += 1
  }
  return {
    captions: captions.length,
    startsAtSpeechOnset,
    onsetOffsetSec: stats(offsets),
    endsAtPause,
    shownThroughSilence,
  }
}
