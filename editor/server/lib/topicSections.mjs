// ローカルAIテロップ動画: 「現在のトークテーマ」(TopicSection)のデータ構造と検証。
//
// captionType / heading とは別の構造として扱う（無理に流用しない）。
//   type TopicSection = { id: string, title: string, startSec: number, endSec: number, source: 'manual' | 'ai' }
//
// 不変条件:
// - title は空文字不可（1〜2行に収まる長さ）。
// - startSec < endSec。時刻順に並び、互いに重複しない（隣接=endSec === 次のstartSec は可）。
// - 表示時刻は必ず caption 境界（captionの開始/終了）へスナップする。
// - テーマ未設定の区間を許容する（TopicSection が無い時間帯は何も表示しない）。
// - 手動修正できる構造: source='manual' は AI 生成結果より常に優先される（mergeTopicSections）。
//
// 純粋関数のみ。外部AIは呼ばない。入力(caption/既存ジョブ)は変更しない。

import { breakIntoLines } from './lineBreaker.mjs'

export const TOPIC_SOURCES = ['manual', 'ai']
export const TOPIC_TITLE_RECOMMENDED_MIN = 8
export const TOPIC_TITLE_RECOMMENDED_MAX = 18
/** これを超えるタイトルは2行に収まらないため拒否する（意味を保った短いテーマ名にする）。 */
export const TOPIC_TITLE_HARD_MAX = 24
export const TOPIC_TITLE_MAX_LINES = 2
export const TOPIC_TITLE_LINE_MAX_CHARS = 12
export const TOPIC_TITLE_LINE_HARD_MAX_CHARS = 14
/** 15分動画での目安。 */
export const TOPIC_COUNT_GUIDE = { min: 3, max: 8 }
/** AIテーマが手動テーマに削られた後、これより短い断片は捨てる。 */
export const MIN_TOPIC_FRAGMENT_SEC = 1

const EPS = 1e-6

/**
 * タイトルを最大2行へ分ける。改行は語の途中・助詞の直前を避ける（lineBreaker と同じ規則）。
 * 本文は変更しない: lines.join('') === title.trim()。
 *
 * @param {string} title
 * @returns {string[]}
 */
export function breakTopicTitle(title) {
  const t = typeof title === 'string' ? title.trim() : ''
  if (!t) return []
  return breakIntoLines(t, { maxLineChars: TOPIC_TITLE_LINE_MAX_CHARS, hardMaxLineChars: TOPIC_TITLE_LINE_HARD_MAX_CHARS })
}

/**
 * @param {unknown} title
 * @returns {{ ok: boolean, errors: string[], warnings: string[], lines: string[] }}
 */
export function validateTopicTitle(title) {
  const errors = []
  const warnings = []
  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, errors: ['タイトルが空です'], warnings, lines: [] }
  }
  const t = title.trim()
  if (/[\r\n]/.test(t)) errors.push('タイトルに改行を含めないでください（改行は自動で決まります）')
  const len = Array.from(t).length
  if (len > TOPIC_TITLE_HARD_MAX) errors.push(`タイトルが長すぎます（${len}文字。${TOPIC_TITLE_HARD_MAX}文字以内の短いテーマ名にしてください）`)
  if (len < TOPIC_TITLE_RECOMMENDED_MIN || len > TOPIC_TITLE_RECOMMENDED_MAX) {
    warnings.push(`目安の${TOPIC_TITLE_RECOMMENDED_MIN}〜${TOPIC_TITLE_RECOMMENDED_MAX}文字から外れています（${len}文字）`)
  }
  const lines = errors.length ? [] : breakTopicTitle(t)
  if (!errors.length && (lines.length > TOPIC_TITLE_MAX_LINES || lines.some((l) => Array.from(l).length > TOPIC_TITLE_LINE_HARD_MAX_CHARS))) {
    errors.push('タイトルが2行に収まりません')
  }
  return { ok: errors.length === 0, errors, warnings, lines }
}

/**
 * TopicSection[] の不変条件を検証する（変更しない）。
 *
 * @param {unknown} sections
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTopicSections(sections) {
  const errors = []
  if (!Array.isArray(sections)) return { ok: false, errors: ['TopicSectionが配列ではありません'] }
  const ids = new Set()
  let prevEnd = -Infinity
  sections.forEach((s, i) => {
    const at = `#${i}`
    if (!s || typeof s !== 'object') {
      errors.push(`${at}: TopicSectionがオブジェクトではありません`)
      return
    }
    if (typeof s.id !== 'string' || !s.id) errors.push(`${at}: idがありません`)
    else if (ids.has(s.id)) errors.push(`${at}: idが重複しています`)
    else ids.add(s.id)
    const tv = validateTopicTitle(s.title)
    if (!tv.ok) errors.push(...tv.errors.map((e) => `${at}: ${e}`))
    if (!TOPIC_SOURCES.includes(s.source)) errors.push(`${at}: sourceが不正です`)
    if (!Number.isFinite(s.startSec) || !Number.isFinite(s.endSec)) {
      errors.push(`${at}: 時刻が数値ではありません`)
      return
    }
    if (s.startSec < 0) errors.push(`${at}: startSecが負です`)
    if (!(s.startSec < s.endSec)) errors.push(`${at}: startSec < endSec を満たしません`)
    if (s.startSec < prevEnd - EPS) errors.push(`${at}: 時刻順でない、または前のテーマと重複しています`)
    prevEnd = Math.max(prevEnd, s.endSec)
  })
  return { ok: errors.length === 0, errors }
}

/**
 * caption境界へスナップした TopicSection[] を返す（入力は変更しない）。
 * - startSec → 最も近い caption の開始、endSec → 最も近い caption の終了。
 * - 前のテーマと重なる開始は、直前テーマの終了captionの次のcaption開始まで繰り下げる。
 * - captionが1つも無い、または潰れて空になったテーマは捨てる。
 *
 * @param {Array<{ id: string, title: string, startSec: number, endSec: number, source: 'manual'|'ai' }>} sections
 * @param {Array<{ startSec: number, endSec: number }>} captions
 * @returns {Array<{ id: string, title: string, startSec: number, endSec: number, source: 'manual'|'ai' }>}
 */
