import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'localCaptionTopicDesignComparison.mjs'), 'utf-8')

// ランナーが「既存ジョブ・元動画・既存動画を変更しない」「外部AIを呼ばない」ことの静的な保証。
describe('localCaptionTopicDesignComparison: 安全性(静的確認)', () => {
  it('外部AI API(OpenAI/fetch/Whisper/分類)を呼ばない', () => {
    expect(/fetch\(|api\.openai|OPENAI_API_KEY/.test(src)).toBe(false)
    expect(/from 'node-fetch'|from 'openai'/.test(src)).toBe(false)
    expect(/openaiTranscription|captionClassifier|whisperLocal|runWhisperCli/.test(src)).toBe(false)
  })

  it('既存ジョブJSON・承認済みcaptionデータは読み取り専用（書き込み・削除・コピー系APIが無い）', () => {
    expect(/writeFileSync\(\s*(jobFile|capFile)|rmSync\(\s*(jobFile|capFile)|copyFile|renameSync|unlinkSync/.test(src)).toBe(false)
  })

  it('書き込み先は一時ディレクトリ・検証データ保存先・比較動画の出力先・指定の静止画ディレクトリに限られる', () => {
    const writes = [...src.matchAll(/writeFileSync\(\s*([^,]+),/g)].map((m) => m[1].trim())
    for (const w of writes) expect(/assPath|resolve\(saveDir/.test(w)).toBe(true)
  })

  it('一時ファイルは withTempDir 配下に作り、最後に削除結果を確認する', () => {
    expect(src).toContain("withTempDir('lcv-topic-cmp-'")
    expect(src).toContain('tempDirRemoved')
  })

  it('比較動画は large_caption_topic 名で新規保存し、元動画・既存動画・ジョブの不変性を実行前後で確認する', () => {
    expect(src).toContain('buildComparisonOutputPath(args.kind')
    expect(src).toContain("['large_caption_topic', 'mobile_large_text']")
    expect(src).toContain('sourceUnchanged')
    expect(src).toContain('existingOutputFilesModifiedOrRemoved')
    expect(src).toContain('captionsRawSegmentsClassificationUnchanged')
    expect(src).toContain('approvedCaptionTimingHashUnchanged')
  })

  it('標準出力へ字幕本文・テーマ名を出さない（タイトルは文字数のみ）', () => {
    expect(src).toContain('titleChars')
    expect(/console\.log\([^)]*(topicTitle|title|\.text)/.test(src)).toBe(false)
  })

  it('TopicSectionは比較専用: 既存ジョブへtopicSectionsを書き込まない', () => {
    expect(/job\.topicSections\s*=|topicSections\s*:\s*.*jobAfter/.test(src)).toBe(false)
    expect(src).not.toMatch(/writeFileSync\(\s*jobFile/)
  })

  it('サイズ調整版: 前回のテーマ名・時刻を引き継ぎ、一致しなければ中止する（内容・タイミングは変えない）', () => {
    expect(src).toContain('--topic-from')
    expect(src).toContain('topicIdenticalToPrevious')
    expect(src).toContain('TopicSectionが前回と一致しません')
  })

  it('スマホ相当の縮小画像は16:9を保つ（幅指定のみで高さは自動）', () => {
    expect(src).toContain('scale=${w}:-2')
  })
})
