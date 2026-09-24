// ローカルAIテロップ動画: 「発話時刻を最優先」するページ分割。
//
// semanticCaptionSplitter は「最低2秒・最大36文字」を目標にしたため、複数のフレーズ・文を1ページへ
// まとめ、まだ話していない後半を先に表示していた。こちらは逆に、実際の発話(DTW文字時刻)を最優先する。
//
// 仕様:
// - 1ページ = ほぼ同時に話している1フレーズ。目安8〜24文字、最大30文字（超過は不可）。
// - 表示開始 = 最初の対応文字の発話開始 - 先行(既定80ms・最大100ms)。
// - 表示終了 = 最後の対応文字の発話終了 + 余韻(既定180ms)。次ページの発話開始を超えて延長しない。
// - 最低2秒へ引き延ばさない。短い発話は短いまま表示する。
// - 句点・疑問符・感嘆符をまたぐページは作らない（ハード制約）。0.6秒以上の無音をまたぐページも作らない。
//   0.3〜0.6秒の短い無音は、またがないと語の途中・助詞始まりで切ることになる場合に限り、重いコストでまたぐ。
// - 境界の優先順位: 実無音 > 句点系 > 文末表現 > 読点 > 接続詞直前 > 文節 > 語境界 > 文字数(最後の手段)。
// - 低信頼(LCSで対応できていない/補間が長い)区間は過剰に細分化せず、元時刻(旧caption時刻)へ
//   フォールバックする。ページに lowConfidence を立てて明示する。
// - ページ分割とページ内改行は別処理(lineBreaker)。本文に \N は入れない。
// - 純粋関数。AI/LLMは使わない。連結すると正本テキストへ完全一致する。

import { classifyBoundaries, endsWithDanglingConjunction, isSpeechChar, segmentWords, boundaryProblems, startsWithSmallKanaOrLongVowel, PARTICLES, BOUND_WORDS, CONJUNCTIONS, STRONG_PUNCT } from './japaneseText.mjs'
import { breakIntoLines } from './lineBreaker.mjs'
import { refineForbidden, isStandaloneShort } from './boundaryRules.mjs'
import { repairCuts, consolidateCuts } from './boundaryRepair.mjs'

export const NATURAL_DEFAULTS = {
  maxPageChars: 30,
  idealMinChars: 8,
  comfortChars: 16, // 1行分。これを超えると2行になるため、フレーズ単位で割れるなら割る
  idealMaxChars: 24,
  softMaxSpeechSec: 2.1, // 1ページの発話時間の目安。長いほど後半が先に見える時間が伸びる
  hardMaxSpeechSec: 3.4,
  silenceBoundarySec: 0.3,
  // ページ内部にまたいでよい無音の上限。0.3〜この値の無音は「またぐと不自然な切断(助詞始まり・語の途中)を
  // 避けられる」場合に限り重いコストでまたぐ。これ以上の無音は絶対にまたがない。
  maxSpannedSilenceSec: 0.6,
  spanSilenceCost: 140,
  leadSec: 0.08,
  maxLeadSec: 0.1,
  tailSec: 0.18,
  maxLineChars: 16,
  hardMaxLineChars: 18,
  // 低信頼判定
  lowConfMinUnmatchedRun: 4,
  lowConfMaxSecPerChar: 0.4,
  lowConfMinTokenP: 0.15,
  // 禁止境界・極端に短いページの修正（repair:true のときだけ）。既定では従来どおりDP結果をそのまま使う。
  repair: false,
  shortPageSec: 0.5, // 表示時間の見込みがこれ未満、または3文字以下のページは「極端に短い」
  shortPageChars: 3,
  // 話者が「語の途中」で実際に間を置いた場合（例: 「〜です|け…ど」の0.6秒超の無音）だけ、語を割るよりも無音をまたぐほうを
  // 許すときの、またいでよい無音の上限（秒）。null（既定）なら例外なし＝従来どおり0.6秒以上は絶対にまたがない。
  midWordSilenceSpanSec: null,
  consolidate: null, // 統合の条件の上書き（maxLen / maxSpeechSec / shortSpeechSec）
  targetPagesPerMinute: null, // 数値を指定すると、不自然にならない範囲でだけ統合して近づける（未達でも無理に統合しない）
}

