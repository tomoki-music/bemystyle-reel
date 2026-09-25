import { describe, it, expect } from 'vitest'
import { introCutItems, mapMainToFinal, mainAnchors } from './mainEdit.mjs'
import { resolveCompositionConfig, planTimeline, buildFinalAss } from './finalComposition.mjs'
import { normalizeTopicSectionsContinuous } from './topicSections.mjs'

// 合成データ（実際の字幕本文ではない）: 元動画 0〜120秒。最初のcaptionは7.11秒。caption 40件、5件目ごとに強調、うち1件に語中無音（caption内の間）
const DURATION = 120.685
const captions = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, startSec: 7.11 + i * 2.8, endSec: 7.11 + i * 2.8 + 2.7, text: `字幕${i}です。`, lines: [`字幕${i}です。`], captionType: i % 3 === 0 ? 'main' : 'normal', emphasisText: i % 3 === 0 ? '字幕' : null, displayOrder: i }))
const themes = normalizeTopicSectionsContinuous([
  { id: 't1', title: '最初のテーマ', startSec: 0, endSec: 40, source: 'manual' },
  { id: 't2', title: '次のテーマ', startSec: 40, endSec: 80, source: 'manual' },
  { id: 't3', title: '最後のテーマ', startSec: 80, endSec: DURATION, source: 'manual' },
], { startSec: 0, endSec: DURATION }).sections
const CUT = 62 / 30
const D = 10.067

describe('先頭無音カットの編集項目', () => {
  it('本編は 元動画の [カット点, 末尾) だけ。先頭の無音以外は削らない（末尾は1フレーム未満の端数だけ）', () => {
    const { items, trimmedTailSec } = introCutItems(DURATION, CUT)
    expect(items).toHaveLength(1)
    expect(items[0].srcStartSec).toBeCloseTo(CUT, 10)
    expect(DURATION - items[0].srcEndSec).toBeGreaterThanOrEqual(0)
    expect(trimmedTailSec).toBeLessThan(1 / 30)
    // 長さがフレームの倍数（映像と音声を同じ長さで切れる）
    expect(Math.abs((items[0].srcEndSec - items[0].srcStartSec) * 30 - Math.round((items[0].srcEndSec - items[0].srcStartSec) * 30))).toBeLessThan(1e-6)
  })
})

