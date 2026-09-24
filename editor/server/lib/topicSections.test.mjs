import { describe, it, expect } from 'vitest'
import {
  validateTopicTitle,
  breakTopicTitle,
  validateTopicSections,
  snapTopicSectionsToCaptions,
  mergeTopicSections,
  topicAtTime,
  coalesceAdjacentSameTitle,
  resolveTopicSections,
  extractTopicTerms,
  checkTopicTitleGrounding,
  editTopicTitle,
  isTopicCandidate,
  TOPIC_TITLE_HARD_MAX,
} from './topicSections.mjs'

const S = (id, title, startSec, endSec, source = 'manual') => ({ id, title, startSec, endSec, source })
const caps = [
  { startSec: 1.38, endSec: 3.32 },
  { startSec: 3.32, endSec: 5.58 },
  { startSec: 5.58, endSec: 8.16 },
  { startSec: 8.4, endSec: 12 },
  { startSec: 12.5, endSec: 20 },
  { startSec: 20.2, endSec: 30 },
]

describe('validateTopicTitle', () => {
  it('空文字・空白のみ・非文字列は拒否する', () => {
    for (const t of ['', '   ', '\n', null, undefined, 3]) expect(validateTopicTitle(t).ok).toBe(false)
  })
  it('目安(8〜18文字)の範囲外は警告、長すぎるタイトルは拒否する', () => {
    expect(validateTopicTitle('活動との距離の取り方')).toMatchObject({ ok: true, warnings: [] })
    expect(validateTopicTitle('短い').warnings.length).toBe(1)
    expect(validateTopicTitle('あ'.repeat(TOPIC_TITLE_HARD_MAX + 1)).ok).toBe(false)
  })
  it('タイトル内の改行は拒否する（改行は自動で決まる）', () => {
    expect(validateTopicTitle('活動と\n距離').ok).toBe(false)
  })
  it('最大2行に収まり、lines を連結すると元のタイトルと一致する', () => {
    for (const t of ['活動との距離の取り方', 'サークルとバンドを両立する考え方', 'あ'.repeat(24)]) {
      const lines = breakTopicTitle(t)
      expect(lines.length).toBeLessThanOrEqual(2)
      expect(lines.join('')).toBe(t)
    }
    expect(breakTopicTitle('活動との距離の取り方')).toHaveLength(1)
    expect(breakTopicTitle('サークルとバンドを両立する考え方')).toHaveLength(2)
  })
})

describe('validateTopicSections', () => {
  it('正しい並び（隣接を含む）を受け入れる', () => {
    expect(validateTopicSections([S('a', '話題その一です', 1, 5), S('b', '話題その二です', 5, 9, 'ai')]).ok).toBe(true)
    expect(validateTopicSections([]).ok).toBe(true) // テーマ未設定
  })
  it('startSec >= endSec を拒否する', () => {
    expect(validateTopicSections([S('a', '話題その一です', 5, 5)]).ok).toBe(false)
    expect(validateTopicSections([S('a', '話題その一です', 6, 5)]).ok).toBe(false)
  })
  it('時刻順でない並びを拒否する', () => {
    expect(validateTopicSections([S('b', '話題その二です', 10, 12), S('a', '話題その一です', 1, 5)]).ok).toBe(false)
  })
  it('重複（1ms でも重なる）を拒否する', () => {
    const r = validateTopicSections([S('a', '話題その一です', 1, 5), S('b', '話題その二です', 4.999, 9)])
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('重複')
  })
  it('空タイトル・id重複・不正sourceを拒否する', () => {
    expect(validateTopicSections([S('a', '', 1, 5)]).ok).toBe(false)
    expect(validateTopicSections([S('a', '話題その一です', 1, 5), S('a', '話題その二です', 6, 9)]).ok).toBe(false)
    expect(validateTopicSections([{ ...S('a', '話題その一です', 1, 5), source: 'auto' }]).ok).toBe(false)
  })
})

