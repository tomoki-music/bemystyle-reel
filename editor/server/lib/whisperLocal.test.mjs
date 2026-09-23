import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { buildWhisperArgs, runWhisperCli, parseWhisperJson, parseVadSegmentsFromLog, PUNCTUATION_PROMPT } from './whisperLocal.mjs'

// whisper-cli 1.9.4 の --help に実在するオプションのみ（推測で指定していないことの検証用）
const HELP_OPTIONS = new Set([
  '-m', '-f', '-l', '-ojf', '-of', '-t', '-np', '-dtw', '-nfa', '--vad', '-vm', '--prompt',
])

describe('buildWhisperArgs', () => {
  const base = { modelPath: 'MODEL', audioPath: 'AUDIO', outputBase: 'OUT' }

  it('日本語・JSON(full)出力・DTW(flash attention無効)を指定する', () => {
    const a = buildWhisperArgs(base)
    expect(a).toEqual(expect.arrayContaining(['-m', 'MODEL', '-f', 'AUDIO', '-l', 'ja', '-ojf', '-of', 'OUT', '-dtw', 'large.v3.turbo', '-nfa']))
    expect(a).not.toContain('--vad')
  })

  it('VADモデルを渡したときだけ --vad -vm を付ける', () => {
    const a = buildWhisperArgs({ ...base, vadModelPath: 'VAD' })
    expect(a).toEqual(expect.arrayContaining(['--vad', '-vm', 'VAD']))
  })

  it('quiet=false では -np を付けない（VAD区間ログを取得するため）', () => {
    expect(buildWhisperArgs(base)).toContain('-np')
    expect(buildWhisperArgs({ ...base, quiet: false })).not.toContain('-np')
  })

  it('指定するオプションは --help に存在するものだけ（推測のオプションを使わない）', () => {
    const a = buildWhisperArgs({ ...base, vadModelPath: 'VAD', prompt: PUNCTUATION_PROMPT })
    const flags = a.filter((x) => x.startsWith('-'))
    for (const f of flags) expect(HELP_OPTIONS.has(f)).toBe(true)
  })

  it('外部AI API/ネットワーク関連の引数を含まない', () => {
    const a = buildWhisperArgs({ ...base, vadModelPath: 'VAD' }).join(' ')
    expect(a).not.toMatch(/openai|api[-_]?key|https?:\/\//i)
  })
})

function fakeSpawn({ code = 0, stderr = '', neverClose = false } = {}) {
  const calls = []
  const fn = (bin, args, opts) => {
    calls.push({ bin, args, opts })
    const child = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => child.emit('close', null))
    if (!neverClose) {
      setTimeout(() => {
        if (stderr) child.stderr.emit('data', Buffer.from(stderr))
        child.emit('close', code)
      }, 0)
    }
    return child
  }
  return { fn, calls }
}

describe('runWhisperCli', () => {
  it('argv配列で起動し(shell:falseの既定)、VAD区間ログを解析して返す', async () => {
    const { fn, calls } = fakeSpawn({ stderr: 'whisper_vad_segments_from_probs: VAD segment 0: start = 0.13, end = 1.82 (duration: 1.69)\nVAD segment 1: start = 1.9, end = 60.00 (duration: 58.1)' })
    const r = await runWhisperCli(['-m', 'x'], { spawnFn: fn })
    expect(Array.isArray(calls[0].args)).toBe(true)
    expect(calls[0].opts?.shell).toBeUndefined()
    expect(r.vadSegments).toEqual([{ startSec: 0.13, endSec: 1.82 }, { startSec: 1.9, endSec: 60 }])
  })

  it('非0終了コードはエラー(パスや本文を含めない)', async () => {
    const { fn } = fakeSpawn({ code: 3, stderr: 'secret /fake-root/secret-dir' })
    const err = await runWhisperCli(['-m', 'x'], { spawnFn: fn }).catch((e) => e)
    expect(err.message).toContain('終了コード3')
    expect(err.message).not.toContain('fake-root')
  })

  it('タイムアウトでプロセスを強制終了する', async () => {
    const { fn } = fakeSpawn({ neverClose: true })
    await expect(runWhisperCli(['-m', 'x'], { spawnFn: fn, timeoutMs: 20 })).rejects.toThrow('タイムアウト')
  })
})

describe('parseVadSegmentsFromLog', () => {
  it('ログから区間を取り出す。無ければ空配列', () => {
    expect(parseVadSegmentsFromLog('')).toEqual([])
    expect(parseVadSegmentsFromLog('VAD segment 3: start = 1.5, end = 2.5 (duration: 1.0)')).toEqual([{ startSec: 1.5, endSec: 2.5 }])
  })
})

describe('parseWhisperJson', () => {
  const json = {
    transcription: [
      {
        offsets: { from: 130, to: 4080 },
        text: ' こんにちは。',
        tokens: [
          { text: '[_BEG_]', t_dtw: -1, p: 1 },
          { text: 'こん', t_dtw: 20, p: 0.9 },
          { text: 'にちは', t_dtw: 60, p: 0.9 },
          { text: '。', t_dtw: 120, p: 0.9 },
          { text: '[_TT_204]', t_dtw: -1, p: 0.5 },
        ],
      },
      { offsets: { from: 4300, to: 5000 }, text: '世界', tokens: [{ text: '世界', t_dtw: -1, p: 1 }] },
    ],
  }

  it('特殊トークンとDTW時刻なしのトークンを除き、t_dtw(10ms単位)を秒へ変換する', () => {
    const r = parseWhisperJson(json)
    expect(r.segments).toHaveLength(2)
    expect(r.segments[0]).toMatchObject({ startSec: 0.13, endSec: 4.08 })
    expect(r.tokens.map((t) => t.text)).toEqual(['こん', 'にちは', '。'])
    expect(r.tokens[0]).toMatchObject({ startSec: 0.2, endSec: 0.6 })
    expect(r.tokens[1]).toMatchObject({ startSec: 0.6, endSec: 1.2 })
    // セグメント最後のトークンの終了はセグメント終了
    expect(r.tokens[2].endSec).toBeCloseTo(4.08)
    expect(r.tokenCountTotal).toBe(4)
  })

  it('空・不正なJSONでも例外にならない', () => {
    expect(parseWhisperJson({})).toEqual({ segments: [], tokens: [], tokenCountTotal: 0 })
    expect(parseWhisperJson(null).tokens).toEqual([])
  })
})
