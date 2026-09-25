import { describe, it, expect } from 'vitest'
import {
  estimateLineWidthPx,
  fitCaptionFontSize,
  getCaptionFitLimits,
  CAPTION_USABLE_WIDTH_RATIO,
  CAPTION_MIN_FONT_PX_1080,
  CAPTION_SIZE_LADDER_1080,
} from './captionFit.mjs'
import { getCaptionStyleDefs, planCaptionFits, buildAssContent, buildDialogueText, CAPTION_FONT_SCALE } from './captionStyles.mjs'

const W = 1920
const H = 1080
const limits = getCaptionFitLimits(W, H)
const cjk = (n) => 'あ'.repeat(n)
const fit = (lines, baseSize = 116) => fitCaptionFontSize({ lines, baseSize, minSize: limits.minSizePx, maxWidthPx: limits.maxWidthPx, ladderPx: limits.ladderPx })

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

describe('基本116pxと段階的な動的縮小（116 → 108 → 100 → 94 → 88 → 82）', () => {
  it('採用値: 1080pで normal=116px、使用可能幅は画面幅の88%、下限は82px', () => {
    expect(CAPTION_FONT_SCALE).toBe(2.066)
    expect(getCaptionStyleDefs(W, H, 1).normal.fontsize).toBe(56)
    expect(getCaptionStyleDefs(W, H).normal.fontsize).toBe(116)
    expect(CAPTION_USABLE_WIDTH_RATIO).toBe(0.88)
    expect(limits.maxWidthPx).toBe(Math.floor(W * 0.88))
    expect(limits.minSizePx).toBe(82)
    expect(CAPTION_MIN_FONT_PX_1080).toBe(82)
    expect(CAPTION_SIZE_LADDER_1080).toEqual([116, 108, 100, 94, 88, 82])
    expect((W - limits.maxWidthPx) / 2 / W).toBeGreaterThanOrEqual(0.06 - 0.001) // 左右の安全余白は各6%
  })

  it('比較候補 112 / 116 / 120px: 16文字の使用率と20文字の扱い（116pxが68〜75%と20文字88%以内を同時に満たす唯一の候補）', () => {
    const rows = [[1.994, 112], [2.066, 116], [2.137, 120]].map(([scale, px]) => {
      const size = getCaptionStyleDefs(W, H, scale).normal.fontsize
      expect(size).toBe(px)
      const usage = (n) => estimateLineWidthPx(cjk(n), size) / W
      const f20 = planCaptionFits([{ text: cjk(20), lines: [cjk(20)] }], W, H, scale)[0]
      return { px, u16: usage(16), u20: usage(20), shrunk20: f20.shrunk }
    })
    const [r112, r116, r120] = rows
    expect(r112.u16).toBeLessThan(0.68) // 112pxは16文字で68%に届かない
    expect(r116.u16).toBeGreaterThanOrEqual(0.68)
    expect(r116.u16).toBeLessThanOrEqual(0.75)
    expect(r116.u20).toBeLessThanOrEqual(0.88)
    expect(r116.shrunk20).toBe(false)
    expect(r120.u16).toBeLessThanOrEqual(0.75)
    expect(r120.u20).toBeGreaterThan(0.88) // 120pxは20文字で88%を超え、縮小が必要になる
    expect(r120.shrunk20).toBe(true)
  })

  it.each([8, 12, 16, 20])('1行%i文字は基本116pxのまま（短い字幕を縮小も拡大もしない）', (n) => {
    expect(fit([cjk(n)], 116)).toMatchObject({ size: 116, shrunk: false, fits: true })
  })

  it('1行16文字の推定使用率は68〜75%、1行20文字は88%以内', () => {
    expect(estimateLineWidthPx(cjk(16), 116) / W).toBeGreaterThanOrEqual(0.68)
    expect(estimateLineWidthPx(cjk(16), 116) / W).toBeLessThanOrEqual(0.75)
    expect(estimateLineWidthPx(cjk(20), 116) / W).toBeLessThanOrEqual(0.88)
  })

  it.each([22, 30])('2行合計%i文字（自然な2行）は基本116pxのまま', (n) => {
    expect(fit([cjk(Math.ceil(n / 2)), cjk(Math.floor(n / 2))], 116)).toMatchObject({ size: 116, shrunk: false, fits: true })
  })

  it('長文だけが、段階値(108 → 100 → 94 → 88 → 82)へ縮小される', () => {
    expect(fit([cjk(21)], 116)).toMatchObject({ size: 108, shrunk: true, fits: true })
    expect(fit([cjk(22)], 116).size).toBe(100)
    expect(fit([cjk(24)], 116).size).toBe(94)
    expect(fit([cjk(26)], 116).size).toBe(88)
    expect(fit([cjk(27)], 116).size).toBe(82)
    for (const n of [21, 22, 24, 26, 27]) expect(fit([cjk(n)], 116).widthPx).toBeLessThanOrEqual(limits.maxWidthPx)
    // 縮小は必要最小限: 1段階上のサイズでは収まらない
    expect(estimateLineWidthPx(cjk(21), 116)).toBeGreaterThan(limits.maxWidthPx)
    expect(estimateLineWidthPx(cjk(21), 108)).toBeLessThanOrEqual(limits.maxWidthPx)
  })

  it('自動縮小の下限は82px: どれだけ長くても82px未満にならず、収まらなければ警告(fits=false)', () => {
    const r = fit([cjk(40)], 116)
    expect(r.size).toBe(82)
    expect(r.fits).toBe(false)
    for (const n of [20, 24, 26, 28, 30, 40, 60]) expect(fit([cjk(n)], 116).size).toBeGreaterThanOrEqual(82)
  })

  it('82pxちょうどで収まる長さは fits=true（下限は使用してよい）', () => {
    expect(fit([cjk(27)], 116)).toMatchObject({ size: 82, fits: true })
  })

  it('サイズは 116 / 108 / 100 / 94 / 88 / 82 の段階値だけで、字幕ごとに細かく揺れない', () => {
    const sizes = new Set()
    for (let n = 8; n <= 40; n++) sizes.add(fit([cjk(n)], 116).size)
    expect([...sizes].sort((a, b) => b - a)).toEqual([116, 108, 100, 94, 88, 82])
  })

  it('2行は行ごとの最大幅で判定する（合計文字数ではなく1行あたり）', () => {
    expect(fit([cjk(20), cjk(20)], 116).shrunk).toBe(false)
    expect(fit([cjk(24), cjk(3)], 116).shrunk).toBe(true)
  })

  it('解像度が違っても比率で決まる（720pで下限≒55px、幅も88%、段階も比例）', () => {
    const l = getCaptionFitLimits(1280, 720)
    expect(l.maxWidthPx).toBe(Math.floor(1280 * 0.88))
    expect(l.minSizePx).toBe(55)
    expect(l.ladderPx[0]).toBe(77)
  })
})

