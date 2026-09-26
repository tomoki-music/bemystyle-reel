import { describe, it, expect } from 'vitest'
import { buildScriptHandoff, handoffToCardTexts, splitSentences, rolesForCount, HANDOFF_TITLE_MAX_CHARS } from './scriptHandoff'

const deepFreeze = <T,>(o: T): T => { Object.values(o as object).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v) }); return Object.freeze(o) }

describe('buildScriptHandoff', () => {
  const base = { concept: '歌が上手くなる方法\n初心者向け', fallbackTitle: '教育系', script: '  編集した台本です。  ', slides: null }
  it('編集後の台本（前後の空白を除いたもの）とタイトルを渡す', () => {
    expect(buildScriptHandoff(base)).toEqual({ title: '歌が上手くなる方法', script: '編集した台本です。' })
  })
  it('空白だけの台本は渡さない（null）', () => {
    for (const script of ['', '   ', '\n\t\n']) expect(buildScriptHandoff({ ...base, script })).toBeNull()
  })
  it('タイトル: コンセプトの最初の非空行 → パターン名 → 既定値。長すぎれば切る', () => {
    expect(buildScriptHandoff({ ...base, concept: '\n\n  二行目から  \nx' })?.title).toBe('二行目から')
    expect(buildScriptHandoff({ ...base, concept: '  ' })?.title).toBe('教育系')
    expect(buildScriptHandoff({ ...base, concept: '', fallbackTitle: undefined })?.title).toBe('台本から作成')
    expect([...(buildScriptHandoff({ ...base, concept: 'あ'.repeat(200) })?.title ?? '')]).toHaveLength(HANDOFF_TITLE_MAX_CHARS)
  })
  it('最新の分割結果（分割時の台本が現在の台本と一致）だけ渡す', () => {
    const slides = { source: '編集した台本です。', items: [{ text: ' a ' }, { text: 'b' }, { text: '  ' }] }
    const h = buildScriptHandoff({ ...base, slides })
    expect(h?.slides).toEqual([{ text: ' a ' }, { text: 'b' }])
  })
  it('古い分割結果（台本を編集した後）は渡さない', () => {
    const h = buildScriptHandoff({ ...base, slides: { source: '編集前の台本です。', items: [{ text: 'a' }] } })
    expect(h).toEqual({ title: '歌が上手くなる方法', script: '編集した台本です。' })
    expect('slides' in (h ?? {})).toBe(false)
  })
  it('入力を変更せず、渡すオブジェクトは入力と共有しない', () => {
    const slides = deepFreeze({ source: '編集した台本です。', items: [{ text: 'a' }] })
    const h = buildScriptHandoff({ ...base, slides })!
    expect(h.slides![0]).not.toBe(slides.items[0])
    h.slides![0].text = '変更'
    expect(slides.items[0].text).toBe('a')
  })
})

const strip = (t: string) => t.replace(/\s/g, '')
const sentences = (n: number) => Array.from({ length: n }, (_, i) => `これは${i + 1}つ目の文です。`)

