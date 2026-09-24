import { describe, it, expect } from 'vitest'
import { restoreEmphasisText } from './emphasisRestore.mjs'

describe('restoreEmphasisText（表記だけの差を、本文側の正確な部分文字列へ復元）', () => {
  it('完全一致はそのまま（exact）', () => {
    expect(restoreEmphasisText('今日は大切な話', '大切な')).toEqual({ ok: true, text: '大切な', exact: true })
  })
  it('全角・半角、NFD/NFC、不可視文字、改行・連続空白の差を吸収して、元本文の文字列を返す', () => {
    expect(restoreEmphasisText('ＡＢＣライブ開催', 'ABCライブ')).toMatchObject({ ok: true, text: 'ＡＢＣライブ', exact: false })
    expect(restoreEmphasisText('半角ｶﾀｶﾅの話', 'カタカナ')).toMatchObject({ ok: true, text: 'ｶﾀｶﾅ' })
    expect(restoreEmphasisText('今日はがぎぐの話', 'がぎぐ')).toMatchObject({ ok: true, text: 'がぎぐ' })
    expect(restoreEmphasisText('とても　大事な話', 'とても\n\n  大事')).toMatchObject({ ok: true, text: 'とても　大事' })
    expect(restoreEmphasisText('距離感が大事', '​距離﻿感­')).toMatchObject({ ok: true, text: '距離感' })
  })
  it('複数箇所に一致する場合は復元しない（曖昧）', () => {
    expect(restoreEmphasisText('ライブとライブ', 'ﾗｲﾌﾞ')).toEqual({ ok: false, reason: 'ambiguous' })
  })
  it('意味的な類似・言い換え・1文字違い・句読点付きは復元しない（ファジー一致をしない）', () => {
    for (const p of ['大事な事', '重要な', '大切です', '大切な。', '大切']) {
      const r = restoreEmphasisText('今日は大切な話', p)
      if (p === '大切') expect(r.ok).toBe(true) // 完全な部分文字列
      else expect(r).toMatchObject({ ok: false, reason: 'not-found' })
    }
    expect(restoreEmphasisText('今日は大切な話', '   ')).toEqual({ ok: false, reason: 'empty' })
  })
  it('NFKCで複数文字に展開される文字の一部だけが一致する場合は復元しない', () => {
    expect(restoreEmphasisText('㈱ライブ', '株')).toMatchObject({ ok: false })
  })
  it('復元結果は常に本文の完全な部分文字列で、入力は変更しない', () => {
    const text = 'ＡＢＣ　ｌｉｖｅ　開催'
    const r = restoreEmphasisText(text, 'ABC live')
    expect(r.ok).toBe(true)
    expect(text.includes(r.text)).toBe(true)
  })
})