describe('captionType別のサイズ（サイズ差を付けず、色・太さで役割を表す）', () => {
  const d = getCaptionStyleDefs(W, H)
  it('normal 116 / main 120〜124 / sub 108〜112 / emphasis 116', () => {
    expect(d.normal.fontsize).toBe(116)
    expect(d.main.fontsize).toBeGreaterThanOrEqual(120)
    expect(d.main.fontsize).toBeLessThanOrEqual(124)
    expect(d.sub.fontsize).toBeGreaterThanOrEqual(108)
    expect(d.sub.fontsize).toBeLessThanOrEqual(112)
    expect(d.emphasis.fontsize).toBe(116)
  })
  it('mainはnormalの1.05倍前後で、極端に大きくしない', () => {
    expect(d.main.fontsize / d.normal.fontsize).toBeGreaterThanOrEqual(1.03)
    expect(d.main.fontsize / d.normal.fontsize).toBeLessThanOrEqual(1.1)
  })
  it('normal / main / sub / emphasis のどれも108px未満にならない（subも小さく感じない）', () => {
    for (const k of ['normal', 'main', 'sub', 'emphasis']) expect(d[k].fontsize).toBeGreaterThanOrEqual(108)
  })
  it('subは小さくせず、色(淡いグレー)・太さ(標準)で役割を表す。下端余白はnormalと同じ', () => {
    expect(d.sub.primaryColour).not.toBe(d.normal.primaryColour)
    expect(d.sub.bold).toBeLessThanOrEqual(d.normal.bold)
    expect(d.sub.marginV).toBe(d.normal.marginV)
  })
  it('emphasisはサイズをnormalと同じにして、縁取りを少し太くするだけ', () => {
    expect(d.emphasis.fontsize).toBe(d.normal.fontsize)
    expect(d.emphasis.outline).toBeGreaterThanOrEqual(d.normal.outline)
  })
  it('縮小の下限(82px)はどのcaptionTypeにも共通で、82px未満にならない', () => {
    const cap = (captionType) => ({ text: cjk(40), lines: [cjk(40)], captionType })
    for (const f of planCaptionFits(['normal', 'main', 'sub', 'emphasis'].map(cap), W, H)) expect(f.size).toBeGreaterThanOrEqual(82)
  })
  it('mainやsubが縮小するときも段階値（116/108/100/94/88/82）だけを使う', () => {
    const cap = (captionType, n) => ({ text: cjk(n), lines: [cjk(n)], captionType })
    const sizes = []
    for (const t of ['main', 'sub']) for (let n = 8; n <= 30; n++) sizes.push(planCaptionFits([cap(t, n)], W, H)[0].size)
    const allowed = new Set([122, 109, 116, 108, 100, 94, 88, 82])
    for (const s of sizes) expect(allowed.has(s)).toBe(true)
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

  it('短い字幕は \\fs を付けない（スタイルの116pxのまま）', () => {
    expect(dlg(cap(cjk(16), [cjk(16)]))).not.toContain('\\fs')
  })
  it('長い字幕は先頭に1回だけ \\fs94 が付く（段階値）', () => {
    const line = dlg(cap(cjk(24), [cjk(24)]))
    expect(line).toContain('{\\fs94}')
    expect(line.match(/\\fs/g)).toHaveLength(1)
  })
  it('縮小した字幕の部分強調は、強調後の {\\r} でサイズが基本サイズへ戻らないよう {\\r\\fs94} にする', () => {
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
