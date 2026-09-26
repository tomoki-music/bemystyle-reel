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

/**
 * Wizard のカード用テキスト。空カードは作らず、実際の内容があるカードだけ（1〜count 個）。
 * 最新の分割結果があればそれを、なければ台本を文ごとに分けて使う（どちらもAPIなし）。
 * count を超えるときだけ、隣り合う要素を均等にまとめる（切り捨て・重複・言い換えはしない）。
 * 分割結果／文の本文は一切変更しない（前後の空白のトリムのみ）。
 */
export function handoffToCardTexts(h: ScriptHandoff, count = WIZARD_CARD_COUNT): { texts: string[]; usedSlides: boolean } {
  const usedSlides = Boolean(h.slides?.length)
  let base = usedSlides ? h.slides!.map((s) => s.text.trim()).filter(Boolean) : splitSentences(h.script)
  if (!base.length && h.script.trim()) base = [h.script.trim()] // 句読点だけなど、文として分けられない台本もそのまま1枚にする
  return { texts: mergeTo(base, count), usedSlides }
}

/**
 * n 枚のカードへ、既存の14役割（先頭=オープニング／末尾=エンディング／間=中間の12役割）を決定的に割り当てる。
 * n=14 のときは従来と完全に同じ（roles[i]）。n<14 の中間カードは重複なく順序を保って間引く。
 */
export function rolesForCount<T extends string>(roles: readonly T[], n: number): T[] {
  const total = roles.length
  if (n >= total) return Array.from({ length: n }, (_, i) => (roles[i] ?? (`シーン${i + 1}` as T)))
  if (n <= 1) return n === 1 ? [roles[0]] : []
  const middle = roles.slice(1, total - 1)
  const m = n - 2
  const picked = Array.from({ length: m }, (_, k) => middle[Math.floor((k * middle.length) / m)])
  return [roles[0], ...picked, roles[total - 1]]
}
