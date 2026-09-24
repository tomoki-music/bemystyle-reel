import { describe, it, expect } from 'vitest'
import {
  estimateLineWidthPx,
  fitCaptionFontSize,
  getCaptionFitLimits,
  CAPTION_USABLE_WIDTH_RATIO,
  CAPTION_MIN_FONT_PX_1080,
  CAPTION_SHRINK_STEP_PX,
} from './captionFit.mjs'
import { getCaptionStyleDefs, planCaptionFits, buildAssContent, buildDialogueText, CAPTION_FONT_SCALE } from './captionStyles.mjs'

const W = 1920
const H = 1080
const limits = getCaptionFitLimits(W, H)
const cjk = (n) => 'あ'.repeat(n)
const fit = (lines, baseSize = 100) => fitCaptionFontSize({ lines, baseSize, minSize: limits.minSizePx, maxWidthPx: limits.maxWidthPx })

describe('文字幅の推定（実際のNoto Sans CJK JP + libass描画の実測で校正）', () => {
  // 実測値(1080p, 100px, 太字, 縁取り込みの見た目の幅)。assRenderMeasure の実描画テストでも同じ条件を照合する。
  const measured = [
    [cjk(8), 576],
    [cjk(16), 1158],
    [cjk(20), 1447],
    ['22222222', 381],
    ['ABCDEFGHIJ', 550],
  ]
  it.each(measured)('%s は実測値と2%%以内で一致し、実測を下回らない（過剰な保守でもない）', (text, px) => {
    const est = estimateLineWidthPx(text, 100)
    expect(est).toBeGreaterThanOrEqual(px)
    expect(est / px).toBeLessThan(1.02)
  })

  it('「全角1文字=1em」の保守的な推定より小さい（過剰に縮小しない）', () => {
    expect(estimateLineWidthPx(cjk(16), 100)).toBeLessThan(1600 * 0.75)
  })
})

describe('基本100pxと動的縮小', () => {
  it('採用値: 1080pで normal=100px、使用可能幅は画面幅の88%、下限は82px', () => {
    expect(CAPTION_FONT_SCALE).toBe(1.78)
    expect(getCaptionStyleDefs(W, H).normal.fontsize).toBe(100)
    expect(CAPTION_USABLE_WIDTH_RATIO).toBe(0.88)
    expect(limits.maxWidthPx).toBe(Math.floor(W * 0.88))
    expect(limits.minSizePx).toBe(82)
    expect(CAPTION_MIN_FONT_PX_1080).toBe(82)
    // 左右の安全余白は各6%以上
    expect((W - limits.maxWidthPx) / 2 / W).toBeGreaterThanOrEqual(0.06 - 0.001)
  })

  it.each([8, 12, 16, 20])('1行%i文字は基本100pxのまま（短い字幕を縮小も拡大もしない）', (n) => {
    const r = fit([cjk(n)])
    expect(r).toMatchObject({ size: 100, shrunk: false, fits: true })
  })

  it.each([22, 30])('2行合計%i文字（自然な2行）は基本100pxのまま', (n) => {
    const r = fit([cjk(Math.ceil(n / 2)), cjk(Math.floor(n / 2))])
    expect(r).toMatchObject({ size: 100, shrunk: false, fits: true })
  })

  it('長文だけが縮小される: 使用可能幅を超える行のときだけ、6px刻みで下げる', () => {
    const r24 = fit([cjk(24)])
    expect(r24.shrunk).toBe(true)
    expect(r24.size).toBe(94)
    expect(r24.widthPx).toBeLessThanOrEqual(limits.maxWidthPx)
    const r25 = fit([cjk(25)])
    expect(r25.size).toBeLessThan(100)
    expect(100 - r25.size).toBeGreaterThanOrEqual(CAPTION_SHRINK_STEP_PX)
    // 縮小は必要最小限: 1段階上のサイズでは収まらない
    expect(estimateLineWidthPx(cjk(24), 100)).toBeGreaterThan(limits.maxWidthPx)
    expect(estimateLineWidthPx(cjk(24), 94)).toBeLessThanOrEqual(limits.maxWidthPx)
  })

  it('自動縮小の下限は82px: どれだけ長くても82px未満にならず、収まらなければ警告(fits=false)', () => {
    const r = fit([cjk(40)])
    expect(r.size).toBe(82)
    expect(r.fits).toBe(false)
    for (const n of [20, 24, 26, 28, 30, 40, 60]) expect(fit([cjk(n)]).size).toBeGreaterThanOrEqual(82)
  })

  it('82pxちょうどで収まる長さは fits=true（下限は使用してよい）', () => {
    const r = fit([cjk(27)])
    expect(r.size).toBe(82)
    expect(r.fits).toBe(true)
  })

  it('サイズは 100 / 94 / 88 / 82 の段階に丸められ、字幕ごとに細かく揺れない', () => {
    const sizes = new Set()
    for (let n = 8; n <= 40; n++) sizes.add(fit([cjk(n)]).size)
    expect([...sizes].sort((a, b) => b - a)).toEqual([100, 94, 88, 82])
  })

  it('2行は行ごとの最大幅で判定する（合計文字数ではなく1行あたり）', () => {
    expect(fit([cjk(20), cjk(20)]).shrunk).toBe(false)
    expect(fit([cjk(24), cjk(3)]).shrunk).toBe(true)
  })

  it('解像度が違っても比率で決まる（720pで下限≒55px、幅も88%）', () => {
    const l = getCaptionFitLimits(1280, 720)
    expect(l.maxWidthPx).toBe(Math.floor(1280 * 0.88))
    expect(l.minSizePx).toBe(55)
  })
})

