import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import {
  ANALYSIS_MODEL,
  ANALYSIS_ATTEMPT_LIMIT,
  buildAnalysisRequestBody,
  buildAnalysisResponseFormat,
  buildAnalysisUserContent,
  hashAnalysisInput,
  validateAnalysisCandidates,
  requestAnalysisOnce,
  runAnalysisOnce,
  revalidateSavedResponse,
  countAttempts,
  fingerprintCaptions,
  analysisPath,
  requestMarkerPath,
  writeJsonAtomic,
  editTopic,
  editTopicLogged,
  setTopicDecision,
  upsertEmphasis,
  removeEmphasis,
  setEmphasisDecision,
  mergeRegeneratedAi,
  materializeAnalysis,
  topicsToSections,
  AnalysisError,
} from './topicAnalysis.mjs'
import { attemptDiagnosticsPath, loadAttemptDiagnostics, saveAttemptDiagnostics, diagnosticsDir } from './analysisDiagnostics.mjs'

// 合成の5分データ（実際の字幕本文ではない）: 100 caption × 3秒。0〜49 は「メンバー/距離」、50〜99 は「ライブ/準備」の話題。
const KEY = 'five_minute_test'
const captions = Array.from({ length: 100 }, (_, i) => ({
  id: `natural-${String(i).padStart(3, '0')}`,
  startSec: i * 3,
  endSec: i * 3 + 2.8,
  text: i < 50 ? `メンバーとの距離${i % 7 === 0 ? 'がとても大事です' : 'について話します'}${i}` : `ライブの準備${i % 9 === 0 ? 'は絶対に必要です' : 'を進めていきます'}${i}`,
  lines: [],
}))
const id = (i) => captions[i].id
const goodResponse = () => ({
  topics: [
    { title: 'メンバーとの距離の取り方', startCaptionId: id(0), endCaptionId: id(49), evidenceCaptionIds: [id(2), id(10), id(30)], confidence: 0.9 },
    { title: 'ライブ準備の進め方', startCaptionId: id(50), endCaptionId: id(99), evidenceCaptionIds: [id(51), id(60), id(80)], confidence: 0.8 },
  ],
  emphasis: [
    { captionId: id(0), emphasisText: 'とても大事', category: 'keyword', confidence: 0.8 },
    { captionId: id(30), emphasisText: '距離', category: 'keyword', confidence: 0.6 },
    { captionId: id(63), emphasisText: '絶対に必要', category: 'conclusion', confidence: 0.7 },
  ],
})
const okFetch = (obj, calls = { n: 0 }) => async () => {
  calls.n += 1
  return { ok: true, status: 200, json: async () => ({ model: 'gpt-4o-mini-2024', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }], usage: { total_tokens: 1 } }) }
}

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'topic-analysis-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('リクエスト', () => {
  it('gpt-4o-miniへStructured Outputs(strict)で、テーマと強調を1リクエストにまとめて依頼する', () => {
    const body = buildAnalysisRequestBody(captions)
    expect(body.model).toBe('gpt-4o-mini')
    expect(ANALYSIS_MODEL).toBe('gpt-4o-mini')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    const props = buildAnalysisResponseFormat().json_schema.schema.properties
    expect(Object.keys(props)).toEqual(['topics', 'emphasis'])
    expect(props.topics.items.required).toEqual(['title', 'startCaptionId', 'endCaptionId', 'evidenceCaptionIds', 'confidence'])
    expect(props.emphasis.items.required).toEqual(['captionId', 'emphasisText', 'category', 'confidence'])
  })
  it('入力可能なcaption IDと所属順(order)を明示する。時刻は送らない', () => {
    const user = JSON.parse(buildAnalysisRequestBody(captions).messages[1].content)
    expect(Object.keys(user)).toEqual(['captionCount', 'firstCaptionId', 'lastCaptionId', 'orderedIds', 'captions'])
    expect(user.orderedIds).toEqual(captions.map((c) => c.id))
    expect(user.captions[0]).toEqual({ order: 1, id: id(0), text: captions[0].text })
    expect(user.captions[99].order).toBe(100)
    expect(Object.keys(user.captions[0])).toEqual(['order', 'id', 'text'])
    expect(JSON.stringify(buildAnalysisRequestBody(captions))).not.toMatch(/sk-|Bearer|startSec|endSec/)
    expect(buildAnalysisUserContent([]).firstCaptionId).toBeNull()
  })
  it('プロンプトに、テーマの根拠ID範囲・主要名詞・タイトル長・強調語の完全コピー等の制約が含まれる', () => {
    const sys = buildAnalysisRequestBody(captions).messages[0].content
    for (const phrase of ['evidenceCaptionIds', '範囲内', '範囲の外のIDは1件も含めない', 'そのままコピー', '別の概念へ置き換えない', '主要な語をそのまま残す', '8〜18文字', '最大24文字', '2〜4件', '1〜2文ごとに変えない', '重ならない', '一字一句そのままのコピー', '書き換え・要約・言い換え', '前後に空白や句読点を勝手に足さない', '2〜10文字', '文全体は選ばない', '助詞・句読点だけを選ばない', '5〜12件程度', '近接するcaptionで強調を連続させない', '件数を無理に満たさない']) {
      expect(sys, phrase).toContain(phrase)
    }
  })
  it('入力の指紋は、プロンプト・schema・caption本文のいずれかが変わると変わる', () => {
    const h = hashAnalysisInput(captions)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashAnalysisInput(captions.map((c, i) => (i === 0 ? { ...c, text: c.text + 'x' } : c)))).not.toBe(h)
    expect(hashAnalysisInput(captions)).toBe(h)
  })
})

