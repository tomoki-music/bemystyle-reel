// ffprobe / ffmpeg を spawn (argv形式・shell:false) で呼び出すラッパー。
// シェル文字列連結は一切行わない。
//
// テスト容易性のため、各関数は第2引数に `{ spawnFn }` を受け付け、デフォルトは
// 本物の child_process.spawn を使う。ユニットテストではこの spawnFn に差し替えた
// フェイク実装を注入することで、実際の ffmpeg/ffprobe プロセスを一切起動せずに
// 検証する（vi.mock でNode組み込みモジュールを差し替える方式は環境によって
// 効かないことがあるため、依存性注入のほうが確実）。

import { spawn as realSpawn } from 'child_process'
import { statSync } from 'fs'
import { parseFfprobeOutput } from './ffprobeParser.mjs'
import { escapePathForFfmpegFilter } from './assText.mjs'

/**
 * ffprobe を実行し、正規化済みメタデータを返す。
 * @param {string} sourceRealPath 検証済み・realpath 済みの動画パス
 * @param {{ spawnFn?: typeof realSpawn }} [deps]
 */
export function runFfprobe(sourceRealPath, deps = {}) {
  const spawnFn = deps.spawnFn ?? realSpawn
  return new Promise((resolvePromise, reject) => {
    const child = spawnFn('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      sourceRealPath,
    ])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => reject(new Error(`ffprobe起動エラー: ${err.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobeが終了コード${code}で失敗しました: ${stderr.slice(0, 500)}`))
        return
      }
      try {
        resolvePromise(parseFfprobeOutput(stdout))
      } catch (err) {
        reject(err)
      }
    })
  })
}

/**
 * 動画から小さな音声ファイル（mono/16kHz/64kbps mp3）を抽出する。
 * 動画本体をコピーせず、ffmpeg に元パスを渡して直接読ませる。
 *
 * @param {string} sourceRealPath
 * @param {string} outAudioPath 一時ディレクトリ内の出力先
 * @param {{ spawnFn?: typeof realSpawn }} [deps]
 */
export function extractAudio(sourceRealPath, outAudioPath, deps = {}) {
  const spawnFn = deps.spawnFn ?? realSpawn
  return new Promise((resolvePromise, reject) => {
    const child = spawnFn('ffmpeg', [
      '-y',
      '-i', sourceRealPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      '-f', 'mp3',
      outAudioPath,
    ])
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => reject(new Error(`ffmpeg(音声抽出)起動エラー: ${err.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`音声抽出に失敗しました（ffmpeg終了コード${code}）: ${stderr.slice(0, 500)}`))
        return
      }
      resolvePromise()
    })
  })
}

/**
 * 字幕焼き込みレンダリングを開始する。ffmpeg プロセス自体を返すので、
 * 呼び出し側でキャンセル（SIGTERM/SIGKILL）できる。
 *
 * 回転補正済みの表示サイズを使うため、-vf には ass=<path> のみを指定し、
 * 独自の transpose/rotate フィルタは付与しない（mov/mp4 デマルチプレクサが
 * 自動的に回転を適用済みのため、二重回転を防ぐ）。
 *
 * @param {{
 *   sourceRealPath: string,
 *   assPath: string,
 *   outputPath: string,
 *   durationSec: number,
 *   onProgress?: (percent: number) => void,
 *   onSpawn?: (child: import('child_process').ChildProcess) => void,
 *   spawnFn?: typeof realSpawn,
 * }} params
 * @returns {Promise<void>}
 */
export function burnCaptions({ sourceRealPath, assPath, outputPath, durationSec, onProgress, onSpawn, spawnFn }) {
  const doSpawn = spawnFn ?? realSpawn
  return new Promise((resolvePromise, reject) => {
    const escapedAssPath = escapePathForFfmpegFilter(assPath)
    const child = doSpawn('ffmpeg', [
      '-y',
      '-i', sourceRealPath,
      '-vf', `ass=${escapedAssPath}`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-nostats',
      outputPath,
    ])

    if (typeof onSpawn === 'function') onSpawn(child)

    let stderr = ''
    let stdoutBuf = ''
    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        // ffmpeg -progress の `out_time_ms` はバージョンによって実際には
        // マイクロ秒単位になっている既知の癖があり紛らわしいため、
        // 代わりに曖昧さのない `out_time=HH:MM:SS.ffffff` 行を使う。
        const m = line.match(/^out_time=(\d+):(\d{2}):(\d{2})\.(\d+)$/)
        if (m && durationSec > 0 && typeof onProgress === 'function') {
          const hours = Number(m[1])
          const minutes = Number(m[2])
          const secs = Number(m[3])
          const frac = Number(`0.${m[4]}`)
          const outTimeSec = hours * 3600 + minutes * 60 + secs + frac
          const percent = Math.min(100, Math.max(0, (outTimeSec / durationSec) * 100))
          onProgress(percent)
        }
      }
    })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => reject(new Error(`ffmpeg(レンダー)起動エラー: ${err.message}`)))
    child.on('close', (code, signal) => {
      if (signal) {
        reject(Object.assign(new Error(`レンダーがシグナル${signal}で中断されました`), { canceled: true }))
        return
      }
      if (code !== 0) {
        reject(new Error(`レンダーに失敗しました（ffmpeg終了コード${code}）: ${stderr.slice(0, 500)}`))
        return
      }
      if (typeof onProgress === 'function') onProgress(100)
      resolvePromise()
    })
  })
}

/**
 * ファイルサイズ(bytes)取得のシンプルなヘルパー。
 * @param {string} path
 */
export function getFileSize(path) {
  return statSync(path).size
}
