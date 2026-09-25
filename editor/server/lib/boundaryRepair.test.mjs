import { describe, it, expect } from 'vitest'
import { splitTextIntoNaturalPages } from './naturalCaptionSplitter.mjs'
import { repairCuts, consolidateCuts } from './boundaryRepair.mjs'
import { countBoundaryProblems, refineForbidden, isClauseStart, isStandaloneShort } from './boundaryRules.mjs'
import { classifyBoundaries, isSpeechChar, boundaryProblems } from './japaneseText.mjs'

// 合成データ（実際の字幕本文ではない）。実データで見つかった禁止境界と同じ種類（複合語・小書き仮名+形式語・助詞始まり・
// 形式語始まり・語の途中）を1つずつ以上含む。
const PIECES = [
  'そのための私', // ← 無音0.66秒（実際に間を置いて発話した複合語らしい連続）
  '個人的には準備を進めます。',
  'これで違ってね。',
  'っていう自由さがあります。', // 小書き仮名+形式語始まり（認識器の誤った句点の直後）
  'ここがチャンスですね。',
  'やりたいって思います。', // 節の頭の「や」（ICUでは助詞に見える）
  'しっかり考えたと思います。',
  'ということで進めます。', // 節の頭の形式語
  '状況を把握します。',
  'で、その次。', // 節の頭の「で、」
  'で、その違い。',
  'ここが最後のポイントです。',
  'で、最後のポイント。',
  '最後に確認して崩さない。',
  'で、その上で進めます。',
  'まず一度やってみて、',
  'やってみて初めて分かります。',
  'こういうこともあります。',
  'で、そこから始めます。',
]
const TEXT = PIECES.join('')
const idxOf = (piece, from = 0) => {
  let pos = 0
  for (let k = 0; k < PIECES.indexOf(piece, from); k++) pos += PIECES[k].length
  return pos
}

function uniformTiming(text, { perChar = 0.14, gaps = {} } = {}) {
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
      charMatched.push(true)
    } else {
      charStart.push(t)
      charEnd.push(t)
      charMatched.push(false)
    }
  }
  return { charStart, charEnd, charMatched, charTokenP: charStart.map(() => 0.9), total: t }
}
const bounds = (t) => ({ startSec: 0, endSec: t + 1 })
const gapsBetweenPages = (pages, tm) =>
  pages.slice(0, -1).map((p, i) => {
    const a = [...Array(p.text.length).keys()].map((k) => p.startIndex + k).filter((q) => isSpeechChar(TEXT[q])).pop()
    const b = [...Array(pages[i + 1].text.length).keys()].map((k) => pages[i + 1].startIndex + k).find((q) => isSpeechChar(TEXT[q]))
    return Math.max(0, tm.charStart[b] - tm.charEnd[a])
  })

const GAPS = { [idxOf('個人的には準備を進めます。')]: 0.66 } // 「私」と「個人的」の間の実無音
const tm = uniformTiming(TEXT, { gaps: GAPS })
const split = (opts = {}) => {
  let report = null
  const pages = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total), { repair: true, onRepairReport: (r) => { report = r }, ...opts })
  return { pages, report }
}

describe('補正版の禁止境界判定（節の頭・実無音の考慮）', () => {
  it('節の頭（句点・読点の直後）の助詞・形式語は、直前の語から引き離した扱いにしない。語の途中・小書き仮名始まりは常に不可', () => {
    const t = '把握します。で、その次。'
    const p = t.indexOf('で')
    expect(isClauseStart(t, p)).toBe(true)
    expect(classifyBoundaries(t)[p].forbidden).toContain('particle') // 厳密版では助詞始まり
    expect(refineForbidden(t, p, classifyBoundaries(t)[p])).toEqual([]) // 補正版では節の頭
    const t2 = 'そうですね。っていう話です。'
    expect(refineForbidden(t2, t2.indexOf('っ'), classifyBoundaries(t2)[t2.indexOf('っ')])).toContain('smallkana')
    const t3 = 'ですけど、でした'
    const mid = 'ですけ'.length
    expect(refineForbidden('ですけど、でした', mid, classifyBoundaries('ですけど、でした')[mid])).toContain('midtoken')
    expect(t3.length).toBeGreaterThan(0)
  })
  it('実測0.3秒以上の無音がある位置の複合語らしい連続は、話者が区切ったものとして許容する（助詞始まりは許容しない）', () => {
    const t = 'そのための私個人的には'
    const p = 'そのための私'.length
    const info = classifyBoundaries(t)[p]
    expect(info.forbidden).toContain('compound')
    expect(refineForbidden(t, p, info, { gapSec: 0.66 })).toEqual([])
    const t2 = '準備をして'
    const q = '準備'.length
    expect(refineForbidden(t2, q, classifyBoundaries(t2)[q], { gapSec: 0.66 })).toContain('particle')
  })
  it('禁止境界の件数は、厳密版（従来の基準）と補正版の両方で数えられる。本文は返さない', () => {
    const r = countBoundaryProblems(['把握します。', 'で、その次。', 'で、その違い。'])
    expect(r.strict.particleStart).toBe(2)
    expect(r.refined.forbidden).toBe(0)
    expect(JSON.stringify(r)).not.toContain('把握')
  })
  it('独立した短語・完結した短文は、短くても許容する', () => {
    expect(isStandaloneShort('いい。', true)).toBe(true)
    expect(isStandaloneShort('はい。', false)).toBe(true)
    expect(isStandaloneShort('ど、', false)).toBe(false)
    expect(isStandaloneShort('けど', true)).toBe(false)
  })
})