const KIND_COST = { strong: 0, semantic: 4, comma: 6, conj: 8, phrase: 12, word: 60 }
const FORBIDDEN_COST = { particle: 400, bound: 400, fragment: 300, compound: 250, okurigana: 350, smallkana: 800, midtoken: 1000, punct: 5000, space: 200, openquote: 5000 }
const CLOSING = new Set(['」', '』', '）', ')', '］', ']', '】', '〉', '》', '”', '’'])

function isFunctionOnlyPage(text) {
  const words = segmentWords(text).filter((w) => w.isWordLike)
  return words.length > 0 && words.every((w) => PARTICLES.has(w.segment) || BOUND_WORDS.has(w.segment) || CONJUNCTIONS.has(w.segment))
}

/**
 * 低信頼な発話文字を検出する。
 * - 連続 lowConfMinUnmatchedRun 文字以上、ローカル認識と対応できていない区間
 * - 補間で埋めた区間が1文字あたり lowConfMaxSecPerChar 秒を超えて引き伸ばされている(2文字以上)区間
 * - 対応済みでもトークン確率が極端に低い文字
 * 戻り値は正本の文字インデックスごとの真偽。
 *
 * @param {string} text
 * @param {{ charStart: number[], charEnd: number[], charMatched?: boolean[], charTokenP?: Array<number | null> }} timing
 * @param {Partial<typeof NATURAL_DEFAULTS>} [overrides]
 * @returns {boolean[]}
 */
export function detectLowConfidenceChars(text, timing, overrides = {}) {
  const opt = { ...NATURAL_DEFAULTS, ...overrides }
  const n = text.length
  const low = new Array(n).fill(false)
  const matched = timing.charMatched
  if (!matched) return low
  const speechIdx = []
  for (let i = 0; i < n; i++) if (isSpeechChar(text[i])) speechIdx.push(i)
  let k = 0
  while (k < speechIdx.length) {
    if (matched[speechIdx[k]]) {
      const p = timing.charTokenP?.[speechIdx[k]]
      if (p !== null && p !== undefined && p < opt.lowConfMinTokenP) low[speechIdx[k]] = true
      k++
      continue
    }
    let e = k
    while (e < speechIdx.length && !matched[speechIdx[e]]) e++
    const count = e - k
    const first = speechIdx[k]
    const last = speechIdx[e - 1]
    const span = timing.charEnd[last] - timing.charStart[first]
    if (count >= opt.lowConfMinUnmatchedRun || (count >= 2 && span / count > opt.lowConfMaxSecPerChar)) {
      for (let q = k; q < e; q++) low[speechIdx[q]] = true
    }
    k = e
  }
  return low
}

/**
 * 旧caption(正本の連結範囲と時刻)から、文字ごとの「元時刻」を線形に求める。
 * @param {Array<{ startIndex: number, endIndex: number, startSec: number, endSec: number }>} legacyRanges
 * @param {number} n 正本の長さ
 * @returns {{ start: number[], end: number[] }}
 */
export function legacyCharTimes(legacyRanges, n) {
  const start = new Array(n).fill(NaN)
  const end = new Array(n).fill(NaN)
  for (const r of legacyRanges) {
    const len = Math.max(1, r.endIndex - r.startIndex)
    for (let i = r.startIndex; i < r.endIndex && i < n; i++) {
      start[i] = r.startSec + ((r.endSec - r.startSec) * (i - r.startIndex)) / len
      end[i] = r.startSec + ((r.endSec - r.startSec) * (i - r.startIndex + 1)) / len
    }
  }
  return { start, end }
}

/**
 * 低信頼区間の文字時刻を元時刻へ差し替える。前後の対応済み文字の時刻の間へクランプする。
 * 対応済み(高信頼)の文字時刻は一切変更しない。
 */
