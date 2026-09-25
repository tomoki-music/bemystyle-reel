// ローカルAIテロップ動画: 本編先頭の無音カット（ダイジェスト直後の無音を削る）。純粋関数のみ（ファイル・ffmpeg・外部AIには触れない）。
//
// 方針:
// - 「約2.18秒」のような報告値は固定しない。実音声のフレームごとの音量から、最初の発話（息・口の立ち上がりを含む）の開始を測る。
// - 削除するのは 0秒〜（発話開始 − 余白）。余白は 100〜150ms（100ms以上を残す向きで30fpsのフレーム境界へ切り下げ）。
// - 発話の子音・息の立ち上がりは削らない。判断できない（先頭から発話・雑音が続く／発話が見つからない）ときはカットしない。
// - 映像・音声を同じ時刻でカットする（editTimeMap の itemsFromCuts に渡す。先頭カットは元動画時刻 [0, cutEndSec)）。

import { floorToFrame } from './silenceCuts.mjs'

export const INTRO_CUT_DEFAULTS = Object.freeze({
  fps: 30,
  frameSec: 0.01, // 音量の測定フレーム（10ms）
  keepBeforeSpeechSec: 0.1, // 発話開始の前に残す余白の下限（100ms）。フレーム境界へ切り下げるので実際は100〜133ms
  maxKeepBeforeSpeechSec: 0.15, // 余白の上限（150ms）
  noiseWindowSec: 0.05, // 雑音床を測る先頭区間の開始（測定の最初の50msは除く）
  onsetAboveNoiseDb: 20, // 雑音床よりこれ以上大きいフレームを「音の立ち上がり」とする
  voiceAboveNoiseDb: 30, // 立ち上がりの直後にこれ以上大きいフレームがあれば「発話」（単発の雑音ではない）
  voiceWithinSec: 0.25, // 立ち上がりから発話とみなすまでの最大時間
  minCutSec: 0.3, // これ未満しか削れないなら意味がないのでカットしない
  maxCutSec: 5, // 安全上限（これを超える無音は人間の確認へ）
  scanLimitSec: 15, // 発話を探す範囲
})

const r3 = (v) => Math.round(v * 1000) / 1000
const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]
}

/**
 * 最初の発話の開始を測る。
 * @param {number[]} db フレームごとの音量(dB)。computeFrameDb の出力（int16スケール）
 * @param {number} frameSec フレーム長（秒）
 * @returns {{ ok: true, onsetSec: number, voiceSec: number, noiseFloorDb: number, onsetDb: number } | { ok: false, reason: string }}
 *   onsetSec: 息・口の立ち上がりを含む「音の開始」（発話の直前の最初の音）。voiceSec: 声そのものが立ち上がった時刻。
 */
export function findFirstSpeechOnset(db, frameSec, cfg = INTRO_CUT_DEFAULTS) {
  const n = Math.min(db.length, Math.floor(cfg.scanLimitSec / frameSec))
  if (n < 20) return { ok: false, reason: '測定できる音声が短すぎます' }
  // 雑音床: 先頭〜1秒の中央値（デジタル無音 -100dB 未満は除く）
  const head = db.slice(Math.round(cfg.noiseWindowSec / frameSec), Math.min(n, Math.round(1 / frameSec))).filter((v) => v > -100)
  if (head.length < 10) return { ok: false, reason: '雑音床を測れません（先頭が無音のみ）' }
  const noiseFloorDb = percentile(head, 0.5)
  const onsetThr = noiseFloorDb + cfg.onsetAboveNoiseDb
  const voiceThr = noiseFloorDb + cfg.voiceAboveNoiseDb
  const within = Math.ceil(cfg.voiceWithinSec / frameSec)
  for (let i = 0; i < n; i++) {
    if (db[i] < onsetThr) continue
    for (let k = i; k <= Math.min(n - 1, i + within); k++) {
      if (db[k] >= voiceThr) return { ok: true, onsetSec: r3(i * frameSec), voiceSec: r3(k * frameSec), noiseFloorDb: r3(noiseFloorDb), onsetDb: r3(db[i]) }
    }
  }
  return { ok: false, reason: '最初の発話を検出できません' }
}

