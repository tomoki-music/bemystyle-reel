import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ANALYSIS_MODEL,
  buildAnalysisRequestBody,
  buildAnalysisResponseFormat,
  validateAnalysisResponse,
  requestAnalysisOnce,
  runAnalysisOnce,
  fingerprintCaptions,
  analysisPath,
  requestMarkerPath,
  writeJsonAtomic,
  editTopic,
  setTopicDecision,
  upsertEmphasis,
  removeEmphasis,
  setEmphasisDecision,
  mergeRegeneratedAi,
  materializeAnalysis,
  topicsToSections,
  AnalysisError,
} from './topicAnalysis.mjs'

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
    { title: 'メンバーとの距離の取り方', startCaptionId: id(0), endCaptionId: id(49), supportingCaptionIds: [id(2), id(10), id(30)], confidence: 0.9 },
    { title: 'ライブ準備の進め方', startCaptionId: id(50), endCaptionId: id(99), supportingCaptionIds: [id(51), id(60), id(80)], confidence: 0.8 },
  ],
  emphasis: [
    { captionId: id(0), emphasisText: 'とても大事', category: 'keyword', confidence: 0.8 },
    { captionId: id(63), emphasisText: '絶対に必要', category: 'conclusion', confidence: 0.7 },
  ],
})
const okFetch = (obj, calls = { n: 0 }) => async () => {
  calls.n += 1
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) }
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
    expect(props.topics.items.required).toEqual(['title', 'startCaptionId', 'endCaptionId', 'supportingCaptionIds', 'confidence'])
    expect(props.emphasis.items.required).toEqual(['captionId', 'emphasisText', 'category', 'confidence'])
  })
  it('送るのは caption の id と本文だけ（時刻・キーは含めない）', () => {
    const body = buildAnalysisRequestBody(captions)
    const user = JSON.parse(body.messages[1].content)
    expect(Object.keys(user)).toEqual(['captions'])
    expect(Object.keys(user.captions[0])).toEqual(['id', 'text'])
    expect(JSON.stringify(body)).not.toMatch(/sk-|Bearer/)
  })
  it('プロンプトに、対象語の置き換え禁止・完全な部分文字列・根拠captionの制約が含まれる', () => {
    const sys = buildAnalysisRequestBody(captions).messages[0].content
    expect(sys).toContain('別の概念へ置き換えない')
    expect(sys).toContain('完全な部分文字列')
    expect(sys).toContain('supportingCaptionIds')
  })
})

