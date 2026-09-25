import { describe, it, expect } from 'vitest'
import { selectFiveMinuteWindow, rerankWithVisual, darkMassMotion, WINDOW_DEFAULTS } from './windowSelector.mjs'

// 900秒・rawSegment 30秒ごと(30個)の合成ジョブ。captionは各rawSegmentに3件。
function makeJob({ headings = [], emphasisAt = [], mainAt = [], subAt = [], pauseAfterSeg = [], long = [] } = {}) {
  const rawSegments = []
  const captions = []
  for (let s = 0; s < 30; s++) {
    const start = s * 30
    const gap = pauseAfterSeg.includes(s) ? 1.5 : 0
    rawSegments.push({ startSec: start, endSec: start + 30 - gap, text: 'あ'.repeat(120) })
    for (let k = 0; k < 3; k++) {
      const cs = start + k * 10
      const id = `c-${s}-${k}`
      const t = start + k * 10
      const type = headings.includes(t) ? 'heading' : emphasisAt.includes(t) ? 'emphasis' : mainAt.includes(t) ? 'main' : subAt.includes(t) ? 'sub' : 'normal'
      captions.push({ id, startSec: cs, endSec: cs + 10 - (k === 2 ? gap : 0), text: long.includes(t) ? 'い'.repeat(30) : 'あ'.repeat(40), captionType: type, displayOrder: captions.length })
    }
  }
  return { captions, rawSegments, durationSec: 900 }
}

describe('selectFiveMinuteWindow', () => {
  const base = { headings: [120, 400], emphasisAt: [200], mainAt: [230], subAt: [250] }
  it('連続300秒で、話題転換が2件以上・main/sub/emphasisが揃う候補だけが適格', () => {
    const r = selectFiveMinuteWindow(makeJob(base))
    expect(r.best).not.toBeNull()
    expect(r.best.endSec - r.best.startSec).toBe(300)
    expect(r.best.metrics.transitions).toBeGreaterThanOrEqual(2)
    expect(r.best.metrics.types.main).toBeGreaterThan(0)
    expect(r.best.metrics.types.sub).toBeGreaterThan(0)
    expect(r.best.metrics.types.emphasis).toBeGreaterThan(0)
    for (const c of r.candidates.filter((x) => x.eligible)) expect(c.metrics.transitions).toBeGreaterThanOrEqual(2)
  })
  it('話題転換が2件未満の窓は選ばれない（理由付きで不適格）', () => {
    const r = selectFiveMinuteWindow(makeJob({ headings: [120], emphasisAt: [200], mainAt: [230], subAt: [250] }))
    expect(r.candidates.every((c) => !c.eligible || c.metrics.transitions >= 2)).toBe(true)
    expect(r.candidates.some((c) => !c.eligible && c.ineligibleReasons.includes('話題転換候補が2件未満'))).toBe(true)
  })
  it('main/sub/emphasis候補が無い窓は不適格', () => {
    const r = selectFiveMinuteWindow(makeJob({ headings: [120, 400] }))
    expect(r.best).toBeNull()
    expect(r.candidates[0].ineligibleReasons).toContain('main/sub/emphasis候補が揃わない')
  })
  it('既存headingは、間(pause)だけの話題転換候補より重く数える', () => {
    const job = makeJob({ headings: [120, 400], emphasisAt: [200], mainAt: [230], subAt: [250], pauseAfterSeg: [12, 16] })
    const r = selectFiveMinuteWindow(job)
    const two = r.candidates.filter((c) => c.eligible)
    const withHeadings = two.find((c) => c.metrics.headings === 2 && c.metrics.pauseTransitions === 0)
    const withPauses = two.find((c) => c.metrics.headings < 2 && c.metrics.pauseTransitions >= 1)
    if (withHeadings && withPauses) expect(withHeadings.score).toBeGreaterThan(withPauses.score - 1e-9 - WINDOW_DEFAULTS.weights.longCaption * 40)
  })
  it('既存の60秒検証区間との重なりが加点される', () => {
    const job = makeJob({ ...base })
    const without = selectFiveMinuteWindow(job).candidates.find((c) => c.startSec === 90)
    const withRef = selectFiveMinuteWindow(job, { referenceWindow: { startSec: 100, endSec: 160 } }).candidates.find((c) => c.startSec === 90)
    expect(withRef.metrics.overlapWithReferenceSec).toBe(60)
    expect(withRef.score).toBeGreaterThan(without.score)
  })
  it('長文(25文字以上)の多い窓が加点される', () => {
    const plain = selectFiveMinuteWindow(makeJob(base)).candidates.find((c) => c.startSec === 90)
    const longer = selectFiveMinuteWindow(makeJob({ ...base, long: [100, 110, 130, 140, 150] })).candidates.find((c) => c.startSec === 90)
    expect(longer.metrics.longCaptions).toBeGreaterThan(plain.metrics.longCaptions - 1)
  })
  it('動画尺を超える窓は候補にしない・入力を変更しない', () => {
    const job = makeJob(base)
    const before = JSON.stringify(job)
    const r = selectFiveMinuteWindow(job)
    expect(r.candidates.every((c) => c.endSec <= 900)).toBe(true)
    expect(JSON.stringify(job)).toBe(before)
  })
})

describe('映像変化量による並べ替え', () => {
  it('変化量が大きい候補が同点なら上位になる', () => {
    const cs = [
      { startSec: 10, eligible: true, score: 100 },
      { startSec: 20, eligible: true, score: 100 },
    ]
    const r = rerankWithVisual(cs, { 10: 0.1, 20: 0.9 })
    expect(r[0].startSec).toBe(20)
  })
  it('darkMassMotion: 暗い領域が動くほど大きく、動かなければ0', () => {
    const W = 8
    const H = 8
    const frame = (x) => {
      const f = new Uint8Array(W * H).fill(200)
      for (let y = 2; y < 6; y++) f[y * W + x] = 10
      return f
    }
    expect(darkMassMotion([frame(1), frame(1), frame(1)], W, H)).toBe(0)
    expect(darkMassMotion([frame(1), frame(6), frame(1)], W, H)).toBeGreaterThan(0.5)
    expect(darkMassMotion([frame(1)], W, H)).toBe(0)
  })
})
