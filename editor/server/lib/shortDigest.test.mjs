import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { buildShortDigest, shortDigestCaptions, SHORT_DIGEST_DEFAULTS } from './shortDigest.mjs'
import { buildFinalAss, planDigestCaptionSizes, DIGEST_CAPTION_SIZE_RATIO, resolveCompositionConfig, planTimeline } from './finalComposition.mjs'
import { renderCompositionToFile } from './compositionRender.mjs'
import { withTempDir } from './tempDir.mjs'

const c = (i, a, b, text, extra = {}) => ({ id: `c${i}`, startSec: a, endSec: b, text, lines: [text], captionType: 'normal', emphasisText: null, displayOrder: i, ...extra })
// 0:文1(前置き) 1-2:結論 3:前置き 4-5:理由 6:告知 7-8:別の話題 9:結論の続き(同じテーマ)
const captions = [
  c(0, 0, 3, '前置きの文です。'),
  c(1, 10, 12, '違うんであれば無理して一緒に'), c(2, 12, 14.5, 'やる必要はありません。'),
  c(3, 20, 22, 'つなぎの文です。'),
  c(4, 30, 32.5, '音楽好きといっても'), c(5, 32.5, 35, '目的熱量は違いますよと。'),
  c(6, 40, 43, 'チャンネル登録をお願いします。'),
  c(7, 50, 52, '別の話題の前半で、'), c(8, 52, 55, '別の話題の結論です。'),
  c(9, 60, 63, '同じテーマの文です。'),
]
const themes = [
  { id: 't1', title: 'テーマ1', startSec: 0, endSec: 25 },
  { id: 't2', title: 'テーマ2', startSec: 25, endSec: 45 },
  { id: 't3', title: 'テーマ3', startSec: 45, endSec: 70 },
]
// 3クリップ（各約3.3秒）の例
const threeClips = {
  captions: [c(0, 5, 8.2, '一つ目の結論です。'), c(1, 20, 23.2, '二つ目の理由です。'), c(2, 40, 43.2, '三つ目の問いかけです。')],
  themes: [{ id: 'a', title: 'A', startSec: 0, endSec: 15 }, { id: 'b', title: 'B', startSec: 15, endSec: 30 }, { id: 'c', title: 'C', startSec: 30, endSec: 60 }],
  picks: [{ firstIndex: 0, lastIndex: 0, emphasisText: '結論' }, { firstIndex: 1, lastIndex: 1, emphasisText: '理由' }, { firstIndex: 2, lastIndex: 2 }],
}
const good = [{ firstIndex: 1, lastIndex: 2, emphasisText: '無理して一緒に' }, { firstIndex: 4, lastIndex: 5, emphasisText: '違います' }]

describe('短いダイジェスト（約10秒・2〜3クリップ）', () => {
  it('合計9〜12秒・2〜3クリップ・各クリップ約3〜5秒（文頭〜文末・フレーム境界）', () => {
    for (const picks of [good, threeClips.picks]) {
      const d = buildShortDigest(picks === good ? captions : threeClips.captions, picks === good ? themes : threeClips.themes, picks)
      expect(d.problems).toEqual([])
      expect(d.ok).toBe(true)
      expect(d.clips.length).toBeGreaterThanOrEqual(2)
      expect(d.clips.length).toBeLessThanOrEqual(3)
      expect(d.totalSec).toBeGreaterThanOrEqual(9)
      expect(d.totalSec).toBeLessThanOrEqual(12)
      for (const k of d.clips) {
        expect(k.durationSec).toBeGreaterThanOrEqual(2.5)
        expect(k.durationSec).toBeLessThanOrEqual(6.5)
        expect(Math.abs(k.srcStartSec * 30 - Math.round(k.srcStartSec * 30))).toBeLessThan(0.02)
        expect(Math.abs(k.srcEndSec * 30 - Math.round(k.srcEndSec * 30))).toBeLessThan(0.02)
      }
    }
    expect(buildShortDigest(threeClips.captions, threeClips.themes, threeClips.picks).clips).toHaveLength(3)
  })
  it('クリップが1つ・4つ、合計が9秒未満・12秒超は不合格', () => {
    expect(buildShortDigest(captions, themes, [good[0]]).ok).toBe(false)
    expect(buildShortDigest(captions, themes, [{ firstIndex: 1, lastIndex: 2 }, { firstIndex: 4, lastIndex: 5 }, { firstIndex: 7, lastIndex: 8 }, { firstIndex: 9, lastIndex: 9 }]).ok).toBe(false)
    expect(buildShortDigest(captions, themes, [{ firstIndex: 2, lastIndex: 2 }, { firstIndex: 5, lastIndex: 5 }]).problems.join()).toContain('文の途中')
  })
  it('文の途中から始まる・終わる範囲、チャンネル紹介・登録・LINE案内の発言、同じテーマの繰り返しは不合格', () => {
    expect(buildShortDigest(captions, themes, [{ firstIndex: 2, lastIndex: 2 }, good[1]]).problems.join()).toContain('文の途中から')
    expect(buildShortDigest(captions, themes, [good[0], { firstIndex: 4, lastIndex: 4 }]).problems.join()).toContain('文の途中で終わ')
    expect(buildShortDigest(captions, themes, [good[0], { firstIndex: 6, lastIndex: 6 }]).problems.join()).toContain('LINE案内・告知')
    expect(buildShortDigest(captions, themes, [{ firstIndex: 7, lastIndex: 8 }, { firstIndex: 9, lastIndex: 9 }]).problems.join()).toContain('繰り返し')
  })
  it('強調は1クリップ最大1か所・字幕本文の完全な部分文字列・全文でない', () => {
    expect(buildShortDigest(captions, themes, [good[0], { firstIndex: 4, lastIndex: 5, emphasisText: '存在しない語' }]).problems.join()).toContain('部分文字列')
    expect(buildShortDigest(captions, themes, [{ firstIndex: 1, lastIndex: 2, emphasisText: 'やる必要はありません。' }, good[1]]).problems.join()).toContain('全文')
    const d = buildShortDigest(captions, themes, good)
    expect(d.clips.every((k) => (k.emphasis ? 1 : 0) <= 1)).toBe(true)
  })
})

