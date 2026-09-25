import { describe, it, expect } from 'vitest'
import { normalizeTopicSectionsContinuous } from './topicSections.mjs'
import { buildContinuousTopicEvents, analyzeTopicAssEvents, TOPIC_LAYER_BOX, TOPIC_LAYER_BAR } from './topicAss.mjs'
import { buildAssContent } from './captionStyles.mjs'

// 合成データ（実際のテーマ名・字幕本文ではない）
const sections = [
  { id: 'topic-001', title: 'テスト用の最初の話題', startSec: 0.24, endSec: 43.74, source: 'ai' },
  { id: 'topic-002', title: '二つ目の話題を確認', startSec: 124.44, endSec: 165.08, source: 'manual' },
  { id: 'topic-003', title: '三つ目のお知らせと案内', startSec: 243.58, endSec: 264.56, source: 'ai' },
]
const RANGE = { startSec: 0, endSec: 300 }
const captions = Array.from({ length: 20 }, (_, i) => ({ startSec: i * 15, endSec: i * 15 + 14, text: `テスト字幕${i}`, lines: [`テスト字幕${i}`], captionType: 'normal', emphasisText: i === 3 ? '字幕' : null, displayOrder: i }))
const job = { width: 1920, height: 1080, captions }

describe('normalizeTopicSectionsContinuous（レンダー用の常時表示への正規化）', () => {
  const { sections: norm, stats } = normalizeTopicSectionsContinuous(sections, RANGE)

  it('0〜300秒を隙間・重複なく完全に被覆する（最初=0秒、最後=300秒、各終了=次の開始）', () => {
    expect(norm[0].startSec).toBe(0)
    expect(norm[norm.length - 1].endSec).toBe(300)
    norm.slice(1).forEach((s, i) => expect(s.startSec).toBe(norm[i].endSec))
    expect(stats).toMatchObject({ afterCoverage: 1, undisplayedSec: 0, overlapSec: 0, afterDisplayedSec: 300 })
    expect(stats.beforeDisplayedSec).toBeCloseTo(43.5 + 40.64 + 20.98, 1)
    expect(stats.beforeCoverage).toBeLessThan(0.4)
  })
  it('任意の時刻（1/30秒刻み）で表示されるテーマがちょうど1件', () => {
    for (let f = 0; f < 300 * 30; f++) {
      const t = f / 30
      expect(norm.filter((s) => t >= s.startSec && t < s.endSec)).toHaveLength(1)
    }
  })
  it('切り替え位置（2つ目以降の開始）とタイトルは変えず、元の開始・終了を記録する。入力は変更しない', () => {
    expect(norm.slice(1).map((s) => s.startSec)).toEqual([124.44, 243.58])
    expect(norm.map((s) => s.title)).toEqual(sections.map((s) => s.title))
    expect(norm[0]).toMatchObject({ originalStartSec: 0.24, originalEndSec: 43.74 })
    expect(sections[0]).toMatchObject({ startSec: 0.24, endSec: 43.74 })
    expect(Object.keys(sections[0])).not.toContain('originalStartSec')
  })
  it('テーマが1件でも0〜300秒になる。0件なら空', () => {
    expect(normalizeTopicSectionsContinuous([sections[1]], RANGE).stats.afterCoverage).toBe(1)
    expect(normalizeTopicSectionsContinuous([], RANGE).sections).toEqual([])
  })
})

