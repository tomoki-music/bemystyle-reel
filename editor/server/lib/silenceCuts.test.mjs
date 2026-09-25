import { describe, it, expect } from 'vitest'
import { extractSilenceCandidates, planCutRange, classifyCandidates, applyCutLimits, summarizeCuts, findMidCaptionGaps, CUT_DEFAULTS, CLASS } from './silenceCuts.mjs'

const cap = (id, a, b, text = 'これは発話です。', extra = {}) => ({ id, startSec: a, endSec: b, text, ...extra })
const themes = [{ id: 't1', startSec: 0, endSec: 400 }, { id: 't2', startSec: 400, endSec: 900 }]
const base = { themes, protectedGaps: [], excludeRanges: [] }
const sil = (a, b, extra = {}) => ({ startSec: a, endSec: b, silenceSec: Math.round((b - a) * 1000) / 1000, meanDb: -62, thresholdDb: -49, motionMax: 1, ...extra })
// 発話 [100,110] と [113.2,120] の間の3.0秒の無音（削除は前後の余白を除いた約2.6秒）（captionは前後で切れている）
const spacedCaps = [cap('a', 100, 110), cap('b', 113.2, 120)]
const run = (silences, caps = spacedCaps, ctx = {}) => applyCutLimits(classifyCandidates(extractSilenceCandidates(silences), { captions: caps, ...base, ...ctx }))

describe('無音候補の抽出', () => {
  it('1.2秒以上の実測無音だけを候補にし、1.2秒未満は除外する', () => {
    const c = extractSilenceCandidates([sil(10, 11.19), sil(20, 21.2), sil(30, 33)])
    expect(c.map((x) => x.startSec)).toEqual([20, 30])
  })
  it('1.2秒未満（0.9秒以下の語中無音を含む）は、どんな条件でも自動カットの候補にならない', () => {
    expect(extractSilenceCandidates([sil(10, 10.72), sil(20, 20.67), sil(30, 30.9), sil(40, 41.19)])).toEqual([])
  })
})

describe('前後の余白と削除範囲', () => {
  it('前の発話終了後に約0.2秒・次の発話開始前に約0.15秒を残し、削除するのは中央部分だけ（フレーム境界）', () => {
    const p = planCutRange({ startSec: 110.0, endSec: 113.0 })
    expect(p.keepBeforeSec).toBeGreaterThanOrEqual(0.2 - 1e-9)
    expect(p.keepAfterSec).toBeGreaterThanOrEqual(0.15 - 1e-9)
    expect(p.keepBeforeSec).toBeLessThan(0.2 + 1 / 30 + 1e-9) // 余白を取りすぎない
    expect(p.cutSec).toBeCloseTo(3.0 - p.keepBeforeSec - p.keepAfterSec, 3)
    expect(Math.abs(p.cutStartSec * 30 - Math.round(p.cutStartSec * 30))).toBeLessThan(0.02) // 1/30秒の倍数（1/1000秒に丸めた表示）
    expect(Math.abs(p.cutEndSec * 30 - Math.round(p.cutEndSec * 30))).toBeLessThan(0.02)
    expect(p.cutSec).toBeLessThan(3.0) // 実測無音の全体は削除しない
  })
})

describe('分類（安全 / 人間の確認 / 禁止）', () => {
  it('発話の間の十分な無音は「安全にカット可能」で採用される', () => {
    const [r] = run([sil(110.0, 113.0)])
    expect(r.class).toBe(CLASS.SAFE)
    expect(r.decision).toBe('adopt')
    expect(r.prevCaptionId).toBe('a')
    expect(r.nextCaptionId).toBe('b')
    expect(r.sameSentence).toBe(false)
  })
  it('語中無音（承認済みの約0.72秒・約0.67秒を含む）はcaption内の間として検出され、その位置の無音はカット禁止', () => {
    // 正本の文字ごとの時刻: 1文字目〜, 語の途中に 0.72秒 / 0.67秒 の間
    const mk = (id, startIndex, gap) => ({ cap: cap(id, 0, 0, 'ああいうえお', { startIndex }), gap })
    const a = mk('m1', 0, 0.72)
    const b = mk('m2', 6, 0.67)
    const charStart = []
    const charEnd = []
    let t = 567
    for (const m of [a, b]) for (let k = 0; k < 6; k++) { if (k === 3) t += m.gap; charStart.push(t); t += 0.1; charEnd.push(t) }
    const gaps = findMidCaptionGaps([a.cap, b.cap], charStart, charEnd, 0.5)
    expect(gaps.map((g) => g.gapSec)).toEqual([0.72, 0.67])
    // その位置に、仮に1.2秒以上の無音として検出されても、語中は禁止
    const [r] = run([sil(gaps[0].startSec - 0.3, gaps[0].endSec + 0.4)], [], { protectedGaps: gaps })
    expect(r.class).toBe(CLASS.FORBIDDEN)
    expect(r.midWord).toBe(true)
    expect(r.decision).toBe('reject')
  })
  it('caption表示中はカットしない', () => {
    const [r] = run([sil(110.0, 113.0)], [cap('a', 100, 112), cap('b', 113.2, 120)])
    expect(r.class).toBe(CLASS.FORBIDDEN)
    expect(r.reason).toContain('caption表示中')
  })
  it('ダイジェストに使う発言の内部・冒頭LINEオーバーレイの内部・大きな動作・実測で無音でないものは禁止', () => {
    expect(run([sil(110, 113)], spacedCaps, { excludeRanges: [{ startSec: 108, endSec: 115 }] })[0].class).toBe(CLASS.FORBIDDEN)
    expect(run([sil(10, 13)], [cap('a', 0, 5), cap('b', 13.2, 20)])[0].reason).toContain('LINEオーバーレイ')
    expect(run([sil(110, 113, { motionMax: 12 })])[0].reason).toContain('大きな動作')
    expect(run([sil(110, 113, { meanDb: -36 })])[0].class).toBe(CLASS.FORBIDDEN)
  })
  it('一文の途中・テーマ切り替えの前後・信頼度が低いものは「人間の確認が必要」（採用しない）', () => {
    const mid = run([sil(110, 113)], [cap('a', 100, 110, 'ここで、'), cap('b', 113.2, 120)])[0]
    expect(mid.class).toBe(CLASS.REVIEW)
    expect(mid.decision).toBe('reject')
    const near = run([sil(398.4, 401.4)], [cap('a', 390, 398.5), cap('b', 401.6, 410)])[0]
    expect(near.class).toBe(CLASS.REVIEW)
    expect(near.nearThemeBoundary).toBe(true)
    expect(run([sil(110, 113, { meanDb: -51 })])[0].class).toBe(CLASS.REVIEW) // 閾値に近く、本当に無音か判断できない
  })
})

