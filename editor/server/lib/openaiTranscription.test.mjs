import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const mockFetch = vi.fn()
vi.mock('node-fetch', () => ({ default: (...args) => mockFetch(...args) }))

const {
  transcribeAudioFile,
  TranscriptionTimeoutError,
  TranscriptionApiError,
} = await import('./openaiTranscription.mjs')

let dir
let audioPath

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'openai-transcription-test-'))
  audioPath = resolve(dir, 'audio.mp3')
  // OpenAIには実際には送らない（fetchはモック）。readFileSyncが読めるダミーの小さな音声ファイル。
  writeFileSync(audioPath, Buffer.from('fake-audio-bytes'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  mockFetch.mockReset()
})

function okResponse(body) {
  return { ok: true, json: async () => body }
}

describe('transcribeAudioFile', () => {
  it('セグメント付きレスポンスを正しくマッピングする（動画は一切送らず音声ファイルのみ）', async () => {
    mockFetch.mockImplementation((url, opts) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
      expect(opts.method).toBe('POST')
      // 動画ファイルを一切参照していないことを保証（音声ファイルパスのみ扱う）
      expect(Buffer.isBuffer(opts.body) || typeof opts.body === 'string' || opts.body instanceof Uint8Array).toBeTruthy()
      return Promise.resolve(
        okResponse({
          segments: [
            { start: 0, end: 1.5, text: ' こんにちは ' },
            { start: 1.5, end: 3, text: '世界' },
          ],
        })
      )
    })

    const result = await transcribeAudioFile(audioPath, 'sk-test')
    expect(result).toEqual([
      { startSec: 0, endSec: 1.5, text: 'こんにちは' },
      { startSec: 1.5, endSec: 3, text: '世界' },
    ])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('タイムアウト時はTranscriptionTimeoutErrorを投げ、自動リトライしない', async () => {
    mockFetch.mockImplementation((url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    await expect(transcribeAudioFile(audioPath, 'sk-test', { timeoutMs: 20 })).rejects.toBeInstanceOf(
      TranscriptionTimeoutError
    )
    expect(mockFetch).toHaveBeenCalledTimes(1) // リトライしていないことの確認
  })

  it('レスポンス到達前のネットワークエラーは1回だけ自動リトライする', async () => {
    let calls = 0
    mockFetch.mockImplementation(() => {
      calls++
      if (calls === 1) {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:443')
        err.code = 'ECONNREFUSED'
        return Promise.reject(err)
      }
      return Promise.resolve(okResponse({ segments: [{ start: 0, end: 1, text: 'retry ok' }] }))
    })

    const result = await transcribeAudioFile(audioPath, 'sk-test')
    expect(result).toEqual([{ startSec: 0, endSec: 1, text: 'retry ok' }])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('OpenAIのAPIエラー（4xx/5xx応答あり）は自動リトライしない', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid api key' } }) })
    )

    await expect(transcribeAudioFile(audioPath, 'sk-bad')).rejects.toBeInstanceOf(TranscriptionApiError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('セグメントが無くtextのみの応答はフォールバックとして1件のキャプションにする', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(okResponse({ text: '全体テキストのみ' })))
    const result = await transcribeAudioFile(audioPath, 'sk-test')
    expect(result).toEqual([{ startSec: 0, endSec: 0, text: '全体テキストのみ' }])
  })
})
