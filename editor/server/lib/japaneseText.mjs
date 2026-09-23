// ローカルAIテロップ動画: 日本語の語境界・文節境界の判定ヘルパー。
//
// 方針:
// - Intl.Segmenter('ja', { granularity: 'word' }) のみを使う（形態素解析の追加依存なし）。
// - ICUの語分割は活用語尾まで細かく割る（例: 崩|さ|ず|に）ため、そのままでは
//   「語境界」= 「切ってよい場所」にならない。助詞・活用断片・複合語・形式名詞は
//   直前の語に結合するルール(BOUND)で補い、「文節境界として切ってよい位置」を判定する。
// - AI/LLM は使わない。純粋関数のみ。

/** 助詞（ページ先頭・行頭に置いてはいけない）。 */
export const PARTICLES = new Set([
  'の', 'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'や', 'か', 'ね', 'よ', 'な', 'ぞ', 'ぜ', 'わ', 'さ',
  'から', 'まで', 'より', 'って', 'けど', 'けれど', 'けれども', 'ので', 'のに', 'だけ', 'しか', 'ほど',
  'など', 'なら', 'ば', 'て', 'で', 'たり', 'ながら', 'には', 'とは', 'にも', 'とか', 'なんて',
  'かな', 'かも', 'よね',
])

/** 助動詞・活用語尾・補助動詞・形式名詞など、直前の語に結合して読むべき語。 */
export const BOUND_WORDS = new Set([
  'です', 'ます', 'でした', 'ました', 'ません', 'でしょう', 'ましょう', 'だ', 'だっ', 'だった', 'たら', 'た',
  'ない', 'なかっ', 'なく', 'なけれ', 'れる', 'られる', 'れ', 'られ', 'せる', 'させる', 'たい', 'たく', 'たかっ',
  'いる', 'いた', 'いて', 'いない', 'いなかっ', 'ある', 'あった', 'あり', 'しまう', 'しまっ', 'おく', 'おい',
  'みる', 'みた', 'いく', 'いっ', 'くる', 'きた', 'こと', 'もの', 'ため', 'よう', 'わけ', 'はず', 'ほう', 'とこ',
  'っていう', 'という', 'といった', 'といっ', 'ところ', 'ところが', 'ちゃう', 'じゃう', 'ちゃっ', 'じゃっ',
  'って', 'ている', 'てる', 'ています', 'でいる', 'ですね', 'ますね', 'ですよ', 'ますよ',
])

/** 接続詞（ページ末尾に孤立させてはいけない / 直前は良い切れ目）。 */
export const CONJUNCTIONS = new Set([
  'そして', 'しかし', 'だから', 'また', 'さらに', 'でも', 'だが', 'ただ', 'なので', 'それで',
  'それに', 'それから', 'なお', 'つまり', 'ちなみに', 'あと', 'そこで', 'すると',
  'だって', 'なぜなら', 'たとえば', '例えば', 'あるいは', 'または', 'ところで', 'さて', 'では', 'じゃあ',
  'ですが', 'けれども',
])

/** 文末表現（この直後は意味のまとまりの切れ目として扱う）。 */
export const SENTENCE_FINAL_WORDS = new Set([
  'です', 'ます', 'でした', 'ました', 'ません', 'ですね', 'ますね', 'ですよ', 'ますよ', 'でしょう', 'ましょう',
  'だ', 'だよ', 'だね', 'よね', 'かな', 'ください', 'ですか', 'ますか', 'ない',
])

export const STRONG_PUNCT = new Set(['。', '！', '？', '!', '?', '．'])
export const COMMA_PUNCT = new Set(['、', ',', '，'])
const CLOSING_PUNCT = new Set(['」', '』', '）', ')', '］', ']', '】', '〉', '》', '”', '’'])
const OPENING_PUNCT = new Set(['「', '『', '（', '(', '［', '[', '【', '〈', '《', '“', '‘'])
const ANY_PUNCT = new Set([...STRONG_PUNCT, ...COMMA_PUNCT, ...CLOSING_PUNCT, '・', '…', '‥', '〜', '～'])