describe('カット量の上限', () => {
  const mkCaps = (starts) => starts.flatMap((s, i) => [cap(`p${i}`, s - 6, s), cap(`n${i}`, s + 3.2, s + 6)])
  it('1回のカットは最大3秒。超える候補は「人間の確認が必要」へ回す', () => {
    const [r] = run([sil(110, 116)], [cap('a', 100, 110), cap('b', 116.2, 125)]) // 6秒の無音 → 削除5.6秒
    expect(r.cutSec).toBeGreaterThan(3)
    expect(r.class).toBe(CLASS.REVIEW)
    expect(r.decision).toBe('reject')
    expect(r.reason).toContain('上限')
    const ok = run([sil(110, 113)], [cap('a', 100, 110), cap('b', 113.2, 125)])[0]
    expect(ok.cutSec).toBeLessThanOrEqual(3)
    expect(ok.decision).toBe('adopt')
  })
  it('1分間に最大3回', () => {
    const starts = [100, 114, 128, 142, 156] // 14秒間隔（間隔条件は満たす）
    const rows = run(starts.map((s) => sil(s, s + 3)), mkCaps(starts).sort((a, b) => a.startSec - b.startSec))
    const adopted = rows.filter((r) => r.decision === 'adopt')
    expect(adopted).toHaveLength(3)
    expect(rows.filter((r) => r.decision === 'reject').every((r) => r.class === CLASS.REVIEW && r.reason.includes('1分間'))).toBe(true)
  })
  it('連続するカットの間隔は最低5秒', () => {
    const rows = run([sil(100, 103), sil(107, 110)], [cap('a', 90, 100), cap('b', 103.2, 107), cap('c', 110.2, 120)])
    expect(rows.filter((r) => r.decision === 'adopt')).toHaveLength(1)
    expect(rows[1].reason).toContain('間隔')
  })
  it('本編全体の合計削除は最大60秒（上限を超えた候補は採用しない）', () => {
    const cfg = { ...CUT_DEFAULTS, maxPerMinute: 999, maxTotalSec: 60 }
    const starts = Array.from({ length: 30 }, (_, i) => 100 + i * 20)
    const caps = starts.flatMap((s, i) => [cap(`a${i}`, s - 6, s), cap(`b${i}`, s + 3.2, s + 10)]).sort((a, b) => a.startSec - b.startSec)
    const rows = applyCutLimits(classifyCandidates(extractSilenceCandidates(starts.map((s) => sil(s, s + 3))), { captions: caps, ...base, cfg }), cfg)
    const total = rows.filter((r) => r.decision === 'adopt').reduce((a, r) => a + r.cutSec, 0)
    expect(total).toBeLessThanOrEqual(60 + 1e-9)
    expect(rows.some((r) => r.reason.includes('合計'))).toBe(true)
  })
  it('集計は採用数・合計・最大を返し、採用0でも壊れない', () => {
    expect(summarizeCuts([], 900)).toMatchObject({ candidates: 0, adopted: 0, totalCutSec: 0, maxCutSec: 0, keptRatio: 1 })
    const s = summarizeCuts(run([sil(110, 113)]), 900)
    expect(s.adopted).toBe(1)
    expect(s.maxCutSec).toBeLessThanOrEqual(3)
  })
})