describe('captionType別のサイズ（極端な差を付けない）', () => {
  const d = getCaptionStyleDefs(W, H)
  it('normal 100 / main 104〜108 / sub 94〜100 / emphasis 100', () => {
    expect(d.normal.fontsize).toBe(100)
    expect(d.main.fontsize).toBeGreaterThanOrEqual(104)
    expect(d.main.fontsize).toBeLessThanOrEqual(108)
    expect(d.sub.fontsize).toBeGreaterThanOrEqual(94)
    expect(d.sub.fontsize).toBeLessThanOrEqual(100)
    expect(d.emphasis.fontsize).toBe(100)
  })
  it('normal / main / sub / emphasis のどれも94px未満にならない（subも小さく感じない）', () => {
    for (const k of ['normal', 'main', 'sub', 'emphasis']) expect(d[k].fontsize).toBeGreaterThanOrEqual(94)
  })
  it('subは小さくせず、色(淡いグレー)・太さ(標準)・縁取りで役割を表す。下端余白はnormalと同じ', () => {
    expect(d.sub.primaryColour).not.toBe(d.normal.primaryColour)
    expect(d.sub.bold).toBeLessThanOrEqual(d.normal.bold)
    expect(d.sub.marginV).toBe(d.normal.marginV)
    expect(d.sub.outline).toBeGreaterThan(0)
  })
  it('emphasisはサイズをnormalと同じにして、縁取りを少し太くするだけ', () => {
    expect(d.emphasis.fontsize).toBe(d.normal.fontsize)
    expect(d.emphasis.outline).toBeGreaterThanOrEqual(d.normal.outline)
  })
  it('縮小の下限(82px)はどのcaptionTypeにも共通で、82px未満にならない', () => {
    const cap = (captionType) => ({ text: cjk(40), lines: [cjk(40)], captionType })
    for (const f of planCaptionFits(['normal', 'main', 'sub', 'emphasis'].map(cap), W, H)) expect(f.size).toBeGreaterThanOrEqual(82)
  })
  it('縁取りは文字サイズに比例し、文字内部を潰さない太さ(3〜8%)', () => {
    for (const k of ['normal', 'main', 'sub', 'emphasis']) {
      expect(d[k].outline / d[k].fontsize).toBeGreaterThanOrEqual(0.03)
      expect(d[k].outline / d[k].fontsize).toBeLessThanOrEqual(0.08)
    }
    expect(d.normal.outline / getCaptionStyleDefs(W, H, 1).normal.outline).toBeCloseTo(CAPTION_FONT_SCALE, 1)
  })
})

describe('ASS出力: 縮小した字幕だけに \\fs が付く（強調後もサイズ不変）', () => {
  const cap = (text, lines, emphasisText = null) => ({ startSec: 0, endSec: 2, text, lines, emphasisText, captionType: 'normal', displayOrder: 0 })
  const dlg = (c) => buildAssContent({ width: W, height: H, captions: [c] }).split('\n').find((l) => l.startsWith('Dialogue:'))

  it('短い字幕は \\fs を付けない（スタイルの100pxのまま）', () => {
    expect(dlg(cap(cjk(16), [cjk(16)]))).not.toContain('\\fs')
  })
  it('長い字幕は先頭に1回だけ \\fs94 が付く', () => {
    const line = dlg(cap(cjk(24), [cjk(24)]))
    expect(line).toContain('{\\fs94}')
    expect(line.match(/\\fs/g)).toHaveLength(1)
  })
  it('縮小した字幕の部分強調は、強調後の {\\r} でサイズが100pxへ戻らないよう {\\r\\fs94} にする', () => {
    const text = 'あ'.repeat(10) + '大事な言葉' + 'い'.repeat(9)
    const out = buildDialogueText({ text, lines: [text], emphasisText: '大事な言葉' }, '&H004AB3F0&', 94)
    expect(out).toContain('{\\fs94}')
    expect(out).toContain('{\\r\\fs94}')
    expect(out).not.toMatch(/\{\\r\}/)
  })
  it('縮小していない字幕の部分強調は従来どおり {\\r}（サイズ指定なし）', () => {
    const out = buildDialogueText({ text: 'これは大事です', lines: ['これは大事です'], emphasisText: '大事' }, '&H004AB3F0&')
    expect(out).toContain('{\\r}')
    expect(out).not.toContain('\\fs')
  })
})
