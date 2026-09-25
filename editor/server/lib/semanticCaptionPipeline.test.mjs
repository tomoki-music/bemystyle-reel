import { describe, it, expect } from 'vitest'
import { buildSemanticCaptions, inheritCaptionType, validateSemanticCaptions } from './semanticCaptionPipeline.mjs'
import { buildAssContent } from './captionStyles.mjs'

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object') deepFreeze(v)
  })
  return Object.freeze(o)
}

// 1文字0.12秒で連続発話するトークン列（文字ごと1トークン）
function tokensFor(text, perChar = 0.12, offset = 0) {
  const out = []
  let t = offset
  for (const ch of text) {
    if (/[、。！？]/.test(ch)) continue
    out.push({ text: ch, startSec: t, endSec: t + perChar })
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

describe('buildSemanticCaptions', () => {
  it('本文は既存captionの連結を正本とし、新captionを連結すると完全一致する', () => {
    const r = buildSemanticCaptions({ legacyCaptions: LEGACY, windowStartSec: 100, windowDurationSec: 12, tokens: tokensFor(TEXT), silences: [] })
    expect(r.canonicalText).toBe(TEXT)
    expect(r.captions.map((c) => c.text).join('')).toBe(TEXT)
    expect(validateSemanticCaptions(r.captions, r.canonicalText)).toEqual([])
  })

  it('既存caption・rawSegments相当の入力を変更しない（deep freezeしても例外にならない）', () => {
    const legacy = deepFreeze(JSON.parse(JSON.stringify(LEGACY)))
    const tokens = deepFreeze(tokensFor(TEXT))
    const silences = deepFreeze([{ startSec: 3.0, endSec: 3.4 }])
    const before = JSON.stringify(legacy)
    expect(() => buildSemanticCaptions({ legacyCaptions: legacy, windowStartSec: 100, windowDurationSec: 12, tokens, silences })).not.toThrow()
    expect(JSON.stringify(legacy)).toBe(before)
  })

  it('captionTypeは時間的な重なりが最大の既存captionから引き継ぐ（比較表示専用・emphasisTextはnull）', () => {
    // 既存captionの時間軸(約11秒)に合わせ、1文字0.25秒でゆっくり発話する
    const r = buildSemanticCaptions({ legacyCaptions: LEGACY, windowStartSec: 100, windowDurationSec: 12, tokens: tokensFor(TEXT, 0.25), silences: [] })
    expect(r.captions[0].captionType).toBe('main')
    expect(r.captions[r.captions.length - 1].captionType).toBe('emphasis')
    for (const c of r.captions) {
      expect(['main', 'sub', 'emphasis', 'normal']).toContain(c.captionType)
      expect(c.emphasisText).toBeNull()
    }
  })

  it('時刻はクリップ先頭を0秒とする相対時刻で、昇順・非重複', () => {
    const r = buildSemanticCaptions({ legacyCaptions: LEGACY, windowStartSec: 100, windowDurationSec: 12, tokens: tokensFor(TEXT), silences: [] })
    let prev = -Infinity
    for (const c of r.captions) {
      expect(c.startSec).toBeGreaterThanOrEqual(0)
      expect(c.startSec).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(c.endSec).toBeLessThanOrEqual(12)
      prev = c.endSec
    }
  })
})

describe('inheritCaptionType', () => {
  it('重なりが無ければ normal', () => {
    expect(inheritCaptionType({ startSec: 50, endSec: 51 }, [{ startSec: 0, endSec: 1, captionType: 'main' }])).toBe('normal')
  })
})

describe('validateSemanticCaptions', () => {
  it('本文の改変・\\N混入・重なり・3行以上を検出する', () => {
    const bad = [
      { startSec: 0, endSec: 3, text: 'あい\\Nう', lines: ['あい', 'う', 'x'] },
      { startSec: 2, endSec: 4, text: 'えお', lines: ['え', 'お'] },
    ]
    const problems = validateSemanticCaptions(bad, 'あいうえお')
    expect(problems.join('\n')).toMatch(/正本と一致しません/)
    expect(problems.join('\n')).toMatch(/\\N/)
    expect(problems.join('\n')).toMatch(/重なって/)
    expect(problems.join('\n')).toMatch(/行数/)
  })
})

describe('新方式 → ASS: 明示的な \\N をレンダー時に挿入する', () => {
  it('2行のページは Dialogue に \\N が入り、本文(text)には \\N が無い', () => {
    const r = buildSemanticCaptions({ legacyCaptions: LEGACY, windowStartSec: 100, windowDurationSec: 12, tokens: tokensFor(TEXT), silences: [] })
    const twoLine = r.captions.find((c) => c.lines.length === 2)
    expect(twoLine).toBeTruthy()
    expect(twoLine.text).not.toContain('\\N')
    const ass = buildAssContent({ width: 1920, height: 1080, captions: r.captions })
    const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(dialogue.length).toBe(r.captions.length)
    const twoLineCount = r.captions.filter((c) => c.lines.length === 2).length
    expect(dialogue.filter((l) => l.includes('\\N')).length).toBe(twoLineCount)
    // 各Dialogueの \N は最大1つ（最大2行）
    for (const l of dialogue) expect((l.match(/\\N/g) ?? []).length).toBeLessThanOrEqual(1)
  })

  it('旧方式(linesなし)のASS出力は従来どおり \\N を勝手に挿入しない', () => {
    const ass = buildAssContent({ width: 1920, height: 1080, captions: LEGACY })
    expect(ass).not.toContain('\\N')
  })

  it('linesが本文と一致しない場合は無視される（本文の改変を防ぐ）', () => {
    const ass = buildAssContent({ width: 1920, height: 1080, captions: [{ startSec: 0, endSec: 2, text: 'あいうえお', lines: ['あい', 'うおえ'], captionType: 'normal', displayOrder: 0 }] })
    expect(ass).toContain(',,あいうえお')
    expect(ass).not.toContain('\\N')
  })
})
