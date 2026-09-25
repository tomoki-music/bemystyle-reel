import { describe, it, expect } from 'vitest'
import { planFullWindows, clipLegacyCaptions, mergeWindowCaptions, inheritCaptionTypes, carryOverEmphasis, validateFullCaptions, buildManualTopicSections, themeTexts, legacyCharRanges } from './fullPipeline.mjs'
import { refineForbidden, countBoundaryProblems, STANDALONE_ADVERBS } from './boundaryRules.mjs'
import { classifyBoundaries } from './japaneseText.mjs'
import { validateTopicSections, normalizeTopicSectionsContinuous } from './topicSections.mjs'

// 合成データ（実データ・実際の字幕本文は使わない）
const seg = (startSec, endSec, text) => ({ startSec, endSec, text })
const raw = [
  seg(0, 30, 'あいうえお。'.repeat(3)), // 18文字
  seg(30, 60, 'かきくけこ、'.repeat(3)), // 読点で終わる（窓の境界にしない）
  seg(60, 90, 'さしすせそ。'.repeat(3)),
  seg(90, 120, 'たちつてと。'.repeat(3)),
  seg(120, 150, 'なにぬねの。'.repeat(3)),
  seg(150, 180, 'はひふへほ。'.repeat(3)),
]
const total = 180

describe('planFullWindows（全編を文末のrawSegment境界で窓に分ける）', () => {
  const wins = planFullWindows(raw, { windowCount: 3, durationSec: total })
  it('窓は隙間なく連続し、全文字・全時間を覆う。最後の窓の終了は動画の長さ', () => {
    expect(wins[0].startIndex).toBe(0)
    wins.slice(1).forEach((w, i) => expect(w.startIndex).toBe(wins[i].endIndex))
    expect(wins[wins.length - 1].endIndex).toBe(raw.reduce((a, s) => a + s.text.length, 0))
    expect(wins[0].startSec).toBe(0)
    expect(wins[wins.length - 1].endSec).toBe(total)
    wins.forEach((w) => expect(w.durationSec).toBeCloseTo(w.endSec - w.startSec, 6))
  })
  it('境界は文末（。！？）で終わるsegmentの終わり。読点で終わるsegmentでは切らない', () => {
    const text = raw.map((s) => s.text).join('')
    for (const w of wins.slice(1)) expect('。！？'.includes(text[w.startIndex - 1])).toBe(true)
    const commaEnd = raw[1].text.length + raw[0].text.length
    expect(wins.some((w) => w.startIndex === commaEnd)).toBe(false)
  })
  it('窓の開始・終了時刻はrawSegmentの時刻（丸めない）', () => {
    const odd = [seg(0, 20.123, 'あ。'), seg(20.456, 41.789, 'い。'), seg(41.9, 60.5, 'う。')]
    const w = planFullWindows(odd, { windowCount: 2, durationSec: 60.5 })
    expect(w[1].startSec).toBe(w[0].endSec === 20.123 ? 20.456 : 41.9)
  })
})

describe('clipLegacyCaptions / mergeWindowCaptions', () => {
  const legacy = [{ startSec: 0, endSec: 10, text: 'あいうえおかきくけこ' }, { startSec: 10, endSec: 20, text: 'さしすせそ' }]
  it('範囲をまたぐ旧captionは文字数に比例して時刻を按分し、連結は範囲の本文と一致', () => {
    const c = clipLegacyCaptions(legacy, 5, 12)
    expect(c.map((x) => x.text).join('')).toBe('かきくけこさし')
    expect(c[0].startSec).toBeCloseTo(5, 6)
    expect(c[0].endSec).toBeCloseTo(10, 6)
    expect(c[1].startSec).toBeCloseTo(10, 6)
    expect(c[1].endSec).toBeCloseTo(14, 6)
  })
  it('窓の相対時刻を全編の絶対時刻・正本位置へ結合し、IDを振り直す（入力は変更しない）', () => {
    const wins = [{ startIndex: 0, startSec: 0 }, { startIndex: 4, startSec: 100 }]
    const per = [[{ startSec: 0, endSec: 1, text: 'あいうえ', startIndex: 0, lines: ['あいうえ'] }], [{ startSec: 2.5, endSec: 3.5, text: 'おか', startIndex: 0, lines: ['おか'] }]]
    const before = JSON.stringify(per)
    const m = mergeWindowCaptions(wins, per)
    expect(m.map((c) => [c.startSec, c.endSec, c.startIndex, c.id])).toEqual([[0, 1, 0, 'full-0000'], [102.5, 103.5, 4, 'full-0001']])
    expect(JSON.stringify(per)).toBe(before)
  })
})