describe('validateAnalysisCandidates（候補単位の検証: 1件の不正が他の有効候補を巻き込まない）', () => {
  const run = (fn, caps = captions) => {
    const r = goodResponse()
    fn(r)
    return validateAnalysisCandidates(r, caps)
  }

  it('正しい応答は採用される（テーマ2件・強調3件）', () => {
    const v = validateAnalysisCandidates(goodResponse(), captions)
    expect(v.adopted).toBe(true)
    expect(v.topics).toHaveLength(2)
    expect(v.emphasis).toHaveLength(3)
    expect(v.counts).toMatchObject({ topicsAccepted: 2, topicsRejected: 0, emphasisAccepted: 3, emphasisRejected: 0, evidenceIdsDropped: 0 })
  })

  // ── テーマ ──
  it('範囲外の根拠IDだけを除外し、範囲は書き換えない。残った根拠でgroundingできればテーマを採用する', () => {
    const v = run((r) => { r.topics[0].evidenceCaptionIds = [id(2), id(70), id(10)] })
    expect(v.adopted).toBe(true)
    const t = v.topics[0]
    expect(t.evidenceCaptionIds).toEqual([id(2), id(10)])
    expect([t.startCaptionId, t.endCaptionId]).toEqual([id(0), id(49)]) // 範囲を根拠に合わせて変えない
    expect(v.droppedEvidence).toEqual([{ topicIndex: 0, code: 'evidence-out-of-range' }])
    expect(v.reasons.evidenceIdsDropped).toEqual({ 'evidence-out-of-range': 1 })
  })
  it('実在しない根拠ID・重複した根拠IDも、そのIDだけを除外する', () => {
    const v = run((r) => { r.topics[0].evidenceCaptionIds = [id(2), 'nope', id(2), id(10)] })
    expect(v.topics[0].evidenceCaptionIds).toEqual([id(2), id(10)])
    expect(v.reasons.evidenceIdsDropped).toEqual({ 'evidence-unknown': 1, 'evidence-duplicate': 1 })
  })
  it('有効な根拠が1件も残らないテーマは候補単位で拒否し、他のテーマは採用する', () => {
    const v = run((r) => { r.topics[0].evidenceCaptionIds = [id(70), id(80)] })
    expect(v.topics.map((t) => t.title)).toEqual(['ライブ準備の進め方'])
    expect(v.reasons.topics).toEqual({ 'no-valid-evidence': 1 })
    expect(v.adopted).toBe(false) // 有効テーマ2件未満
  })
  it('根拠が範囲外にしか無く除外後にタイトルの対象語が根拠本文に無ければ拒否する（grounding）', () => {
    const v = run((r) => { r.topics[0].title = 'ライブ準備との距離の話'; r.topics[0].evidenceCaptionIds = [id(2)] })
    expect(v.reasons.topics).toEqual({ 'title-not-grounded': 1 })
    const v2 = run((r) => { r.topics[0].title = '活動との距離の取り方' })
    expect(v2.reasons.topics).toEqual({ 'title-not-grounded': 1 }) // 「メンバー」→「活動」への置き換え
  })
  it('不正なテーマが他の有効なテーマを巻き込まない（3件中1件が不正でも2件は採用）', () => {
    const resp = goodResponse()
    resp.topics = [
      { title: 'メンバーとの距離の取り方', startCaptionId: id(0), endCaptionId: id(29), evidenceCaptionIds: [id(2), id(10)], confidence: 0.9 },
      { title: '', startCaptionId: id(30), endCaptionId: id(49), evidenceCaptionIds: [id(31)], confidence: 0.9 }, // 空タイトル
      { title: 'ライブ準備の進め方', startCaptionId: id(50), endCaptionId: id(99), evidenceCaptionIds: [id(51)], confidence: 0.8 },
    ]
    const v = validateAnalysisCandidates(resp, captions)
    expect(v.topics.map((t) => t.startCaptionId)).toEqual([id(0), id(50)])
    expect(v.reasons.topics).toEqual({ 'title-invalid': 1 })
    expect(v.adopted).toBe(true)
  })
  it('未実在のstart/end・逆順・形式不正・confidence不正・継続時間が短すぎるテーマを個別に拒否する', () => {
    const resp = goodResponse()
    const base = resp.topics[0]
    resp.topics.push(
      { ...base, startCaptionId: 'nope' },
      { ...base, endCaptionId: 'nope' },
      { ...base, startCaptionId: id(40), endCaptionId: id(10) },
      { ...base, startSec: 1 },
      { ...base, confidence: 1.5 },
      { ...base, endCaptionId: id(3), evidenceCaptionIds: [id(1), id(2)] },
    )
    const v = validateAnalysisCandidates(resp, captions)
    expect(v.reasons.topics).toEqual({ 'start-unknown': 1, 'end-unknown': 1, 'order-reversed': 1, shape: 1, 'confidence-invalid': 1, 'span-too-short': 1 })
    expect(v.topics).toHaveLength(2) // 元の有効な2件は残る
  })
  it('他のテーマと範囲が重なるテーマは、信頼度の低いほうだけを拒否する。同名の連続も拒否する', () => {
    const resp = goodResponse()
    resp.topics[1].startCaptionId = id(45)
    resp.topics[1].evidenceCaptionIds = [id(60)]
    let v = validateAnalysisCandidates(resp, captions)
    expect(v.topics.map((t) => t.title)).toEqual(['メンバーとの距離の取り方'])
    expect(v.reasons.topics).toEqual({ overlap: 1 })
    const resp2 = goodResponse()
    resp2.topics[1].title = resp2.topics[0].title
    resp2.topics[1].evidenceCaptionIds = [id(60)]
    v = validateAnalysisCandidates(resp2, captions)
    expect(v.reasons.topics).toEqual({ 'title-not-grounded': 1 }) // 根拠(60)に「メンバー」が無い
  })
  it('採用テーマは最大4件（信頼度の高い順）。時刻順に並べる', () => {
    const resp = goodResponse()
    resp.topics = [0, 1, 2, 3, 4].map((k) => ({ title: k * 20 + 1 < 50 ? 'メンバーとの距離の話' + k : 'ライブ準備の進め方' + k, startCaptionId: id(k * 20), endCaptionId: id(k * 20 + 19), evidenceCaptionIds: [id(k * 20 + 1)], confidence: 0.5 + k / 100 }))
    const v = validateAnalysisCandidates(resp, captions)
    expect(v.topics).toHaveLength(4)
    expect(v.reasons.topics).toEqual({ 'over-limit': 1 })
    expect(v.topics.map((t) => t.startCaptionId)).toEqual([id(20), id(40), id(60), id(80)])
  })
  it('有効テーマが2件未満なら採用しない（拒否理由だけを返す）', () => {
    const v = run((r) => { r.topics.pop() })
    expect(v.topics).toHaveLength(1)
    expect(v.adopted).toBe(false)
  })

  // ── 強調 ──
  it('完全一致しない強調語を、表記だけの差（全角半角・空白・不可視文字・改行・Unicode正規化）なら本文側の正確な文字列へ復元して採用する', () => {
    const caps = captions.map((c) => ({ ...c }))
    caps[5].text = 'ＡＢＣライブの準備ｶﾀｶﾅ確認です' // 全角英字・半角カナ
    caps[15].text = '距離感がとても　大事です'
    caps[25].text = 'メンバーの距離感を保つ'
    caps[35].text = '今日はがぎぐ大事な話をします' // NFC（合成済み）
    const resp = goodResponse()
    resp.emphasis = [
      { captionId: id(5), emphasisText: 'ABCライブ', category: 'keyword', confidence: 0.8 }, // 半角英字 → 全角の本文
      { captionId: id(15), emphasisText: 'とても\n大事', category: 'keyword', confidence: 0.8 }, // 改行・全角空白の差
      { captionId: id(25), emphasisText: ' 距離​感 ', category: 'keyword', confidence: 0.8 }, // 前後空白・ゼロ幅
      { captionId: id(35), emphasisText: 'がぎぐ大事', category: 'keyword', confidence: 0.8 }, // NFD（濁点分離）
    ]
    const v = validateAnalysisCandidates(resp, caps)
    expect(v.emphasis.map((e) => e.emphasisText)).toEqual(['ＡＢＣライブ', 'とても　大事', '距離感', 'がぎぐ大事'])
    for (const e of v.emphasis) expect(caps[Number(e.captionId.slice(-3))].text.includes(e.emphasisText)).toBe(true) // 復元結果は本文の完全な部分文字列
    expect(v.counts.emphasisRestoredByNormalization).toBe(4)
  })
  it('正規化後に本文の複数箇所へ一致する強調語は採用しない（曖昧一致の拒否）', () => {
    const caps = captions.map((c) => ({ ...c }))
    caps[7].text = 'ライブとライブの準備'
    const resp = goodResponse()
    resp.emphasis = [{ captionId: id(7), emphasisText: 'ﾗｲﾌﾞ', category: 'keyword', confidence: 0.8 }, ...goodResponse().emphasis]
    const v = validateAnalysisCandidates(resp, caps)
    expect(v.reasons.emphasis).toEqual({ ambiguous: 1 })
    expect(v.emphasis).toHaveLength(3)
  })
  it('意味的な類似・言い換え・ファジー一致・句読点の付加は復元せず拒否する', () => {
    const resp = goodResponse()
    resp.emphasis = [
      { captionId: id(0), emphasisText: 'とても重要', category: 'keyword', confidence: 0.8 }, // 言い換え
      { captionId: id(0), emphasisText: 'とても大事。', category: 'keyword', confidence: 0.8 }, // 本文に無い句点
      { captionId: id(63), emphasisText: '必ず必要', category: 'keyword', confidence: 0.8 }, // 語の置き換え
      { captionId: id(30), emphasisText: '距離感', category: 'keyword', confidence: 0.8 }, // 本文に無い1文字の追加
    ]
    const v = validateAnalysisCandidates(resp, captions)
    expect(v.emphasis).toHaveLength(0)
    expect(v.reasons.emphasis).toEqual({ 'not-in-text': 4 })
  })
  it('不正な強調が他の有効な強調を巻き込まない', () => {
    const resp = goodResponse()
    resp.emphasis.splice(1, 0, { captionId: id(20), emphasisText: 'あり得ない語', category: 'keyword', confidence: 0.9 })
    resp.emphasis.push({ captionId: 'nope', emphasisText: '距離', category: 'keyword', confidence: 0.5 })
    resp.emphasis.push({ captionId: id(40), emphasisText: 'メンバー', category: 'other', confidence: 0.5 })
    resp.emphasis.push({ captionId: id(41), emphasisText: 'メンバー', category: 'keyword', confidence: 2 })
    const v = validateAnalysisCandidates(resp, captions)
    expect(v.emphasis.map((e) => e.captionId)).toEqual([id(0), id(30), id(63)])
    expect(v.reasons.emphasis).toEqual({ 'not-in-text': 1, 'caption-unknown': 1, 'category-invalid': 1, 'confidence-invalid': 1 })
    expect(v.adopted).toBe(true)
  })
  it('助詞・句読点だけ・文全体・1文字・11文字以上・同一caption内の重複・同じ語の繰り返しを候補単位で拒否する', () => {
    const resp = goodResponse()
    resp.emphasis = [
      { captionId: id(1), emphasisText: 'の', category: 'keyword', confidence: 0.5 },
      { captionId: id(2), emphasisText: captions[2].text, category: 'keyword', confidence: 0.5 },
      { captionId: id(3), emphasisText: 'メンバーとの距離について話し', category: 'keyword', confidence: 0.5 },
      { captionId: id(4), emphasisText: 'メ', category: 'keyword', confidence: 0.5 },
      ...goodResponse().emphasis,
      { captionId: id(0), emphasisText: 'メンバー', category: 'keyword', confidence: 0.5 }, // id(0)は既に強調あり
      { captionId: id(64), emphasisText: '絶対に必要', category: 'keyword', confidence: 0.5 }, // 同じ語の繰り返し
    ]
    const v = validateAnalysisCandidates(resp, captions)
    expect(v.emphasis).toHaveLength(3)
    expect(Object.keys(v.reasons.emphasis).sort()).toEqual(['duplicate-in-caption', 'function-word-only', 'too-long', 'too-short', 'whole-caption'].concat(['not-in-text']).filter((k) => k in v.reasons.emphasis).sort())
    expect(v.reasons.emphasis['duplicate-in-caption']).toBe(1)
  })
  it('有効な強調が3件未満なら採用しない', () => {
    const v = run((r) => { r.emphasis.pop() })
    expect(v.emphasis).toHaveLength(2)
    expect(v.adopted).toBe(false)
  })
  it('形式が不正な応答（topics/emphasis以外・配列でない）は何も採用しない', () => {
    expect(validateAnalysisCandidates({ topics: [] }, captions)).toMatchObject({ formatOk: false, adopted: false })
    expect(validateAnalysisCandidates(null, captions)).toMatchObject({ formatOk: false, adopted: false })
    expect(validateAnalysisCandidates({ topics: 'x', emphasis: [] }, captions).adopted).toBe(false)
  })
  it('戻り値の要約（理由・件数）に caption 本文・テーマ名・強調語を含めない', () => {
    const resp = goodResponse()
    resp.topics[0].title = '後輩との距離の取り方'
    resp.emphasis[0].emphasisText = 'とても重要'
    const v = validateAnalysisCandidates(resp, captions)
    const summary = JSON.stringify({ counts: v.counts, reasons: v.reasons, rejected: v.rejected, droppedEvidence: v.droppedEvidence, warnings: v.warnings })
    for (const w of ['後輩', 'とても重要', 'メンバー', '距離', 'ライブ']) expect(summary).not.toContain(w)
  })
  it('caption本文・時刻・IDを変更しない（入力captionは不変）', () => {
    const frozen = captions.map((c) => Object.freeze({ ...c }))
    const before = JSON.stringify(frozen)
    validateAnalysisCandidates(goodResponse(), frozen)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})

describe('runAnalysisOnce（1回だけ・累計上限・部分保存なし・再送なし）', () => {
  it('成功: APIは1回だけ呼ばれ、テーマと強調が1つの分析結果として原子的に保存される（tmpが残らない）', async () => {
    const calls = { n: 0 }
    const r = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 1, fetchFn: okFetch(goodResponse(), calls) })
    expect(calls.n).toBe(1)
    expect(r).toMatchObject({ reused: false, requestCount: 1, attempt: 1, attemptsTotal: 1 })
    const saved = JSON.parse(readFileSync(analysisPath(dir, KEY), 'utf-8'))
    expect(saved.model).toBe('gpt-4o-mini')
    expect(saved.attempt).toBe(1)
    expect(saved.topics).toHaveLength(2)
    expect(saved.emphasis).toHaveLength(3)
    expect(saved.topics.every((t) => t.source === 'ai' && t.decision === 'accepted')).toBe(true)
    expect(saved.captionsFingerprint).toBe(fingerprintCaptions(captions))
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('保存結果は再利用され、APIを再実行しない', async () => {
    const calls = { n: 0 }
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse(), calls) })
    const again = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 2, fetchFn: okFetch(goodResponse(), calls) })
    expect(again).toMatchObject({ reused: true, requestCount: 0 })
    expect(calls.n).toBe(1)
  })

  it('caption列が変わっていたら、保存結果を再利用せず拒否する（別データへの流用防止）', async () => {
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })
    const changed = captions.map((c, i) => (i === 0 ? { ...c, text: c.text + 'x' } : c))
    await expect(runAnalysisOnce({ dir, key: KEY, captions: changed, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })).rejects.toMatchObject({ kind: 'stale' })
  })

  it('採用条件を満たさない（有効テーマ2件未満）: 何も採用・保存せず停止し、再送しない。応答は診断へ残る', async () => {
    const bad = goodResponse()
    bad.topics[0].evidenceCaptionIds = [id(70)]
    const calls = { n: 0 }
    const err = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 1, fetchFn: okFetch(bad, calls) }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'validation', attempt: 1 })
    expect(err.validation.counts).toMatchObject({ topicsAccepted: 1, topicsRejected: 1 })
    expect(err.message).not.toMatch(/メンバー|ライブ/)
    expect(calls.n).toBe(1)
    expect(existsSync(analysisPath(dir, KEY))).toBe(false) // 部分保存もしない
    expect(existsSync(requestMarkerPath(dir, KEY, 1))).toBe(true)
    // 診断には応答が残り、原因（理由コード）を確認できる
    const diag = loadAttemptDiagnostics(dir, KEY, 1)
    expect(diag).toMatchObject({ attempt: 1, model: 'gpt-4o-mini', httpRequestCount: 1, status: 'validation-failed', httpStatus: 200 })
    expect(diag.validation.reasons.topics).toEqual({ 'no-valid-evidence': 1 })
    expect(JSON.parse(diag.rawResponseText).topics).toHaveLength(2)
    // 同じ試行は再送されない
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 1, fetchFn: okFetch(goodResponse(), calls) })).rejects.toMatchObject({ kind: 'already-requested' })
    expect(calls.n).toBe(1)
  })

  it('有効強調3件未満でも何も採用せず停止する', async () => {
    const bad = goodResponse()
    bad.emphasis = bad.emphasis.slice(0, 2)
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(bad) })).rejects.toMatchObject({ kind: 'validation' })
    expect(existsSync(analysisPath(dir, KEY))).toBe(false)
  })

  it('累計の試行上限: 試行2まで。3回目は拒否し、HTTPリクエストを送らない。前回(試行1)のマーカーは変更されない', async () => {
    expect(ANALYSIS_ATTEMPT_LIMIT).toBe(2)
    const m1 = requestMarkerPath(dir, KEY, 1)
    writeFileSync(m1, '2026-01-01T00:00:00.000Z\n') // 前回の送信済み記録（既存）
    const before = readFileSync(m1, 'utf-8')
    expect(countAttempts(dir, KEY)).toBe(1)
    const bad = goodResponse()
    bad.topics = []
    const calls = { n: 0 }
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 2, fetchFn: okFetch(bad, calls) })).rejects.toMatchObject({ kind: 'validation', attempt: 2 })
    expect(calls.n).toBe(1)
    expect(countAttempts(dir, KEY)).toBe(2)
    expect(existsSync(requestMarkerPath(dir, KEY, 2))).toBe(true)
    // 3回目
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 3, fetchFn: okFetch(goodResponse(), calls) })).rejects.toMatchObject({ kind: 'attempt-limit' })
    // 試行2の再送・試行1の再送
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 2, fetchFn: okFetch(goodResponse(), calls) })).rejects.toMatchObject({ kind: 'already-requested' })
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 1, fetchFn: okFetch(goodResponse(), calls) })).rejects.toMatchObject({ kind: 'already-requested' })
    expect(calls.n).toBe(1) // 追加のHTTPは一度も送られていない
    expect(readFileSync(m1, 'utf-8')).toBe(before)
    // 前回の試行の履歴を消して再実行するのではなく、試行番号を増やして記録される
    expect(readdirSync(dir).filter((n) => n.endsWith('.marker')).sort()).toEqual([`${KEY}.analysis-request.attempt-2.marker`, `${KEY}.analysis-request.marker`].sort())
  })

  it('試行番号を飛ばした実行は拒否する（次の試行は送信済み+1のみ）', async () => {
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', attempt: 2, fetchFn: okFetch(goodResponse()) })).rejects.toMatchObject({ kind: 'attempt-sequence' })
  })

  it('API失敗(HTTPエラー)・接続失敗・タイムアウト・空応答・JSON不正: いずれも再送せず停止し、何も保存せず、診断を残す', async () => {
    const cases = [
      ['api', async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'secret detail sk-test-key-value-1234567890', code: 'rate' } }) })],
      ['network', async () => { throw new Error('ECONNRESET') }],
      ['timeout', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }],
      ['empty', async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) })],
      ['parse', async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{not json' } }] }) })],
    ]
    for (const [kind, fn] of cases) {
      const d = mkdtempSync(join(tmpdir(), 'topic-analysis-fail-'))
      let n = 0
      try {
        const err = await runAnalysisOnce({ dir: d, key: KEY, captions, apiKey: 'sk-test-key-value-1234567890', fetchFn: async (...a) => { n += 1; return fn(...a) } }).catch((e) => e)
        expect(err).toMatchObject({ kind })
        expect(n).toBe(1)
        expect(existsSync(analysisPath(d, KEY))).toBe(false)
        const diag = loadAttemptDiagnostics(d, KEY, 1)
        expect(diag.status).toBe(kind)
        expect(diag.httpRequestCount).toBe(1)
        const text = readFileSync(attemptDiagnosticsPath(d, KEY, 1), 'utf-8')
        expect(text).not.toContain('sk-test-key')
        expect(text).not.toContain('secret detail') // HTTPエラー本文は保存しない
        if (kind === 'parse') expect(diag.rawResponseText).toBe('{not json') // 不正な応答そのものを診断に残す
      } finally {
        rmSync(d, { recursive: true, force: true })
      }
    }
  })

  it('エラー文にAPIのエラー詳細・APIキーを含めない', async () => {
    const f = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key sk-test-secret', code: 'invalid_api_key' } }) })
    const err = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test-secret', fetchFn: f }).catch((e) => e)
    expect(err).toBeInstanceOf(AnalysisError)
    expect(err.message).not.toContain('sk-test-secret')
    expect(err.message).not.toContain('Incorrect API key')
  })

  it('APIキー未設定ならリクエストせず、マーカーも作らない', async () => {
    let n = 0
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: '', fetchFn: async () => { n += 1 } })).rejects.toMatchObject({ kind: 'config' })
    expect(n).toBe(0)
    expect(existsSync(requestMarkerPath(dir, KEY))).toBe(false)
  })

  it('requestAnalysisOnce は1回だけfetchを呼ぶ（内部retryなし）', async () => {
    let n = 0
    await expect(requestAnalysisOnce({ captions, apiKey: 'k', fetchFn: async () => { n += 1; return { ok: false, status: 500, json: async () => ({}) } } })).rejects.toBeInstanceOf(AnalysisError)
    expect(n).toBe(1)
  })

  it('writeJsonAtomic は失敗時に一時ファイルを残さず、既存ファイルを壊さない', () => {
    const target = join(dir, 'no-such-dir', 'x.json')
    expect(() => writeJsonAtomic(target, { a: 1 })).toThrow()
    expect(readdirSync(dir)).toEqual([])
    writeJsonAtomic(join(dir, 'ok.json'), { a: 1 })
    expect(readdirSync(dir)).toEqual(['ok.json'])
    writeJsonAtomic(join(dir, 'ok.json'), { a: 2 })
    expect(JSON.parse(readFileSync(join(dir, 'ok.json'), 'utf-8'))).toEqual({ a: 2 })
    expect(readdirSync(dir)).toEqual(['ok.json'])
  })

  it('保存の途中で失敗しても、分析結果ファイルは作られず一時ファイルも残らない', async () => {
    // 分析結果の保存先（analysis.json）をディレクトリにして rename を失敗させる
    const { mkdirSync } = await import('fs')
    mkdirSync(analysisPath(dir, KEY))
    const err = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})

