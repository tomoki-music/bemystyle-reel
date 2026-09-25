import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { runFfprobe, extractAudio, extractAudioSegmentWav, burnCaptions, renderPreviewClip } from './ffmpegRunner.mjs'

// vi.mock による child_process の丸ごと差し替えは、このプロジェクトの
// vitest/vite-node 環境では組み込みモジュールに対して確実に効かないことが
// 確認できたため（実際の ffmpeg/ffprobe が起動してしまう）、各関数が受け付ける
// `spawnFn` 依存性注入を使ってフェイクを渡す方式でテストする。

const mockSpawn = vi.fn()

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
    this.killed = false
  }
  kill(signal) {
    this.killed = true
    this.lastSignal = signal
  }
}

beforeEach(() => {
  mockSpawn.mockReset()
  delete process.env.FFMPEG_BIN
  delete process.env.FFPROBE_BIN
})

describe('FFMPEG_BIN / FFPROBE_BIN による実行バイナリの差し替え', () => {
  it('環境変数が無ければ従来どおり "ffmpeg" / "ffprobe" を使う', async () => {
    const child1 = new FakeChild()
    mockSpawn.mockImplementation((cmd) => {
      expect(cmd).toBe('ffprobe')
      return child1
    })
    const p1 = runFfprobe('/videos/in.mp4', { spawnFn: mockSpawn })
    child1.emit('close', 1)
    await expect(p1).rejects.toThrow()

    const child2 = new FakeChild()
    mockSpawn.mockImplementation((cmd) => {
      expect(cmd).toBe('ffmpeg')
      return child2
    })
    const p2 = extractAudio('/videos/in.mp4', '/tmp/out.mp3', { spawnFn: mockSpawn })
    child2.emit('close', 0)
    await p2
  })

  it('FFMPEG_BIN / FFPROBE_BIN を設定すると、そのパスで実行される（libass入りビルドへの切り替え用）', async () => {
    process.env.FFMPEG_BIN = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
    process.env.FFPROBE_BIN = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe'

    const child1 = new FakeChild()
    mockSpawn.mockImplementation((cmd) => {
      expect(cmd).toBe('/opt/homebrew/opt/ffmpeg-full/bin/ffprobe')
      return child1
    })
    const p1 = runFfprobe('/videos/in.mp4', { spawnFn: mockSpawn })
    child1.emit('close', 1)
    await expect(p1).rejects.toThrow()

    const child2 = new FakeChild()
    mockSpawn.mockImplementation((cmd) => {
      expect(cmd).toBe('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg')
      return child2
    })
    const p2 = burnCaptions({ sourceRealPath: '/videos/in.mp4', assPath: '/tmp/x.ass', outputPath: '/out/o.mp4', durationSec: 10, spawnFn: mockSpawn })
    child2.emit('close', 0)
    await p2
  })
})

describe('runFfprobe', () => {
  it('正常終了時にメタデータを解決する', async () => {
    const child = new FakeChild()
    mockSpawn.mockImplementation((cmd, args) => {
      expect(cmd).toBe('ffprobe')
      expect(args).toContain('/videos/in.mp4')
      // shell:true を使っていないことの確認（argv配列であること）
      expect(Array.isArray(args)).toBe(true)
      return child
    })

    const promise = runFfprobe('/videos/in.mp4', { spawnFn: mockSpawn })
    const json = JSON.stringify({
      format: { duration: '10', format_name: 'mp4' },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 100, height: 200, duration: '10' }],
    })
    child.stdout.emit('data', Buffer.from(json))
    child.emit('close', 0)

    const result = await promise
    expect(result.width).toBe(100)
    expect(result.height).toBe(200)
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('非ゼロ終了コードで失敗する', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runFfprobe('/videos/in.mp4', { spawnFn: mockSpawn })
    child.stderr.emit('data', Buffer.from('boom'))
    child.emit('close', 1)
    await expect(promise).rejects.toThrow(/ffprobeが終了コード1.*boom/)
  })

  it('spawn自体が失敗した場合も拒否する', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runFfprobe('/videos/in.mp4', { spawnFn: mockSpawn })
    child.emit('error', new Error('not found'))
    await expect(promise).rejects.toThrow(/ffprobe起動エラー/)
  })
})

describe('extractAudio', () => {
  it('argv形式でffmpegを呼び、成功時にresolveする', async () => {
    const child = new FakeChild()
    mockSpawn.mockImplementation((cmd, args) => {
      expect(cmd).toBe('ffmpeg')
      expect(args).toEqual([
        '-y', '-i', '/videos/in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3', '/tmp/out.mp3',
      ])
      return child
    })
    const promise = extractAudio('/videos/in.mp4', '/tmp/out.mp3', { spawnFn: mockSpawn })
    child.emit('close', 0)
    await expect(promise).resolves.toBeUndefined()
  })

  it('失敗時にreject する', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = extractAudio('/videos/in.mp4', '/tmp/out.mp3', { spawnFn: mockSpawn })
    child.emit('close', 1)
    await expect(promise).rejects.toThrow(/音声抽出に失敗/)
  })
})

