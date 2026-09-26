import { describe, it, expect } from 'vitest'
import { buildScriptHandoff, handoffToCardTexts, splitSentences, HANDOFF_TITLE_MAX_CHARS } from './scriptHandoff'

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

describe('splitSentences / handoffToCardTexts', () => {
  it('文（。！？・改行）ごとに分け、記号は残す', () => {
    expect(splitSentences('一つ目です。二つ目！三つ目？\n\n四つ目')).toEqual(['一つ目です。', '二つ目！', '三つ目？', '四つ目'])
  })
  it('分割結果があればそれを使い、常に14個（足りない分は空）', () => {
    const r = handoffToCardTexts({ title: 't', script: 's', slides: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] })
    expect(r.usedSlides).toBe(true)
    expect(r.texts).toHaveLength(14)
    expect(r.texts.slice(0, 3)).toEqual(['A', 'B', 'C'])
    expect(r.texts.slice(3).every((t) => t === '')).toBe(true)
    expect(r.filled).toBe(3)
  })
  it('分割結果がなければ台本を文ごとに使う（AIなし）', () => {
    const script = Array.from({ length: 14 }, (_, i) => `文${i + 1}です。`).join('')
    const r = handoffToCardTexts({ title: 't', script })
    expect(r.usedSlides).toBe(false)
    expect(r.texts).toEqual(Array.from({ length: 14 }, (_, i) => `文${i + 1}です。`))
    expect(r.filled).toBe(14)
  })
  it('14個より多ければ、隣り合う文を均等にまとめて14個にし、本文は失わない', () => {
    const script = Array.from({ length: 30 }, (_, i) => `文${i + 1}。`).join('')
    const r = handoffToCardTexts({ title: 't', script })
    expect(r.texts).toHaveLength(14)
    expect(r.texts.every((t) => t.length > 0)).toBe(true)
    expect(r.texts.join('')).toBe(script)
  })
  it('14個より少なければ、長い文を「、」で分けて増やす（分けられなければ空のまま）', () => {
    const r = handoffToCardTexts({ title: 't', script: '一つ目の、長い文の、途中で、区切れます。二つ目です。' })
    expect(r.filled).toBeGreaterThan(2)
    expect(r.texts.filter(Boolean)).toHaveLength(r.filled)
    expect(r.texts.filter(Boolean).join('')).toContain('区切れます')
    const none = handoffToCardTexts({ title: 't', script: '区切りのない一文です。' })
    expect(none.filled).toBe(1)
    expect(none.texts.slice(1).every((t) => t === '')).toBe(true)
  })
  it('固定のデモ文言を混ぜず、入力を変更しない', () => {
    const h = deepFreeze({ title: 't', script: '短い台本です。', slides: [{ text: 'x' }] })
    const r = handoffToCardTexts(h)
    expect(r.texts.join('')).not.toContain('歌が上手くなる')
    expect(h.slides).toEqual([{ text: 'x' }])
  })
})
