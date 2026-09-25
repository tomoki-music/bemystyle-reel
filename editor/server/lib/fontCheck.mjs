// レンダー開始前の日本語フォント有無チェック（ベストエフォート）。
//
// `fc-list` が存在しない macOS 環境もあるため、spawn が失敗した場合や
// 非ゼロ終了した場合は「unknown（判定不能、警告のみで続行）」として扱い、
// ハードエラーにはしない。argv 形式の spawn のみを使用し、シェル文字列は使わない。
//
// テストでは spawn を直接モックせず、依存性注入（第1引数 deps.spawnFn）で
// フェイクに差し替える。

import { spawn as realSpawn } from 'child_process'

/**
 * @param {{ spawnFn?: typeof realSpawn }} [deps]
 * @returns {Promise<{ status: 'available' | 'missing' | 'unknown', detail?: string }>}
 */
export function checkJapaneseFontAvailable(deps = {}) {
  const spawnFn = deps.spawnFn ?? realSpawn
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawnFn('fc-list', [':lang=ja'])
    } catch {
      resolvePromise({ status: 'unknown', detail: 'fc-list を起動できませんでした' })
      return
    }
    let out = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.on('error', () => {
      finish({ status: 'unknown', detail: 'fc-list が見つかりません（このマシンには未インストールの可能性があります）' })
    })
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ status: 'unknown', detail: `fc-list が終了コード ${code} で終了しました` })
        return
      }
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
      finish(lines.length > 0
        ? { status: 'available', detail: `${lines.length} 件の日本語対応フォントを検出しました` }
        : { status: 'missing', detail: '日本語対応フォントが見つかりませんでした' })
    })
  })
}
