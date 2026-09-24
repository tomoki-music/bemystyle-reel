import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'localCaptionNaturalTimingComparison.mjs'), 'utf-8')

// ランナーが「既存ジョブ・元動画・既存動画を変更しない」「外部AIを呼ばない」ことの静的な保証。
describe('localCaptionNaturalTimingComparison: 安全性(静的確認)', () => {
  it('外部AI API(OpenAI/fetch/Whisper API/分類)を呼ばない', () => {
    expect(/fetch\(|api\.openai|OPENAI_API_KEY/.test(src)).toBe(false)
    expect(/from 'node-fetch'|from 'openai'/.test(src)).toBe(false)
    expect(/openaiTranscription|captionClassifier/.test(src)).toBe(false)
  })

  it('既存ジョブJSONは読み取り専用（jobFileへの書き込み・削除・コピー系APIが無い）', () => {
    expect(/writeFileSync\(\s*jobFile|rmSync\(\s*jobFile|copyFile|renameSync|unlinkSync/.test(src)).toBe(false)
  })

  it('書き込み先は一時ディレクトリ・検証データ保存先・比較動画の出力先に限られる', () => {
    const writes = [...src.matchAll(/writeFileSync\(\s*([^,]+),/g)].map((m) => m[1].trim())
    for (const w of writes) expect(/assPath|resolve\(saveDir/.test(w)).toBe(true)
  })

  it('一時ファイルは withTempDir 配下に作り、最後に削除結果を確認する', () => {
    expect(src).toContain("withTempDir('lcv-natural-cmp-'")
    expect(src).toContain('tempDirRemoved')
  })

  it('比較動画は natural_timing 名で新規保存し、元動画・既存動画の不変性を実行前後で確認する', () => {
    expect(src).toContain("buildComparisonOutputPath('natural_timing'")
    expect(src).toContain('sourceUnchanged')
    expect(src).toContain('existingOutputFilesModifiedOrRemoved')
    expect(src).toContain('captionsRawSegmentsClassificationUnchanged')
  })
})
