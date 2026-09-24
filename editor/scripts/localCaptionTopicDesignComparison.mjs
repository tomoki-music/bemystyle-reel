// ローカルAIテロップ動画: 60秒デザイン確認ランナー（拡大字幕 + 左上トークテーマ）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionTopicDesignComparison.mjs --job <jobId> --start <sec> [--duration 60]
//        --captions <natural_timing_comparison_*.json> (--topic-title <テーマ名> | --topic-from <large_caption_topic_comparison_*.json>)
//        [--kind <comparison kind>] [--require-terms <対象語,...>] [--measure] [--stills-dir <dir> --stills <t1,t2,...> [--mobile-widths 390,430]] [--skip-render]
//
// --topic-from: 前回の比較データからテーマの表示時刻をそのまま引き継ぐ。--topic-title を併用するとテーマ名だけを
//   差し替える（時刻・idは前回と一致することを検証する）。
// --require-terms: テーマ名に必ず残すべき対象語（人が確認したもの）。正本の文字に実在し、テーマ名に含まれることを検証する。
// --measure: 実際のフォント(libass)で字幕を描画し、表示幅・使用率・余白を測る（合成条件8種 + 実データ全件）。
//
// 承認済みの自然タイミング(natural_timing_comparison_*.json の naturalCaptions)をそのまま使う。
// 発話アラインメント・ページ遷移・強調は再計算しない（タイミング仕様は変更しない）。
//
// 安全方針（localCaptionNaturalTimingComparison.mjs と同じ）:
// - 外部AI API(OpenAI等)は一切呼ばない。ローカルffmpegのみ（Whisperも再実行しない）。
// - 既存ジョブJSON・元動画・既存の比較動画は読み取り専用/非変更。実行前後でハッシュ/サイズ/mtimeを比較する。
// - 一時ファイルは一時ディレクトリに作り、終了時に必ず削除する。
// - 比較動画は VIDEO_OUTPUT_ROOT 配下に comparison_large_caption_topic_<timestamp>.mp4 として新規保存（上書きしない）。
// - 標準出力・保存データに絶対パス・APIキーを出さない。字幕本文・テーマ名は標準出力へ出さない
//   （結果は editor/data/ 配下＝git管理外の検証用データにのみ保存する）。
// - TopicSection は比較専用データ。既存ジョブや分類結果へは保存しない。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import dotenv from 'dotenv'

