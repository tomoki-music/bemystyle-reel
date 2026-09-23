import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { buildUniqueOutputPath, buildPreviewOutputPath } from './outputNaming.mjs'

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'outputnaming-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('buildUniqueOutputPath', () => {
  it('タイムスタンプ付きのファイル名を生成する', () => {
    const sourceReal = resolve(dir, 'src.mp4')
    writeFileSync(sourceReal, 'x')
    const now = new Date('2024-05-01T12:34:56')
    const outputPath = buildUniqueOutputPath('my video.mp4', dir, sourceReal, now)
    expect(outputPath).toMatch(/my video_captioned_20240501_123456\.mp4$/)
  })

  it('既に同名ファイルが存在する場合はランダムサフィックスを付与する', () => {
    const sourceReal = resolve(dir, 'src.mp4')
    writeFileSync(sourceReal, 'x')
    const now = new Date('2024-05-01T12:34:56')
    const collidingName = 'video_captioned_20240501_123456.mp4'
    writeFileSync(resolve(dir, collidingName), 'existing')
    const outputPath = buildUniqueOutputPath('video.mp4', dir, sourceReal, now)
    expect(outputPath).not.toBe(resolve(dir, collidingName))
    expect(outputPath).toMatch(/video_captioned_20240501_123456_[0-9a-f]{6}\.mp4$/)
  })

  it('自然生成される出力ファイル名がたまたま入力パスと同じ場所を指す場合、衝突検出により別名を生成する', () => {
    // 生成される候補名 "clash_captioned_20240101_000000.mp4" の位置に
    // 偶然「元動画そのもの」が既に存在しているという極端なケースを再現する。
    const now = new Date('2024-01-01T00:00:00')
    const sourceReal = resolve(dir, 'clash_captioned_20240101_000000.mp4')
    writeFileSync(sourceReal, 'original video bytes')
    const outputPath = buildUniqueOutputPath('clash.mp4', dir, sourceReal, now)
    expect(outputPath).not.toBe(sourceReal)
  })
})

describe('buildPreviewOutputPath', () => {
  it('元動画名を一切含まないファイル名を生成する', () => {
    const sourceReal = resolve(dir, 'なぜバンドメンバーは脱退するのか？.mov')
    writeFileSync(sourceReal, 'x')
    const now = new Date('2024-05-01T12:34:56')
    const outputPath = buildPreviewOutputPath('e02f8191-d832-48d4-aa94-5c60b52c5aae', dir, sourceReal, now)
    expect(outputPath).toMatch(/preview_e02f8191_20240501_123456\.mp4$/)
    expect(outputPath).not.toContain('バンド')
  })

  it('衝突時はランダムサフィックスを付与する', () => {
    const sourceReal = resolve(dir, 'src.mov')
    writeFileSync(sourceReal, 'x')
    const now = new Date('2024-05-01T12:34:56')
    writeFileSync(resolve(dir, 'preview_abcd1234_20240501_123456.mp4'), 'existing')
    const outputPath = buildPreviewOutputPath('abcd1234-xxxx', dir, sourceReal, now)
    expect(outputPath).toMatch(/preview_abcd1234_20240501_123456_[0-9a-f]{6}\.mp4$/)
  })

  it('出力パスが元動画パスと一致する場合は拒否する', () => {
    const now = new Date('2024-01-01T00:00:00')
    const sourceReal = resolve(dir, 'preview_zzzzzzzz_20240101_000000.mp4')
    writeFileSync(sourceReal, 'original video bytes')
    const outputPath = buildPreviewOutputPath('zzzzzzzz', dir, sourceReal, now)
    expect(outputPath).not.toBe(sourceReal)
  })
})
