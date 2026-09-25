// ローカルAIテロップ動画: 全編（約15分）用の純粋関数。外部AI・ファイル・ffmpegには触れない。
//
// 承認済みの5分検証（区間単位のアラインメント + 自然なページ分割）を、全編へ「区間ごと」に適用するための部品:
// - planFullWindows: rawSegment（文末で終わる区間）の境界で全編を数個の窓に分ける（窓の境界は文の終わり）
// - clipLegacyCaptions: 旧caption（正本の切り分け）を窓の文字範囲へ切り出す（低信頼区間のフォールバック時刻用）
// - mergeWindowCaptions: 窓ごとの結果（窓内の相対時刻）を、全編の絶対時刻・正本上の位置へ結合する
// - inheritCaptionTypes / carryOverEmphasis: 旧caption・承認済み強調を、IDではなく「正本上の文字範囲」で引き継ぐ
// - buildSmartTopicSections: 人が確認したテーマ（本文の語で根拠づけ済み）を、caption境界へスナップして常時表示の形へ
// - validateFullCaptions: 全編の不変条件（正本一致・時刻・禁止境界など）
//
// 本文（正本）は変更しない。改行は表示時だけ（lines）で本文には保存しない。

import { STRONG_PUNCT } from './japaneseText.mjs'

const isStrongEnd = (t) => STRONG_PUNCT.has(t[t.length - 1])
const r3 = (v) => Math.round(v * 1000) / 1000

/**
 * 全編を窓に分ける。窓の境界は「文末（。！？）で終わるrawSegmentの終わり」から、等分位置に最も近いものを選ぶ。
 * 窓の開始・終了時刻は rawSegment の時刻（丸めない）。最後の窓の終了は durationSec。
 *
 * @param {Array<{ startSec: number, endSec: number, text: string }>} rawSegments
 * @param {{ windowCount?: number, durationSec: number }} opts
 * @returns {Array<{ index: number, startIndex: number, endIndex: number, startSec: number, endSec: number, durationSec: number }>}
 */