export function snapTopicSectionsToCaptions(sections, captions) {
  const caps = [...(captions ?? [])].filter((c) => Number.isFinite(c.startSec) && Number.isFinite(c.endSec)).sort((a, b) => a.startSec - b.startSec)
  if (!Array.isArray(sections) || caps.length === 0) return []
  const nearest = (t, key) => {
    let bi = 0
    let bd = Infinity
    caps.forEach((c, i) => {
      const d = Math.abs(c[key] - t)
      if (d < bd - EPS) {
        bd = d
        bi = i
      }
    })
    return bi
  }
  const ordered = [...sections].filter((s) => s && Number.isFinite(s.startSec) && Number.isFinite(s.endSec)).sort((a, b) => a.startSec - b.startSec)
  const out = []
  let prevEndIdx = -1
  for (const s of ordered) {
    let si = nearest(s.startSec, 'startSec')
    const ei = nearest(s.endSec, 'endSec')
    if (si <= prevEndIdx) si = prevEndIdx + 1
    if (si > ei || si >= caps.length) continue
    out.push({ ...s, startSec: caps[si].startSec, endSec: caps[ei].endSec })
    prevEndIdx = ei
  }
  return out
}

/**
 * AI生成テーマと手動テーマを統合する。手動(source='manual')が常に優先され、
 * 手動と重なる AI テーマの部分は削られる（手動の内側にあるAIテーマは消える）。
 * 断片は MIN_TOPIC_FRAGMENT_SEC 未満なら捨てる。結果は時刻順・非重複。
 * caption境界へのスナップは呼び出し側で snapTopicSectionsToCaptions を通す。
 *
 * @param {Array<object>} aiSections
 * @param {Array<object>} manualSections
 * @returns {Array<object>}
 */
export function mergeTopicSections(aiSections, manualSections) {
  const manual = [...(manualSections ?? [])].map((s) => ({ ...s, source: 'manual' })).sort((a, b) => a.startSec - b.startSec)
  const result = [...manual]
  for (const ai of aiSections ?? []) {
    let pieces = [{ ...ai, source: 'ai' }]
    for (const m of manual) {
      const next = []
      for (const p of pieces) {
        if (m.endSec <= p.startSec + EPS || m.startSec >= p.endSec - EPS) {
          next.push(p)
          continue
        }
        if (p.startSec < m.startSec - EPS) next.push({ ...p, id: `${p.id}-a`, endSec: m.startSec })
        if (p.endSec > m.endSec + EPS) next.push({ ...p, id: `${p.id}-b`, startSec: m.endSec })
      }
      pieces = next
    }
    for (const p of pieces) if (p.endSec - p.startSec >= MIN_TOPIC_FRAGMENT_SEC) result.push(p)
  }
  return result.sort((a, b) => a.startSec - b.startSec)
}

/**
 * 指定時刻に表示するテーマ（無ければ null = テーマ未設定区間）。
 * @param {Array<{ startSec: number, endSec: number }>} sections
 * @param {number} t
 */
export function topicAtTime(sections, t) {
  return (sections ?? []).find((s) => t >= s.startSec - EPS && t < s.endSec - EPS) ?? null
}

/**
 * 「同じテーマ名を連続して再表示しない」ための整理:
 * 隣接する（間が空いていない）同名テーマを1つに統合する。入力は変更しない。
 *
 * @param {Array<{ id: string, title: string, startSec: number, endSec: number, source: string }>} sections
 */
export function coalesceAdjacentSameTitle(sections) {
  const out = []
  for (const s of [...(sections ?? [])].sort((a, b) => a.startSec - b.startSec)) {
    const last = out[out.length - 1]
    if (last && last.title === s.title && s.startSec <= last.endSec + EPS) {
      out[out.length - 1] = { ...last, endSec: Math.max(last.endSec, s.endSec) }
    } else {
      out.push({ ...s })
    }
  }
  return out
}

/**
 * 表示用の最終整形: 統合 → caption境界スナップ → 検証。検証に失敗したら errors を返し sections は空。
 *
 * @param {{ ai?: object[], manual?: object[], captions: Array<{ startSec: number, endSec: number }> }} p
 * @returns {{ ok: boolean, sections: object[], errors: string[] }}
 */
export function resolveTopicSections(p) {
  const merged = coalesceAdjacentSameTitle(mergeTopicSections(p.ai ?? [], p.manual ?? []))
  const snapped = coalesceAdjacentSameTitle(snapTopicSectionsToCaptions(merged, p.captions))
  const v = validateTopicSections(snapped)
  return v.ok ? { ok: true, sections: snapped, errors: [] } : { ok: false, sections: [], errors: v.errors }
}
