// ローカルAIテロップ動画: whisper.cpp (whisper-cli) を使ったローカル文字起こし・時刻取得。
//
// - 外部AI API(OpenAI等)は一切呼ばない。ローカルのwhisper-cliを argv 配列(shell:false)で起動する。
// - 使うオプションは `whisper-cli --help` (v1.9.4) に実在するものだけ。
// - DTW(--dtw)によるトークン時刻は flash attention 無効(-nfa)のときのみ有効になる。
// - テスト容易性のため spawnFn を注入できる（実プロセスを起動せず検証するため）。

import { spawn as realSpawn } from 'child_process'
import { readFileSync } from 'fs'

export const DEFAULT_DTW_PRESET = 'large.v3.turbo'
// 句読点付きの出力を促す中立的な初期プロンプト（動画の内容には依存しない）。
export const PUNCTUATION_PROMPT = 'こんにちは。今日は、いい天気ですね。それでは、始めましょう。'

export function getWhisperBin() {
  const v = process.env.WHISPER_CLI_BIN
  return typeof v === 'string' && v.trim() ? v.trim() : 'whisper-cli'
}

/**
 * whisper-cli の引数配列を組み立てる（純粋関数）。
 * @param {{
 *   modelPath: string, audioPath: string, outputBase: string,
 *   language?: string, threads?: number, useDtw?: boolean, dtwPreset?: string,
 *   vadModelPath?: string | null, prompt?: string | null, quiet?: boolean,
 * }} p
 * @returns {string[]}
 */
export function buildWhisperArgs(p) {
  const args = [
    '-m', p.modelPath,
    '-f', p.audioPath,
    '-l', p.language ?? 'ja',
    '-ojf',
    '-of', p.outputBase,
    '-t', String(p.threads ?? 8),
  ]
  // -np はVAD区間ログ(stderr)まで抑制するため、VAD区間数を取得したい実行では付けない。
  if (p.quiet !== false) args.push('-np')
  if (p.useDtw !== false) args.push('-dtw', p.dtwPreset ?? DEFAULT_DTW_PRESET, '-nfa')
  if (p.vadModelPath) args.push('--vad', '-vm', p.vadModelPath)
  if (p.prompt) args.push('--prompt', p.prompt)
  return args
}

/**
 * whisper-cli を実行する。
 * @returns {Promise<{ elapsedMs: number, vadSegments: Array<{ startSec: number, endSec: number }>, maxRssBytes: number | null }>}
 *   maxRssBytes: `/usr/bin/time -l` 経由で起動した場合の子プロセス最大メモリ(bytes)。取得できなければ null。
 */
export function runWhisperCli(args, { spawnFn = realSpawn, timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now()
    let stderr = ''
    let timedOut = false
    const child = spawnFn(getWhisperBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`whisper-cli起動エラー: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error('whisper-cliがタイムアウトしました'))
      if (code !== 0) return reject(new Error(`whisper-cliが終了コード${code}で失敗しました`))
      resolvePromise({ elapsedMs: Date.now() - startedAt, vadSegments: parseVadSegmentsFromLog(stderr), maxRssBytes: parseMaxRssFromTimeLog(stderr) })
    })
  })
}

/** macOS の `/usr/bin/time -l` が出す "N  maximum resident set size"（bytes）を取り出す。無ければ null。 */
export function parseMaxRssFromTimeLog(log) {
  const m = /(\d+)\s+maximum resident set size/.exec(log ?? '')
  return m ? Number(m[1]) : null
}

/** stderr の "VAD segment N: start = X, end = Y" 行を解析する。 */
export function parseVadSegmentsFromLog(log) {
  const out = []
  const re = /VAD segment \d+: start = ([\d.]+), end = ([\d.]+)/g
  let m
  while ((m = re.exec(log)) !== null) out.push({ startSec: Number(m[1]), endSec: Number(m[2]) })
  return out
}

/**
 * whisper-cli の -ojf JSON をアプリ内表現へ変換する。
 * - 特殊トークン([_BEG_]等)は除外。
 * - DTW時刻(t_dtw, 10ms単位)が有効なトークンのみ tokens に入れる。
 *
 * @param {object} json
 * @returns {{
 *   segments: Array<{ startSec: number, endSec: number, text: string }>,
 *   tokens: Array<{ text: string, startSec: number, endSec: number, p: number, segmentIndex: number }>,
 *   tokenCountTotal: number,
 * }}
 */
export function parseWhisperJson(json) {
  const segments = []
  const tokens = []
  let tokenCountTotal = 0
  const list = Array.isArray(json?.transcription) ? json.transcription : []
  list.forEach((seg, segmentIndex) => {
    const startSec = (seg.offsets?.from ?? 0) / 1000
    const endSec = (seg.offsets?.to ?? 0) / 1000
    segments.push({ startSec, endSec, text: typeof seg.text === 'string' ? seg.text : '' })
    const segTokens = Array.isArray(seg.tokens) ? seg.tokens : []
    const text = segTokens.filter((t) => typeof t.text === 'string' && !/^\[_.*_?\d*\]$/.test(t.text))
    tokenCountTotal += text.length
    text.forEach((t, i) => {
      if (!Number.isFinite(t.t_dtw) || t.t_dtw < 0) return
      const start = t.t_dtw / 100
      const next = text.slice(i + 1).find((x) => Number.isFinite(x.t_dtw) && x.t_dtw >= 0)
      const end = next ? next.t_dtw / 100 : endSec
      tokens.push({ text: t.text, startSec: start, endSec: Math.max(start, end), p: t.p ?? 0, segmentIndex })
    })
  })
  return { segments, tokens, tokenCountTotal }
}

export function readWhisperJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}