export function planFullWindows(rawSegments, opts) {
  const n = Math.max(1, opts.windowCount ?? 3)
  const total = opts.durationSec
  const cum = []
  let c = 0
  for (const s of rawSegments) {
    c += s.text.length
    cum.push(c)
  }
  const cuts = [] // 分割位置（rawSegmentのindex。そのsegmentの終わりで切る）
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n
    let best = -1
    let bd = Infinity
    rawSegments.forEach((s, i) => {
      if (i === rawSegments.length - 1 || !isStrongEnd(s.text)) return
      if (cuts.length && i <= cuts[cuts.length - 1]) return
      const d = Math.abs(s.endSec - target)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    if (best >= 0) cuts.push(best)
  }
  const bounds = [-1, ...cuts, rawSegments.length - 1]
  const wins = []
  for (let w = 0; w < bounds.length - 1; w++) {
    const a = bounds[w] + 1
    const b = bounds[w + 1]
    const startSec = rawSegments[a].startSec
    const endSec = w === bounds.length - 2 ? total : rawSegments[b].endSec
    wins.push({ index: w, startIndex: a === 0 ? 0 : cum[a - 1], endIndex: cum[b], startSec, endSec, durationSec: endSec - startSec })
  }
  return wins
}

/**
 * 旧caption（正本を連結した並び）を、正本上の [startIndex, endIndex) へ切り出す。
 * 範囲の境界をまたぐcaptionは文字数に比例して時刻を按分する（低信頼区間のフォールバックにだけ使う）。
 * 戻り値の時刻は元動画の絶対時刻。
 */
export function clipLegacyCaptions(legacy, startIndex, endIndex) {
  const out = []
  let idx = 0
  for (const c of legacy) {
    const a = idx
    const b = idx + c.text.length
    idx = b
    if (b <= startIndex || a >= endIndex) continue
    const from = Math.max(a, startIndex)
    const to = Math.min(b, endIndex)
    const dur = c.endSec - c.startSec
    out.push({
      ...c,
      text: c.text.slice(from - a, to - a),
      startSec: c.startSec + (dur * (from - a)) / c.text.length,
      endSec: c.startSec + (dur * (to - a)) / c.text.length,
    })
  }
  return out
}

/**
 * 窓ごとの自然captionを全編へ結合する。窓内の相対時刻 → 絶対時刻、startIndex → 全編の正本上の位置。
 * @param {Array<{ startIndex: number, startSec: number }>} windows
 * @param {Array<Array<object>>} perWindowCaptions 各窓の caption（startSec/endSec は窓の先頭=0秒の相対）
 */
export function mergeWindowCaptions(windows, perWindowCaptions) {
  const out = []
  windows.forEach((w, wi) => {
    for (const c of perWindowCaptions[wi]) {
      out.push({ ...c, startSec: r3(c.startSec + w.startSec), endSec: r3(c.endSec + w.startSec), startIndex: c.startIndex + w.startIndex, windowIndex: wi })
    }
  })
  return out.map((c, i) => ({ ...c, id: `full-${String(i).padStart(4, '0')}`, displayOrder: i }))
}

/** 正本上の文字範囲ごとに、旧captionの範囲を返す。 */
export function legacyCharRanges(legacy) {
  const out = []
  let idx = 0
  for (const c of legacy) {
    out.push({ startIndex: idx, endIndex: idx + c.text.length, captionType: c.captionType, emphasisText: c.emphasisText ?? null })
    idx += c.text.length
  }
  return out
}

/**
 * captionTypeを旧captionから、正本上の文字範囲で引き継ぐ。
 * - 新captionの全文字が「同じ1件の旧caption」に含まれる → その種別
 * - 複数の旧captionにまたがる・対応が曖昧 → 'normal'
 * - heading は引き継がない（上部中央に出るため、トークテーマ・LINE案内と競合する。normalにする）
 * - 種別ごとの件数を返す。
 * @returns {{ captions: object[], counts: Record<string, number>, ambiguous: number, headingDemoted: number }}
 */
export function inheritCaptionTypes(captions, legacy, opts = {}) {
  const ranges = legacyCharRanges(legacy)
  const counts = {}
  let ambiguous = 0
  let headingDemoted = 0
  const out = captions.map((c) => {
    const a = c.startIndex
    const b = c.startIndex + c.text.length
    const hit = ranges.filter((r) => r.startIndex < b && r.endIndex > a)
    let type = 'normal'
    if (hit.length === 1 && hit[0].startIndex <= a && hit[0].endIndex >= b) type = hit[0].captionType || 'normal'
    else ambiguous += 1
    if (type === 'heading' && !opts.allowHeading) {
      type = 'normal'
      headingDemoted += 1
    }
    counts[type] = (counts[type] ?? 0) + 1
    return { ...c, captionType: type }
  })
  return { captions: out, counts, ambiguous, headingDemoted }
}

/**
 * 承認済みの強調（旧ページの caption と強調語）を、新captionへ「正本上の位置」で引き継ぐ。
 * 強調語が新captionの本文に、同じ正本位置で完全に含まれる場合だけ引き継ぐ。1captionにつき最大1か所。
 *
 * @param {Array<{ startIndex: number, text: string }>} newCaptions 全編の正本位置つきcaption
 * @param {Array<{ globalStartIndex: number, text: string, emphasisText: string }>} approved 承認済みの強調（旧captionの全編での位置・本文・強調語）
 * @returns {{ captions: object[], carried: number, dropped: number }}
 */
export function carryOverEmphasis(newCaptions, approved) {
  const out = newCaptions.map((c) => ({ ...c, emphasisText: c.emphasisText ?? null }))
  let carried = 0
  let dropped = 0
  for (const ap of approved) {
    const pos = ap.text.indexOf(ap.emphasisText)
    if (pos < 0) { dropped += 1; continue }
    const a = ap.globalStartIndex + pos
    const b = a + ap.emphasisText.length
    const target = out.find((c) => c.startIndex <= a && c.startIndex + c.text.length >= b)
    if (!target || target.emphasisText || target.text.slice(a - target.startIndex, b - target.startIndex) !== ap.emphasisText) { dropped += 1; continue }
    target.emphasisText = ap.emphasisText
    carried += 1
  }
  return { captions: out, carried, dropped }
}

/**
 * 全編のcaption不変条件。@returns {{ ok: boolean, problems: string[], stats: object }}
 */
export function validateFullCaptions(captions, canonicalText, opts = {}) {
  const problems = []
  const maxChars = opts.maxChars ?? 30
  if (captions.map((c) => c.text).join('') !== canonicalText) problems.push('本文の連結が正本と一致しません')
  if (captions.some((c) => !c.text || !c.text.trim())) problems.push('空のcaptionがあります')
  if (captions.some((c) => /[\r\n]|\\N/.test(c.text))) problems.push('本文に改行/\\Nが混入')
  if (captions.some((c) => c.lines.length > 2)) problems.push('3行以上のcaptionがあります')
  if (captions.some((c) => c.lines.join('') !== c.text)) problems.push('linesが本文と一致しません')
  if (captions.some((c) => Array.from(c.text).length > maxChars)) problems.push(`${maxChars}文字を超えるcaptionがあります`)
  let reversed = 0
  let overlapped = 0
  captions.forEach((c, i) => {
    if (!(c.startSec < c.endSec)) reversed += 1
    if (i > 0 && c.startSec < captions[i - 1].endSec - 1e-6) overlapped += 1
    if (i > 0 && c.startSec < captions[i - 1].startSec) reversed += 1
  })
  if (reversed) problems.push(`時刻逆転が${reversed}件あります`)
  if (overlapped) problems.push(`時刻重複が${overlapped}件あります`)
  let idx = 0
  captions.forEach((c, i) => {
    if (c.startIndex !== idx) problems.push(`startIndexが連続していません (#${i})`)
    idx += c.text.length
  })
  return { ok: problems.length === 0, problems, stats: { reversed, overlapped } }
}

/**
 * 常時表示テーマの構築。人が確認した区間（開始文字位置 or 開始caption index）を、caption境界へ合わせて
 * 「隙間・重複なし・全編被覆」の TopicSection[] にする。source は常に 'manual'。
 *
 * @param {Array<{ id: string, title: string, startCaptionIndex: number }>} defs 開始captionの順序（昇順・先頭は0）
 * @param {Array<{ startSec: number, endSec: number }>} captions
 * @param {number} mainEndSec
 */
export function buildManualTopicSections(defs, captions, mainEndSec) {
  return defs.map((d, i) => {
    const startSec = i === 0 ? 0 : captions[d.startCaptionIndex].startSec
    const endSec = i === defs.length - 1 ? mainEndSec : captions[defs[i + 1].startCaptionIndex].startSec
    return { id: d.id, title: d.title, startSec: r3(startSec), endSec: r3(endSec), source: 'manual' }
  })
}

/** テーマ区間ごとの正本本文（根拠確認用）。 */
export function themeTexts(sections, captions) {
  return sections.map((s) => captions.filter((c) => c.startSec >= s.startSec - 1e-6 && c.startSec < s.endSec - 1e-6).map((c) => c.text).join(''))
}
