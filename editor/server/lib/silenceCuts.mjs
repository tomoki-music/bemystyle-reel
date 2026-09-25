// ローカルAIテロップ動画: 無音カットの候補抽出・分類・上限・編集決定リスト。純粋関数のみ（ファイル・ffmpeg・外部AIには触れない）。
//
// 方針（安全側）:
// - 候補は、実測の無音が minSilenceSec（既定1.2秒）以上のものだけ。1.2秒未満は候補にしない。
// - 削除するのは、実測無音の全体ではなく、前後の余白（前: 発話終了後 約0.2秒 / 後: 次の発話開始前 約0.15秒）を除いた中央部分だけ。
//   カット点は 30fps のフレーム境界へ、残す余白が減らない向きに合わせる。
// - 判断できないもの・上限を超えるものは「人間の確認が必要」へ回し、勝手に採用しない。
// - caption表示中・語中（承認済みの語中無音を含む）・ダイジェスト内・冒頭LINEオーバーレイ内・大きな動作・信頼度が低いものはカットしない。

import { STRONG_PUNCT } from './japaneseText.mjs'

export const CUT_DEFAULTS = Object.freeze({
  fps: 30,
  minSilenceSec: 1.2,
  keepBeforeSec: 0.2, // 前の発話終了後（150〜250ms）
  keepAfterSec: 0.15, // 次の発話開始前（100〜200ms）
  minCutSec: 0.4, // これ未満しか削除できないカットは意味がないので採用しない
  maxCutSec: 3, // 1回のカット上限
  maxTotalSec: 60, // 本編全体の合計削除上限
  maxPerMinute: 3, // 60秒間のカット回数上限
  minCutGapSec: 5, // 連続するカットの間（残る時間）の最低秒数
  themeBoundaryGuardSec: 1.5, // テーマ切り替えの前後（話題転換の余韻）
  overlayGuardSec: 30, // 冒頭LINEオーバーレイ（編集後本編の最初の30秒）
  lowConfidenceMarginDb: 4, // 無音の平均音量が閾値よりこれ以上低くないと「本当に無音か」判断できない
  motionThreshold: 6, // 無音中の映像の動き（連続フレームの平均絶対差の最大）。これを超えると大きな動作・表情変化とみなす
  midWordMinGapSec: 0.5, // caption内の発話の間がこれ以上なら語中無音として保護（承認済みの0.67秒・0.72秒を含む）
})

export const CLASS = Object.freeze({ SAFE: 'safe', REVIEW: 'review', FORBIDDEN: 'forbidden' })
const r3 = (v) => Math.round(v * 1000) / 1000
const endsSentence = (t) => {
  const ch = Array.from(String(t ?? '').replace(/[」』）)\s]+$/u, '')).pop()
  return ch !== undefined && STRONG_PUNCT.has(ch)
}

/** フレーム境界へ（30fpsの 1/fps の倍数）。 */
export const ceilToFrame = (sec, fps = 30) => Math.ceil(sec * fps - 1e-6) / fps
export const floorToFrame = (sec, fps = 30) => Math.floor(sec * fps + 1e-6) / fps

/**
 * 実測の無音区間から、しきい値以上のものだけを候補にする（開始順）。1.2秒未満は除外する。
 * @param {Array<{ startSec: number, endSec: number }>} silences
 */
export function extractSilenceCandidates(silences, cfg = CUT_DEFAULTS) {
  return silences
    .filter((s) => s.endSec - s.startSec >= cfg.minSilenceSec - 1e-9)
    .map((s) => ({ ...s, silenceSec: r3(s.endSec - s.startSec) }))
    .sort((a, b) => a.startSec - b.startSec)
}

/**
 * 実測無音から、実際に削除する範囲（前後の余白を除いた中央部分）を決める。フレーム境界へは、残す余白が減らない向きに寄せる。
 * @returns {{ keepBeforeSec: number, keepAfterSec: number, cutStartSec: number, cutEndSec: number, cutSec: number }}
 */
export function planCutRange(silence, cfg = CUT_DEFAULTS) {
  const cutStartSec = ceilToFrame(silence.startSec + cfg.keepBeforeSec, cfg.fps)
  const cutEndSec = floorToFrame(silence.endSec - cfg.keepAfterSec, cfg.fps)
  return {
    keepBeforeSec: r3(cutStartSec - silence.startSec),
    keepAfterSec: r3(silence.endSec - cutEndSec),
    cutStartSec: r3(cutStartSec),
    cutEndSec: r3(cutEndSec),
    cutSec: r3(Math.max(0, cutEndSec - cutStartSec)),
  }
}

