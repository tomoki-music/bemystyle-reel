// ローカルAIテロップ動画: 5分区間の「トークテーマ」と「部分強調」の分析（AI候補の取得・候補単位の検証・保存・手動修正）。
//
// 安全設計:
// - 使うのは保存済みのcaption本文（Whisper文字起こしではない）。gpt-4o-mini へ Structured Outputs で
//   テーマ候補と強調候補を「1回のリクエスト」でまとめて取得する。
// - 自動retryはしない。失敗・タイムアウト・検証不合格は再送せず停止する。リクエストを送る前に「試行ごとの送信済みマーカー」を
//   作るため、同じ試行番号への再実行は（マーカーを人が消さない限り）APIを呼ばずに拒否する。
//   試行番号(attempt)は累計で管理し、上限(ANALYSIS_ATTEMPT_LIMIT)を超える試行は拒否する。
// - AI応答は信用しない。ただし「1件の不正候補が、無関係な有効候補まで巻き込んで全破棄される」ことはさせない:
//   テーマ・強調を候補単位で検証し、有効な候補だけを採用する。範囲外の根拠IDは、そのIDだけを除外する。
//   採用条件（有効テーマ2〜4件・有効強調3件以上）を満たさなければ何も採用せず停止する（部分保存しない）。
//   caption本文・時刻・IDはAI応答で書き換えない（使うのは caption ID とテーマ名・強調語だけ）。
// - 強調語は、正規化（Unicode・全角半角・不可視文字・空白）後に本文へ一意に一致する場合だけ、
//   元本文側の正確な部分文字列へ復元する。ファジー一致・複数箇所一致は採用しない。
// - テーマ名の対象語は、（有効な）根拠captionの本文に実在することを checkTopicTitleGrounding で確認する。
// - API応答は成功・不合格にかかわらず git 管理外の診断領域へ保存する（analysisDiagnostics.mjs）。
//   既存ジョブJSONには保存しない。
// - 採用した結果は既存ジョブとは別の git 管理外の領域へ、テーマと強調を1つの分析結果として原子的に保存し、以後は再利用してAPIを呼ばない。
// - AI候補は source:'ai' の「編集可能な候補」。手動修正(source:'manual')が常に優先され、AI再生成で上書きされない。
// - エラーメッセージ・戻り値に caption 本文・AI生レスポンス・APIキーを含めない。

import fetch from 'node-fetch'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { validateEmphasis } from './emphasisSelector.mjs'
import { restoreEmphasisText } from './emphasisRestore.mjs'
import { validateTopicTitle, checkTopicTitleGrounding, mergeTopicSections, validateTopicSections } from './topicSections.mjs'
import { loadAttemptDiagnostics, saveAttemptDiagnostics } from './analysisDiagnostics.mjs'

export const ANALYSIS_MODEL = 'gpt-4o-mini'
export const ANALYSIS_VERSION = 2
export const ANALYSIS_TIMEOUT_MS = 90000
/** 累計の試行回数の上限。1回目=前回（検証不合格）、2回目=今回だけ許可された追加の1回。3回目以降は拒否する。 */
export const ANALYSIS_ATTEMPT_LIMIT = 2
export const EMPHASIS_CATEGORIES = ['conclusion', 'keyword', 'emotion', 'memorable']
export const ANALYSIS_LIMITS = {
  topics: { min: 2, max: 4, minSpanSec: 20 },
  emphasis: { min: 3, max: 14, guideMin: 5, guideMax: 12, minGapCaptions: 3 },
}

export class AnalysisError extends Error {
  constructor(message, kind = 'analysis', extra = {}) {
    super(message)
    this.name = 'AnalysisError'
    this.kind = kind
    Object.assign(this, extra)
  }
}

