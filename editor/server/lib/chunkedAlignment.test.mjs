import { describe, it, expect } from 'vitest'
import { planChunksFromRawSegments, alignCanonicalByChunks } from './chunkedAlignment.mjs'

// 1文字=0.2秒で話すと仮定した合成トークン（1トークン=1文字）
const tok = (text, startSec, perChar = 0.2) => Array.from(text).map((ch, i) => ({ text: ch, startSec: startSec + i * perChar, endSec: startSec + (i + 1) * perChar, p: 0.9 }))

describe('planChunksFromRawSegments（rawSegmentごとの区間計画）', () => {
  const raw = [
    { startSec: 100, endSec: 110, text: 'あいうえおかきくけこ' }, // 10文字
    { startSec: 110, endSec: 118, text: 'さしすせそたちつて' }, // 9文字
    { startSec: 118, endSec: 130, text: 'なにぬねのはひふへほま' }, // 11文字
  ]
  it('窓の正本テキスト上の区間と、窓相対の時刻へ変換する', () => {
    const chunks = planChunksFromRawSegments({ rawSegments: raw, globalOffset: 0, textLength: 30, windowStartSec: 100, windowDurationSec: 30 })
    expect(chunks.map((c) => [c.startIndex, c.endIndex, c.startSec, c.endSec])).toEqual([[0, 10, 0, 10], [10, 19, 10, 18], [19, 30, 18, 30]])
  })
  it('窓が途中のrawSegmentから始まる場合はglobalOffsetで切り出し、窓の外の区間は含めない', () => {
    const chunks = planChunksFromRawSegments({ rawSegments: raw, globalOffset: 10, textLength: 12, windowStartSec: 110, windowDurationSec: 10 })
    expect(chunks.map((c) => [c.startIndex, c.endIndex])).toEqual([[0, 9], [9, 12]])
    expect(chunks[1].endSec).toBe(10) // 窓の長さでクリップ
  })
  it('全区間の範囲を連結すると窓の正本テキスト全体になる（欠落・重複なし）', () => {
    const chunks = planChunksFromRawSegments({ rawSegments: raw, globalOffset: 0, textLength: 30, windowStartSec: 100, windowDurationSec: 30 })
    expect(chunks[0].startIndex).toBe(0)
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].startIndex).toBe(chunks[i - 1].endIndex)
    expect(chunks.at(-1).endIndex).toBe(30)
  })
})

