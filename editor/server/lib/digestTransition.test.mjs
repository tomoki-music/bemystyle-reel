// ダイジェスト→本編の画面遷移（ディップ・トゥ・ブラック）: タイムライン・フィルタ・字幕/テーマの延長。
import { describe, it, expect } from 'vitest'
import { resolveCompositionConfig, validateCompositionConfig, planTimeline, buildCompositionArgs, extendDigestBlocksTo, extendLastDigestCaptionTo, planQrWindows } from './finalComposition.mjs'
import { mainAnchors } from './mainEdit.mjs'
import { planBgmLoop } from './mainBgm.mjs'

const clips = [{ srcStartSec: 417.5, durationSec: 4.767 }, { srcStartSec: 739.9, durationSec: 5.067 }]
const cfgOf = (over = {}) => resolveCompositionConfig({ digest: { bgm: { path: '/b.mp3' } }, line: { qrPath: '/qr.png' }, ...over, transition: { enabled: true, ...(over.transition ?? {}) } })
const tl = (cfg, mainSec = 58.5) => planTimeline(cfg, { mainStartSec: 0, mainEndSec: mainSec, digestClips: clips })

describe('画面遷移: タイムライン（明示的な区間）', () => {
  it('既定は遷移なし（従来どおり: digest → main → lineOutro。mainOffset = ダイジェスト長）', () => {
    const cfg = resolveCompositionConfig({ digest: { bgm: { path: '/b.mp3' } } })
    const t = tl(cfg)
    expect(cfg.transition.enabled).toBe(false)
    expect(t.transition).toBeNull()
    expect(t.sections.map((s) => s.kind)).toEqual(['digest', 'main', 'lineOutro'])
    expect(t.mainOffsetSec).toBe(9.834)
    expect(t.digestSec).toBe(9.834)
  })
  it('遷移あり: digest（末尾に止め画の暗転を含む）→ 黒の保持 → main。暗転10f(0.333s)・黒3f(0.1s)・フェードイン9f(0.3s)＝約0.73秒', () => {
    const t = tl(cfgOf())
    expect(t.sections.map((s) => s.kind)).toEqual(['digest', 'transitionHold', 'main', 'lineOutro'])
    expect(t.liveDigestSec).toBe(9.834) // 実映像だけの長さ（2クリップのまま）
    expect(t.digestSec).toBe(10.167) // 暗転の止め画を含む
    expect(t.sections[0]).toMatchObject({ startSec: 0, endSec: 10.167 })
    expect(t.sections[1]).toMatchObject({ kind: 'transitionHold', startSec: 10.167, endSec: 10.267 })
    expect(t.mainOffsetSec).toBe(10.267)
    const tr = t.transition
    expect(tr.fadeOut).toMatchObject({ startSec: 9.834, endSec: 10.167, frames: 10, startFrame: 295 })
    expect(tr.hold).toMatchObject({ startSec: 10.167, endSec: 10.267, frames: 3 })
    expect(tr.fadeIn).toMatchObject({ startSec: 10.267, endSec: 10.567, frames: 9, startFrame: 308 })
    expect(tr.mainStartSec).toBe(10.267)
    expect(tr.totalSec).toBeGreaterThanOrEqual(0.6)
    expect(tr.totalSec).toBeLessThanOrEqual(0.9)
    expect(tr.fadeOut.endSec - tr.fadeOut.startSec).toBeGreaterThanOrEqual(0.3)
    expect(tr.fadeOut.endSec - tr.fadeOut.startSec).toBeLessThanOrEqual(0.4)
    expect(tr.hold.endSec - tr.hold.startSec).toBeGreaterThanOrEqual(0.08)
    expect(tr.hold.endSec - tr.hold.startSec).toBeLessThanOrEqual(0.15)
    expect(tr.fadeIn.endSec - tr.fadeIn.startSec).toBeGreaterThanOrEqual(0.25)
    expect(tr.fadeIn.endSec - tr.fadeIn.startSec).toBeLessThanOrEqual(0.35)
    expect(tr.endSec - tr.startSec).toBeCloseTo(tr.totalSec, 3)
    // ダイジェスト全体（遷移込み）は12秒以内
    expect(tr.endSec).toBeLessThanOrEqual(12)
  })
  it('同じ基準（mainOffset）が本編・LINEオーバーレイ・BGM・末尾LINE案内へ効く。本編の長さは変わらない', () => {
    const cfg = cfgOf()
    const off = tl(cfg)
    const none = tl(cfgOf({ transition: { enabled: false } }))
    const a = mainAnchors(off)
    expect(a.mainStartSec).toBe(10.267)
    expect(a.mainEndSec - a.mainStartSec).toBeCloseTo(58.5, 3)
    expect(a.overlayStartSec).toBe(a.mainStartSec) // LINEオーバーレイは本編が始まるタイミング
    expect(a.overlayEndSec - a.overlayStartSec).toBeCloseTo(30, 3)
    expect(a.bgmStartSec).toBe(a.mainStartSec) // 本編BGMは本編の開始から終了まで
    expect(a.bgmEndSec).toBe(a.mainEndSec)
    expect(a.outroStartSec).toBe(a.mainEndSec) // 末尾LINE案内は本編終了後
    expect(a.digestEndSec).toBeLessThanOrEqual(a.bgmStartSec) // ダイジェスト（BGM含む）と本編BGMは重ならない
    expect(a.transition.mainStartSec).toBe(a.mainStartSec)
    // 遷移なしとの差は、暗転の止め画と黒の保持の分だけ（本編内部の長さは同じ）
    expect(off.totalSec - none.totalSec).toBeCloseTo(0.333 + 0.1, 3)
    expect(off.mainOffsetSec - none.mainOffsetSec).toBeCloseTo(0.433, 3)
    // QR: 冒頭は本編開始と同時、末尾は本編終了後
    const q = planQrWindows(cfg, off)
    expect(q.find((w) => w.kind === 'lineIntro').startSec).toBe(a.mainStartSec)
    expect(q.find((w) => w.kind === 'lineOutro').startSec).toBe(a.mainEndSec)
  })
  it('ダイジェストが無効・クリップ無しでは遷移を作らない', () => {
    expect(planTimeline(cfgOf({ digest: { enabled: false } }), { mainStartSec: 0, mainEndSec: 10, digestClips: clips }).transition).toBeNull()
    expect(planTimeline(cfgOf(), { mainStartSec: 0, mainEndSec: 10, digestClips: [] }).transition).toBeNull()
  })
  it('設定の検証: フレーム数は整数・範囲内。ダイジェスト無効なら遷移は使えない', () => {
    expect(validateCompositionConfig(cfgOf()).ok).toBe(true)
    expect(validateCompositionConfig(cfgOf({ transition: { fadeOutFrames: 1 } })).ok).toBe(false)
    expect(validateCompositionConfig(cfgOf({ transition: { holdFrames: 2.5 } })).ok).toBe(false)
    expect(validateCompositionConfig(cfgOf({ transition: { fadeInFrames: 99 } })).ok).toBe(false)
    expect(validateCompositionConfig(cfgOf({ digest: { enabled: false } })).ok).toBe(false)
  })
})

