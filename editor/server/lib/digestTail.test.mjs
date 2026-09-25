import { describe, it, expect } from 'vitest'
import { findSentenceEndPause, planDigestTail, withDigestTail, DIGEST_TAIL_DEFAULTS } from './digestTail.mjs'

// 20ms/フレームの合成音量: 発話 -30dB、無音 -60dB
const env = (spans, total = 10) => {
  const db = Array.from({ length: Math.round(total / 0.02) }, () => -60)
  for (const [a, b] of spans) for (let i = Math.round(a / 0.02); i < Math.round(b / 0.02); i++) db[i] = -30
  return db
}

describe('ダイジェスト末尾: 文の切れ目の間の検出', () => {
  it('最後の発話の終わり（無音の始まり）と、次の発話の始まり（無音の終わり）を返す。語中の短い谷は無視する', () => {
    // 発話 0〜3.0、0.06秒の谷、3.06〜5.0、無音 5.0〜5.32、次の発話 5.32〜
    const db = env([[0, 3.0], [3.06, 5.0], [5.32, 8]])
    const r = findSentenceEndPause(db, 0.02, { originSec: 0, fromSec: 1, toSec: 9 })
    expect(r.ok).toBe(true)
    expect(r.speechEndSec).toBe(5)
    expect(r.nextSpeechStartSec).toBe(5.32)
    expect(r.pauseSec).toBe(0.32)
  })
  it('元動画の時刻（originSec）へ変換する', () => {
    const db = env([[0, 2], [2.4, 6]], 6)
    const r = findSentenceEndPause(db, 0.02, { originSec: 743, fromSec: 743.5, toSec: 749 })
    expect(r.speechEndSec).toBe(745)
    expect(r.nextSpeechStartSec).toBe(745.4)
  })
  it('長い無音が無ければ失敗する（推測で決めない）', () => {
    const db = env([[0, 3.0], [3.1, 8]])
    expect(findSentenceEndPause(db, 0.02, { fromSec: 1, toSec: 9 }).ok).toBe(false)
  })
})

describe('ダイジェスト末尾: 余韻の確保', () => {
  it('実測（発話終了 744.68・次の発話 745.00）: 次の発話の直前で止め、余韻は250〜400ms。フレーム境界', () => {
    const t = planDigestTail({ speechEndSec: 744.68, nextSpeechStartSec: 745, clipStartSec: 739.9 })
    expect(t.ok).toBe(true)
    expect(t.afterSpeechSec).toBeGreaterThanOrEqual(0.25)
    expect(t.afterSpeechSec).toBeLessThanOrEqual(0.4)
    expect(t.srcEndSec).toBeLessThan(745 - DIGEST_TAIL_DEFAULTS.guardSec + 1e-9) // 次の発話（「まず…」）へ食い込まない
    expect(Math.abs(t.srcEndSec * 30 - Math.round(t.srcEndSec * 30))).toBeLessThan(0.05) // 30fpsのフレーム境界（ミリ秒へ丸めた値）
    expect(t.durationSec).toBeCloseTo(t.srcEndSec - 739.9, 3)
    expect(t.marginToNextSec).toBeGreaterThan(0)
  })
  it('次の発話まで十分あるときは、上限（400ms）までにとどめる', () => {
    const t = planDigestTail({ speechEndSec: 100, nextSpeechStartSec: 103, clipStartSec: 96 })
    expect(t.ok).toBe(true)
    expect(t.afterSpeechSec).toBeLessThanOrEqual(0.4)
    expect(t.afterSpeechSec).toBeGreaterThan(0.36)
  })
  it('次の発話がない（末尾）でも余韻を付けられる', () => {
    expect(planDigestTail({ speechEndSec: 100, nextSpeechStartSec: null, clipStartSec: 96 }).ok).toBe(true)
  })
  it('次の発話までが短すぎて余韻250msを確保できないときは失敗する（発話を切って余韻を作らない）', () => {
    const t = planDigestTail({ speechEndSec: 100, nextSpeechStartSec: 100.2, clipStartSec: 96 })
    expect(t.ok).toBe(false)
    expect(t.reason).toContain('余韻')
  })
  it('最後のクリップだけ終了点を差し替える（開始・順序・選択・強調・最初のクリップは変えない）', () => {
    const clips = [
      { firstIndex: 226, lastIndex: 227, srcStartSec: 417.5, srcEndSec: 422.267, durationSec: 4.767, themeId: 't5', emphasis: { captionIndex: 226, text: 'あ' } },
      { firstIndex: 398, lastIndex: 400, srcStartSec: 739.9, srcEndSec: 745.2, durationSec: 5.3, themeId: 't8', emphasis: { captionIndex: 400, text: 'い' } },
    ]
    const out = withDigestTail(clips, { srcEndSec: 744.967 })
    expect(out[0]).toEqual(clips[0])
    expect(out[1]).toEqual({ ...clips[1], srcEndSec: 744.967, durationSec: 5.067 })
    expect(clips[1].srcEndSec).toBe(745.2) // 元の配列は変更しない
  })
})
