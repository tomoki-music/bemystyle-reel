// ローカルAIテロップ動画: caption(表示用字幕)の captionType をAIで一括分類する。
//
// 安全設計の要点:
// - caption本文・timestamp・ID・順序・件数はAIの応答で一切書き換えない
//   (AIの応答から使うのは id と captionType のみ)。
// - 290件のような大量データを1リクエストに詰め込まず、30〜50件程度の
//   バッチへ分割して送る。バッチ内の対象ID集合と応答ID集合が完全一致しない
//   場合（欠損・未知・重複・不正captionType）はそのバッチを破棄する。
// - 1バッチでも失敗したら即座に停止する（自動retryしない、残りのバッチも
//   実行しない）。ジョブJSONへの反映は全バッチ成功後に1回だけ行う
//   （途中結果でジョブを上書きしない）。
// - 既に分類済みのジョブは、呼び出し側が force:true を明示しない限り
//   再度APIを呼ばない（意図しない再課金防止）。

import fetch from 'node-fetch'
import { CAPTION_TYPES } from './captionStyles.mjs'

export const CLASSIFICATION_MODEL = 'gpt-4o-mini'
export const CLASSIFICATION_VERSION = 1
export const DEFAULT_BATCH_SIZE = 42
export const DEFAULT_CONTEXT_SIZE = 3
export const DEFAULT_TIMEOUT_MS = 60000

export class ClassificationApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ClassificationApiError'
    this.status = status
  }
}

export class ClassificationTimeoutError extends Error {
  constructor() {
    super('OpenAI分類APIへのリクエストがタイムアウトしました')
    this.name = 'ClassificationTimeoutError'
  }
}

const SYSTEM_PROMPT = `あなたは動画テロップの分類アシスタントです。
与えられた日本語captionを、以下の6種類のcaptionTypeから必ず1つに分類してください。

- normal: 通常の会話、話のつなぎ、特別な装飾が不要な部分。
- main: その話題の結論、中心メッセージ、視聴者へ最も伝えたい文。
- sub: mainの理由、背景、補足説明、具体例。
- emphasis: 短く強調したいキーワード、感情が強い部分、注意を引く決め台詞。多用禁止（全体の10〜20%程度を目安）。
- heading: 新しい話題・章・論点の開始部分。連続して使わず、話題転換が明確な場合のみ使用。
- annotation: 注意書き、例外、前提、補足的な情報（いわゆる「note」に相当）。

分類方針:
- caption本文・timestampは変更しない。分類のみ行う。
- 判断に迷った場合は normal または sub にする。
- main・emphasis・heading を過剰に付けない。
- 同じ種類が不自然に長時間続かないよう、前後の文脈(contextBefore/contextAfter)を考慮する。
- 字幕の意味を推測で追加しない。
- targets に含まれる全idについて、過不足なく1件ずつ分類結果を返すこと。
- contextBefore/contextAfter は文脈確認用であり、分類対象ではない。結果に含めないこと。
- 応答には各対象の id と captionType のみを含め、本文は含めないこと。`

function buildResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'caption_classification',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                captionType: { type: 'string', enum: CAPTION_TYPES },
              },
              required: ['id', 'captionType'],
              additionalProperties: false,
            },
          },
        },
        required: ['classifications'],
        additionalProperties: false,
      },
    },
  }
}

/**
 * captionsを displayOrder 順にバッチへ分割する。各バッチには前後の文脈用captionも付ける
 * （文脈は分類対象に含めない = targetIds には入らない）。
 *
 * @param {Array<{ id: string, text: string, displayOrder: number }>} captions
 * @param {number} [batchSize]
 * @param {number} [contextSize]
 */