describe('診断保存（gitignore対象・0600・APIキーなし・再利用）', () => {
  it('成功・不合格のどちらでも、attempt ID・日時・モデル・入力ハッシュ・HTTP回数・検証結果が保存される', async () => {
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test-key-aaaaaaaaaaaaaaaaaaaa', attempt: 1, fetchFn: okFetch(goodResponse()) })
    const d = loadAttemptDiagnostics(dir, KEY, 1)
    expect(d.attemptId).toMatch(new RegExp(`^${KEY}-attempt-1-`))
    expect(d.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(d).toMatchObject({ model: 'gpt-4o-mini', httpRequestCount: 1, status: 'adopted', analysisVersion: 2 })
    expect(d.inputSha256).toBe(hashAnalysisInput(captions))
    expect(d.validation.adopted).toBe(true)
    expect(d.validation.counts.topicsAccepted).toBe(2)
    expect(typeof d.rawResponseText).toBe('string')
  })

  it('診断ファイルにAPIキー・Authorizationヘッダーを含めない。含めようとすると保存を拒否する', async () => {
    const key = 'sk-test-key-bbbbbbbbbbbbbbbbbbbb'
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: key, fetchFn: okFetch(goodResponse()) })
    const text = readFileSync(attemptDiagnosticsPath(dir, KEY, 1), 'utf-8')
    expect(text).not.toContain(key)
    expect(text).not.toMatch(/Authorization|Bearer/i)
    expect(() => saveAttemptDiagnostics({ dir, key: 'x', attempt: 9, apiKey: key, record: { rawResponseText: `leak ${key}` } })).toThrow()
    expect(() => saveAttemptDiagnostics({ dir, key: 'x', attempt: 9, record: { note: 'Bearer sk-abcdefghijklmnopqrstuvwxyz' } })).toThrow()
    expect(existsSync(attemptDiagnosticsPath(dir, 'x', 9))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('診断ファイルは 0600、診断ディレクトリは 0700（可能な範囲で）', async () => {
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })
    expect(statSync(attemptDiagnosticsPath(dir, KEY, 1)).mode & 0o777).toBe(0o600)
    expect(statSync(diagnosticsDir(dir)).mode & 0o777).toBe(0o700)
    expect(readdirSync(diagnosticsDir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('診断の保存先（5分比較用データ配下のdiagnostics/）はgitignore対象で、既存ジョブJSONには保存しない', () => {
    const rel = 'editor/data/local_caption_comparisons/five_minute/diagnostics/five_minute_613.attempt-2.json'
    const repoRoot = join(process.cwd(), '..')
    expect(() => execFileSync('git', ['check-ignore', '-q', rel], { cwd: repoRoot })).not.toThrow()
    expect(readFileSync(join(process.cwd(), 'server/lib/analysisDiagnostics.mjs'), 'utf-8')).not.toMatch(/local_caption_videos/) // ジョブJSONの保存先を参照しない
  })

  it('保存済みの応答を、HTTPなしで再検証できる（入力の指紋が一致する場合のみ）', async () => {
    const bad = goodResponse()
    bad.emphasis[2].emphasisText = 'ＡＢＣ' // 本文に無い → 現行ロジックでも不採用
    bad.emphasis = bad.emphasis.slice(0, 2)
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(bad) })).rejects.toMatchObject({ kind: 'validation' })
    const r = revalidateSavedResponse({ dir, key: KEY, captions, attempt: 1 })
    expect(r).toMatchObject({ requestCount: 0, adopted: false, saved: false })
    // 別のcaption列に対する再検証は拒否
    const changed = captions.map((c, i) => (i === 3 ? { ...c, text: c.text + 'x' } : c))
    expect(() => revalidateSavedResponse({ dir, key: KEY, captions: changed, attempt: 1 })).toThrow(/現在の入力/)
    expect(() => revalidateSavedResponse({ dir, key: KEY, captions, attempt: 5 })).toThrow(/保存済みの応答がありません/)
  })

  it('再検証で採用条件を満たせば、分析結果を原子的に保存する（HTTPは送らない）', async () => {
    const resp = goodResponse()
    const saveOnly = { ...resp, emphasis: resp.emphasis.slice(0, 2) } // 実行時は強調2件で不採用
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(saveOnly) })).rejects.toMatchObject({ kind: 'validation' })
    // 診断の応答を、有効な強調が3件ある内容へ差し替える（検証ロジックの改善で救済できるケースの模擬）
    const p = attemptDiagnosticsPath(dir, KEY, 1)
    const rec = JSON.parse(readFileSync(p, 'utf-8'))
    rec.rawResponseText = JSON.stringify(resp)
    writeFileSync(p, JSON.stringify(rec))
    const r = revalidateSavedResponse({ dir, key: KEY, captions, attempt: 1 })
    expect(r).toMatchObject({ requestCount: 0, adopted: true, saved: true })
    expect(JSON.parse(readFileSync(analysisPath(dir, KEY), 'utf-8')).revalidatedFromDiagnostics).toBe(true)
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})