const SYSTEM_PROMPT = `あなたは動画テロップの編集アシスタントです。与えられた日本語captionの列（約5分間のトーク動画）から、次の2つを1回で返してください。
入力は captions（order=並び順の番号、id=caption ID、text=本文）と orderedIds（IDを並び順に並べた一覧）です。

【1. トークテーマ（2〜4件）】
- 話題が実際に切り替わる位置でテーマを分ける。1〜2文ごとに変えない。同じテーマを連続させない。テーマ同士は重複させない（範囲が重ならない）。
- title: 8〜18文字が推奨（最大24文字）。「誰・何について話しているか」を落とさない。抽象化しすぎない。
- titleに使う対象の名詞（人・物・活動の名前）は、根拠captionの本文にある主要な語をそのまま残す。
  本文にない語・別の概念へ置き換えない（例:「メンバー」を「活動」のような別の語にしない）。本文にない主語や対象を推測で作らない。
- startCaptionId / endCaptionId: そのテーマが続く最初と最後のcaption ID。startのorderはendのorder以下。
- evidenceCaptionIds: titleの根拠になるcaption IDを2〜5件。
  ・必ず start〜end の範囲内（orderが start 以上 end 以下）のIDだけを使う。範囲の外のIDは1件も含めない。
  ・根拠caption以外のIDを返さない。IDは orderedIds / captions[].id から一字一句そのままコピーする（作らない・並べ替えて推測しない）。
  ・titleの主要な対象語は、これらのcaption本文に含まれていること。
- confidence: 0〜1。

【2. 部分強調（5〜12件程度。不要なら件数を無理に満たさない）】
- captionId: 対象caption（orderedIdsのIDをそのままコピー）。1captionにつき0〜1か所。
- emphasisText: そのcaption本文からの「一字一句そのままのコピー」（連続した部分文字列）。
  ・書き換え・要約・言い換え・表記変更（漢字/かな/カタカナ/全角半角）をしない。前後に空白や句読点を勝手に足さない。
  ・2〜10文字程度。文全体は選ばない。助詞・句読点だけを選ばない。
  ・結論・キーワード・感情の核・視聴者に覚えてほしい語だけを選ぶ。固有名詞を機械的にすべて強調しない。
    同じ語を何度も強調しない。近接するcaptionで強調を連続させない。
- category: conclusion / keyword / emotion / memorable のいずれか。
- confidence: 0〜1。

【共通】
- caption本文・IDは変更しない。応答に本文の全文を含めない（IDと、titleと、emphasisTextだけ）。
- 存在しないIDを返さない。迷ったら、その候補は返さない（不正な候補は個別に無視されます）。`

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
                evidenceCaptionIds: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number' },
              },
              required: ['title', 'startCaptionId', 'endCaptionId', 'evidenceCaptionIds', 'confidence'],
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

/** ユーザーメッセージ本体。入力可能なIDと所属順（order）を明示する。時刻は送らない。 */
export function buildAnalysisUserContent(captions) {
  return {
    captionCount: captions.length,
    firstCaptionId: captions[0]?.id ?? null,
    lastCaptionId: captions[captions.length - 1]?.id ?? null,
    orderedIds: captions.map((c) => c.id),
    captions: captions.map((c, i) => ({ order: i + 1, id: c.id, text: c.text })),
  }
}

/** リクエスト本体（1回分）。 */
export function buildAnalysisRequestBody(captions, model = ANALYSIS_MODEL) {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(buildAnalysisUserContent(captions)) },
    ],
    response_format: buildAnalysisResponseFormat(),
    temperature: 0,
  }
}

/** 入力の指紋（プロンプト・schema・captionのid/本文を含むリクエスト本体のSHA-256）。診断に保存し、再検証時に入力の一致を確認する。 */
export function hashAnalysisInput(captions, model = ANALYSIS_MODEL) {
  return createHash('sha256').update(JSON.stringify(buildAnalysisRequestBody(captions, model))).digest('hex')
}

/** 入力captionの指紋（id・本文・時刻）。保存結果が別のcaption列に対するものでないことの確認に使う。 */
export function fingerprintCaptions(captions) {
  return createHash('sha256').update(JSON.stringify(captions.map((c) => [c.id, c.text, c.startSec, c.endSec]))).digest('hex')
}

