import { describe, it, expect } from 'vitest'
import { findFirstSpeechOnset, planIntroCut, verifyIntroCutSilent, validateRecoveredCaptions, INTRO_CUT_DEFAULTS } from './introCut.mjs'

// 合成のフレーム音量（10ms/フレーム）: 0〜silenceSec は雑音床（-63dB前後）、onsetSec に息（-35dB）、voiceSec から声（-27dB）
const frames = ({ silenceSec = 2.19, breathFrames = 10, voiceSec = 2.3, totalSec = 8, noise = -63, spikeAt = null }) => {
  const n = Math.round(totalSec / 0.01)
  const db = Array.from({ length: n }, (_, i) => noise + ((i * 7) % 5) * 0.5 - 1)
  db[0] = -120 // 先頭のデジタル無音
  db[1] = -120
  const s = Math.round(silenceSec / 0.01)
  for (let i = s; i < s + breathFrames; i++) db[i] = i === s ? -35 : -55
  for (let i = Math.round(voiceSec / 0.01); i < n; i++) db[i] = -27 + ((i * 3) % 4)
  if (spikeAt !== null) db[Math.round(spikeAt / 0.01)] = -48 // 単発の雑音（声ではない）
  return db
}

describe('先頭の発話開始の測定', () => {
  it('息の立ち上がり（発話の直前）を、発話開始として検出する（声そのものではなく最初の音）', () => {
    const r = findFirstSpeechOnset(frames({}), 0.01)
    expect(r.ok).toBe(true)
    expect(r.onsetSec).toBeCloseTo(2.19, 2)
    expect(r.voiceSec).toBeCloseTo(2.3, 2)
  })
  it('報告値（約2.18秒）に依存しない: 無音の長さが違っても、実際の音声から開始を測る', () => {
    for (const s of [0.9, 1.5, 2.19, 3.4, 4.75]) {
      const r = findFirstSpeechOnset(frames({ silenceSec: s, voiceSec: s + 0.11 }), 0.01)
      expect(r.ok).toBe(true)
      expect(r.onsetSec).toBeCloseTo(s, 2)
    }
  })
  it('単発の小さな雑音（声に続かない）は発話とみなさない', () => {
    const r = findFirstSpeechOnset(frames({ spikeAt: 0.6 }), 0.01)
    expect(r.onsetSec).toBeCloseTo(2.19, 2)
  })
  it('発話が見つからなければ失敗する（カットしない）', () => {
    const db = Array.from({ length: 800 }, () => -63)
    expect(findFirstSpeechOnset(db, 0.01).ok).toBe(false)
  })
})

describe('先頭カット点の決定', () => {
  it('発話開始の前に100〜150msの余白を残し、30fpsのフレーム境界（48kHzで1600サンプルの倍数）に合う', () => {
    const p = planIntroCut(2.19)
    expect(p.ok).toBe(true)
    expect(p.keepBeforeSpeechSec).toBeGreaterThanOrEqual(0.1)
    expect(p.keepBeforeSpeechSec).toBeLessThanOrEqual(0.15)
    expect(p.cutEndFrame).toBe(62)
    expect(p.cutEndSec).toBeCloseTo(62 / 30, 10)
    expect(Math.round(p.cutEndSec * 48000)).toBe(99200)
    expect(Math.round(p.cutEndSec * 48000) % 1600).toBe(0)
  })
  it('最初の発話を切らない: どの発話位置でも、カット終了は 発話開始−100ms 以下・1フレーム以内の余裕', () => {
    for (let onset = 0.5; onset < 6; onset += 0.0137) {
      const p = planIntroCut(Math.round(onset * 100) / 100)
      if (!p.ok) continue
      expect(p.cutEndSec).toBeLessThanOrEqual(p.onsetSec - 0.1 + 1e-9)
      expect(p.cutEndSec).toBeGreaterThan(p.onsetSec - 0.1 - 1 / 30 - 1e-9)
      expect(p.keepBeforeSpeechSec).toBeLessThanOrEqual(0.15)
    }
  })
  it('削除できる無音が短い・長すぎる場合はカットしない（人間の確認へ）', () => {
    expect(planIntroCut(0.3).ok).toBe(false)
    expect(planIntroCut(9).ok).toBe(false)
  })
  it('カット範囲は先頭の無音だけ: 範囲内に息・声が含まれない。範囲外（発話以降）は含まれる', () => {
    const db = frames({})
    const r = findFirstSpeechOnset(db, 0.01)
    const p = planIntroCut(r.onsetSec)
    expect(verifyIntroCutSilent(db, 0.01, p.cutEndSec, r.noiseFloorDb).ok).toBe(true)
    // カット終了を発話開始より後ろへ動かすと、検証が失敗する（=発話を切る）
    expect(verifyIntroCutSilent(db, 0.01, r.onsetSec + 0.05, r.noiseFloorDb).ok).toBe(false)
  })
})

describe('手動補完caption（manual-intro-recovery）の検証', () => {
  const existing = [{ id: 'full-0000', startSec: 7.11 }]
  const good = (o = {}) => ({ id: 'intro-0', text: 'こんにちは', startSec: 2.3, endSec: 3, source: 'manual-intro-recovery', confirmed: true, captionType: 'normal', ...o })
  it('確定済み・別source・既存より前・重ならない補完captionは有効', () => {
    expect(validateRecoveredCaptions([good(), good({ id: 'intro-1', startSec: 3, endSec: 5 })], existing).ok).toBe(true)
  })
  it('未確定（推測）の文言・別source・既存captionと重複・時刻重なり・空本文は拒否する', () => {
    expect(validateRecoveredCaptions([good({ confirmed: false })], existing).ok).toBe(false)
    expect(validateRecoveredCaptions([good({ source: 'ai' })], existing).ok).toBe(false)
    expect(validateRecoveredCaptions([good({ id: 'full-0000' })], existing).ok).toBe(false)
    expect(validateRecoveredCaptions([good({ endSec: 7.5 })], existing).ok).toBe(false)
    expect(validateRecoveredCaptions([good(), good({ id: 'x', startSec: 2.9, endSec: 3.5 })], existing).ok).toBe(false)
    expect(validateRecoveredCaptions([good({ text: ' ' })], existing).ok).toBe(false)
    expect(validateRecoveredCaptions([good({ captionType: 'emphasis' })], existing).ok).toBe(false)
  })
  it('既存captionを変更しない（入力配列を破壊しない）', () => {
    const before = JSON.stringify(existing)
    validateRecoveredCaptions([good()], existing)
    expect(JSON.stringify(existing)).toBe(before)
    expect(INTRO_CUT_DEFAULTS.fps).toBe(30)
  })
})