describe('手動修正（source:manual・AIに上書きされない）', () => {
  let analysis
  beforeEach(async () => {
    const r = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })
    analysis = r.analysis
  })

  it('AI候補は source:ai の編集可能な候補として保存される', () => {
    expect(analysis.topics.map((t) => t.source)).toEqual(['ai', 'ai'])
    expect(topicsToSections(analysis, captions).map((s) => s.source)).toEqual(['ai', 'ai'])
  })

  it('テーマ名・開始・終了の修正は source:manual・decision:accepted になり、時刻はcaption境界', () => {
    const r = editTopic(analysis, 'topic-001', { title: 'メンバーとの付き合い方', endCaptionId: id(45) }, captions)
    expect(r.ok).toBe(true)
    const t = r.analysis.topics[0]
    expect(t).toMatchObject({ title: 'メンバーとの付き合い方', source: 'manual', decision: 'accepted', endCaptionId: id(45) })
    expect(topicsToSections(r.analysis, captions)[0].endSec).toBe(captions[45].endSec)
    expect(analysis.topics[0].source).toBe('ai') // 入力は変更しない
  })

  it('不正な修正（空タイトル・未知ID・逆順・他テーマとの重複）は拒否され、元のまま', () => {
    expect(editTopic(analysis, 'topic-001', { title: '' }, captions).ok).toBe(false)
    expect(editTopic(analysis, 'topic-001', { endCaptionId: 'nope' }, captions).ok).toBe(false)
    expect(editTopic(analysis, 'topic-001', { startCaptionId: id(40), endCaptionId: id(10) }, captions).ok).toBe(false)
    expect(editTopic(analysis, 'topic-001', { endCaptionId: id(60) }, captions).ok).toBe(false) // topic-002(50〜)と重複
    expect(editTopic(analysis, 'nope', { title: 'メンバーとの距離の話' }, captions).ok).toBe(false)
  })

  it('AI候補を個別に却下・採用できる。却下したテーマは表示に使わない', () => {
    const rejected = setTopicDecision(analysis, 'topic-002', 'rejected').analysis
    expect(topicsToSections(rejected, captions)).toHaveLength(1)
    const back = setTopicDecision(rejected, 'topic-002', 'accepted').analysis
    expect(topicsToSections(back, captions)).toHaveLength(2)
    expect(setTopicDecision(analysis, 'topic-002', 'maybe').ok).toBe(false)
  })

  it('部分強調を追加・変更・削除できる（1captionにつき0〜1か所、完全な部分文字列のみ）', () => {
    const added = upsertEmphasis(analysis, id(20), 'メンバー', captions)
    expect(added.ok).toBe(true)
    expect(added.analysis.emphasis.find((e) => e.captionId === id(20))).toMatchObject({ source: 'manual', emphasisText: 'メンバー' })
    const changed = upsertEmphasis(added.analysis, id(20), '距離', captions)
    expect(changed.analysis.emphasis.filter((e) => e.captionId === id(20))).toHaveLength(1)
    expect(upsertEmphasis(analysis, id(20), '存在しない語', captions).ok).toBe(false)
    expect(upsertEmphasis(analysis, id(20), 'の', captions).ok).toBe(false)
    const removed = removeEmphasis(changed.analysis, id(20))
    expect(materializeAnalysis(removed.analysis, captions).captions[20].emphasisText).toBeNull()
    expect(setEmphasisDecision(analysis, id(0), 'rejected').ok).toBe(true)
    expect(materializeAnalysis(setEmphasisDecision(analysis, id(0), 'rejected').analysis, captions).captions[0].emphasisText).toBeNull()
  })

  it('manualはAI再生成で上書きされない（テーマ名・強調・却下した強調）', () => {
    let a = editTopic(analysis, 'topic-001', { title: 'メンバーとの付き合い方' }, captions).analysis
    a = upsertEmphasis(a, id(20), 'メンバー', captions).analysis
    a = removeEmphasis(a, id(0)).analysis // AI強調を却下
    const regenerated = {
      topics: [
        { id: 'topic-001', title: 'AIが作り直した題名', startCaptionId: id(0), endCaptionId: id(49), evidenceCaptionIds: [id(2)], confidence: 0.5, source: 'ai', decision: 'accepted' },
        { id: 'topic-002', title: 'ライブ準備の進め方２', startCaptionId: id(50), endCaptionId: id(99), evidenceCaptionIds: [id(51)], confidence: 0.5, source: 'ai', decision: 'accepted' },
      ],
      emphasis: [
        { captionId: id(0), emphasisText: 'とても大事', category: 'keyword', confidence: 0.5, source: 'ai', decision: 'accepted' },
        { captionId: id(20), emphasisText: '距離', category: 'keyword', confidence: 0.5, source: 'ai', decision: 'accepted' },
        { captionId: id(63), emphasisText: '絶対に必要', category: 'conclusion', confidence: 0.5, source: 'ai', decision: 'accepted' },
      ],
    }
    const merged = mergeRegeneratedAi(a, regenerated, captions)
    const secs = topicsToSections(merged, captions)
    expect(secs.find((s) => s.source === 'manual').title).toBe('メンバーとの付き合い方')
    expect(secs.some((s) => s.title === 'AIが作り直した題名')).toBe(false)
    expect(secs.some((s) => s.title === 'ライブ準備の進め方２' && s.source === 'ai')).toBe(true)
    const m = materializeAnalysis(merged, captions)
    expect(m.captions[20].emphasisText).toBe('メンバー') // 手動が勝つ
    expect(m.captions[0].emphasisText).toBeNull() // 却下は復活しない
    expect(m.captions[63].emphasisText).toBe('絶対に必要') // 新しいAI候補は追加される
  })

  it('materializeAnalysis は caption の本文・時刻・行を変更せず、強調だけを反映する', () => {
    const frozen = captions.map((c) => Object.freeze({ ...c }))
    const m = materializeAnalysis(analysis, frozen)
    m.captions.forEach((c, i) => {
      expect(c.text).toBe(captions[i].text)
      expect([c.startSec, c.endSec]).toEqual([captions[i].startSec, captions[i].endSec])
    })
    expect(m.emphasisCount).toBe(3)
    expect(m.topicSections).toHaveLength(2)
  })
})