describe('burnCaptions', () => {
  it('progressコールバックが呼ばれ、成功時にresolveする', async () => {
    const child = new FakeChild()
    mockSpawn.mockImplementation((cmd, args) => {
      expect(cmd).toBe('ffmpeg')
      expect(args).toContain('-vf')
      const vfIndex = args.indexOf('-vf')
      expect(args[vfIndex + 1]).toMatch(/^ass=/)
      // 独自のtranspose/rotateフィルタを追加していないこと
      expect(args[vfIndex + 1]).not.toMatch(/transpose|rotate/)
      return child
    })
    const progresses = []
    let spawnedChild = null
    const promise = burnCaptions({
      sourceRealPath: '/videos/in.mp4',
      assPath: '/tmp/x.ass',
      outputPath: '/out/result.mp4',
      durationSec: 10,
      onProgress: (p) => progresses.push(p),
      onSpawn: (c) => { spawnedChild = c },
      spawnFn: mockSpawn,
    })
    expect(spawnedChild).toBe(child)
    child.stdout.emit('data', Buffer.from('out_time=00:00:05.000000\n'))
    child.emit('close', 0)
    await promise
    expect(progresses).toContain(50)
    expect(progresses[progresses.length - 1]).toBe(100)
  })

  it('SIGTERMでキャンセルされた場合はcanceled=trueのエラーでrejectする', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = burnCaptions({
      sourceRealPath: '/videos/in.mp4',
      assPath: '/tmp/x.ass',
      outputPath: '/out/result.mp4',
      durationSec: 10,
      spawnFn: mockSpawn,
    })
    child.emit('close', null, 'SIGTERM')
    await expect(promise).rejects.toMatchObject({ canceled: true })
  })

  it('失敗時（シグナルなし）はcanceledフラグを立てずにrejectする', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = burnCaptions({
      sourceRealPath: '/videos/in.mp4',
      assPath: '/tmp/x.ass',
      outputPath: '/out/result.mp4',
      durationSec: 10,
      spawnFn: mockSpawn,
    })
    child.emit('close', 1, null)
    await expect(promise).rejects.toThrow(/レンダーに失敗しました/)
    try {
      await promise
      expect.unreachable()
    } catch (err) {
      expect(err.canceled).toBeFalsy()
    }
  })
})

describe('renderPreviewClip', () => {
  it('argvで -ss を -i より前に、-t で区間長を指定してffmpegを呼ぶ(shell文字列連結ではない)', async () => {
    const child = new FakeChild()
    mockSpawn.mockImplementation((cmd, args) => {
      expect(cmd).toBe('ffmpeg')
      expect(Array.isArray(args)).toBe(true)
      const ssIndex = args.indexOf('-ss')
      const iIndex = args.indexOf('-i')
      const tIndex = args.indexOf('-t')
      expect(ssIndex).toBeGreaterThanOrEqual(0)
      expect(iIndex).toBeGreaterThan(ssIndex) // -ss は -i より前(高速シーク)
      expect(args[ssIndex + 1]).toBe('120')
      expect(args[tIndex + 1]).toBe('45')
      expect(args[iIndex + 1]).toBe('/videos/in.mp4')
      const vfIndex = args.indexOf('-vf')
      expect(args[vfIndex + 1]).toMatch(/^ass=/)
      return child
    })
    const promise = renderPreviewClip({
      sourceRealPath: '/videos/in.mp4',
      assPath: '/tmp/preview.ass',
      outputPath: '/out/preview.mp4',
      startSec: 120,
      clipDurationSec: 45,
      spawnFn: mockSpawn,
    })
    child.emit('close', 0)
    await expect(promise).resolves.toBeUndefined()
  })

  it('失敗時にrejectする', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = renderPreviewClip({
      sourceRealPath: '/videos/in.mp4',
      assPath: '/tmp/preview.ass',
      outputPath: '/out/preview.mp4',
      startSec: 0,
      clipDurationSec: 30,
      spawnFn: mockSpawn,
    })
    child.emit('close', 1, null)
    await expect(promise).rejects.toThrow(/プレビューの生成に失敗/)
  })

  it('負のstartSecは0にクランプする', async () => {
    const child = new FakeChild()
    mockSpawn.mockImplementation((cmd, args) => {
      const ssIndex = args.indexOf('-ss')
      expect(args[ssIndex + 1]).toBe('0')
      return child
    })
    const promise = renderPreviewClip({
      sourceRealPath: '/videos/in.mp4',
      assPath: '/tmp/preview.ass',
      outputPath: '/out/preview.mp4',
      startSec: -5,
      clipDurationSec: 30,
      spawnFn: mockSpawn,
    })
    child.emit('close', 0)
    await promise
  })
})

describe('extractAudioSegmentWav (区間音声の抽出)', () => {
  it('argv配列で -ss/-t/16kHz mono PCM を指定し、元動画は入力(-i)として読むだけ', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    process.env.FFMPEG_BIN = '/opt/ffmpeg-full/bin/ffmpeg'
    const p = extractAudioSegmentWav('/videos/in.mp4', '/tmp/x/clip.wav', 671.48, 60, { spawnFn: mockSpawn })
    child.emit('close', 0)
    await p
    const [cmd, args, opts] = mockSpawn.mock.calls[0]
    expect(cmd).toBe('/opt/ffmpeg-full/bin/ffmpeg')
    expect(Array.isArray(args)).toBe(true)
    expect(opts?.shell).toBeUndefined()
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '671.48'])
    expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '60'])
    expect(args).toEqual(expect.arrayContaining(['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le']))
    expect(args[args.indexOf('-i') + 1]).toBe('/videos/in.mp4')
    expect(args[args.length - 1]).toBe('/tmp/x/clip.wav')
    // 出力先は入力と別ファイル（元動画を書き換えない）
    expect(args.filter((a) => a === '/videos/in.mp4')).toHaveLength(1)
  })

  it('ffmpegが失敗したらエラー', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const p = extractAudioSegmentWav('/videos/in.mp4', '/tmp/x/clip.wav', 0, 60, { spawnFn: mockSpawn })
    child.emit('close', 1)
    await expect(p).rejects.toThrow('区間音声の抽出に失敗')
  })
})
