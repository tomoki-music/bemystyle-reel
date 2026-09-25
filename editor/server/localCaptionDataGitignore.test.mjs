// ローカルAIテロップ動画機能が生成するジョブJSON（Whisper文字起こし結果を含む）と
// APIキーを含む editor/.env が、誤ってGit管理下に入らないことを検証する。
// 実際の .gitignore ルールに対して `git check-ignore` を使って機械的に確認する。

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// editor/server -> editor -> リポジトリルート
const REPO_ROOT = resolve(__dirname, '../..')

function isIgnored(relativePathFromRepoRoot) {
  try {
    execFileSync('git', ['check-ignore', '-q', relativePathFromRepoRoot], { cwd: REPO_ROOT })
    return true
  } catch (err) {
    if (typeof err.status === 'number' && err.status === 1) return false
    throw err
  }
}

describe('ローカルAIテロップのジョブデータ・envファイルがGit管理対象外であること', () => {
  it('editor/data/local_caption_videos 配下のジョブJSONはgitignore対象', () => {
    expect(isIgnored('editor/data/local_caption_videos/example-job.json')).toBe(true)
  })

  it('editor/data 配下全般もgitignore対象（他の生成データも含めて誤コミット防止）', () => {
    expect(isIgnored('editor/data/anything.json')).toBe(true)
  })

  it('editor/.env はgitignore対象', () => {
    expect(isIgnored('editor/.env')).toBe(true)
  })
})