export function applyLowConfidenceFallback(text, timing, lowConf, legacy) {
  const n = text.length
  const charStart = [...timing.charStart]
  const charEnd = [...timing.charEnd]
  let i = 0
  while (i < n) {
    if (!lowConf[i] || !isSpeechChar(text[i])) {
      i++
      continue
    }
    let e = i
    while (e < n && (lowConf[e] || !isSpeechChar(text[e]))) e++
    // 区間 [i,e) の前後にある高信頼の発話文字
    let a = i - 1
    while (a >= 0 && (!isSpeechChar(text[a]) || lowConf[a])) a--
    let b = e
    while (b < n && (!isSpeechChar(text[b]) || lowConf[b])) b++
    const left = a >= 0 ? timing.charEnd[a] : -Infinity
    const right = b < n ? timing.charStart[b] : Infinity
    let prev = left
    for (let q = i; q < e; q++) {
      if (!isSpeechChar(text[q])) {
        charStart[q] = prev === -Infinity ? charStart[q] : prev
        charEnd[q] = charStart[q]
        continue
      }
      let s = Number.isFinite(legacy.start[q]) ? legacy.start[q] : timing.charStart[q]
      let en = Number.isFinite(legacy.end[q]) ? legacy.end[q] : timing.charEnd[q]
      s = Math.min(Math.max(s, prev), right)
      en = Math.min(Math.max(en, s), right)
      charStart[q] = s
      charEnd[q] = en
      prev = en
    }
    i = e
  }
  return { ...timing, charStart, charEnd }
}

/**
 * 正本テキストを発話時刻に合わせてページ分割する。
 *
 * @param {string} text 正本テキスト
 * @param {{ charStart: number[], charEnd: number[], charMatched?: boolean[], charTokenP?: Array<number|null> }} timing
 * @param {{ startSec: number, endSec: number }} bounds
 * @param {{ legacyRanges?: Array<{ startIndex: number, endIndex: number, startSec: number, endSec: number }> } & Partial<typeof NATURAL_DEFAULTS>} [overrides]
 * @returns {Array<{
 *   text: string, lines: string[], startIndex: number, endIndex: number,
 *   speechStartSec: number, speechEndSec: number, startSec: number, endSec: number,
 *   boundaryKind: string, lowConfidence: boolean,
 * }>}
 */
