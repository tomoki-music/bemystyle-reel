import { describe, it, expect, vi, afterAll } from 'vitest'
import { APPROVED, FINAL_MIN_FREE_BYTES, FINAL_ABORT_FREE_BYTES, titleSpans, spanCheck, finalCutEndSec, mainTailTrimOk, runPrechecks, buildFinalPlan } from './localCaptionFinal.mjs'
import { MAIN_BGM_DUCK, MAIN_BGM_DEFAULTS, MAIN_BGM_LIMITER } from '../server/lib/mainBgm.mjs'
import { buildMainBgmPreviewPlan } from './localCaptionMainBgm.mjs'
import { introCutItems } from '../server/lib/mainEdit.mjs'
import { RECOMMENDED_COMPOSITION_PROFILE, resolveCompositionConfig, COMPOSITION_DEFAULTS } from '../server/lib/finalComposition.mjs'
import { SHORT_DIGEST_DEFAULTS } from '../server/lib/shortDigest.mjs'
import { getDigestPicks, SHORT_DIGEST_PICKS } from './localCaptionCuts.mjs'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { planDigestTail } from '../server/lib/digestTail.mjs'
import { buildShortDigest } from '../server/lib/shortDigest.mjs'

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
    expect(mainTailTrimOk(1020, 34 / 3, 1008.667)).toBe(true) // mainSec のミリ秒丸め(-0.3ms)は許容
    expect(mainTailTrimOk(dur, 2, 98 - 0.05)).toBe(false) // 1フレーム(33ms)を超える削りは不可
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
})

