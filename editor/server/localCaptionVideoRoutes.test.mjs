import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import express from 'express'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import fetch from 'node-fetch'

// ffmpeg/ffprobe/OpenAIは一切実プロセス起動・実APIコールしない。すべてモックする。
const mockRunFfprobe = vi.fn()
const mockExtractAudio = vi.fn()
const mockBurnCaptions = vi.fn()
vi.mock('./lib/ffmpegRunner.mjs', () => ({
  runFfprobe: (...a) => mockRunFfprobe(...a),
  extractAudio: (...a) => mockExtractAudio(...a),
  burnCaptions: (...a) => mockBurnCaptions(...a),
  getFileSize: () => 1000,
}))

const mockTranscribeAudioFile = vi.fn()
vi.mock('./lib/openaiTranscription.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    transcribeAudioFile: (...a) => mockTranscribeAudioFile(...a),
  }
})

const { createLocalCaptionVideoRouter } = await import('./localCaptionVideoRoutes.mjs')

let base
let inputRoot
let outputRoot
let outsideRoot
let jobsDir
let server
let baseUrl

beforeAll(async () => {
  // macOSでは /var が /private/var のシンボリックリンクのため、realpath済みのベースを使う
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lcv-routes-test-')))
  inputRoot = resolve(base, 'input')
  outputRoot = resolve(base, 'output')
  outsideRoot = resolve(base, 'outside')
  jobsDir = resolve(base, 'jobs')
  mkdirSync(inputRoot, { recursive: true })
  mkdirSync(outputRoot, { recursive: true })
  mkdirSync(outsideRoot, { recursive: true })

  process.env.VIDEO_INPUT_ROOTS = inputRoot
  process.env.VIDEO_OUTPUT_ROOT = outputRoot
  process.env.OPENAI_API_KEY = 'sk-test-dummy'

  writeFileSync(resolve(inputRoot, 'sample.mp4'), 'dummy-bytes-not-a-real-video')
  writeFileSync(resolve(outsideRoot, 'secret.mp4'), 'dummy')

  const app = express()
  app.use(express.json())
  app.use('/api/local-caption-videos', createLocalCaptionVideoRouter({ jobsDir }))

  await new Promise((resolvePromise) => {
    server = app.listen(0, () => resolvePromise())
  })
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}/api/local-caption-videos`
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  rmSync(base, { recursive: true, force: true })
})

beforeEach(() => {
  mockRunFfprobe.mockReset()
  mockExtractAudio.mockReset()
  mockBurnCaptions.mockReset()
  mockTranscribeAudioFile.mockReset()
  mockRunFfprobe.mockResolvedValue({
    durationSec: 10,
    width: 1080,
    height: 1920,
    rotation: 0,
    videoCodec: 'h264',
    audioCodec: 'aac',
    container: 'mp4',
    hasAudio: true,
  })
})

describe('POST /api/local-caption-videos (ジョブ作成のパス検証)', () => {
  it('許可ルート外のパスは400で拒否する', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(outsideRoot, 'secret.mp4') }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  it('"..".トラバーサルで許可ルートを抜けようとするパスは拒否する', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, '..', 'outside', 'secret.mp4') }),
    })
    expect(res.status).toBe(400)
  })

  it('存在しないパスは400で拒否する', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'nope.mp4') }),
    })
    expect(res.status).toBe(400)
  })

  it('許可ルート内の有効な動画パスはジョブを作成し、ffprobeを実行してready_for_editになる', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.job.status).toBe('ready_for_edit')
    expect(data.job.hasAudio).toBe(true)
    expect(mockRunFfprobe).toHaveBeenCalledTimes(1)
  })

  it('ffprobeが失敗した場合ジョブはfailedになる', async () => {
    mockRunFfprobe.mockRejectedValueOnce(new Error('壊れた動画です'))
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.job.status).toBe('failed')
  })
})

describe('GET /api/local-caption-videos/:id/source-stream (Range対応・パス再検証)', () => {
  it('Rangeヘッダ付きリクエストに206で部分応答する', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()

    const res = await fetch(`${baseUrl}/${job.id}/source-stream`, { headers: { Range: 'bytes=0-3' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-3\//)
    const buf = await res.buffer()
    expect(buf.length).toBe(4)
  })

  it('Rangeヘッダが無ければ200で全体を返す', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()
    const res = await fetch(`${baseUrl}/${job.id}/source-stream`)
    expect(res.status).toBe(200)
  })
})

describe('字幕CRUD', () => {
  it('字幕の追加・並び替え・削除ができる', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()

    const add1 = await fetch(`${baseUrl}/${job.id}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startSec: 0, endSec: 1, text: '最初のキャプション' }),
    })
    expect(add1.status).toBe(200)

    const add2res = await fetch(`${baseUrl}/${job.id}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startSec: 1, endSec: 2, text: '2番目' }),
    })
    const add2 = await add2res.json()
    expect(add2.job.captions.length).toBe(2)

    // 終了時刻が開始時刻より前 -> 拒否
    const invalid = await fetch(`${baseUrl}/${job.id}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startSec: 5, endSec: 1, text: '不正' }),
    })
    expect(invalid.status).toBe(400)

    const ids = add2.job.captions.map((c) => c.id)
    const reordered = await fetch(`${baseUrl}/${job.id}/captions/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [...ids].reverse() }),
    })
    expect(reordered.status).toBe(200)
    const reorderedData = await reordered.json()
    expect(reorderedData.job.captions[0].id).toBe(ids[1])

    const del = await fetch(`${baseUrl}/${job.id}/captions/${ids[0]}`, { method: 'DELETE' })
    const delData = await del.json()
    expect(delData.job.captions.length).toBe(1)
  })
})

describe('POST /api/local-caption-videos/:id/render', () => {
  it('字幕が1件も無い場合は400', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()
    const res = await fetch(`${baseUrl}/${job.id}/render`, { method: 'POST' })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/local-caption-videos/:id', () => {
  it('ジョブレコードを削除しても元動画ファイルは削除しない', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()
    const res = await fetch(`${baseUrl}/${job.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(existsSync(resolve(inputRoot, 'sample.mp4'))).toBe(true)

    const getRes = await fetch(`${baseUrl}/${job.id}`)
    expect(getRes.status).toBe(404)
  })
})

describe('GET /api/local-caption-videos/browse', () => {
  it('パス未指定なら許可ルート一覧を返す', async () => {
    const res = await fetch(`${baseUrl}/browse`)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.entries.some((e) => e.path === inputRoot)).toBe(true)
  })

  it('許可ルート外のパスを指定すると400', async () => {
    const res = await fetch(`${baseUrl}/browse?path=${encodeURIComponent(outsideRoot)}`)
    expect(res.status).toBe(400)
  })

  it('許可ルート内のパスは動画ファイルとサブディレクトリを一覧できる', async () => {
    const res = await fetch(`${baseUrl}/browse?path=${encodeURIComponent(inputRoot)}`)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.entries.some((e) => e.name === 'sample.mp4' && e.isVideo)).toBe(true)
  })
})