describe('inheritCaptionTypes（旧captionの種別を正本上の文字範囲で引き継ぐ）', () => {
  const legacy = [
    { startSec: 0, endSec: 5, text: 'あいうえおかきくけこ', captionType: 'main' },
    { startSec: 5, endSec: 10, text: 'さしすせそ', captionType: 'sub' },
    { startSec: 10, endSec: 15, text: 'たちつてと', captionType: 'heading' },
  ]
  const caps = [
    { startIndex: 0, text: 'あいうえお' }, // main の内側
    { startIndex: 5, text: 'かきくけこ' }, // main の内側
    { startIndex: 10, text: 'さしす' }, // sub の内側
    { startIndex: 13, text: 'せそた' }, // sub とheadingにまたがる → 曖昧 → normal
    { startIndex: 16, text: 'ちつてと' }, // heading → normal（トークテーマ・LINE案内と競合するため引き継がない）
  ]
  it('内側は引き継ぎ、またがる・曖昧・headingは normal。件数を返す', () => {
    const r = inheritCaptionTypes(caps, legacy)
    expect(r.captions.map((c) => c.captionType)).toEqual(['main', 'main', 'sub', 'normal', 'normal'])
    expect(r.counts).toEqual({ main: 2, sub: 1, normal: 2 })
    expect(r.ambiguous).toBe(1)
    expect(r.headingDemoted).toBe(1)
    expect(r.captions.map((c) => c.text).join('')).toBe(caps.map((c) => c.text).join('')) // 本文は変えない
  })
  it('legacyCharRanges は連結した正本上の範囲', () => {
    expect(legacyCharRanges(legacy).map((r) => [r.startIndex, r.endIndex])).toEqual([[0, 10], [10, 15], [15, 20]])
  })
})

describe('carryOverEmphasis（承認済みの強調を正本位置で引き継ぐ）', () => {
  const caps = [{ startIndex: 0, text: 'あいうえお' }, { startIndex: 5, text: 'かきくけこ' }, { startIndex: 10, text: 'さしすせそ' }]
  it('同じ正本位置の完全な部分文字列だけ引き継ぐ。本文にない強調・重複・範囲外は引き継がない', () => {
    const r = carryOverEmphasis(caps, [
      { globalStartIndex: 5, text: 'かきくけこ', emphasisText: 'きく' },
      { globalStartIndex: 10, text: 'さしすせそ', emphasisText: 'ぬね' }, // 本文にない
      { globalStartIndex: 0, text: 'あいうえお', emphasisText: 'いう' },
      { globalStartIndex: 0, text: 'あいうえお', emphasisText: 'えお' }, // 同じcaptionに2件目
    ])
    expect(r.captions.map((c) => c.emphasisText)).toEqual(['いう', 'きく', null])
    expect(r.carried).toBe(2)
    expect(r.dropped).toBe(2)
  })
})