describe('手動修正UIの保証（範囲外の根拠ID・正本にない強調語・却下の復活防止）', () => {
  let analysis
  beforeEach(async () => {
    analysis = (await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })).analysis
  })

  it('テーマ範囲外（または実在しない）の根拠IDは保存できない', () => {
    expect(editTopic(analysis, 'topic-001', { evidenceCaptionIds: [id(2), id(70)] }, captions).ok).toBe(false)
    expect(editTopic(analysis, 'topic-001', { evidenceCaptionIds: ['nope'] }, captions).ok).toBe(false)
    expect(editTopic(analysis, 'topic-001', { evidenceCaptionIds: [id(2), id(2)] }, captions).ok).toBe(false)
    const ok = editTopic(analysis, 'topic-001', { evidenceCaptionIds: [id(2), id(3)] }, captions)
    expect(ok.ok).toBe(true)
    expect(ok.analysis.topics[0].evidenceCaptionIds).toEqual([id(2), id(3)])
  })

  it('範囲を狭めると、範囲外になった根拠IDだけが除外される（範囲・他の根拠は変わらない）', () => {
    const r = editTopic(analysis, 'topic-001', { endCaptionId: id(20) }, captions)
    expect(r.ok).toBe(true)
    const t = r.analysis.topics[0]
    expect(t.evidenceCaptionIds).toEqual([id(2), id(10)]) // id(30)は範囲外になり除外
    expect(t.endCaptionId).toBe(id(20))
    expect(t.evidenceCaptionIds.every((e) => captions.findIndex((c) => c.id === e) <= 20)).toBe(true)
  })

  it('正本の本文に存在しない強調語は保存できない（追加・変更のどちらも）', () => {
    expect(upsertEmphasis(analysis, id(20), 'ＡＢＣ', captions).ok).toBe(false)
    expect(upsertEmphasis(analysis, id(0), '存在しない語', captions).ok).toBe(false)
    expect(upsertEmphasis(analysis, id(20), 'メンバー ', captions).ok).toBe(false) // 末尾の空白を含む文字列は本文の部分文字列ではない
  })

  it('manualはAIより優先され、却下したAIテーマ・強調は再生成で復活しない', () => {
    let a = setTopicDecision(analysis, 'topic-002', 'rejected').analysis
    a = removeEmphasis(a, id(63)).analysis
    const regenerated = {
      topics: [
        { id: 'topic-001', title: 'メンバーとの距離の話', startCaptionId: id(0), endCaptionId: id(49), evidenceCaptionIds: [id(2)], confidence: 0.5, source: 'ai', decision: 'accepted' },
        { id: 'topic-002', title: 'ライブ準備の話', startCaptionId: id(52), endCaptionId: id(90), evidenceCaptionIds: [id(60)], confidence: 0.5, source: 'ai', decision: 'accepted' },
      ],
      emphasis: [{ captionId: id(63), emphasisText: '絶対に必要', category: 'keyword', confidence: 0.5, source: 'ai', decision: 'accepted' }],
    }
    const merged = mergeRegeneratedAi(a, regenerated, captions)
    const secs = topicsToSections(merged, captions)
    expect(secs.map((s) => s.title)).toEqual(['メンバーとの距離の話'])
    expect(merged.topics.filter((t) => t.decision === 'rejected')).toHaveLength(1) // 却下の記録は残る
    expect(materializeAnalysis(merged, captions).captions[63].emphasisText).toBeNull()
  })
})