describe('validateAnalysisResponse（AI応答を信用しない）', () => {
  it('正しい応答は合格する（テーマ2件・強調2件）', () => {
    const v = validateAnalysisResponse(goodResponse(), captions)
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.topics).toHaveLength(2)
    expect(v.emphasis).toHaveLength(2)
  })

  const mutate = (fn) => {
    const r = goodResponse()
    fn(r)
    return validateAnalysisResponse(r, captions)
  }

  it('未知のcaption IDを拒否する', () => {
    expect(mutate((r) => { r.topics[0].startCaptionId = 'nope' }).ok).toBe(false)
    expect(mutate((r) => { r.topics[0].supportingCaptionIds.push('nope') }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis[0].captionId = 'nope' }).ok).toBe(false)
  })
  it('重複IDを拒否する（根拠ID・強調のcaptionId）', () => {
    expect(mutate((r) => { r.topics[0].supportingCaptionIds = [id(2), id(2)] }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis.push({ ...r.emphasis[0], emphasisText: '大事です' }) }).ok).toBe(false)
  })
  it('start/endの順序が逆・根拠がテーマ範囲外を拒否する', () => {
    expect(mutate((r) => { r.topics[0].startCaptionId = id(40); r.topics[0].endCaptionId = id(10) }).ok).toBe(false)
    expect(mutate((r) => { r.topics[0].supportingCaptionIds = [id(2), id(70)] }).ok).toBe(false)
  })
  it('テーマ同士の重複・同名の連続を拒否する', () => {
    expect(mutate((r) => { r.topics[1].startCaptionId = id(45) }).ok).toBe(false)
    expect(mutate((r) => { r.topics[1].title = r.topics[0].title }).ok).toBe(false)
  })
  it('空タイトル・長すぎるタイトルを拒否する', () => {
    expect(mutate((r) => { r.topics[0].title = '  ' }).ok).toBe(false)
    expect(mutate((r) => { r.topics[0].title = 'あ'.repeat(30) }).ok).toBe(false)
  })
  it('1〜2文ごとの短いテーマ(20秒未満)を拒否する', () => {
    expect(mutate((r) => { r.topics[0].endCaptionId = id(3); r.topics[0].supportingCaptionIds = [id(1), id(2)] }).ok).toBe(false)
  })
  it('タイトルの対象語が根拠captionに存在しないテーマを拒否する（「メンバー」→「活動」への置き換え）', () => {
    const v = mutate((r) => { r.topics[0].title = '活動との距離の取り方' })
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('対象語が根拠captionに存在しません')
    expect(mutate((r) => { r.topics[0].title = '後輩との距離の取り方' }).ok).toBe(false)
  })
  it('根拠でないcaptionにだけ対象語がある場合も、根拠captionに無ければ拒否する', () => {
    // 「ライブ」は50以降の本文にしか無い。テーマ0（0〜49）の根拠(2,10,30)には無い。
    expect(mutate((r) => { r.topics[0].title = 'ライブ準備との距離の話' }).ok).toBe(false)
  })
  it('confidenceの範囲外・型違いを拒否する', () => {
    expect(mutate((r) => { r.topics[0].confidence = 1.5 }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis[0].confidence = -0.1 }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis[0].confidence = '0.5' }).ok).toBe(false)
  })
  it('emphasisTextが本文の完全な部分文字列でなければ拒否する（言い換え・要約）', () => {
    expect(mutate((r) => { r.emphasis[0].emphasisText = 'とても重要' }).ok).toBe(false)
  })
  it('助詞・句読点だけの強調、文全体の強調、1文字・11文字以上の強調を拒否する', () => {
    expect(mutate((r) => { r.emphasis[0].emphasisText = 'が' }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis[0].emphasisText = captions[0].text }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis[0].emphasisText = 'メンバーとの距離がとても大事' }).ok).toBe(false)
  })
  it('同じ語の繰り返し強調・近接captionでの連続強調を拒否する', () => {
    expect(mutate((r) => { r.emphasis[1] = { captionId: id(7), emphasisText: 'とても大事', category: 'keyword', confidence: 0.5 } }).ok).toBe(false)
    expect(mutate((r) => { r.emphasis[1] = { captionId: id(1), emphasisText: 'メンバー', category: 'keyword', confidence: 0.5 } }).ok).toBe(false)
  })
  it('categoryが列挙外・余分なキー・形式違いを拒否する', () => {
    expect(mutate((r) => { r.emphasis[0].category = 'other' }).ok).toBe(false)
    expect(mutate((r) => { r.topics[0].startSec = 1 }).ok).toBe(false) // 時刻をAI応答で上書きさせない
    expect(validateAnalysisResponse({ topics: [] }, captions).ok).toBe(false)
    expect(validateAnalysisResponse(null, captions).ok).toBe(false)
  })
  it('強調が不要なら0件でもよい（目安件数を満たすために無理に選ばせない）', () => {
    const r = goodResponse()
    r.emphasis = []
    expect(validateAnalysisResponse(r, captions).ok).toBe(true)
  })
  it('テーマが1件のときは合格だが警告（目安2〜4件）', () => {
    const r = goodResponse()
    r.topics = [r.topics[0]]
    const v = validateAnalysisResponse(r, captions)
    expect(v.ok).toBe(true)
    expect(v.warnings.length).toBeGreaterThan(0)
  })
  it('エラー文に caption 本文・テーマ名・強調語を含めない', () => {
    const r = goodResponse()
    r.topics[0].title = '後輩との距離の取り方'
    r.emphasis[0].emphasisText = 'とても重要'
    const msg = validateAnalysisResponse(r, captions).errors.join('\n')
    expect(msg).not.toContain('後輩')
    expect(msg).not.toContain('とても重要')
    expect(msg).not.toContain('メンバー')
  })
})

