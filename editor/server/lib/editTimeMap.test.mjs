import { describe, it, expect } from 'vitest'
import { buildEditTimeMap, itemsFromCuts, mapCaptions, mapThemes, verifyThemeCoverage, verifyMappedCaptions } from './editTimeMap.mjs'
import { resolveCompositionConfig, planTimeline, buildCompositionArgs, planQrWindows } from './finalComposition.mjs'

const cap = (i, a, b, extra = {}) => ({ id: `c${i}`, text: `文${i}。`, lines: [`文${i}。`], startSec: a, endSec: b, captionType: 'normal', emphasisText: null, displayOrder: i, ...extra })
const themes = [
  { id: 't1', title: 'A', startSec: 0, endSec: 30 },
  { id: 't2', title: 'B', startSec: 30, endSec: 60 },
]
// 元動画 60秒。10.0〜12.0 と 40.0〜43.0 をカット（合計5秒）
const cuts = [{ cutStartSec: 10, cutEndSec: 12 }, { cutStartSec: 40, cutEndSec: 43 }]
const tm = buildEditTimeMap(itemsFromCuts(60, cuts))

describe('タイムマップ: 元動画時刻 → 編集後時刻', () => {
  it('カット前・直前・カット内・直後・後の時刻を決定的に変換する', () => {
    expect(tm.mapPoint(5)).toBe(5) // カット前
    expect(tm.mapPoint(10)).toBe(10) // カット開始（残る側の終端）
    expect(tm.mapPoint(11)).toBeNull() // カット内は残らない
    expect(tm.mapPoint(12)).toBe(10) // カット直後 = カット点と同じ編集後時刻
    expect(tm.mapPoint(20)).toBe(18) // 2秒詰まる
    expect(tm.mapPoint(43)).toBe(38) // 2回目のカット後（累計5秒詰まる）
    expect(tm.mapPoint(60)).toBe(55)
    expect(tm.totalSec).toBe(55)
    expect(tm.keptSec).toBe(55)
  })
  it('区間の開始・終了は、カット内の時刻でも隙間なく写る', () => {
    expect(tm.mapStart(11)).toBe(10) // 次に残る時刻
    expect(tm.mapEnd(11)).toBe(10) // 直前に残る時刻
  })
  it('同じ入力から常に同じ結果（決定的）', () => {
    const again = buildEditTimeMap(itemsFromCuts(60, cuts))
    expect(JSON.stringify(again.items)).toBe(JSON.stringify(tm.items))
  })
  it('重なる区間・逆順・長さ0は拒否する', () => {
    expect(() => buildEditTimeMap([{ kind: 'seg', srcStartSec: 10, srcEndSec: 20 }, { kind: 'seg', srcStartSec: 15, srcEndSec: 30 }])).toThrow()
    expect(() => buildEditTimeMap([{ kind: 'seg', srcStartSec: 10, srcEndSec: 10 }])).toThrow()
    expect(() => itemsFromCuts(60, [{ cutStartSec: 10, cutEndSec: 20 }, { cutStartSec: 15, cutEndSec: 25 }])).toThrow()
  })
})

describe('caption・テーマ・強調の不変性', () => {
  const caps = [cap(0, 1, 3), cap(1, 4, 9.8, { emphasisText: '文' }), cap(2, 12.2, 15), cap(3, 35, 39.8), cap(4, 43.2, 50)]
  it('caption本文・順序・強調・種別・改行を変えず、時刻だけ変換する（欠落・重複なし）', () => {
    const mapped = mapCaptions(caps, tm, { strict: true })
    expect(verifyMappedCaptions(caps, mapped)).toEqual({ ok: true, problems: [] })
    expect(mapped.map((c) => c.text)).toEqual(caps.map((c) => c.text))
    expect(mapped[2].startSec).toBeCloseTo(10.2, 3) // カット直後のcaption
    expect(mapped[4].startSec).toBeCloseTo(38.2, 3)
    expect(mapped[1].emphasisText).toBe('文')
    expect(caps[1].startSec).toBe(4) // 入力は変更しない
  })
  it('カット点をまたぐcaption・カット内のcaptionは、strictでエラー', () => {
    expect(() => mapCaptions([cap(0, 9, 11)], tm, { strict: true })).toThrow()
    expect(() => mapCaptions([cap(0, 10.5, 11.5)], tm, { strict: true })).toThrow()
  })
  it('検証関数は、本文の変更・欠落・重なりを検出する', () => {
    const mapped = mapCaptions(caps, tm, { strict: true })
    expect(verifyMappedCaptions(caps, mapped.slice(1)).ok).toBe(false)
    expect(verifyMappedCaptions(caps, mapped.map((c, i) => (i === 0 ? { ...c, text: '違う' } : c))).ok).toBe(false)
    expect(verifyMappedCaptions(caps, mapped.map((c, i) => (i === 1 ? { ...c, startSec: 0.5 } : c))).ok).toBe(false)
  })
  it('トークテーマは編集後も100%覆われ、空白・重複が0（カットをまたぐテーマは1つに結合）', () => {
    const m = mapThemes(themes, tm)
    expect(m.map((t) => t.id)).toEqual(['t1', 't2']) // 順序・件数は不変
    expect(m[0].startSec).toBe(0)
    expect(m[1].endSec).toBeCloseTo(55, 3)
    const v = verifyThemeCoverage(m, tm)
    expect(v.coverage).toBe(1)
    expect(v.gapSec).toBeCloseTo(0, 6)
    expect(v.overlapSec).toBeCloseTo(0, 6)
  })
  it('テーマ境界がカットの中にあっても、境界は1点に写り、空白・重複が出ない', () => {
    const t2 = [{ id: 'a', title: 'A', startSec: 0, endSec: 11 }, { id: 'b', title: 'B', startSec: 11, endSec: 60 }]
    const m = mapThemes(t2, tm)
    expect(m[0].endSec).toBe(m[1].startSec)
    const v = verifyThemeCoverage(m, tm)
    expect(v.coverage).toBe(1)
    expect(v.gapSec).toBeCloseTo(0, 6)
    expect(v.overlapSec).toBeCloseTo(0, 6)
  })
})