/**
 * 先頭のカット範囲（元動画時刻 [0, cutEndSec)）を決める。
 * cutEndSec は「発話開始 − 100ms」を超えない最大の30fpsフレーム境界。発話の前に100〜150msの余白が残る。
 * @returns {{ ok: boolean, cutStartSec: 0, cutEndSec: number, cutSec: number, cutEndFrame: number, keepBeforeSpeechSec: number, onsetSec: number, reason?: string }}
 */
export function planIntroCut(onsetSec, cfg = INTRO_CUT_DEFAULTS) {
  const cutEndSec = floorToFrame(onsetSec - cfg.keepBeforeSpeechSec, cfg.fps) // 1/fps の倍数のまま（ミリ秒へ丸めない。48kHzで 1600サンプルの倍数）
  const keep = r3(onsetSec - cutEndSec)
  const base = { cutStartSec: 0, cutEndSec: Math.max(0, cutEndSec), cutSec: Math.max(0, cutEndSec), cutEndFrame: Math.max(0, Math.round(cutEndSec * cfg.fps)), keepBeforeSpeechSec: keep, onsetSec }
  if (cutEndSec < cfg.minCutSec) return { ...base, ok: false, reason: `削除できる先頭の無音が短い（${Math.max(0, cutEndSec)}秒）` }
  if (cutEndSec > cfg.maxCutSec) return { ...base, ok: false, reason: `先頭の無音が上限${cfg.maxCutSec}秒を超える（人間の確認が必要）` }
  if (keep < cfg.keepBeforeSpeechSec - 1e-6 || keep > cfg.maxKeepBeforeSpeechSec + 1e-6) return { ...base, ok: false, reason: `発話前の余白が100〜150msに収まりません（${Math.round(keep * 1000)}ms）` }
  return { ...base, ok: true }
}

/**
 * 保護の検証: カット範囲に発話・息の立ち上がりが含まれていないこと（カット範囲内の最大音量が雑音床＋onset閾値未満）。
 * @returns {{ ok: boolean, maxDbInCut: number, thresholdDb: number }}
 */
export function verifyIntroCutSilent(db, frameSec, cutEndSec, noiseFloorDb, cfg = INTRO_CUT_DEFAULTS) {
  const end = Math.floor(cutEndSec / frameSec + 1e-6)
  const inside = db.slice(0, end).filter((v) => v > -100)
  const maxDbInCut = inside.length ? Math.max(...inside) : -120
  const thresholdDb = noiseFloorDb + cfg.onsetAboveNoiseDb
  return { ok: maxDbInCut < thresholdDb, maxDbInCut: r3(maxDbInCut), thresholdDb: r3(thresholdDb) }
}

/**
 * 手動補完caption（source: 'manual-intro-recovery'）の検証。既存captionとは別管理で、既存を上書きしない。
 * 条件: source一致・確定済み（confirmed: true）・本文あり・時刻が単調で重ならない・既存の最初のcaptionより前で終わる・通常字幕・idが既存と重複しない。
 * @param {Array<{ id: string, text: string, startSec: number, endSec: number, source?: string, confirmed?: boolean, captionType?: string }>} recovered
 * @param {Array<{ id: string, startSec: number }>} existing 既存の正本caption（元動画時刻）
 */
export function validateRecoveredCaptions(recovered, existing) {
  const problems = []
  const firstExisting = existing.length ? Math.min(...existing.map((c) => c.startSec)) : Infinity
  const existingIds = new Set(existing.map((c) => c.id))
  recovered.forEach((c, i) => {
    if (c.source !== 'manual-intro-recovery') problems.push(`#${i}: source が manual-intro-recovery ではありません`)
    if (c.confirmed !== true) problems.push(`#${i}: 文言が確定していません（confirmed: true のものだけ使用できます）`)
    if (!String(c.text ?? '').trim()) problems.push(`#${i}: 本文が空です`)
    if (!(c.endSec > c.startSec)) problems.push(`#${i}: 終了が開始より後ではありません`)
    if (existingIds.has(c.id)) problems.push(`#${i}: 既存captionとidが重複しています`)
    if (c.endSec > firstExisting + 1e-6) problems.push(`#${i}: 既存の最初のcaptionと時刻が重なっています`)
    if (i > 0 && c.startSec < recovered[i - 1].endSec - 1e-6) problems.push(`#${i}: 前の補完captionと重なっています`)
    if ((c.captionType ?? 'normal') !== 'normal') problems.push(`#${i}: 通常字幕（normal）以外は使えません`)
  })
  return { ok: problems.length === 0, problems }
}
