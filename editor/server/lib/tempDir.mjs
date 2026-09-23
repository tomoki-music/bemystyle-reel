// ローカルAIテロップ動画: 一時ディレクトリの作成と確実な削除。
//
// 一時音声・一時ASS・一時JSON は必ずここで作った一時ディレクトリに置き、
// 成功・失敗・例外のどの場合でも finally で削除する。

import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'

/**
 * 一時ディレクトリを作り、fn 終了後（例外時も）必ず削除する。
 *
 * @template T
 * @param {string} prefix
 * @param {(dir: string) => Promise<T> | T} fn
 * @param {{ baseDir?: string }} [options]
 * @returns {Promise<{ result: T, removed: boolean }>} removed: 終了後にディレクトリが存在しないこと
 */
export async function withTempDir(prefix, fn, options = {}) {
  const dir = mkdtempSync(join(options.baseDir ?? os.tmpdir(), prefix))
  let outcome
  try {
    outcome = await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { result: outcome, removed: !existsSync(dir) }
}
