// ローカルAIテロップ動画: 5分区間の「トークテーマ」と「部分強調」の分析（AI候補の取得・検証・保存・手動修正）。
//
// 安全設計:
// - 使うのは保存済みのcaption本文（Whisper文字起こしではない）。gpt-4o-mini へ Structured Outputs で
//   テーマ候補と強調候補を「1回のリクエスト」でまとめて取得する。
// - 自動retryはしない。失敗・タイムアウト・検証不合格は再送せず停止する。リクエストを送る前に「送信済みマーカー」を
//   作るため、同じ対象への再実行は（マーカーを人が消さない限り）APIを呼ばずに拒否する。
// - AI応答は信用しない。1件でも不正なら全体を破棄し、何も保存しない（部分保存しない）。
//   caption本文・時刻・IDはAI応答で書き換えない（使うのは caption ID とテーマ名・強調語だけ）。
// - テーマ名の対象語は、根拠captionの本文に実在することを checkTopicTitleGrounding で確認する（別概念への置き換え防止）。
// - 成功した結果は既存ジョブとは別の git 管理外の領域へ原子的に保存し、以後は再利用してAPIを呼ばない。
// - AI候補は source:'ai' の「編集可能な候補」。手動修正(source:'manual')が常に優先され、AI再生成で上書きされない。
// - エラーメッセージ・戻り値に caption 本文・AI生レスポンス・APIキーを含めない。

import fetch from 'node-fetch'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { validateEmphasis } from './emphasisSelector.mjs'
import { validateTopicTitle, checkTopicTitleGrounding, mergeTopicSections, validateTopicSections } from './topicSections.mjs'

export const ANALYSIS_MODEL = 'gpt-4o-mini'
export const ANALYSIS_VERSION = 1
export const ANALYSIS_TIMEOUT_MS = 90000
export const EMPHASIS_CATEGORIES = ['conclusion', 'keyword', 'emotion', 'memorable']
export const ANALYSIS_LIMITS = {
  topics: { min: 1, max: 6, guideMin: 2, guideMax: 4, minSpanSec: 20 },
  emphasis: { max: 14, guideMin: 5, guideMax: 12, minGapCaptions: 3 },
}

export class AnalysisError extends Error {
  constructor(message, kind = 'analysis') {
    super(message)
    this.name = 'AnalysisError'
    this.kind = kind
  }
}

const SYSTEM_PROMPT = `あなたは動画テロップの編集アシスタントです。与えられた日本語captionの列（約5分間のトーク動画）から、次の2つを1回で返してください。

【1. トークテーマ（2〜4件が目安）】
- 話題が実際に切り替わる位置でテーマを分ける。1〜2文ごとに変えない。同じテーマを連続させない。テーマ同士は重複させない。
- title: 8〜18文字（最大24文字）。「誰・何について話しているか」を落とさない。抽象化しすぎない。
- titleに使う対象の名詞（人・物・活動の名前）は、根拠captionの本文にある語をそのまま使う。本文にない語・別の概念へ置き換えない
  （例:「メンバー」を「活動」のような別の語にしない）。本文にない主語や対象を推測で作らない。
- startCaptionId / endCaptionId: そのテーマが続く最初と最後のcaption ID（caption境界）。startはendより前（同じでも可）。
- supportingCaptionIds: titleの根拠になるcaption IDを2〜5件。必ず start〜end の範囲内のIDを使う。titleの対象語はこれらのcaption本文に含まれていること。
- confidence: 0〜1。

【2. 部分強調（5〜12件が目安。不要なら無理に選ばない）】
- captionId: 対象caption。1captionにつき0〜1か所。
- emphasisText: そのcaption本文の「完全な部分文字列」（一字一句そのまま。言い換え・要約は禁止）。2〜10文字程度。
- 結論・キーワード・感情の核・視聴者に覚えてほしい語だけを選ぶ。助詞・句読点だけ、文全体は選ばない。
  固有名詞を機械的にすべて強調しない。同じ語を何度も強調しない。近接するcaptionで強調を連続させない。
- category: conclusion / keyword / emotion / memorable のいずれか。
- confidence: 0〜1。

【共通（厳守。1つでも違反すると応答全体が破棄される）】
- supportingCaptionIds は、必ず startCaptionId〜endCaptionId の範囲内（caption列の並び順で start 以降 end 以前）のIDだけにする。
- emphasisText は、対象captionのtextからそのまま連続してコピーした文字列にする。textに無い文字を1文字でも足したり、
  表記（漢字・かな・カタカナ・記号）を変えたり、離れた語をつなげたりしない。迷ったら強調しない。
- caption本文・IDは変更しない。応答に本文の全文を含めない（IDと、titleと、emphasisTextだけ）。
- 存在しないIDを返さない。`