// 小書き仮名・長音・繰り返し記号（ページ/行の先頭に来てはいけない）。
const SMALL_KANA_START = /^[ゃゅょっぁぃぅぇぉゎャュョッァィゥェォヮー〜～ヽヾゝゞ々]/
const KANJI = /[㐀-鿿豈-﫿々〆]/
const KATAKANA = /[゠-ヿー]/
const HIRAGANA = /[ぁ-ゟ]/
const LATIN_DIGIT = /[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/
const DIGIT = /[0-9０-９]/

let segmenterSingleton = null
function getSegmenter() {
  if (!segmenterSingleton) segmenterSingleton = new Intl.Segmenter('ja', { granularity: 'word' })
  return segmenterSingleton
}

/**
 * text を語（Intl.Segmenter）単位に分割する。連結すると text と完全一致する。
 * @param {string} text
 * @returns {Array<{ segment: string, index: number, isWordLike: boolean }>}
 */
export function segmentWords(text) {
  return Array.from(getSegmenter().segment(text), (s) => ({
    segment: s.segment,
    index: s.index,
    isWordLike: Boolean(s.isWordLike),
  }))
}

/** text の語境界（ICU）の文字インデックス集合。0 と text.length を含む。 */
export function wordBoundaryIndices(text) {
  const set = new Set([0, text.length])
  for (const seg of getSegmenter().segment(text)) set.add(seg.index)
  return set
}

export function isPunctChar(ch) {
  return ANY_PUNCT.has(ch) || OPENING_PUNCT.has(ch)
}

export function isSpaceChar(ch) {
  return /\s/.test(ch)
}

/** 発話される文字か（句読点・空白・括弧ではない）。 */
export function isSpeechChar(ch) {
  return !isSpaceChar(ch) && !isPunctChar(ch)
}

export function startsWithSmallKanaOrLongVowel(text) {
  return SMALL_KANA_START.test(text ?? '')
}

/** 先頭の語が助詞か。 */
export function startsWithParticle(text) {
  if (!text) return false
  const first = segmentWords(text)[0]
  return Boolean(first) && PARTICLES.has(first.segment)
}

/**
 * 末尾の語が接続詞（直後に句読点なし）か。ページ末尾に接続詞だけが残る状態の検出用。
 */
export function endsWithDanglingConjunction(text) {
  if (!text) return false
  const last = text[text.length - 1]
  if (STRONG_PUNCT.has(last) || COMMA_PUNCT.has(last)) return false
  const words = segmentWords(text).filter((w) => w.isWordLike)
  const lastWord = words[words.length - 1]
  return Boolean(lastWord) && CONJUNCTIONS.has(lastWord.segment)
}

/**
 * 全位置(1..n-1)について、そこで切ってよいか・どんな切れ目かを分類する。
 *
 * 戻り値の配列は長さ n+1（index = 切る位置 p = p文字目の直前）。
 * - midToken : ICUの語の内部（単語途中）
 * - forbidden: 切ってはいけない理由（空配列なら切ってよい）
 *     'midtoken' | 'particle' | 'bound' | 'compound' | 'okurigana' | 'fragment' | 'smallkana' | 'punct' | 'space' | 'openquote'
 * - kind: 切れ目の強さ分類（strong=句点系, semantic=文末表現, comma=読点, conj=接続詞直前, phrase=文節, word=その他語境界）
 *
 * @param {string} text
 * @returns {Array<{ midToken: boolean, forbidden: string[], kind: string } | null>}
 */
export function classifyBoundaries(text) {
  const n = text.length
  const result = new Array(n + 1).fill(null)
  const words = segmentWords(text)
  const wordStartSet = new Map() // index -> word idx
  words.forEach((w, k) => wordStartSet.set(w.index, k))

  for (let p = 1; p < n; p++) {
    const prevChar = text[p - 1]
    const curChar = text[p]
    const k = wordStartSet.get(p)
    const info = { midToken: k === undefined, forbidden: [], kind: 'word' }
    const forbid = (r) => {
      if (!info.forbidden.includes(r)) info.forbidden.push(r)
    }

    if (info.midToken) {
      forbid('midtoken')
    } else {
      const cur = words[k]
      const prev = words[k - 1]
      const curSeg = cur.segment
      const prevSeg = prev ? prev.segment : ''
      if (PARTICLES.has(curSeg)) forbid('particle')
      else if (BOUND_WORDS.has(curSeg)) forbid('bound')
      else if (curSeg.length === 1 && HIRAGANA.test(curSeg) && !CONJUNCTIONS.has(curSeg)) forbid('fragment')
      // 漢字の直後に続く短いひらがなの語は送り仮名・活用語尾とみなす（忙|しく, 難|しい 等）
      if (KANJI.test(prevChar) && HIRAGANA.test(curChar) && curSeg.length <= 3 && !CONJUNCTIONS.has(curSeg)) forbid('okurigana')
      if (KANJI.test(prevChar) && KANJI.test(curChar)) forbid('compound')
      else if (KATAKANA.test(prevChar) && KATAKANA.test(curChar)) forbid('compound')
      else if (LATIN_DIGIT.test(prevChar) && LATIN_DIGIT.test(curChar)) forbid('compound')
      else if (DIGIT.test(prevChar) || DIGIT.test(curChar)) {
        // 「月2回」「3つ」のような数字と助数詞の間は切らない
        if (!isPunctChar(prevChar) && !isPunctChar(curChar) && !isSpaceChar(prevChar) && !isSpaceChar(curChar)) forbid('compound')
      }

      // 切れ目の種類
      if (STRONG_PUNCT.has(prevChar)) info.kind = 'strong'
      else if (CLOSING_PUNCT.has(prevChar) && p >= 2 && STRONG_PUNCT.has(text[p - 2])) info.kind = 'strong'
      else if (COMMA_PUNCT.has(prevChar)) info.kind = 'comma'
      else if (CONJUNCTIONS.has(curSeg)) info.kind = 'conj'
      else if (SENTENCE_FINAL_WORDS.has(prevSeg) && !PARTICLES.has(curSeg) && !BOUND_WORDS.has(curSeg)) info.kind = 'semantic'
      else if (PARTICLES.has(prevSeg) || BOUND_WORDS.has(prevSeg)) info.kind = 'phrase'
      else info.kind = 'word'
    }

    if (startsWithSmallKanaOrLongVowel(curChar)) forbid('smallkana')
    if (isPunctChar(curChar) && !OPENING_PUNCT.has(curChar)) forbid('punct')
    if (isSpaceChar(curChar)) forbid('space')
    if (OPENING_PUNCT.has(prevChar)) forbid('openquote')
    result[p] = info
  }
  return result
}

/**
 * ある位置 p で「単語途中/助詞始まり/断片始まり」などの不自然な分割になるか。
 * 旧方式・新方式の両方を同じ基準で採点するために使う。
 */
export function boundaryProblems(aText, bText) {
  const joined = aText + bText
  const info = classifyBoundaries(joined)[aText.length]
  if (!info) return { midWord: false, particleStart: false }
  const particleStart = info.forbidden.includes('particle')
  const midWord = info.forbidden.some((r) => ['midtoken', 'compound', 'okurigana', 'fragment', 'bound', 'smallkana'].includes(r))
  return { midWord, particleStart }
}
