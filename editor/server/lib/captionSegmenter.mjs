// ローカルAIテロップ動画: Whisperの生segment（1件が長すぎることがある）を、
// 画面表示に適した長さの字幕（caption）へ決定的に分割する。
//
// 設計方針（すべて必須要件）:
// - AI/LLM は一切使わない。文字数・区切り文字だけを見る純粋関数。
// - 元テキストの削除・要約・言い換えをしない（分割後の全チャンクを連結すると
//   元テキストと完全一致する = インデックスによる文字列スライスのみで構成する）。
// - 元segmentの startSec/endSec の範囲を超えない。分割後の区間は
//   昇順・非重複（隣接区間はちょうど接する）。
// - segment間の無音区間は分割処理の対象外（各segmentの範囲内でのみ配分する）。
// - 句読点が無い長文でも無限ループしない（1文字も進まないループを作らない）。

const STRONG_BREAK_CHARS = new Set(['。', '！', '？', '!', '?'])
const MID_BREAK_CHARS = new Set(['、', ','])
const WEAK_BREAK_CHARS = new Set([' ', '　', '・', '\n', '\t'])

const DEFAULT_TARGET_CHARS = 26
const DEFAULT_MAX_CHARS = 30
const DEFAULT_MIN_SCAN_CHARS = 12
const DEFAULT_MIN_TAIL_CHARS = 8

/**
 * 1件のテキストを表示用チャンクへ分割する。
 * 戻り値の全要素を連結すると必ず元の text と一致する（純粋な部分文字列スライスのため）。
 *
 * @param {string} text
 * @param {{ targetChars?: number, maxChars?: number, minScanChars?: number, minTailChars?: number }} [options]
 * @returns {string[]}
 */
export function splitTextIntoChunks(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return []

  const target = options.targetChars ?? DEFAULT_TARGET_CHARS
  const max = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS)
  const minScan = Math.max(1, options.minScanChars ?? DEFAULT_MIN_SCAN_CHARS)
  const minTail = Math.max(1, options.minTailChars ?? DEFAULT_MIN_TAIL_CHARS)

  const len = text.length
  if (len <= max) return [text]

  const chunks = []
  let start = 0
  while (start < len) {
    const remaining = len - start
    if (remaining <= max) {
      chunks.push(text.slice(start))
      break
    }

    const windowEnd = Math.min(start + max, len - 1)
    const windowStart = Math.min(start + minScan, windowEnd)
    let bestIdx = -1
    let bestScore = -Infinity

    for (let i = windowStart; i <= windowEnd; i++) {
      const ch = text[i]
      let typeScore = 0
      if (STRONG_BREAK_CHARS.has(ch)) typeScore = 6
      else if (MID_BREAK_CHARS.has(ch)) typeScore = 3
      else if (WEAK_BREAK_CHARS.has(ch)) typeScore = 1
      if (typeScore === 0) continue
      const chunkLenIfHere = i - start + 1
      const distFromTarget = Math.abs(chunkLenIfHere - target)
      // 区切り文字の種類による優先度と、目安の文字数への近さを同じスケールで
      // 加減算する（句読点だからといって目安から極端に離れた位置を無条件に
      // 優先しない。両者のバランスで自然かつ長さの揃った分割にする）。
      const score = typeScore - distFromTarget
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    // 自然な区切りが見つからない場合は max 文字目で強制的に区切る
    // （必ず start より前進するため無限ループにはならない）。
    const splitAt = bestIdx >= 0 ? bestIdx + 1 : start + max
    chunks.push(text.slice(start, splitAt))
    start = splitAt
  }

  // 末尾が極端に短いチャンクになった場合は直前のチャンクへ吸収する
  // （2文字だけのテロップのような、極端に短い表示を避けるため）。
  while (chunks.length >= 2 && chunks[chunks.length - 1].length < minTail) {
    const tail = chunks.pop()
    chunks[chunks.length - 1] += tail
  }

  return chunks
}

/**
 * チャンク配列に対して、元segmentの [startSec, endSec] 内で文字数比率により
 * 時刻を配分する。単語単位のタイムスタンプが無い場合の決定的フォールバック。
 * 各区間は昇順・非重複（隣接区間はちょうど接する）で、最初の開始・最後の終了は
 * 元segmentの範囲と完全一致する。
 *
 * @param {number} startSec
 * @param {number} endSec
 * @param {string[]} chunkTexts
 * @returns {Array<{ startSec: number, endSec: number }>}
 */
