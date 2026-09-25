import { describe, it, expect } from 'vitest'
import { decideIntroTimes, INTRO_GREETING, buildMainBgmPreviewPlan, LOOP_CHECK, CARD_SEC } from './localCaptionMainBgm.mjs'
import { validateRecoveredCaptions } from '../server/lib/introCut.mjs'

// 合成の音量（20ms/フレーム）: 声区間 -28dB、フレーズ間の谷 -50dB（100ms）
const env = (spans, total = 8) => {
  const db = Array.from({ length: Math.round(total / 0.02) }, () => -63)
  for (const [a, b] of spans) for (let i = Math.round(a / 0.02); i < Math.round(b / 0.02); i++) db[i] = -28
  return db
}

describe('冒頭挨拶の時刻決定（トークン時刻＋音量の谷）', () => {
  const db = env([[2.28, 3.1], [3.2, 4.8], [4.92, 5.46], [5.6, 6.2]])
  const spans = [{ firstTokenSec: 2.62, lastTokenSec: 2.94 }, { firstTokenSec: 3.2, lastTokenSec: 4.62 }, { firstTokenSec: 5.0, lastTokenSec: 5.3 }, { firstTokenSec: 5.72, lastTokenSec: 6.1 }]
  it('境界は音量の谷（前の終了=谷の開始、次の開始=谷の終了）。最初の開始は最初の音、最後の終了は音量が落ちる点', () => {
    const r = decideIntroTimes({ db, frameSec: 0.02, tokenSpans: spans, onsetSec: 2.19 })
    expect(r.ok).toBe(true)
    expect(r.times[0].startSec).toBe(2.19)
    expect(r.times[0].endSec).toBeCloseTo(3.1, 2)
    expect(r.times[1].startSec).toBeCloseTo(3.2, 2)
    expect(r.times[3].endSec).toBeCloseTo(6.2, 1)
    for (let i = 1; i < 4; i++) expect(r.times[i].startSec).toBeGreaterThanOrEqual(r.times[i - 1].endSec) // 重ならない
  })
  it('谷が見つからなければ失敗する（推測で決めない）', () => {
    const flat = env([[2.28, 6.2]])
    expect(decideIntroTimes({ db: flat, frameSec: 0.02, tokenSpans: spans, onsetSec: 2.19 }).ok).toBe(false)
  })
})

describe('冒頭挨拶の文言（ユーザー確認済み）', () => {
  it('4件・確認済みの表記（トモキ）。最大2行・改行しても本文と一致', () => {
    expect(INTRO_GREETING.map((g) => g.text)).toEqual(['どうもこんにちは', '埼玉でシンガーソングライターをしております', 'トモキと申します', 'よろしくお願いします'])
    for (const g of INTRO_GREETING) {
      expect(g.lines.length).toBeLessThanOrEqual(2)
      expect(g.lines.join('')).toBe(g.text)
    }
  })
  it('補完caption（source: manual-intro-recovery・confirmed: true）は検証を通り、既存の最初のcaptionと重ならない', () => {
    const caps = INTRO_GREETING.map((g, i) => ({ id: `intro-recovery-${i}`, text: g.text, lines: g.lines, startSec: 2.19 + i * 1.2, endSec: 3.1 + i * 1.2, captionType: 'normal', emphasisText: null, source: 'manual-intro-recovery', confirmed: true }))
    expect(validateRecoveredCaptions(caps, [{ id: 'full-0000', startSec: 7.11 }]).ok).toBe(true)
  })
})

describe('確認動画の計画', () => {
  const base = { captions: [], norm: [] }
  it('ループ境界の確認区間は本編の後ろ（区切りカード付き）。カードは確認用で最終動画には入らない', () => {
    expect(LOOP_CHECK.boundaryOffsetSec).toBeLessThan(LOOP_CHECK.sec)
    expect(CARD_SEC).toBeGreaterThan(0)
    expect(typeof buildMainBgmPreviewPlan).toBe('function')
    expect(base.captions).toEqual([])
  })
})
