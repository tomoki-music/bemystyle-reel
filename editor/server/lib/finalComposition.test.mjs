import { computeTopicGeometry } from './topicAss.mjs'
import { getCaptionStyleDefs } from './captionStyles.mjs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import {
  COMPOSITION_DEFAULTS, resolveCompositionConfig, validateCompositionConfig, selectDigestClips, planTimeline, shiftMainCaptions, digestCaptions,
  mainThemeBlock, digestThemeBlocks, buildFinalAss, buildCompositionArgs, planQrWindows, planQrPlacement, overlayPanelLayout, buildLineOverlayEvents, OVERLAY_SAFE, LINE_OVERLAY_STAGES_SEC, sectionShowsQr, QR_MISSING_MESSAGE, buildDigestStemArgs, qrLayout, lineTextLayout, buildLineEvents, mainToFinal, RENDER_GLYPH_SUBSTITUTIONS,
} from './finalComposition.mjs'
import { inspectAsset, resolveCompositionAssets, renderCompositionToFile, checkFreeSpace, FULL_RENDER_MIN_FREE_BYTES } from './compositionRender.mjs'
import { normalizeTopicSectionsContinuous } from './topicSections.mjs'
import { analyzeTopicAssEvents } from './topicAss.mjs'

// 合成データ（実際の字幕本文ではない）: 元動画の 1000〜1300 秒。caption は約3秒ごと、5文ごとに文が終わる。
const captions = Array.from({ length: 100 }, (_, i) => ({
  startSec: 1000 + i * 3,
  endSec: 1000 + i * 3 + 2.8,
  text: `テスト字幕${i}${i % 2 === 1 ? '。' : '、'}`,
  lines: [`テスト字幕${i}`],
  captionType: 'normal',
  emphasisText: i % 7 === 0 ? '字幕' : null,
  displayOrder: i,
}))
const themesRaw = [
  { id: 'topic-001', title: '最初のテーマ名です', startSec: 1000, endSec: 1100, source: 'ai' },
  { id: 'topic-002', title: '二番目のテーマ名です', startSec: 1100, endSec: 1200, source: 'manual' },
  { id: 'topic-003', title: '三番目のテーマ名です', startSec: 1200, endSec: 1300, source: 'ai' },
]
const themes = normalizeTopicSectionsContinuous(themesRaw, { startSec: 1000, endSec: 1300 }).sections
const cfgFull = resolveCompositionConfig({ digest: { bgm: { path: '/x/bgm.mp3' } }, line: { qrPath: '/x/qr.png' } })
const digest = () => selectDigestClips({ captions, themes, config: cfgFull.digest })
const W = 1920
const H = 1080
const QR_SIZE = { width: 554, height: 518 }
const assTimeOf = (sec) => { const t = Math.round(sec * 100); const c = t % 100; const x = Math.floor(t / 100); return `${Math.floor(x / 3600)}:${String(Math.floor(x / 60) % 60).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}.${String(c).padStart(2, '0')}` }

describe('デフォルト設定と有効/無効', () => {
  it('完成動画の既定はすべてON。秒数・BGM・クレジット・白黒の既定値', () => {
    const c = resolveCompositionConfig({})
    expect(c.digest).toMatchObject({ enabled: true, grayscale: true, minSec: 20, maxSec: 30 })
    expect(c.lineIntro).toMatchObject({ enabled: true, durationSec: 30, showQr: true })
    expect(c.lineOutro).toMatchObject({ enabled: true, showQr: true })
    expect(c.qr.enabled).toBe(true) // 完成動画は冒頭・末尾ともQR表示が既定
    expect(c.lineOutro.durationSec).toBeGreaterThanOrEqual(10)
    expect(c.lineOutro.durationSec).toBeLessThanOrEqual(15)
    expect(c.digest.bgm.credit).toEqual({ title: 'The maze of aqua', composer: '蒲鉾さちこ（Kamaboko Sachiko）' })
    expect(c.digest.bgm.fadeInSec).toBeGreaterThan(0)
    expect(c.digest.bgm.fadeOutSec).toBeGreaterThan(0)
    expect(c.digest.bgm.path).toBe('') // 素材パスはコードに埋め込まない
    expect(c.line.qrPath).toBe('')
    expect(c.line.text.headline).toBe('LINEお友だち登録受付中')
    expect(c.line.text.offer).toContain('無料歌唱診断🎵')
    expect(c.line.text.bonus).toContain('お届けします＾＾')
  })
  it('短時間プレビューでは追加区間がすべて無効（プレビューで有効化した機能だけON）', () => {
    const p = resolveCompositionConfig({}, { mode: 'preview' })
    expect([p.digest.enabled, p.lineIntro.enabled, p.lineOutro.enabled]).toEqual([false, false, false])
    const p2 = resolveCompositionConfig({ preview: { lineOutro: true } }, { mode: 'preview' })
    expect([p2.digest.enabled, p2.lineIntro.enabled, p2.lineOutro.enabled]).toEqual([false, false, true])
    expect(resolveCompositionConfig({ digest: { enabled: false }, preview: { digest: true } }, { mode: 'preview' }).digest.enabled).toBe(false)
  })
  it('上書きは既定値を変更しない（既定オブジェクトは不変）', () => {
    resolveCompositionConfig({ digest: { enabled: false, bgm: { volume: 1 } } })
    expect(COMPOSITION_DEFAULTS.digest.enabled).toBe(true)
    expect(COMPOSITION_DEFAULTS.digest.bgm.volume).toBeLessThan(0.5)
    expect(() => { COMPOSITION_DEFAULTS.digest.enabled = false }).toThrow()
  })
  it('設定の検証: 秒数・音量の範囲。QRは冒頭・末尾を個別にOFFできる', () => {
    expect(validateCompositionConfig(resolveCompositionConfig({})).ok).toBe(true)
    expect(validateCompositionConfig(resolveCompositionConfig({ digest: { bgm: { volume: 2 } } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineIntro: { durationSec: 1 } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineOutro: { showQr: false } })).ok).toBe(true)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineIntro: { showQr: false }, qr: { enabled: false } })).ok).toBe(true)
  })
})

