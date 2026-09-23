import { describe, it, expect } from 'vitest'
import { splitTextIntoChunks, allocateChunkTimes, buildDisplayCaptionsFromSegments } from './captionSegmenter.mjs'

describe('splitTextIntoChunks', () => {
  it('短いテキストはそのまま1チャンクになる', () => {
    expect(splitTextIntoChunks('こんにちは')).toEqual(['こんにちは'])
  })

  it('空文字は空配列になる', () => {
    expect(splitTextIntoChunks('')).toEqual([])
  })

  it('句点で自然に区切る', () => {
    const text = '今日はとても良い天気です。散歩に出かけましょう。公園には花が咲いています。'
    const chunks = splitTextIntoChunks(text, { targetChars: 20, maxChars: 24, minScanChars: 8, minTailChars: 4 })
    expect(chunks.join('')).toBe(text)
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0)
    }
  })

  it('連結結果が常に元のテキストと完全一致する（読点なし・長文でも）', () => {
    const text = 'あ'.repeat(500)
    const chunks = splitTextIntoChunks(text, { maxChars: 30 })
    expect(chunks.join('')).toBe(text)
  })

  it('句読点が全くない長文でも無限ループせず終了する', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(50)
    const start = Date.now()
    const chunks = splitTextIntoChunks(text, { maxChars: 30 })
    expect(Date.now() - start).toBeLessThan(1000)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every((c) => c.length > 0)).toBe(true)
  })

  it('日本語・英数字・記号の混在テキストを扱える', () => {
    const text = '2026年のセール情報！最大50%OFF、対象商品は公式サイトをチェック☆詳細はプロフィールのリンクから。'
    const chunks = splitTextIntoChunks(text, { targetChars: 22, maxChars: 26, minScanChars: 8, minTailChars: 4 })
    expect(chunks.join('')).toBe(text)
  })

  it('目安の最大文字数を大きく超えない（末尾吸収のマージンは許容）', () => {
    const text = '今日はとても良い天気です散歩に出かけましょう公園には花が咲いています空気もおいしいです'
    const chunks = splitTextIntoChunks(text, { targetChars: 26, maxChars: 30, minScanChars: 12, minTailChars: 8 })
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(30 + 8 - 1)
    }
  })

  it('空文字チャンクを生成しない', () => {
    const text = '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　'
    const chunks = splitTextIntoChunks(text, { maxChars: 30 })
    expect(chunks.every((c) => c.length > 0)).toBe(true)
    expect(chunks.join('')).toBe(text)
  })
})

describe('allocateChunkTimes', () => {
  it('1チャンクなら元の区間をそのまま返す', () => {
    expect(allocateChunkTimes(10, 15, ['abc'])).toEqual([{ startSec: 10, endSec: 15 }])
  })

  it('文字数比率で区間を配分し、境界がsegmentと完全一致する', () => {
    const times = allocateChunkTimes(0, 10, ['aaaaa', 'bbbbb'])
    expect(times[0].startSec).toBe(0)
    expect(times[times.length - 1].endSec).toBe(10)
    expect(times[0].endSec).toBeCloseTo(5, 5)
    expect(times[1].startSec).toBeCloseTo(5, 5)
  })

  it('区間が昇順かつ重複しない', () => {
    const times = allocateChunkTimes(100, 118, ['短い', 'すこし長めのテキスト', 'あ'])
    for (let i = 0; i < times.length; i++) {
      expect(times[i].endSec).toBeGreaterThan(times[i].startSec)
      if (i > 0) expect(times[i].startSec).toBe(times[i - 1].endSec)
    }
    expect(times[0].startSec).toBe(100)
    expect(times[times.length - 1].endSec).toBe(118)
  })
})

