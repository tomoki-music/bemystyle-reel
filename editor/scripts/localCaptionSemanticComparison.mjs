// ローカルAIテロップ動画: 60秒比較検証ランナー（旧方式 vs 新方式）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionSemanticComparison.mjs --job <jobId> [--start <sec>] [--duration 60] [--skip-render]
//
// 安全方針:
// - 外部AI API(OpenAI等)は一切呼ばない。whisper-cli(ローカル)とffmpegのみ。分類APIも呼ばない。
// - 既存ジョブJSON(captions/rawSegments/分類結果)は読み取り専用。実行前後でハッシュを比較する。
// - 元動画はコピー・変更しない。実行前後でサイズ・mtimeを比較する。
// - 一時ファイル(音声/ASS/whisper JSON)は一時ディレクトリに作り、終了時に必ず削除する。
// - 比較動画は VIDEO_OUTPUT_ROOT 配下に comparison_<kind>_<timestamp>.mp4 として保存（既存を上書きしない）。
// - 標準出力・保存データに絶対パス・APIキーを出さない。字幕本文は標準出力に出さない
//   （新方式の結果は editor/data/ 配下＝git管理外の検証用データにのみ保存する）。
// - 通常の ffmpeg/ffprobe(PATH) には頼らず、FFMPEG_BIN / FFPROBE_BIN が未設定なら中断する。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import os from 'os'
import dotenv from 'dotenv'