/**
 * OpenAIへ1回だけ問い合わせる。retryしない。
 * @param {{ captions: Array<{id:string,text:string}>, apiKey: string, fetchFn?: Function, timeoutMs?: number, model?: string }} p
 * @returns {Promise<{ parsed: object, rawText: string, httpStatus: number, meta: object }>} パース済みの応答（未検証）
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
    // APIのエラーメッセージ(本文やキーを含みうる)は出さず・保存せず、ステータスとエラーコードだけ
    const errorCode = body?.error?.code ? String(body.error.code).slice(0, 40) : null
    throw new AnalysisError(`OpenAI APIエラー (status ${res.status}${errorCode ? `, code ${errorCode}` : ''})（再送しません）`, 'api', { httpStatus: res.status, errorCode })
  }
  const data = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  const meta = { responseModel: typeof data?.model === 'string' ? data.model : null, finishReason: data?.choices?.[0]?.finish_reason ?? null, usage: data?.usage && typeof data.usage === 'object' ? data.usage : null }
  if (typeof content !== 'string' || !content) throw new AnalysisError('OpenAIの応答が空です（再送しません）', 'empty', { httpStatus: res.status, meta })
  try {
    return { parsed: JSON.parse(content), rawText: content, httpStatus: res.status, meta }
  } catch {
    throw new AnalysisError('OpenAIの応答をJSONとして解析できませんでした（再送しません）', 'parse', { httpStatus: res.status, rawText: content, meta })
  }
}

const isConfidence = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const hasOnlyKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o)
const bump = (h, k) => {
  h[k] = (h[k] ?? 0) + 1
}

/** validateEmphasis の日本語メッセージを理由コードへ（本文を含まないコードだけを集計・報告するため）。 */
function emphasisProblemCode(problem) {
  if (problem.includes('空')) return 'empty'
  if (problem.includes('未満')) return 'too-short'
  if (problem.includes('超えて')) return 'too-long'
  if (problem.includes('完全な部分文字列')) return 'not-in-text'
  if (problem.includes('特殊文字')) return 'control-chars'
  if (problem.includes('句読点だけ')) return 'punct-only'
  if (problem.includes('助詞・接続詞')) return 'function-word-only'
  if (problem.includes('caption全体')) return 'whole-caption'
  return 'invalid'
}

/**
 * AI応答を「候補単位」で検証する（純粋関数）。1件の不正候補が、無関係な有効候補を巻き込んで全破棄されることはない。
 * 戻り値・診断には caption 本文・テーマ名・強調語を含めない（index と理由コード・件数のみ）。
 *
 * テーマ候補の採用条件: 形式・start/endが実在・start<=end・titleが有効・confidenceが有効・
 *   根拠IDのうち「実在し、テーマ範囲内で、重複しない」ものが1件以上残る・titleの対象語が残った根拠本文に存在・
 *   他テーマ（採用済み）と範囲が重ならず、同名でない・継続時間が短すぎない。
 *   範囲外/実在しない/重複した根拠IDは、範囲を書き換えずそのIDだけを除外する。
 * 強調候補の採用条件: 形式・captionIdが実在・categoryとconfidenceが有効・強調語が本文の完全な部分文字列
 *   （または正規化後に本文へ一意に一致し、元本文側へ復元できる）・2〜10文字・助詞/句読点/文全体でない・
 *   同一caption内・同じ語で重複しない。
 *
 * @param {unknown} resp
 * @param {Array<{ id: string, text: string, startSec: number, endSec: number }>} captions
 * @param {{ limits?: typeof ANALYSIS_LIMITS }} [opts]
 */