describe('alignCanonicalByChunks（区間単位のアラインメント）', () => {
  // 同じ文言を2つの区間で言う（全体を1つのLCSにすると取り違えやすい）。区間ごとに正しい時刻へ合う。
  const canonical = 'おはようございますきょうははれです' + 'おはようございますあしたもはれです'
  const seg1 = 'おはようございますきょうははれです' // 17
  const chunks = [
    { index: 0, startIndex: 0, endIndex: seg1.length, startSec: 0, endSec: 5 },
    { index: 1, startIndex: seg1.length, endIndex: canonical.length, startSec: 20, endSec: 25 },
  ]
  const tokens = [...tok(seg1, 0.5, 0.25), ...tok('おはようございますあしたもはれです', 20.5, 0.25)]
  const bounds = { startSec: 0, endSec: 30 }

  it('各区間の文字は、その区間付近のトークの時刻へ合う（別区間の同文言と取り違えない）', () => {
    const r = alignCanonicalByChunks({ canonicalText: canonical, chunks, tokens, silences: [], bounds })
    expect(r.charStart[0]).toBeCloseTo(0.5, 1)
    expect(r.charStart[seg1.length]).toBeCloseTo(20.5, 1)
    expect(r.charStart[seg1.length]).toBeGreaterThan(r.charEnd[seg1.length - 1])
    expect(r.chunks).toHaveLength(2)
    expect(r.chunks.every((c) => !c.fallback && c.matchRatio === 1)).toBe(true)
  })

  it('全文字の時刻は単調非減少で、範囲内。正本の文字数と配列長が一致する', () => {
    const r = alignCanonicalByChunks({ canonicalText: canonical, chunks, tokens, silences: [], bounds })
    expect(r.charStart).toHaveLength(canonical.length)
    for (let i = 1; i < canonical.length; i++) {
      expect(r.charStart[i]).toBeGreaterThanOrEqual(r.charEnd[i - 1] - 1e-9)
      expect(r.charEnd[i]).toBeGreaterThanOrEqual(r.charStart[i])
    }
    expect(r.charEnd.at(-1)).toBeLessThanOrEqual(30)
  })

  it('一致数・発話文字数・ローカル文字数を集計する（既存文字起こしとの一致率）', () => {
    const r = alignCanonicalByChunks({ canonicalText: canonical, chunks, tokens, silences: [], bounds })
    expect(r.matchedCount).toBe(r.canonicalSpeechCount)
    expect(r.localSpeechCount).toBe(canonical.length)
  })

  it('認識結果が大きく異なる区間は低信頼として検出し、ローカル時刻を使わず元の区間の範囲へ配る', () => {
    const bad = [...tok(seg1, 0.5, 0.25), ...tok('ぜんぜんちがうないようをはなしている', 20.5, 0.25)]
    const r = alignCanonicalByChunks({ canonicalText: canonical, chunks, tokens: bad, silences: [], bounds })
    expect(r.chunks[0].fallback).toBe(false)
    expect(r.chunks[1].fallback).toBe(true)
    // フォールバック区間の文字は、rawSegmentの時間範囲(20〜25秒)の中に置かれ、対応済みとはみなされない
    for (let i = seg1.length; i < canonical.length; i++) {
      expect(r.charMatched[i]).toBe(false)
      expect(r.charStart[i]).toBeGreaterThanOrEqual(20 - 1e-9)
      expect(r.charEnd[i]).toBeLessThanOrEqual(25 + 1e-9)
    }
    expect(r.matchedCount).toBe(r.chunks[0].matchedChars)
  })

  it('トークが1つも無い区間もフォールバックする', () => {
    const r = alignCanonicalByChunks({ canonicalText: canonical, chunks, tokens: tok(seg1, 0.5, 0.25), silences: [], bounds })
    expect(r.chunks[1]).toMatchObject({ fallback: true, tokens: 0 })
  })

  it('正本の文字列そのものには一切触れない（入力を変更しない）', () => {
    const text = Object.freeze(canonical)
    const t = Object.freeze(tokens.map((x) => Object.freeze({ ...x })))
    const c = Object.freeze(chunks.map((x) => Object.freeze({ ...x })))
    expect(() => alignCanonicalByChunks({ canonicalText: text, chunks: c, tokens: t, silences: [], bounds })).not.toThrow()
  })

  it('区間ごとにLCSを行う: 区間の文字数×区間付近のトークの積の規模で、5分全体(文字数の二乗)にならない', () => {
    // 5分相当(約2300文字)を合成し、区間数=13、各区間のトークは区間付近のみに絞られることを確認する。
    const segLen = 180
    const texts = Array.from({ length: 13 }, (_, k) => Array.from({ length: segLen }, (_, i) => String.fromCharCode(0x3041 + ((k * 7 + i * 3) % 80))).join(''))
    const cs = texts.map((t, k) => ({ index: k, startIndex: k * segLen, endIndex: (k + 1) * segLen, startSec: k * 23, endSec: (k + 1) * 23 }))
    const toks = texts.flatMap((t, k) => tok(t, k * 23 + 0.5, 0.12))
    const r = alignCanonicalByChunks({ canonicalText: texts.join(''), chunks: cs, tokens: toks, silences: [], bounds: { startSec: 0, endSec: 300 } })
    expect(r.chunks).toHaveLength(13)
    expect(Math.max(...r.chunks.map((c) => c.tokens))).toBeLessThan(toks.length / 6) // 各区間が使うトークは全体の一部だけ
    expect(r.matchedCount / r.canonicalSpeechCount).toBeGreaterThan(0.95)
  })
})