describe('splitTextIntoNaturalPages({ repair: true }): 禁止境界11件相当の修正', () => {
  const { pages: basePages } = (() => {
    const p = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total))
    return { pages: p }
  })()

  it('修正前（従来のDP）には、厳密版で複数の禁止境界がある（単語途中・助詞始まり・形式語始まりなど）', () => {
    const b = countBoundaryProblems(basePages.map((p) => p.text), { gaps: gapsBetweenPages(basePages, tm) })
    expect(b.strict.forbidden).toBeGreaterThanOrEqual(8)
    expect(b.strict.particleStart).toBeGreaterThanOrEqual(5)
    expect(b.strict.smallKanaStart).toBe(1)
  })

  it('修正後: 単語途中0件・助詞始まり0件・小書き仮名/長音始まり0件（補正版）。孤立した接続詞も無い', () => {
    const { pages, report } = split()
    const b = countBoundaryProblems(pages.map((p) => p.text), { gaps: gapsBetweenPages(pages, tm) })
    expect(b.refined.forbidden).toBe(0)
    expect(b.refined.midWord).toBe(0)
    expect(b.refined.particleStart).toBe(0)
    expect(b.refined.smallKanaStart).toBe(0)
    expect(b.danglingConjunction).toBe(0)
    expect(report.unresolved).toEqual([])
    for (const p of pages.slice(1)) expect(p.text).not.toMatch(/^[ゃゅょっぁぃぅぇぉゎャュョッァィゥェォヮー〜]/)
  })

  it('正本の文字を完全に保持する（連結が一致・改行/\\Nを混入しない・各ページ最大30文字・最大2行・1行18文字以内）', () => {
    const { pages } = split()
    expect(pages.map((p) => p.text).join('')).toBe(TEXT)
    for (const p of pages) {
      expect(p.text).not.toMatch(/[\r\n]|\\N/)
      expect(p.text.length).toBeLessThanOrEqual(30)
      expect(p.lines.length).toBeLessThanOrEqual(2)
      expect(p.lines.join('')).toBe(p.text)
      for (const l of p.lines) expect(Array.from(l).length).toBeLessThanOrEqual(18)
      if (p.lines.length === 2) {
        const bp = boundaryProblems(p.lines[0], p.lines[1])
        expect(bp.midWord || bp.particleStart).toBe(false)
      }
    }
  })

  it('句点をまたぐ別文の結合をしない（ただし句点直後が小書き仮名始まりの断片だけは直前の文へ付ける）', () => {
    const { pages } = split()
    const endsWithStrong = (s) => /[。！？!?]$/.test(s)
    for (const p of pages) {
      const inner = p.text.slice(0, -1)
      const m = inner.match(/[。！？!?](?![」』）)]|$)/g)
      // 途中に句点があるページは、その直後が小書き仮名/長音始まりの断片のときだけ
      if (m) for (const mm of inner.matchAll(/[。！？!?]/g)) expect(p.text.slice(mm.index + 1)).toMatch(/^[ゃゅょっぁぃぅぇぉゎャュョッァィゥェォヮー〜]/)
    }
    expect(endsWithStrong('ab。')).toBe(true)
  })

  it('発話時刻を500ms以上ずらさない: 各ページの開始は先頭の発話文字の開始と±0.5秒以内・全文字が表示区間内で発話される', () => {
    const { pages } = split()
    for (const p of pages) {
      const first = [...Array(p.text.length).keys()].map((k) => p.startIndex + k).find((q) => isSpeechChar(TEXT[q]))
      expect(Math.abs(tm.charStart[first] - p.startSec)).toBeLessThan(0.5)
      for (let q = p.startIndex; q < p.startIndex + p.text.length; q++) {
        if (!isSpeechChar(TEXT[q])) continue
        expect(tm.charStart[q]).toBeLessThanOrEqual(p.endSec + 1e-6)
        expect(tm.charEnd[q]).toBeGreaterThanOrEqual(p.startSec - 1e-6)
      }
    }
    // 次の発話開始を超えて延長しない・重ならない
    for (let i = 0; i < pages.length - 1; i++) expect(pages[i].endSec).toBeLessThanOrEqual(pages[i + 1].startSec + 1e-6)
  })

  it('0.6秒以上の無音をまたがない（既定）', () => {
    const { pages } = split()
    for (const p of pages) {
      for (let q = p.startIndex + 1; q < p.startIndex + p.text.length; q++) {
        if (!isSpeechChar(TEXT[q]) || !isSpeechChar(TEXT[q - 1])) continue
        expect(tm.charStart[q] - tm.charEnd[q - 1]).toBeLessThan(0.6)
      }
    }
  })

  it('修正しないとき(repair:false・既定)は従来のDP結果と完全に同一（既存の挙動を変えない）', () => {
    const a = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total))
    const b = splitTextIntoNaturalPages(TEXT, tm, bounds(tm.total), { repair: false })
    expect(b).toEqual(a)
  })

  it('入力（timing・bounds）を変更しない', () => {
    const before = JSON.stringify(tm)
    split()
    expect(JSON.stringify(tm)).toBe(before)
  })
})

