import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { buildUniqueOutputPath, buildPreviewOutputPath, buildComparisonOutputPath } from './outputNaming.mjs'

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

describe('buildComparisonOutputPath (旧方式/新方式の比較動画)', () => {
  const now = new Date('2026-09-23T22:00:00')

  it('legacy と semantic は別ファイル名になり、元動画名を含まない', () => {
    const sourceReal = resolve(dir, 'なぜ社名.mp4')
    writeFileSync(sourceReal, 'x')
    const legacy = buildComparisonOutputPath('legacy', dir, sourceReal, now)
    const semantic = buildComparisonOutputPath('semantic', dir, sourceReal, now)
    expect(legacy).toMatch(/comparison_legacy_20260923_220000\.mp4$/)
    expect(semantic).toMatch(/comparison_semantic_20260923_220000\.mp4$/)
    expect(legacy).not.toBe(semantic)
    expect(legacy + semantic).not.toContain('なぜ社名')
  })

  it('large_caption_topic は comparison_large_caption_topic_<timestamp>.mp4 で、他の比較動画と別名', () => {
    const sourceReal = resolve(dir, 'なぜ社名.mp4')
    writeFileSync(sourceReal, 'x')
    const out = buildComparisonOutputPath('large_caption_topic', dir, sourceReal, now)
    expect(out).toMatch(/comparison_large_caption_topic_20260923_220000\.mp4$/)
    expect(out).not.toContain('なぜ社名')
    expect(out).not.toBe(buildComparisonOutputPath('natural_timing', dir, sourceReal, now))
  })

  it('mobile_large_text は comparison_mobile_large_text_<timestamp>.mp4 で、既存の比較動画と別名（衝突時はサフィックス）', () => {
    const sourceReal = resolve(dir, 'なぜ社名.mp4')
    writeFileSync(sourceReal, 'x')
    const first = buildComparisonOutputPath('mobile_large_text', dir, sourceReal, now)
    expect(first).toMatch(/comparison_mobile_large_text_20260923_220000\.mp4$/)
    writeFileSync(first, 'existing')
    const second = buildComparisonOutputPath('mobile_large_text', dir, sourceReal, now)
    expect(second).not.toBe(first) // 既存を上書きしない
    expect(second).not.toBe(buildComparisonOutputPath('large_caption_topic', dir, sourceReal, now))
  })

  it('natural_timing は comparison_natural_timing_<timestamp>.mp4 で、旧2方式と別名', () => {
    const sourceReal = resolve(dir, 'なぜ社名.mp4')
    writeFileSync(sourceReal, 'x')
    const natural = buildComparisonOutputPath('natural_timing', dir, sourceReal, now)
    expect(natural).toMatch(/comparison_natural_timing_20260923_220000\.mp4$/)
    expect(natural).not.toContain('なぜ社名')
    expect(natural).not.toBe(buildComparisonOutputPath('semantic', dir, sourceReal, now))
  })

  it('既存の完成動画・プレビュー動画・比較動画を上書きしない（衝突時はサフィックス）', () => {
    const sourceReal = resolve(dir, 'src.mp4')
    writeFileSync(sourceReal, 'x')
    const existing = [
      'preview_e02f8191_20260923_223228.mp4',
      'video_captioned_20260923_225401.mp4',
      'comparison_legacy_20260923_220000.mp4',
    ]
    for (const name of existing) writeFileSync(resolve(dir, name), 'existing-bytes')
    const out = buildComparisonOutputPath('legacy', dir, sourceReal, now)
    expect(out).toMatch(/comparison_legacy_20260923_220000_[0-9a-f]{6}\.mp4$/)
    expect(existing.map((n) => resolve(dir, n))).not.toContain(out)
  })

  it('出力先は指定した出力ルート直下', () => {
    const sourceReal = resolve(dir, 'src.mp4')
    writeFileSync(sourceReal, 'x')
    expect(resolve(buildComparisonOutputPath('semantic', dir, sourceReal, now), '..')).toBe(dir)
  })

  it('不正な種別は拒否する', () => {
    expect(() => buildComparisonOutputPath('other', dir, resolve(dir, 'src.mp4'), now)).toThrow()
  })
})
