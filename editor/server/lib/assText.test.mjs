import { describe, it, expect } from 'vitest'
import { escapeAssText, escapePathForFfmpegFilter } from './assText.mjs'

describe('escapeAssText', () => {
  it('バックスラッシュをエスケープする', () => {
    expect(escapeAssText('C:\\path\\to\\file')).toBe('C:\\\\path\\\\to\\\\file')
  })

  it('改行を \\N に変換する', () => {
    expect(escapeAssText('1行目\n2行目')).toBe('1行目\\N2行目')
    expect(escapeAssText('a\r\nb')).toBe('a\\Nb')
    expect(escapeAssText('a\rb')).toBe('a\\Nb')
  })

  it('中括弧を全角に置換してオーバーライドタグ注入を防ぐ', () => {
    expect(escapeAssText('{\\c&HFF0000&}赤文字')).toBe('｛\\\\c&HFF0000&｝赤文字')
  })

  it('日本語の実用的な文章をそのまま通す（記号以外は変化しない）', () => {
    const input = 'こんにちは、世界！今日は「良い天気」ですね。'
    expect(escapeAssText(input)).toBe(input)
  })

  it('非文字列入力は空文字を返す', () => {
    expect(escapeAssText(undefined)).toBe('')
    expect(escapeAssText(null)).toBe('')
    expect(escapeAssText(123)).toBe('')
  })

  it('バックスラッシュ・中括弧・改行が混在していても正しく処理する', () => {
    const input = '注意\\{危険}\n次の行'
    const result = escapeAssText(input)
    expect(result).toBe('注意\\\\｛危険｝\\N次の行')
    // 生の override タグが残っていないことを確認
    expect(result).not.toMatch(/\{\\/)
  })
})

describe('escapePathForFfmpegFilter', () => {
  it('バックスラッシュを4つに、コロンを\\:に、シングルクォートを\\\'に置換する', () => {
    const input = "C:\\Users\\dev\\it's a path.ass"
    const result = escapePathForFfmpegFilter(input)
    expect(result).toBe("C\\:\\\\\\\\Users\\\\\\\\dev\\\\\\\\it\\'s a path.ass")
  })

  it('macOSの通常パス（コロンなし）はコロンエスケープが発生しない', () => {
    const input = '/Users/dev/tmp/abc123.ass'
    expect(escapePathForFfmpegFilter(input)).toBe(input)
  })
})
