import { describe, it, expect } from 'vitest'
import { generateEmphasisCandidates, generateEmphasisCandidatesForCaption, buildCandidateSelectionInput, buildCandidateSelectionSchema, resolveEmphasisSelection, candidateIdOf } from './emphasisCandidates.mjs'
import { startsWithParticle, segmentWords, PARTICLES } from './japaneseText.mjs'
import { validateEmphasis } from './emphasisSelector.mjs'
import { validateAnalysisCandidates } from './topicAnalysis.mjs'

// 合成データ（実際の字幕本文ではない）
const captions = [
  { id: 'c-000', text: '今日はバンドのメンバーとライブの準備をします。', startSec: 0, endSec: 3 },
  { id: 'c-001', text: 'とても大事な話なので、しっかり聞いてください。', startSec: 3, endSec: 6 },
  { id: 'c-002', text: 'はい。', startSec: 6, endSec: 7 },
  { id: 'c-003', text: '練習会は毎週金曜日に行います。', startSec: 7, endSec: 10 },
]

describe('強調候補の生成', () => {
  const { candidates, byId } = generateEmphasisCandidates(captions)

  it('全候補が、2〜10文字・caption本文の完全な部分文字列・位置情報つき・句読点/空白を含まない', () => {
    expect(candidates.length).toBeGreaterThan(5)
    for (const c of candidates) {
      const cap = captions.find((x) => x.id === c.captionId)
      expect(cap.text.slice(c.start, c.end)).toBe(c.text)
      expect(cap.text.includes(c.text)).toBe(true)
      const n = Array.from(c.text).length
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(10)
      expect(c.text).not.toMatch(/[。、\s]/)
      expect(validateEmphasis(c.text, cap.text)).toBeNull()
    }
  })
  it('助詞・句読点だけの候補、助詞で始まる/終わる候補、文全体に近い候補を作らない', () => {
    for (const c of candidates) {
      expect(['の', 'を', 'は', 'が', 'に', 'と', 'で']).not.toContain(c.text)
      expect(startsWithParticle(c.text)).toBe(false)
      const last = segmentWords(c.text).filter((w) => w.isWordLike).pop()
      expect(PARTICLES.has(last.segment)).toBe(false)
    }
    expect(generateEmphasisCandidatesForCaption(captions[2]).length).toBe(0) // 短すぎる/文全体
  })
  it('同じcaption内で同じ文字列の候補は重複しない。IDは全体で一意', () => {
    const cap = { id: 'd-000', text: 'ライブの準備とライブの片付けをします' }
    const list = generateEmphasisCandidatesForCaption(cap)
    const texts = list.map((c) => c.text)
    expect(new Set(texts).size).toBe(texts.length)
    expect(new Set(candidates.map((c) => c.candidateId)).size).toBe(candidates.length)
  })
  it('IDは安定している（同じ入力なら何度生成しても同じ。captionの並び順・他captionに依存しない）', () => {
    const again = generateEmphasisCandidates(captions).candidates.map((c) => c.candidateId)
    expect(again).toEqual(candidates.map((c) => c.candidateId))
    const solo = generateEmphasisCandidatesForCaption(captions[1]).map((c) => c.candidateId)
    expect(solo).toEqual(candidates.filter((c) => c.captionId === 'c-001').map((c) => c.candidateId))
    expect(candidates[0].candidateId).toBe(candidateIdOf(candidates[0].captionId, candidates[0].start, candidates[0].end))
  })
  it('入力captionを変更しない', () => {
    const frozen = captions.map((c) => Object.freeze({ ...c }))
    expect(() => generateEmphasisCandidates(frozen)).not.toThrow()
  })

  it('AIへの入力は candidate {id,text} の一覧を持ち、応答schemaは強調語の文字列フィールドを持たない', () => {
    const input = buildCandidateSelectionInput(captions, candidates)
    expect(input.captions[1].candidates.every((c) => c.id.startsWith('c-001:e'))).toBe(true)
    const item = buildCandidateSelectionSchema().properties.emphasis.items
    expect(Object.keys(item.properties)).toEqual(['candidateId', 'category', 'confidence'])
    expect(item.properties).not.toHaveProperty('emphasisText')
  })
})

describe('candidate IDからの復元（本文にない強調は原理的に生成されない）', () => {
  const { candidates, byId } = generateEmphasisCandidates(captions)
  const pick = (captionId) => candidates.find((c) => c.captionId === captionId)

  it('選択されたcandidate IDだけから、本文の正確な部分文字列を復元する', () => {
    const c0 = pick('c-000')
    const c3 = pick('c-003')
    const r = resolveEmphasisSelection({ emphasis: [{ candidateId: c0.candidateId, category: 'keyword', confidence: 0.8 }, { candidateId: c3.candidateId, category: 'memorable', confidence: 0.6 }] }, byId, captions)
    expect(r.rejected).toEqual([])
    expect(r.emphasis.map((e) => e.emphasisText)).toEqual([c0.text, c3.text])
    for (const e of r.emphasis) expect(captions.find((c) => c.id === e.captionId).text.includes(e.emphasisText)).toBe(true)
  })
  it('未知のID・自由な文字列・stale・重複・不正なcategory/confidenceは、その候補だけを拒否し、他は採用する', () => {
    const c0 = pick('c-000')
    const c1 = pick('c-001')
    const r = resolveEmphasisSelection({ emphasis: [
      { candidateId: 'c-000:e0-999', category: 'keyword', confidence: 0.5 },
      { candidateId: 'ライブ', category: 'keyword', confidence: 0.5 },
      { candidateId: c0.candidateId, category: 'keyword', confidence: 0.9 },
      { candidateId: c0.candidateId, category: 'keyword', confidence: 0.9 },
      { candidateId: c1.candidateId, category: 'other', confidence: 0.5 },
      { candidateId: c1.candidateId, category: 'keyword', confidence: 2 },
      { emphasisText: '自由な文字列' },
    ] }, byId, captions)
    expect(r.emphasis).toHaveLength(1)
    expect(r.rejected.map((x) => x.code)).toEqual(['unknown-candidate', 'unknown-candidate', 'duplicate-in-caption', 'category-invalid', 'confidence-invalid', 'shape'])
    const stale = resolveEmphasisSelection({ emphasis: [{ candidateId: c0.candidateId, category: 'keyword', confidence: 0.5 }] }, byId, captions.map((c) => (c.id === 'c-000' ? { ...c, text: 'まったく別の本文になりました' } : c)))
    expect(stale.rejected).toEqual([{ index: 0, code: 'stale-candidate' }])
  })
  it('復元した強調は、既存の検証(validateAnalysisCandidates)でも not-in-text にならない（全候補で確認）', () => {
    const many = candidates.filter((c, i) => i % 1 === 0)
    for (const c of many) {
      const v = validateAnalysisCandidates({ topics: [], emphasis: [{ captionId: c.captionId, emphasisText: resolveEmphasisSelection({ emphasis: [{ candidateId: c.candidateId, category: 'keyword', confidence: 0.5 }] }, byId, captions).emphasis[0].emphasisText, category: 'keyword', confidence: 0.5 }] }, captions)
      expect(v.reasons.emphasis['not-in-text'] ?? 0).toBe(0)
      expect(v.reasons.emphasis['too-long'] ?? 0).toBe(0)
      expect(v.emphasis).toHaveLength(1)
    }
  })
})