describe('splitSentences / handoffToCardTexts（可変枚数・空カードなし・欠落/重複なし）', () => {
  it('文（。！？・改行）ごとに分け、記号は残す', () => {
    expect(splitSentences('一つ目です。二つ目！三つ目？\n\n四つ目')).toEqual(['一つ目です。', '二つ目！', '三つ目？', '四つ目'])
  })
  it('分割結果 1・8・12・14 枚は、その枚数のまま空カードなしで変換する', () => {
    for (const n of [1, 8, 12, 14]) {
      const slides = Array.from({ length: n }, (_, i) => ({ text: `シーン${i + 1}` }))
      const r = handoffToCardTexts({ title: 't', script: 's', slides })
      expect(r.usedSlides).toBe(true)
      expect(r.texts).toEqual(slides.map((s) => s.text))
      expect(r.texts.every((t) => t.trim().length > 0)).toBe(true)
    }
  })
  it('分割結果なしは、台本を文ごとに（1・8・12・14文 → その枚数）空カードなしで変換する', () => {
    for (const n of [1, 8, 12, 14]) {
      const script = sentences(n).join('')
      const r = handoffToCardTexts({ title: 't', script })
      expect(r.usedSlides).toBe(false)
      expect(r.texts).toEqual(sentences(n))
    }
  })
  it('15文以上は隣り合う文を均等にまとめて最大14枚。切り捨てず、順序・本文を保つ（再結合が元の台本と一致）', () => {
    for (const n of [15, 16, 20, 27, 28, 29, 50, 100]) {
      const script = sentences(n).join('')
      const r = handoffToCardTexts({ title: 't', script })
      expect(r.texts).toHaveLength(14)
      expect(r.texts.every((t) => t.length > 0)).toBe(true)
      expect(r.texts.join('')).toBe(script) // 欠落・重複・順序入れ替えなし
      const sizes = r.texts.map((t) => t.split('。').length - 1)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1) // 均等
    }
  })
  it('台本の完全性: 改行・空白・絵文字・多様な句読点を含んでも、空白を除いた再結合が元の台本と一致する', () => {
    const scripts = [
      '冒頭です！\n\n本編その1。　本編その2？ 😀すごい!\nまとめ',
      Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? `文${i}!` : i % 3 === 1 ? `文${i}？\n` : `文${i}。 `)).join(''),
      '句読点なしの長い一文がそのまま一枚になります',
      '。。。',
      'A。B。C。',
    ]
    for (const script of scripts) {
      const r = handoffToCardTexts({ title: 't', script })
      expect(r.texts.length).toBeGreaterThanOrEqual(1)
      expect(r.texts.length).toBeLessThanOrEqual(14)
      expect(r.texts.every((t) => t.trim().length > 0)).toBe(true)
      expect(strip(r.texts.join(''))).toBe(strip(script))
    }
  })
  it('分割結果が15枚以上（想定外）でも、均等にまとめて本文を欠落させない', () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({ text: `S${i + 1}` }))
    const r = handoffToCardTexts({ title: 't', script: 's', slides })
    expect(r.texts).toHaveLength(14)
    expect(r.texts.join('')).toBe(slides.map((s) => s.text).join(''))
  })
  it('空の分割テキストは除く。不変（凍結入力でも動く）。固定のデモ文言を混ぜない', () => {
    const h = deepFreeze({ title: 't', script: 's', slides: [{ text: ' a ' }, { text: '  ' }, { text: 'b' }] })
    const r = handoffToCardTexts(h)
    expect(r.texts).toEqual(['a', 'b'])
    expect(h.slides).toHaveLength(3)
    expect(r.texts.join('')).not.toContain('歌が上手くなる')
  })
  it('古い分割結果は buildScriptHandoff で外れ、最新の台本からカードが作られる', () => {
    const h = buildScriptHandoff({ concept: 'c', script: '新しい一文です。もう一文です。', slides: { source: '古い台本', items: [{ text: '古い分割' }] } })!
    const r = handoffToCardTexts(h)
    expect(r.usedSlides).toBe(false)
    expect(r.texts).toEqual(['新しい一文です。', 'もう一文です。'])
  })
  it('空白だけの台本は受け渡しを拒否する', () => {
    expect(buildScriptHandoff({ concept: 'c', script: ' \n\t ', slides: null })).toBeNull()
  })
})

describe('rolesForCount（既存の14役割の割り当て）', () => {
  const ROLES = ['オープニング', '問題提起', '共感', 'ポイント①', '解説', 'ポイント②', '実践例', 'ポイント③', '深掘り', 'Before/After', '背中を押す', 'まとめ', 'CTA', 'エンディング'] as const
  it('14枚は従来と完全に同じ', () => {
    expect(rolesForCount(ROLES, 14)).toEqual([...ROLES])
  })
  it('1〜13枚: すべて既存の有効なrole・先頭=オープニング・末尾=エンディング・重複なし・元の順序を保つ', () => {
    for (let n = 2; n <= 13; n++) {
      const r = rolesForCount(ROLES, n)
      expect(r).toHaveLength(n)
      expect(r[0]).toBe('オープニング')
      expect(r[n - 1]).toBe('エンディング')
      expect(new Set(r).size).toBe(n)
      expect(r.every((x) => (ROLES as readonly string[]).includes(x))).toBe(true)
      const idx = r.map((x) => ROLES.indexOf(x as (typeof ROLES)[number]))
      expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    }
    expect(rolesForCount(ROLES, 1)).toEqual(['オープニング'])
    expect(rolesForCount(ROLES, 0)).toEqual([])
  })
})