export function planClassificationBatches(captions, batchSize = DEFAULT_BATCH_SIZE, contextSize = DEFAULT_CONTEXT_SIZE) {
  if (!Array.isArray(captions) || captions.length === 0) return []
  const sorted = [...captions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  const batches = []
  for (let i = 0; i < sorted.length; i += batchSize) {
    const slice = sorted.slice(i, i + batchSize)
    batches.push({
      batchIndex: batches.length,
      targetIds: slice.map((c) => c.id),
      items: slice,
      contextBefore: sorted.slice(Math.max(0, i - contextSize), i),
      contextAfter: sorted.slice(i + slice.length, i + slice.length + contextSize),
    })
  }
  return batches
}

/**
 * OpenAI Structured Outputs (json_schema, strict) で1バッチを分類する。
 * 自動retryはしない（呼び出し側の責務）。
 *
 * @param {{ targetIds: string[], items: Array<{id:string,text:string}>, contextBefore: Array<{id:string,text:string}>, contextAfter: Array<{id:string,text:string}> }} batch
 * @param {string} apiKey
 * @param {{ timeoutMs?: number, model?: string }} [options]
 * @returns {Promise<Array<{ id: string, captionType: string }>>}
 */
export async function requestClassification(batch, apiKey, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const model = options.model ?? CLASSIFICATION_MODEL

  const payload = {
    contextBefore: batch.contextBefore.map((c) => ({ id: c.id, text: c.text })),
    targets: batch.items.map((c) => ({ id: c.id, text: c.text })),
    contextAfter: batch.contextAfter.map((c) => ({ id: c.id, text: c.text })),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: buildResponseFormat(),
        temperature: 0,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw new ClassificationTimeoutError()
    throw new ClassificationApiError(`OpenAIへの接続に失敗しました: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new ClassificationApiError(errBody?.error?.message || `OpenAI APIエラー (status ${res.status})`, res.status)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content) {
    throw new ClassificationApiError('OpenAIからの応答が空です')
  }

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new ClassificationApiError('OpenAIの応答をJSONとして解析できませんでした')
  }

  return Array.isArray(parsed?.classifications) ? parsed.classifications : []
}

/**
 * 1バッチの分類結果を検証する。対象ID集合と応答ID集合が完全一致し、
 * 全captionTypeが既存の値であることを要求する。1件でも欠損/未知/重複/不正が
 * あればバッチ全体を不合格にする。
 *
 * @param {{ targetIds: string[] }} batch
 * @param {Array<{ id: unknown, captionType: unknown }>} classifications
 */
export function validateBatchResult(batch, classifications) {
  const targetIdSet = new Set(batch.targetIds)
  const seen = new Set()
  let unknownCount = 0
  let duplicateCount = 0
  let invalidTypeCount = 0
  const result = new Map()

  for (const entry of classifications) {
    const id = entry?.id
    const type = entry?.captionType
    if (typeof id !== 'string' || !targetIdSet.has(id)) {
      unknownCount++
      continue
    }
    if (seen.has(id)) {
      duplicateCount++
      continue
    }
    seen.add(id)
    if (typeof type !== 'string' || !CAPTION_TYPES.includes(type)) {
      invalidTypeCount++
      continue
    }
    result.set(id, type)
  }

  const missingCount = batch.targetIds.filter((id) => !seen.has(id)).length
  const ok = unknownCount === 0 && duplicateCount === 0 && invalidTypeCount === 0 && missingCount === 0

  return { ok, result, missingCount, unknownCount, duplicateCount, invalidTypeCount }
}

/**
 * ジョブ全体の captions を分類する（純粋関数寄り: JobStoreには触れない。
 * 呼び出し側が成功時のみ store.save する）。
 *
 * @param {{ captions: Array<{id:string,text:string,captionType:string,displayOrder:number}>, captionClassification?: object }} job
 * @param {string} apiKey
 * @param {{
 *   force?: boolean,
 *   batchSize?: number,
 *   contextSize?: number,
 *   model?: string,
 *   timeoutMs?: number,
 *   requestFn?: typeof requestClassification,
 *   onBatchStart?: (batchIndex: number, totalBatches: number) => void,
 * }} [options]
 */
export async function classifyJobCaptions(job, apiKey, options = {}) {
  const {
    force = false,
    batchSize = DEFAULT_BATCH_SIZE,
    contextSize = DEFAULT_CONTEXT_SIZE,
    model = CLASSIFICATION_MODEL,
    timeoutMs,
    requestFn = requestClassification,
    onBatchStart,
  } = options

  const captions = Array.isArray(job.captions) ? job.captions : []
  if (captions.length === 0) {
    return { ok: false, reason: 'no_captions' }
  }
  if (job.captionClassification && !force) {
    return { ok: false, reason: 'already_classified', classification: job.captionClassification }
  }

  const batches = planClassificationBatches(captions, batchSize, contextSize)
  const totalBatches = batches.length
  const combined = new Map()
  let requestCount = 0

  for (const batch of batches) {
    if (typeof onBatchStart === 'function') onBatchStart(batch.batchIndex, totalBatches)

    let classifications
    try {
      requestCount++
      classifications = await requestFn(batch, apiKey, { timeoutMs, model })
    } catch (err) {
      return {
        ok: false,
        reason: 'api_error',
        message: err.message,
        failedBatchIndex: batch.batchIndex,
        totalBatches,
        requestCount,
      }
    }

    const validation = validateBatchResult(batch, classifications)
    if (!validation.ok) {
      return {
        ok: false,
        reason: 'validation_error',
        failedBatchIndex: batch.batchIndex,
        totalBatches,
        requestCount,
        missingCount: validation.missingCount,
        unknownCount: validation.unknownCount,
        duplicateCount: validation.duplicateCount,
        invalidTypeCount: validation.invalidTypeCount,
      }
    }

    for (const [id, type] of validation.result) combined.set(id, type)
  }

  // 全バッチが成功して初めて captions へ反映する（部分適用しない）。
  // captionType 以外のフィールドは元のオブジェクトのまま保つ。
  const nextCaptions = captions.map((c) => (combined.has(c.id) ? { ...c, captionType: combined.get(c.id) } : c))

  const typeCounts = Object.fromEntries(CAPTION_TYPES.map((t) => [t, 0]))
  for (const c of nextCaptions) typeCounts[c.captionType] = (typeCounts[c.captionType] ?? 0) + 1

  return {
    ok: true,
    captions: nextCaptions,
    classification: {
      model,
      classifiedAt: new Date().toISOString(),
      version: CLASSIFICATION_VERSION,
      batchCount: totalBatches,
      requestCount,
      batchSize,
    },
    typeCounts,
    requestCount,
    totalBatches,
  }
}
