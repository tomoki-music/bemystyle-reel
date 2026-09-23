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
import { JobStore } from './lib/jobStore.mjs'

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
let tmpRoot
let server
let baseUrl

// pipeline は fire-and-forget（HTTPレスポンス後に非同期実行）なので、
// ジョブの状態が期待条件を満たすまでポーリングする。
async function waitForJob(jobId, predicate, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/${jobId}`)
    const data = await res.json()
    last = data.job
    if (data.ok && predicate(data.job)) return data.job
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`timeout waiting for job condition. last status=${last?.status}`)
}

beforeAll(async () => {
  // macOSでは /var が /private/var のシンボリックリンクのため、realpath済みのベースを使う
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lcv-routes-test-')))
  inputRoot = resolve(base, 'input')
  outputRoot = resolve(base, 'output')
  outsideRoot = resolve(base, 'outside')
  jobsDir = resolve(base, 'jobs')
  tmpRoot = resolve(base, 'caption-tmp')
  mkdirSync(inputRoot, { recursive: true })
  mkdirSync(outputRoot, { recursive: true })
  mkdirSync(outsideRoot, { recursive: true })

  process.env.VIDEO_INPUT_ROOTS = inputRoot
  process.env.VIDEO_OUTPUT_ROOT = outputRoot
  process.env.OPENAI_API_KEY = 'sk-test-dummy'
  process.env.CAPTION_VIDEO_TMP_ROOT = tmpRoot

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
  // 実際に一時音声ファイルを書き出すデフォルト実装（削除確認テストのため）
  mockExtractAudio.mockImplementation(async (_sourceRealPath, audioPath) => {
    writeFileSync(audioPath, 'fake-audio-bytes')
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

describe('POST /api/local-caption-videos/:id/start-processing (Whisper文字起こしパイプラインの永続化・冪等性)', () => {
  it('全segmentが保存され、サーバー再起動相当の再読み込みができ、完了済みジョブの再実行ではWhisperを呼ばない', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()

    mockTranscribeAudioFile.mockResolvedValueOnce([
      { startSec: 0, endSec: 1.2, text: 'ひとつめ' },
      { startSec: 1.2, endSec: 2.5, text: 'ふたつめ' },
      { startSec: 2.5, endSec: 4.0, text: 'みっつめ' },
    ])

    const startRes = await fetch(`${baseUrl}/${job.id}/start-processing`, { method: 'POST' })
    expect(startRes.status).toBe(200)

    // (1) 全segmentがtext/startSec/endSecを保ったまま保存される
    const done = await waitForJob(job.id, (j) => j.status === 'ready_for_edit' && Boolean(j.transcribedAt))
    expect(done.captions.length).toBe(3)
    expect(done.captions.map((c) => c.text)).toEqual(['ひとつめ', 'ふたつめ', 'みっつめ'])
    expect(done.captions[0]).toMatchObject({ startSec: 0, endSec: 1.2, text: 'ひとつめ' })
    expect(done.captions.every((c) => typeof c.id === 'string' && c.id.length > 0)).toBe(true)
    expect(mockTranscribeAudioFile).toHaveBeenCalledTimes(1)

    // 音声一時ファイルは処理後に削除されている
    const audioPath = resolve(tmpRoot, `${job.id}.mp3`)
    expect(existsSync(audioPath)).toBe(false)

    // (2) サーバー再起動相当: 別インスタンスのJobStoreで同じディレクトリを読み直しても内容が一致する
    const freshStore = new JobStore(jobsDir)
    const reloaded = freshStore.load(job.id)
    expect(reloaded.captions.length).toBe(3)
    expect(reloaded.captions.map((c) => c.text)).toEqual(['ひとつめ', 'ふたつめ', 'みっつめ'])
    expect(reloaded.transcribedAt).toBe(done.transcribedAt)

    // (3) 完了済みジョブを再度start-processingしてもWhisper APIは呼ばれない
    const secondStartRes = await fetch(`${baseUrl}/${job.id}/start-processing`, { method: 'POST' })
    expect(secondStartRes.status).toBe(200)
    const secondData = await secondStartRes.json()
    expect(secondData.job.captions.length).toBe(3)
    expect(mockTranscribeAudioFile).toHaveBeenCalledTimes(1) // 増えていない
  })

  it('Whisper API呼び出し自体が失敗した場合、captionsは保存されずジョブはfailedになる', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()

    mockTranscribeAudioFile.mockRejectedValueOnce(new Error('OpenAI APIエラー: boom'))

    await fetch(`${baseUrl}/${job.id}/start-processing`, { method: 'POST' })
    const failed = await waitForJob(job.id, (j) => j.status === 'failed')
    expect(failed.captions.length).toBe(0)
    expect(failed.transcribedAt).toBeNull()

    const audioPath = resolve(tmpRoot, `${job.id}.mp3`)
    expect(existsSync(audioPath)).toBe(false)
  })

  it('Whisper成功後のジョブJSON保存が失敗した場合、完了扱い(ready_for_edit)にはならずfailedになる', async () => {
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: resolve(inputRoot, 'sample.mp4') }),
    })
    const { job } = await createRes.json()

    mockTranscribeAudioFile.mockResolvedValueOnce([{ startSec: 0, endSec: 1, text: 'テスト' }])

    // 文字起こし成功直後の「保存」呼び出し1回だけをピンポイントで失敗させる
    // （ディスクフル等、書き込みそのものが失敗するケースの再現）
    const originalSave = JobStore.prototype.save
    let triggered = false
    const saveSpy = vi.spyOn(JobStore.prototype, 'save').mockImplementation(function (j) {
      if (!triggered && j.transcribedAt) {
        triggered = true
        throw new Error('simulated disk full during save')
      }
      return originalSave.call(this, j)
    })

    try {
      await fetch(`${baseUrl}/${job.id}/start-processing`, { method: 'POST' })
      const failed = await waitForJob(job.id, (j) => j.status === 'failed')
      expect(failed.captions.length).toBe(0)
      expect(failed.transcribedAt).toBeNull()
    } finally {
      saveSpy.mockRestore()
    }
  })
})
