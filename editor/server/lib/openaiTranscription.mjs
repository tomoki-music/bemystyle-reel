// OpenAI Whisper (audio/transcriptions) への文字起こしリクエスト。
//
// - 送信するのは抽出済みの小さな音声ファイルのみ（動画本体は絶対に送らない）。
// - node-fetch@3 / Node 16 には標準の FormData 実装が無いため、multipart/form-data
//   ボディを自前で組み立てる（新規の重量級依存を増やさないため）。
// - タイムアウト（クライアント側で応答を待ちきれなかった）は「サーバー側で処理が
//   実際に行われたか不明」なため自動リトライしない＝呼び出し側で terminal failure
//   として扱うこと。
// - レスポンスが一切返る前の接続エラー（ECONNREFUSED 等）だけは1回だけ自動リトライ
//   してよい（このモジュールの transcribeAudioFile が内部で1回だけ再試行する）。

import { readFileSync } from 'fs'
import { basename } from 'path'
import fetch from 'node-fetch'

export class TranscriptionTimeoutError extends Error {
  constructor() {
    super('OpenAI Whisper APIへのリクエストがタイムアウトしました')
    this.name = 'TranscriptionTimeoutError'
    this.retryable = false
  }
}

export class TranscriptionNetworkError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TranscriptionNetworkError'
    this.retryable = true
  }
}

export class TranscriptionApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'TranscriptionApiError'
    this.status = status
    this.retryable = false
  }
}

function buildMultipartBody({ fileBuffer, fileName, fields }) {
  const boundary = `----bemystyleCaption${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const parts = []
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        'utf-8'
      )
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/mpeg\r\n\r\n`,
      'utf-8'
    )
  )
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'))
  return { body: Buffer.concat(parts), boundary }
}

/**
 * ネットワークレベル（レスポンス到達前）の失敗かどうかを判定する。
 * fetch がタイムアウト(AbortError)で reject した場合はここには該当しない。
 */
function isPreResponseNetworkError(err) {
  if (!err) return false
  if (err.name === 'AbortError') return false
  const code = err.code || err.cause?.code
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNRESET'
}

async function requestOnce(audioFilePath, apiKey, { timeoutMs, language, model }) {
  const fileBuffer = readFileSync(audioFilePath)
  const fileName = basename(audioFilePath)
  const { body, boundary } = buildMultipartBody({
    fileBuffer,
    fileName,
    fields: {
      model,
      language,
      response_format: 'verbose_json',
    },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const msg = errBody?.error?.message || `OpenAI APIエラー (status ${res.status})`
      throw new TranscriptionApiError(msg, res.status)
    }

    const data = await res.json()
    return data
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new TranscriptionTimeoutError()
    }
    if (err instanceof TranscriptionApiError) throw err
    if (isPreResponseNetworkError(err)) {
      throw new TranscriptionNetworkError(`OpenAIへの接続に失敗しました: ${err.message}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 音声ファイルをOpenAI Whisperへ送信し、セグメント（時間付きキャプション候補）を取得する。
 * タイムアウトは自動リトライしない。接続確立前のネットワークエラーのみ1回だけ自動リトライする。
 *
 * @param {string} audioFilePath 24MB以下であることは呼び出し側で保証済みとする
 * @param {string} apiKey
 * @param {{ timeoutMs?: number, language?: string, model?: string }} [options]
 * @returns {Promise<Array<{ startSec: number, endSec: number, text: string }>>}
 */
export async function transcribeAudioFile(audioFilePath, apiKey, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000
  const language = options.language ?? 'ja'
  const model = options.model ?? 'whisper-1'

  let data
  try {
    data = await requestOnce(audioFilePath, apiKey, { timeoutMs, language, model })
  } catch (err) {
    if (err instanceof TranscriptionNetworkError) {
      // レスポンス到達前の失敗のみ、1回だけ自動リトライ。
      data = await requestOnce(audioFilePath, apiKey, { timeoutMs, language, model })
    } else {
      throw err
    }
  }

  const segments = Array.isArray(data?.segments) ? data.segments : []
  if (segments.length === 0 && typeof data?.text === 'string' && data.text.trim()) {
    // セグメント情報がない応答形式の場合のフォールバック（全体を1件のキャプションにする）
    return [{ startSec: 0, endSec: 0, text: data.text.trim() }]
  }
  return segments.map((seg) => ({
    startSec: Number(seg.start) || 0,
    endSec: Number(seg.end) || 0,
    text: typeof seg.text === 'string' ? seg.text.trim() : '',
  })).filter((c) => c.text)
}
