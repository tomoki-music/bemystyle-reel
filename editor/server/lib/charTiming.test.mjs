import { describe, it, expect } from 'vitest'
import { lcsPairs, distributeAcrossSpeech, expandTokensToChars, alignCanonicalToTokens } from './charTiming.mjs'

describe('lcsPairs', () => {
  it('昇順の対応ペアを返す', () => {
    const pairs = lcsPairs(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])
    expect(pairs).toEqual([[0, 0], [2, 2], [3, 3]])
  })
  it('空入力でも動く', () => {
    expect(lcsPairs([], ['a'])).toEqual([])
    expect(lcsPairs(['a'], [])).toEqual([])
  })
})

describe('distributeAcrossSpeech', () => {
  it('無音が無ければ等分する', () => {
    const out = distributeAcrossSpeech(0, 1, 4, [])
    expect(out.map((o) => [o.startSec, o.endSec])).toEqual([[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]])
  })

  it('無音をまたぐトークンでも、どの文字も無音の内側に置かない', () => {
    const sil = [{ startSec: 0.5, endSec: 0.8 }]
    const out = distributeAcrossSpeech(0.2, 1.4, 6, sil)
    for (const o of out) {
      const inside = (t) => t > 0.5 + 0.06 && t < 0.8 - 1e-9
      expect(inside(o.startSec)).toBe(false)
      expect(inside(o.endSec)).toBe(false)
      // 1文字が無音全体をまたがない
      expect(o.startSec < 0.5 && o.endSec > 0.8).toBe(false)
    }
    // 単調増加
    for (let i = 1; i < out.length; i++) expect(out[i].startSec).toBeGreaterThanOrEqual(out[i - 1].endSec - 1e-9)
  })

  it('全体が無音に覆われる場合はゼロ長で無音の終わりに置く', () => {
    const out = distributeAcrossSpeech(0.5, 0.7, 2, [{ startSec: 0.4, endSec: 0.9 }])
    expect(out.every((o) => o.startSec === o.endSec)).toBe(true)
  })
})

describe('expandTokensToChars', () => {
  it('句読点・空白・置換文字は除外し、文字数ぶんに展開する', () => {
    const chars = expandTokensToChars([{ text: 'あ、い', startSec: 0, endSec: 1 }])
    expect(chars.map((c) => c.ch)).toEqual(['あ', 'い'])
  })
})

describe('alignCanonicalToTokens', () => {
  const tokens = [
    { text: 'こん', startSec: 0.2, endSec: 0.6 },
    { text: 'にちは', startSec: 0.6, endSec: 1.2 },
    { text: '世界', startSec: 1.6, endSec: 2.2 },
  ]

  it('正本とローカルが一致する部分は、ローカルのトークン時刻が使われる', () => {
    const t = alignCanonicalToTokens('こんにちは、世界', tokens, [], { startSec: 0, endSec: 3 })
    expect(t.matchedCount).toBe(7)
    expect(t.charStart[0]).toBeCloseTo(0.2)
    expect(t.charStart[6]).toBeCloseTo(1.6, 1) // 世
  })

  it('正本とローカルの表記が違っても(漢字/かな)、単調増加の時刻が付く', () => {
    const t = alignCanonicalToTokens('こんにちは、せかい', tokens, [], { startSec: 0, endSec: 3 })
    let prev = -Infinity
    for (let i = 0; i < 9; i++) {
      expect(t.charStart[i]).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(t.charEnd[i]).toBeGreaterThanOrEqual(t.charStart[i])
      prev = t.charEnd[i]
    }
    expect(t.charEnd[8]).toBeLessThanOrEqual(3)
  })

  it('句読点はゼロ長で直前の発話文字の終了時刻に置かれる', () => {
    const t = alignCanonicalToTokens('こんにちは、世界', tokens, [], { startSec: 0, endSec: 3 })
    expect(t.charStart[5]).toBe(t.charEnd[5])
    expect(t.charStart[5]).toBeCloseTo(t.charEnd[4])
  })

  it('実測の無音区間の内側に文字を置かない', () => {
    const sil = [{ startSec: 1.2, endSec: 1.6 }]
    const t = alignCanonicalToTokens('こんにちは世界', tokens, sil, { startSec: 0, endSec: 3 })
    for (let i = 0; i < 7; i++) {
      expect(t.charStart[i] > 1.2 + 0.06 && t.charStart[i] < 1.6 - 1e-6).toBe(false)
    }
  })

  it('入力(tokens/silences)を変更しない', () => {
    const before = JSON.stringify(tokens)
    alignCanonicalToTokens('こんにちは世界', tokens, [{ startSec: 1.2, endSec: 1.6 }], { startSec: 0, endSec: 3 })
    expect(JSON.stringify(tokens)).toBe(before)
  })
})

describe('alignCanonicalToTokens: 無音明けの発話再開', () => {
  it('DTWが無音明けの最初の文字を遅く推定していても、無音の終わり(発話再開)に前倒しする', () => {
    const toks = [
      { text: 'はい', startSec: 0.0, endSec: 0.4 },
      // 実測では 1.0 秒で発話が再開しているが、DTWは 1.6 秒からと推定
      { text: 'そのとき', startSec: 1.6, endSec: 2.2 },
    ]
    const t = alignCanonicalToTokens('はいそのとき', toks, [{ startSec: 0.5, endSec: 1.0 }], { startSec: 0, endSec: 3 })
    expect(t.charStart[2]).toBeCloseTo(1.0, 2)
    // 前倒し後も単調増加
    for (let i = 1; i < 6; i++) expect(t.charStart[i]).toBeGreaterThanOrEqual(t.charEnd[i - 1] - 1e-9)
  })

  it('遅れが大きすぎる(1秒超)場合は無関係な区間とみなし補正しない', () => {
    const toks = [
      { text: 'はい', startSec: 0.0, endSec: 0.4 },
      { text: 'そのとき', startSec: 3.0, endSec: 3.6 },
    ]
    const t = alignCanonicalToTokens('はいそのとき', toks, [{ startSec: 0.5, endSec: 1.0 }], { startSec: 0, endSec: 4 })
    expect(t.charStart[2]).toBeGreaterThan(2.5)
  })
})