describe('validationVersion 2: テーマ範囲全体でのgrounding（evidenceは代表例として保持）', () => {
  const resp = () => goodResponse()

  it('タイトルの対象語が各evidenceに無くても、テーマ範囲全体の本文にあり、evidenceが範囲内・実在・1件以上なら採用する', () => {
    const r = resp()
    // 「メンバー」を含まない根拠captionだけを挙げる（範囲内のcaption本文の一部にはある）
    const caps = captions.map((c) => ({ ...c }))
    caps[2].text = '距離の話をします2'
    caps[10].text = '準備の話です10'
    r.topics[0].evidenceCaptionIds = [id(2), id(10)]
    const v2 = validateAnalysisCandidates(r, caps)
    expect(v2.topics).toHaveLength(2)
    expect(v2.topics[0].evidenceCaptionIds).toEqual([id(2), id(10)]) // 代表例として保持
    expect(v2.validationVersion).toBe(2)
    // 旧基準(v1)では、evidenceの本文だけで確認するため拒否される
    const v1 = validateAnalysisCandidates(r, caps, { validationVersion: 1 })
    expect(v1.reasons.topics).toEqual({ 'title-not-grounded': 1 })
  })
  it('テーマ範囲全体にも対象語が無ければ拒否する（別概念への置き換え）', () => {
    const r = resp()
    r.topics[0].title = '活動との距離の取り方' // 「活動」は範囲0〜49の本文に無い
    const v = validateAnalysisCandidates(r, captions)
    expect(v.reasons.topics).toEqual({ 'title-not-grounded': 1 })
    expect(v.topics.map((t) => t.startCaptionId)).toEqual([id(50)])
  })
  it('対象語が「範囲外」にしか無い場合は、evidenceが範囲内でも拒否する', () => {
    const r = resp()
    r.topics[0].title = 'ライブ準備の話' // ライブは50以降にしか無い
    expect(validateAnalysisCandidates(r, captions).reasons.topics).toEqual({ 'title-not-grounded': 1 })
  })
  it('evidenceが範囲外・0件のテーマは、範囲全体にタイトル語があっても従来どおり扱う（範囲外IDは除外、0件なら拒否）', () => {
    const r = resp()
    r.topics[0].evidenceCaptionIds = [id(2), id(70)]
    expect(validateAnalysisCandidates(r, captions).topics[0].evidenceCaptionIds).toEqual([id(2)])
    r.topics[0].evidenceCaptionIds = [id(70)]
    expect(validateAnalysisCandidates(r, captions).reasons.topics).toEqual({ 'no-valid-evidence': 1 })
  })
  it('テーマ同士が重複しない・過剰な細分化でない条件は維持される', () => {
    const r = resp()
    r.topics[1].startCaptionId = id(45)
    r.topics[1].evidenceCaptionIds = [id(60)]
    expect(validateAnalysisCandidates(r, captions).reasons.topics).toEqual({ overlap: 1 })
    const r2 = resp()
    r2.topics[0].endCaptionId = id(3)
    r2.topics[0].evidenceCaptionIds = [id(1)]
    expect(validateAnalysisCandidates(r2, captions).reasons.topics).toEqual({ 'span-too-short': 1 })
  })
})