describe('画面遷移: ダイジェストの字幕・テーマを暗転の終わりまで残す', () => {
  it('最後のcaptionだけ、ダイジェストの終わり（暗転の終わり）まで表示する。ほかは変えない', () => {
    const caps = [{ text: 'a', startSec: 0, endSec: 2 }, { text: 'b', startSec: 2, endSec: 9.9 }]
    const out = extendLastDigestCaptionTo(caps, 10.167)
    expect(out[0]).toEqual(caps[0])
    expect(out[1]).toEqual({ text: 'b', startSec: 2, endSec: 10.167 })
    expect(caps[1].endSec).toBe(9.9)
  })
  it('テーマブロックの最後だけ延ばす（発話の途中・暗転の途中で消さない）', () => {
    const blocks = [{ startSec: 0, endSec: 9.834, sections: [{ id: 'a', title: 'A', startSec: 0, endSec: 4.767 }, { id: 'b', title: 'B', startSec: 4.767, endSec: 9.834 }] }]
    const out = extendDigestBlocksTo(blocks, 10.167)
    expect(out[0].endSec).toBe(10.167)
    expect(out[0].sections[0].endSec).toBe(4.767)
    expect(out[0].sections[1].endSec).toBe(10.167)
    expect(blocks[0].endSec).toBe(9.834)
  })
})

