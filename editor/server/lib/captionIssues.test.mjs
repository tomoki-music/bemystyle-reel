import { describe, it, expect } from 'vitest'
import { analyzeCaptionIssues, summarizeIssues, selectMostProblematicWindow } from './captionIssues.mjs'

const cap = (text, startSec, endSec) => ({ text, startSec, endSec })

describe('analyzeCaptionIssues', () => {
  it('句読点なしの30文字ちょうどの強制分割を検出する', () => {
    const t = '今日は天気が良いので散歩に出かけて公園で花を見て帰ってきまし'
    expect(t.length).toBe(30)
    const flags = analyzeCaptionIssues([cap(t, 0, 4), cap('た。', 4, 6)])
    expect(flags[0].forcedSplit).toBe(true)
  })

  it('30文字でも句点で終わっていれば強制分割ではない', () => {
    const t = '今日は天気が良いので散歩に出かけて公園で花を見て帰ってきた。'
    const flags = analyzeCaptionIssues([cap(t.padEnd(30, 'あ').slice(0, 29) + '。', 0, 4), cap('次の文', 4, 6)])
    expect(flags[0].forcedSplit).toBe(false)
  })

  it('次ページ先頭が助詞・単語途中・2秒未満・30文字超を検出する', () => {
    const flags = analyzeCaptionIssues([
      cap('相手', 0, 1.5),
      cap('のペースを崩', 1.5, 4),
      cap('さずに進める', 4, 7),
      cap('あ'.repeat(31), 7, 12),
    ])
    expect(flags[0].particleStart).toBe(true)
    expect(flags[0].short).toBe(true)
    expect(flags[1].midWord).toBe(true)
    expect(flags[3].long).toBe(true)
  })

  it('末尾が接続詞だけで終わるcaptionを検出する', () => {
    const flags = analyzeCaptionIssues([cap('今日は晴れです。そして', 0, 3), cap('明日は雨です。', 3, 6)])
    expect(flags[0].danglingConj).toBe(true)
  })

  it('入力配列を変更しない', () => {
    const caps = [cap('相手', 0, 1), cap('のペース', 1, 3)]
    const before = JSON.stringify(caps)
    analyzeCaptionIssues(caps)
    expect(JSON.stringify(caps)).toBe(before)
  })
})

describe('summarizeIssues', () => {
  it('種類別と合計(danglingConjは補助指標で合計に含めない)', () => {
    const s = summarizeIssues([
      { forcedSplit: true, midWord: false, particleStart: true, short: true, long: false, danglingConj: true },
      { forcedSplit: false, midWord: true, particleStart: false, short: false, long: true, danglingConj: false },
    ])
    expect(s).toMatchObject({ forcedSplit: 1, midWord: 1, particleStart: 1, short: 1, long: 1, danglingConj: 1, total: 5 })
  })
})

describe('selectMostProblematicWindow', () => {
  it('問題が最も集中している60秒区間の開始・終了を返す', () => {
    const good = Array.from({ length: 20 }, (_, i) => cap('今日は良い天気です。', i * 3, i * 3 + 3))
    const bad = []
    for (let i = 0; i < 10; i++) bad.push(cap('相手', 100 + i * 2, 100 + i * 2 + 1.5), cap('のペースを', 100 + i * 2 + 1.5, 100 + i * 2 + 2))
    const w = selectMostProblematicWindow([...good, ...bad], { windowSec: 60, totalDurationSec: 300 })
    expect(w.startSec).toBeGreaterThanOrEqual(100 - 1e-9)
    expect(w.endSec - w.startSec).toBe(60)
    expect(w.issueTotal).toBeGreaterThan(0)
  })

  it('空配列ならnull・動画が窓より短ければnull', () => {
    expect(selectMostProblematicWindow([], {})).toBeNull()
    expect(selectMostProblematicWindow([cap('あ', 0, 1)], { windowSec: 60, totalDurationSec: 10 })).toBeNull()
  })
})
