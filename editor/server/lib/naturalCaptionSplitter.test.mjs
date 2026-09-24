import { describe, it, expect } from 'vitest'
import { splitTextIntoNaturalPages, detectLowConfidenceChars, NATURAL_DEFAULTS } from './naturalCaptionSplitter.mjs'
import { alignCanonicalToTokens } from './charTiming.mjs'
import { isSpeechChar } from './japaneseText.mjs'

/** 文字ごとの均一な発話時刻。gaps: {文字index: 直前に入れる無音秒} */
function uniformTiming(text, { perChar = 0.14, gaps = {}, matched = true } = {}) {
  let t = 0
  const charStart = []
  const charEnd = []
  const charMatched = []
  for (let i = 0; i < text.length; i++) {
    if (gaps[i]) t += gaps[i]
    if (isSpeechChar(text[i])) {
      charStart.push(t)
      charEnd.push(t + perChar)
      t += perChar
      charMatched.push(typeof matched === 'function' ? matched(i) : matched)
    } else {
      charStart.push(t)
      charEnd.push(t)
      charMatched.push(false)
    }
  }
  return { charStart, charEnd, charMatched, charTokenP: charStart.map(() => 0.9), total: t }
}
const bounds = (t) => ({ startSec: 0, endSec: t + 1 })

const TEXT = '今日はとても良い天気ですね。散歩に出かけて公園で花を見て、帰りにパンを買って家で食べました。それから友達に会って夜まで話し込んでしまいました。'

describe('splitTextIntoNaturalPages: 発話時刻を最優先する', () => {
  it('連結すると正本へ完全一致し、\\Nや改行を本文へ混入させない', () => {
    const tm = uniformTiming(TEXT)
    const pages = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total))
    expect(pages.map((p) => p.text).join('')).toBe(TEXT)
    for (const p of pages) {
      expect(p.text).not.toMatch(/\\N|[\r\n]/)
      expect(p.lines.join('')).toBe(p.text)
    }
  })

  it('最大30文字・最大2行・1行は16文字程度に収まる', () => {
    const long = '自分の考えと相手の考えの違いをよくわかった上で一緒にやれるかどうかを考えることが本当に大事だと思っています'
    const tm = uniformTiming(long, { perChar: 0.09 })
    const pages = splitTextIntoNaturalPages(long, tm, bounds(tm.total))
    for (const p of pages) {
      expect(p.text.length).toBeLessThanOrEqual(30)
      expect(p.lines.length).toBeLessThanOrEqual(2)
      for (const l of p.lines) expect(l.length).toBeLessThanOrEqual(18)
    }
  })

  it('caption開始は最初の発話開始に合わせ、先行は最大100ms', () => {
    const tm = uniformTiming(TEXT)
    const pages = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total))
    for (const p of pages) {
      const lead = p.speechStartSec - p.startSec
      expect(lead).toBeGreaterThanOrEqual(-1e-9)
      expect(lead).toBeLessThanOrEqual(0.1 + 1e-9) // 500ms以上の先出しは発生しない
    }
  })

  it('caption終了は最後の発話終了+余韻(100〜250ms)以内で、次の発話開始を超えない', () => {
    const tm = uniformTiming(TEXT, { gaps: { 30: 1.5 } })
    const pages = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total))
    pages.forEach((p, i) => {
      expect(p.endSec - p.speechEndSec).toBeLessThanOrEqual(0.25 + 1e-9)
      if (i < pages.length - 1) expect(p.endSec).toBeLessThanOrEqual(pages[i + 1].speechStartSec + 1e-9)
    })
  })

  it('次の発話まで字幕を引き延ばさない（無音が長くても余韻で消える）', () => {
    const text = 'こんにちは。ありがとうございます。'
    const tm = uniformTiming(text, { gaps: { 6: 5 } })
    const pages = splitTextIntoNaturalPages(text, tm, bounds(tm.total))
    expect(pages).toHaveLength(2)
    expect(pages[0].endSec).toBeLessThan(pages[1].speechStartSec - 4)
  })

  it('最低2秒へ強制延長しない: 短い発話は2秒未満のまま表示する', () => {
    const text = 'はい。'
    const tm = uniformTiming(text)
    const pages = splitTextIntoNaturalPages(text, tm, { startSec: 0, endSec: 10 })
    expect(pages).toHaveLength(1)
    expect(pages[0].endSec - pages[0].startSec).toBeLessThan(1)
  })

  it('句点をまたぐ結合をしない（後続文を同じページへ入れない）', () => {
    const text = 'はい。そうです。'
    const tm = uniformTiming(text, { perChar: 0.1 })
    const pages = splitTextIntoNaturalPages(text, tm, bounds(tm.total))
    expect(pages.map((p) => p.text)).toEqual(['はい。', 'そうです。'])
    for (const p of pages) expect(p.text.slice(0, -1)).not.toMatch(/[。？！]/)
  })

  it('0.6秒以上の無音は絶対にまたがず、そこで分割する（後半の先出しをしない）', () => {
    const text = 'これから始めます今日は大切な話をします'
    const tm = uniformTiming(text, { gaps: { 8: 0.8 } })
    const pages = splitTextIntoNaturalPages(text, tm, bounds(tm.total))
    expect(pages.length).toBeGreaterThanOrEqual(2)
    const cut = pages.find((p) => p.startIndex === 8)
    expect(cut).toBeTruthy()
    expect(cut.boundaryKind).toBe('silence')
  })

  it('単語途中・助詞始まり・小書き仮名始まりで切らない', () => {
    const tm = uniformTiming(TEXT)
    const pages = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total))
    for (const p of pages.slice(1)) {
      expect(p.text).not.toMatch(/^[をがにはのでとも]/)
      expect(p.text).not.toMatch(/^[ゃゅょっー]/)
    }
  })

  it('DTW時刻を使う: 発話が速い/遅いと表示時間もそれに従う', () => {
    const text = 'とても大切なことをお話しします'
    const fast = uniformTiming(text, { perChar: 0.08 })
    const slow = uniformTiming(text, { perChar: 0.2 })
    const f = splitTextIntoNaturalPages(text, fast, bounds(fast.total))
    const s = splitTextIntoNaturalPages(text, slow, bounds(slow.total))
    expect(f[0].speechStartSec).toBeCloseTo(0, 5)
    const spanF = f[f.length - 1].speechEndSec
    const spanS = s[s.length - 1].speechEndSec
    expect(spanS).toBeGreaterThan(spanF * 2)
  })
})

