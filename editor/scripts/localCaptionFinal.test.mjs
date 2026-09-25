import { describe, it, expect } from 'vitest'
import { APPROVED, FINAL_MIN_FREE_BYTES, FINAL_ABORT_FREE_BYTES, titleSpans, spanCheck } from './localCaptionFinal.mjs'
import { MAIN_BGM_DUCK, MAIN_BGM_DEFAULTS, MAIN_BGM_LIMITER } from '../server/lib/mainBgm.mjs'
import { buildMainBgmPreviewPlan } from './localCaptionMainBgm.mjs'
import { introCutItems } from '../server/lib/mainEdit.mjs'

const ass = (rows) => rows.map(([a, b]) => `Dialogue: 5,${t(a)},${t(b)},TopicTitle,,0,0,0,,x`).join('\n')
const t = (sec) => { const cs = Math.round(sec * 100); const p = (n) => String(n).padStart(2, '0'); return `0:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}` }

describe('最終版: 承認済みの固定値', () => {
  it('BGM・ダッキング・リミッターの承認値が実装の既定と一致する', () => {
    expect(MAIN_BGM_DEFAULTS.volume).toBe(APPROVED.mainBgm.volume)
    expect(MAIN_BGM_DEFAULTS.fadeInSec).toBe(APPROVED.mainBgm.fadeInSec)
    expect(MAIN_BGM_DEFAULTS.fadeOutSec).toBe(APPROVED.mainBgm.fadeOutSec)
    for (const [k, v] of Object.entries(APPROVED.duck)) expect(MAIN_BGM_DUCK[k]).toBe(v)
    expect(MAIN_BGM_LIMITER.limit).toBe(APPROVED.limiterLimit)
  })
  it('開始前15GB・実行中10GBの空き容量しきい値', () => {
    expect(FINAL_MIN_FREE_BYTES).toBe(15 * 1024 ** 3)
    expect(FINAL_ABORT_FREE_BYTES).toBe(10 * 1024 ** 3)
  })
})

describe('トークテーマの常時表示チェック', () => {
  it('連続していれば未表示0・重複0、隙間や重なりは検出する', () => {
    const ok = titleSpans(ass([[0, 10], [10, 20], [20, 30]]))
    expect(spanCheck(ok, 0, 30)).toEqual({ titles: 3, gapSec: 0, overlapSec: 0 })
    const gap = titleSpans(ass([[0, 10], [12, 30]]))
    expect(spanCheck(gap, 0, 30).gapSec).toBeCloseTo(2, 1)
    const overlap = titleSpans(ass([[0, 12], [10, 30]]))
    expect(spanCheck(overlap, 0, 30).overlapSec).toBeCloseTo(2, 1)
  })
})

describe('全編用の本編項目（fullItems）', () => {
  it('introCutItems の項目をそのまま使い、確認動画用の45秒抜き出しにならない', () => {
    const full = introCutItems(916.62, 62 / 30, 30)
    expect(full.items).toHaveLength(1)
    expect(full.items[0].srcStartSec).toBeCloseTo(62 / 30, 6)
    expect(full.items[0].srcEndSec - full.items[0].srcStartSec).toBeGreaterThan(900)
    expect(typeof buildMainBgmPreviewPlan).toBe('function')
  })
})
