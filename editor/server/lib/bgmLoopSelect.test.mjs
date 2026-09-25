import { describe, it, expect } from 'vitest'
import { fft, analyzeBgm, scoreLoopStarts, topDistinct, measureLoopBoundary } from './bgmLoopSelect.mjs'

const SR = 24000
// 合成の「曲」: 0.5秒ごとの拍（減衰する低音）＋持続する和音。先頭 fadeSec は音量が小さい（曲頭の静かな部分）
function song(sec, { fadeSec = 6, beat = 0.5, sr = SR } = {}) {
  const x = new Float32Array(Math.round(sec * sr))
  for (let i = 0; i < x.length; i++) {
    const t = i / sr
    const ph = (t % beat) / beat
    const kick = Math.exp(-ph * 9) * Math.sin(2 * Math.PI * 90 * t)
    const pad = 0.15 * Math.sin(2 * Math.PI * 330 * t) + 0.1 * Math.sin(2 * Math.PI * 495 * t)
    const g = fadeSec > 0 ? 0.15 + 0.85 * Math.min(1, t / fadeSec) : 1
    x[i] = g * (0.6 * kick + pad)
  }
  return x
}

describe('bgmLoopSelect: FFT・解析', () => {
  it('FFT: 単一の正弦波は該当ビンにピークが立つ', () => {
    const n = 256
    const re = new Float64Array(n).map((_, i) => Math.sin((2 * Math.PI * 16 * i) / n))
    const im = new Float64Array(n)
    fft(re, im)
    const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]))
    const peak = mag.indexOf(Math.max(...mag.slice(0, n / 2)))
    expect(peak).toBe(16)
  })
})

describe('bgmLoopSelect: ループ開始点の選定', () => {
  const L = 60
  const an = analyzeBgm(song(L), SR)
  const scored = scoreLoopStarts(an, { lengthSec: L, crossfadeSec: 2, fromSec: 4, toSec: 30 })
  it('4秒以降の候補だけを比べる（曲頭の静かな部分は選ばない）。拍が合う開始点を選ぶ', () => {
    expect(scored.length).toBeGreaterThan(1000)
    expect(Math.min(...scored.map((c) => c.startSec))).toBeGreaterThanOrEqual(4)
    const best = scored[0]
    expect(best.startSec).toBeGreaterThanOrEqual(7) // [開始点−2秒, 開始点] が曲頭の小さい音（0〜6秒）にかからない
    expect(best.beatCorr).toBeGreaterThan(0.9)
    const phase = best.startSec % 0.5 // 曲末（60秒＝拍の整数倍）と同じ拍の位相
    expect(Math.min(phase, 0.5 - phase)).toBeLessThan(0.04)
    expect(best.levelDiffDb).toBeLessThan(1.5)
  })
  it('拍が半拍ずれた開始点は、ずれのない開始点よりスコアが低い', () => {
    const best = scored[0]
    const off = scored.find((c) => Math.abs(c.startSec - (best.startSec + 0.25)) < 0.006)
    expect(off).toBeTruthy()
    expect(off.beatCorr).toBeLessThan(best.beatCorr - 0.3)
    expect(off.score).toBeLessThan(best.score)
  })
  it('曲頭の静かな区間にかかる候補は音量差が大きく評価される', () => {
    const early = scored.find((c) => Math.abs(c.startSec - 4.5) < 0.011)
    expect(early.levelDiffDb).toBeGreaterThan(2)
    expect(early.score).toBeLessThan(scored[0].score)
  })
  it('topDistinct: 隣り合う同じ山の候補を除く', () => {
    const top = topDistinct(scored, 6, 0.5)
    expect(top.length).toBe(6)
    for (let i = 1; i < top.length; i++) for (let j = 0; j < i; j++) expect(Math.abs(top[i].startSec - top[j].startSec)).toBeGreaterThanOrEqual(0.5)
  })
})

describe('bgmLoopSelect: ループ境界の測定', () => {
  const SR48 = 48000
  const sine = (sec, amp = 0.5, f = 440) => Float32Array.from({ length: Math.round(sec * SR48) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR48))
  it('連続した波形（ちょうど整数周期）は、音量差0・クリックなし', () => {
    const m = measureLoopBoundary(sine(20), SR48, 2)
    expect(m.levelDiffDb).toBeLessThan(0.1)
    expect(m.level500msDiffDb).toBeLessThan(0.1)
    expect(m.maxStepRatio).toBeLessThan(1.5)
    expect(Math.abs(m.xfadeLevelDb)).toBeLessThan(0.5)
  })
  it('終端と先頭の値が飛ぶとクリックとして検出する', () => {
    const u = sine(20)
    u[u.length - 1] = 0.9
    u[u.length - 2] = 0.9
    const m = measureLoopBoundary(u, SR48, 2)
    expect(m.maxStepRatio).toBeGreaterThan(1.5)
  })
  it('境界の前後で音量が違うと音量差として出る', () => {
    const u = sine(20)
    for (let i = u.length - SR48; i < u.length; i++) u[i] *= 0.25 // 最後の1秒だけ -12dB
    const m = measureLoopBoundary(u, SR48, 2)
    expect(m.levelDiffDb).toBeGreaterThan(9)
    expect(m.level500msDiffDb).toBeGreaterThan(9)
  })
})
