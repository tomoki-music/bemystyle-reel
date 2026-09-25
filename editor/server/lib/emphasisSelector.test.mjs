import { describe, it, expect } from 'vitest'
import { validateEmphasis, assignEmphasis } from './emphasisSelector.mjs'
import { buildDialogueText } from './captionStyles.mjs'

const CAPS = [
  { text: 'これはとても大事なことです。' },
  { text: '距離を取ることが一番ポイントです。' },
  { text: 'そういったところを大切にします。' },
  { text: '最後にもう一つだけ話します。' },
]

describe('validateEmphasis', () => {
  it('2〜10文字で本文の完全な部分文字列なら通る', () => {
    expect(validateEmphasis('とても大事', CAPS[0].text)).toBeNull()
  })
  it('本文に無い語・1文字・11文字以上は拒否する', () => {
    expect(validateEmphasis('存在しない', CAPS[0].text)).not.toBeNull()
    expect(validateEmphasis('と', CAPS[0].text)).not.toBeNull()
    expect(validateEmphasis('これはとても大事なことです', 'これはとても大事なことです。と続けます。長く')).not.toBeNull()
  })
  it('助詞・句読点だけの強調、caption全体に近い強調を拒否する', () => {
    expect(validateEmphasis('から', 'それからです')).not.toBeNull()
    expect(validateEmphasis('。。', 'はい。。')).not.toBeNull()
    expect(validateEmphasis('これはとても大事', 'これはとても大事')).not.toBeNull()
  })
  it('ASS特殊文字・改行を含む強調を拒否する', () => {
    expect(validateEmphasis('{\\b1}', 'a{\\b1}b')).not.toBeNull()
    expect(validateEmphasis('大事\\N', '大事\\Nです')).not.toBeNull()
  })
})

describe('assignEmphasis', () => {
  it('1captionにつき最大1か所、動画全体で最大3か所', () => {
    const r = assignEmphasis(CAPS, ['とても大事', '一番ポイント', '大切', 'もう一つ'])
    expect(r.applied).toHaveLength(3)
    expect(r.captions.filter((c) => c.emphasisText)).toHaveLength(3)
    expect(r.rejected.some((x) => /上限/.test(x.reason))).toBe(true)
  })
  it('強調は正本の完全な部分文字列で、元のcaptionは変更しない', () => {
    const frozen = CAPS.map((c) => Object.freeze({ ...c }))
    const r = assignEmphasis(frozen, ['とても大事'])
    expect(r.captions[0].text).toBe(CAPS[0].text)
    expect(r.captions[0].text.includes(r.captions[0].emphasisText)).toBe(true)
    expect(frozen[0].emphasisText).toBeUndefined()
  })
  it('強調0件でもよい（不自然な候補は全て却下される）', () => {
    const r = assignEmphasis(CAPS, ['は', '存在しない語'])
    expect(r.applied).toHaveLength(0)
    expect(r.captions.every((c) => c.emphasisText === null)).toBe(true)
  })
})

describe('部分強調のASS出力: 強調後に必ず通常スタイルへ戻る', () => {
  const HL = '&H004AB3F0&'
  it('強調範囲の直後に {\\r} が入り、後続の文字は通常スタイル', () => {
    const out = buildDialogueText({ text: 'これはとても大事なことです。', emphasisText: 'とても大事' }, HL)
    expect(out).toBe('これは{\\c004AB3F0&}とても大事{\\r}なことです。')
    const open = (out.match(/\{\\c/g) ?? []).length
    const reset = (out.match(/\{\\r\}/g) ?? []).length
    expect(reset).toBe(open)
  })
  it('文全体を色付けしない（強調範囲外は色タグを持たない）', () => {
    const out = buildDialogueText({ text: 'これはとても大事なことです。', emphasisText: 'とても大事' }, HL)
    expect(out.startsWith('これは')).toBe(true)
    expect(out.endsWith('なことです。')).toBe(true)
  })
  it('強調範囲が改行をまたぐ場合も、行ごとに色を閉じて次行へ持ち越さない', () => {
    const out = buildDialogueText({ text: 'とても大事なことです', lines: ['とても大', '事なことです'], emphasisText: 'とても大事' }, HL)
    expect(out).toBe('{\\c004AB3F0&}とても大{\\r}\\N{\\c004AB3F0&}事{\\r}なことです')
  })
  it('改行はレンダー時の \\N。本文(text)へは保存されない', () => {
    const caption = { text: 'これはとても大事なことですね', lines: ['これはとても大事', 'なことですね'], emphasisText: null }
    expect(buildDialogueText(caption, HL)).toBe('これはとても大事\\Nなことですね')
    expect(caption.text).not.toContain('\\N')
  })
  it('ASS特殊文字({}や\\)をタグとして解釈させない', () => {
    const out = buildDialogueText({ text: 'A{\\b1}B大事です', emphasisText: '大事' }, HL)
    expect(out).not.toContain('{\\b1}')
    expect(out).toContain('｛\\\\b1｝')
    expect(out).toContain('{\\c004AB3F0&}大事{\\r}')
  })
})
