// ローカルAIテロップ動画: 強調語を「候補ID選択」方式で決めるためのロジック（今後のAI分析用。今回は API を呼ばない）。
//
// 背景: AIに強調語の文字列を自由に生成させると、本文にない文字列（not-in-text）や長すぎる文字列が返る。
// 対策として、文字列の生成をAIに任せず、次の順に処理する:
//   1. ローカルで caption 本文から「強調可能な短い候補文字列」を生成する（語・文節の境界、2〜10文字、本文の完全な部分文字列）
//   2. 各候補へ、同じ caption 内で安定した candidate ID を付ける（caption ID + 本文中の位置）
//   3. AIには candidate ID だけを選ばせる（自由な文字列を生成させない）
//   4. 選択後、ローカルで本文の正確な部分文字列へ復元する（AIの文字列は一切使わない）
// これにより、未知の candidate ID を拒否するだけで、本文にない強調が生成されない構造になる。
//
// 純粋関数のみ。AI/LLM・外部APIは呼ばない。caption は変更しない。

import { segmentWords, PARTICLES, BOUND_WORDS, CONJUNCTIONS, isPunctChar, isSpaceChar } from './japaneseText.mjs'
import { validateEmphasis } from './emphasisSelector.mjs'
import { EMPHASIS_CATEGORIES } from './topicAnalysis.mjs'

export const CANDIDATE_DEFAULTS = { minChars: 2, maxChars: 10, maxUnits: 4 }

/**
 * @typedef {Object} EmphasisCandidate
 * @property {string} candidateId  `${captionId}:e${start}-${end}`（caption内の位置で決まるため、同じ本文なら常に同じID）
 * @property {string} captionId
 * @property {number} start        caption.text 内の開始位置（UTF-16 code unit）
 * @property {number} end          終了位置（排他的）
 * @property {string} text         caption.text.slice(start, end)
 */

export const candidateIdOf = (captionId, start, end) => `${captionId}:e${start}-${end}`

const hasBreak = (s) => Array.from(s).some((c) => isPunctChar(c) || isSpaceChar(c))
const isFunctionWord = (w) => PARTICLES.has(w) || BOUND_WORDS.has(w) || CONJUNCTIONS.has(w)
const isHiraganaFragment = (w) => w.length === 1 && /[ぁ-ゟ]/.test(w)

/**
 * 1つのcaptionから強調候補を生成する。
 * - 語（Intl.Segmenter）単位の連続 1〜maxUnits 語。先頭は内容語（助詞・形式語・接続詞・1文字のひらがなでない）、末尾は助詞でない
 * - 2〜10文字・句読点/空白を含まない・validateEmphasis に合格（助詞だけ・文全体に近い強調を除外）
 * - 同じcaption内で同じ文字列の候補は最初の1つだけ（重複除外）
 * @param {{ id: string, text: string }} caption
 * @returns {EmphasisCandidate[]}
 */
export function generateEmphasisCandidatesForCaption(caption, opts = {}) {
  const o = { ...CANDIDATE_DEFAULTS, ...opts }
  const words = segmentWords(caption.text)
  const out = []
  const seen = new Set()
  for (let i = 0; i < words.length; i++) {
    const first = words[i]
    if (!first.isWordLike || isFunctionWord(first.segment) || isHiraganaFragment(first.segment)) continue
    let text = ''
    for (let j = i; j < words.length && j < i + o.maxUnits; j++) {
      const w = words[j]
      text += w.segment
      if (Array.from(text).length > o.maxChars) break
      if (!w.isWordLike || hasBreak(text)) break
      if (isHiraganaFragment(w.segment) && j === i) continue
      if (PARTICLES.has(w.segment)) continue // 助詞で終わる候補は作らない（続く語まで含めた候補だけ）
      if (Array.from(text).length < o.minChars) continue
      if (seen.has(text)) continue
      const start = first.index
      const end = start + text.length
      if (caption.text.slice(start, end) !== text) continue
      if (validateEmphasis(text, caption.text) !== null) continue
      seen.add(text)
      out.push({ candidateId: candidateIdOf(caption.id, start, end), captionId: caption.id, start, end, text })
    }
  }
  return out
}

/** 全captionの候補を生成する。@returns {{ candidates: EmphasisCandidate[], byId: Map<string, EmphasisCandidate> }} */
export function generateEmphasisCandidates(captions, opts = {}) {
  const candidates = captions.flatMap((c) => generateEmphasisCandidatesForCaption(c, opts))
  return { candidates, byId: new Map(candidates.map((c) => [c.candidateId, c])) }
}

/** AIへ渡す入力（caption本文と、選べる候補の {id, text} 一覧）。AIには candidate ID を返させる。 */
export function buildCandidateSelectionInput(captions, candidates) {
  const by = new Map()
  for (const c of candidates) (by.get(c.captionId) ?? by.set(c.captionId, []).get(c.captionId)).push({ id: c.candidateId, text: c.text })
  return { captions: captions.map((c, i) => ({ order: i + 1, id: c.id, text: c.text, candidates: by.get(c.id) ?? [] })) }
}

/** AIの応答形式（候補IDだけを返す。強調語の文字列フィールドを持たない）。候補数が多いため enum にはせず、ローカルで検証する。 */
export function buildCandidateSelectionSchema() {
  return {
    type: 'object',
    properties: {
      emphasis: {
        type: 'array',
        items: {
          type: 'object',
          properties: { candidateId: { type: 'string' }, category: { type: 'string', enum: EMPHASIS_CATEGORIES }, confidence: { type: 'number' } },
          required: ['candidateId', 'category', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['emphasis'],
    additionalProperties: false,
  }
}

/**
 * 選択された candidate ID から、caption本文の正確な部分文字列を復元して検証する（AIの文字列は使わない）。
 * 未知のID・本文と食い違う候補（stale）・1captionに複数の選択・categoryやconfidenceの不正は、その候補だけを拒否する。
 *
 * @param {unknown} selection { emphasis: [{ candidateId, category, confidence }] }
 * @param {Map<string, EmphasisCandidate>} byId
 * @param {Array<{ id: string, text: string }>} captions
 * @returns {{ emphasis: Array<{ captionId: string, emphasisText: string, category: string, confidence: number }>, rejected: Array<{ index: number, code: string }> }}
 */
export function resolveEmphasisSelection(selection, byId, captions) {
  const text = new Map(captions.map((c) => [c.id, c.text]))
  const emphasis = []
  const rejected = []
  const used = new Set()
  const list = Array.isArray(selection?.emphasis) ? selection.emphasis : []
  list.forEach((s, index) => {
    const reject = (code) => rejected.push({ index, code })
    if (!s || typeof s !== 'object' || typeof s.candidateId !== 'string') return reject('shape')
    const c = byId.get(s.candidateId)
    if (!c) return reject('unknown-candidate')
    if (!EMPHASIS_CATEGORIES.includes(s.category)) return reject('category-invalid')
    if (typeof s.confidence !== 'number' || !(s.confidence >= 0 && s.confidence <= 1)) return reject('confidence-invalid')
    const body = text.get(c.captionId)
    if (body === undefined || body.slice(c.start, c.end) !== c.text) return reject('stale-candidate')
    if (used.has(c.captionId)) return reject('duplicate-in-caption')
    used.add(c.captionId)
    emphasis.push({ captionId: c.captionId, emphasisText: body.slice(c.start, c.end), category: s.category, confidence: s.confidence })
  })
  return { emphasis, rejected }
}
