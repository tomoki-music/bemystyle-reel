import { describe, it, expect } from 'vitest'
import { splitTextIntoSemanticPages, SEMANTIC_DEFAULTS } from './semanticCaptionSplitter.mjs'
import { classifyBoundaries, isSpeechChar, startsWithParticle, startsWithSmallKanaOrLongVowel, endsWithDanglingConjunction } from './japaneseText.mjs'

/**
 * 全ての発話文字が perChar 秒ずつ等間隔で発話される合成タイミング。
 * gaps[pos] = 位置pの直前に入れる無音(秒)。
 */
function makeTiming(text, { perChar = 0.15, gaps = {} } = {}) {
  const charStart = []
  const charEnd = []
  let t = 0
  for (let i = 0; i < text.length; i++) {
    if (gaps[i]) t += gaps[i]
    if (isSpeechChar(text[i])) {
      charStart[i] = t
      t += perChar
      charEnd[i] = t
    } else {
      charStart[i] = t
      charEnd[i] = t
    }
  }
  return { timing: { charStart, charEnd }, bounds: { startSec: 0, endSec: t + 0.5 } }
}

const split = (text, opts) => {
  const { timing, bounds } = makeTiming(text, opts)
  return splitTextIntoSemanticPages(text, timing, bounds)
}

const SAMPLES = [
  '今日はとても良い天気です。散歩に出かけましょう。公園には花が咲いています。帰りにパンを買って家で食べました。',
  '相手のペースも崩さずに、そしてお互いにやれる範囲で、じゃあ月2回だったらまだOKとか、そういう妥協点を探る努力は必要なんですけど、でもごめん、月2回でも無理だわってなったら、そこは無理に一緒にやる必要はない。',
  '自分のサークル運営もするし、バンドの活動もする。なのでそしたらバンドの活動は少しお休みしてしばらく自由に活動できるサークルっていうところを運営として場所を守って、そのサークルでしばらく気ままにやったらちょっと今年は少しバンドでメンバー固めて集中的にやりたいなときはバンドに舵を振ればいいし。',
  'コーヒーを飲みながらキャンプの準備をしてちょっと休憩をしてからゆっくり出発しましょうそしてお昼ごはんはカレーにします',
]

describe('原文の完全保持', () => {
  it('全ページのtextを連結すると正本と完全一致する（削除・要約・言い換えなし）', () => {
    for (const text of SAMPLES) {
      const pages = split(text)
      expect(pages.map((p) => p.text).join('')).toBe(text)
    }
  })

  it('句読点なしの長文・同一文字の連続でも本文を保持し、無限ループしない', () => {
    for (const text of ['あ'.repeat(500), 'abcdefghij'.repeat(40), '今日は天気が良いので'.repeat(30)]) {
      const pages = split(text)
      expect(pages.map((p) => p.text).join('')).toBe(text)
    }
  })

  it('本文に改行や \\N を混入させない（改行はlinesとして別保持）', () => {
    for (const text of SAMPLES) {
      for (const p of split(text)) {
        expect(p.text).not.toMatch(/[\r\n]|\\N/)
        expect(p.lines.join('')).toBe(p.text)
      }
    }
  })

  it('入力(text/timing)を変更しない', () => {
    const text = SAMPLES[0]
    const { timing, bounds } = makeTiming(text)
    const before = JSON.stringify({ text, timing, bounds })
    splitTextIntoSemanticPages(text, timing, bounds)
    expect(JSON.stringify({ text, timing, bounds })).toBe(before)
  })
})

describe('境界の優先順位', () => {
  it('実測の無音(0.3秒以上)の位置を優先して切る', () => {
    // 句読点なし。「帰ってきました」の直後に0.6秒の無音がある
    const text = '今日は天気が良いので散歩に出かけて公園で花を見て帰ってきましたそれから夕食を作りました'
    const at = text.indexOf('それから')
    const pages = split(text, { gaps: { [at]: 0.6 } })
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.some((p) => p.startIndex === at)).toBe(true)
  })

  it('句点・疑問符・感嘆符の直後で切る（ページは文の途中で終わらない）', () => {
    const text = '今日はとても良い天気ですね。本当にそう思いますか？私はそう思います！明日も晴れるといいですね。'
    const pages = split(text)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) expect(/[。？！]$/.test(p.text)).toBe(true)
  })

  it('読点で切れるときは読点の直後を選ぶ', () => {
    const text = '朝は早く起きて顔を洗って、朝ごはんを食べてからゆっくり歩いて、駅まで向かって電車に乗りました'
    const pages = split(text)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages.slice(0, -1)) expect(p.text.endsWith('、')).toBe(true)
  })

  it('句読点も無音も無い場合は文節境界で切り、単語途中では切らない', () => {
    const text = '相手のペースも崩さずにお互いにやれる範囲で妥協点を探る努力は必要なんですけど無理なら一緒にやる必要はない'
    const info = classifyBoundaries(text)
    for (const p of split(text).slice(1)) expect(info[p.startIndex].forbidden).toEqual([])
  })
})

