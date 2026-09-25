// ローカルAIテロップ動画: ダイジェスト最後のクリップの「最後の発話と余韻」を確保する。純粋関数のみ。
//
// 目的: ダイジェストが次の文の頭（「まず…」の途中）で切れて尻切れに聞こえるのを避け、最後の発話を語尾まで入れ、
// その後に短い余韻（250〜400ms）を置く。余韻の後ろに次の発話が始まるまで余裕が無いときは、次の発話の直前（ガード）で止める。
// 最後のクリップだけを延ばす/縮める（クリップの内容・選択・字幕本文・強調は変えない）。

const r3 = (v) => Math.round(v * 1000) / 1000
const floorF = (s, fps) => Math.floor(s * fps + 1e-6) / fps

export const DIGEST_TAIL_DEFAULTS = Object.freeze({
  fps: 30,
  minAfterSpeechSec: 0.25, // 最後の発話が終わってから、クリップが終わるまで（余韻）の下限
  maxAfterSpeechSec: 0.4, // 上限
  guardSec: 0.02, // 次の発話の始まりの手前に残す余裕
  quietDb: -50, // 無音とみなす音量（20msフレームのdBFS。部屋の雑音は約-60dB、弱い語尾は-45dB前後）
  minPauseSec: 0.2, // 「文の切れ目の間」とみなす無音の長さ（語中の一瞬の谷は除く）
})

/**
 * 最後の文の終わり（発話終了）と、次の発話の始まりを、音量から決める。
 * fromSec〜toSec の中で、quietDb 未満が minPauseSec 以上続く最初の区間を文の切れ目の間とし、その開始 = 発話終了、その終了 = 次の発話の始まり。
 * @param {ArrayLike<number>} db 20msなどの固定フレームのdBFS @param {number} frameSec @param {{ fromSec: number, toSec: number }} range 元動画の秒（db の先頭が t=originSec）
 * @returns {{ ok: boolean, speechEndSec?: number, nextSpeechStartSec?: number, pauseSec?: number, reason?: string }}
 */
export function findSentenceEndPause(db, frameSec, { originSec = 0, fromSec, toSec, quietDb = DIGEST_TAIL_DEFAULTS.quietDb, minPauseSec = DIGEST_TAIL_DEFAULTS.minPauseSec }) {
  const a = Math.max(0, Math.round((fromSec - originSec) / frameSec))
  const b = Math.min(db.length - 1, Math.round((toSec - originSec) / frameSec))
  let start = -1
  for (let i = a; i <= b; i++) {
    if (db[i] < quietDb) {
      if (start < 0) start = i
    } else if (start >= 0) {
      if ((i - start) * frameSec >= minPauseSec - 1e-9) return { ok: true, speechEndSec: r3(originSec + start * frameSec), nextSpeechStartSec: r3(originSec + i * frameSec), pauseSec: r3((i - start) * frameSec) }
      start = -1
    }
  }
  return { ok: false, reason: '文の切れ目の間（最後の発話の後の無音）を検出できません' }
}

/**
 * 最後のクリップの終了点を決める: 発話終了 + 余韻（既定 250〜400ms。狙いは maxAfter 側）を、次の発話の直前（ガード）とフレーム境界に収める。
 * @param {{ speechEndSec: number, nextSpeechStartSec: number | null, clipStartSec: number }} p
 * @returns {{ ok: boolean, srcEndSec?: number, durationSec?: number, afterSpeechSec?: number, marginToNextSec?: number | null, reason?: string }}
 */
export function planDigestTail(p, config = DIGEST_TAIL_DEFAULTS) {
  const fps = config.fps
  const limit = p.nextSpeechStartSec === null || p.nextSpeechStartSec === undefined ? Infinity : p.nextSpeechStartSec - config.guardSec
  const want = p.speechEndSec + config.maxAfterSpeechSec
  const srcEndSec = floorF(Math.min(want, limit), fps)
  const afterSpeechSec = r3(srcEndSec - p.speechEndSec)
  if (afterSpeechSec < config.minAfterSpeechSec - 1e-9) return { ok: false, reason: `最後の発話の後に余韻（${config.minAfterSpeechSec}秒）を確保できません（次の発話まで ${r3(limit - p.speechEndSec)}秒）` }
  if (afterSpeechSec > config.maxAfterSpeechSec + 1e-9) return { ok: false, reason: '余韻が長すぎます' }
  const start = p.clipStartSec
  return { ok: true, srcEndSec: r3(srcEndSec), durationSec: r3(srcEndSec - start), afterSpeechSec, marginToNextSec: p.nextSpeechStartSec === null || p.nextSpeechStartSec === undefined ? null : r3(p.nextSpeechStartSec - srcEndSec) }
}

/** クリップ列の最後だけ、終了点を差し替える（開始・順序・選択・強調は変えない）。 */
export function withDigestTail(clips, tail) {
  return clips.map((c, i) => (i === clips.length - 1 ? { ...c, srcEndSec: tail.srcEndSec, durationSec: r3(tail.srcEndSec - c.srcStartSec) } : c))
}