describe('snapTopicSectionsToCaptions', () => {
  it('開始は最も近いcaption開始、終了は最も近いcaption終了へスナップする', () => {
    const out = snapTopicSectionsToCaptions([S('a', '話題その一です', 3.5, 11.7)], caps)
    expect(out).toHaveLength(1)
    expect(out[0].startSec).toBe(3.32)
    expect(out[0].endSec).toBe(12)
  })
  it('スナップ結果は必ずcaption境界の時刻になる', () => {
    const starts = new Set(caps.map((c) => c.startSec))
    const ends = new Set(caps.map((c) => c.endSec))
    const out = snapTopicSectionsToCaptions([S('a', '話題その一です', 0.2, 7), S('b', '話題その二です', 9, 29)], caps)
    for (const s of out) {
      expect(starts.has(s.startSec)).toBe(true)
      expect(ends.has(s.endSec)).toBe(true)
    }
  })
  it('隣接テーマがスナップで重ならない', () => {
    const out = snapTopicSectionsToCaptions([S('a', '話題その一です', 1, 12.4), S('b', '話題その二です', 12.4, 30)], caps)
    expect(validateTopicSections(out).ok).toBe(true)
    expect(out[1].startSec).toBeGreaterThanOrEqual(out[0].endSec)
  })
  it('入力を変更しない', () => {
    const input = [S('a', '話題その一です', 3.5, 11.7)]
    const copy = JSON.stringify(input)
    snapTopicSectionsToCaptions(input, caps)
    expect(JSON.stringify(input)).toBe(copy)
  })
  it('captionが無い・潰れて空になるテーマは捨てる', () => {
    expect(snapTopicSectionsToCaptions([S('a', '話題その一です', 1, 5)], [])).toEqual([])
  })
})

describe('テーマ未設定区間', () => {
  const sections = [S('a', '話題その一です', 3.32, 8.16), S('b', '話題その二です', 12.5, 20)]
  it('セクション外は null（何も表示しない）', () => {
    expect(topicAtTime(sections, 1.5)).toBeNull()
    expect(topicAtTime(sections, 10)).toBeNull()
    expect(topicAtTime(sections, 25)).toBeNull()
  })
  it('境界は [start, end) で、隣接するテーマが同時に表示されない', () => {
    expect(topicAtTime(sections, 3.32)?.id).toBe('a')
    expect(topicAtTime(sections, 8.16)).toBeNull()
    const adj = [S('a', '話題その一です', 1, 5), S('b', '話題その二です', 5, 9)]
    expect(topicAtTime(adj, 4.999)?.id).toBe('a')
    expect(topicAtTime(adj, 5)?.id).toBe('b')
  })
  it('未設定区間を含む並びも検証を通る', () => {
    expect(validateTopicSections(sections).ok).toBe(true)
  })
})

describe('手動優先のマージ', () => {
  it('手動テーマと重なるAIテーマ部分は削られ、手動が残る', () => {
    const merged = mergeTopicSections([S('ai1', 'AIテーマその一です', 1, 30, 'ai')], [S('m1', '手動テーマその一', 10, 20)])
    expect(merged.find((s) => s.id === 'm1')).toMatchObject({ startSec: 10, endSec: 20, source: 'manual' })
    expect(validateTopicSections(merged).ok).toBe(true)
    expect(merged.filter((s) => s.source === 'ai').map((s) => [s.startSec, s.endSec])).toEqual([[1, 10], [20, 30]])
  })
  it('手動に完全に覆われたAIテーマは消える', () => {
    const merged = mergeTopicSections([S('ai1', 'AIテーマその一です', 12, 15, 'ai')], [S('m1', '手動テーマその一', 10, 20)])
    expect(merged.map((s) => s.id)).toEqual(['m1'])
  })
  it('手動テーマはAIの出力より常に優先され、source は変更されない', () => {
    const merged = mergeTopicSections([S('ai1', 'AIテーマその一です', 1, 30, 'ai')], [S('m1', '手動テーマその一', 1, 30, 'ai')])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('manual')
  })
})

describe('resolveTopicSections / 連続同名', () => {
  it('隣接する同名テーマを統合し、同じテーマ名を連続して再表示しない', () => {
    const out = coalesceAdjacentSameTitle([S('a', '同じテーマ名です', 1, 5), S('b', '同じテーマ名です', 5, 9)])
    expect(out).toHaveLength(1)
    expect(out[0].endSec).toBe(9)
  })
  it('統合→スナップ→検証を通したものだけを返す', () => {
    const r = resolveTopicSections({ manual: [S('m', '活動との距離の取り方', 1.4, 29.9)], captions: caps })
    expect(r.ok).toBe(true)
    expect(r.sections[0]).toMatchObject({ startSec: 1.38, endSec: 30 })
  })
  it('不正なタイトルは検証で弾かれる', () => {
    const r = resolveTopicSections({ manual: [S('m', '', 1.4, 29.9)], captions: caps })
    expect(r.ok).toBe(false)
    expect(r.sections).toEqual([])
  })
})

