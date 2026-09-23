import { describe, it, expect } from 'vitest'
import {
  classifyBoundaries,
  segmentWords,
  startsWithParticle,
  startsWithSmallKanaOrLongVowel,
  endsWithDanglingConjunction,
  boundaryProblems,
} from './japaneseText.mjs'

const allowedPositions = (text) => {
  const info = classifyBoundaries(text)
  const out = []
  for (let p = 1; p < text.length; p++) if (info[p] && info[p].forbidden.length === 0) out.push(p)
  return out
}

describe('segmentWords', () => {
  it('連結すると元の文字列と完全一致する', () => {
    const t = '相手のペースも崩さずに、そしてお互いにやれる範囲で、'
    expect(segmentWords(t).map((w) => w.segment).join('')).toBe(t)
  })
})

describe('classifyBoundaries: 切ってはいけない位置', () => {
  it('活用語尾・送り仮名の途中は切れない（崩|さ|ず|に / 忙|しく）', () => {
    const t = '相手のペースも崩さずに進める'
    const allowed = allowedPositions(t)
    expect(allowed).not.toContain(t.indexOf('さ'))
    expect(allowed).not.toContain(t.indexOf('ず'))
    const t2 = '2倍忙しくなるんです'
    expect(allowedPositions(t2)).not.toContain(t2.indexOf('しく'))
  })

  it('助詞の直前では切れない（次ページ先頭を助詞にしない）', () => {
    const t = '相手のペースを合わせる'
    const info = classifyBoundaries(t)
    expect(info[t.indexOf('の')].forbidden).toContain('particle')
    expect(info[t.indexOf('を')].forbidden).toContain('particle')
  })

  it('文節の切れ目（助詞の直後・内容語の直前）は切ってよい', () => {
    const t = '相手のペースを合わせる'
    expect(allowedPositions(t)).toContain(t.indexOf('ペース'))
    expect(allowedPositions(t)).toContain(t.indexOf('合わせ'))
  })

  it('句読点・空白・閉じ括弧の直前では切れない', () => {
    const t = 'こんにちは、世界。今日は'
    const info = classifyBoundaries(t)
    expect(info[t.indexOf('、')].forbidden).toContain('punct')
    expect(info[t.indexOf('。')].forbidden).toContain('punct')
  })

  it('小書き仮名・長音・促音の直前では切れない', () => {
    const t = 'ちょっとキャンプ'
    const info = classifyBoundaries(t)
    expect(info[t.indexOf('ょ')].forbidden).toContain('smallkana')
    expect(info[t.indexOf('ャ')].forbidden).toContain('smallkana')
    const t2 = 'コーヒーを飲む'
    expect(classifyBoundaries(t2)[t2.indexOf('ー')].forbidden).toContain('smallkana')
    expect(startsWithSmallKanaOrLongVowel('ーヒー')).toBe(true)
    expect(startsWithSmallKanaOrLongVowel('ゃゅ')).toBe(true)
    expect(startsWithSmallKanaOrLongVowel('今日')).toBe(false)
  })

  it('複合語（漢字同士・カタカナ同士）・数字と助数詞の間は切れない', () => {
    const t = '妥協点を探る'
    expect(allowedPositions(t)).not.toContain(t.indexOf('点'))
    const t2 = '月2回だったら'
    expect(allowedPositions(t2)).not.toContain(t2.indexOf('2'))
    expect(allowedPositions(t2)).not.toContain(t2.indexOf('回'))
  })
})

describe('切れ目の種類(kind)', () => {
  it('句点の直後=strong、読点の直後=comma、接続詞の直前=conj', () => {
    const t = '今日は晴れです。そして明日は雨、でも大丈夫'
    const info = classifyBoundaries(t)
    expect(info[t.indexOf('そして')].kind).toBe('strong')
    expect(info[t.indexOf('でも')].kind).toBe('comma')
    const t2 = '今日は晴れて暖かいそして明日は雨'
    expect(classifyBoundaries(t2)[t2.indexOf('そして')].kind).toBe('conj')
  })
})

describe('助詞始まり・接続詞終わりの検出', () => {
  it('startsWithParticle', () => {
    expect(startsWithParticle('を感じる')).toBe(true)
    expect(startsWithParticle('感じる')).toBe(false)
    expect(startsWithParticle('')).toBe(false)
  })

  it('endsWithDanglingConjunction: 句読点なしの接続詞で終わる場合のみtrue', () => {
    expect(endsWithDanglingConjunction('今日は晴れです。そして')).toBe(true)
    expect(endsWithDanglingConjunction('今日は晴れです。そして、')).toBe(false)
    expect(endsWithDanglingConjunction('今日は晴れです。')).toBe(false)
  })

  it('boundaryProblems: 単語途中・助詞始まりを検出する', () => {
    expect(boundaryProblems('相手', 'のペースを').particleStart).toBe(true)
    expect(boundaryProblems('相手の', 'ペースを').particleStart).toBe(false)
    expect(boundaryProblems('崩', 'さずに').midWord).toBe(true)
    expect(boundaryProblems('相手の', 'ペースも').midWord).toBe(false)
  })
})
