import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import {
  COMPOSITION_DEFAULTS, resolveCompositionConfig, validateCompositionConfig, selectDigestClips, planTimeline, shiftMainCaptions, digestCaptions,
  mainThemeBlock, digestThemeBlocks, buildFinalAss, buildCompositionArgs, buildDigestStemArgs, qrLayout, lineTextLayout, buildLineEvents, mainToFinal, RENDER_GLYPH_SUBSTITUTIONS,
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

describe('デフォルト設定と有効/無効', () => {
  it('完成動画の既定はすべてON。秒数・BGM・クレジット・白黒の既定値', () => {
    const c = resolveCompositionConfig({})
    expect(c.digest).toMatchObject({ enabled: true, grayscale: true, minSec: 20, maxSec: 30 })
    expect(c.lineIntro).toMatchObject({ enabled: true, durationSec: 30, showQr: false })
    expect(c.lineOutro).toMatchObject({ enabled: true, showQr: true })
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
  it('設定の検証: 秒数・音量の範囲、末尾LINE案内はQR必須', () => {
    expect(validateCompositionConfig(resolveCompositionConfig({})).ok).toBe(true)
    expect(validateCompositionConfig(resolveCompositionConfig({ digest: { bgm: { volume: 2 } } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineIntro: { durationSec: 1 } })).ok).toBe(false)
    expect(validateCompositionConfig(resolveCompositionConfig({ lineOutro: { showQr: false } })).errors.join()).toContain('QR')
    expect(validateCompositionConfig(resolveCompositionConfig({ lineOutro: { enabled: false, showQr: false } })).ok).toBe(true)
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
  it('順序: ダイジェスト → 冒頭LINE → 本編 → 末尾LINE。各区間が隙間なく連続する', () => {
    const t = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
    expect(t.sections.map((s) => s.kind)).toEqual(['digest', 'lineIntro', 'main', 'lineOutro'])
    t.sections.slice(1).forEach((s, i) => expect(s.startSec).toBeCloseTo(t.sections[i].endSec, 3))
    expect(t.sections[0].startSec).toBe(0)
    expect(t.totalSec).toBeCloseTo(sel.totalSec + 30 + 30 + 12, 2)
    expect(t.mainOffsetSec).toBeCloseTo(sel.totalSec + 30, 2)
    expect(t.sections[2].endSec - t.sections[2].startSec).toBeCloseTo(30, 3)
  })
  it('ダイジェストOFF・冒頭LINEOFF・末尾LINEOFFの組み合わせ', () => {
    const kinds = (o) => planTimeline(resolveCompositionConfig(o), { ...main, digestClips: sel.clips }).sections.map((s) => s.kind)
    expect(kinds({ digest: { enabled: false } })).toEqual(['lineIntro', 'main', 'lineOutro'])
    expect(kinds({ lineIntro: { enabled: false } })).toEqual(['digest', 'main', 'lineOutro'])
    expect(kinds({ lineOutro: { enabled: false, showQr: false } })).toEqual(['digest', 'lineIntro', 'main'])
    expect(kinds({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } })).toEqual(['main'])
    const t = planTimeline(resolveCompositionConfig({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } }), { ...main, digestClips: sel.clips })
    expect(t.mainOffsetSec).toBe(0)
    expect(t.totalSec).toBe(30)
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
  const lineSecs = timeline.sections.filter((s) => s.kind === 'lineIntro' || s.kind === 'lineOutro')

  it('LINE案内の区間に、本編字幕・ダイジェスト字幕・トークテーマを重ねない', () => {
    for (const s of lineSecs) {
      const overlapping = events.filter((e) => !e.style.startsWith('Line') && e.a < s.endSec - 1e-6 && e.b > s.startSec + 1e-6)
      expect(overlapping).toEqual([])
    }
  })
  it('LINE案内は2〜3段階で表示される（冒頭: 3段階、末尾: 3行が最初から段階的に）。フェードのみで派手な動きはない', () => {
    const intro = timeline.sections.find((s) => s.kind === 'lineIntro')
    const lineEvents = events.filter((e) => e.style.startsWith('Line') && e.a >= intro.startSec && e.b <= intro.endSec + 1e-6)
    expect(lineEvents).toHaveLength(3)
    const starts = lineEvents.map((e) => e.a)
    expect(new Set(starts).size).toBe(3)
    expect(starts[1]).toBeGreaterThan(starts[0] + 5)
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

describe('QR（quiet zone・画面内・テキストと重ならない）', () => {
  it('画面内に収まり、周囲に白いquiet zone（QRの一辺の6%以上）を持つ', () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [3840, 2160]]) {
      const q = qrLayout(w, h)
      expect(q.x).toBeGreaterThanOrEqual(0)
      expect(q.y).toBeGreaterThanOrEqual(0)
      expect(q.x + q.total).toBeLessThanOrEqual(w)
      expect(q.y + q.total).toBeLessThanOrEqual(h)
      expect(q.quiet / q.inner).toBeGreaterThanOrEqual(0.06)
      expect(q.total).toBe(q.inner + q.quiet * 2)
      expect(q.inner / h).toBeGreaterThan(0.4) // スマホ表示でも読めるよう大きく
    }
  })
  it('末尾LINE案内のテキストはQR（quiet zone含む）と重ならず、余白がある', () => {
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      const q = qrLayout(w, h)
      const { items, textRight } = lineTextLayout(w, h, cfgFull.line.text, true)
      expect(textRight).toBeLessThan(q.x - Math.round(w * 0.02))
      for (const it of items) {
        expect(it.y + it.heightPx).toBeLessThanOrEqual(h)
        expect(it.x + it.widthPx).toBeLessThan(q.x)
      }
    }
  })
  it('QRなしの冒頭案内は中央揃えで、画面内に収まる', () => {
    const { items } = lineTextLayout(1920, 1080, cfgFull.line.text, false)
    for (const it of items) {
      expect(it.x).toBe(960)
      expect(it.widthPx).toBeLessThan(1920)
    }
    const ev = buildLineEvents(1920, 1080, cfgFull.line.text, { startSec: 0, endSec: 30 }, false, [0, 0.33, 0.66])
    expect(ev.every((l) => l.includes('\\an8'))).toBe(true)
  })
})

describe('ffmpeg引数（白黒・BGM・QRの範囲）', () => {
  const sel = digest()
  const main = { mainStartSec: 1100, mainEndSec: 1130 }
  const timeline = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
  const built = buildCompositionArgs({ cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/src/video.mov', ...main, digestClips: sel.clips, bgmPath: '/x/bgm.mp3', qrPath: '/x/qr.png', assPath: '/tmp/a.ass', outputPath: '/out/.rendering.mp4' })
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
    const off = buildCompositionArgs({ cfg: resolveCompositionConfig({ digest: { grayscale: false } }), timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, bgmPath: '/b', assPath: '/a', outputPath: '/o' })
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
    expect(concatAudioIn.startsWith('[dvid][dA][liv][lia][mv][ma][lov][loa]concat=n=4')).toBe(true)
  })
  it('BGMなし・ducking OFFの場合の音声チェーン', () => {
    const noBgm = buildCompositionArgs({ cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, assPath: '/a', outputPath: '/o' })
    expect(noBgm.filterComplex).not.toContain('sidechaincompress')
    const fixed = buildCompositionArgs({ cfg: resolveCompositionConfig({ digest: { bgm: { duck: false } } }), timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, bgmPath: '/b', assPath: '/a', outputPath: '/o' })
    expect(fixed.filterComplex).not.toContain('sidechaincompress')
    expect(fixed.filterComplex).toContain('[dvoice][bgm]amix')
  })
  it('LINE案内区間の音声は無音（BGMを流さない）', () => {
    expect(f).toContain('anullsrc')
    const chains = f.split(';')
    expect(chains.filter((c) => c.includes('anullsrc'))).toHaveLength(2) // 冒頭・末尾
  })
  it('QRは字幕の後に、末尾LINE案内の時間帯だけ重ねる（冒頭はQRなし）。QRには白黒・字幕を適用しない', () => {
    const outro = timeline.sections.find((s) => s.kind === 'lineOutro')
    const overlays = f.split(';').filter((c) => c.includes('overlay='))
    expect(overlays).toHaveLength(1)
    expect(overlays[0]).toContain(`between(t,${outro.startSec},${outro.endSec})`)
    expect(f.indexOf('overlay=')).toBeGreaterThan(f.indexOf('ass='))
    const q = qrLayout(W, H)
    expect(f).toContain(`pad=${q.total}:${q.total}:${q.quiet}:${q.quiet}:color=white`)
    expect(f).toContain(`overlay=${q.x}:${q.y}`)
    const introQr = buildCompositionArgs({ cfg: resolveCompositionConfig({ lineIntro: { showQr: true } }), timeline, width: W, height: H, sourcePath: '/s', ...main, digestClips: sel.clips, qrPath: '/q', assPath: '/a', outputPath: '/o' })
    expect(introQr.filterComplex.split(';').filter((c) => c.includes('overlay=')).length).toBe(2)
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
    expect(JSON.stringify(r.errors)).not.toContain(dir)
    const noNeed = resolveCompositionConfig({ digest: { enabled: false }, lineOutro: { enabled: false, showQr: false }, lineIntro: { showQr: false } })
    expect((await resolveCompositionAssets(noNeed, [dir])).ok).toBe(true)
  })
  const base = () => {
    const sel = digest()
    const main = { mainStartSec: 1100, mainEndSec: 1130 }
    const timeline = planTimeline(cfgFull, { ...main, digestClips: sel.clips })
    return { cfg: cfgFull, timeline, width: W, height: H, sourcePath: '/src.mov', ...main, digestClips: sel.clips, bgmPath: '/b', qrPath: '/q', assText: '[Script Info]\n' }
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