/** Structured Outputs の応答形式（strict）。 */
export function buildAnalysisResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'five_minute_topics_and_emphasis',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                startCaptionId: { type: 'string' },
                endCaptionId: { type: 'string' },
                supportingCaptionIds: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number' },
              },
              required: ['title', 'startCaptionId', 'endCaptionId', 'supportingCaptionIds', 'confidence'],
              additionalProperties: false,
            },
          },
          emphasis: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                captionId: { type: 'string' },
                emphasisText: { type: 'string' },
                category: { type: 'string', enum: EMPHASIS_CATEGORIES },
                confidence: { type: 'number' },
              },
              required: ['captionId', 'emphasisText', 'category', 'confidence'],
              additionalProperties: false,
            },
          },
        },
        required: ['topics', 'emphasis'],
        additionalProperties: false,
      },
    },
  }
}

/** リクエスト本体（1回分）。captions は { id, text } だけを送る（時刻は送らない）。 */
export function buildAnalysisRequestBody(captions, model = ANALYSIS_MODEL) {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ captions: captions.map((c) => ({ id: c.id, text: c.text })) }) },
    ],
    response_format: buildAnalysisResponseFormat(),
    temperature: 0,
  }
}

/** 入力captionの指紋（id・本文・時刻）。保存結果が別のcaption列に対するものでないことの確認に使う。 */
export function fingerprintCaptions(captions) {
  return createHash('sha256').update(JSON.stringify(captions.map((c) => [c.id, c.text, c.startSec, c.endSec]))).digest('hex')
}

/**
 * OpenAIへ1回だけ問い合わせる。retryしない。
 * @param {{ captions: Array<{id:string,text:string}>, apiKey: string, fetchFn?: Function, timeoutMs?: number, model?: string }} p
 * @returns {Promise<object>} パース済みの応答（未検証）
 */
export async function requestAnalysisOnce(p) {
  const fetchFn = p.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), p.timeoutMs ?? ANALYSIS_TIMEOUT_MS)
  let res
  try {
    res = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify(buildAnalysisRequestBody(p.captions, p.model)),
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw new AnalysisError('AI分析のリクエストがタイムアウトしました（再送しません）', 'timeout')
    throw new AnalysisError('OpenAIへの接続に失敗しました（再送しません）', 'network')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // APIのエラーメッセージ(本文やキーを含みうる)は出さず、ステータスだけ
    throw new AnalysisError(`OpenAI APIエラー (status ${res.status}${body?.error?.code ? `, code ${String(body.error.code).slice(0, 40)}` : ''})（再送しません）`, 'api')
  }
  const data = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content) throw new AnalysisError('OpenAIの応答が空です（再送しません）', 'empty')
  try {
    return JSON.parse(content)
  } catch {
    throw new AnalysisError('OpenAIの応答をJSONとして解析できませんでした（再送しません）', 'parse')
  }
}

const isConfidence = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const hasOnlyKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o)

/**
 * AI応答を検証する（純粋関数）。1件でも不正なら ok=false。エラー文には caption 本文を含めない（IDと番号のみ）。
 *
 * @param {unknown} resp
 * @param {Array<{ id: string, text: string, startSec: number, endSec: number }>} captions
 * @param {{ limits?: typeof ANALYSIS_LIMITS }} [opts]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], topics: Array<object>, emphasis: Array<object> }}
 */