describe('ダイジェスト字幕の強調表示', () => {
  const d = buildShortDigest(captions, themes, good)
  it('強調はダイジェスト用のコピーだけに付き、本編側のcaptionは変更しない', () => {
    const before = JSON.stringify(captions)
    const dc = shortDigestCaptions(captions, d.clips)
    expect(JSON.stringify(captions)).toBe(before)
    const emph = dc.filter((x) => x.emphasisText)
    expect(emph).toHaveLength(2) // クリップごとに1か所
    for (const e of emph) expect(e.text.includes(e.emphasisText)).toBe(true)
    expect(dc.filter((x) => x.digestClipFirstIndex === 1 && x.emphasisText)).toHaveLength(1)
  })
  it('サイズは本編の通常字幕より約5〜10%大きい', () => {
    const dc = shortDigestCaptions(captions, d.clips)
    const sizes = planDigestCaptionSizes(1920, 1080, dc)
    for (const s of sizes) {
      expect(s.size / s.mainSize).toBeGreaterThanOrEqual(1.05)
      expect(s.size / s.mainSize).toBeLessThanOrEqual(1.1)
    }
    expect(DIGEST_CAPTION_SIZE_RATIO).toBeGreaterThanOrEqual(1.05)
    expect(DIGEST_CAPTION_SIZE_RATIO).toBeLessThanOrEqual(1.1)
  })
  it('ASSのダイジェスト字幕は大きいサイズ指定と琥珀色の部分強調を持ち、本編の字幕は通常どおり', () => {
    const cfg = resolveCompositionConfig({ digest: { minSec: 9, maxSec: 12, durationSec: 10 } })
    const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: 10, digestClips: d.clips })
    const dc = shortDigestCaptions(captions, d.clips)
    const main = [{ ...c(99, timeline.mainOffsetSec + 1, timeline.mainOffsetSec + 3, '本編の文です。', { emphasisText: '本編' }) }]
    const ass = buildFinalAss({ width: 1920, height: 1080, cfg, timeline, mainCaptions: main, digestCaps: dc, themeBlocks: [], qrSize: { width: 554, height: 518 }, digestStyle: 'strong' })
    const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'))
    const digestLines = lines.filter((l) => l.includes('\\fs126'))
    expect(digestLines.length).toBe(dc.length)
    expect(digestLines.filter((l) => /\\c0*4AB3F0&/i.test(l))).toHaveLength(2)
    const mainLine = lines.find((l) => l.includes('本編'))
    expect(mainLine).toBeTruthy()
    expect(mainLine.includes('\\fs126')).toBe(false)
    expect(digestLines.every((l) => !l.includes('\\N\\N'))).toBe(true) // 最大2行
  })
})

describe('既存動画を上書きしない・一時ファイルの削除', () => {
  it('出力先に同名のファイルがあれば、上書きせずに失敗する（既存ファイルは無変更）', async () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'lcv-test-'))
    try {
      const finalPath = join(dir, 'existing.mp4')
      writeFileSync(finalPath, 'ORIGINAL')
      await expect(renderCompositionToFile({ finalPath, tmpDir: dir })).rejects.toThrow('上書きしません')
      expect(existsSync(finalPath)).toBe(true)
      expect(require('fs').readFileSync(finalPath, 'utf-8')).toBe('ORIGINAL')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('レンダーが失敗したとき、隠しの一時動画とASSを削除する', async () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'lcv-test-'))
    try {
      const cfg = resolveCompositionConfig({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false }, qr: { enabled: false } })
      const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: 5, digestClips: [] })
      const spawnFn = () => {
        const { EventEmitter } = require('events')
        const ch = new EventEmitter()
        ch.stdout = new EventEmitter()
        ch.stderr = new EventEmitter()
        setImmediate(() => ch.emit('close', 1, null))
        return ch
      }
      await expect(renderCompositionToFile({ cfg, timeline, width: 1920, height: 1080, sourcePath: '/s.mov', mainStartSec: 0, mainEndSec: 5, digestClips: [], assText: '', tmpDir: dir, finalPath: join(dir, 'out.mp4'), spawnFn })).rejects.toThrow()
      expect(readdirSync(dir).filter((n) => n.startsWith('.rendering-') || n.endsWith('.ass'))).toEqual([])
      expect(existsSync(join(dir, 'out.mp4'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('一時ディレクトリは処理後（例外時も）削除される', async () => {
    let seen = ''
    const { removed } = await withTempDir('lcv-cuts-test-', (d) => { seen = d })
    expect(removed).toBe(true)
    expect(existsSync(seen)).toBe(false)
    await expect(withTempDir('lcv-cuts-test-', (d) => { seen = d; throw new Error('x') })).rejects.toThrow()
    expect(existsSync(seen)).toBe(false)
  })
})
