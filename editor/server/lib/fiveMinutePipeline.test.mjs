import { describe, it, expect } from 'vitest'
import { planChunksFromRawSegments, alignCanonicalByChunks } from './chunkedAlignment.mjs'
import { buildNaturalCaptions } from './naturalCaptionPipeline.mjs'
import { planCaptionFits, buildAssContent, getCaptionStyleDefs } from './captionStyles.mjs'
import { boundaryProblems } from './japaneseText.mjs'

// 合成の5分データ（実際の字幕本文ではない）。14個のrawSegment（約21秒ずつ）、各セグメントは複数のレガシーcaptionに分かれる。
const SENTENCES = [
  'それはやっぱり考え方が違うので、',
  'お互いの違いをよくわかった上で一緒にやれる。',
  'もしくはこれはちょっときつい。',
  '距離を取ることがとても大事ですね。',
  '一緒にやってもいいと思います。',
  'ただこのやり方だとちょっと自分の活動を犠牲にしてしまう。',
  '例えばサークルの活動をしながらバンドの活動をするってことは２倍忙しくなるんですよ。',
  'なのでそしたらバンドの活動は少しお休みして、',
  'しばらく自由に活動できる場所を守っていきます。',
  'その時のステージによるので、',
]
const SEG_SEC = 300 / 14
function makeData() {
  const rawSegments = []
  const legacyCaptions = []
  const tokens = []
  let charCursor = 0
  for (let s = 0; s < 14; s++) {
    const start = s * SEG_SEC
    const sentences = [SENTENCES[s % 10], SENTENCES[(s + 3) % 10], SENTENCES[(s + 6) % 10]]
    const text = sentences.join('')
    rawSegments.push({ startSec: 100 + start, endSec: 100 + start + SEG_SEC, text })
    const perChar = (SEG_SEC - 1.0) / text.length
    let t = start + 0.5
    for (const ch of Array.from(text)) {
      if (!/[、。]/.test(ch)) tokens.push({ text: ch, startSec: t, endSec: t + perChar * 0.95, p: 0.9 })
      t += perChar
    }
    let off = 0
    sentences.forEach((sen, k) => {
      legacyCaptions.push({ id: `legacy-${s}-${k}`, startSec: 100 + start + (k * SEG_SEC) / 3, endSec: 100 + start + ((k + 1) * SEG_SEC) / 3, text: sen, displayOrder: legacyCaptions.length })
      off += sen.length
    })
    charCursor += text.length
  }
  return { rawSegments, legacyCaptions, tokens, textLength: charCursor }
}

describe('5分規模のパイプライン（区間単位アラインメント → 自然なページ分割）', () => {
  const { rawSegments, legacyCaptions, tokens, textLength } = makeData()
  const canonicalText = legacyCaptions.map((c) => c.text).join('')
  const chunks = planChunksFromRawSegments({ rawSegments, globalOffset: 0, textLength: canonicalText.length, windowStartSec: 100, windowDurationSec: 300 })
  const timing = alignCanonicalByChunks({ canonicalText, chunks, tokens, silences: [], bounds: { startSec: 0, endSec: 300 } })
  const natural = buildNaturalCaptions({ legacyCaptions, windowStartSec: 100, windowDurationSec: 300, tokens, silences: [], timing })

  it('区間数はrawSegment数と一致し、5分全体を1区間にしない', () => {
    expect(textLength).toBe(canonicalText.length)
    expect(chunks).toHaveLength(14)
    expect(timing.chunks).toHaveLength(14)
    expect(Math.max(...timing.chunks.map((c) => c.chars))).toBeLessThan(canonicalText.length / 5)
  })

  it('正本文字の完全保持: ページを連結すると正本に完全一致し、本文に改行・\\N・空白の追加がない', () => {
    expect(natural.captions.map((c) => c.text).join('')).toBe(canonicalText)
    expect(natural.canonicalText).toBe(canonicalText)
    for (const c of natural.captions) {
      expect(c.lines.join('')).toBe(c.text)
      expect(/[\r\n]|\\N/.test(c.text)).toBe(false)
    }
  })

  it('事前計算したタイミングをそのまま使う（tokens全体を再アラインしない）', () => {
    expect(natural.timing).toBe(timing)
    expect(natural.alignment.matchedCount).toBe(timing.matchedCount)
  })

  it('ページ分割の制約: 最大30文字・最大2行・1行18文字以内・単語途中/助詞孤立の改行なし', () => {
    for (const c of natural.captions) {
      expect(Array.from(c.text).length).toBeLessThanOrEqual(30)
      expect(c.lines.length).toBeLessThanOrEqual(2)
      for (const l of c.lines) expect(Array.from(l).length).toBeLessThanOrEqual(18)
      if (c.lines.length === 2) {
        const p = boundaryProblems(c.lines[0], c.lines[1])
        expect(p.midWord || p.particleStart).toBeFalsy()
      }
    }
  })

  it('時刻は単調・5分の範囲内で、ページ同士が重ならず、1分あたりの切り替え回数が妥当', () => {
    const caps = natural.captions
    for (let i = 0; i < caps.length; i++) {
      expect(caps[i].endSec).toBeGreaterThan(caps[i].startSec)
      expect(caps[i].startSec).toBeGreaterThanOrEqual(0)
      expect(caps[i].endSec).toBeLessThanOrEqual(300 + 1e-6)
      if (i > 0) expect(caps[i].startSec).toBeGreaterThanOrEqual(caps[i - 1].endSec - 1e-6)
    }
    const perMin = (caps.length / 300) * 60
    expect(perMin).toBeGreaterThan(10)
    expect(perMin).toBeLessThan(60)
  })

  it('低信頼区間(認識が大きく異なるrawSegment)は検出され、その区間のページは lowConfidence になる（元時刻へフォールバック）', () => {
    // 3番目のrawSegmentのトークを全て別の文字へ差し替える（認識結果が大きく異なる）
    const seg = rawSegments[3]
    const bad = tokens.map((t) => (t.startSec + 100 >= seg.startSec && t.startSec + 100 < seg.endSec ? { ...t, text: 'ぬ' } : t))
    const t2 = alignCanonicalByChunks({ canonicalText, chunks, tokens: bad, silences: [], bounds: { startSec: 0, endSec: 300 } })
    expect(t2.chunks[3].fallback).toBe(true)
    expect(t2.chunks.filter((c) => c.fallback)).toHaveLength(1)
    const n2 = buildNaturalCaptions({ legacyCaptions, windowStartSec: 100, windowDurationSec: 300, tokens: bad, silences: [], timing: t2 })
    expect(n2.captions.map((c) => c.text).join('')).toBe(canonicalText) // 正本は変わらない
    expect(n2.captions.some((c) => c.lowConfidence)).toBe(true)
  })
})