export function validateAnalysisResponse(resp, captions, opts = {}) {
  const L = opts.limits ?? ANALYSIS_LIMITS
  const errors = []
  const warnings = []
  const idx = new Map(captions.map((c, i) => [c.id, i]))
  if (!hasOnlyKeys(resp, ['topics', 'emphasis']) || !Array.isArray(resp.topics) || !Array.isArray(resp.emphasis)) {
    return { ok: false, errors: ['応答の形式が不正です（topics/emphasis 以外のキー、または配列でない）'], warnings, topics: [], emphasis: [] }
  }

  // ── トークテーマ ──
  const topics = []
  if (resp.topics.length < L.topics.min || resp.topics.length > L.topics.max) errors.push(`テーマ件数が範囲外です（${resp.topics.length}件）`)
  else if (resp.topics.length < L.topics.guideMin || resp.topics.length > L.topics.guideMax) warnings.push(`テーマ件数が目安(${L.topics.guideMin}〜${L.topics.guideMax})から外れています`)
  resp.topics.forEach((t, i) => {
    const at = `topics[${i}]`
    if (!hasOnlyKeys(t, ['title', 'startCaptionId', 'endCaptionId', 'supportingCaptionIds', 'confidence'])) {
      errors.push(`${at}: 項目が不正です`)
      return
    }
    const tv = validateTopicTitle(t.title)
    if (!tv.ok) errors.push(...tv.errors.map((e) => `${at}: ${e}`))
    if (!idx.has(t.startCaptionId)) errors.push(`${at}: startCaptionIdが実在しません`)
    if (!idx.has(t.endCaptionId)) errors.push(`${at}: endCaptionIdが実在しません`)
    if (!isConfidence(t.confidence)) errors.push(`${at}: confidenceが範囲外です`)
    if (!Array.isArray(t.supportingCaptionIds) || t.supportingCaptionIds.length === 0) {
      errors.push(`${at}: supportingCaptionIdsがありません`)
      return
    }
    const si = idx.get(t.startCaptionId)
    const ei = idx.get(t.endCaptionId)
    if (si === undefined || ei === undefined) return
    if (si > ei) errors.push(`${at}: 開始が終了より後です`)
    const seen = new Set()
    let supportOk = true
    for (const id of t.supportingCaptionIds) {
      if (!idx.has(id)) {
        errors.push(`${at}: 根拠captionIDが実在しません`)
        supportOk = false
      } else if (seen.has(id)) {
        errors.push(`${at}: 根拠captionIDが重複しています`)
        supportOk = false
      } else if (idx.get(id) < si || idx.get(id) > ei) {
        errors.push(`${at}: 根拠captionがテーマの範囲外です`)
        supportOk = false
      }
      seen.add(id)
    }
    if (tv.ok && supportOk) {
      const supportText = t.supportingCaptionIds.map((id) => captions[idx.get(id)].text).join('')
      const g = checkTopicTitleGrounding(t.title, supportText)
      if (!g.ok) errors.push(`${at}: タイトルの対象語が根拠captionに存在しません（${g.ungroundedTerms.length}語）`)
    }
    if (si <= ei) {
      const span = captions[ei].endSec - captions[si].startSec
      if (span < L.topics.minSpanSec) errors.push(`${at}: テーマの継続時間が短すぎます（1〜2文ごとの切り替えの疑い）`)
    }
    topics.push({ title: String(t.title).trim(), startCaptionId: t.startCaptionId, endCaptionId: t.endCaptionId, supportingCaptionIds: [...t.supportingCaptionIds], confidence: t.confidence, _si: si, _ei: ei })
  })
  const ordered = [...topics].sort((a, b) => a._si - b._si)
  ordered.forEach((t, i) => {
    if (i === 0) return
    const prev = ordered[i - 1]
    if (t._si <= prev._ei) errors.push('テーマ同士が重複しています')
    else if (t.title === prev.title) errors.push('同じテーマ名が連続しています')
  })
  if (topics.some((t, i) => i > 0 && t._si < topics[i - 1]._si)) errors.push('テーマが時刻順ではありません')

  // ── 部分強調 ──
  const emphasis = []
  if (resp.emphasis.length > L.emphasis.max) errors.push(`強調件数が多すぎます（${resp.emphasis.length}件）`)
  else if (resp.emphasis.length > L.emphasis.guideMax || (resp.emphasis.length > 0 && resp.emphasis.length < L.emphasis.guideMin)) warnings.push('強調件数が目安から外れています')
  const usedCaption = new Set()
  const usedPhrase = new Set()
  resp.emphasis.forEach((e, i) => {
    const at = `emphasis[${i}]`
    if (!hasOnlyKeys(e, ['captionId', 'emphasisText', 'category', 'confidence'])) {
      errors.push(`${at}: 項目が不正です`)
      return
    }
    if (!idx.has(e.captionId)) {
      errors.push(`${at}: captionIdが実在しません`)
      return
    }
    if (usedCaption.has(e.captionId)) errors.push(`${at}: 1captionに複数の強調があります`)
    usedCaption.add(e.captionId)
    if (!EMPHASIS_CATEGORIES.includes(e.category)) errors.push(`${at}: categoryが不正です`)
    if (!isConfidence(e.confidence)) errors.push(`${at}: confidenceが範囲外です`)
    const problem = validateEmphasis(e.emphasisText, captions[idx.get(e.captionId)].text)
    if (problem) errors.push(`${at}: ${problem}`)
    if (typeof e.emphasisText === 'string') {
      if (usedPhrase.has(e.emphasisText)) errors.push(`${at}: 同じ語を繰り返し強調しています`)
      usedPhrase.add(e.emphasisText)
    }
    emphasis.push({ captionId: e.captionId, emphasisText: e.emphasisText, category: e.category, confidence: e.confidence, _i: idx.get(e.captionId) })
  })
  const byIdx = [...emphasis].sort((a, b) => a._i - b._i)
  byIdx.forEach((e, i) => {
    if (i > 0 && e._i - byIdx[i - 1]._i < L.emphasis.minGapCaptions) errors.push('近接するcaptionで強調が連続しています')
  })

  const strip = (o) => {
    const { _si, _ei, _i, ...rest } = o
    return rest
  }
  return { ok: errors.length === 0, errors, warnings, topics: topics.map(strip), emphasis: emphasis.map(strip) }
}