describe('語の途中で話者が0.6秒以上の間を置いた場合（無音の制約と語境界の制約が両立しない）', () => {
  const text = '今日の準備が大変で全部なくなっちゃったんですけど、また明日から頑張ります。'
  const cutAt = text.indexOf('ど、')
  const tm2 = uniformTiming(text, { gaps: { [cutAt]: 0.7 } })
  const run = (opts = {}) => {
    let report = null
    const pages = splitTextIntoNaturalPages(text, tm2, bounds(tm2.total), { repair: true, onRepairReport: (r) => { report = r }, ...opts })
    return { pages, report }
  }

  it('既定では例外を作らない: 直せない禁止境界を unresolved として診断に残す（本文は含まない）', () => {
    const { pages, report } = run()
    expect(pages.map((p) => p.text).join('')).toBe(text)
    expect(report.unresolved.length).toBe(1)
    expect(report.unresolved[0].reasons).toContain('midtoken')
    expect(JSON.stringify(report.unresolved)).not.toContain('今日')
  })

  it('midWordSilenceSpanSec を明示したときだけ、語を割らずに0.6秒超の無音をまたいで解消する', () => {
    const { pages, report } = run({ midWordSilenceSpanSec: 0.9 })
    expect(report.unresolved).toEqual([])
    expect(pages.map((p) => p.text).join('')).toBe(text)
    const b = countBoundaryProblems(pages.map((p) => p.text))
    expect(b.strict.midWord).toBe(0)
  })
})

describe('語中無音の例外は通常の無音境界には適用しない', () => {
  it('文節間・文章間の0.6〜0.9秒の無音は、例外を有効にしても従来どおり分割する。適用は語中のみで、メタ情報に本文を含めない', () => {
    const text = 'これから始めます今日は大切な話をしますそのあとで準備をします'
    const gaps = { [text.indexOf('今日')]: 0.8, [text.indexOf('そのあと')]: 0.75 }
    const t2 = uniformTiming(text, { gaps })
    let report = null
    const pages = splitTextIntoNaturalPages(text, t2, bounds(t2.total), { repair: true, midWordSilenceSpanSec: 0.9, onRepairReport: (r) => { report = r } })
    expect(pages.some((p) => p.startIndex === text.indexOf('今日'))).toBe(true)
    expect(pages.some((p) => p.startIndex === text.indexOf('そのあと'))).toBe(true)
    expect(report.midWordExceptions).toEqual([])
  })
  it('語中の例外を適用したときは、位置・無音秒数・上限だけを記録する（本文なし）', () => {
    const text = '今日の準備が大変で全部なくなっちゃったんですけど、また明日から頑張ります。'
    const t2 = uniformTiming(text, { gaps: { [text.indexOf('ど、')]: 0.7 } })
    let report = null
    splitTextIntoNaturalPages(text, t2, bounds(t2.total), { repair: true, midWordSilenceSpanSec: 0.9, onRepairReport: (r) => { report = r } })
    expect(report.midWordExceptions).toHaveLength(1)
    expect(report.midWordExceptions[0]).toMatchObject({ silenceSec: 0.7, limitSec: 0.9, midWord: true })
    expect(JSON.stringify(report.midWordExceptions)).not.toContain('今日')
  })
  it('1.0秒の語中無音は上限0.9秒を超えるため適用しない（unresolvedとして残る）', () => {
    const text = '今日の準備が大変で全部なくなっちゃったんですけど、また明日から頑張ります。'
    const t2 = uniformTiming(text, { gaps: { [text.indexOf('ど、')]: 1.0 } })
    let report = null
    splitTextIntoNaturalPages(text, t2, bounds(t2.total), { repair: true, midWordSilenceSpanSec: 0.9, onRepairReport: (r) => { report = r } })
    expect(report.midWordExceptions).toEqual([])
    expect(report.unresolved.length).toBe(1)
  })
})

