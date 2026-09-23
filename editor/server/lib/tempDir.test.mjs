import { describe, it, expect } from 'vitest'
import { existsSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { withTempDir } from './tempDir.mjs'

describe('withTempDir', () => {
  it('成功時: 一時ファイル(音声/ASS/JSON)を含めてディレクトリごと削除される', async () => {
    let seen
    const { result, removed } = await withTempDir('lcv-test-', (dir) => {
      seen = dir
      writeFileSync(join(dir, 'clip.wav'), 'x')
      writeFileSync(join(dir, 'a.ass'), 'x')
      writeFileSync(join(dir, 'w.json'), '{}')
      expect(existsSync(join(dir, 'clip.wav'))).toBe(true)
      return 42
    })
    expect(result).toBe(42)
    expect(removed).toBe(true)
    expect(existsSync(seen)).toBe(false)
  })

  it('例外時も削除される（例外はそのまま伝わる）', async () => {
    let seen
    await expect(
      withTempDir('lcv-test-', (dir) => {
        seen = dir
        writeFileSync(join(dir, 'clip.wav'), 'x')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(existsSync(seen)).toBe(false)
  })

  it('指定した親ディレクトリ配下に作られ、リポジトリ外(os.tmpdir)が既定', async () => {
    const parent = realpathSync(mkdtempSync(join(os.tmpdir(), 'lcv-parent-')))
    try {
      let seen
      await withTempDir('lcv-x-', (dir) => { seen = dir }, { baseDir: parent })
      expect(seen.startsWith(parent)).toBe(true)
      await withTempDir('lcv-y-', (dir) => { expect(realpathSync(dir).startsWith(realpathSync(os.tmpdir()))).toBe(true) })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