describe('ダイジェスト選定（語・文の途中から始めない/終わらない、重複しない）', () => {
  const sel = digest()
  it('3〜5か所・合計20〜30秒・時系列順', () => {
    expect(sel.reasons).toEqual([])
    expect(sel.clips.length).toBeGreaterThanOrEqual(3)
    expect(sel.clips.length).toBeLessThanOrEqual(5)
    expect(sel.totalSec).toBeGreaterThanOrEqual(20)
    expect(sel.totalSec).toBeLessThanOrEqual(30)
    sel.clips.forEach((c, i) => { if (i) expect(c.firstIndex).toBeGreaterThan(sel.clips[i - 1].lastIndex) })
  })
  it('各クリップは文の頭から文の終わりまで。極端に短くならない。重複・近接しない', () => {
    for (const c of sel.clips) {
      expect(c.firstIndex === 0 || /。$/.test(captions[c.firstIndex - 1].text)).toBe(true)
      expect(/。$/.test(captions[c.lastIndex].text)).toBe(true)
      expect(c.durationSec).toBeGreaterThanOrEqual(4.5)
      expect(c.srcStartSec).toBeLessThanOrEqual(captions[c.firstIndex].startSec)
      expect(c.srcEndSec).toBeGreaterThanOrEqual(captions[c.lastIndex].endSec)
      if (c.firstIndex > 0) expect(c.srcStartSec).toBeGreaterThanOrEqual(captions[c.firstIndex - 1].endSec)
    }
    sel.clips.forEach((c, i) => { if (i) expect(c.srcStartSec).toBeGreaterThan(sel.clips[i - 1].srcEndSec + 1) })
  })
  it('強調を含む箇所を優先し、テーマを偏らせない', () => {
    expect(new Set(sel.clips.map((c) => c.themeId)).size).toBeGreaterThanOrEqual(2)
    expect(sel.clips.some((c) => captions.slice(c.firstIndex, c.lastIndex + 1).some((x) => x.emphasisText))).toBe(true)
  })
  it('0.6秒以上の無音をまたがない。候補が不足すれば理由を返す（作れないのに作らない）', () => {
    const gappy = captions.map((c, i) => ({ ...c, startSec: c.startSec + i * 2, endSec: c.endSec + i * 2 }))
    const r = selectDigestClips({ captions: gappy, themes, config: cfgFull.digest })
    expect(r.clips).toEqual([])
    expect(r.reasons.length).toBeGreaterThan(0)
  })
  it('入力captionを変更しない', () => {
    const before = JSON.stringify(captions)
    digest()
    expect(JSON.stringify(captions)).toBe(before)
  })
})

describe('タイムライン（区間順序とオフセット）', () => {
  const sel = digest()
  const main = { mainStartSec: 1100, mainEndSec: 1130 }
  it('順序: ダイジェスト → 本編 → 末尾LINE。冒頭LINE(overlay)は独立区間ではなく本編の最初の30秒へ重なる', () => {
    const t = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
    expect(t.sections.map((s) => s.kind)).toEqual(['digest', 'main', 'lineOutro'])
    t.sections.slice(1).forEach((s, i) => expect(s.startSec).toBeCloseTo(t.sections[i].endSec, 3))
    expect(t.sections[0].startSec).toBe(0)
    expect(t.totalSec).toBeCloseTo(sel.totalSec + 30 + 12, 2) // ダイジェスト + 本編 + 末尾LINE（冒頭LINEの30秒は加算しない）
    expect(t.mainOffsetSec).toBeCloseTo(sel.totalSec, 2) // 本編のオフセットはダイジェストの長さだけ
    expect(t.overlays).toHaveLength(1)
    expect(t.overlays[0]).toMatchObject({ kind: 'lineIntro', startSec: t.sections[1].startSec }) // 本編開始とオーバーレイ開始が同一
    expect(t.overlays[0].endSec - t.overlays[0].startSec).toBeCloseTo(30, 3)
    expect(t.overlays[0].endSec).toBeLessThanOrEqual(t.sections[1].endSec) // 本編の範囲内
  })
  it('overlayは全体durationへ加算しない。standaloneは加算され、本編オフセットも30秒後ろへずれる', () => {
    const ov = planTimeline(resolveCompositionConfig({ lineIntro: { mode: 'overlay' } }), { ...main, digestClips: sel.clips })
    const st = planTimeline(resolveCompositionConfig({ lineIntro: { mode: 'standalone' } }), { ...main, digestClips: sel.clips })
    expect(st.totalSec - ov.totalSec).toBeCloseTo(30, 3)
    expect(st.mainOffsetSec - ov.mainOffsetSec).toBeCloseTo(30, 3)
    expect(st.sections.map((x) => x.kind)).toEqual(['digest', 'lineIntro', 'main', 'lineOutro'])
    expect(st.overlays).toEqual([])
    // overlayの秒数を変えても長さは変わらない。本編より長い指定は本編の終わりまでに丸める
    const ov60 = planTimeline(resolveCompositionConfig({ lineIntro: { durationSec: 60 } }), { ...main, digestClips: sel.clips })
    expect(ov60.totalSec).toBeCloseTo(ov.totalSec, 3)
    expect(ov60.overlays[0].endSec).toBeCloseTo(ov60.sections[1].endSec, 3)
  })
  it('構成確認動画相当（ダイジェスト+本編35秒+末尾12秒）の長さ。旧仕様の二重加算（+30秒）をしない', () => {
    const t = planTimeline(cfgFull, { mainStartSec: 1100, mainEndSec: 1135, digestClips: sel.clips })
    expect(t.totalSec).toBeCloseTo(sel.totalSec + 35 + 12, 2)
    expect(t.totalSec).not.toBeCloseTo(sel.totalSec + 30 + 35 + 12, 1)
    expect(t.overlays[0].endSec - t.overlays[0].startSec).toBeCloseTo(30, 3)
    expect(t.sections[1].endSec - t.overlays[0].endSec).toBeCloseTo(5, 3) // 残り約5秒はLINE案内なし
  })
  it('ダイジェストOFF・冒頭LINEOFF・末尾LINEOFFの組み合わせ', () => {
    const kinds = (o) => planTimeline(resolveCompositionConfig(o), { ...main, digestClips: sel.clips }).sections.map((s) => s.kind)
    expect(kinds({ digest: { enabled: false } })).toEqual(['main', 'lineOutro'])
    expect(kinds({ lineIntro: { enabled: false } })).toEqual(['digest', 'main', 'lineOutro'])
    expect(planTimeline(resolveCompositionConfig({ lineIntro: { enabled: false } }), { ...main, digestClips: sel.clips }).overlays).toEqual([])
    expect(kinds({ lineOutro: { enabled: false, showQr: false } })).toEqual(['digest', 'main'])
    expect(kinds({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } })).toEqual(['main'])
    const t = planTimeline(resolveCompositionConfig({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } }), { ...main, digestClips: sel.clips })
    expect(t.mainOffsetSec).toBe(0)
    expect(t.totalSec).toBe(30)
    // ダイジェストOFFでも冒頭overlayは本編の最初（0秒）から
    const noDigest = planTimeline(resolveCompositionConfig({ digest: { enabled: false } }), { ...main, digestClips: sel.clips })
    expect(noDigest.overlays[0]).toMatchObject({ startSec: 0, endSec: 30 })
  })
  it('caption・テーマ・強調が本編オフセットと同じ秒数だけ移動し、本編内部の相対時刻は変わらない', () => {
    const t = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
    const inMain = captions.filter((c) => c.startSec >= main.mainStartSec && c.endSec <= main.mainEndSec)
    const shifted = shiftMainCaptions(captions, main.mainStartSec, main.mainEndSec, t.mainOffsetSec)
    expect(shifted).toHaveLength(inMain.length)
    shifted.forEach((c, i) => {
      expect(c.startSec - inMain[i].startSec).toBeCloseTo(t.mainOffsetSec - main.mainStartSec, 3)
      expect(c.endSec - inMain[i].endSec).toBeCloseTo(t.mainOffsetSec - main.mainStartSec, 3)
      expect(c.text).toBe(inMain[i].text)
      expect(c.lines).toEqual(inMain[i].lines)
      expect(c.emphasisText).toBe(inMain[i].emphasisText)
    })
    // 相対時刻（本編先頭からの秒）が同一
    shifted.forEach((c, i) => expect(c.startSec - t.mainOffsetSec).toBeCloseTo(inMain[i].startSec - main.mainStartSec, 3))
    // テーマ切り替え（1100秒）も同じ秒数だけ移動
    const blk = mainThemeBlock(themes, 1080, 1130, mainToFinal(1080, 1080, t.mainOffsetSec) )
    expect(blk.sections.map((s) => s.id)).toEqual(['topic-001', 'topic-002'])
    expect(blk.sections[1].startSec - blk.sections[0].startSec).toBeCloseTo(1100 - 1080, 3) // 相対間隔
    expect(blk.sections[0].startSec).toBeCloseTo(blk.startSec, 3)
    expect(blk.sections[1].endSec).toBeCloseTo(blk.endSec, 3)
    expect(mainToFinal(1100, 1100, 77.5)).toBe(77.5)
  })
  it('オフセット適用は入力を変更しない', () => {
    const before = JSON.stringify(captions)
    shiftMainCaptions(captions, 1100, 1130, 60)
    expect(JSON.stringify(captions)).toBe(before)
  })
})

