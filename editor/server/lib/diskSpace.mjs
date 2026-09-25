// レンダー開始前の空き容量チェック。
//
// Node の `fs.statfsSync` は v18.15 / v19.6 以降でのみ利用可能。このプロジェクトの
// 開発機は `node -v` で v16.20.2 だったため（2026-09時点、実行時に再確認済み）、
// 実行時に statfsSync の有無を判定し、無ければ `df -k` にフォールバックする
// （ベストエフォート。どちらも失敗した場合は null を返し、呼び出し側は
// 「不明として警告付きで進める」扱いにする）。
//
// テストでは spawn を直接モックせず、依存性注入（第3引数 deps.spawnFn /
// deps.statfsSyncFn）でフェイクに差し替える（vi.mock による組み込みモジュール
// 差し替えが環境依存で効かないケースがあったため、より確実なこの方式を採用）。

import { spawn as realSpawn } from 'child_process'
import * as nodeFs from 'fs'

/**
 * @param {string} targetPath 空き容量を調べたいパス（ディレクトリ）
 * @param {{ spawnFn?: typeof realSpawn, statfsSyncFn?: typeof nodeFs.statfsSync }} [deps]
 * @returns {Promise<number | null>} 空きバイト数、判定不能なら null
 */
export async function getFreeBytes(targetPath, deps = {}) {
  const statfsSyncFn = deps.statfsSyncFn ?? nodeFs.statfsSync
  if (typeof statfsSyncFn === 'function') {
    try {
      const st = statfsSyncFn(targetPath)
      if (st && typeof st.bavail === 'number' && typeof st.bsize === 'number') {
        return st.bavail * st.bsize
      }
    } catch {
      // フォールバックへ
    }
  }
  return dfFreeBytes(targetPath, deps.spawnFn ?? realSpawn)
}

function dfFreeBytes(targetPath, spawnFn) {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    let child
    try {
      child = spawnFn('df', ['-k', targetPath])
    } catch {
      finish(null)
      return
    }
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code !== 0) return finish(null)
      try {
        const lines = out.trim().split('\n')
        const last = lines[lines.length - 1]
        const cols = last.trim().split(/\s+/)
        // macOS/Linux 共に df -k の第4カラムが Available (KB)
        const availableKb = Number(cols[3])
        finish(Number.isFinite(availableKb) ? availableKb * 1024 : null)
      } catch {
        finish(null)
      }
    })
  })
}

/**
 * 空き容量が見積もりに対して十分か判定する。
 *
 * @param {string} targetPath
 * @param {number} estimatedNeededBytes
 * @param {{ spawnFn?: typeof realSpawn, statfsSyncFn?: typeof nodeFs.statfsSync }} [deps]
 * @returns {Promise<{ ok: boolean, freeBytes: number | null, estimatedNeededBytes: number }>}
 */
export async function checkDiskSpace(targetPath, estimatedNeededBytes, deps = {}) {
  const freeBytes = await getFreeBytes(targetPath, deps)
  if (freeBytes === null) {
    // 判定不能: ベストエフォートのため進行を許可する（呼び出し側で警告扱い）
    return { ok: true, freeBytes: null, estimatedNeededBytes }
  }
  return { ok: freeBytes >= estimatedNeededBytes, freeBytes, estimatedNeededBytes }
}
