// ローカルAIテロップ動画: 部分強調（重要な単語・短いフレーズだけ）の検証と割り当て。
//
// 強調はcaption全体ではなく、正本の完全な部分文字列だけに付ける。候補はローカルで人が/Claudeが選んだ
// 比較専用データで、既存ジョブやcaptionClassificationへは保存しない。AI APIは呼ばない。
//
// ルール:
// - 1captionにつき0〜1か所 / 全体で maxTotal か所まで（既定3）
// - 2〜10文字 / 正本caption本文に完全一致する部分文字列
// - 助詞・句読点だけの語は不可 / caption全体（本文の半分超）を覆う強調は不可
// - 該当するcaptionが複数あるときは、最初のcaptionにだけ付ける

import { PARTICLES, BOUND_WORDS, CONJUNCTIONS, isSpeechChar } from './japaneseText.mjs'

export const EMPHASIS_DEFAULTS = { minChars: 2, maxChars: 10, maxTotal: 3, maxCoverage: 0.5 }

/**
 * 強調候補1件の妥当性を検証する。問題があれば理由、なければ null。
 * @param {string} phrase
 * @param {string} captionText 対象captionの本文
 */
export function validateEmphasis(phrase, captionText, opts = {}) {
  const o = { ...EMPHASIS_DEFAULTS, ...opts }
  if (typeof phrase !== 'string' || phrase.length === 0) return '空の強調です'
  const len = Array.from(phrase).length
  if (len < o.minChars) return `${o.minChars}文字未満です`
  if (len > o.maxChars) return `${o.maxChars}文字を超えています`
  if (!captionText.includes(phrase)) return '本文の完全な部分文字列ではありません'
  if (/[\r\n]|\\N|[{}\\]/.test(phrase)) return '改行・ASS特殊文字を含みます'
  const speechChars = Array.from(phrase).filter((c) => isSpeechChar(c))
  if (speechChars.length === 0) return '句読点だけの強調です'
  if (PARTICLES.has(phrase) || BOUND_WORDS.has(phrase) || CONJUNCTIONS.has(phrase)) return '助詞・接続詞だけの強調です'
  if (phrase.length > captionText.length * o.maxCoverage) return 'caption全体に近い強調です'
  return null
}

/**
 * ページ(caption)配列へ強調候補を割り当てる。元の配列は変更しない。
 * @param {Array<{ text: string, emphasisText?: string | null }>} captions
 * @param {string[]} candidates 強調したい語句（出現順に依存しない）
 * @returns {{ captions: Array<object>, applied: string[], rejected: Array<{ index: number, reason: string }> }}
 *   applied は採用した語句の**件数分の長さ**。本文を返したくない呼び出し側は length / 文字数のみを使うこと。
 */
export function assignEmphasis(captions, candidates, opts = {}) {
  const o = { ...EMPHASIS_DEFAULTS, ...opts }
  const out = captions.map((c) => ({ ...c, emphasisText: null }))
  const applied = []
  const rejected = []
  const used = new Set()
  candidates.forEach((phrase, index) => {
    if (applied.length >= o.maxTotal) {
      rejected.push({ index, reason: `上限${o.maxTotal}か所を超えています` })
      return
    }
    let reason = 'どのcaptionにも含まれません'
    for (let i = 0; i < out.length; i++) {
      if (used.has(i) || !out[i].text.includes(phrase)) continue
      const problem = validateEmphasis(phrase, out[i].text, o)
      if (problem) {
        reason = problem
        continue
      }
      out[i].emphasisText = phrase
      used.add(i)
      applied.push(phrase)
      return
    }
    rejected.push({ index, reason })
  })
  return { captions: out, applied, rejected }
}