describe('禁止される分割（単語途中・助詞・接続詞・小書き仮名）', () => {
  it('全サンプルで、ページ境界は禁止位置（助詞始まり・活用断片・複合語・小書き仮名始まり等）にならない', () => {
    for (const text of SAMPLES) {
      const info = classifyBoundaries(text)
      for (const p of split(text).slice(1)) {
        expect({ text: p.text.slice(0, 6), forbidden: info[p.startIndex].forbidden }).toEqual({ text: p.text.slice(0, 6), forbidden: [] })
      }
    }
  })

  it('次ページ先頭が助詞・前ページ末尾が接続詞のみ、にならない', () => {
    for (const text of SAMPLES) {
      const pages = split(text)
      for (const p of pages.slice(1)) expect(startsWithParticle(p.text)).toBe(false)
      for (const p of pages.slice(0, -1)) expect(endsWithDanglingConjunction(p.text)).toBe(false)
    }
  })

  it('小書き仮名・長音・促音から次ページを始めない', () => {
    const text = 'コーヒーを飲みながらキャンプの準備をしてちょっと休憩をしてからチャーハンを作ってビールを飲みましょう'
    for (const p of split(text)) expect(startsWithSmallKanaOrLongVowel(p.text)).toBe(false)
  })

  it('文字数境界(最後の手段)でしか切れない長い1語でも、必ず前進して終了する', () => {
    const pages = split('あ'.repeat(120))
    expect(pages.every((p) => p.text.length <= SEMANTIC_DEFAULTS.maxPageChars)).toBe(true)
  })
})

describe('タイムスタンプ・表示時間', () => {
  it('開始・終了は昇順で非重複（隣接ページは前の終了 <= 次の開始）', () => {
    for (const text of SAMPLES) {
      const pages = split(text)
      let prevEnd = -Infinity
      for (const p of pages) {
        expect(p.endSec).toBeGreaterThanOrEqual(p.startSec)
        expect(p.startSec).toBeGreaterThanOrEqual(prevEnd - 1e-9)
        prevEnd = p.endSec
      }
    }
  })

  it('次の発話開始を超えて表示しない（無音を挟む場合は発話開始までに終わる）', () => {
    const text = '今日は天気が良いので散歩に出かけて公園で花を見て帰ってきましたそれから夕食を作りました'
    const at = text.indexOf('それから')
    const { timing, bounds } = makeTiming(text, { gaps: { [at]: 2.0 } })
    const pages = splitTextIntoSemanticPages(text, timing, bounds)
    const idx = pages.findIndex((p) => p.startIndex === at)
    expect(idx).toBeGreaterThan(0)
    const nextSpeechStart = timing.charStart[at]
    expect(pages[idx - 1].endSec).toBeLessThanOrEqual(nextSpeechStart + 1e-9)
    // 2秒の無音を埋めるように不自然に引き伸ばさない（発話終了+最大延長まで）
    const prevSpeechEnd = pages[idx - 1].speechEndSec
    expect(pages[idx - 1].endSec - prevSpeechEnd).toBeLessThanOrEqual(SEMANTIC_DEFAULTS.maxExtendSec + 1e-9)
  })

  it('2秒未満になりそうな短い文は隣のページと統合される', () => {
    // 1文あたり約0.9秒(0.09秒/文字)の早口。文ごとに切ると全て2秒未満になる
    const base = 'はい分かりました。ありがとうございます。よろしくお願いします。それでは始めましょう。今日も頑張ります。'
    const text = base + base
    const { timing, bounds } = makeTiming(text, { perChar: 0.09 })
    const pages = splitTextIntoSemanticPages(text, timing, bounds)
    const sentences = text.split('。').filter(Boolean).length
    expect(pages.length).toBeLessThan(sentences)
    for (const p of pages.slice(0, -1)) expect(p.endSec - p.startSec).toBeGreaterThanOrEqual(SEMANTIC_DEFAULTS.minPageSec - 0.05)
  })

  it('1ページは最大36文字・最大2行', () => {
    for (const text of SAMPLES) {
      for (const p of split(text)) {
        expect(p.text.length).toBeLessThanOrEqual(SEMANTIC_DEFAULTS.maxPageChars)
        expect(p.lines.length).toBeLessThanOrEqual(2)
      }
    }
  })
})
