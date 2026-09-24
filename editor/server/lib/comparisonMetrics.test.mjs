import { describe, it, expect } from 'vitest'
import {
  measureCaptionTiming,
  normalizedSimilarity,
  countPunctuation,
  analyzeMissing,
  properNounPreservation,
  countForbiddenBoundaries,
  measureSyncAgainstAudio,
  measureBoundaryAlignment,
  readabilityStats,
  stats,
} from './comparisonMetrics.mjs'

describe('normalizedSimilarity', () => {
  it('句読点・空白の違いは無視して一致率を出す', () => {
    expect(normalizedSimilarity('こんにちは、世界。', 'こんにちは 世界')).toBe(1)
  })
  it('内容が異なれば低くなる', () => {
    expect(normalizedSimilarity('今日は晴れです', '明日は雨でした')).toBeLessThan(0.7)
  })
  it('全角半角(NFKC)を同一視する', () => {
    expect(normalizedSimilarity('ＡＢＣ123', 'abc１２３')).toBe(1)
  })
})

describe('countPunctuation', () => {
  it('読点・句点・感嘆符・疑問符を数える', () => {
    expect(countPunctuation('あ、い。う！え？お')).toBe(4)
  })
})

describe('analyzeMissing', () => {
  it('完全一致なら欠落なし', () => {
    const r = analyzeMissing('今日は晴れです', '今日は晴れです')
    expect(r.missingRatio).toBe(0)
    expect(r.longestMissingRun).toBe(0)
  })
  it('ローカル結果に無い連続部分を欠落として検出する', () => {
    const r = analyzeMissing('今日はとても良い天気ですね明日も晴れる', '今日は明日も晴れる')
    expect(r.longestMissingRun).toBeGreaterThanOrEqual(8)
    expect(r.missingRunsOver8).toBeGreaterThanOrEqual(1)
  })
})

describe('properNounPreservation', () => {
  it('カタカナ・英数字の語がローカル結果に保持されている割合を返す（本文は返さない）', () => {
    const r = properNounPreservation('バンドとサークルとLINEです', 'バンドとサークルとらいんです')
    expect(r.total).toBe(3)
    expect(r.kept).toBe(2)
    expect(JSON.stringify(r)).not.toContain('バンド')
  })
  it('対象語が無ければ ratio=1', () => {
    expect(properNounPreservation('今日は晴れ', 'きょうははれ').ratio).toBe(1)
  })
})

describe('countForbiddenBoundaries', () => {
  it('旧方式のような単語途中・助詞始まりの分割を数え、自然な分割は0', () => {
    const bad = countForbiddenBoundaries(['相手のペースも崩', 'さずに進める', '努力', 'は必要です'])
    expect(bad.forbidden).toBeGreaterThanOrEqual(2)
    const good = countForbiddenBoundaries(['相手のペースも', '崩さずに', '進めます。'])
    expect(good.forbidden).toBe(0)
    expect(good.boundaries).toBe(2)
  })
})

describe('stats / readabilityStats', () => {
  it('基本統計', () => {
    expect(stats([1, 2, 3, 4])).toMatchObject({ count: 4, min: 1, max: 4, mean: 2.5, median: 2.5 })
    expect(stats([]).count).toBe(0)
  })
  it('読み速度(文字/秒)と閾値超過数', () => {
    const r = readabilityStats([
      { text: 'あ'.repeat(20), startSec: 0, endSec: 2 }, // 10cps
      { text: 'あ'.repeat(10), startSec: 2, endSec: 5 }, // 3.3cps
    ])
    expect(r.over8cps).toBe(1)
    expect(r.charsPerSec.max).toBeCloseTo(10)
  })
})

describe('measureSyncAgainstAudio', () => {
  it('表示開始直後/終了直前の無音の長さと、無音を表示している割合を測る', () => {
    // 20msフレーム × 100 = 2秒。0-0.4秒は無音、それ以外は発話
    const db = Array.from({ length: 100 }, (_, i) => (i < 20 ? -80 : -20))
    const r = measureSyncAgainstAudio([{ startSec: 0, endSec: 1 }], db, 0.02, -50)
    expect(r.leadingSilentSec.max).toBeCloseTo(0.4, 1)
    expect(r.silentDisplayRatio).toBeCloseTo(0.4, 1)
    expect(r.trailingSilentSec.max).toBe(0)
  })
})

describe('measureBoundaryAlignment', () => {
  const silences = [{ startSec: 2.0, endSec: 2.5 }, { startSec: 6.0, endSec: 6.4 }]
  it('発話再開(無音の終わり)に開始が合うcaptionを数える', () => {
    const r = measureBoundaryAlignment([{ startSec: 0, endSec: 2.1 }, { startSec: 2.55, endSec: 6.0 }, { startSec: 6.4, endSec: 9 }], silences)
    expect(r.startsAtSpeechOnset).toBe(2)
    expect(r.endsAtPause).toBe(2)
  })
  it('無音を丸ごと表示し続けるcaptionを数える', () => {
    const r = measureBoundaryAlignment([{ startSec: 1.0, endSec: 3.0 }], silences)
    expect(r.shownThroughSilence).toBe(1)
  })
})

describe('measureCaptionTiming: 発話(DTW文字時刻)との差', () => {
  const text = 'あいうえおかきくけこ'
  const timing = { charStart: Array.from(text, (_, i) => i * 0.1), charEnd: Array.from(text, (_, i) => i * 0.1 + 0.1) }

  it('caption開始/終了と発話開始/終了の差、500ms以上の先行・遅延を数える', () => {
    const caps = [
      { text: 'あいうえお', startSec: -0.6, endSec: 0.5, startIndex: 0 }, // 600ms先行
      { text: 'かきくけこ', startSec: 1.0, endSec: 1.05, startIndex: 5 }, // 500ms遅れ
    ]
    const m = measureCaptionTiming(caps, timing, [])
    expect(m.early500ms).toBe(1)
    expect(m.late500ms).toBe(1)
    expect(m.startLeadSec.max).toBeCloseTo(0.6, 5)
  })

  it('無音を1秒以上またいで残るcaption・発話終了後に1秒以上残るcaptionを数える', () => {
    const caps = [{ text: 'あいうえおかきくけこ', startSec: 0, endSec: 3.0, startIndex: 0 }]
    expect(measureCaptionTiming(caps, timing, []).silentOver1s).toBe(1)
    const caps2 = [{ text: 'あいうえおかきくけこ', startSec: 0, endSec: 1.1, startIndex: 0 }]
    expect(measureCaptionTiming(caps2, timing, [{ startSec: 0.0, endSec: 1.4 }]).silentOver1s).toBe(1)
  })

  it('句点をまたぐ後続文が1秒以上先に表示されている件数を数える', () => {
    const t2 = 'はい。そうです'
    const tm = { charStart: [], charEnd: [] }
    let x = 0
    for (const ch of t2) {
      if (ch === '。') {
        tm.charStart.push(x)
        tm.charEnd.push(x)
        continue
      }
      tm.charStart.push(x)
      tm.charEnd.push(x + 0.5)
      x += 0.5
    }
    const m = measureCaptionTiming([{ text: t2, startSec: 0, endSec: 4, startIndex: 0 }], tm, [])
    expect(m.laterSentenceEarlyOver1s).toBe(1)
  })
})