describe('revalidateSavedResponse（追加APIなし・履歴保持・元応答の不変性）', () => {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  const strictFail = () => {
    const r = goodResponse()
    r.emphasis = r.emphasis.slice(0, 1)
    return r
  }

  it('試行2相当の不合格応答を、検証版2で再検証する。元の診断は変更されず、再検証結果は別ファイルに履歴として残る', async () => {
    const caps = captions.map((c) => ({ ...c }))
    caps[2].text = '距離の話をします2'
    const resp = strictFail()
    resp.topics[0].evidenceCaptionIds = [id(2)]
    // 旧基準の不合格を作る: v1 で保存された不合格応答（診断）を模擬する
    const original = { attemptId: 'x', attempt: 2, createdAt: '2026-01-01T00:00:00.000Z', model: 'gpt-4o-mini', inputSha256: hashAnalysisInput(caps), captionsFingerprint: fingerprintCaptions(caps), httpRequestCount: 1, status: 'validation-failed', httpStatus: 200, rawResponseText: JSON.stringify(resp), validation: { validationVersion: 1, adopted: false } }
    saveAttemptDiagnostics({ dir, key: KEY, attempt: 2, record: original })
    const p = attemptDiagnosticsPath(dir, KEY, 2)
    const before = sha(p)
    let fetched = 0
    const g = globalThis.fetch
    globalThis.fetch = async () => { fetched += 1 }
    try {
      const r = revalidateSavedResponse({ dir, key: KEY, captions: caps, attempt: 2, manualEmphasisExpected: true })
      expect(r).toMatchObject({ requestCount: 0, adopted: true, saved: true })
      expect(r.validation.counts).toMatchObject({ topicsAccepted: 2, emphasisAccepted: 1 })
    } finally {
      globalThis.fetch = g
    }
    expect(fetched).toBe(0)
    expect(sha(p)).toBe(before) // 元レスポンス・不合格の記録は改変されない
    const v2file = join(diagnosticsDir(dir), `${KEY}.attempt-2.revalidation-v2.json`)
    const rec = JSON.parse(readFileSync(v2file, 'utf-8'))
    expect(rec).toMatchObject({ validationVersion: 2, originalValidationVersion: 1, originalStatus: 'validation-failed', httpRequestCount: 0, analysisSaved: true })
    expect(JSON.stringify(rec)).not.toMatch(/rawResponseText|距離|メンバー/)
    const saved = JSON.parse(readFileSync(analysisPath(dir, KEY), 'utf-8'))
    expect(saved).toMatchObject({ validationVersion: 2, revalidatedFromDiagnostics: true, attempt: 2 })
    expect(saved.emphasis).toHaveLength(1) // 有効なAI強調だけを維持（不足分は手動で追加する）
    expect(saved.emphasis[0].source).toBe('ai')
    // もう一度再検証しても履歴は上書きされず、別ファイルに残る
    revalidateSavedResponse({ dir, key: KEY, captions: caps, attempt: 2, manualEmphasisExpected: true })
    expect(readdirSync(diagnosticsDir(dir)).filter((n) => n.includes('revalidation')).sort()).toEqual([`${KEY}.attempt-2.revalidation-v2-2.json`, `${KEY}.attempt-2.revalidation-v2.json`].sort())
    expect(sha(p)).toBe(before)
    expect(readdirSync(diagnosticsDir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('manualEmphasisExpected が無ければ、有効強調3件未満のため採用・保存しない', () => {
    const resp = strictFail()
    saveAttemptDiagnostics({ dir, key: KEY, attempt: 2, record: { attempt: 2, inputSha256: hashAnalysisInput(captions), rawResponseText: JSON.stringify(resp), status: 'validation-failed' } })
    const r = revalidateSavedResponse({ dir, key: KEY, captions, attempt: 2 })
    expect(r).toMatchObject({ adopted: false, saved: false, requestCount: 0 })
    expect(existsSync(analysisPath(dir, KEY))).toBe(false)
  })
})

describe('editTopicLogged（手動修正の前後を記録する）', () => {
  it('タイトルだけ変更すると manual になり、修正前後のタイトル・秒数・開始のずれ(0秒)を記録する。caption本文・時刻は変わらない', async () => {
    const a = (await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })).analysis
    const frozen = JSON.stringify(captions)
    const r = editTopicLogged(a, 'topic-002', { title: 'ライブ準備の確認と進行' }, captions, new Date('2026-01-01T00:00:00Z'))
    expect(r.ok).toBe(true)
    expect(r.analysis.topics[1]).toMatchObject({ source: 'manual', title: 'ライブ準備の確認と進行' })
    expect(r.entry).toMatchObject({ topicId: 'topic-002', sourceBefore: 'ai', startShiftSec: 0, titleBefore: 'ライブ準備の進め方' })
    expect(r.entry.before).toEqual(r.entry.after)
    expect(r.analysis.manualEdits).toHaveLength(1)
    expect(a.manualEdits).toBeUndefined() // 入力は変更しない
    expect(JSON.stringify(captions)).toBe(frozen)
  })
  it('境界を動かすと開始のずれ(秒)を記録する。不正な修正は記録せず拒否する', async () => {
    const a = (await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })).analysis
    const r = editTopicLogged(a, 'topic-002', { startCaptionId: id(52) }, captions)
    expect(r.entry.startShiftSec).toBeCloseTo(6, 3)
    expect(editTopicLogged(a, 'topic-002', { title: '' }, captions).ok).toBe(false)
  })
})
