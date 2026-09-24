import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { inkLines, measureCaptionRender } from './assRenderMeasure.mjs'
import { withTempDir } from './tempDir.mjs'
import { planCaptionFits } from './captionStyles.mjs'
import { estimateLineWidthPx } from './captionFit.mjs'

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true })

const W = 1920
const H = 1080

describe('inkLines（純粋関数）', () => {
  it('背景(128)との差が大きい画素の行ごとの外接矩形を返す', () => {
    const w = 20
    const h = 20
    const g = new Uint8Array(w * h).fill(128)
    for (let y = 2; y <= 4; y++) for (let x = 3; x <= 10; x++) g[y * w + x] = 255
    for (let y = 12; y <= 14; y++) for (let x = 5; x <= 15; x++) g[y * w + x] = 0
    const ink = inkLines(g, w, h)
    expect(ink.lines).toEqual([
      { top: 2, bottom: 4, left: 3, right: 10 },
      { top: 12, bottom: 14, left: 5, right: 15 },
    ])
    expect([ink.left, ink.right]).toEqual([3, 15])
  })
  it('インクが無ければ null', () => {
    expect(inkLines(new Uint8Array(100).fill(128), 10, 10)).toBeNull()
  })
})

// 実際のffmpeg(libass) + Noto Sans CJK JP で描画して測る。環境に無い場合はスキップする。
const canRender = Boolean(process.env.FFMPEG_BIN)
const pool = Array.from('これは表示幅を測るための合成文字列です今日は天気が良いので散歩に出かけます')
const L = (n) => pool.slice(0, n).join('')
const conditions = [
  { name: '1行8文字', lines: [L(8)] },
  { name: '1行12文字', lines: [L(12)] },
  { name: '1行16文字', lines: [L(16)] },
  { name: '1行20文字', lines: [L(20)] },
  { name: '2行合計22文字', lines: [L(11), L(11)] },
  { name: '2行合計30文字', lines: [L(15), L(15)] },
  { name: '部分強調を含む1行', lines: ['これはとても大事な話です'], emphasisText: 'とても大事' },
  { name: '部分強調を含む2行', lines: ['これはとても大事な', 'ですよね本当に'], emphasisText: 'とても大事' },
  { name: '24文字(縮小)', lines: [L(24)] },
]

describe.skipIf(!canRender)('実表示幅の検証（実フォント + libass 描画）', () => {
  it('全条件で、88%以内・左右6%以上の余白・最大2行・下部35%以内・下端5%以上の余白に収まる', async () => {
    const rows = []
    await withTempDir('lcv-measure-test-', async (tmpDir) => {
      for (const [i, c] of conditions.entries()) {
        const cap = { text: c.lines.join(''), lines: c.lines, emphasisText: c.emphasisText ?? null }
        const plan = planCaptionFits([cap], W, H)[0]
        const r = await measureCaptionRender({ caption: cap, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: `t${i}` })
        rows.push({ c, plan, r })
      }
    })
    for (const { c, plan, r } of rows) {
      expect(r.overflow, c.name).toBe(false)
      expect(r.usageRatio, c.name).toBeLessThanOrEqual(0.88)
      expect(Math.min(r.leftMarginPx, r.rightMarginPx), c.name).toBeGreaterThanOrEqual(W * 0.06)
      expect(r.lineCount, c.name).toBe(c.lines.length)
      expect(r.topPx, c.name).toBeGreaterThanOrEqual(H * 0.65)
      expect(r.bottomMarginPx, c.name).toBeGreaterThanOrEqual(H * 0.05)
      expect(plan.size, c.name).toBeGreaterThanOrEqual(82)
    }
  }, 60000)

  it('推定式は実描画と2%以内で一致する（縁取り込みの見た目の幅）', async () => {
    await withTempDir('lcv-measure-test-', async (tmpDir) => {
      for (const [i, c] of conditions.entries()) {
        const cap = { text: c.lines.join(''), lines: c.lines, emphasisText: c.emphasisText ?? null }
        const plan = planCaptionFits([cap], W, H)[0]
        const r = await measureCaptionRender({ caption: cap, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: `e${i}` })
        const est = Math.max(...c.lines.map((l) => estimateLineWidthPx(l, plan.size)))
        expect(est / r.measuredWidthPx, c.name).toBeGreaterThanOrEqual(0.995)
        expect(est / r.measuredWidthPx, c.name).toBeLessThanOrEqual(1.02)
      }
    })
  }, 60000)

  it('部分強調で文字サイズ・行の高さ・位置が変わらない', async () => {
    await withTempDir('lcv-measure-test-', async (tmpDir) => {
      const lines = ['これはとても大事な', 'ですよね本当に']
      const base = { text: lines.join(''), lines, emphasisText: null }
      const emph = { ...base, emphasisText: 'とても大事' }
      const a = await measureCaptionRender({ caption: base, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: 'a' })
      const b = await measureCaptionRender({ caption: emph, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: 'b' })
      expect(b.measuredWidthPx).toBe(a.measuredWidthPx)
      expect(b.linePitchPx).toBe(a.linePitchPx)
      expect(b.topPx).toBe(a.topPx)
      expect(b.bottomPx).toBe(a.bottomPx)
      expect(Math.abs(b.lineHeightsPx[0] - a.lineHeightsPx[0])).toBeLessThanOrEqual(2)
    })
  }, 60000)

  it('縮小した字幕(24文字)は強調を含んでも、行全体が同じサイズで描画される（強調後にサイズが戻らない）', async () => {
    await withTempDir('lcv-measure-test-', async (tmpDir) => {
      const text = L(24)
      const plain = { text, lines: [text], emphasisText: null }
      const emph = { ...plain, emphasisText: text.slice(8, 12) }
      const a = await measureCaptionRender({ caption: plain, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: 'p' })
      const b = await measureCaptionRender({ caption: emph, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: 'q' })
      expect(b.measuredWidthPx).toBe(a.measuredWidthPx)
      expect(b.usageRatio).toBeLessThanOrEqual(0.88)
    })
  }, 60000)
})