export function allocateChunkTimes(startSec, endSec, chunkTexts) {
  if (chunkTexts.length === 0) return []
  if (chunkTexts.length === 1) return [{ startSec, endSec }]

  const lengths = chunkTexts.map((t) => Array.from(t).length)
  const totalLen = lengths.reduce((a, b) => a + b, 0)
  const duration = endSec - startSec

  const times = []
  let acc = 0
  let prevEnd = startSec
  for (let i = 0; i < chunkTexts.length; i++) {
    acc += lengths[i]
    const isLast = i === chunkTexts.length - 1
    const end = isLast || totalLen === 0 ? endSec : startSec + (duration * acc) / totalLen
    times.push({ startSec: prevEnd, endSec: end })
    prevEnd = end
  }
  return times
}

/**
 * Whisperの生segment配列から、表示用caption（{ text, startSec, endSec, sourceSegmentIndex }）
 * の配列を組み立てる。単語単位タイムスタンプ（seg.words）があればそれを優先して使う。
 *
 * @param {Array<{ startSec: number, endSec: number, text: string, words?: Array<{ word: string, startSec: number, endSec: number }> }>} rawSegments
 * @param {object} [options] splitTextIntoChunks に渡すオプション
 * @returns {Array<{ text: string, startSec: number, endSec: number, sourceSegmentIndex: number }>}
 */
export function buildDisplayCaptionsFromSegments(rawSegments, options = {}) {
  const results = []
  const segments = Array.isArray(rawSegments) ? rawSegments : []

  segments.forEach((seg, segIndex) => {
    const text = typeof seg?.text === 'string' ? seg.text : ''
    if (!text) return

    const chunks = splitTextIntoChunks(text, options)
    if (chunks.length === 0) return

    const times = hasUsableWordTimestamps(seg.words, text)
      ? allocateChunkTimesFromWords(seg.words, chunks, seg.startSec, seg.endSec)
      : allocateChunkTimes(seg.startSec, seg.endSec, chunks)

    chunks.forEach((chunkText, i) => {
      results.push({
        text: chunkText,
        startSec: times[i].startSec,
        endSec: times[i].endSec,
        sourceSegmentIndex: segIndex,
      })
    })
  })

  return results
}

/**
 * 単語単位タイムスタンプが「そのsegmentのテキストを過不足なく再構成できる」実用的な
 * 状態かどうかを判定する。壊れている/欠けている場合は文字数比率フォールバックへ回す。
 */
function hasUsableWordTimestamps(words, text) {
  if (!Array.isArray(words) || words.length === 0) return false
  const joined = words.map((w) => (typeof w?.word === 'string' ? w.word : '')).join('')
  // Whisperの word 分割は前後の空白の付き方が揺れるため、空白を除いた文字列同士で比較する。
  const normalize = (s) => s.replace(/\s/g, '')
  return normalize(joined) === normalize(text) && words.every((w) => Number.isFinite(w?.startSec) && Number.isFinite(w?.endSec))
}

/**
 * 単語単位タイムスタンプを使って、各チャンクの開始・終了時刻を決める。
 * チャンク境界に対応する単語のstart/endを使うため、文字数比率より実際の発話に近くなる。
 */
function allocateChunkTimesFromWords(words, chunks, segStartSec, segEndSec) {
  // 各単語が元テキスト中でどの文字位置に対応するかを、word.word の長さの累積で決める。
  let cursor = 0
  const wordSpans = words.map((w) => {
    const wLen = (w.word ?? '').length
    const span = { charStart: cursor, charEnd: cursor + wLen, startSec: w.startSec, endSec: w.endSec }
    cursor += wLen
    return span
  })

  const times = []
  let charCursor = 0
  let prevEndSec = segStartSec
  for (let i = 0; i < chunks.length; i++) {
    const chunkCharStart = charCursor
    const chunkCharEnd = charCursor + chunks[i].length
    charCursor = chunkCharEnd
    const isLast = i === chunks.length - 1

    let endSec
    if (isLast) {
      endSec = segEndSec
    } else {
      // このチャンクの最後の文字を含む単語の終了時刻を、チャンクの区切り時刻とする。
      const coveringWord = [...wordSpans].reverse().find((w) => w.charStart < chunkCharEnd)
      endSec = coveringWord ? coveringWord.endSec : segStartSec + (segEndSec - segStartSec) * (chunkCharEnd / cursor)
      // 単語時刻が壊れて逆行しないよう、直前の終了時刻・segment終了時刻でクランプする。
      endSec = Math.min(Math.max(endSec, prevEndSec), segEndSec)
    }

    times.push({ startSec: prevEndSec, endSec })
    prevEndSec = endSec
  }
  return times
}