import { validateSourcePath, validateOutputRoot } from '../server/lib/pathValidator.mjs'
import { extractAudioSegmentWav, renderPreviewClip, runFfprobe } from '../server/lib/ffmpegRunner.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { buildAssContent } from '../server/lib/captionStyles.mjs'
import { buildComparisonOutputPath } from '../server/lib/outputNaming.mjs'
import { analyzeCaptionIssues, summarizeIssues, selectMostProblematicWindow } from '../server/lib/captionIssues.mjs'
import { buildWhisperArgs, runWhisperCli, parseWhisperJson, readWhisperJsonFile, PUNCTUATION_PROMPT } from '../server/lib/whisperLocal.mjs'
import { readWavPcm16Mono, detectSilences, computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { buildSemanticCaptions, validateSemanticCaptions } from '../server/lib/semanticCaptionPipeline.mjs'
import {
  normalizedSimilarity,
  countPunctuation,
  analyzeMissing,
  properNounPreservation,
  countForbiddenBoundaries,
  measureSyncAgainstAudio,
  measureBoundaryAlignment,
  readabilityStats,
  stats,
} from '../server/lib/comparisonMetrics.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EDITOR_ROOT = resolve(__dirname, '..')

function parseArgs(argv) {
  const out = { duration: 60, skipRender: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') out.job = argv[++i]
    else if (a === '--start') out.start = Number(argv[++i])
    else if (a === '--duration') out.duration = Number(argv[++i])
    else if (a === '--skip-render') out.skipRender = true
  }
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)

function statsRounded(s) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env') })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (!process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN) {
    throw new Error('FFMPEG_BIN / FFPROBE_BIN が未設定です（システムのffmpegには頼りません）')
  }

  const home = os.homedir()
  const modelPath = process.env.WHISPER_MODEL_PATH || join(home, 'Library/Caches/bemystyle-reel/whisper-models/ggml-large-v3-turbo-q8_0.bin')
  const vadModelPath = process.env.WHISPER_VAD_MODEL_PATH || join(home, 'Library/Caches/bemystyle-reel/whisper-models/ggml-silero-v5.1.2.bin')
  if (!existsSync(modelPath)) throw new Error('whisperモデルが見つかりません（WHISPER_MODEL_PATH）')

  // ── 既存ジョブ(読み取り専用)とその不変性ハッシュ ──
  const jobFile = resolve(EDITOR_ROOT, 'data/local_caption_videos', `${args.job.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  const jobBytesBefore = readFileSync(jobFile)
  const job = JSON.parse(jobBytesBefore.toString('utf-8'))
  const canonHash = (j) => sha256(JSON.stringify({ captions: j.captions, rawSegments: j.rawSegments, cls: j.captionClassification ?? null }))
  const canonBefore = canonHash(job)

  const legacyAll = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder)

  // ── 60秒区間の選定（機械的に問題数最大の区間） ──
  let windowStart = args.start
  let selection = null
  if (!Number.isFinite(windowStart)) {
    selection = selectMostProblematicWindow(legacyAll, { windowSec: args.duration, totalDurationSec: job.durationSec })
    windowStart = selection.startSec
  }
  const windowDuration = args.duration
  const windowEnd = windowStart + windowDuration
  const legacyCaptions = legacyAll.filter((c) => c.startSec >= windowStart - 1e-6 && c.endSec <= windowEnd + 1e-6)
  const legacyLocal = legacyCaptions.map((c, i) => ({
    ...c,
    startSec: c.startSec - windowStart,
    endSec: c.endSec - windowStart,
    displayOrder: i,
  }))

  // ── 安全確認 ──
  const inputRoots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sourceRealPath = validateSourcePath(job.sourcePath, inputRoots).realPath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  const srcBefore = statSync(sourceRealPath)
  const freeBefore = await getFreeBytes(outputRoot)

  const summary = { step: {} }
  let outputs = null

  const { removed: tempDirRemoved } = await withTempDir('lcv-semantic-cmp-', async (tmpDir) => {
    // ── 60秒音声の抽出（一時ディレクトリ・argv配列） ──
    const wavPath = join(tmpDir, 'clip.wav')
    const t0 = Date.now()
    await extractAudioSegmentWav(sourceRealPath, wavPath, windowStart, windowDuration)
    summary.step.extractMs = Date.now() - t0
    const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wavPath))
    const { silences, thresholdDb } = detectSilences(samples, sampleRate, { minSilenceSec: 0.3 })
    const { db: frameDb, frameSec } = computeFrameDb(samples, sampleRate)
    const silences05 = silences.filter((s) => s.endSec - s.startSec >= 0.5)

    // ── whisper.cpp (A: 時刻アラインメント用 = DTWあり・VADなし) ──
    const alignBase = join(tmpDir, 'align')
    const alignRun = await runWhisperCli(buildWhisperArgs({ modelPath, audioPath: wavPath, outputBase: alignBase, prompt: PUNCTUATION_PROMPT }))
    const align = parseWhisperJson(readWhisperJsonFile(`${alignBase}.json`))

    // ── whisper.cpp (B: 比較用 = DTWあり・VAD併用) ──
    let vadRun = null
    let vad = null
    if (existsSync(vadModelPath)) {
      const vadBase = join(tmpDir, 'vad')
      vadRun = await runWhisperCli(buildWhisperArgs({ modelPath, audioPath: wavPath, outputBase: vadBase, prompt: PUNCTUATION_PROMPT, vadModelPath, quiet: false }))
      vad = parseWhisperJson(readWhisperJsonFile(`${vadBase}.json`))
    }

    // ── 新方式caption ──
    const built = buildSemanticCaptions({
      legacyCaptions,
      windowStartSec: windowStart,
      windowDurationSec: windowDuration,
      tokens: align.tokens,
      silences,
    })
    const semantic = built.captions
    const invariantProblems = validateSemanticCaptions(semantic, built.canonicalText)

    // ── 指標 ──
    const localText = align.segments.map((s) => s.text).join('')
    const canonicalText = built.canonicalText
    const legacyIssues = summarizeIssues(analyzeCaptionIssues(legacyLocal))
    const semanticIssues = summarizeIssues(analyzeCaptionIssues(semantic))
    const gapBetweenSegments = align.segments.slice(1).filter((s, i) => s.startSec - align.segments[i].endSec >= 0.3).length
    const rawSegmentsInWindow = (job.rawSegments ?? []).filter((s) => s.endSec > windowStart && s.startSec < windowEnd).length
    const tokenDur = align.tokens.map((t) => (t.endSec - t.startSec) * 1000)

    const metrics = {
      window: { startSec: round(windowStart, 2), endSec: round(windowEnd, 2), durationSec: windowDuration },
      selection: selection ? { issueTotal: selection.issueTotal, captionCount: selection.captionCount, summary: selection.summary } : null,
      transcript: {
        existingChars: canonicalText.length,
        localChars: localText.length,
        normalizedSimilarity: round(normalizedSimilarity(canonicalText, localText), 4),
        existingPunctuation: countPunctuation(canonicalText),
        localPunctuation: countPunctuation(localText),
        missing: Object.fromEntries(Object.entries(analyzeMissing(canonicalText, localText)).map(([k, v]) => [k, round(v, 4)])),
        properNouns: properNounPreservation(canonicalText, localText),
      },
      segments: {
        existingRawSegmentsInWindow: rawSegmentsInWindow,
        localWhisperSegments: align.segments.length,
        localWhisperSegmentsWithVad: vad ? vad.segments.length : null,
        vadSpeechSegments: vadRun ? vadRun.vadSegments.length : null,
        localSegmentGapsOver0_3s: gapBetweenSegments,
      },
      silence: {
        thresholdDb: round(thresholdDb, 1),
        over0_3s: silences.length,
        over0_5s: silences05.length,
        totalSilenceSec: round(silences.reduce((a, s) => a + (s.endSec - s.startSec), 0), 2),
      },
      tokens: {
        totalNonSpecial: align.tokenCountTotal,
        withDtwTime: align.tokens.length,
        withDtwTimeVad: vad ? vad.tokens.length : null,
        medianDurationMs: round(stats(tokenDur).median, 0),
        timeResolutionMs: 10,
        alignmentMatchedChars: built.alignment.matchedCount,
        canonicalSpeechChars: built.alignment.canonicalSpeechCount,
        alignmentMatchRatio: round(built.alignment.matchedCount / Math.max(1, built.alignment.canonicalSpeechCount), 4),
      },
      captions: {
        legacyCount: legacyLocal.length,
        semanticCount: semantic.length,
        legacyIssues,
        semanticIssues,
        over36chars: { legacy: legacyLocal.filter((c) => c.text.length > 36).length, semantic: semantic.filter((c) => c.text.length > 36).length },
        under2sec: { legacy: legacyIssues.short, semantic: semanticIssues.short },
        forbiddenBoundaries: {
          legacy: countForbiddenBoundaries(legacyLocal.map((c) => c.text)),
          semantic: countForbiddenBoundaries(semantic.map((c) => c.text)),
        },
        semanticLastResortBoundaries: semantic.filter((c) => c.boundaryKind === 'word').length,
        readability: { legacy: null, semantic: null },
        lines: {
          semanticMaxLines: Math.max(...semantic.map((c) => c.lines.length)),
          semanticTwoLinePages: semantic.filter((c) => c.lines.length === 2).length,
          semanticLineLength: statsRounded(stats(semantic.flatMap((c) => c.lines.map((l) => l.length)))),
          semanticExplicitBreaksInAss: semantic.filter((c) => c.lines.length === 2).length,
        },
        invariantProblems,
      },
      sync: {
        legacy: null,
        semantic: null,
      },
    }
    const rd = (caps) => {
      const r = readabilityStats(caps)
      return { duration: statsRounded(r.duration), chars: statsRounded(r.chars), charsPerSec: statsRounded(r.charsPerSec), over8cps: r.over8cps, over10cps: r.over10cps }
    }
    metrics.captions.readability.legacy = rd(legacyLocal)
    metrics.captions.readability.semantic = rd(semantic)
    for (const [label, caps] of [['legacy', legacyLocal], ['semantic', semantic]]) {
      const s = measureSyncAgainstAudio(caps, frameDb, frameSec, thresholdDb)
      metrics.sync[label] = {
        silentDisplayRatio: round(s.silentDisplayRatio, 4),
        leadingSilentSec: statsRounded(s.leadingSilentSec),
        trailingSilentSec: statsRounded(s.trailingSilentSec),
      }
      const b = measureBoundaryAlignment(caps, silences)
      metrics.sync[label].boundaryAlignment = {
        captions: b.captions,
        startsAtSpeechOnset: b.startsAtSpeechOnset,
        onsetOffsetSec: statsRounded(b.onsetOffsetSec),
        endsAtPause: b.endsAtPause,
        shownThroughSilence: b.shownThroughSilence,
      }
    }
    metrics.timing = {
      extractMs: summary.step.extractMs,
      whisperAlignMs: alignRun.elapsedMs,
      whisperVadMs: vadRun ? vadRun.elapsedMs : null,
      audioSec: windowDuration,
      realtimeFactorAlign: round(alignRun.elapsedMs / 1000 / windowDuration, 3),
    }

    // ── 比較動画のレンダー（旧: 既存captionそのまま / 新: 意味分割 + 明示改行） ──
    outputs = {}
    if (!args.skipRender) {
      const view = (caps) => ({ width: job.width, height: job.height, captions: caps })
      for (const [kind, caps] of [['legacy', legacyLocal], ['semantic', semantic]]) {
        const assPath = join(tmpDir, `${kind}.ass`)
        writeFileSync(assPath, buildAssContent(view(caps)), 'utf-8')
        const outputPath = buildComparisonOutputPath(kind, outputRoot, sourceRealPath)
        try {
          await renderPreviewClip({ sourceRealPath, assPath, outputPath, startSec: windowStart, clipDurationSec: windowDuration })
        } catch (err) {
          // 失敗時は不完全な出力を残さない
          rmSync(outputPath, { force: true })
          throw err
        }
        const probe = await runFfprobe(outputPath)
        outputs[kind] = {
          filename: outputPath.split('/').pop(),
          durationSec: round(probe.durationSec, 3),
          sizeBytes: statSync(outputPath).size,
        }
      }
    }

    // ── 検証用の別データとして保存（git管理外 editor/data/ 配下。本文を含むため標準出力には出さない） ──
    const saveDir = resolve(EDITOR_ROOT, 'data/local_caption_comparisons')
    mkdirSync(saveDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const saveName = `semantic_comparison_${stamp}.json`
    writeFileSync(
      resolve(saveDir, saveName),
      JSON.stringify({ createdAt: new Date().toISOString(), jobId: job.id, metrics, silences, semanticCaptions: semantic, outputs }, null, 2),
      'utf-8',
    )

    summary.metrics = metrics
    summary.outputs = outputs
    summary.savedAs = saveName
  })

  // ── 後片付けと不変性の確認 ──
  const srcAfter = statSync(sourceRealPath)
  const jobBytesAfter = readFileSync(jobFile)
  const jobAfter = JSON.parse(jobBytesAfter.toString('utf-8'))
  const freeAfter = await getFreeBytes(outputRoot)
  summary.safety = {
    sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
    sourceSizeBytes: srcAfter.size,
    sourceMtimeMs: srcAfter.mtimeMs,
    jobFileByteIdentical: sha256(jobBytesBefore) === sha256(jobBytesAfter),
    captionsRawSegmentsClassificationUnchanged: canonBefore === canonHash(jobAfter),
    captionCountBefore: job.captions.length,
    rawSegmentCountBefore: (job.rawSegments ?? []).length,
    tempDirRemoved,
    freeBytesBefore: freeBefore,
    freeBytesAfter: freeAfter,
    externalAiApiCalled: false,
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(`[localCaptionSemanticComparison] ${err.message}`)
  process.exit(1)
})