describe('タイムマップの適用（映像・音声と同じマップ1つ）', () => {
  const { items } = introCutItems(DURATION, CUT)
  const r = mapMainToFinal({ items, captions, themes, mainOffsetSec: D, strict: true })

  it('captionは全件・同じ順序・同じ本文・強調・種別・改行のまま、一様に同じ秒数だけ移動する（本編0秒 = 元動画のカット点）', () => {
    expect(r.mainCaptions).toHaveLength(captions.length)
    expect(r.verification.captions.ok).toBe(true)
    r.mainCaptions.forEach((c, i) => {
      expect(c.id).toBe(captions[i].id)
      expect(c.text).toBe(captions[i].text)
      expect(c.emphasisText).toBe(captions[i].emphasisText)
      expect(c.captionType).toBe(captions[i].captionType)
      expect(c.lines).toEqual(captions[i].lines)
      expect(c.startSec).toBeCloseTo(captions[i].startSec - CUT + D, 3)
      expect(c.endSec - c.startSec).toBeCloseTo(captions[i].endSec - captions[i].startSec, 3) // 表示時間・caption内の語中無音は変わらない
    })
  })
  it('部分強調（emphasisText）の件数を維持する', () => {
    expect(r.mainCaptions.filter((c) => c.emphasisText).length).toBe(captions.filter((c) => c.emphasisText).length)
  })
  it('テーマは編集後の本編を隙間・重複なく100%被覆し、最初のテーマは本編0秒から', () => {
    expect(r.verification.themes).toMatchObject({ coverage: 1, gapSec: 0, overlapSec: 0 })
    expect(r.themesMapped[0].startSec).toBe(0)
    expect(r.themesMapped.at(-1).endSec).toBeCloseTo(r.tm.totalSec, 3)
    expect(r.themesMapped.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    const block = r.themeBlocks[0]
    expect(block.startSec).toBeCloseTo(D, 3) // 最終動画ではダイジェスト直後（本編0秒）から
    expect(block.sections[0].startSec).toBeCloseTo(D, 3)
  })
  it('手動補完captionも同じマップで変換される（別管理・既存captionは変えない）', () => {
    const rec = [{ id: 'intro-0', text: '補完です', startSec: 2.3, endSec: 3.4, source: 'manual-intro-recovery', confirmed: true, captionType: 'normal', lines: ['補完です'], emphasisText: null }]
    const withRec = mapMainToFinal({ items, captions, recovered: rec, themes, mainOffsetSec: D, strict: true })
    expect(withRec.mainCaptions).toHaveLength(captions.length + 1)
    expect(withRec.mainCaptions[0].id).toBe('intro-0')
    expect(withRec.mainCaptions[0].source).toBe('manual-intro-recovery')
    expect(withRec.mainCaptions[0].startSec).toBeCloseTo(2.3 - CUT + D, 3)
    expect(withRec.mainCaptions.slice(1).map((c) => c.id)).toEqual(captions.map((c) => c.id))
    expect(captions[0].id).toBe('c0') // 元は不変
  })
  it('カット点をまたぐcaptionがあれば（strict）エラー', () => {
    const bad = [{ ...captions[0], startSec: 1.5, endSec: 3 }, ...captions.slice(1)]
    expect(() => mapMainToFinal({ items, captions: bad, themes, mainOffsetSec: D, strict: true })).toThrow()
  })
})

describe('LINEオーバーレイ・BGM・末尾案内の時刻', () => {
  it('冒頭LINEオーバーレイは編集後本編の開始から30秒、本編BGMは本編の開始〜終了、末尾案内は本編終了の直後', () => {
    const { items } = introCutItems(DURATION, CUT)
    const tm = mapMainToFinal({ items, captions, themes, mainOffsetSec: D }).tm
    const cfg = resolveCompositionConfig({})
    const T = planTimeline(cfg, { mainStartSec: 0, mainEndSec: tm.totalSec, digestClips: [{ durationSec: D }] })
    const a = mainAnchors(T)
    expect(a.overlayStartSec).toBe(a.mainStartSec)
    expect(a.overlayEndSec - a.overlayStartSec).toBeCloseTo(30, 6)
    expect(a.bgmStartSec).toBe(a.mainStartSec)
    expect(a.bgmEndSec).toBe(a.mainEndSec)
    expect(a.outroStartSec).toBe(a.mainEndSec)
    expect(T.totalSec).toBeCloseTo(D + tm.totalSec + 12, 3)
  })
  it('ASS: 最初のcaptionの前・最初のテーマは本編0秒から。LINEオーバーレイも本編0秒から', () => {
    const { items } = introCutItems(DURATION, CUT)
    const r = mapMainToFinal({ items, captions, themes, mainOffsetSec: D })
    const cfg = resolveCompositionConfig({ line: { qrPath: '/x' } })
    const T = planTimeline(cfg, { mainStartSec: 0, mainEndSec: r.tm.totalSec, digestClips: [{ durationSec: D }] })
    const ass = buildFinalAss({ width: 1920, height: 1080, cfg, timeline: T, mainCaptions: r.mainCaptions, digestCaps: [], themeBlocks: r.themeBlocks, qrSize: { width: 554, height: 518 } })
    const t = (s) => { const c = Math.round(s * 100); return `0:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}` }
    expect(ass).toContain(`Dialogue: 19,${t(D)},${t(D + 30)}`) // LINEパネル（背景・アクセント）が本編0秒から30秒
  })
})