export function splitTextIntoNaturalPages(text, timing0, bounds, overrides = {}) {
  const { legacyRanges, ...rest } = overrides
  const opt = { ...NATURAL_DEFAULTS, ...rest }
  const n = text.length
  if (n === 0) return []

  const lowConf = detectLowConfidenceChars(text, timing0, opt)
  const timing = legacyRanges ? applyLowConfidenceFallback(text, timing0, lowConf, legacyCharTimes(legacyRanges, n)) : timing0
  const { charStart, charEnd } = timing
  const boundaryInfo = classifyBoundaries(text)

  const speech = Array.from(text, (ch) => isSpeechChar(ch))
  const nextSpeech = new Array(n + 1).fill(-1)
  for (let i = n - 1; i >= 0; i--) nextSpeech[i] = speech[i] ? i : nextSpeech[i + 1]
  const prevSpeech = new Array(n + 1).fill(-1)
  for (let i = 1; i <= n; i++) prevSpeech[i] = speech[i - 1] ? i - 1 : prevSpeech[i - 1]

  // 位置pをまたぐ発話間隔(秒)
  const gapAt = new Array(n + 1).fill(0)
  for (let p = 1; p < n; p++) {
    const a = prevSpeech[p]
    const b = nextSpeech[p]
    // 句読点の直前は境界にならない（無音は句読点の直後の位置に割り当てる）
    gapAt[p] = speech[p] && a >= 0 && b >= 0 ? Math.max(0, charStart[b] - charEnd[a]) : 0
  }
  // 位置pが低信頼区間の内部か（=元時刻でしか位置が分からない場所を細かく割らない）
  const insideLow = new Array(n + 1).fill(false)
  for (let p = 1; p < n; p++) insideLow[p] = lowConf[p - 1] && lowConf[p]

  // strongEnd[p]: p未満で最後に現れた句点系の位置(その直後がページ境界であるべき)
  const isStrong = Array.from(text, (ch) => STRONG_PUNCT.has(ch))
  const isClosing = Array.from(text, (ch) => CLOSING.has(ch))
  // 位置 k(句点)の直後(閉じ括弧を含む)の位置
  const afterStrong = new Array(n).fill(-1)
  for (let k = 0; k < n; k++) {
    if (!isStrong[k]) continue
    let q = k + 1
    while (q < n && (isClosing[q] || isStrong[q])) q++
    afterStrong[k] = q
  }

  const nextSpeechStart = (j) => {
    const idx = j < n ? nextSpeech[j] : -1
    return idx >= 0 ? charStart[idx] : bounds.endSec
  }

  function boundaryCost(j) {
    if (j <= 0 || j >= n) return { cost: 0, kind: 'edge' }
    const info = boundaryInfo[j]
    let cost = 0
    let kind = info?.kind ?? 'word'
    for (const r of info?.forbidden ?? []) cost += FORBIDDEN_COST[r] ?? 300
    if (gapAt[j] >= opt.silenceBoundarySec) kind = 'silence'
    else cost += KIND_COST[kind] ?? 30
    // 低信頼区間の内部を割ると、根拠のない時刻で細分化してしまう
    if (insideLow[j] && kind !== 'strong' && kind !== 'silence') cost += 45
    return { cost, kind }
  }

  function crossesSentence(i, j) {
    for (let k = i; k < j - 1; k++) {
      if (isStrong[k] && afterStrong[k] < j) return true
    }
    return false
  }

  function displayRange(i, j) {
    const first = nextSpeech[i]
    const last = prevSpeech[j]
    if (first < 0 || first >= j || last < first) return null
    return { speechStart: charStart[first], speechEnd: charEnd[last] }
  }

  function pageCost(i, j) {
    const len = j - i
    if (len <= 0 || len > opt.maxPageChars) return Infinity
    const r = displayRange(i, j)
    if (!r) return Infinity
    if (crossesSentence(i, j)) return Infinity
    let cost = 8
    for (let p = i + 1; p < j; p++) {
      if (nextSpeech[p] < 0 || nextSpeech[p] >= j) continue // ページ内に続く発話が無い(末尾の句読点)
      const g = gapAt[p]
      if (g >= opt.maxSpannedSilenceSec) return Infinity
      if (g >= opt.silenceBoundarySec) cost += opt.spanSilenceCost + g * 100
      else if (g >= 0.15) cost += 10
    }
    const dur = r.speechEnd - r.speechStart
    if (dur > opt.softMaxSpeechSec) cost += (dur - opt.softMaxSpeechSec) * 26
    if (dur > opt.hardMaxSpeechSec) cost += (dur - opt.hardMaxSpeechSec) * 60
    if (len < opt.idealMinChars) cost += (opt.idealMinChars - len) * 2.5
    if (len > opt.comfortChars) cost += (len - opt.comfortChars) * 1.2
    if (len > opt.idealMaxChars) cost += (len - opt.idealMaxChars) * 6
    const pageText = text.slice(i, j)
    if (len < 4) cost += 60
    if (pageText.endsWith('の') && j < n) cost += 12 // 連体修飾(「〜の」+名詞)を割らない
    if (isFunctionOnlyPage(pageText)) cost += 500
    if (j < n && endsWithDanglingConjunction(pageText)) cost += 300
    return cost
  }

  const dp = new Array(n + 1).fill(Infinity)
  const back = new Array(n + 1).fill(-1)
  dp[0] = 0
  for (let j = 1; j <= n; j++) {
    const bc = boundaryCost(j).cost
    const lo = Math.max(0, j - opt.maxPageChars)
    for (let i = lo; i < j; i++) {
      if (dp[i] === Infinity) continue
      const pc = pageCost(i, j)
      if (pc === Infinity) continue
      const total = dp[i] + pc + bc
      if (total < dp[j]) {
        dp[j] = total
        back[j] = i
      }
    }
  }

  // 制約を満たす分割が無い場合（例: 句点をまたがずに30文字超が続く）は、制約を緩めず最後の手段として
  // 30文字ごと・語境界優先の分割へフォールバックする（本文は保持）。
  let cuts = []
  if (dp[n] === Infinity) {
    let i = 0
    while (i < n) {
      let j = Math.min(n, i + opt.maxPageChars)
      if (j < n) {
        let best = j
        let bestCost = Infinity
        for (let q = Math.max(i + 4, j - 12); q <= j; q++) {
          const c = boundaryCost(q).cost
          if (c < bestCost) {
            bestCost = c
            best = q
          }
        }
        j = best
      }
      cuts.push([i, j])
      i = j
    }
  } else {
    for (let j = n; j > 0; j = back[j]) cuts.push([back[j], j])
    cuts.reverse()
  }

  let repairReport = null
  if (opt.repair) {
    const speechDur = (i, j) => {
      const r = displayRange(i, j)
      return r ? r.speechEnd - r.speechStart : 0
    }
    const spanSilenceOk = (i, j) => {
      for (let p = i + 1; p < j; p++) {
        if (nextSpeech[p] < 0 || nextSpeech[p] >= j) continue
        const limit = boundaryInfo[p]?.midToken && Number.isFinite(opt.midWordSilenceSpanSec) ? opt.midWordSilenceSpanSec : opt.maxSpannedSilenceSec
        if (gapAt[p] >= limit) return false
      }
      return true
    }
    // 句点をまたぐ結合は禁止。ただし句点の直後が小書き仮名・長音で始まる場合は、文として成立しない
    // 断片（認識器の誤った句点）なので、直前の文へ付けるために限ってまたいでよい。
    const crossesRealSentence = (i, j) => {
      for (let k = i; k < j - 1; k++) {
        if (isStrong[k] && afterStrong[k] < j && !(afterStrong[k] < n && startsWithSmallKanaOrLongVowel(text[afterStrong[k]]))) return true
      }
      return false
    }
    const pageOk = (i, j) => {
      if (j - i <= 0 || j - i > opt.maxPageChars) return false
      if (!displayRange(i, j) || crossesRealSentence(i, j) || !spanSilenceOk(i, j)) return false
      if (speechDur(i, j) > opt.hardMaxSpeechSec) return false
      const lines = breakIntoLines(text.slice(i, j), { maxLineChars: opt.maxLineChars, hardMaxLineChars: opt.hardMaxLineChars })
      if (lines.length > 2 || lines.some((l) => Array.from(l).length > opt.hardMaxLineChars)) return false
      if (lines.length === 2) {
        const bp = boundaryProblems(lines[0], lines[1])
        if (bp.midWord || bp.particleStart) return false
      }
      return true
    }
    const startsAfterStrong = (i) => i === 0 || STRONG_PUNCT.has(text[i - 1]) || (CLOSING.has(text[i - 1]) && i >= 2 && STRONG_PUNCT.has(text[i - 2]))
    const endsSentence = (i, j) => STRONG_PUNCT.has(text[j - 1]) || (CLOSING.has(text[j - 1]) && j - i >= 2 && STRONG_PUNCT.has(text[j - 2]))
    const speechChars = (i, j) => {
      let c = 0
      for (let q = i; q < j; q++) if (speech[q]) c++
      return c
    }
    const ctx = {
      reasonsAt: (p) => (p > 0 && p < n ? refineForbidden(text, p, boundaryInfo[p], { gapSec: gapAt[p] }) : []),
      pageOk,
      dangling: (i, j) => j < n && endsWithDanglingConjunction(text.slice(i, j)),
      isShort: (i, j) => {
        const est = speechDur(i, j) + opt.leadSec + opt.tailSec
        if (est >= opt.shortPageSec && speechChars(i, j) > opt.shortPageChars) return false
        return !isStandaloneShort(text.slice(i, j), startsAfterStrong(i))
      },
      cutCost: (q) => (gapAt[q] >= opt.silenceBoundarySec ? 0 : (KIND_COST[boundaryInfo[q]?.kind ?? 'word'] ?? 30)),
      softCost: (i, j) => {
        const dur = speechDur(i, j)
        const len = j - i
        let c = 0
        if (dur > opt.softMaxSpeechSec) c += (dur - opt.softMaxSpeechSec) * 26
        if (len > opt.comfortChars) c += (len - opt.comfortChars) * 1.2
        if (len > opt.idealMaxChars) c += (len - opt.idealMaxChars) * 6
        return c
      },
    }
    const before = cuts.length
    const rep = repairCuts(cuts, ctx)
    cuts = rep.cuts
    let consolidated = 0
    if (Number.isFinite(opt.targetPagesPerMinute)) {
      const target = Math.ceil((opt.targetPagesPerMinute * (bounds.endSec - bounds.startSec)) / 60)
      const c = consolidateCuts(cuts, { ...ctx, gapAt: (p) => gapAt[p] ?? 0, endsSentence, speechDur, len: (i, j) => j - i }, { targetCount: target, ...(opt.consolidate ?? {}) })
      cuts = c.cuts
      consolidated = c.merged
    }
    // 語中無音の例外を適用したページ（語の途中に0.6秒以上の無音を含む）。本文は含めず位置と秒数だけ記録する。
    const midWordExceptions = []
    if (Number.isFinite(opt.midWordSilenceSpanSec)) {
      cuts.forEach(([i, j], pageIndex) => {
        for (let p = i + 1; p < j; p++) {
          if (boundaryInfo[p]?.midToken && nextSpeech[p] >= 0 && nextSpeech[p] < j && gapAt[p] >= opt.maxSpannedSilenceSec) {
            midWordExceptions.push({ pageIndex, position: p, silenceSec: Math.round(gapAt[p] * 1000) / 1000, limitSec: opt.midWordSilenceSpanSec, midWord: true })
          }
        }
      })
    }
    repairReport = { midWordExceptions, pagesBefore: before, pagesAfter: cuts.length, actions: rep.actions, unresolved: rep.unresolved, consolidated }
    if (typeof opt.onRepairReport === 'function') opt.onRepairReport(repairReport)
  }

  const pages = []
  let prevEnd = bounds.startSec
  cuts.forEach(([i, j], idx) => {
    const r = displayRange(i, j)
    const speechStart = r ? r.speechStart : prevEnd
    const speechEnd = r ? r.speechEnd : prevEnd
    const nextStart = idx < cuts.length - 1 ? nextSpeechStart(j) : bounds.endSec
    // 開始: 最初の発話開始 - 先行(最大 maxLeadSec)。前ページの終了より前にはしない。
    let start = Math.max(speechStart - Math.min(opt.leadSec, opt.maxLeadSec), prevEnd, bounds.startSec)
    start = Math.min(start, Math.max(speechStart, prevEnd))
    // 終了: 最後の発話終了 + 余韻。次の発話開始を超えない。最低表示時間への延長はしない。
    let end = Math.min(speechEnd + opt.tailSec, Math.max(nextStart, speechEnd), bounds.endSec)
    start = Math.round(start * 100) / 100
    end = Math.floor(end * 100 + 1e-6) / 100 // 次の発話開始を超えないよう切り捨てる
    if (end < start) end = start
    prevEnd = end
    const pageText = text.slice(i, j)
    let lowCount = 0
    for (let q = i; q < j; q++) if (lowConf[q]) lowCount++
    pages.push({
      text: pageText,
      lines: breakIntoLines(pageText, { maxLineChars: opt.maxLineChars, hardMaxLineChars: opt.hardMaxLineChars }),
      startIndex: i,
      endIndex: j,
      speechStartSec: speechStart,
      speechEndSec: speechEnd,
      startSec: start,
      endSec: end,
      boundaryKind: idx === 0 ? 'edge' : boundaryCost(i).kind,
      lowConfidence: lowCount > 0,
    })
  })
  return pages
}