export function validateAnalysisCandidates(resp, captions, opts = {}) {
  const L = opts.limits ?? ANALYSIS_LIMITS
  const idx = new Map(captions.map((c, i) => [c.id, i]))
  const rejected = { topics: [], emphasis: [] }
  const droppedEvidence = []
  const warnings = []
  const restored = []
  const result = (topics, emphasis, formatOk) => {
    const reasons = { topics: {}, emphasis: {}, evidenceIdsDropped: {} }
    rejected.topics.forEach((r) => bump(reasons.topics, r.code))
    rejected.emphasis.forEach((r) => bump(reasons.emphasis, r.code))
    droppedEvidence.forEach((r) => bump(reasons.evidenceIdsDropped, r.code))
    const adopted = formatOk && topics.length >= L.topics.min && topics.length <= L.topics.max && emphasis.length >= L.emphasis.min
    return {
      formatOk,
      adopted,
      topics,
      emphasis,
      rejected,
      droppedEvidence,
      restoredByNormalization: restored.length,
      warnings,
      counts: {
        topicsProposed: Array.isArray(resp?.topics) ? resp.topics.length : 0,
        topicsAccepted: topics.length,
        topicsRejected: rejected.topics.length,
        emphasisProposed: Array.isArray(resp?.emphasis) ? resp.emphasis.length : 0,
        emphasisAccepted: emphasis.length,
        emphasisRejected: rejected.emphasis.length,
        evidenceIdsDropped: droppedEvidence.length,
        emphasisRestoredByNormalization: restored.length,
      },
      reasons,
    }
  }
  if (!hasOnlyKeys(resp, ['topics', 'emphasis']) || !Array.isArray(resp.topics) || !Array.isArray(resp.emphasis)) {
    warnings.push('応答の形式が不正です（topics/emphasis 以外のキー、または配列でない）')
    return result([], [], false)
  }

  // ── トークテーマ（候補ごと） ──
  const passed = []
  resp.topics.forEach((t, i) => {
    const reject = (code) => rejected.topics.push({ index: i, code })
    if (!hasOnlyKeys(t, ['title', 'startCaptionId', 'endCaptionId', 'evidenceCaptionIds', 'confidence'])) return reject('shape')
    if (!validateTopicTitle(t.title).ok) return reject('title-invalid')
    if (!isConfidence(t.confidence)) return reject('confidence-invalid')
    if (!idx.has(t.startCaptionId)) return reject('start-unknown')
    if (!idx.has(t.endCaptionId)) return reject('end-unknown')
    const si = idx.get(t.startCaptionId)
    const ei = idx.get(t.endCaptionId)
    if (si > ei) return reject('order-reversed')
    if (!Array.isArray(t.evidenceCaptionIds) || t.evidenceCaptionIds.some((x) => typeof x !== 'string')) return reject('shape')
    // 根拠ID: 実在・範囲内・非重複のものだけを残す。範囲は書き換えない。
    const seen = new Set()
    const evidence = []
    for (const eid of t.evidenceCaptionIds) {
      if (!idx.has(eid)) droppedEvidence.push({ topicIndex: i, code: 'evidence-unknown' })
      else if (idx.get(eid) < si || idx.get(eid) > ei) droppedEvidence.push({ topicIndex: i, code: 'evidence-out-of-range' })
      else if (seen.has(eid)) droppedEvidence.push({ topicIndex: i, code: 'evidence-duplicate' })
      else {
        seen.add(eid)
        evidence.push(eid)
      }
    }
    if (evidence.length === 0) return reject('no-valid-evidence')
    const g = checkTopicTitleGrounding(String(t.title).trim(), evidence.map((eid) => captions[idx.get(eid)].text).join(''))
    if (!g.ok) return reject('title-not-grounded')
    if (captions[ei].endSec - captions[si].startSec < L.topics.minSpanSec) return reject('span-too-short')
    passed.push({ index: i, title: String(t.title).trim(), startCaptionId: t.startCaptionId, endCaptionId: t.endCaptionId, evidenceCaptionIds: evidence, confidence: t.confidence, si, ei })
  })
  // 重複しない採用: 信頼度の高い順（同点は時刻順）に、既採用の範囲・同名と衝突しないものだけを採る。上限を超えたものは採らない。
  const accepted = []
  for (const c of [...passed].sort((a, b) => b.confidence - a.confidence || a.si - b.si)) {
    if (accepted.some((a) => c.si <= a.ei && a.si <= c.ei)) rejected.topics.push({ index: c.index, code: 'overlap' })
    else if (accepted.some((a) => a.title === c.title)) rejected.topics.push({ index: c.index, code: 'duplicate-title' })
    else if (accepted.length >= L.topics.max) rejected.topics.push({ index: c.index, code: 'over-limit' })
    else accepted.push(c)
  }
  accepted.sort((a, b) => a.si - b.si)
  const topics = accepted.map(({ index, si, ei, ...rest }) => rest)
  if (resp.topics.length > 0 && (topics.length < L.topics.min || topics.length > L.topics.max)) warnings.push(`有効テーマが${topics.length}件です（採用条件は${L.topics.min}〜${L.topics.max}件）`)

  // ── 部分強調（候補ごと） ──
  const usedCaption = new Set()
  const usedPhrase = new Set()
  const emphasis = []
  resp.emphasis.forEach((e, i) => {
    const reject = (code) => rejected.emphasis.push({ index: i, code })
    if (!hasOnlyKeys(e, ['captionId', 'emphasisText', 'category', 'confidence'])) return reject('shape')
    if (!idx.has(e.captionId)) return reject('caption-unknown')
    if (!EMPHASIS_CATEGORIES.includes(e.category)) return reject('category-invalid')
    if (!isConfidence(e.confidence)) return reject('confidence-invalid')
    if (typeof e.emphasisText !== 'string') return reject('shape')
    const text = captions[idx.get(e.captionId)].text
    // 完全一致を優先。差が「表記だけ」のとき（Unicode・全角半角・不可視文字・空白）に限り、本文側の正確な部分文字列へ復元する。
    const r = restoreEmphasisText(text, e.emphasisText)
    if (!r.ok) return reject(r.reason === 'ambiguous' ? 'ambiguous' : r.reason === 'empty' ? 'empty' : 'not-in-text')
    const problem = validateEmphasis(r.text, text)
    if (problem) return reject(emphasisProblemCode(problem))
    if (usedCaption.has(e.captionId)) return reject('duplicate-in-caption')
    if (usedPhrase.has(r.text)) return reject('repeated-phrase')
    usedCaption.add(e.captionId)
    usedPhrase.add(r.text)
    if (!r.exact) restored.push(i)
    emphasis.push({ captionId: e.captionId, emphasisText: r.text, category: e.category, confidence: e.confidence, _i: idx.get(e.captionId) })
  })
  const limited = [...emphasis].sort((a, b) => b.confidence - a.confidence).slice(0, L.emphasis.max)
  if (limited.length < emphasis.length) warnings.push('強調の上限を超えた候補は採用していません')
  const kept = new Set(limited.map((e) => e.captionId))
  const finalEmphasis = emphasis.filter((e) => kept.has(e.captionId)).sort((a, b) => a._i - b._i)
  finalEmphasis.forEach((e, k) => {
    if (k > 0 && e._i - finalEmphasis[k - 1]._i < L.emphasis.minGapCaptions) warnings.push('近接するcaptionで強調が連続しています')
  })
  if (finalEmphasis.length < L.emphasis.min) warnings.push(`有効強調が${finalEmphasis.length}件です（採用条件は${L.emphasis.min}件以上）`)
  return result(topics, finalEmphasis.map(({ _i, ...rest }) => rest), true)
}

