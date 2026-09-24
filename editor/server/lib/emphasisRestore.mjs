// ローカルAIテロップ動画: AIが返した強調語を、caption本文の「正確な部分文字列」へ安全に復元する。
//
// AIの強調語は本文の完全な部分文字列であるべきだが、次の「表記だけの差」で完全一致しないことがある:
//   - Unicode正規化（NFC/NFD/NFKCの差）
//   - 全角・半角（英数字・カタカナ・記号）
//   - 不可視文字（ゼロ幅スペース・BOM・ソフトハイフン等）
//   - 改行・連続空白・全角空白
// これらの差だけを取り除いた形（正規化形）で比較し、本文内に「ちょうど1か所」一致するときに限り、
// 元本文側の正確な部分文字列を返す（AIの文字列は使わない）。
//
// 復元しないもの（null を返す）:
//   - 一致しない（ファジー一致・意味的な類似・語の置き換えは行わない）
//   - 複数箇所に一致する（どの箇所か特定できない）
//   - 元の文字の途中で切れる一致（NFKCで複数文字に展開される文字の一部だけが一致する等）
//
// 純粋関数。AI/LLMは使わない。

// 不可視文字・空白（正規化形では除去する）。ゼロ幅系・BOM・ソフトハイフン・方向制御・各種空白。
const INVISIBLE_OR_SPACE = /[\s­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/u

/**
 * 文字列を正規化形にし、正規化後の各文字が元の何文字目(コードポイント単位)から来たかを返す。
 * @param {string} text
 * @returns {{ norm: string[], origin: number[], originFirst: boolean[], originLast: boolean[], chars: string[] }}
 */
function normalizeWithMap(text) {
  const chars = Array.from(text)
  const norm = []
  const origin = []
  const originFirst = []
  const originLast = []
  chars.forEach((ch, i) => {
    const n = Array.from(ch.normalize('NFKC')).filter((c) => !INVISIBLE_OR_SPACE.test(c))
    n.forEach((c, k) => {
      norm.push(c)
      origin.push(i)
      originFirst.push(k === 0)
      originLast.push(k === n.length - 1)
    })
  })
  return { norm, origin, originFirst, originLast, chars }
}

/**
 * @param {string} captionText caption本文（正本）
 * @param {string} phrase AIが返した強調語
 * @returns {{ ok: true, text: string, exact: boolean } | { ok: false, reason: 'not-found' | 'ambiguous' | 'empty' | 'partial-char' }}
 */
export function restoreEmphasisText(captionText, phrase) {
  if (typeof phrase !== 'string' || typeof captionText !== 'string') return { ok: false, reason: 'empty' }
  if (phrase.length > 0 && captionText.includes(phrase)) return { ok: true, text: phrase, exact: true }
  const needle = Array.from(phrase.normalize('NFKC')).filter((c) => !INVISIBLE_OR_SPACE.test(c))
  if (needle.length === 0) return { ok: false, reason: 'empty' }
  const hay = normalizeWithMap(captionText)
  const hits = []
  for (let i = 0; i + needle.length <= hay.norm.length; i++) {
    let match = true
    for (let k = 0; k < needle.length; k++) {
      if (hay.norm[i + k] !== needle[k]) {
        match = false
        break
      }
    }
    if (match) hits.push(i)
  }
  if (hits.length === 0) return { ok: false, reason: 'not-found' }
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' }
  const start = hits[0]
  const end = start + needle.length - 1
  if (!hay.originFirst[start] || !hay.originLast[end]) return { ok: false, reason: 'partial-char' }
  const first = hay.origin[start]
  const last = hay.origin[end]
  const text = hay.chars.slice(first, last + 1).join('')
  // 復元結果は必ず本文の完全な部分文字列（念のための自己検証）
  if (!captionText.includes(text)) return { ok: false, reason: 'not-found' }
  return { ok: true, text, exact: false }
}