// ── runPrechecks / buildFinalPlan を実際に実行する回帰テスト（合成データ・読み込みだけ依存注入・ffmpeg/API/レンダーなし） ──
describe('runPrechecks の実行時回帰（cutEnd is not defined）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'final-precheck-'))
  const src = join(dir, 'source.bin')
  const outRoot = join(dir, 'out')
  mkdirSync(outRoot)
  writeFileSync(src, 'synthetic-source')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const OFFSET = 12 // 合成captionを全て12秒以降に置く（12秒以下の先頭カットでstrictに収まる）
  const mkBase = () => {
    const captions = Array.from({ length: 500 }, (_, i) => ({ id: `full-${String(i).padStart(4, '0')}`, text: 'あいうえお。', lines: ['あいうえお。'], startSec: 2 * i + OFFSET + 0.02, endSec: 2 * i + OFFSET + 1.9, captionType: 'normal', emphasisText: null }))
    captions[226].text = '違うんであれば無理して一緒に'
    captions[227].text = 'やる必要はありません。'
    captions[400].text = '目的熱量は違いますよと。'
    const norm = [{ id: 'topic-001', title: 'はじめに', startSec: 0, endSec: 300 }, { id: 'topic-005', title: '結論', startSec: 300, endSec: 600 }, { id: 'topic-008', title: '音楽仲間との違いを把握', startSec: 600, endSec: 1100 }]
    return { captions, norm }
  }
  const mkTail = (base) => {
    const last0 = buildShortDigest(base.captions, base.norm, getDigestPicks()).clips.at(-1)
    return planDigestTail({ speechEndSec: last0.srcEndSec - 0.52, nextSpeechStartSec: last0.srcEndSec - 0.2, clipStartSec: last0.srcStartSec })
  }
  const mkDeps = (cutEndSec, over = {}) => {
    const job = { width: 1920, height: 1080, durationSec: 1020 }
    const base = mkBase()
    const cutDoc = { cut: { cutEndSec, frameIndex: Math.round(cutEndSec * 30), keepBeforeSpeechSec: 0.15 }, measure: { onsetSec: cutEndSec + 0.15 } }
    const tail = mkTail(base)
    const calls = []
    const track = (name, fn) => (...a) => { calls.push(name); return fn(...a) }
    const deps = {
      loadJob: track('loadJob', () => ({ job, file: 'job.json', bytes: 1, canon: 'x' })),
      loadBase: track('loadBase', () => base),
      loadCut: track('loadCut', () => cutDoc),
      safetyContext: track('safetyContext', () => ({ sourceRealPath: src, outputRoot: outRoot, inputRoots: [dir] })),
      readPreviewState: track('readPreviewState', () => ({ guard: {}, mainBgm: { loopSelection: { startSec: 34.56 } }, transition: {}, digestTail: tail })),
      inspectMainBgm: track('inspectMainBgm', async () => ({ ok: true, realPath: src, fileName: 'main.mp3', durationSec: 200, sampleRate: 48000, channels: 2 })),
      loadRecovered: track('loadRecovered', () => ({ captions: [] })),
      measureDigestTail: track('measureDigestTail', async () => tail),
      resolveCompositionAssets: track('resolveCompositionAssets', async () => ({ ok: false, errors: ['synthetic'] })),
      checkFreeSpace: track('checkFreeSpace', async () => ({ ok: true, freeBytes: 20 * 1024 ** 3 })),
      ...over,
    }
    return { deps, calls, job, base, cutDoc }
  }
  const ARGS = { job: 'synthetic', mainBgm: 'main.mp3', bgm: 'bgm.mp3', qr: 'qr.png' }
  const lenCheck = (r) => r.checks.find((c) => c.name.startsWith('本編の長さ'))
  const snapshot = () => JSON.stringify({ src: readFileSync(src, 'utf-8'), out: readdirSync(outRoot), root: readdirSync(dir).sort() })

  it('正常な合成編集計画で precheck が完走し、cutEnd の検査は ReferenceError にならず成立する', async () => {
    const { deps } = mkDeps(3)
    const r = await runPrechecks(ARGS, deps)
    expect(r.checks.length).toBeGreaterThan(25)
    expect(r.checks.at(-1).name).toMatch(/最終レンダー状態/)
    expect(lenCheck(r).ok).toBe(true)
    expect(r.P.cutEnd).toBeCloseTo(3, 6)
    expect(r.P.cutEnd).toBe(r.P.full.items[0].srcStartSec)
  })
  it('srcStartSec=0 でも成功する', async () => {
    const r = await runPrechecks(ARGS, mkDeps(0).deps)
    expect(r.P.cutEnd).toBe(0)
    expect(lenCheck(r).ok).toBe(true)
  })
  it('0以外の任意の先頭カット秒数でも成功する（固定値に依存しない）', async () => {
    for (const sec of [0.5, 2.0667, 7.9, 11.3333]) {
      const r = await runPrechecks(ARGS, mkDeps(sec).deps)
      expect(r.P.cutEnd).toBeCloseTo(Math.round(sec * 30) / 30, 9)
      expect(lenCheck(r).ok).toBe(true)
    }
  })
  it('buildFinalPlan も cutEnd と mainSec を返す', async () => {
    const P = await buildFinalPlan(ARGS, mkDeps(4).deps)
    expect(P.mainSec).toBeCloseTo(P.full.items[0].srcEndSec - P.cutEnd, 3)
  })
  it('空の full.items は明示的な検証エラー', async () => {
    const { deps } = mkDeps(3, { introCutItems: () => ({ items: [] }) })
    await expect(runPrechecks(ARGS, deps)).rejects.toThrow(/編集計画の検証に失敗.*空/)
  })
  it('不正な srcStartSec は明示的な検証エラー', async () => {
    for (const bad of [NaN, undefined, -1, '2']) {
      const { deps } = mkDeps(3, { introCutItems: () => ({ items: [{ kind: 'seg', srcStartSec: bad, srcEndSec: 900 }] }) })
      await expect(runPrechecks(ARGS, deps)).rejects.toThrow(/srcStartSec/)
    }
  })
  it('不正な srcEndSec は明示的な検証エラー', async () => {
    for (const bad of [NaN, undefined, 3, 1]) {
      const { deps } = mkDeps(3, { introCutItems: () => ({ items: [{ kind: 'seg', srcStartSec: 3, srcEndSec: bad }] }) })
      await expect(runPrechecks(ARGS, deps)).rejects.toThrow(/srcEndSec/)
    }
  })
  it('どの失敗でも ReferenceError / TypeError にならない', async () => {
    for (const items of [[], undefined, [{}]]) {
      const { deps } = mkDeps(3, { introCutItems: () => ({ items }) })
      const err = await runPrechecks(ARGS, deps).catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(ReferenceError)
      expect(err).not.toBeInstanceOf(TypeError)
      expect(err.message).toMatch(/編集計画の検証に失敗/)
    }
  })
  it('合成入力を変更せず、素材・出力先へ書かず、外部APIを呼ばない（読み込みと検査のみ）', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call') })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { deps, job, base, cutDoc } = mkDeps(3)
      const frozen = deepFreeze({ job, base, cutDoc })
      const before = JSON.stringify(frozen)
      const snap = snapshot()
      await runPrechecks(ARGS, { ...deps, loadJob: () => ({ job: frozen.job, file: 'j', bytes: 1, canon: 'x' }), loadBase: () => frozen.base, loadCut: () => frozen.cutDoc })
      expect(JSON.stringify(frozen)).toBe(before)
      expect(snapshot()).toBe(snap)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  it('注入した読み込みだけを使い、それぞれ1回ずつ呼ぶ（レンダー・保存に相当する呼び出しは注入点にない）', async () => {
    const { deps, calls } = mkDeps(3)
    await runPrechecks(ARGS, deps)
    expect([...new Set(calls)].sort()).toEqual(['checkFreeSpace', 'inspectMainBgm', 'loadBase', 'loadCut', 'loadJob', 'loadRecovered', 'measureDigestTail', 'readPreviewState', 'resolveCompositionAssets', 'safetyContext'])
    expect(calls.length).toBe(10)
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
