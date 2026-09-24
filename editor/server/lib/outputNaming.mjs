// レンダー出力ファイル名の生成。
// 入力パスと衝突しない・既存ファイルを黙って上書きしないユニークな名前を作る。

import { existsSync, realpathSync } from 'fs'
import { resolve, extname, basename } from 'path'
import { randomBytes } from 'crypto'

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * @param {string} sourceFilename 元動画のファイル名（拡張子込み）
 * @param {string} outputRootRealPath 検証済みの出力先ディレクトリ（realpath）
 * @param {string} sourceRealPath 検証済みの元動画パス（realpath, 衝突防止用）
 * @param {Date} [now]
 * @returns {string} 出力先のフルパス（衝突しない・実在しないことを保証）
 */
export function buildUniqueOutputPath(sourceFilename, outputRootRealPath, sourceRealPath, now = new Date()) {
  const origName = basename(sourceFilename, extname(sourceFilename))
  const timestamp = formatTimestamp(now)
  let candidateName = `${origName}_captioned_${timestamp}.mp4`
  let candidatePath = resolve(outputRootRealPath, candidateName)

  const collides = (p) => {
    if (existsSync(p)) return true
    try {
      // シンボリックリンク等で元動画と同一実体を指してしまうケースも防ぐ
      if (existsSync(sourceRealPath) && realpathSync(p) === sourceRealPath) return true
    } catch {
      // p が存在しない場合は realpathSync が失敗するのでここに来て問題ない
    }
    return false
  }

  let guard = 0
  while (collides(candidatePath) && guard < 20) {
    const suffix = randomBytes(3).toString('hex')
    candidateName = `${origName}_captioned_${timestamp}_${suffix}.mp4`
    candidatePath = resolve(outputRootRealPath, candidateName)
    guard += 1
  }

  if (collides(candidatePath)) {
    throw new Error('出力ファイル名の決定に失敗しました（衝突が解消できません）')
  }

  if (candidatePath === sourceRealPath) {
    throw new Error('出力パスが入力パスと一致しています（安全のため拒否）')
  }

  return candidatePath
}

/**
 * 短時間プレビュー用の出力ファイル名を作る。要件により元動画名(sourceFilename)を
 * 一切含めない（jobIdの先頭部分とタイムスタンプのみ使う）。
 *
 * @param {string} jobId
 * @param {string} outputRootRealPath 検証済みの出力先ディレクトリ（realpath）
 * @param {string} sourceRealPath 検証済みの元動画パス（衝突防止用）
 * @param {Date} [now]
 * @returns {string}
 */
export function buildPreviewOutputPath(jobId, outputRootRealPath, sourceRealPath, now = new Date()) {
  const shortJobId = String(jobId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'job'
  const timestamp = formatTimestamp(now)
  let candidateName = `preview_${shortJobId}_${timestamp}.mp4`
  let candidatePath = resolve(outputRootRealPath, candidateName)

  const collides = (p) => {
    if (existsSync(p)) return true
    try {
      if (existsSync(sourceRealPath) && realpathSync(p) === sourceRealPath) return true
    } catch {
      // pが存在しない場合はrealpathSyncが失敗するのでここに来て問題ない
    }
    return false
  }

  let guard = 0
  while (collides(candidatePath) && guard < 20) {
    const suffix = randomBytes(3).toString('hex')
    candidateName = `preview_${shortJobId}_${timestamp}_${suffix}.mp4`
    candidatePath = resolve(outputRootRealPath, candidateName)
    guard += 1
  }

  if (collides(candidatePath)) {
    throw new Error('プレビュー出力ファイル名の決定に失敗しました（衝突が解消できません）')
  }
  if (candidatePath === sourceRealPath) {
    throw new Error('出力パスが入力パスと一致しています（安全のため拒否）')
  }

  return candidatePath
}

export const COMPARISON_KINDS = ['legacy', 'semantic', 'natural_timing', 'large_caption_topic', 'mobile_large_text']

/**
 * 旧方式/新方式の比較検証用動画の出力ファイル名を作る。
 * `comparison_<kind>_<timestamp>.mp4`。元動画名は含めず、既存ファイルを上書きしない。
 *
 * @param {'legacy' | 'semantic' | 'natural_timing' | 'large_caption_topic' | 'mobile_large_text'} kind
 * @param {string} outputRootRealPath 検証済みの出力先ディレクトリ（realpath）
 * @param {string} sourceRealPath 検証済みの元動画パス（衝突防止用）
 * @param {Date} [now]
 * @returns {string}
 */
export function buildComparisonOutputPath(kind, outputRootRealPath, sourceRealPath, now = new Date()) {
  if (!COMPARISON_KINDS.includes(kind)) throw new Error('比較動画の種別が不正です')
  const timestamp = formatTimestamp(now)
  const collides = (p) => {
    if (existsSync(p)) return true
    try {
      if (existsSync(sourceRealPath) && realpathSync(p) === sourceRealPath) return true
    } catch {
      // p が存在しない場合は realpathSync が失敗するのでここに来て問題ない
    }
    return false
  }
  let candidatePath = resolve(outputRootRealPath, `comparison_${kind}_${timestamp}.mp4`)
  let guard = 0
  while (collides(candidatePath) && guard < 20) {
    candidatePath = resolve(outputRootRealPath, `comparison_${kind}_${timestamp}_${randomBytes(3).toString('hex')}.mp4`)
    guard += 1
  }
  if (collides(candidatePath)) throw new Error('比較動画の出力ファイル名の決定に失敗しました（衝突が解消できません）')
  if (candidatePath === sourceRealPath) throw new Error('出力パスが入力パスと一致しています（安全のため拒否）')
  return candidatePath
}