// ────────────────────────────────────────────────────────────────
// 保存（原子的）と1回きりの実行
// ────────────────────────────────────────────────────────────────

/** JSONを一時ファイルへ書いてから rename する（途中状態の正本ファイルを残さない）。 */
export function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf-8', flag: 'wx' })
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export const analysisPath = (dir, key) => join(dir, `${key}.analysis.json`)
export const requestMarkerPath = (dir, key) => join(dir, `${key}.analysis-request.marker`)

export function loadAnalysis(dir, key) {
  const p = analysisPath(dir, key)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null
}

/** 保存用の分析オブジェクトを組み立てる（検証済みの応答から）。AI候補は source:'ai'、decision:'accepted'。 */
export function buildAnalysisRecord(validated, captions, meta = {}) {
  return {
    version: ANALYSIS_VERSION,
    model: meta.model ?? ANALYSIS_MODEL,
    createdAt: (meta.now ?? new Date()).toISOString(),
    requestCount: 1,
    captionsFingerprint: fingerprintCaptions(captions),
    topics: validated.topics.map((t, i) => ({ id: `topic-${String(i + 1).padStart(3, '0')}`, ...t, source: 'ai', decision: 'accepted' })),
    emphasis: validated.emphasis.map((e) => ({ ...e, source: 'ai', decision: 'accepted' })),
  }
}

/**
 * AI分析を「1回だけ」実行して保存する。
 * - 保存済みなら再利用（APIを呼ばない）。
 * - 送信済みマーカーがあり結果が無い場合は、前回の失敗とみなして再送せず拒否する。
 * - リクエスト前にマーカーを作る（途中で落ちても自動再送されない）。
 * - 検証に失敗したら何も保存せず AnalysisError（kind:'validation'）を投げる。
 *
 * @param {{ dir: string, key: string, captions: Array<object>, apiKey: string, fetchFn?: Function, timeoutMs?: number, now?: Date }} p
 * @returns {Promise<{ reused: boolean, analysis: object, requestCount: number, warnings: string[] }>}
 */