describe('ダイジェストのテーマ常時表示', () => {
  const sel = digest()
  it('各クリップに対応するテーマ名へ差し替え、ダイジェスト全体で隙間なく表示する', () => {
    const { blocks, clipsWithoutTheme } = digestThemeBlocks(themes, sel.clips, captions)
    expect(clipsWithoutTheme).toBe(0)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].startSec).toBe(0)
    expect(blocks[0].endSec).toBeCloseTo(sel.totalSec, 2)
    const secs = blocks[0].sections
    secs.slice(1).forEach((s, i) => expect(s.startSec).toBeCloseTo(secs[i].endSec, 3))
    expect(secs[secs.length - 1].endSec).toBeCloseTo(sel.totalSec, 2)
    expect(new Set(secs.map((s) => s.title)).size).toBeGreaterThanOrEqual(2)
  })
  it('テーマが無いクリップには根拠のない名称を作らず、その区間にはテーマを出さない', () => {
    const { blocks, clipsWithoutTheme } = digestThemeBlocks(themes.slice(0, 1), sel.clips, captions)
    expect(clipsWithoutTheme).toBeGreaterThan(0)
    expect(blocks.flatMap((b) => b.sections).every((s) => s.title === themes[0].title)).toBe(true)
  })
})

describe('最終ASS（LINE案内・テーマ・字幕）', () => {
  const sel = digest()
  const main = { mainStartSec: 1100, mainEndSec: 1130 }
  const timeline = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
  const mainCaps = shiftMainCaptions(captions, main.mainStartSec, main.mainEndSec, timeline.mainOffsetSec)
  const digCaps = digestCaptions(captions, sel.clips)
  const dBlocks = digestThemeBlocks(themes, sel.clips, captions).blocks
  const mBlock = mainThemeBlock(themes, main.mainStartSec, main.mainEndSec, timeline.mainOffsetSec)
  const ass = buildFinalAss({ width: W, height: H, cfg: cfgFull, timeline, mainCaptions: mainCaps, digestCaps: digCaps, themeBlocks: [...dBlocks, mBlock] })
  const parse = (l) => {
    const m = /^Dialogue: (\d+),(\d+):(\d\d):(\d\d)\.(\d\d),(\d+):(\d\d):(\d\d)\.(\d\d),([^,]*),/.exec(l)
    return m && { layer: Number(m[1]), a: +m[2] * 3600 + +m[3] * 60 + +m[4] + +m[5] / 100, b: +m[6] * 3600 + +m[7] * 60 + +m[8] + +m[9] / 100, style: m[10] }
  }
  const events = ass.split('\n').map(parse).filter(Boolean)
  const lineSecs = timeline.sections.filter((s) => s.kind === 'lineIntro' || s.kind === 'lineOutro') // 独立区間は末尾のみ（冒頭はoverlay）

  it('独立したLINE案内区間（末尾）に、本編字幕・ダイジェスト字幕・トークテーマを重ねない', () => {
    for (const s of lineSecs) {
      const overlapping = events.filter((e) => !e.style.startsWith('Line') && e.a < s.endSec - 1e-6 && e.b > s.startSec + 1e-6)
      expect(overlapping).toEqual([])
    }
  })
  it('末尾LINE案内は3行が段階的に表示される（従来どおり）。冒頭overlayは見出し→特典→その他の3段階。フェードのみで派手な動きはない', () => {
    const outro = timeline.sections.find((s) => s.kind === 'lineOutro')
    const outroEv = events.filter((e) => e.style.startsWith('Line') && e.a >= outro.startSec && e.b <= outro.endSec + 1e-6)
    expect(outroEv).toHaveLength(3)
    expect(outroEv.map((e) => e.a)[1]).toBeGreaterThan(outroEv[0].a)
    const ov = timeline.overlays[0]
    const texts = events.filter((e) => e.layer === 20 && e.a >= ov.startSec - 1e-6 && e.b <= ov.endSec + 1e-6 && e.style.startsWith('Line'))
    expect(texts).toHaveLength(3)
    expect(texts[0].a).toBeCloseTo(ov.startSec, 2) // 見出しは開始フレームから
    expect(texts[1].a - texts[0].a).toBeCloseTo(LINE_OVERLAY_STAGES_SEC[1], 2)
    expect(texts[2].a - texts[0].a).toBeCloseTo(LINE_OVERLAY_STAGES_SEC[2], 2)
    expect(ass).not.toMatch(/\\move|\\t\(|\\frz|\\org/)
    expect(ass).toContain('\\fad(500,0)')
  })
  it('LINE文言が入り、libassで描画できない絵文字は文字グリフへ置き換える（設定上の文言は変えない）', () => {
    expect(ass).toContain('LINEお友だち登録受付中')
    expect(ass).toContain('お一人様1回')
    expect(ass).toContain('無料歌唱診断')
    expect(ass).toContain('お届けします＾＾')
    expect(ass).not.toContain('🎵')
    expect(ass).toContain(RENDER_GLYPH_SUBSTITUTIONS['🎵'])
    expect(cfgFull.line.text.offer).toContain('🎵')
  })
  it('トークテーマは、ダイジェスト全体・本編全体で常時表示（背景・ラベルは各区間で1組、空白なし）', () => {
    const a = analyzeTopicAssEvents(ass, { startSec: 0, endSec: timeline.totalSec })
    // ダイジェスト区間と本編区間の合計だけ被覆し、LINE案内区間は被覆しない
    const expected = timeline.digestSec + (main.mainEndSec - main.mainStartSec)
    expect(a.background.coveredSec).toBeCloseTo(expected, 1)
    expect(a.label.coveredSec).toBeCloseTo(expected, 1)
    expect(a.title.coveredSec).toBeCloseTo(expected, 1)
    expect(a.background.count).toBe(2)
  })
  it('字幕のオフセット: ダイジェストと本編のcaptionが最終動画の時刻で並び、本文・強調は変わらない', () => {
    const caps = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'))
    expect(caps).toHaveLength(digCaps.length + mainCaps.length)
    expect(caps.filter((l) => /\{\\c[0-9A-F]+&\}字幕/.test(l)).length).toBe([...digCaps, ...mainCaps].filter((c) => c.emphasisText).length)
  })
  it('フォントサイズ（通常116/テーマ84/ラベル40）を維持する', () => {
    expect(ass).toMatch(/Style: Normal,[^,]*,116,/)
    expect(ass).toMatch(/Style: TopicTitle,[^,]*,84,/)
    expect(ass).toMatch(/Style: TopicLabel,[^,]*,40,/)
  })
})

describe('QR（縦横比・quiet zone・画面内・テキストと重ならない）', () => {
  it('画面内に収まり、周囲に白いquiet zone（QR長辺の6%以上）を持つ', () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [3840, 2160]]) {
      const q = qrLayout(w, h, QR_SIZE.width, QR_SIZE.height)
      expect(q.x).toBeGreaterThanOrEqual(0)
      expect(q.y).toBeGreaterThanOrEqual(0)
      expect(q.x + q.totalW).toBeLessThanOrEqual(w)
      expect(q.y + q.totalH).toBeLessThanOrEqual(h)
      expect(q.quiet / Math.max(q.innerW, q.innerH)).toBeGreaterThanOrEqual(0.06)
      expect(q.totalW).toBe(q.innerW + (q.quiet + q.frame) * 2)
      expect(q.totalH).toBe(q.innerH + (q.quiet + q.frame) * 2)
      expect(Math.max(q.innerW, q.innerH) / h).toBeGreaterThan(0.4) // スマホ表示でも読めるよう大きく
    }
  })
  it('元画像の縦横比を維持する（正方形へ引き伸ばさない）。縦長・正方形でも維持する', () => {
    for (const [iw, ih] of [[554, 518], [518, 554], [500, 500], [800, 300]]) {
      const q = qrLayout(W, H, iw, ih)
      expect(Math.abs(q.innerW / q.innerH - iw / ih)).toBeLessThan(0.01)
    }
    const q = qrLayout(W, H, 554, 518)
    expect(q.innerW).not.toBe(q.innerH) // 554×518 は正方形ではない
  })
  it('冒頭・末尾のLINE案内のテキストはQR（quiet zone・枠を含む最大占有領域）と重ならず、余白がある', () => {
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      for (const dims of [[554, 518], [518, 554], [undefined, undefined]]) {
        const q = qrLayout(w, h, ...dims)
        const worst = qrLayout(w, h) // 寸法不明=最大占有領域（テキストはこれを避ける）
        expect(q.x).toBeGreaterThanOrEqual(worst.x)
        const { items, textRight } = lineTextLayout(w, h, cfgFull.line.text, true)
        expect(textRight).toBeLessThan(worst.x - Math.round(w * 0.02))
        for (const it of items) {
          expect(it.y + it.heightPx).toBeLessThanOrEqual(h)
          expect(it.x + it.widthPx).toBeLessThan(worst.x)
        }
      }
    }
  })
  it('QRありの独立LINE案内（末尾）は左揃え（QRは右）。QRなしの案内は中央揃えで画面内', () => {
    const withQr = buildLineEvents(1920, 1080, cfgFull.line.text, { startSec: 0, endSec: 30 }, true, [0, 0.33, 0.66])
    expect(withQr.every((l) => l.includes('\\an7'))).toBe(true)
    const { items } = lineTextLayout(1920, 1080, cfgFull.line.text, false)
    for (const it of items) {
      expect(it.x).toBe(960)
      expect(it.widthPx).toBeLessThan(1920)
    }
    const ev = buildLineEvents(1920, 1080, cfgFull.line.text, { startSec: 0, endSec: 30 }, false, [0, 0.33, 0.66])
    expect(ev.every((l) => l.includes('\\an8'))).toBe(true)
  })
})