describe('buildContinuousTopicEvents / ASS（背景箱とラベルを消さず、タイトルだけ差し替える）', () => {
  const { sections: norm } = normalizeTopicSectionsContinuous(sections, RANGE)
  const opts = { topicSections: norm, topicContinuous: RANGE, topicAccentMode: 'label' }
  const ass = buildAssContent(job, opts)
  const a = analyzeTopicAssEvents(ass, RANGE)

  it('背景・縦ライン・TALK THEME は0〜300秒に1組ずつ。フェードで消えない', () => {
    for (const k of ['background', 'accentBar', 'label']) expect(a[k]).toMatchObject({ count: 1, firstStart: 0, lastEnd: 300, gapSec: 0, overlapSec: 0 })
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue: 1') && /TopicBox|TopicLabel|TopicTitle/.test(l) && /\\fad/.test(l))).toEqual([])
    expect(ass).not.toMatch(/\\fad/)
  })
  it('タイトルは合計300秒・隙間0・重複0で、切り替え境界は前のタイトルの終了と一致する', () => {
    expect(a.title).toMatchObject({ count: 3, coveredSec: 300, gapSec: 0, overlapSec: 0, firstStart: 0, lastEnd: 300 })
    expect(a.boundaries).toHaveLength(2)
    expect(a.boundaries.every((b) => b.exact)).toBe(true)
  })
  it('全フレーム（30fps）で、背景・ラベル・タイトルがちょうど1つずつ存在する（切り替え時の空白フレーム0）', () => {
    const iv = []
    for (const line of ass.split('\n')) {
      const m = /^Dialogue: (\d+),(\d+):(\d\d):(\d\d)\.(\d\d),(\d+):(\d\d):(\d\d)\.(\d\d),(Topic\w+),/.exec(line)
      if (m) iv.push({ style: m[10], layer: Number(m[1]), a: +m[2] * 3600 + +m[3] * 60 + +m[4] + +m[5] / 100, b: +m[6] * 3600 + +m[7] * 60 + +m[8] + +m[9] / 100 })
    }
    let blank = 0
    for (let f = 0; f < 300 * 30; f++) {
      const t = f / 30 + 1 / 60
      const at = (pred) => iv.filter((e) => pred(e) && t >= e.a && t < e.b).length
      if (at((e) => e.style === 'TopicBox' && e.layer === TOPIC_LAYER_BOX) !== 1 || at((e) => e.style === 'TopicBox' && e.layer === TOPIC_LAYER_BAR) !== 1 || at((e) => e.style === 'TopicLabel') !== 1 || at((e) => e.style === 'TopicTitle') !== 1) blank++
    }
    expect(blank).toBe(0)
  })
  it('共通の背景箱は全テーマのタイトルが収まる大きさで、タイトル位置は全テーマで同じ', () => {
    const { geometry, events } = buildContinuousTopicEvents(norm, { accent: '&H0023A6F5&', displayWidth: 1920, displayHeight: 1080, ...RANGE })
    expect(geometry.box.h).toBeGreaterThan(0)
    const positions = events.filter((e) => /TopicTitle/.test(e)).map((e) => /\\pos\(([^)]*)\)/.exec(e)[1])
    expect(new Set(positions).size).toBe(1)
    expect(geometry.titleSizes.every((s) => s === 84)).toBe(true)
  })
  it('常時表示では6文字以上のタイトルを2行にし、背景箱の右端を狭く保つ（顔・髪から離す）。全テーマで同じ大きさ', () => {
    const { geometry } = buildContinuousTopicEvents(norm, { accent: '&H0023A6F5&', displayWidth: 1920, displayHeight: 1080, ...RANGE })
    expect(geometry.box.x + geometry.box.w).toBeLessThan(1920 * 0.33)
    const single = buildContinuousTopicEvents([norm[0]], { accent: '&H0023A6F5&', displayWidth: 1920, displayHeight: 1080, ...RANGE }).geometry
    expect(single.box.h).toBe(geometry.box.h)
  })
  it('通常字幕・強調のDialogueは、常時表示の有無で完全に同一（本文・時刻・強調を変えない）', () => {
    const plain = buildAssContent(job, { topicSections: norm })
    const captionLines = (s) => s.split('\n').filter((l) => l.startsWith('Dialogue: 0,'))
    expect(captionLines(ass)).toEqual(captionLines(plain))
    expect(captionLines(ass).length).toBe(20)
    expect(captionLines(ass).some((l) => /\\c[0-9A-F]+&\}字幕/.test(l))).toBe(true)
  })
  it('従来方式（常時表示なし）は同じ入力で被覆が100%未満になる（=常時表示が必要だった理由）', () => {
    const old = analyzeTopicAssEvents(buildAssContent(job, { topicSections: sections }), RANGE)
    expect(old.title.coveredSec).toBeLessThan(120)
    expect(old.title.gapSec).toBeGreaterThan(150)
  })
  it('オプションなしの buildAssContent は従来の出力から変わらない', () => {
    expect(buildAssContent(job, { topicSections: sections })).toBe(buildAssContent(job, { topicSections: sections, topicContinuous: null }))
  })
})