// ────────────────────────────────────────────────────────────────
// 保存（原子的）と試行管理つきの1回きりの実行
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
/** 試行1（前回の送信済み記録）は従来のマーカー名。試行2以降は試行番号つき。既存のマーカーは変更しない。 */
export const requestMarkerPath = (dir, key, attempt = 1) => (attempt <= 1 ? join(dir, `${key}.analysis-request.marker`) : join(dir, `${key}.analysis-request.attempt-${attempt}.marker`))

/** 送信済みの試行の累計（マーカーが連続して存在する最大の試行番号）。 */
export function countAttempts(dir, key) {
  let n = 0
  while (existsSync(requestMarkerPath(dir, key, n + 1))) n += 1
  return n
}

export function loadAnalysis(dir, key) {
  const p = analysisPath(dir, key)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null
}

/** 保存用の分析オブジェクトを組み立てる（採用した候補だけ）。AI候補は source:'ai'、decision:'accepted'。 */
export function buildAnalysisRecord(validated, captions, meta = {}) {
  return {
    version: ANALYSIS_VERSION,
    model: meta.model ?? ANALYSIS_MODEL,
    createdAt: (meta.now ?? new Date()).toISOString(),
    attempt: meta.attempt ?? 1,
    requestCount: 1,
    captionsFingerprint: fingerprintCaptions(captions),
    topics: validated.topics.map((t, i) => ({ id: `topic-${String(i + 1).padStart(3, '0')}`, ...t, source: 'ai', decision: 'accepted' })),
    emphasis: validated.emphasis.map((e) => ({ ...e, source: 'ai', decision: 'accepted' })),
  }
}

/** 診断・報告用の検証要約（本文・テーマ名・強調語を含まない）。 */
export function summarizeValidation(v) {
  return { formatOk: v.formatOk, adopted: v.adopted, counts: v.counts, reasons: v.reasons, warnings: v.warnings }
}

/**
 * AI分析を「1回だけ」実行して保存する。
 * - 保存済みなら再利用（APIを呼ばない）。
 * - attempt は呼び出し側が明示する（次の試行番号と一致し、上限以内であること）。送信済みの試行番号・上限超過は再送せず拒否する。
 * - リクエスト前に試行ごとのマーカーを作る（途中で落ちても自動再送されない）。
 * - 応答（成功・不合格・形式不正）は診断領域へ保存する。
 * - 採用条件（有効テーマ2〜4件・有効強調3件以上）を満たさなければ何も保存せず AnalysisError（kind:'validation'）を投げる。
 *
 * @param {{ dir: string, key: string, captions: Array<object>, apiKey: string, attempt?: number, attemptLimit?: number, fetchFn?: Function, timeoutMs?: number, now?: Date }} p
 * @returns {Promise<{ reused: boolean, analysis: object, requestCount: number, attempt: number, attemptsTotal: number, warnings: string[], validation: object|null, diagnostics: { saved: boolean, mode?: string } }>}
 */
