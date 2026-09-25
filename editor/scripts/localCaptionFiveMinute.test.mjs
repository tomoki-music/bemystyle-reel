import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'localCaptionFiveMinute.mjs'), 'utf-8')

// 5分ランナーが「Whisper APIを呼ばない」「AI分析は明示許可のあるanalyzeステージだけ」「既存データを変えない」ことの静的な保証。
describe('localCaptionFiveMinute: 安全性(静的確認)', () => {
  it('外部Whisper API(openaiTranscription)・fetch・APIエンドポイントを直接使わない', () => {
    expect(/openaiTranscription|api\.openai|from 'node-fetch'|fetch\(/.test(src)).toBe(false)
    expect(src).toContain('externalWhisperApiCalled: false')
  })

  it('AI分析は analyze ステージのみで、--allow-api と --attempt の明示が無ければ実行しない。1回きり(runAnalysisOnce)を使う', () => {
    expect(src).toContain("if (!Number.isInteger(args.attempt)) throw new Error('--attempt <試行番号> を明示してください")
    expect(src).toContain("if (!args.allowApi) throw new Error('AI分析には --allow-api が必要です")
    expect(src.match(/runAnalysisOnce\(/g)).toHaveLength(1)
    const renderPart = src.slice(src.indexOf('async function stageRender'))
    expect(/runAnalysisOnce|requestAnalysisOnce|OPENAI_API_KEY/.test(renderPart)).toBe(false) // 描画は保存済み結果を再利用しAPIを呼ばない
    expect(src).toContain('apiRequestsThisStage: 0')
  })

  it('検証不合格などのAI分析エラーで再送せず停止する（exit 2）', () => {
    expect(src).toContain('process.exit(2)')
    expect(/(for|while)\s*\([^)]*\)\s*\{[^}]*runAnalysisOnce/.test(src)).toBe(false) // ループ・再試行の中でAPIを呼ばない
    expect(/catch[^{]*\{[^}]*runAnalysisOnce/.test(src)).toBe(false)
  })

  it('既存の5分データ(v1のpages・前回の送信済みマーカー・分析結果)を上書き・削除しない。修正後は v2 を別ファイルへ原子的に保存する', () => {
    expect(src).toContain('.pages.v2.json')
    expect(/writeFileSync\([^)]*\.pages\.json/.test(src)).toBe(false)
    expect(/rmSync\([^)]*(marker|pages\.json)/i.test(src)).toBe(false)
    expect(/renameSync\([^)]*pages\.json/.test(src)).toBe(false)
    expect(src).toContain('renameSync(tmp, path)')
  })

  it('revalidate は .env（APIキー）を読み込まず、HTTPを送らない。render は有効テーマ2件・強調3件未満なら動画を作らない', () => {
    expect(src).toContain("if (args.stage !== 'revalidate') dotenv.config(")
    const reval = src.slice(src.indexOf('async function stageRevalidate'), src.indexOf('// render:'))
    expect(/fetch|runAnalysisOnce|requestAnalysisOnce|OPENAI_API_KEY/.test(reval)).toBe(false)
    expect(src).toContain("problems.push('有効なテーマが2件未満です')")
    expect(src).toContain("problems.push('有効な部分強調が合計3件未満です')")
  })

  it('既存ジョブJSONは読み取り専用（書き込み・削除・リネーム対象にしない）', () => {
    expect(/writeFileSync\(\s*(file|jobFile)\b|rmSync\(\s*(file|jobFile)\b|renameSync\(\s*(file|jobFile)\b|unlinkSync/.test(src)).toBe(false)
    for (const k of ['jobFileByteIdentical', 'captionsRawSegmentsClassificationUnchanged', 'sourceUnchanged', 'existingOutputFilesModifiedOrRemoved']) expect(src).toContain(k)
  })

  it('一時音声・ASS・whisper出力は withTempDir 配下に作り、削除結果を確認する', () => {
    expect(src).toContain("withTempDir('lcv-five-min-'")
    expect(src).toContain("withTempDir('lcv-five-min-render-'")
    expect(src.match(/tempDirRemoved/g).length).toBeGreaterThanOrEqual(4)
  })

  it('動画は一時ファイル(.partial.mp4)へ書き出し、成功後にrenameし、失敗時は一時ファイルを削除する', () => {
    expect(src).toContain(".replace(/\\.mp4$/, '.partial.mp4')")
    expect(src).toContain('renameSync(partialPath, finalPath)')
    expect(src).toContain("rmSync(partialPath, { force: true })")
    expect(src).toContain('partialFilesLeft')
    expect(src.indexOf('renameSync(partialPath, finalPath)')).toBeGreaterThan(src.indexOf('renderPreviewClip('))
    expect(src).toContain("buildComparisonOutputPath(contNorm ? 'five_minute_continuous_topics' : 'five_minute_topics'")
    // 常時表示版: 生成したASSと完成MP4の全フレームでテーマ被覆を検証し、満たさなければ動画を作らない/失敗にする
    expect(src).toContain('analyzeTopicAssEvents(assText')
    expect(src).toContain('verifyThemeFramesInVideo(finalPath')
    expect(src).toContain("problems.push('生成したASSでテーマ表示が0〜300秒を完全に被覆していません')")
  })

  it('動画尺が300秒でなければ完成品にしない（rename前に検証）', () => {
    expect(src).toContain('動画尺が300秒ではありません')
    expect(src.indexOf('動画尺が300秒ではありません')).toBeLessThan(src.indexOf('renameSync(partialPath, finalPath)'))
  })

  it('区間単位のアラインメント(planChunksFromRawSegments/alignCanonicalByChunks)を使い、whisper.cppはDTW+ローカルのみ', () => {
    expect(src).toContain('planChunksFromRawSegments')
    expect(src).toContain('alignCanonicalByChunks')
    expect(src).toContain('buildWhisperArgs')
    expect(src).toContain('/usr/bin/time')
  })

  it('メモリ(子プロセス最大RSS・Node最大RSS)と処理時間を記録する', () => {
    expect(src).toContain('whisperCliMaxRssMB')
    expect(src).toContain('nodePeakRssMB')
    expect(src).toContain('whisperMs')
  })

  it('標準出力へ字幕本文・テーマ名・強調語・AI応答を出さない（数値・真偽値・ファイル名のみ）', () => {
    expect(/console\.(log|error)\([^)]*\b(text|title|emphasisText|raw|content)\b/.test(src)).toBe(false)
    expect(src).toContain('titleChars')
    expect(/\b(title|text|emphasisText):\s*(t|c|e)\./.test(src.slice(src.indexOf('summary.metrics = {')))).toBe(false)
  })

  it('中間データ(pages/analysis/選定)は editor/data/ 配下(git管理外)にだけ保存する', () => {
    expect(src).toContain("'data/local_caption_comparisons/five_minute'")
    const writes = [...src.matchAll(/writeFileSync\(\s*([^,]+),/g)].map((m) => m[1].trim())
    for (const w of writes) expect(/resolve\(DATA_DIR|assPath|longAss|cachePath|^tmp$/.test(w)).toBe(true)
  })

  it('5分データ・分析結果・送信済みマーカー・AI応答の保存先が git 管理外である', () => {
    const ignored = (p) => {
      try {
        execFileSync('git', ['check-ignore', '-q', p], { cwd: resolve(here, '../..') })
        return true
      } catch {
        return false
      }
    }
    expect(ignored('editor/data/local_caption_comparisons/five_minute/five_minute_613.pages.json')).toBe(true)
    expect(ignored('editor/data/local_caption_comparisons/five_minute/five_minute_613.analysis.json')).toBe(true)
    expect(ignored('editor/data/local_caption_comparisons/five_minute/five_minute_613.analysis-request.marker')).toBe(true)
    expect(ignored('editor/data/local_caption_comparisons/five_minute/five_minute_613.pages.v2.json')).toBe(true)
    expect(ignored('editor/data/local_caption_comparisons/five_minute/five_minute_613.analysis-request.attempt-2.marker')).toBe(true)
    expect(ignored('editor/data/local_caption_comparisons/five_minute/diagnostics/five_minute_613.attempt-2.json')).toBe(true)
    expect(ignored('editor/data/local_caption_comparisons/five_minute/five_minute_613.repair-diagnostics.json')).toBe(true)
    expect(ignored('editor/.env')).toBe(true)
    expect(ignored('out/comparison_five_minute_topics_20260924_210000.mp4')).toBe(true)
  })
})