describe('冒頭LINE案内 overlay（本編の上へ重ねる。QRは開始フレームから終了まで不透明で常時表示）', () => {
  const sel = digest()
  const main = { mainStartSec: 1100, mainEndSec: 1135 }
  const timeline = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
  const ov = timeline.overlays[0]
  const mainCaps = shiftMainCaptions(captions, main.mainStartSec, main.mainEndSec, timeline.mainOffsetSec)
  const built = buildCompositionArgs({ cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/src/video.mov', ...main, digestClips: sel.clips, bgmPath: '/x/bgm.mp3', qrPath: '/x/qr.png', qrSize: QR_SIZE, assPath: '/tmp/a.ass', outputPath: '/out/.rendering.mp4' })
  const f = built.filterComplex
  const chains = f.split(';')
  const L = overlayPanelLayout(W, H, cfgFull.line.text, true, QR_SIZE.width, QR_SIZE.height)

  it('QRは本編開始と同時（オーバーレイの最初のフレーム）から、終了（30秒後）まで途切れず表示。30秒後にLINE案内だけ消える', () => {
    const w = planQrWindows(cfgFull, timeline).find((x) => x.kind === 'lineIntro')
    expect(w.mode).toBe('overlay')
    expect(w.startSec).toBe(timeline.sections.find((x) => x.kind === 'main').startSec)
    expect(w.startSec).toBe(ov.startSec)
    expect(w.endSec - w.startSec).toBeCloseTo(30, 3)
    const qrOv = chains.find((c) => c.includes(`between(t,${ov.startSec},${ov.endSec})`))
    expect(qrOv).toContain('overlay=')
    expect(qrOv).toContain('eof_action=repeat')
    // 30fps: 開始直前のフレームは無し、最初のフレームと最終フレームは有り、終了フレームは無し
    const fps = cfgFull.fps
    const onAt = (t) => t >= ov.startSec && t <= ov.endSec
    expect(onAt(ov.startSec - 1 / fps)).toBe(false)
    expect(onAt(Math.ceil(ov.startSec * fps) / fps)).toBe(true)
    expect(onAt(ov.endSec - 1 / fps)).toBe(true)
    expect(onAt(Math.ceil(ov.endSec * fps) / fps + 1 / fps)).toBe(false)
  })
  it('QRにフェード・透明度・白黒・ぼかしを適用しない。QRカードは元画像の縦横比のままquiet zoneを持つ', () => {
    const qrChain = chains.find((c) => c.startsWith('[qs0]'))
    const scope = [qrChain, chains.find((c) => c.includes('overlay=') && c.includes(`${ov.startSec}`))].join(';')
    for (const bad of ['fade', 'hue', 'gray', 'colorchannelmixer', 'colorlevels', 'eq=', 'boxblur', 'gblur', 'avgblur', 'geq', 'alpha', 'format=rgba', 'format=yuva', 'lut', 'curves', 'negate', 'colorkey', 'chromakey']) expect(scope).not.toContain(bad)
    const q = L.qr
    expect(Math.abs(q.innerW / q.innerH - QR_SIZE.width / QR_SIZE.height)).toBeLessThan(0.01)
    expect(q.quiet / Math.max(q.innerW, q.innerH)).toBeGreaterThanOrEqual(0.06)
    expect(qrChain).toContain(`scale=${q.innerW}:${q.innerH}`)
    expect(qrChain).toContain('color=white')
    // ASSのパネルにはフェードをかけない（QRが見えているのにパネルが無い/薄い状態を作らない）。段階表示の特典・その他だけがフェードイン
    const ass = buildLineOverlayEvents(W, H, cfgFull.line.text, ov, true, QR_SIZE.width, QR_SIZE.height)
    expect(ass.filter((l) => l.includes('\\p1')).every((l) => !l.includes('\\fad'))).toBe(true)
    expect(ass.find((l) => l.includes('LINEお友だち登録受付中'))).not.toContain('\\fad')
  })
  it('見出しとQRは最初のフレームから。特典・その他は数秒後に追加（QRは段階に関係なく常時）', () => {
    const ass = buildLineOverlayEvents(W, H, cfgFull.line.text, ov, true, QR_SIZE.width, QR_SIZE.height)
    const start = (l) => { const m = /^Dialogue: \d+,(\d+):(\d\d):(\d\d)\.(\d\d),/.exec(l); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100 }
    const head = ass.find((l) => l.includes('LINEお友だち登録受付中'))
    expect(start(head)).toBeCloseTo(ov.startSec, 2)
    expect(start(ass.find((l) => l.includes('お一人様1回')))).toBeCloseTo(ov.startSec + LINE_OVERLAY_STAGES_SEC[1], 2)
    expect(start(ass.find((l) => l.includes('その他、お得な情報も')))).toBeCloseTo(ov.startSec + LINE_OVERLAY_STAGES_SEC[2], 2)
    expect(ass.join('\n')).toContain('\\1c&H55C706&') // LINEの緑のアクセント
    // 全イベントの終了はオーバーレイの終了（30秒後）で、本編の字幕・テーマ側には触れない
    for (const l of ass) expect(l).toContain(`,${assTimeOf(ov.endSec)},`)
  })
  it('本編の映像・音声は連続（停止・スロー・分割なし）。LINE案内中も本編音声が存在し、無音区間を作らない', () => {
    const mainV = chains.filter((c) => c.endsWith('[mv]'))
    expect(mainV).toHaveLength(1)
    expect(mainV[0]).toMatch(new RegExp(`trim=0:${35},setpts=PTS-STARTPTS`))
    expect(f).not.toMatch(/freezeframes|tpad|loop=|setpts=[^;]*\*|atempo|apad/)
    const mainA = chains.filter((c) => c.endsWith('[ma]'))
    expect(mainA).toHaveLength(1)
    expect(mainA[0]).not.toContain('volume=') // 本編音声を小さくしない
    // 無音（anullsrc）は末尾LINE案内の1つだけ。冒頭overlay区間は本編音声そのまま
    expect(chains.filter((c) => c.includes('anullsrc'))).toHaveLength(1)
    expect(f).toContain('[dvid][dA][mv][ma][lov][loa]concat=n=3')
  })
  it('ダイジェストBGMは本編（LINE案内overlay区間）へ漏れない。BGM入力は1回で、ダイジェスト長で切る', () => {
    expect(built.args.filter((a) => a === '/x/bgm.mp3')).toHaveLength(1)
    expect(f).toContain(`atrim=0:${timeline.digestSec}`)
    expect(chains.filter((c) => c.includes('[bgm]') || c.includes('[bgmd]')).every((c) => !c.includes('[ma]') && !c.includes('[mv]'))).toBe(true)
    // 効果音は追加しない
    expect(f).not.toMatch(/sine|aevalsrc|\bse\b/)
  })
  it('パネルは被写体・トークテーマ・下部の字幕・画面端と重ならない（右側の安全領域）', () => {
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      const l = overlayPanelLayout(w, h, cfgFull.line.text, true, QR_SIZE.width, QR_SIZE.height)
      const p = l.panel
      expect(p.x).toBeGreaterThanOrEqual(w * OVERLAY_SAFE.faceRightRatio) // 顔・髪の右
      expect(p.x + p.w).toBeLessThanOrEqual(w)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y + p.h).toBeLessThanOrEqual(h * OVERLAY_SAFE.captionTopRatio) // 下部の字幕の上
      // トークテーマ（左上）: 最大右端より右
      const g = computeTopicGeometry(['音楽仲間との', '違いを把握'], w, h, 84 * (h / 1080))
      expect(p.x).toBeGreaterThan(g.box.x + g.box.w)
      expect(p.x).toBeGreaterThan(w * OVERLAY_SAFE.themeRightRatio)
      // 実際の字幕（最大フォント・2行・下余白）の上端より上
      const defs = getCaptionStyleDefs(w, h)
      const maxFont = Math.max(...Object.values(defs).filter((d) => d.alignment === 2).map((d) => d.fontsize))
      const captionTop = h - defs.normal.marginV - maxFont * 1.2 * 2
      expect(p.y + p.h).toBeLessThan(captionTop)
      // テキストとQRはパネル内で互いに重ならない
      const boxes = [...l.items.map((i) => ({ y0: i.y, y1: i.y + i.heightPx, x0: i.cx - i.widthPx / 2, x1: i.cx + i.widthPx / 2 })), { y0: l.qr.y, y1: l.qr.y + l.qr.totalH, x0: l.qr.x, x1: l.qr.x + l.qr.totalW }]
      for (const b of boxes) {
        expect(b.x0).toBeGreaterThanOrEqual(p.x)
        expect(b.x1).toBeLessThanOrEqual(p.x + p.w)
        expect(b.y0).toBeGreaterThanOrEqual(p.y)
        expect(b.y1).toBeLessThanOrEqual(p.y + p.h)
      }
      const sorted = [...boxes].sort((a, b) => a.y0 - b.y0)
      sorted.slice(1).forEach((b, i) => expect(b.y0).toBeGreaterThanOrEqual(sorted[i].y1))
      expect(l.items.every((i) => i.widthPx <= l.innerW)).toBe(true)
    }
  })
  it('パネルのQRはスマホ縮小（390px・430px幅）でも読める大きさ（QR画像が横幅の3%以上=約60px相当）', () => {
    const q = L.qr
    for (const phoneW of [390, 430]) expect(q.innerW * (phoneW / W)).toBeGreaterThanOrEqual(62)
  })
  it('本編字幕・テーマの位置とサイズ、本編内部の相対時刻はoverlayの有無で変わらない', () => {
    const off = resolveCompositionConfig({ lineIntro: { enabled: false } })
    const tOff = planTimeline(off, { ...main, digestClips: sel.clips })
    expect(tOff.mainOffsetSec).toBeCloseTo(timeline.mainOffsetSec, 3) // 旧仕様の +30 秒を持たない
    const capsOff = shiftMainCaptions(captions, main.mainStartSec, main.mainEndSec, tOff.mainOffsetSec)
    expect(capsOff).toEqual(mainCaps) // overlayの有無で、字幕の時刻・本文・強調は完全一致
    mainCaps.forEach((c, i) => expect(c.startSec - timeline.mainOffsetSec).toBeCloseTo(captions.filter((x) => x.startSec >= main.mainStartSec && x.endSec <= main.mainEndSec)[i].startSec - main.mainStartSec, 3))
    const args = { width: W, height: H, mainCaptions: mainCaps, digestCaps: digestCaptions(captions, sel.clips), themeBlocks: [mainThemeBlock(themes, main.mainStartSec, main.mainEndSec, timeline.mainOffsetSec)] }
    const withOv = buildFinalAss({ ...args, cfg: cfgFull, timeline })
    const noOv = buildFinalAss({ ...args, cfg: off, timeline: tOff })
    const strip = (t) => t.split('\n').filter((l) => !/^Dialogue: (19|20),/.test(l) && !l.startsWith('Style: Line')).join('\n')
    // 既存の字幕・テーマのDialogue/Styleは、overlayを足しても1文字も変わらない（末尾LINEの行を除いて比較）
    expect(strip(withOv)).toBe(strip(noOv))
  })
  it('QR表示ONで素材が無ければ、overlayでもレンダー前に失敗する。overlayのQRだけOFFにもできる', () => {
    const build = (cfg, extra = {}) => buildCompositionArgs({ cfg, timeline: planTimeline(cfg, { ...main, digestClips: sel.clips }), width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, qrPath: '/q', qrSize: QR_SIZE, assPath: '/a', outputPath: '/o', ...extra })
    const introOnly = resolveCompositionConfig({ lineOutro: { enabled: false } })
    expect(() => build(introOnly, { qrPath: undefined })).toThrow(QR_MISSING_MESSAGE)
    const noIntroQr = resolveCompositionConfig({ lineIntro: { showQr: false }, lineOutro: { enabled: false } })
    expect(build(noIntroQr, { qrPath: undefined, qrSize: undefined }).filterComplex).not.toContain('overlay=')
    expect(sectionShowsQr(noIntroQr, 'lineIntro')).toBe(false)
  })
  it('設定: 既定は 冒頭=overlay・末尾=standalone、開始は本編と同時。旧設定（modeなし）は既定へ正規化。不正なmodeは検証エラー', () => {
    const c = resolveCompositionConfig({})
    expect(c.lineIntro).toMatchObject({ mode: 'overlay', startWithMain: true, durationSec: 30, showQr: true, enabled: true })
    expect(c.lineOutro).toMatchObject({ mode: 'standalone', durationSec: 12, showQr: true, enabled: true })
    expect(resolveCompositionConfig({ lineIntro: { enabled: true, durationSec: 30, showQr: true } }).lineIntro.mode).toBe('overlay') // 旧設定
    expect(validateCompositionConfig(resolveCompositionConfig({ lineIntro: { mode: 'fullscreen' } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineOutro: { mode: 'overlay' } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineIntro: { startWithMain: false } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineIntro: { mode: 'standalone' } })).ok).toBe(true)
  })
  it('短時間プレビューでは、overlayも含め構成追加を既定でOFF', () => {
    const pc = resolveCompositionConfig({}, { mode: 'preview' })
    const pt = planTimeline(pc, { ...main, digestClips: [] })
    expect(pt.overlays).toEqual([])
    expect(pt.sections.map((x) => x.kind)).toEqual(['main'])
    expect(planQrWindows(pc, pt)).toEqual([])
  })
})

