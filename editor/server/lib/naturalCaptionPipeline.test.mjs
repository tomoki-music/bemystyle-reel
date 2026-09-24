import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildNaturalCaptions } from './naturalCaptionPipeline.mjs'
import { withTempDir } from './tempDir.mjs'
import { buildAssContent } from './captionStyles.mjs'
import { buildComparisonOutputPath } from './outputNaming.mjs'

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object') deepFreeze(v)
  })
  return Object.freeze(o)
}
function tokensFor(text, perChar = 0.12) {
  const out = []
  let t = 0
  for (const ch of text) {
    if (/[、。！？]/.test(ch)) continue
    out.push({ text: ch, startSec: t, endSec: t + perChar, p: 0.9 })
    t += perChar
  }
  return out
}
const LEGACY = [
  { id: 'a', startSec: 100, endSec: 103.5, text: '今日はとても良い天気ですね。', captionType: 'main', emphasisText: null, displayOrder: 0 },
  { id: 'b', startSec: 103.5, endSec: 107, text: '散歩に出かけて公園で花を見て、', captionType: 'sub', emphasisText: null, displayOrder: 1 },
  { id: 'c', startSec: 107, endSec: 111, text: '帰りにパンを買って家で食べました。', captionType: 'emphasis', emphasisText: null, displayOrder: 2 },
]
const TEXT = LEGACY.map((c) => c.text).join('')
const run = (extra = {}, legacy = LEGACY, tokens = tokensFor(TEXT)) =>
  buildNaturalCaptions({ legacyCaptions: legacy, windowStartSec: 100, windowDurationSec: 12, tokens, silences: [], ...extra })

describe('buildNaturalCaptions', () => {
  it('正本を連結で保持し、全captionは統一された normal スタイル・\\N無し・最大2行', () => {
    const r = run()
    expect(r.captions.map((c) => c.text).join('')).toBe(TEXT)
    for (const c of r.captions) {
      expect(c.captionType).toBe('normal') // captionTypeにかかわらず統一されたベースデザイン
      expect(c.text).not.toMatch(/\\N|[\r\n]/)
      expect(c.lines.length).toBeLessThanOrEqual(2)
      expect(c.text.length).toBeLessThanOrEqual(30)
    }
  })

  it('既存caption・トークン・無音を変更しない（deep freezeしても例外にならず内容が同じ）', () => {
    const legacy = deepFreeze(JSON.parse(JSON.stringify(LEGACY)))
    const tokens = deepFreeze(tokensFor(TEXT))
    const silences = deepFreeze([{ startSec: 3, endSec: 3.4 }])
    const before = JSON.stringify([legacy, tokens, silences])
    expect(() => buildNaturalCaptions({ legacyCaptions: legacy, windowStartSec: 100, windowDurationSec: 12, tokens, silences, emphasisCandidates: ['とても'] })).not.toThrow()
    expect(JSON.stringify([legacy, tokens, silences])).toBe(before)
  })

  it('強調は比較専用: 既存captionのemphasisTextは変わらず、新captionにだけ付き、正本の部分文字列', () => {
    const r = run({ emphasisCandidates: ['パンを買って'] })
    expect(r.emphasis.appliedCount).toBe(1)
    const c = r.captions.find((x) => x.emphasisText)
    expect(c.text.includes(c.emphasisText)).toBe(true)
    expect(LEGACY.every((x) => x.emphasisText === null)).toBe(true)
  })

  it('強調候補が無ければ強調0件', () => {
    const r = run()
    expect(r.emphasis.appliedCount).toBe(0)
    expect(r.captions.every((c) => c.emphasisText === null)).toBe(true)
  })

  it('時刻は昇順・非重複で、500ms以上の先出しが無い', () => {
    const r = run()
    r.captions.forEach((c, i) => {
      if (i > 0) expect(c.startSec).toBeGreaterThanOrEqual(r.captions[i - 1].endSec - 1e-9)
      const firstChar = c.startIndex
      expect(r.timing.charStart[firstChar] - c.startSec).toBeLessThan(0.5)
    })
  })

  it('ASS出力: 部分強調のみ色が付き、Normalスタイルの不透明ボックス(BorderStyle=3)を使わない', () => {
    const r = run({ emphasisCandidates: ['パンを買って'] })
    const ass = buildAssContent({ width: 1920, height: 1080, captions: r.captions })
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(dialogues.length).toBe(r.captions.length)
    expect(dialogues.filter((l) => l.includes('{\\c'))).toHaveLength(1)
    for (const l of dialogues) expect(l).toContain(',Normal,')
    const styles = ass.split('\n').filter((l) => l.startsWith('Style:'))
    for (const s of styles) expect(s.split(',')[15]).toBe('1') // BorderStyle=1 (縁取り)。紫の全面バナー(3)は廃止
  })
})

describe('既存データを変更しない・一時ファイルを消す', () => {
  it('比較動画は既存ファイルを上書きせず、出力先直下の別名 comparison_natural_timing_*.mp4 になる', () => {
    const root = mkdtempSync(join(tmpdir(), 'lcv-nat-out-'))
    try {
      checkNaming(root)
    } finally {
      rmSync(root, { recursive: true, force: true }) // テスト用の出力先も残さない
    }
  })

  function checkNaming(root) {
    const now = new Date('2026-09-24T10:00:00')
    const a = buildComparisonOutputPath('natural_timing', root, '/nonexistent/src.mp4', now)
    expect(a).toMatch(/comparison_natural_timing_\d{8}_\d{6}\.mp4$/)
    writeFileSync(a, 'existing')
    const b = buildComparisonOutputPath('natural_timing', root, '/nonexistent/src.mp4', now)
    expect(b).not.toBe(a)
    expect(existsSync(a)).toBe(true)
  }

  it('処理中に作った一時ファイルは、成功時も例外時もディレクトリごと削除される', async () => {
    let seen = null
    const { removed } = await withTempDir('lcv-nat-test-', async (dir) => {
      seen = dir
      writeFileSync(join(dir, 'natural.ass'), buildAssContent({ width: 1920, height: 1080, captions: run().captions }))
      expect(existsSync(join(dir, 'natural.ass'))).toBe(true)
    })
    expect(removed).toBe(true)
    expect(existsSync(seen)).toBe(false)
    let seen2 = null
    await expect(withTempDir('lcv-nat-test-', async (dir) => { seen2 = dir; throw new Error('boom') })).rejects.toThrow('boom')
    expect(existsSync(seen2)).toBe(false)
  })
})