import { validateSourcePath, validateOutputRoot } from '../server/lib/pathValidator.mjs'
import { extractAudioSegmentWav, renderPreviewClip, runFfprobe } from '../server/lib/ffmpegRunner.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { buildAssContent, getCaptionStyleDefs, planCaptionFits, CAPTION_FONT_SCALE } from '../server/lib/captionStyles.mjs'
import { buildComparisonOutputPath, COMPARISON_KINDS } from '../server/lib/outputNaming.mjs'
import { readWavPcm16Mono, detectSilences, computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { measureSyncAgainstAudio } from '../server/lib/comparisonMetrics.mjs'
import { resolveTopicSections, validateTopicTitle, checkTopicTitleGrounding } from '../server/lib/topicSections.mjs'
import { fitTopicTitle, getTopicLayout } from '../server/lib/topicAss.mjs'
import { measureCaptionRender } from '../server/lib/assRenderMeasure.mjs'
import { getCaptionFitLimits } from '../server/lib/captionFit.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const EDITOR_ROOT = resolve(__dirname, '..')

function parseArgs(argv) {
  const out = { duration: 60, skipRender: false, kind: 'large_caption_topic', mobileWidths: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') out.job = argv[++i]
    else if (a === '--start') out.start = Number(argv[++i])
    else if (a === '--duration') out.duration = Number(argv[++i])
    else if (a === '--captions') out.captions = argv[++i]
    else if (a === '--topic-title') out.topicTitle = argv[++i]
    else if (a === '--topic-from') out.topicFrom = argv[++i]
    else if (a === '--kind') out.kind = argv[++i]
    else if (a === '--require-terms') out.requireTerms = argv[++i].split(',').map((x) => x.trim()).filter(Boolean)
    else if (a === '--measure') out.measure = true
    else if (a === '--compare-scales') out.compareScales = argv[++i].split(',').map(Number).filter(Number.isFinite)
    else if (a === '--mobile-widths') out.mobileWidths = argv[++i].split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
    else if (a === '--stills-dir') out.stillsDir = argv[++i]
    else if (a === '--stills') out.stills = argv[++i].split(',').map(Number).filter(Number.isFinite)
    else if (a === '--skip-render') out.skipRender = true
  }
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const snapshotDir = (dir) => new Map(readdirSync(dir).map((n) => [n, `${statSync(join(dir, n)).size}:${statSync(join(dir, n)).mtimeMs}`]))

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env') })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (!Number.isFinite(args.start)) throw new Error('--start <sec> を指定してください（前回と同じ区間を使う）')
  if (!args.captions) throw new Error('--captions <natural_timing_comparison_*.json> を指定してください（承認済みのタイミング）')
  if (!args.topicTitle && !args.topicFrom) throw new Error('--topic-title <テーマ名> または --topic-from <前回の比較データ> を指定してください')
  if (!COMPARISON_KINDS.includes(args.kind)) throw new Error('--kind が不正です')
  if (!process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN) {
    throw new Error('FFMPEG_BIN / FFPROBE_BIN が未設定です（システムのffmpegには頼りません）')
  }

  // ── 既存ジョブ(読み取り専用)とその不変性ハッシュ ──
  const jobFile = resolve(EDITOR_ROOT, 'data/local_caption_videos', `${args.job.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  const jobBytesBefore = readFileSync(jobFile)
  const job = JSON.parse(jobBytesBefore.toString('utf-8'))
  const canonHash = (j) => sha256(JSON.stringify({ captions: j.captions, rawSegments: j.rawSegments, cls: j.captionClassification ?? null }))
  const canonBefore = canonHash(job)

  const windowStart = args.start
  const windowDuration = args.duration
  const windowEnd = windowStart + windowDuration
  const canonicalText = [...job.captions]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .filter((c) => c.startSec >= windowStart - 1e-6 && c.endSec <= windowEnd + 1e-6)
    .map((c) => c.text)
    .join('')

  // ── 承認済みタイミングのcaption（比較専用データ。既存ジョブには保存しない） ──
  const capFile = resolve(EDITOR_ROOT, 'data/local_caption_comparisons', args.captions.replace(/[^a-zA-Z0-9._-]/g, ''))
  const capBytesBefore = readFileSync(capFile)
  const approved = JSON.parse(capBytesBefore.toString('utf-8'))
  if (approved.jobId !== job.id) throw new Error('比較データのjobIdが一致しません')
  if (approved.metrics?.window?.startSec !== round(windowStart, 2)) throw new Error('比較データの区間が--startと一致しません')
  const captions = approved.naturalCaptions
  const captionsHashBefore = sha256(JSON.stringify(captions.map((c) => [c.startSec, c.endSec, c.text, c.lines, c.emphasisText])))

  // ── 比較専用 TopicSection（60秒ぶんを代表する1件。caption境界へスナップ） ──
  // --topic-from のときは前回のテーマ名・時刻を引き継ぎ、スナップ後も前回と一致することを確認する。
  let prevTopics = null
  let topicInput
  if (args.topicFrom) {
    const prevFile = resolve(EDITOR_ROOT, 'data/local_caption_comparisons', args.topicFrom.replace(/[^a-zA-Z0-9._-]/g, ''))
    prevTopics = JSON.parse(readFileSync(prevFile, 'utf-8')).topicSections
    topicInput = prevTopics.map((t) => ({ ...t, title: args.topicTitle ? args.topicTitle.trim() : t.title }))
  } else {
    topicInput = [{ id: 'topic-001', title: args.topicTitle.trim(), startSec: captions[0].startSec, endSec: captions[captions.length - 1].endSec, source: 'manual' }]
  }
  for (const t of topicInput) {
    const tv = validateTopicTitle(t.title)
    if (!tv.ok) throw new Error(`テーマ名が不正です: ${tv.errors.join(' / ')}`)
  }
  // 手動指定のテーマ（source='manual'）として扱う。自動処理は上書きしない。
  const resolved = resolveTopicSections({ manual: topicInput, captions })
  if (!resolved.ok) throw new Error(`TopicSectionが不正です: ${resolved.errors.join(' / ')}`)
  const topicSections = resolved.sections
  const timeKey = (arr) => JSON.stringify(arr.map((t) => [t.id, t.startSec, t.endSec, t.source]))
  const topicTimesIdenticalToPrevious = prevTopics ? timeKey(prevTopics) === timeKey(topicSections) : null
  if (prevTopics && !topicTimesIdenticalToPrevious) throw new Error('TopicSectionの時刻が前回と一致しません（時刻は変更しない）')
  const topicTitleChangedFromPrevious = prevTopics ? prevTopics.some((t, i) => t.title !== topicSections[i]?.title) : null
  const fits = topicSections.map((t) => fitTopicTitle(t.title, job.width, job.height))
  // テーマ名の対象語が正本の文字と一致するか（抽象化しすぎ・別概念への置き換えの再発防止）
  const grounding = topicSections.map((t) => {
    const sectionText = captions.filter((c) => c.startSec >= t.startSec - 1e-6 && c.endSec <= t.endSec + 1e-6).map((c) => c.text).join('')
    return checkTopicTitleGrounding(t.title, sectionText, { requiredTerms: args.requireTerms })
  })

  // ── 機械的な検証（本文・改行・行数・強調・拡大後のセーフエリア） ──
  const problems = []
  if (captions.map((c) => c.text).join('') !== canonicalText) problems.push('本文が正本と一致しません')
  if (captions.some((c) => /[\r\n]|\\N/.test(c.text))) problems.push('本文に改行/\\Nが混入')
  if (captions.some((c) => c.lines.length > 2)) problems.push('3行以上のcaptionがあります')
  if (captions.some((c) => c.lines.join('') !== c.text)) problems.push('linesが本文と一致しません')
  if (captions.some((c) => c.emphasisText && !c.text.includes(c.emphasisText))) problems.push('強調語が本文に存在しません')
  const W = job.width
  const H = job.height
  const styles = getCaptionStyleDefs(W, H, CAPTION_FONT_SCALE)
  const limits = getCaptionFitLimits(W, H)
  const fitPlan = planCaptionFits(captions, W, H)
  if (fitPlan.some((f) => !f.fits)) problems.push('動的縮小(下限)でも使用可能幅に収まらない字幕があります')
  if (fitPlan.some((f) => f.size < limits.minSizePx)) problems.push('字幕サイズが下限を下回っています')
  if (grounding.some((g) => !g.ok)) problems.push('テーマ名の対象語が正本の文字と一致しません（未確認の語または必須語の欠落）')

  // ── 安全確認 ──
  const inputRoots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sourceRealPath = validateSourcePath(job.sourcePath, inputRoots).realPath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  const srcBefore = statSync(sourceRealPath)
  const existingOutputs = snapshotDir(outputRoot)
  const freeBefore = await getFreeBytes(outputRoot)

  const summary = {}
  let outputs = {}
  const stillsWritten = []

  const { removed: tempDirRemoved } = await withTempDir('lcv-topic-cmp-', async (tmpDir) => {
    // タイミング仕様は不変: 音声との機械的な同期検証だけ継続する。
    const wavPath = join(tmpDir, 'clip.wav')
    await extractAudioSegmentWav(sourceRealPath, wavPath, windowStart, windowDuration)
    const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wavPath))
    const { thresholdDb } = detectSilences(samples, sampleRate, { minSilenceSec: 0.3 })
    const { db: frameDb, frameSec } = computeFrameDb(samples, sampleRate)
    const sync = measureSyncAgainstAudio(captions, frameDb, frameSec, thresholdDb)
    const approvedNatural = approved.metrics.results.natural

    // ── 実描画(libass + 実フォント)による字幕幅の測定（--measure）。合成条件は本文を含まない汎用文字列。 ──
    let renderMeasure = null
    if (args.measure) {
      const pool = Array.from('これは表示幅を測るための合成文字列です今日は天気が良いので散歩に出かけます')
      const L = (n) => pool.slice(0, n).join('')
      const synthetic = [
        ['1行8文字', { lines: [L(8)] }],
        ['1行12文字', { lines: [L(12)] }],
        ['1行16文字', { lines: [L(16)] }],
        ['1行20文字', { lines: [L(20)] }],
        ['2行合計22文字', { lines: [L(11), L(11)] }],
        ['2行合計30文字', { lines: [L(15), L(15)] }],
        ['部分強調を含む1行', { lines: ['これはとても大事な話です'], emphasisText: 'とても大事' }],
        ['部分強調を含む2行', { lines: ['これはとても大事な', 'ですよね本当に'], emphasisText: 'とても大事' }],
      ]
      const measureOne = async (name, c) => {
        const cap = { text: c.lines.join(''), lines: c.lines, emphasisText: c.emphasisText ?? null }
        const plan = planCaptionFits([cap], W, H)[0]
        const r = await measureCaptionRender({ caption: cap, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name })
        return { plan, r }
      }
      const rows = []
      for (const [name, c] of synthetic) {
        const { plan, r } = await measureOne(`s${rows.length}`, c)
        rows.push({
          condition: name,
          chars: c.lines.map((l) => Array.from(l).length),
          fontSizePx: plan.size,
          shrunk: plan.shrunk,
          measuredWidthPx: r.measuredWidthPx,
          usagePercent: round(r.usageRatio * 100, 1),
          minSideMarginPx: Math.min(r.leftMarginPx, r.rightMarginPx),
          minSideMarginPercent: round((Math.min(r.leftMarginPx, r.rightMarginPx) / W) * 100, 1),
          overflow: r.overflow,
          lineCount: r.lineCount,
          linePitchPx: r.linePitchPx,
          lineHeightPx: r.lineHeightsPx[0],
          topPercent: round((r.topPx / H) * 100, 1),
          bottomMarginPx: r.bottomMarginPx,
        })
      }
      // captionType別（normal/main/sub/emphasis）の実描画（1行16文字・2行30文字）
      const typeRows = []
      for (const type of ['normal', 'main', 'sub', 'emphasis']) {
        for (const lines of [[L(16)], [L(15), L(15)]]) {
          const cap = { text: lines.join(''), lines, captionType: type, emphasisText: null }
          const plan = planCaptionFits([cap], W, H)[0]
          const r = await measureCaptionRender({ caption: cap, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: `ty${typeRows.length}` })
          typeRows.push({ type, lines: lines.length, fontSizePx: plan.size, shrunk: plan.shrunk, measuredWidthPx: r.measuredWidthPx, usagePercent: round(r.usageRatio * 100, 1), minSideMarginPx: Math.min(r.leftMarginPx, r.rightMarginPx), overflow: r.overflow, topPercent: round((r.topPx / H) * 100, 1), bottomMarginPx: r.bottomMarginPx })
        }
      }
      // サイズ候補の比較（--compare-scales）: 1行16文字・20文字の実描画の使用率
      const sizeComparison = []
      for (const scale of args.compareScales ?? []) {
        const row = { scale, normalPx: getCaptionStyleDefs(W, H, scale).normal.fontsize }
        for (const n of [16, 20]) {
          const cap = { text: L(n), lines: [L(n)], emphasisText: null }
          const plan = planCaptionFits([cap], W, H, scale)[0]
          const r = await measureCaptionRender({ caption: cap, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: `sc${sizeComparison.length}_${n}`, captionFontScale: scale })
          row[`chars${n}`] = { fontSizePx: plan.size, shrunk: plan.shrunk, usagePercent: round(r.usageRatio * 100, 1), minSideMarginPx: Math.min(r.leftMarginPx, r.rightMarginPx) }
        }
        sizeComparison.push(row)
      }
      const real = []
      for (const [i, c] of captions.entries()) {
        const { plan, r } = await measureOne(`r${i}`, { lines: c.lines, emphasisText: c.emphasisText })
        real.push({ plan, r, chars: Math.max(...c.lines.map((l) => Array.from(l).length)) })
      }
      const usage = real.map((x) => x.r.usageRatio)
      renderMeasure = {
        synthetic: rows,
        byCaptionType: typeRows,
        sizeComparison,
        real: {
          captionCount: real.length,
          fontSizeHistogramPx: real.reduce((h, x) => ({ ...h, [x.plan.size]: (h[x.plan.size] ?? 0) + 1 }), {}),
          shrunkCount: real.filter((x) => x.plan.shrunk).length,
          usagePercent: { min: round(Math.min(...usage) * 100, 1), max: round(Math.max(...usage) * 100, 1), mean: round((usage.reduce((a, b) => a + b, 0) / usage.length) * 100, 1) },
          maxMeasuredWidthPx: Math.max(...real.map((x) => x.r.measuredWidthPx)),
          minSideMarginPx: Math.min(...real.map((x) => Math.min(x.r.leftMarginPx, x.r.rightMarginPx))),
          overflowCount: real.filter((x) => x.r.overflow).length,
          maxLineCount: Math.max(...real.map((x) => x.r.lineCount)),
          minBottomMarginPx: Math.min(...real.map((x) => x.r.bottomMarginPx)),
          minTopPercent: round((Math.min(...real.map((x) => x.r.topPx)) / H) * 100, 1),
          twoLineTopPercentMin: round((Math.min(...real.filter((x) => x.r.lineCount === 2).map((x) => x.r.topPx)) / H) * 100, 1),
        },
      }
      const minMargin = Math.floor(W * 0.06) // 6%（整数pxへ切り下げ。ink端は±1pxの丸めを含む）
      const bad = [...typeRows.map((r) => ({ o: r.overflow, m: r.minSideMarginPx, u: r.usagePercent })), ...rows.map((r) => ({ o: r.overflow, m: r.minSideMarginPx, u: r.usagePercent })), ...real.map((x) => ({ o: x.r.overflow, m: Math.min(x.r.leftMarginPx, x.r.rightMarginPx), u: x.r.usageRatio * 100 }))]
      if (bad.some((b) => b.o || b.m < minMargin || b.u > 88)) problems.push('実描画で、はみ出し・左右6%未満の余白・使用幅88%超の字幕があります')
    }

    let outputPath = null
    if (!args.skipRender && problems.length === 0) {
      const assPath = join(tmpDir, 'large_caption_topic.ass')
      writeFileSync(assPath, buildAssContent({ width: W, height: H, captions }, { topicSections, topicAccentMode: 'label' }), 'utf-8')
      outputPath = buildComparisonOutputPath(args.kind, outputRoot, sourceRealPath)
      try {
        await renderPreviewClip({ sourceRealPath, assPath, outputPath, startSec: windowStart, clipDurationSec: windowDuration })
      } catch (err) {
        rmSync(outputPath, { force: true })
        throw err
      }
      const probe = await runFfprobe(outputPath)
      outputs = { [args.kind]: { filename: outputPath.split('/').pop(), durationSec: round(probe.durationSec, 3), sizeBytes: statSync(outputPath).size } }

      // 代表フレームを「完成した比較動画」から抽出する（目視確認用。stills-dir は git 管理外を指定する）
      if (args.stillsDir && args.stills?.length) {
        mkdirSync(args.stillsDir, { recursive: true })
        for (const t of args.stills) {
          const png = join(args.stillsDir, `frame_${String(t).replace('.', '_')}s.png`)
          await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-ss', String(t), '-i', outputPath, '-frames:v', '1', png])
          stillsWritten.push(png.split('/').pop())
          // スマートフォン相当の縮小画像（16:9維持）。高さは幅から自動（偶数）。
          for (const w of args.mobileWidths) {
            const small = png.replace(/\.png$/, `_m${w}.png`)
            await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:-2:flags=lanczos`, small])
            stillsWritten.push(small.split('/').pop())
          }
        }
      }
    }

    summary.metrics = {
      window: { startSec: round(windowStart, 2), endSec: round(windowEnd, 2), durationSec: windowDuration },
      captionCount: captions.length,
      timingUnchanged: {
        // 承認済みcaption(入力ファイル)そのものを使用。以下は同期検証の再計測値と、承認時の値との比較。
        approvedEarly500ms: approvedNatural.early500ms,
        approvedLate500ms: approvedNatural.late500ms,
        approvedSilentDisplayRatio: approvedNatural.silentDisplayRatio,
        silentDisplayRatioNow: round(sync.silentDisplayRatio, 4),
        audioLeadingSilentSecMax: round(sync.leadingSilentSec.max, 3),
        approvedAudioLeadingSilentSecMax: approvedNatural.audioLeadingSilentSec?.max,
      },
      captionFontSizePx: {
        scale: CAPTION_FONT_SCALE,
        normalAtScale1: getCaptionStyleDefs(W, H, 1).normal.fontsize,
        normalAdopted: styles.normal.fontsize,
        mainAdopted: styles.main.fontsize,
        subAdopted: styles.sub.fontsize,
        emphasisAdopted: styles.emphasis.fontsize,
        minSizeFloorPx: limits.minSizePx,
        maxWidthPx: limits.maxWidthPx,
        outlinePx: styles.normal.outline,
        planned: {
          shrunkCount: fitPlan.filter((f) => f.shrunk).length,
          allFit: fitPlan.every((f) => f.fits),
          minSizePx: Math.min(...fitPlan.map((f) => f.size)),
          histogramPx: fitPlan.reduce((h, f) => ({ ...h, [f.size]: (h[f.size] ?? 0) + 1 }), {}),
        },
        maxLineChars: Math.max(...captions.flatMap((c) => c.lines.map((l) => Array.from(l).length))),
        maxPageChars: Math.max(...captions.map((c) => Array.from(c.text).length)),
      },
      topicLayout: {
        titlePx: getTopicLayout(W, H).titleBase,
        labelPx: getTopicLayout(W, H).labelSize,
        fit: fits.map((f) => ({ lines: f.lines.length, titlePx: f.titleSize, shrunk: f.shrunk, fits: f.fits })),
        timesIdenticalToPrevious: topicTimesIdenticalToPrevious,
        titleChangedFromPrevious: topicTitleChangedFromPrevious,
        grounding: grounding.map((g) => ({ ok: g.ok, termCount: g.terms.length, ungroundedCount: g.ungroundedTerms.length, missingRequiredCount: g.missingRequired.length, requiredNotInCanonicalCount: g.requiredNotInCanonical.length })),
        requiredTermCount: args.requireTerms?.length ?? 0,
      },
      renderMeasure,
      topicSections: topicSections.map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, source: s.source, titleChars: Array.from(s.title).length })),
      invariantProblems: problems,
    }
    summary.stillsWritten = stillsWritten

    const saveDir = resolve(EDITOR_ROOT, 'data/local_caption_comparisons')
    mkdirSync(saveDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const saveName = `${args.kind}_comparison_${stamp}.json`
    writeFileSync(
      resolve(saveDir, saveName),
      JSON.stringify({ createdAt: new Date().toISOString(), jobId: job.id, basedOn: args.captions, metrics: summary.metrics, topicSections, outputs }, null, 2),
      'utf-8',
    )
    summary.savedAs = saveName
  })

  // ── 後片付けと不変性の確認 ──
  const srcAfter = statSync(sourceRealPath)
  const jobAfter = JSON.parse(readFileSync(jobFile, 'utf-8'))
  const outputsAfter = snapshotDir(outputRoot)
  const modifiedExisting = [...existingOutputs].filter(([n, v]) => outputsAfter.get(n) !== v).map(([n]) => n)
  const newFiles = [...outputsAfter.keys()].filter((n) => !existingOutputs.has(n))
  summary.outputs = outputs
  summary.safety = {
    sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
    jobFileByteIdentical: sha256(jobBytesBefore) === sha256(readFileSync(jobFile)),
    captionsRawSegmentsClassificationUnchanged: canonBefore === canonHash(jobAfter),
    approvedCaptionDataByteIdentical: sha256(capBytesBefore) === sha256(readFileSync(capFile)),
    approvedCaptionTimingHashUnchanged: captionsHashBefore === sha256(JSON.stringify(captions.map((c) => [c.startSec, c.endSec, c.text, c.lines, c.emphasisText]))),
    existingOutputFilesModifiedOrRemoved: modifiedExisting.length,
    newOutputFileCount: newFiles.length,
    newOutputFiles: newFiles,
    tempDirRemoved,
    freeBytesBefore: freeBefore,
    freeBytesAfter: await getFreeBytes(outputRoot),
    externalAiApiCalled: false,
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(`[localCaptionTopicDesignComparison] ${err.message}`)
  process.exit(1)
})