describe('ffmpeg引数（白黒・BGM・QRの範囲）', () => {
  const sel = digest()
  const main = { mainStartSec: 1100, mainEndSec: 1130 }
  const timeline = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
  const built = buildCompositionArgs({ cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/src/video.mov', ...main, digestClips: sel.clips, bgmPath: '/x/bgm.mp3', qrPath: '/x/qr.png', qrSize: QR_SIZE, assPath: '/tmp/a.ass', outputPath: '/out/.rendering.mp4' })
  const f = built.filterComplex

  it('spawn用のargv配列で、shell文字列連結・元動画への書き込みをしない', () => {
    expect(Array.isArray(built.args)).toBe(true)
    expect(built.args.every((a) => typeof a === 'string')).toBe(true)
    expect(built.args[built.args.length - 1]).toBe('/out/.rendering.mp4')
    expect(built.args.filter((a) => a === '/src/video.mov').length).toBe(sel.clips.length + 1) // 読み取り入力のみ
    expect(built.args).not.toContain('/src/video.mov/') // 出力先にならない
    expect(built.args.indexOf('-y')).toBe(0)
  })
  it('白黒（hue=s=0）はダイジェストのクリップ映像だけ。本編・LINE案内・QR・字幕には適用しない', () => {
    const chains = f.split(';')
    const gray = chains.filter((c) => c.includes('hue=s=0'))
    expect(gray).toHaveLength(sel.clips.length)
    expect(gray.every((c) => /^\[\d+:v\]/.test(c) && /\[dv\d+\]$/.test(c))).toBe(true)
    const mainChain = chains.find((c) => c.endsWith('[mv]'))
    expect(mainChain).not.toContain('hue')
    expect(f.indexOf('hue=s=0')).toBeLessThan(f.indexOf('concat=n=4')) // 結合前に閉じ込める
    expect(f.indexOf('ass=')).toBeGreaterThan(f.indexOf('hue=s=0')) // 字幕・テーマはその後（カラーのまま）
    expect(f).not.toMatch(/hue=s=0[^;]*;[^;]*(ass|overlay)/) // 白黒チェーンの直後に字幕/QRを続けない
  })
  it('白黒OFFなら白黒フィルタを使わない', () => {
    const off = buildCompositionArgs({ cfg: resolveCompositionConfig({ digest: { grayscale: false } }), timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, bgmPath: '/b', qrPath: '/q', qrSize: QR_SIZE, assPath: '/a', outputPath: '/o' })
    expect(off.filterComplex).not.toContain('hue=')
  })
  it('BGMはダイジェスト長で切り、フェードイン/アウトを付け、声とミックス（ducking）。本編・LINE案内へ入らない', () => {
    const D = timeline.digestSec
    expect(f).toContain(`atrim=0:${D}`)
    expect(f).toMatch(/afade=t=in:st=0:d=1\.2/)
    expect(f).toMatch(new RegExp(`afade=t=out:st=${(D - 2).toFixed(2).replace(/0$/, '')}`))
    expect(f).toContain('sidechaincompress')
    expect(f).toContain('amix=inputs=2:duration=first')
    expect(f).toContain('[dA]')
    // BGMの入力(-i bgm)は1回だけで、ミックスは digest の音声チェーン内のみ
    expect(built.args.filter((a) => a === '/x/bgm.mp3')).toHaveLength(1)
    const concatAudioIn = f.slice(f.indexOf('[dvid][dA]'))
    expect(concatAudioIn.startsWith('[dvid][dA][mv][ma][lov][loa]concat=n=3')).toBe(true)
  })
  it('BGMなし・ducking OFFの場合の音声チェーン', () => {
    const noBgm = buildCompositionArgs({ cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, qrPath: '/q', qrSize: QR_SIZE, assPath: '/a', outputPath: '/o' })
    expect(noBgm.filterComplex).not.toContain('sidechaincompress')
    const fixed = buildCompositionArgs({ cfg: resolveCompositionConfig({ digest: { bgm: { duck: false } } }), timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, bgmPath: '/b', qrPath: '/q', qrSize: QR_SIZE, assPath: '/a', outputPath: '/o' })
    expect(fixed.filterComplex).not.toContain('sidechaincompress')
    expect(fixed.filterComplex).toContain('[dvoice][bgm]amix')
  })
  it('独立したLINE案内区間（末尾）の音声は無音（BGMを流さない）', () => {
    expect(f).toContain('anullsrc')
    const chains = f.split(';')
    expect(chains.filter((c) => c.includes('anullsrc'))).toHaveLength(1) // 末尾のみ（冒頭はoverlayで本編音声のまま）
  })
  const buildWith = (cfg, extra = {}) => buildCompositionArgs({ cfg, timeline: planTimeline(cfg, { ...main, digestClips: sel.clips }), width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, qrPath: '/q', qrSize: QR_SIZE, assPath: '/a', outputPath: '/o', ...extra })
  it('QRは字幕の後に、冒頭overlay・末尾standaloneの全時間帯へ重ねる（開始〜終了と一致）。QRには白黒・字幕を適用しない', () => {
    const introO = timeline.overlays[0]
    const outro = timeline.sections.find((s) => s.kind === 'lineOutro')
    const overlays = f.split(';').filter((c) => c.includes('overlay='))
    expect(overlays).toHaveLength(2)
    expect(overlays[0]).toContain(`between(t,${introO.startSec},${introO.endSec})`)
    expect(overlays[1]).toContain(`between(t,${outro.startSec},${outro.endSec})`)
    expect(f.indexOf('overlay=')).toBeGreaterThan(f.indexOf('ass='))
    const wins = planQrWindows(cfgFull, timeline)
    const qo = planQrPlacement(wins[0], W, H, QR_SIZE, cfgFull)
    const qs = planQrPlacement(wins[1], W, H, QR_SIZE, cfgFull)
    expect(f).toContain(`overlay=${qo.x}:${qo.y}`)
    expect(f).toContain(`overlay=${qs.x}:${qs.y}`)
    expect(f).toContain(`scale=${qs.innerW}:${qs.innerH}:flags=bicubic,pad=${qs.innerW + qs.quiet * 2}:${qs.innerH + qs.quiet * 2}:${qs.quiet}:${qs.quiet}:color=white`)
  })
  it('QR表示区間（planQrWindows）は冒頭・末尾のLINE案内の開始・終了時刻と一致し、最終フレーム付近まで続く', () => {
    const w = planQrWindows(cfgFull, timeline)
    expect(w.map((x) => x.kind)).toEqual(['lineIntro', 'lineOutro'])
    expect([w[0].startSec, w[0].endSec]).toEqual([timeline.overlays[0].startSec, timeline.overlays[0].endSec])
    const outro = timeline.sections.find((t) => t.kind === 'lineOutro')
    expect([w[1].startSec, w[1].endSec]).toEqual([outro.startSec, outro.endSec])
    expect(w[0].endSec - w[0].startSec).toBeCloseTo(30, 3)
    expect(w[1].endSec - w[1].startSec).toBeCloseTo(12, 3)
    const lastFrameSec = timeline.totalSec - 1 / cfgFull.fps
    expect(w[1].endSec).toBeGreaterThanOrEqual(lastFrameSec) // 動画の最終フレームでもQRが出ている
    expect(w[1].endSec).toBe(timeline.totalSec)
  })
  it('冒頭と末尾を個別にON/OFFできる。全体スイッチ qr.enabled=false で両方消える', () => {
    const only = (over) => planQrWindows(resolveCompositionConfig(over), planTimeline(resolveCompositionConfig(over), { ...main, digestClips: sel.clips })).map((x) => x.kind)
    expect(only({})).toEqual(['lineIntro', 'lineOutro'])
    expect(only({ lineIntro: { showQr: false } })).toEqual(['lineOutro'])
    expect(only({ lineOutro: { showQr: false } })).toEqual(['lineIntro'])
    expect(only({ qr: { enabled: false } })).toEqual([])
    expect(only({ lineIntro: { enabled: false } })).toEqual(['lineOutro'])
    const noneQr = buildWith(resolveCompositionConfig({ qr: { enabled: false } }), { qrPath: undefined, qrSize: undefined })
    expect(noneQr.filterComplex).not.toContain('overlay=')
    expect(noneQr.args).not.toContain('-loop')
  })
  it('QRは元画像の縦横比のまま、周囲に白いquiet zone。半透明・フェード・白黒化・ぼかし・透過は適用しない', () => {
    const qrChain = f.split(';').filter((c) => /^\[qs\d\]scale=/.test(c) && c.includes('pad=')).join(';')
    const overlays = f.split(';').filter((c) => c.includes('overlay='))
    const scope = [qrChain, ...overlays].join(';')
    for (const bad of ['fade', 'hue', 'gray', 'colorchannelmixer', 'colorlevels', 'eq=', 'boxblur', 'gblur', 'avgblur', 'geq', 'alpha', 'format=rgba', 'format=yuva', 'lut', 'curves', 'negate', 'colorkey', 'chromakey', 'noise']) expect(scope).not.toContain(bad)
    const m = qrChain.match(/scale=(\d+):(\d+)/) // 冒頭・末尾どちらも同じ縦横比
    expect(Math.abs(Number(m[1]) / Number(m[2]) - QR_SIZE.width / QR_SIZE.height)).toBeLessThan(0.01)
    expect(qrChain).toContain('color=white')
    // QRの入力は白黒チェーン(hue)の下流ではなく、独立した入力
    expect(f.split(';').filter((c) => c.includes('hue=s=0')).every((c) => !c.includes('overlay'))).toBe(true)
  })
  it('QR表示ONで素材（パス・寸法）が無い場合は、QRを省略せずレンダー前に失敗する', () => {
    expect(() => buildWith(cfgFull, { qrPath: undefined })).toThrow(QR_MISSING_MESSAGE)
    expect(() => buildWith(cfgFull, { qrSize: undefined })).toThrow(/寸法/)
  })
  it('短時間プレビューの既定は従来どおり構成なし（QRも出ない）', () => {
    const pc = resolveCompositionConfig({}, { mode: 'preview' })
    const pt = planTimeline(pc, { ...main })
    expect(planQrWindows(pc, pt)).toEqual([])
    expect(sectionShowsQr(pc, 'lineIntro')).toBe(false)
    expect(sectionShowsQr(pc, 'lineOutro')).toBe(false)
  })
  it('出力のdurationは全区間の合計。映像と音声を同じ長さで書き出す', () => {
    expect(built.args[built.args.indexOf('-t', built.args.indexOf('-movflags'))+1]).toBe(String(timeline.totalSec))
    expect(built.args).toContain('libx264')
    expect(built.args).toContain('aac')
  })
  it('ダイジェストOFF: BGM入力もdigestチェーンも作らない。全区間OFF: 本編のみ', () => {
    const t = planTimeline(resolveCompositionConfig({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } }), { ...main })
    const c = buildCompositionArgs({ cfg: resolveCompositionConfig({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } }), timeline: t, width: W, height: H, sourcePath: '/s', ...main, digestClips: [], assPath: '/a', outputPath: '/o' })
    expect(c.filterComplex).not.toContain('hue')
    expect(c.filterComplex).not.toContain('anullsrc')
    expect(c.filterComplex).toContain('concat=n=1')
  })
  it('検証用ステム出力は本番と同じduckingフィルタを使う', () => {
    const s = buildDigestStemArgs({ cfg: cfgFull, digestClips: sel.clips, sourcePath: '/s', bgmPath: '/b', outVoice: '/v.wav', outBgm: '/b.wav', outMix: '/m.wav' })
    expect(s.args.join(' ')).toContain('sidechaincompress=threshold=0.012:ratio=14')
  })
})

