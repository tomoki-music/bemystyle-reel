import { describe, it, expect } from 'vitest'
import { breakIntoLines } from './lineBreaker.mjs'
import { classifyBoundaries, startsWithParticle, startsWithSmallKanaOrLongVowel, endsWithDanglingConjunction } from './japaneseText.mjs'

describe('breakIntoLines', () => {
  it('1行に収まる短いページは改行しない', () => {
    expect(breakIntoLines('こんにちは、今日はいい天気です')).toEqual(['こんにちは、今日はいい天気です'])
  })

  it('最大2行で、連結すると本文と完全一致する', () => {
    const t = '自分のサークル運営もするし、バンドの活動もするのでとても忙しいです'
    const lines = breakIntoLines(t)
    expect(lines.length).toBeLessThanOrEqual(2)
    expect(lines.join('')).toBe(t)
  })

  it('読点の位置を優先して改行し、行の長さを均等に近づける', () => {
    const t = '自分のサークル運営もするし、バンドの活動もするので忙しいです'
    const lines = breakIntoLines(t)
    expect(lines).toHaveLength(2)
    expect(lines[0].endsWith('、')).toBe(true)
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThanOrEqual(6)
  })

  it('助詞・活用断片・小書き仮名から2行目を始めない', () => {
    const texts = [
      '一緒にやってもいいけれどちょっと自分の活動を犠牲にしてしまうので',
      'バンドの活動をするってことは二倍忙しくなるんですよそれでも頑張る',
      'コーヒーを飲みながらキャンプの準備をしてちょっと休憩をしましょう',
    ]
    for (const t of texts) {
      const lines = breakIntoLines(t)
      expect(lines.join('')).toBe(t)
      if (lines.length === 2) {
        expect(startsWithParticle(lines[1])).toBe(false)
        expect(startsWithSmallKanaOrLongVowel(lines[1])).toBe(false)
        expect(endsWithDanglingConjunction(lines[0])).toBe(false)
        const info = classifyBoundaries(t)
        expect(info[lines[0].length].forbidden).toEqual([])
      }
    }
  })

  it('本文に改行文字を含まない・生成しない', () => {
    const lines = breakIntoLines('自分のサークル運営もするし、バンドの活動もするので忙しいです')
    for (const l of lines) expect(l).not.toMatch(/[\r\n]|\\N/)
  })

  it('句読点なしの長い連続でも必ず2行以内で終了する', () => {
    const t = 'あ'.repeat(36)
    const lines = breakIntoLines(t)
    expect(lines.length).toBeLessThanOrEqual(2)
    expect(lines.join('')).toBe(t)
  })
})