export async function runAnalysisOnce(p) {
  const attempt = p.attempt ?? 1
  const limit = p.attemptLimit ?? ANALYSIS_ATTEMPT_LIMIT
  const existing = loadAnalysis(p.dir, p.key)
  if (existing) {
    if (existing.captionsFingerprint !== fingerprintCaptions(p.captions)) throw new AnalysisError('保存済みの分析結果が現在のcaption列と一致しません（再利用しません）', 'stale')
    return { reused: true, analysis: existing, requestCount: 0, attempt: existing.attempt ?? 1, attemptsTotal: countAttempts(p.dir, p.key), warnings: [], validation: null, diagnostics: { saved: false } }
  }
  if (!p.apiKey) throw new AnalysisError('APIキーが設定されていません', 'config')
  const done = countAttempts(p.dir, p.key)
  if (attempt <= done) throw new AnalysisError(`試行${attempt}は送信済みで、結果がありません。自動では再送しません（送信済みマーカーを確認してください）`, 'already-requested')
  if (attempt > done + 1) throw new AnalysisError(`試行番号が不正です（次の試行は${done + 1}）`, 'attempt-sequence')
  if (attempt > limit) throw new AnalysisError(`累計の試行上限（${limit}回）に達しているため、追加のリクエストは送りません`, 'attempt-limit')
  mkdirSync(p.dir, { recursive: true })
  const now = p.now ?? new Date()
  const inputSha256 = hashAnalysisInput(p.captions)
  try {
    writeFileSync(requestMarkerPath(p.dir, p.key, attempt), `${now.toISOString()}\n`, { flag: 'wx' })
  } catch (err) {
    if (err?.code === 'EEXIST') throw new AnalysisError(`試行${attempt}は送信済みです。自動では再送しません`, 'already-requested')
    throw err
  }
  const record = {
    attemptId: `${p.key}-attempt-${attempt}-${now.toISOString().replace(/[-:.]/g, '')}`,
    attempt,
    createdAt: now.toISOString(),
    model: ANALYSIS_MODEL,
    analysisVersion: ANALYSIS_VERSION,
    inputSha256,
    captionsFingerprint: fingerprintCaptions(p.captions),
    httpRequestCount: 1,
    status: 'requested',
  }
  const persist = () => {
    try {
      return { saved: true, ...saveAttemptDiagnostics({ dir: p.dir, key: p.key, attempt, record, apiKey: p.apiKey }) }
    } catch {
      return { saved: false }
    }
  }

  let res
  try {
    res = await requestAnalysisOnce({ captions: p.captions, apiKey: p.apiKey, fetchFn: p.fetchFn, timeoutMs: p.timeoutMs })
  } catch (err) {
    if (err instanceof AnalysisError) {
      record.status = err.kind
      record.httpStatus = err.httpStatus ?? null
      if (err.errorCode) record.errorCode = err.errorCode
      if (typeof err.rawText === 'string') record.rawResponseText = err.rawText
      if (err.meta) record.apiMeta = err.meta
      err.diagnostics = persist()
      err.attempt = attempt
    }
    throw err
  }
  record.httpStatus = res.httpStatus
  record.apiMeta = res.meta
  record.rawResponseText = res.rawText
  const v = validateAnalysisCandidates(res.parsed, p.captions)
  record.validation = summarizeValidation(v)
  record.status = v.adopted ? 'adopted' : 'validation-failed'
  const diagnostics = persist()
  if (!v.adopted) {
    throw new AnalysisError(
      `AI応答が採用条件を満たしませんでした（有効テーマ${v.counts.topicsAccepted}件・有効強調${v.counts.emphasisAccepted}件）。何も採用せず停止します（再送しません）`,
      'validation',
      { validation: summarizeValidation(v), diagnostics, attempt },
    )
  }
  const analysis = buildAnalysisRecord(v, p.captions, { now, attempt })
  writeJsonAtomic(analysisPath(p.dir, p.key), analysis)
  return { reused: false, analysis, requestCount: 1, attempt, attemptsTotal: attempt, warnings: v.warnings, validation: summarizeValidation(v), diagnostics }
}