/**
 * caption内の発話の間（語中・文中の間）。captionの本文中の隣り合う発話文字の間隔が minGapSec 以上のもの。
 * 承認済みの語中無音（約0.72秒・約0.67秒）を含む。これらはcaptionを継続表示する例外で、自動カットの対象にしない。
 * @param {Array<{ id: string, startIndex: number, text: string }>} captions
 * @param {number[]} charStart 正本の文字ごとの開始（元動画の秒）
 * @param {number[]} charEnd
 */
export function findMidCaptionGaps(captions, charStart, charEnd, minGapSec = CUT_DEFAULTS.midWordMinGapSec) {
  const out = []
  for (const c of captions) {
    let prev = -1
    for (let k = 0; k < c.text.length; k++) {
      if (/[\s、。！？!?,，「」『』（）()・…]/.test(c.text[k])) continue
      const i = c.startIndex + k
      if (prev >= 0) {
        const gap = charStart[i] - charEnd[prev]
        if (gap >= minGapSec) out.push({ captionId: c.id, startSec: r3(charEnd[prev]), endSec: r3(charStart[i]), gapSec: r3(gap) })
      }
      prev = i
    }
  }
  return out
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 - 1e-9 && a1 > b0 + 1e-9

/**
 * 各候補を分類する（安全にカット可能 / 人間の確認が必要 / カット禁止）。採用可否はここでは決めない（上限は applyCutLimits）。
 *
 * @param {Array<{ startSec: number, endSec: number, silenceSec: number, meanDb?: number, thresholdDb?: number, motionMax?: number | null }>} candidates
 * @param {{ captions: Array<{ id: string, startSec: number, endSec: number, text: string, lowConfidence?: boolean }>,
 *           themes: Array<{ startSec: number, endSec: number }>, protectedGaps?: Array<{ startSec: number, endSec: number }>,
 *           excludeRanges?: Array<{ startSec: number, endSec: number, label?: string }>, cfg?: typeof CUT_DEFAULTS }} ctx
 */
export function classifyCandidates(candidates, ctx) {
  const cfg = ctx.cfg ?? CUT_DEFAULTS
  const caps = [...ctx.captions].sort((a, b) => a.startSec - b.startSec)
  const boundaries = ctx.themes.map((t) => t.startSec).concat(ctx.themes.map((t) => t.endSec))
  return candidates.map((s, i) => {
    const plan = planCutRange(s, cfg)
    const prev = [...caps].reverse().find((c) => c.endSec <= plan.cutStartSec + 1e-9) ?? null
    const next = caps.find((c) => c.startSec >= plan.cutEndSec - 1e-9) ?? null
    const inCaption = caps.some((c) => overlaps(c.startSec, c.endSec, plan.cutStartSec, plan.cutEndSec))
    const midWord = (ctx.protectedGaps ?? []).some((g) => overlaps(g.startSec, g.endSec, s.startSec, s.endSec))
    const sameSentence = Boolean(prev && next && !endsSentence(prev.text))
    const nearTheme = boundaries.some((b) => b > s.startSec - cfg.themeBoundaryGuardSec && b < s.endSec + cfg.themeBoundaryGuardSec)
    const excluded = (ctx.excludeRanges ?? []).find((r) => overlaps(r.startSec, r.endSec, s.startSec, s.endSec))
    const inOverlay = s.startSec < cfg.overlayGuardSec
    const notSilent = Number.isFinite(s.meanDb) && Number.isFinite(s.thresholdDb) && s.meanDb > s.thresholdDb
    const weak = Number.isFinite(s.meanDb) && Number.isFinite(s.thresholdDb) && s.meanDb > s.thresholdDb - cfg.lowConfidenceMarginDb
    const lowCaption = Boolean((prev && prev.lowConfidence) || (next && next.lowConfidence))
    const moving = Number.isFinite(s.motionMax) && s.motionMax > cfg.motionThreshold

    let cls = CLASS.SAFE
    let reason = '発話の間の実測無音（前後の余白を残して中央部分だけ削除）'
    const set = (c, r) => {
      cls = c
      reason = r
    }
    // 上から順に、最初に当たった理由を採る（禁止 > 確認）
    if (s.silenceSec < cfg.minSilenceSec - 1e-9) set(CLASS.FORBIDDEN, `1.2秒未満（${s.silenceSec}秒）`)
    else if (midWord) set(CLASS.FORBIDDEN, '語中無音（保護。承認済みの例外を含む）')
    else if (inCaption) set(CLASS.FORBIDDEN, 'caption表示中')
    else if (excluded) set(CLASS.FORBIDDEN, `${excluded.label ?? 'ダイジェスト'}に使う発言の内部`)
    else if (inOverlay) set(CLASS.FORBIDDEN, '冒頭LINEオーバーレイ（編集後本編の最初の30秒）の内部')
    else if (moving) set(CLASS.FORBIDDEN, 'カメラ上の大きな動作・表情変化がある')
    else if (notSilent) set(CLASS.FORBIDDEN, '実測では無音ではない（発話・雑音がある）')
    else if (plan.cutSec < cfg.minCutSec - 1e-9) set(CLASS.FORBIDDEN, `前後の余白を残すと削除できる長さが短い（${plan.cutSec}秒）`)
    else if (weak || lowCaption) set(CLASS.REVIEW, weak ? '無音の判定が弱い（本当に無音か判断できない）' : '前後のcaptionの時刻の信頼度が低い')
    else if (sameSentence) set(CLASS.REVIEW, '一文の途中の間（切ると意味が不自然になる可能性）')
    else if (nearTheme) set(CLASS.REVIEW, 'テーマ切り替えの前後（話題転換の余韻の可能性）')
    return {
      index: i,
      silenceStartSec: r3(s.startSec),
      silenceEndSec: r3(s.endSec),
      silenceSec: s.silenceSec,
      ...plan,
      prevCaptionId: prev?.id ?? null,
      nextCaptionId: next?.id ?? null,
      sameSentence,
      midWord,
      nearThemeBoundary: nearTheme,
      class: cls,
      decision: 'reject',
      reason,
    }
  })
}

/**
 * 安全なものだけを、上限（1回・合計・1分・間隔）の範囲で採用する（時系列順に確定。超えたものは「人間の確認が必要」へ回す）。
 * @returns {Array<object>} 各行に decision（adopt / reject）と、上限で回した場合の reason を反映
 */
export function applyCutLimits(rows, cfg = CUT_DEFAULTS) {
  const out = rows.map((r) => ({ ...r }))
  const adopted = []
  let total = 0
  for (const r of [...out].sort((a, b) => a.cutStartSec - b.cutStartSec)) {
    if (r.class !== CLASS.SAFE) continue
    const reject = (why) => {
      r.class = CLASS.REVIEW
      r.decision = 'reject'
      r.reason = `${why}（上限のため人間の確認へ）`
    }
    if (r.cutSec > cfg.maxCutSec + 1e-9) reject(`1回の上限${cfg.maxCutSec}秒を超える（${r.cutSec}秒）`)
    else if (total + r.cutSec > cfg.maxTotalSec + 1e-9) reject(`合計の上限${cfg.maxTotalSec}秒を超える`)
    else if (adopted.filter((a) => a.cutStartSec > r.cutStartSec - 60).length >= cfg.maxPerMinute) reject(`1分間に${cfg.maxPerMinute}回までの上限を超える`)
    else if (adopted.length && r.cutStartSec - adopted[adopted.length - 1].cutEndSec < cfg.minCutGapSec - 1e-9) reject(`前のカットとの間隔が${cfg.minCutGapSec}秒未満`)
    else {
      r.decision = 'adopt'
      adopted.push(r)
      total += r.cutSec
    }
  }
  return out
}

/** 集計（本文・絶対パスを含まない）。 */
export function summarizeCuts(rows, durationSec) {
  const adopted = rows.filter((r) => r.decision === 'adopt')
  const by = (c) => rows.filter((r) => r.class === c).length
  const totalCutSec = r3(adopted.reduce((a, r) => a + r.cutSec, 0))
  return {
    candidates: rows.length,
    safe: by(CLASS.SAFE),
    review: by(CLASS.REVIEW),
    forbidden: by(CLASS.FORBIDDEN),
    adopted: adopted.length,
    totalCutSec,
    maxCutSec: adopted.length ? Math.max(...adopted.map((r) => r.cutSec)) : 0,
    protectedMidWordGaps: rows.filter((r) => r.midWord).length,
    keptRatio: durationSec > 0 ? r3(1 - totalCutSec / durationSec) : 1,
  }
}