describe('極端に短いページの再配分（表示時間を機械的に延ばさない）', () => {
  // ctx は最小の合成: 各文字0.14秒。極端に短い = 3文字以下（独立短語を除く）
  const text = 'これは大切な話ですけれどもね今日はここまでにします'
  const ctxFor = (t) => {
    const info = classifyBoundaries(t)
    return {
      reasonsAt: (p) => (p > 0 && p < t.length ? refineForbidden(t, p, info[p]) : []),
      pageOk: (i, j) => j - i > 0 && j - i <= 30,
      dangling: () => false,
      isShort: (i, j) => Array.from(t.slice(i, j)).filter((c) => isSpeechChar(c)).length <= 3 && !isStandaloneShort(t.slice(i, j), false),
      cutCost: (p) => (info[p]?.kind === 'comma' ? 6 : 12),
      softCost: (i, j) => Math.max(0, j - i - 16),
    }
  }
  it('3文字以下の断片ページは、安全な語境界を保って前後のページへ再配分される（本文は不変）', () => {
    const cut = text.indexOf('ね今日')
    const cuts = [[0, cut - 2], [cut - 2, cut + 1], [cut + 1, text.length]] // 中央は「ども」「ね」だけの断片
    const ctx = ctxFor(text)
    expect(ctx.isShort(cut - 2, cut + 1)).toBe(true)
    const r = repairCuts(cuts, ctx)
    expect(r.unresolved).toEqual([])
    expect(r.cuts.map(([i, j]) => text.slice(i, j)).join('')).toBe(text)
    expect(r.cuts.every(([i, j]) => !ctx.isShort(i, j))).toBe(true)
    expect(r.cuts[0][0]).toBe(0)
    expect(r.cuts[r.cuts.length - 1][1]).toBe(text.length)
    // 連続して隣接している
    r.cuts.slice(1).forEach((c, k) => expect(c[0]).toBe(r.cuts[k][1]))
  })
  it('直せない場合は unresolved に理由コードだけを残す', () => {
    const ctx = { ...ctxFor('あいう'), isShort: () => true, pageOk: () => false }
    const r = repairCuts([[0, 1], [1, 3]], ctx)
    expect(r.unresolved.some((u) => u.reasons.includes('short-page'))).toBe(true)
  })
})

describe('consolidateCuts（切り替え頻度の穏やかな整理）', () => {
  it('文の切れ目・息継ぎ・両方が十分な長さのページは統合しない。目標に届かなくても無理に統合しない', () => {
    const t = 'ああああ。いいいい。うう'
    const cuts = [[0, 5], [5, 10], [10, 12]]
    const ctx = { pageOk: () => true, reasonsAt: () => [], gapAt: () => 0, endsSentence: (i, j) => /[。]$/.test(t.slice(i, j)), speechDur: (i, j) => (j - i) * 0.5, len: (i, j) => j - i }
    const r = consolidateCuts(cuts, ctx, { targetCount: 1 })
    expect(r.merged).toBe(0)
    expect(r.cuts).toEqual(cuts)
  })
  it('同じ文の中の短いページ同士は統合する（制約内）', () => {
    const cuts = [[0, 4], [4, 8], [8, 30]]
    const ctx = { pageOk: () => true, reasonsAt: () => [], gapAt: () => 0, endsSentence: () => false, speechDur: (i, j) => (j - i) * 0.2, len: (i, j) => j - i }
    const r = consolidateCuts(cuts, ctx, { targetCount: 2, maxLen: 20 })
    expect(r.merged).toBe(1)
    expect(r.cuts).toEqual([[0, 8], [8, 30]])
  })
})
