import type { ScriptHandoff, ScriptSlide } from '../../types'

// ScriptMode → Wizard の受け渡しの純粋関数（外部APIは呼ばない。入力オブジェクトは変更しない）。

export const HANDOFF_TITLE_MAX_CHARS = 60
export const WIZARD_CARD_COUNT = 14

const clip = (s: string, max: number) => [...s].slice(0, max).join('')

/**
 * 受け渡しデータを作る。台本が空白だけなら null。
 * - slides は「分割した時点の台本」が現在の（編集後の）台本と一致するときだけ含める（古い分割結果は渡さない）。
 * - タイトルはコンセプトの最初の行 → 台本パターン名 → 既定値、の順。
 */
export function buildScriptHandoff(p: {
  concept: string
  fallbackTitle?: string
  script: string
  slides: { source: string; items: ScriptSlide[] } | null
}): ScriptHandoff | null {
  const script = p.script.trim()
  if (!script) return null
  const conceptLine = p.concept.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const title = clip(conceptLine || (p.fallbackTitle ?? '').trim() || '台本から作成', HANDOFF_TITLE_MAX_CHARS)
  const handoff: ScriptHandoff = { title, script }
  if (p.slides && p.slides.source === script) {
    const items = p.slides.items.map((s) => ({ text: s.text })).filter((s) => s.text.trim())
    if (items.length) handoff.slides = items
  }
  return handoff
}

/** 文（。！？ / 改行）ごとに分ける。区切り記号は文に残す。 */
export function splitSentences(script: string): string[] {
  const out: string[] = []
  for (const line of script.split(/\r?\n/)) {
    const parts = line.match(/[^。！？!?]+[。！？!?]*/g) ?? []
    for (const p of parts) { const t = p.trim(); if (t) out.push(t) }
  }
  return out
}

/** count より多いときは、隣り合う要素をなるべく均等にまとめて count 個にする。 */
function mergeTo(segs: string[], count: number): string[] {
  if (segs.length <= count) return segs
  const base = Math.floor(segs.length / count)
  const extra = segs.length % count
  const out: string[] = []
  let i = 0
  for (let g = 0; g < count; g++) {
    const n = base + (g < extra ? 1 : 0)
    out.push(segs.slice(i, i + n).join(''))
    i += n
  }
  return out
}

/** count より少ないときは、いちばん長い「、」入りの要素を「、」で二つに分けて増やす（分けられなくなったら止める）。 */
function fillByClauses(segs: string[], count: number): string[] {
  const out = [...segs]
  while (out.length < count) {
    let idx = -1
    for (let i = 0; i < out.length; i++) if (out[i].includes('、') && (idx < 0 || [...out[i]].length > [...out[idx]].length)) idx = i
    if (idx < 0) break
    const chars = [...out[idx]]
    const mid = chars.length / 2
    let cut = -1
    chars.forEach((c, i) => { if (c === '、' && i < chars.length - 1 && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i })
    if (cut < 0) break // 末尾の「、」だけ
    const head = chars.slice(0, cut).join('').trim()
    const tail = chars.slice(cut + 1).join('').trim()
    if (!head || !tail) break
    out.splice(idx, 1, head, tail)
  }
  return out
}

/**
 * Wizard のカード用テキスト（ちょうど count 個。足りない分は空文字）。
 * 最新の分割結果があればそれを使い、なければ台本を文ごとに分ける（どちらもAPIなし）。
 */
export function handoffToCardTexts(h: ScriptHandoff, count = WIZARD_CARD_COUNT): { texts: string[]; filled: number; usedSlides: boolean } {
  const usedSlides = Boolean(h.slides?.length)
  const base = usedSlides ? h.slides!.map((s) => s.text.trim()).filter(Boolean) : splitSentences(h.script)
  const segs = fillByClauses(mergeTo(base, count), count)
  const texts = Array.from({ length: count }, (_, i) => segs[i] ?? '')
  return { texts, filled: Math.min(segs.length, count), usedSlides }
}