describe('映像・音声へ同じカットを適用 / LINEオーバーレイ・末尾案内の位置', () => {
  const cfg = resolveCompositionConfig({ digest: { enabled: false } })
  const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: tm.totalSec, digestClips: [] })
  it('冒頭LINEオーバーレイは編集後本編の最初の30秒、末尾案内は編集後本編の終了後に12秒', () => {
    const main = timeline.sections.find((s) => s.kind === 'main')
    const outro = timeline.sections.find((s) => s.kind === 'lineOutro')
    expect(timeline.overlays[0]).toMatchObject({ startSec: main.startSec, endSec: main.startSec + 30 })
    expect(main.endSec - main.startSec).toBeCloseTo(tm.totalSec, 3)
    expect(outro.startSec).toBeCloseTo(main.endSec, 3)
    expect(outro.endSec - outro.startSec).toBe(12)
    expect(timeline.totalSec).toBeCloseTo(tm.totalSec + 12, 3)
    const qr = planQrWindows(cfg, timeline)
    expect(qr.map((w) => w.kind)).toEqual(['lineIntro', 'lineOutro'])
  })
  it('映像と音声に、同じ区間・同じ順序・同じ長さのトリムを適用し、音声の編集点にだけ短いフェード（長いクロスフェードなし）', () => {
    const { filterComplex, args } = buildCompositionArgs({ cfg, timeline, width: 1920, height: 1080, sourcePath: '/src.mov', mainStartSec: 0, mainEndSec: tm.totalSec, mainItems: tm.items, digestClips: [], qrPath: '/qr.png', qrSize: { width: 554, height: 518 }, assPath: '/a.ass', outputPath: '/o.mp4' })
    const segs = tm.items.filter((i) => i.kind === 'seg')
    expect(args.filter((a) => a === '-ss')).toHaveLength(segs.length)
    for (let k = 0; k < segs.length; k++) {
      const frames = Math.round((segs[k].srcEndSec - segs[k].srcStartSec) * 30)
      expect(filterComplex).toContain(`trim=end_frame=${frames}`)
      // 映像のフレーム数と音声のサンプル数（1フレーム=1600サンプル@48kHz）が同じ長さ。区間の先頭が0でなければ、半フレーム手前からシークして先頭のサンプルを切り落とす
      const m = new RegExp(`atrim=(?:start_sample=(\\d+):)?end_sample=(\\d+)`, 'g')
      const lens = [...filterComplex.matchAll(m)].map((x) => Number(x[2]) - Number(x[1] ?? 0))
      expect(lens).toContain(frames * 1600)
    }
    expect(filterComplex).not.toContain('acrossfade')
    expect(filterComplex.match(/afade=t=in:st=0:d=0\.02/g)?.length).toBe(segs.length - 1)
    expect(filterComplex.match(/afade=t=out/g)?.length).toBe(segs.length - 1)
    expect(filterComplex).toContain(`concat=n=${segs.length + 1}:v=1:a=1`) // 本編の区間 + 末尾案内
  })
  it('編集点は30fpsのフレーム境界（長さがフレームの整数倍）で、音声の長さと映像の長さが一致する', () => {
    const items = itemsFromCuts(60, [{ cutStartSec: 10.0333333, cutEndSec: 12.0333333 }].map((c) => ({ cutStartSec: Math.round(c.cutStartSec * 30) / 30, cutEndSec: Math.round(c.cutEndSec * 30) / 30 })))
    for (const s of items) expect(Math.abs((s.srcEndSec - s.srcStartSec) * 30 - Math.round((s.srcEndSec - s.srcStartSec) * 30))).toBeLessThan(0.02)
  })
})