export async function runAnalysisOnce(p) {
  const existing = loadAnalysis(p.dir, p.key)
  if (existing) {
    if (existing.captionsFingerprint !== fingerprintCaptions(p.captions)) throw new AnalysisError('保存済みの分析結果が現在のcaption列と一致しません（再利用しません）', 'stale')
    return { reused: true, analysis: existing, requestCount: 0, warnings: [] }
  }
  if (!p.apiKey) throw new AnalysisError('APIキーが設定されていません', 'config')
  mkdirSync(p.dir, { recursive: true })
  try {
    writeFileSync(requestMarkerPath(p.dir, p.key), `${new Date().toISOString()}\n`, { flag: 'wx' })
  } catch (err) {
    if (err?.code === 'EEXIST') throw new AnalysisError('この対象には既にAI分析リクエストを送信済みで、結果がありません。自動では再送しません（送信済みマーカーを確認してください）', 'already-requested')
    throw err
  }
  const raw = await requestAnalysisOnce({ captions: p.captions, apiKey: p.apiKey, fetchFn: p.fetchFn, timeoutMs: p.timeoutMs })
  const v = validateAnalysisResponse(raw, p.captions)
  if (!v.ok) throw new AnalysisError(`AI応答の検証に失敗しました。何も保存せず停止します（再送しません）: ${v.errors.slice(0, 8).join(' / ')}`, 'validation')
  const record = buildAnalysisRecord(v, p.captions, { now: p.now })
  writeJsonAtomic(analysisPath(p.dir, p.key), record)
  return { reused: false, analysis: record, requestCount: 1, warnings: v.warnings }
}

// ────────────────────────────────────────────────────────────────
// 手動修正（純粋関数。入力は変更しない）
// ────────────────────────────────────────────────────────────────

const capIndex = (captions) => new Map(captions.map((c, i) => [c.id, i]))
const decisionOk = (d) => d === 'accepted' || d === 'rejected'

/** 却下されていない（=表示に使う）テーマを、時刻付きの TopicSection[] に変換する。 */
export function topicsToSections(analysis, captions) {
  const idx = capIndex(captions)
  return (analysis?.topics ?? [])
    .filter((t) => t.decision !== 'rejected' && idx.has(t.startCaptionId) && idx.has(t.endCaptionId))
    .map((t) => ({ id: t.id, title: t.title, startSec: captions[idx.get(t.startCaptionId)].startSec, endSec: captions[idx.get(t.endCaptionId)].endSec, source: t.source }))
    .sort((a, b) => a.startSec - b.startSec)
}

/**
 * テーマ名・開始・終了を手動で修正する。修正後は source:'manual'、decision:'accepted'。
 * 検証に失敗したら ok:false（元のまま）。他の（却下されていない）テーマと重なる修正は拒否する。
 */
export function editTopic(analysis, topicId, patch, captions) {
  const idx = capIndex(captions)
  const t = analysis.topics.find((x) => x.id === topicId)
  if (!t) return { ok: false, analysis, errors: ['対象のテーマが見つかりません'] }
  const next = { ...t, ...patch }
  const errors = []
  const tv = validateTopicTitle(next.title)
  if (!tv.ok) errors.push(...tv.errors)
  if (!idx.has(next.startCaptionId) || !idx.has(next.endCaptionId)) errors.push('開始・終了のcaption IDが実在しません')
  else if (idx.get(next.startCaptionId) > idx.get(next.endCaptionId)) errors.push('開始が終了より後です')
  if (errors.length) return { ok: false, analysis, errors }
  next.title = next.title.trim()
  next.source = 'manual'
  next.decision = 'accepted'
  const topics = analysis.topics.map((x) => (x.id === topicId ? next : x))
  const v = validateTopicSections(topicsToSections({ topics }, captions))
  if (!v.ok) return { ok: false, analysis, errors: v.errors }
  return { ok: true, analysis: { ...analysis, topics }, errors: [] }
}

export function setTopicDecision(analysis, topicId, decision) {
  if (!decisionOk(decision) || !analysis.topics.some((t) => t.id === topicId)) return { ok: false, analysis, errors: ['対象または判断が不正です'] }
  return { ok: true, analysis: { ...analysis, topics: analysis.topics.map((t) => (t.id === topicId ? { ...t, decision } : t)) }, errors: [] }
}

/** 部分強調を追加・変更する（1captionにつき0〜1か所）。修正後は source:'manual'。 */
export function upsertEmphasis(analysis, captionId, emphasisText, captions) {
  const idx = capIndex(captions)
  if (!idx.has(captionId)) return { ok: false, analysis, errors: ['captionが実在しません'] }
  const problem = validateEmphasis(emphasisText, captions[idx.get(captionId)].text)
  if (problem) return { ok: false, analysis, errors: [problem] }
  const rest = analysis.emphasis.filter((e) => e.captionId !== captionId)
  const prev = analysis.emphasis.find((e) => e.captionId === captionId)
  return { ok: true, analysis: { ...analysis, emphasis: [...rest, { captionId, emphasisText, category: prev?.category ?? 'keyword', confidence: prev?.confidence ?? 1, source: 'manual', decision: 'accepted' }] }, errors: [] }
}