describe('字幕サイズの分布（実データに近い5分）', () => {
  const { legacyCaptions, tokens, rawSegments } = makeData()
  const canonicalText = legacyCaptions.map((c) => c.text).join('')
  const chunks = planChunksFromRawSegments({ rawSegments, globalOffset: 0, textLength: canonicalText.length, windowStartSec: 100, windowDurationSec: 300 })
  const timing = alignCanonicalByChunks({ canonicalText, chunks, tokens, silences: [], bounds: { startSec: 0, endSec: 300 } })
  const caps = buildNaturalCaptions({ legacyCaptions, windowStartSec: 100, windowDurationSec: 300, tokens, silences: [], timing }).captions

  it('自然なページ(1行18文字以内)は全件が基本116pxのまま（縮小0件）', () => {
    const plan = planCaptionFits(caps, 1920, 1080)
    expect(plan.every((f) => f.size === 116 && !f.shrunk && f.fits)).toBe(true)
  })

  it('長文(1行21文字以上)が混ざると、その字幕だけが段階値へ縮小され、他は116pxのまま（分布を数えられる）', () => {
    const long = { ...caps[0], text: 'あ'.repeat(24), lines: ['あ'.repeat(24)] }
    const long2 = { ...caps[1], text: 'い'.repeat(22), lines: ['い'.repeat(22)] }
    const plan = planCaptionFits([long, long2, ...caps.slice(2)], 1920, 1080)
    const dist = plan.reduce((h, f) => ({ ...h, [f.size]: (h[f.size] ?? 0) + 1 }), {})
    expect(plan[0]).toMatchObject({ size: 94, shrunk: true })
    expect(plan[1]).toMatchObject({ size: 100, shrunk: true })
    expect(dist[116]).toBe(caps.length - 2)
    expect(Object.keys(dist).map(Number).every((s) => [116, 108, 100, 94, 88, 82].includes(s))).toBe(true)
  })

  it('normal/main/sub/emphasis混在でも、どの字幕も82px以上・段階値のみ', () => {
    const types = ['normal', 'main', 'sub', 'emphasis']
    const mixed = caps.map((c, i) => ({ ...c, captionType: types[i % 4] }))
    const plan = planCaptionFits(mixed, 1920, 1080)
    const s = getCaptionStyleDefs(1920, 1080)
    expect(plan.map((f) => f.baseSize)).toEqual(mixed.map((c) => s[c.captionType].fontsize))
    expect(plan.every((f) => f.size >= 82 && f.fits)).toBe(true)
  })

  it('ASS出力: 縮小した字幕だけ \\fs、部分強調を含んでも本文は変わらない', () => {
    const long = { ...caps[0], text: 'あ'.repeat(24), lines: ['あ'.repeat(24)], emphasisText: 'ああああ', captionType: 'normal' }
    const ass = buildAssContent({ width: 1920, height: 1080, captions: [long, ...caps.slice(1, 6)] })
    const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(lines[0]).toContain('{\\fs94}')
    expect(lines[0]).toContain('{\\r\\fs94}')
    expect(lines.slice(1).some((l) => l.includes('\\fs'))).toBe(false)
  })
})