/**
 * 保存済みの診断（生応答）を、HTTPなしで現在の検証ロジックで再検証する。採用条件を満たし、まだ分析結果が無ければ保存する。
 * 入力の指紋が保存時と一致しない場合は拒否する。リクエストは送らない。
 */
export function revalidateSavedResponse(p) {
  const record = loadAttemptDiagnostics(p.dir, p.key, p.attempt)
  if (!record || typeof record.rawResponseText !== 'string') throw new AnalysisError('再検証できる保存済みの応答がありません', 'no-saved-response')
  if (record.inputSha256 !== hashAnalysisInput(p.captions)) throw new AnalysisError('保存済みの応答は現在の入力に対するものではありません（再検証しません）', 'stale')
  let parsed
  try {
    parsed = JSON.parse(record.rawResponseText)
  } catch {
    throw new AnalysisError('保存済みの応答をJSONとして解析できませんでした', 'parse')
  }
  const v = validateAnalysisCandidates(parsed, p.captions)
  let saved = false
  if (v.adopted && !loadAnalysis(p.dir, p.key)) {
    writeJsonAtomic(analysisPath(p.dir, p.key), { ...buildAnalysisRecord(v, p.captions, { now: p.now, attempt: p.attempt }), revalidatedFromDiagnostics: true })
    saved = true
  }
  return { requestCount: 0, adopted: v.adopted, saved, validation: summarizeValidation(v) }
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
  // 根拠IDは、実在し、テーマ範囲内のものだけを保存できる。明示的に渡された範囲外・未実在のIDは拒否する。
  // 範囲の修正で外れてしまった既存の根拠IDは、範囲を勝手に広げず、そのIDだけを除外する。
  if (errors.length === 0) {
    const si = idx.get(next.startCaptionId)
    const ei = idx.get(next.endCaptionId)
    const inRange = (id) => idx.has(id) && idx.get(id) >= si && idx.get(id) <= ei
    if (patch.evidenceCaptionIds !== undefined) {
      if (!Array.isArray(patch.evidenceCaptionIds) || !patch.evidenceCaptionIds.every((id) => typeof id === 'string' && inRange(id))) errors.push('根拠のcaption IDがテーマの範囲外、または実在しません')
      else if (new Set(patch.evidenceCaptionIds).size !== patch.evidenceCaptionIds.length) errors.push('根拠のcaption IDが重複しています')
    }
    if (errors.length === 0) next.evidenceCaptionIds = (next.evidenceCaptionIds ?? []).filter(inRange)
  }
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
  // 却下したAIテーマは復活させない: 却下済みテーマと範囲が重なる再生成AIテーマは捨て、却下の記録は残す
  const rejectedTopics = existing.topics.filter((t) => t.source !== 'manual' && t.decision === 'rejected' && idx.has(t.startCaptionId) && idx.has(t.endCaptionId))
  const overlapsRejected = (t) => rejectedTopics.some((r) => idx.get(t.startCaptionId) <= idx.get(r.endCaptionId) && idx.get(r.startCaptionId) <= idx.get(t.endCaptionId))
  // 再生成されたAI候補は、手動テーマとidが衝突しないよう別idにする
  const aiTopics = regenerated.topics.filter((t) => !overlapsRejected(t)).map((t) => (manualIds.has(t.id) ? { ...t, id: `${t.id}-r` } : t))
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
      const support = (base.evidenceCaptionIds ?? []).filter((id) => idx.get(id) >= idx.get(si) && idx.get(id) <= idx.get(ei))
      return { id: s.id, title: s.title, startCaptionId: si, endCaptionId: ei, evidenceCaptionIds: support, confidence: base.confidence, source: s.source, decision: 'accepted' }
    })
    .filter(Boolean)
  const keepCaption = new Set(existing.emphasis.filter((e) => e.source === 'manual' || e.decision === 'rejected').map((e) => e.captionId))
  const emphasis = [...existing.emphasis.filter((e) => keepCaption.has(e.captionId)), ...regenerated.emphasis.filter((e) => !keepCaption.has(e.captionId))]
  const usedIds = new Set(topics.map((t) => t.id))
  const keptRejected = rejectedTopics.map((t) => (usedIds.has(t.id) ? { ...t, id: `${t.id}-rej` } : t))
  return { ...existing, topics: [...topics, ...keptRejected], emphasis }
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