describe('runAnalysisOnce（1回だけ・部分保存なし・再送なし）', () => {
  it('成功: APIは1回だけ呼ばれ、結果が git管理外想定の別領域へ原子的に保存される（tmpが残らない）', async () => {
    const calls = { n: 0 }
    const r = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse(), calls) })
    expect(calls.n).toBe(1)
    expect(r).toMatchObject({ reused: false, requestCount: 1 })
    const saved = JSON.parse(readFileSync(analysisPath(dir, KEY), 'utf-8'))
    expect(saved.model).toBe('gpt-4o-mini')
    expect(saved.requestCount).toBe(1)
    expect(saved.topics.every((t) => t.source === 'ai' && t.decision === 'accepted')).toBe(true)
    expect(saved.emphasis.every((e) => e.source === 'ai')).toBe(true)
    expect(saved.captionsFingerprint).toBe(fingerprintCaptions(captions))
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('保存結果は再利用され、APIを再実行しない', async () => {
    const calls = { n: 0 }
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse(), calls) })
    const again = await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse(), calls) })
    expect(again).toMatchObject({ reused: true, requestCount: 0 })
    expect(calls.n).toBe(1)
  })

  it('caption列が変わっていたら、保存結果を再利用せず拒否する（別データへの流用防止）', async () => {
    await runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })
    const changed = captions.map((c, i) => (i === 0 ? { ...c, text: c.text + 'x' } : c))
    await expect(runAnalysisOnce({ dir, key: KEY, captions: changed, apiKey: 'sk-test', fetchFn: okFetch(goodResponse()) })).rejects.toMatchObject({ kind: 'stale' })
  })

  it('検証不合格: 何も保存せず停止し、再送しない（送信済みマーカーが残り、再実行も拒否される）', async () => {
    const bad = goodResponse()
    bad.emphasis[0].emphasisText = 'とても重要' // 本文にない
    const calls = { n: 0 }
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(bad, calls) })).rejects.toMatchObject({ kind: 'validation' })
    expect(calls.n).toBe(1)
    expect(existsSync(analysisPath(dir, KEY))).toBe(false) // 部分保存もしない
    expect(existsSync(requestMarkerPath(dir, KEY))).toBe(true)
    await expect(runAnalysisOnce({ dir, key: KEY, captions, apiKey: 'sk-test', fetchFn: okFetch(goodResponse(), calls) })).rejects.toMatchObject({ kind: 'already-requested' })
    expect(calls.n).toBe(1) // 再送していない
  })

  it('API失敗(HTTPエラー)・接続失敗・タイムアウト・空応答・JSON不正: いずれも再送せず停止し、何も保存しない', async () => {
    const cases = [
      ['api', async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'secret detail', code: 'rate' } }) })],
      ['network', async () => { throw new Error('ECONNRESET') }],
      ['timeout', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }],
      ['empty', async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) })],
      ['parse', async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{not json' } }] }) })],
    ]
    for (const [kind, fn] of cases) {
      const d = mkdtempSync(join(tmpdir(), 'topic-analysis-fail-'))
      let n = 0
      try {
        await expect(runAnalysisOnce({ dir: d, key: KEY, captions, apiKey: 'sk-test', fetchFn: async (...a) => { n += 1; return fn(...a) } })).rejects.toMatchObject({ kind })
        expect(n).toBe(1)
        expect(existsSync(analysisPath(d, KEY))).toBe(false)
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

  it('writeJsonAtomic は失敗時に一時ファイルを残さない', () => {
    const target = join(dir, 'no-such-dir', 'x.json')
    expect(() => writeJsonAtomic(target, { a: 1 })).toThrow()
    expect(readdirSync(dir)).toEqual([])
    writeJsonAtomic(join(dir, 'ok.json'), { a: 1 })
    expect(readdirSync(dir)).toEqual(['ok.json'])
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
        { id: 'topic-001', title: 'AIが作り直した題名', startCaptionId: id(0), endCaptionId: id(49), supportingCaptionIds: [id(2)], confidence: 0.5, source: 'ai', decision: 'accepted' },
        { id: 'topic-002', title: 'ライブ準備の進め方２', startCaptionId: id(50), endCaptionId: id(99), supportingCaptionIds: [id(51)], confidence: 0.5, source: 'ai', decision: 'accepted' },
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
    expect(m.emphasisCount).toBe(2)
    expect(m.topicSections).toHaveLength(2)
  })
})