describe('画面遷移: ffmpegフィルタ（映像・音声・BGM）', () => {
  const build = (over = {}, main = {}) => {
    const cfg = cfgOf(over)
    const timeline = tl(cfg, 10)
    const { args, filterComplex } = buildCompositionArgs({
      cfg, timeline, width: 1920, height: 1080, sourcePath: '/src.mov', mainStartSec: 0, mainEndSec: 10,
      mainItems: [{ kind: 'seg', srcStartSec: 2.0667, srcEndSec: 12.0667 }], digestClips: clips, bgmPath: '/b.mp3', qrPath: '/qr.png', qrSize: { width: 500, height: 500 }, assPath: '/a.ass', outputPath: '/o.mp4', ...main,
    })
    return { args, g: filterComplex, timeline }
  }
  it('ダイジェスト末尾: 最後のフレームだけを止め（tpad）、音声は無音で延ばす（apad）。長さはダイジェスト（暗転込み）に一致', () => {
    const { g } = build()
    expect(g).toContain('tpad=stop_mode=clone:stop=10')
    expect(g).toContain('apad=whole_dur=10.167')
    expect(g).toContain('atrim=0:10.167') // ダイジェストのBGM・ミックスも暗転の終わりまで
    expect(g).toContain('afade=t=out:st=8.167:d=2') // ダイジェストBGMは暗転の終わりに向けて自然にフェードアウト（突然切れない）
  })
  it('黒の保持: 黒の映像（文字なし）と無音を3フレーム（0.1秒・4800サンプル）だけ、ダイジェストと本編の間に入れる', () => {
    const { g } = build()
    expect(g).toContain('color=c=black:s=1920x1080:r=30:d=0.1')
    expect(g).toContain('atrim=end_sample=4800')
    // 連結順: ダイジェスト → 黒の保持 → 本編
    expect(g.indexOf('[dvid][dA][thv][tha]')).toBeGreaterThan(-1)
    expect(g.indexOf('[dvid][dA][thv][tha][mv0][ma0]')).toBeGreaterThan(-1)
    // 黒には文字・タイトルを足さない（ASSの区間にも入れない）
  })
  it('フェードアウト（映像・字幕・テーマ・QRを焼き込んだ後）は黒の保持の終わりまで。fade=out は後ろのフレームを黒のままにするので、本編へ漏らさない', () => {
    const { g } = build()
    expect(g).toContain('split=3[fa][fb][fc]')
    expect(g).toContain('[fa]trim=end_frame=308,setpts=PTS-STARTPTS,fade=t=out:s=295:n=10:color=black[fa2]')
    expect(g).toContain('[fb]trim=start_frame=308:end_frame=317,setpts=PTS-STARTPTS,fade=t=in:s=0:n=9:color=black[fb2]')
    expect(g).toContain('[fc]trim=start_frame=317,setpts=PTS-STARTPTS[fc2]')
    expect(g).toContain('[fa2][fb2][fc2]concat=n=3:v=1:a=0[vfade]')
    expect((g.match(/(?<![a-z])fade=t=out/g) ?? []).length).toBe(1) // 映像のフェードアウトは1か所だけ（afade＝音声は別）
    // 3つの範囲は連続（フレームの重複・欠落なし）: [0,308) [308,317) [317,)
  })
  it('本編の音声は遅らせない・フェードで削らない（本編の先頭は音声のフェードインなし）。本編のBGMは本編の連結にだけ入る', () => {
    const { g } = build({ mainBgm: { enabled: true, sourcePath: '/m.mp3' } }, { mainBgm: { inputPath: '/m.mp3', plan: planBgmLoop({ bgmSec: 160, mainSec: 10, loop: true }), gainDb: -37 } })
    const mainAudio = /\[1?\d:a\]aresample=48000:first_pts=0[^;]*\[ma0\]/.exec(g)
    expect(mainAudio).toBeTruthy()
    expect(mainAudio[0]).not.toContain('afade') // 1つだけの本編区間は、前後のフェードなし（語頭・先頭の息を保つ）
    expect(g).toContain('[mainvid][mainaudio]')
    // ダイジェストBGM（[bgm]）と本編BGM（[mbgm]）は別のチェーン
    expect(g).toContain('[bgm]')
    expect(g).toContain('[mbgm]')
    expect(g.indexOf('[thv][tha][mainvid][mainaudio]')).toBeGreaterThan(-1) // 本編BGMは黒の保持の後（本編の開始から）
    expect(g).toContain('atrim=0:10')
  })
  it('全体の長さ・A/V: 出力の長さは timeline.totalSec（映像のフレーム数と音声のサンプル数は同じ長さ）', () => {
    const { args, timeline } = build()
    expect(args[args.lastIndexOf('-t') + 1]).toBe(String(timeline.totalSec))
    expect(timeline.totalSec).toBeCloseTo(10.167 + 0.1 + 10 + 12, 3)
    expect(Math.round(10.167 * 30)).toBe(305) // ダイジェスト: 実映像295フレーム＋止め画10フレーム
    expect(295 + 10 + 3).toBe(308) // 黒の保持の終わり = 本編の先頭フレーム
  })
  it('遷移なしのときは従来と同じフィルタ（tpad・黒・fadeを含まない）', () => {
    const { g } = build({ transition: { enabled: false } })
    for (const k of ['tpad', 'apad', 'color=c=black', 'split=3[fa]']) expect(g, k).not.toContain(k)
    expect(g).not.toMatch(/(?<![a-z])fade=t=(out|in)/) // 映像のフェードなし（音声の afade は従来どおり）
  })
})