describe('validateFullCaptions（全編の不変条件）', () => {
  const ok = [
    { startSec: 0, endSec: 1, text: 'あいう', lines: ['あいう'], startIndex: 0 },
    { startSec: 1.2, endSec: 2, text: 'えお', lines: ['え', 'お'], startIndex: 3 },
  ]
  it('正常なcaptionは合格', () => {
    expect(validateFullCaptions(ok, 'あいうえお').ok).toBe(true)
  })
  it('正本との不一致・空caption・時刻逆転/重複・3行以上・30文字超・改行混入・startIndexの不連続を検出', () => {
    expect(validateFullCaptions(ok, 'あいうえか').problems.join()).toContain('正本')
    expect(validateFullCaptions([{ ...ok[0], text: '', lines: [''] }, ok[1]], 'えお').problems.join()).toContain('空')
    expect(validateFullCaptions([ok[0], { ...ok[1], startSec: 0.5 }], 'あいうえお').problems.join()).toContain('重複')
    expect(validateFullCaptions([{ ...ok[0], endSec: 0 }, ok[1]], 'あいうえお').problems.join()).toContain('逆転')
    expect(validateFullCaptions([{ ...ok[0], lines: ['あ', 'い', 'う'] }, ok[1]], 'あいうえお').problems.join()).toContain('3行')
    const long = 'あ'.repeat(31)
    expect(validateFullCaptions([{ startSec: 0, endSec: 1, text: long, lines: [long], startIndex: 0 }], long).problems.join()).toContain('30文字')
    expect(validateFullCaptions([{ ...ok[0], text: 'あ\\Nい', lines: ['あ\\Nい'] }], 'あ\\Nい').problems.join()).toContain('改行')
    expect(validateFullCaptions([ok[0], { ...ok[1], startIndex: 4 }], 'あいうえお').problems.join()).toContain('startIndex')
  })
})

describe('buildManualTopicSections（常時表示の手動テーマ）', () => {
  const caps = Array.from({ length: 10 }, (_, i) => ({ startSec: i * 10 + 0.4, endSec: i * 10 + 9, text: `ぶん${i}` }))
  const defs = [{ id: 't1', title: 'バンド脱退の悩み', startCaptionIndex: 0 }, { id: 't2', title: '熱量と目的の違い', startCaptionIndex: 4 }, { id: 't3', title: '歌の配信と歌唱診断', startCaptionIndex: 8 }]
  it('先頭は0秒・最後は本編終了まで・隙間も重複もなく、すべて manual（AI再生成で上書きされない）', () => {
    const s = buildManualTopicSections(defs, caps, 100.5)
    expect(s[0].startSec).toBe(0)
    expect(s[s.length - 1].endSec).toBe(100.5)
    s.slice(1).forEach((x, i) => expect(x.startSec).toBe(s[i].endSec))
    expect(s.every((x) => x.source === 'manual')).toBe(true)
    expect(validateTopicSections(s).ok).toBe(true)
    const n = normalizeTopicSectionsContinuous(s, { startSec: 0, endSec: 100.5 })
    expect(n.stats.afterCoverage).toBe(1)
    expect(n.stats.undisplayedSec).toBe(0)
    expect(n.stats.overlapSec).toBe(0)
  })
  it('テーマ区間の本文（根拠確認用）は区間内のcaption本文の連結', () => {
    const s = buildManualTopicSections(defs, caps, 100.5)
    const t = themeTexts(s, caps)
    expect(t).toHaveLength(3)
    expect(t[0]).toBe('ぶん0ぶん1ぶん2ぶん3')
    expect(t.join('')).toBe(caps.map((c) => c.text).join(''))
  })
})

describe('境界規則の補正（是非・直後の長い無音）', () => {
  it('独立した副詞「是非」の直後は、漢字が続いても複合語の途中とみなさない（語頭のときだけ）', () => {
    expect(STANDALONE_ADVERBS).toContain('是非')
    const t = '皆さん是非興味のある方は'
    const p = t.indexOf('興味')
    const info = classifyBoundaries(t)[p]
    expect(info.forbidden).toContain('compound') // 素朴な判定では過検出
    expect(refineForbidden(t, p, info)).toEqual([])
    // 直前が漢字（複合語の一部）のときは免除しない
    const t2 = '国是非興味'
    const info2 = classifyBoundaries(t2)[3]
    if (info2?.forbidden.includes('compound')) expect(refineForbidden(t2, 3, info2)).toContain('compound')
  })
  it('直後に0.6秒以上の実測の無音があるページ末尾の接続詞（でも）は孤立とみなさない。無音がなければ孤立', () => {
    const pages = ['そういうコミュニティでも', '一人抜けたりとか']
    expect(countBoundaryProblems(pages, { gaps: [0.62] }).danglingConjunction).toBe(0)
    expect(countBoundaryProblems(pages, { gaps: [0.1] }).danglingConjunction).toBe(1)
    expect(countBoundaryProblems(pages).danglingConjunction).toBe(1)
  })
})