describe('テーマ名の対象語の検証（抽象化しすぎ・別概念への置き換えの再発防止）', () => {
  // 合成の正本（実際の字幕本文ではない）。対象は「メンバー」との関係。
  const canonical = 'バンドのメンバーと一緒にやるのがきついなと思ったら距離を取ることが大事で、活動は続けられます。'

  it('対象語（2文字以上のカタカナ連続・漢字連続）を取り出す。「取り方」のような活用語は対象外', () => {
    expect(extractTopicTerms('メンバーとの距離の取り方')).toEqual(['メンバー', '距離'])
    expect(extractTopicTerms('活動との距離の取り方')).toEqual(['活動', '距離'])
    expect(extractTopicTerms('')).toEqual([])
  })

  it('修正後のテーマ「メンバーとの距離の取り方」: 対象語が正本に実在し、必須語(メンバー)も残っている', () => {
    const r = checkTopicTitleGrounding('メンバーとの距離の取り方', canonical, { requiredTerms: ['メンバー', '距離'] })
    expect(r.ok).toBe(true)
    expect(r.ungroundedTerms).toEqual([])
    expect(r.missingRequired).toEqual([])
  })

  it('誤ったテーマ「活動との距離の取り方」は、必須語「メンバー」を落としているので不合格（「メンバー」を「活動」へ置き換えない）', () => {
    const r = checkTopicTitleGrounding('活動との距離の取り方', canonical, { requiredTerms: ['メンバー'] })
    expect(r.ok).toBe(false)
    expect(r.missingRequired).toEqual(['メンバー'])
  })

  it('正本にない主語・対象を推測で作ったテーマは不合格（ungroundedTerms に出る）', () => {
    const r = checkTopicTitleGrounding('後輩との距離の取り方', canonical)
    expect(r.ok).toBe(false)
    expect(r.ungroundedTerms).toEqual(['後輩'])
  })

  it('必須語の指定そのものが正本に無い場合も不合格（指定ミスを検出）', () => {
    const r = checkTopicTitleGrounding('メンバーとの距離の取り方', 'まったく別の内容の本文です', { requiredTerms: ['メンバー'] })
    expect(r.ok).toBe(false)
    expect(r.requiredNotInCanonical).toEqual(['メンバー'])
  })
})

describe('手動修正の優先（AIの候補は確定値ではなく編集可能な候補）', () => {
  const ai = (id, title, a, b) => ({ id, title, startSec: a, endSec: b, source: 'ai' })
  it('AI生成のテーマは候補、手動テーマは確定値として区別できる', () => {
    expect(isTopicCandidate(ai('a', '活動との距離の取り方', 1, 9))).toBe(true)
    expect(isTopicCandidate(S('m', 'メンバーとの距離の取り方', 1, 9))).toBe(false)
  })

  it('テーマ名を手動で修正すると source=manual になり、時刻・idは変わらず、入力は変更されない', () => {
    const input = Object.freeze([Object.freeze(ai('t1', '活動との距離の取り方', 1.38, 60))])
    const r = editTopicTitle(input, 't1', 'メンバーとの距離の取り方')
    expect(r.ok).toBe(true)
    expect(r.sections[0]).toEqual({ id: 't1', title: 'メンバーとの距離の取り方', startSec: 1.38, endSec: 60, source: 'manual' })
    expect(input[0].title).toBe('活動との距離の取り方')
  })

  it('空タイトル・長すぎるタイトルの修正は拒否され、元のテーマが残る', () => {
    const input = [S('t1', 'メンバーとの距離の取り方', 1, 9)]
    expect(editTopicTitle(input, 't1', '  ').ok).toBe(false)
    expect(editTopicTitle(input, 't1', 'あ'.repeat(30)).ok).toBe(false)
    expect(editTopicTitle(input, 'nope', 'メンバーとの距離').ok).toBe(false)
    expect(editTopicTitle(input, 't1', '  ').sections).toBe(input)
  })

  it('手動修正したテーマ名は、その後にAIが別のテーマ名を生成し直しても上書きされない', () => {
    const edited = editTopicTitle([ai('t1', '活動との距離の取り方', 1.38, 60)], 't1', 'メンバーとの距離の取り方').sections
    const regenerated = [ai('t1', '活動との距離の取り方', 1.38, 60), ai('t2', '別の話題の題名です', 10, 40)]
    const r = resolveTopicSections({ manual: edited.filter((s) => s.source === 'manual'), ai: regenerated, captions: [{ startSec: 1.38, endSec: 60 }] })
    expect(r.ok).toBe(true)
    expect(r.sections).toHaveLength(1)
    expect(r.sections[0]).toMatchObject({ title: 'メンバーとの距離の取り方', source: 'manual' })
  })
})