describe('低信頼区間: 過剰に細分化せず元時刻へフォールバック', () => {
  const text = 'ここは確かに認識できていますここから先は認識できていない長い部分ですここは再び認識できました'
  const start = text.indexOf('ここから先')
  const end = text.indexOf('ここは再び')
  const matched = (i) => i < start || i >= end
  const tm = uniformTiming(text, { matched })

  it('連続して対応できない区間を低信頼として検出し、対応済み文字は低信頼にしない', () => {
    const low = detectLowConfidenceChars(text, tm)
    for (let i = 0; i < text.length; i++) {
      if (i < start || i >= end) expect(low[i]).toBe(false)
    }
    expect(low.slice(start, end).some(Boolean)).toBe(true)
  })

  it('低信頼pageにlowConfidenceが立ち、元時刻(旧caption時刻)の範囲内へフォールバックする', () => {
    // 低信頼区間の推定時刻は、旧captionの時刻へ差し替えられ、前後の対応済み時刻の間に収まる
    const legacyRanges = [{ startIndex: 0, endIndex: text.length, startSec: 0, endSec: tm.total }]
    const pages = splitTextIntoNaturalPages(text, tm, bounds(tm.total), { legacyRanges })
    const lows = pages.filter((p) => p.lowConfidence)
    expect(lows.length).toBeGreaterThan(0)
    expect(pages.map((p) => p.text).join('')).toBe(text)
    pages.forEach((p, i) => {
      if (i > 0) expect(p.startSec).toBeGreaterThanOrEqual(pages[i - 1].endSec - 1e-9)
    })
  })

  it('信頼できない箇所には根拠のない細かい分割を作らない（低信頼の内部を割るコストが効く）', () => {
    const legacyRanges = [{ startIndex: 0, endIndex: text.length, startSec: 0, endSec: tm.total }]
    const lowPages = splitTextIntoNaturalPages(text, tm, bounds(tm.total), { legacyRanges }).filter((p) => p.lowConfidence)
    for (const p of lowPages) expect(p.text.length).toBeGreaterThanOrEqual(4)
  })

  it('全て対応できているときは低信頼を出さない', () => {
    const ok = uniformTiming(TEXT)
    const pages = splitTextIntoNaturalPages(TEXT, ok, bounds(ok.total))
    expect(pages.some((p) => p.lowConfidence)).toBe(false)
  })
})

describe('alignCanonicalToTokens: 対応情報の出力（DTW時刻の利用）', () => {
  it('対応済み文字にはローカルトークンの時刻・確率が入り、未対応文字にはmatched=falseが付く', () => {
    const tokens = [
      { text: '今日', startSec: 1, endSec: 1.4, p: 0.8 },
      { text: 'は', startSec: 1.4, endSec: 1.5, p: 0.9 },
    ]
    const r = alignCanonicalToTokens('今日はいい天気', tokens, [], { startSec: 0, endSec: 3 })
    expect(r.charMatched[0]).toBe(true)
    expect(r.charStart[0]).toBeCloseTo(1, 5) // DTW時刻を使う
    expect(r.charTokenP[0]).toBe(0.8)
    expect(r.charMatched[3]).toBe(false) // 未対応(補間)
    expect(r.charStart[3]).toBeGreaterThanOrEqual(r.charEnd[2] - 1e-9) // 前後の対応済みトークンの間だけで補間
  })
})