/** 部分強調を削除する（記録は decision:'rejected' として残し、AI再生成で復活させない）。 */
export function removeEmphasis(analysis, captionId) {
  if (!analysis.emphasis.some((e) => e.captionId === captionId)) return { ok: false, analysis, errors: ['対象の強調が見つかりません'] }
  return { ok: true, analysis: { ...analysis, emphasis: analysis.emphasis.map((e) => (e.captionId === captionId ? { ...e, decision: 'rejected' } : e)) }, errors: [] }
}

export function setEmphasisDecision(analysis, captionId, decision) {
  if (!decisionOk(decision) || !analysis.emphasis.some((e) => e.captionId === captionId)) return { ok: false, analysis, errors: ['対象または判断が不正です'] }
  return { ok: true, analysis: { ...analysis, emphasis: analysis.emphasis.map((e) => (e.captionId === captionId ? { ...e, decision } : e)) }, errors: [] }
}

/**
 * 新しく生成したAI候補を、既存の分析へ統合する。手動(manual)のテーマ・強調と、却下(rejected)した強調は常に残り、
 * それと衝突するAI候補は捨てる。
 */
export function mergeRegeneratedAi(existing, regenerated, captions) {
  const idx = capIndex(captions)
  const manualTopics = existing.topics.filter((t) => t.source === 'manual')
  const manualIds = new Set(manualTopics.map((t) => t.id))
  // 再生成されたAI候補は、手動テーマとidが衝突しないよう別idにする
  const aiTopics = regenerated.topics.map((t) => (manualIds.has(t.id) ? { ...t, id: `${t.id}-r` } : t))
  const secs = (arr) => topicsToSections({ topics: arr.map((t) => ({ ...t, decision: 'accepted' })) }, captions)
  const merged = mergeTopicSections(secs(aiTopics), secs(manualTopics))
  const origin = new Map([...aiTopics, ...manualTopics].map((t) => [t.id, t]))
  const startId = (sec) => captions.find((c) => c.startSec === sec)?.id
  const endId = (sec) => captions.find((c) => c.endSec === sec)?.id
  const topics = merged
    .map((s) => {
      const base = origin.get(s.id) ?? origin.get(s.id.replace(/-[ab]$/, ''))
      const si = startId(s.startSec)
      const ei = endId(s.endSec)
      if (!base || !si || !ei) return null
      const support = (base.supportingCaptionIds ?? []).filter((id) => idx.get(id) >= idx.get(si) && idx.get(id) <= idx.get(ei))
      return { id: s.id, title: s.title, startCaptionId: si, endCaptionId: ei, supportingCaptionIds: support, confidence: base.confidence, source: s.source, decision: 'accepted' }
    })
    .filter(Boolean)
  const keepCaption = new Set(existing.emphasis.filter((e) => e.source === 'manual' || e.decision === 'rejected').map((e) => e.captionId))
  const emphasis = [...existing.emphasis.filter((e) => keepCaption.has(e.captionId)), ...regenerated.emphasis.filter((e) => !keepCaption.has(e.captionId))]
  return { ...existing, topics, emphasis }
}

/**
 * 描画に使う最終データ: 却下されていないテーマ(TopicSection[])と、強調を反映した caption 配列。
 * caption の本文・時刻・行は変更しない（emphasisText だけを付ける）。
 */
export function materializeAnalysis(analysis, captions) {
  const emphasisByCaption = new Map((analysis?.emphasis ?? []).filter((e) => e.decision !== 'rejected').map((e) => [e.captionId, e.emphasisText]))
  const outCaptions = captions.map((c) => ({ ...c, emphasisText: emphasisByCaption.has(c.id) && c.text.includes(emphasisByCaption.get(c.id)) ? emphasisByCaption.get(c.id) : null }))
  return { topicSections: topicsToSections(analysis, captions), captions: outCaptions, emphasisCount: outCaptions.filter((c) => c.emphasisText).length }
}
