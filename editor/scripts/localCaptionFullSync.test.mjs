import { describe, it, expect } from 'vitest'
import { audioDelay } from './localCaptionFullSync.mjs'

// 決定的な擬似乱数（テストを再現可能にする）
function noise(n, seed = 1) {
  let s = seed
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    a[i] = ((s / 0xffffffff) - 0.5) * 0.4
  }
  return a
}
const delayed = (src, d) => Float64Array.from(src, (_, i) => src[i - d] ?? 0)

describe('audioDelay: 出力音声が元より遅れた/先行したサンプル数を測る', () => {
  const src = noise(16000 * 3)
  it('遅れなし → 0', () => {
    const r = audioDelay(src, src)
    expect(r.ok).toBe(true)
    expect(r.delaySamples).toBeCloseTo(0, 1)
    expect(r.corr).toBeGreaterThan(0.99)
  })
  it('1067サンプル（元動画の音声開始offset 66.7ms）先行 → 負の値（旧レンダーの症状）', () => {
    const r = audioDelay(delayed(src, -1067), src)
    expect(r.delaySamples).toBeCloseTo(-1067, 1)
    expect(r.delayMs).toBeCloseTo(-66.69, 1)
  })
  it('遅れ → 正の値', () => {
    const r = audioDelay(delayed(src, 320), src)
    expect(r.delaySamples).toBeCloseTo(320, 1)
    expect(r.delayMs).toBeCloseTo(20, 1)
  })
  it('短すぎる入力は測れない（ok=false）', () => {
    expect(audioDelay(noise(8000), noise(8000)).ok).toBe(false)
  })
})