describe('素材の確認・レンダー（安全なエラー・一時ファイル・上書き禁止）', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'composition-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
  const fakeSpawn = (behaviour) => (bin, args) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setImmediate(() => behaviour(child, args))
    return child
  }
  const probeOk = (kind) => fakeSpawn((child) => {
    child.stdout.emit('data', JSON.stringify(kind === 'bgm' ? { format: { duration: '63.9' }, streams: [{ codec_type: 'audio' }] } : { format: {}, streams: [{ codec_type: 'video', width: 554, height: 518 }] }))
    child.emit('close', 0)
  })

  it('素材が未設定・拡張子違い・許可フォルダ外・存在しない場合は、絶対パスを含まない安全なエラーを返す', async () => {
    const bgm = join(dir, 'a.mp3')
    writeFileSync(bgm, 'x')
    const r0 = await inspectAsset('', 'qr', [dir])
    expect(r0.ok).toBe(false)
    const r1 = await inspectAsset(join(dir, 'a.txt'), 'bgm', [dir])
    expect(r1.ok).toBe(false)
    const other = mkdtempSync(join(tmpdir(), 'outside-'))
    writeFileSync(join(other, 'a.mp3'), 'x')
    const r2 = await inspectAsset(join(other, 'a.mp3'), 'bgm', [dir])
    expect(r2.ok).toBe(false)
    const r3 = await inspectAsset(join(dir, 'nope.png'), 'qr', [dir])
    expect(r3.ok).toBe(false)
    for (const r of [r0, r1, r2, r3]) expect(JSON.stringify(r)).not.toContain(dir.replace(/\/+$/, ''))
    for (const r of [r0, r1, r2, r3]) expect(JSON.stringify(r)).not.toContain(other)
    rmSync(other, { recursive: true, force: true })
  })
  it('実在する素材は種別・サイズ・寸法/長さを返す', async () => {
    writeFileSync(join(dir, 'a.mp3'), 'x')
    writeFileSync(join(dir, 'q.png'), 'x')
    const b = await inspectAsset(join(dir, 'a.mp3'), 'bgm', [dir], { spawnFn: probeOk('bgm') })
    expect(b).toMatchObject({ ok: true, durationSec: 63.9 })
    const q = await inspectAsset(join(dir, 'q.png'), 'qr', [dir], { spawnFn: probeOk('qr') })
    expect(q).toMatchObject({ ok: true, width: 554, height: 518 })
  })
  it('QRが必要なのに素材が無い/BGMが無い場合、レンダーせずエラー（QRなし・素材なしの安全な失敗）', async () => {
    const cfg = resolveCompositionConfig({ digest: { bgm: { path: join(dir, 'missing.mp3') } }, line: { qrPath: '' } })
    const r = await resolveCompositionAssets(cfg, [dir])
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBe(2)
    expect(r.errors).toContain(QR_MISSING_MESSAGE) // ユーザー向けの明確なエラー
    expect(JSON.stringify(r.errors)).not.toContain(dir)
    const noNeed = resolveCompositionConfig({ digest: { enabled: false }, lineOutro: { enabled: false, showQr: false }, lineIntro: { showQr: false } })
    expect((await resolveCompositionAssets(noNeed, [dir])).ok).toBe(true)
    const qrOff = resolveCompositionConfig({ digest: { enabled: false }, qr: { enabled: false } })
    expect((await resolveCompositionAssets(qrOff, [dir])).ok).toBe(true) // 全体スイッチOFFなら素材は不要
    const introOnly = resolveCompositionConfig({ digest: { enabled: false }, lineOutro: { showQr: false } })
    expect((await resolveCompositionAssets(introOnly, [dir])).errors).toEqual([QR_MISSING_MESSAGE])
  })
  const base = () => {
    const sel = digest()
    const main = { mainStartSec: 1100, mainEndSec: 1130 }
    const timeline = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
    return { cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/src.mov', ...main, digestClips: sel.clips, bgmPath: '/b', qrPath: '/q', qrSize: QR_SIZE, assText: '[Script Info]\n' }
  }
  it('成功: 隠し一時ファイルへ書いてからrename。ASS・一時動画は残らない', async () => {
    const tmpDir = join(dir, 'tmp')
    const finalPath = join(dir, 'out.mp4')
    const spawnFn = fakeSpawn((child, args) => {
      writeFileSync(args[args.length - 1], 'video')
      child.emit('close', 0)
    })
    await renderCompositionToFile({ ...base(), tmpDir, finalPath, spawnFn })
    expect(readFileSync(finalPath, 'utf-8')).toBe('video')
    expect(readdirSync(dir).filter((n) => n.startsWith('.rendering'))).toEqual([])
    expect(readdirSync(tmpDir)).toEqual([])
  })
  it('失敗: 一時動画とASSを削除し、最終ファイルを作らない。エラーに素材パスを含めない', async () => {
    const tmpDir = join(dir, 'tmp')
    const finalPath = join(dir, 'out.mp4')
    const spawnFn = fakeSpawn((child, args) => {
      writeFileSync(args[args.length - 1], 'partial')
      child.stderr.emit('data', 'boom')
      child.emit('close', 1)
    })
    const err = await renderCompositionToFile({ ...base(), tmpDir, finalPath, spawnFn }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(existsSync(finalPath)).toBe(false)
    expect(readdirSync(dir).filter((n) => n.startsWith('.rendering'))).toEqual([])
    expect(readdirSync(tmpDir)).toEqual([])
    expect(err.message).not.toContain('/b')
  })
  it('既存の完成動画は上書きしない（存在すれば、ffmpegを起動せず拒否）', async () => {
    const finalPath = join(dir, 'existing.mp4')
    writeFileSync(finalPath, 'keep me')
    let spawned = 0
    await expect(renderCompositionToFile({ ...base(), tmpDir: join(dir, 'tmp'), finalPath, spawnFn: fakeSpawn(() => { spawned++ }) })).rejects.toThrow(/上書き/)
    expect(spawned).toBe(0)
    expect(readFileSync(finalPath, 'utf-8')).toBe('keep me')
  })
  it('空き容量: フルレンダーは15GB未満なら開始しない', async () => {
    expect(FULL_RENDER_MIN_FREE_BYTES).toBe(15 * 1024 ** 3)
    expect((await checkFreeSpace('/x', FULL_RENDER_MIN_FREE_BYTES, { getFreeBytes: async () => 14 * 1024 ** 3 })).ok).toBe(false)
    expect((await checkFreeSpace('/x', FULL_RENDER_MIN_FREE_BYTES, { getFreeBytes: async () => 16 * 1024 ** 3 })).ok).toBe(true)
  })
})
