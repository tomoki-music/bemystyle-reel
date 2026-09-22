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
