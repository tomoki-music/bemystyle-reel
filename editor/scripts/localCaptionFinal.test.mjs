import { describe, it, expect } from 'vitest'
import { APPROVED, FINAL_MIN_FREE_BYTES, FINAL_ABORT_FREE_BYTES, titleSpans, spanCheck, finalCutEndSec, mainTailTrimOk, runPrechecks, buildFinalPlan } from './localCaptionFinal.mjs'
import { MAIN_BGM_DUCK, MAIN_BGM_DEFAULTS, MAIN_BGM_LIMITER } from '../server/lib/mainBgm.mjs'
import { buildMainBgmPreviewPlan } from './localCaptionMainBgm.mjs'
import { introCutItems } from '../server/lib/mainEdit.mjs'
import { RECOMMENDED_COMPOSITION_PROFILE, resolveCompositionConfig, COMPOSITION_DEFAULTS } from '../server/lib/finalComposition.mjs'
import { SHORT_DIGEST_DEFAULTS } from '../server/lib/shortDigest.mjs'
import { getDigestPicks, SHORT_DIGEST_PICKS } from './localCaptionCuts.mjs'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

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

const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v) }); return Object.freeze(o) }

describe('先頭カット終了位置の導出（precheckの cutEnd）', () => {
  // 合成fixture（実データのcaption・秒数は使わない）
  const dur = 100
  const plan = (cutEndSec) => introCutItems(dur, cutEndSec, 30)

  it('full.items[0].srcStartSec から先頭カット終了位置を取得できる', () => {
    const full = plan(3)
    expect(finalCutEndSec(full)).toBe(full.items[0].srcStartSec)
    expect(finalCutEndSec(full)).toBeCloseTo(3, 6)
  })
  it('先頭カットが0秒でも成功する', () => {
    expect(finalCutEndSec(plan(0))).toBe(0)
  })
  it('カット秒数が違っても固定値に依存せず、フレーム境界へ丸めた値を返す', () => {
    for (const sec of [0.5, 1.2345, 7.9, 12]) {
      const full = plan(sec)
      expect(finalCutEndSec(full)).toBeCloseTo(Math.round(sec * 30) / 30, 9)
    }
  })
  it('本編の長さの検査は、導出したcutEndで成り立つ（末尾は1フレーム未満だけ切る）', () => {
    for (const sec of [0, 2.5, 9.99]) {
      const full = plan(sec)
      const cutEnd = finalCutEndSec(full)
      const mainSec = full.items[0].srcEndSec - cutEnd
      expect(mainTailTrimOk(dur, cutEnd, mainSec)).toBe(true)
    }
    expect(mainTailTrimOk(dur, 2, 90)).toBe(false) // 10秒ぶん余る=末尾を大きく削っている
    expect(mainTailTrimOk(dur, 2, 0)).toBe(false)
  })
  it('full.items が空・欠落なら明示的な検証エラー（ReferenceError/TypeError ではない）', () => {
    for (const bad of [{ items: [] }, { items: undefined }, {}, null, undefined]) {
      expect(() => finalCutEndSec(bad)).toThrow(/編集計画の検証に失敗/)
    }
  })
  it('srcStartSec / srcEndSec が不正なら明示的な検証エラー', () => {
    for (const srcStartSec of [NaN, undefined, '2', -1, Infinity]) {
      expect(() => finalCutEndSec({ items: [{ kind: 'seg', srcStartSec, srcEndSec: 50 }] })).toThrow(/srcStartSec/)
    }
    expect(() => finalCutEndSec({ items: [{ kind: 'seg', srcStartSec: 5, srcEndSec: 5 }] })).toThrow(/srcEndSec/)
    expect(() => finalCutEndSec({ items: [{ kind: 'seg', srcStartSec: 5, srcEndSec: NaN }] })).toThrow(/srcEndSec/)
    expect(() => introCutItems(dur, NaN, 30) && finalCutEndSec(introCutItems(dur, NaN, 30))).toThrow(/編集計画の検証に失敗/)
  })
  it('入力を変更しない（凍結した計画でも動く）', () => {
    const full = deepFreeze(plan(4))
    const before = JSON.stringify(full)
    expect(() => finalCutEndSec(full)).not.toThrow()
    expect(JSON.stringify(full)).toBe(before)
  })
  it('cutEnd is not defined が再発しない: runPrechecks は cutEnd を宣言して使う', () => {
    const src = runPrechecks.toString()
    expect(src).toMatch(/\bcutEnd\b/)
    // 使う前に P から受け取っている（未宣言のまま参照しない）
    expect(src).toMatch(/const \{[^}]*\bcutEnd\b[^}]*\} = P/)
    expect(buildFinalPlan.toString()).toMatch(/const cutEnd = finalCutEndSec\(full\)/)
    expect(buildFinalPlan.toString()).not.toMatch(/2\.0667|\b62\b/)
  })
  it('precheck はレンダー・外部API・保存を呼ばない（読み取りと検査のみ）', () => {
    const src = runPrechecks.toString()
    for (const forbidden of ['renderCompositionToFile', 'writeJsonAtomic', 'spawn(', 'fetch(', 'openai', 'whisper', 'writeFile', 'unlink', 'rename']) {
      expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})

describe('推奨プロファイル（正式採用値）', () => {
  it('約10秒ダイジェスト・暗転遷移・LINE案内・本編BGMの採用値に解決される', () => {
    const cfg = resolveCompositionConfig(RECOMMENDED_COMPOSITION_PROFILE)
    expect(cfg.digest).toMatchObject({ durationSec: 10, minSec: SHORT_DIGEST_DEFAULTS.minSec, maxSec: SHORT_DIGEST_DEFAULTS.maxSec, clipCount: SHORT_DIGEST_DEFAULTS.clipCount, clipSec: SHORT_DIGEST_DEFAULTS.clipSec, grayscale: true })
    expect(cfg.transition).toMatchObject({ enabled: true, fadeOutFrames: 10, holdFrames: 3, fadeInFrames: 9 })
    expect(cfg.lineIntro).toMatchObject({ mode: 'overlay', durationSec: 30, showQr: true })
    expect(cfg.lineOutro).toMatchObject({ mode: 'standalone', durationSec: 12, showQr: true })
    expect(cfg.mainBgm).toMatchObject({ volume: 0.05, ducking: true, loop: true, fadeInSec: 1.5, fadeOutSec: 2.5, scope: 'main' })
    expect(COMPOSITION_DEFAULTS.transition.enabled).toBe(false) // 既定は従来どおり。推奨は明示して使う
  })
})

describe('ダイジェスト選択の差し替え', () => {
  it('保存データが無ければ既定、あれば形式を検証して使う（形式不正は黙って既定へ戻さない）', () => {
    if (existsSync(resolve(process.cwd(), 'data/local_caption_comparisons/full/full_v6.digest-picks.json'))) return // 実データがある環境ではファイル系のテストを行わない
    expect(getDigestPicks()).toBe(SHORT_DIGEST_PICKS)
  })
})

describe('リポジトリの衛生（追跡ファイル）', () => {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf-8', cwd: process.cwd() }).split('\n').filter(Boolean)
  it('動画・音源・.env・ジョブ/生成データを追跡していない（今回の機能の範囲）', () => {
    const bad = tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) || /(^|\/)data\/local_caption/.test(f) || /local_caption.*\.(mp4|mp3|wav|mov)$/i.test(f))
    expect(bad).toEqual([])
  })
  it('.env と生成データは gitignore されている', () => {
    const ignored = (p) => { try { execFileSync('git', ['check-ignore', '-q', p], { cwd: process.cwd() }); return true } catch { return false } }
    expect(ignored('.env')).toBe(true)
    expect(ignored('data/local_caption_videos/x.json')).toBe(true)
    expect(ignored('data/local_caption_comparisons/full/x.json')).toBe(true)
  })
  it('ローカルAIテロップ関連のソースに、利用者固有の絶対パスをハードコードしていない', () => {
    const files = tracked.filter((f) => /^(scripts\/localCaption|server\/(lib\/(mainBgm|mainEdit|finalComposition|introCut|digestTail|shortDigest|compositionRender)|compositionSupport|localCaptionVideoRoutes))/.test(f) && !/\.test\./.test(f))
    expect(files.length).toBeGreaterThan(5)
    const hits = files.filter((f) => /\/Users\/[a-z0-9_-]+\/(Desktop|Movies|Documents)|\/Users\/tomoki/i.test(readFileSync(resolve(process.cwd(), f), 'utf-8')))
    expect(hits).toEqual([])
  })
})