describe('buildDisplayCaptionsFromSegments', () => {
  const rawSegments = [
    { startSec: 0, endSec: 4, text: '短い文です' },
    {
      startSec: 4,
      endSec: 22,
      text: '今日はとても良い天気です。散歩に出かけましょう。公園には花が咲いています。空気もとてもおいしいです。',
    },
    { startSec: 22, endSec: 29, text: 'これは中くらいの長さの文章になっています' },
  ]

  it('全segmentのテキストを連結した結果が元の全文と完全一致する（欠落・重複なし）', () => {
    const captions = buildDisplayCaptionsFromSegments(rawSegments)
    const rebuilt = new Map()
    for (const c of captions) {
      rebuilt.set(c.sourceSegmentIndex, (rebuilt.get(c.sourceSegmentIndex) ?? '') + c.text)
    }
    rawSegments.forEach((seg, i) => {
      expect(rebuilt.get(i)).toBe(seg.text)
    })
  })

  it('時刻が昇順で区間が重複しない', () => {
    const captions = buildDisplayCaptionsFromSegments(rawSegments)
    for (let i = 1; i < captions.length; i++) {
      expect(captions[i].startSec).toBeGreaterThanOrEqual(captions[i - 1].endSec - 1e-9)
    }
  })

  it('分割後の区間が元segmentの範囲を超えない', () => {
    const captions = buildDisplayCaptionsFromSegments(rawSegments)
    for (const c of captions) {
      const seg = rawSegments[c.sourceSegmentIndex]
      expect(c.startSec).toBeGreaterThanOrEqual(seg.startSec - 1e-9)
      expect(c.endSec).toBeLessThanOrEqual(seg.endSec + 1e-9)
    }
  })

  it('空文字captionを生成しない', () => {
    const captions = buildDisplayCaptionsFromSegments(rawSegments)
    expect(captions.every((c) => c.text.length > 0)).toBe(true)
  })

  it('52件相当の長尺データ（約918秒）を分割できる', () => {
    const segments = []
    let t = 0
    for (let i = 0; i < 52; i++) {
      const dur = 10 + (i % 20)
      const charLen = 30 + (i % 60)
      const text = Array.from({ length: charLen }, (_, j) => '文字あ、。'[j % 5]).join('')
      segments.push({ startSec: t, endSec: t + dur, text })
      t += dur
    }
    const captions = buildDisplayCaptionsFromSegments(segments)
    expect(captions.length).toBeGreaterThanOrEqual(52)

    // 欠落・重複なし
    const rebuilt = new Map()
    for (const c of captions) {
      rebuilt.set(c.sourceSegmentIndex, (rebuilt.get(c.sourceSegmentIndex) ?? '') + c.text)
    }
    segments.forEach((seg, i) => {
      expect(rebuilt.get(i)).toBe(seg.text)
    })

    // 昇順・非重複・範囲内
    for (let i = 1; i < captions.length; i++) {
      expect(captions[i].startSec).toBeGreaterThanOrEqual(captions[i - 1].endSec - 1e-9)
    }
    for (const c of captions) {
      const seg = segments[c.sourceSegmentIndex]
      expect(c.startSec).toBeGreaterThanOrEqual(seg.startSec - 1e-9)
      expect(c.endSec).toBeLessThanOrEqual(seg.endSec + 1e-9)
    }
  })

  it('単語単位タイムスタンプが整合する場合はそれを優先して使う', () => {
    const seg = {
      startSec: 0,
      endSec: 10,
      text: 'これはテストです。もう一文あります。',
      words: [
        { word: 'これはテストです。', startSec: 0, endSec: 4 },
        { word: 'もう一文あります。', startSec: 4, endSec: 10 },
      ],
    }
    const captions = buildDisplayCaptionsFromSegments([seg], { maxChars: 12, targetChars: 9, minScanChars: 4, minTailChars: 2 })
    expect(captions.map((c) => c.text).join('')).toBe(seg.text)
    expect(captions[0].startSec).toBe(0)
    expect(captions[captions.length - 1].endSec).toBe(10)
  })

  it('単語単位タイムスタンプがテキストと整合しない場合は文字数比率にフォールバックする', () => {
    const seg = {
      startSec: 0,
      endSec: 10,
      text: 'これはテストです。もう一文あります。',
      words: [{ word: '壊れたデータ', startSec: 0, endSec: 1 }],
    }
    const captions = buildDisplayCaptionsFromSegments([seg], { maxChars: 12, targetChars: 9, minScanChars: 4, minTailChars: 2 })
    expect(captions.map((c) => c.text).join('')).toBe(seg.text)
    expect(captions[0].startSec).toBe(0)
    expect(captions[captions.length - 1].endSec).toBe(10)
  })
})
