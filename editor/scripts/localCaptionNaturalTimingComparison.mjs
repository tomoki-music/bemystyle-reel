// ローカルAIテロップ動画: 60秒比較検証ランナー（発話時刻優先の「自然タイミング」方式）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionNaturalTimingComparison.mjs --job <jobId> --start <sec> [--duration 60]
//        [--emphasis <file名>]  [--skip-render]
//
// 安全方針（localCaptionSemanticComparison.mjs と同じ）:
// - 外部AI API(OpenAI等)は一切呼ばない。whisper-cli(ローカル)とffmpegのみ。
// - 既存ジョブJSON・元動画・既存の比較動画は読み取り専用/非変更。実行前後でハッシュ/サイズ/mtimeを比較する。
// - 一時ファイルは一時ディレクトリに作り、終了時に必ず削除する。
// - 比較動画は VIDEO_OUTPUT_ROOT 配下に comparison_natural_timing_<timestamp>.mp4 として新規保存（上書きしない）。
// - 標準出力・保存データに絶対パス・APIキーを出さない。字幕本文・強調語は標準出力へ出さない
//   （結果は editor/data/ 配下＝git管理外の検証用データにのみ保存する）。
// - 強調候補は比較専用ファイル(editor/data/local_caption_comparisons/<--emphasis>)から読む。
//   既存ジョブや分類結果へは保存しない。

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
import { buildWhisperArgs, runWhisperCli, parseWhisperJson, readWhisperJsonFile, PUNCTUATION_PROMPT } from '../server/lib/whisperLocal.mjs'
import { readWavPcm16Mono, detectSilences, computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { buildSemanticCaptions } from '../server/lib/semanticCaptionPipeline.mjs'
import { buildNaturalCaptions } from '../server/lib/naturalCaptionPipeline.mjs'
import { boundaryProblems } from '../server/lib/japaneseText.mjs'
import {
  countForbiddenBoundaries,
  measureSyncAgainstAudio,
  measureCaptionTiming,
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
    else if (a === '--emphasis') out.emphasis = argv[++i]
    else if (a === '--skip-render') out.skipRender = true
  }
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const statsRounded = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))

/** 連結すると正本になる caption 配列へ startIndex を付ける。 */
function withIndex(caps) {
  let cursor = 0
  return caps.map((c) => {
    const out = { ...c, startIndex: cursor }
    cursor += c.text.length
    return out
  })
}

function lineNaturalness(caps) {
  let twoLine = 0
  let bad = 0
  const lens = []
  for (const c of caps) {
    if (!Array.isArray(c.lines)) continue
    for (const l of c.lines) lens.push(l.length)
    if (c.lines.length === 2) {
      twoLine += 1
      const p = boundaryProblems(c.lines[0], c.lines[1])
      if (p.midWord || p.particleStart) bad += 1
    }
  }
  return { twoLinePages: twoLine, unnaturalLineBreaks: bad, lineLength: statsRounded(stats(lens)) }
}

function summarize(label, caps, timing, silences, frameDb, frameSec, thresholdDb, windowSec) {
  const t = measureCaptionTiming(caps, timing, silences)
  const forb = countForbiddenBoundaries(caps.map((c) => c.text))
  const read = readabilityStats(caps)
  const sync = measureSyncAgainstAudio(caps, frameDb, frameSec, thresholdDb)
  const midWord = ['midtoken', 'compound', 'okurigana', 'fragment', 'bound', 'smallkana'].reduce((a, k) => a + (forb.byReason[k] ?? 0), 0)
  return {
    label,
    captionCount: caps.length,
    pagesPerMinute: round((caps.length / windowSec) * 60, 1),
    chars: statsRounded(read.chars),
    over30chars: caps.filter((c) => c.text.length > 30).length,
    displaySec: statsRounded(read.duration),
    under2sec: caps.filter((c) => c.endSec - c.startSec < 2).length,
    charsPerSec: statsRounded(read.charsPerSec),
    startLeadSec: statsRounded(t.startLeadSec),
    endGapSec: statsRounded(t.endGapSec),
    early500ms: t.early500ms,
    late500ms: t.late500ms,
    silentOver1s: t.silentOver1s,
    laterSentenceEarlyOver1s: t.laterSentenceEarlyOver1s,
    tailLeadSec: statsRounded(t.tailLeadSec),
    tailLeadOver1s: t.tailLeadOver1s,
    totalLeadSec: round(t.totalLeadSec, 2),
    totalSilentHoldSec: round(t.totalSilentHoldSec, 2),
    audioLeadingSilentSec: statsRounded(sync.leadingSilentSec),
    audioTrailingSilentSec: statsRounded(sync.trailingSilentSec),
    silentDisplayRatio: round(sync.silentDisplayRatio, 4),
    forbiddenBoundaries: { total: forb.forbidden, midWord, particleStart: forb.byReason.particle ?? 0, byReason: forb.byReason, boundaries: forb.boundaries },
    lines: lineNaturalness(caps),
    lowConfidence: caps.filter((c) => c.lowConfidence).length,
    emphasisCaptions: caps.filter((c) => c.emphasisText).length,
  }
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env') })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (!Number.isFinite(args.start)) throw new Error('--start <sec> を指定してください（前回と同じ区間を使う）')
  if (!process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN) {
    throw new Error('FFMPEG_BIN / FFPROBE_BIN が未設定です（システムのffmpegには頼りません）')
  }

  const home = os.homedir()
  const modelPath = process.env.WHISPER_MODEL_PATH || join(home, 'Library/Caches/bemystyle-reel/whisper-models/ggml-large-v3-turbo-q8_0.bin')
  if (!existsSync(modelPath)) throw new Error('whisperモデルが見つかりません（WHISPER_MODEL_PATH）')

  // ── 既存ジョブ(読み取り専用)とその不変性ハッシュ ──
  const jobFile = resolve(EDITOR_ROOT, 'data/local_caption_videos', `${args.job.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  const jobBytesBefore = readFileSync(jobFile)
  const job = JSON.parse(jobBytesBefore.toString('utf-8'))
  const canonHash = (j) => sha256(JSON.stringify({ captions: j.captions, rawSegments: j.rawSegments, cls: j.captionClassification ?? null }))
  const canonBefore = canonHash(job)

  const legacyAll = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  const windowStart = args.start
  const windowDuration = args.duration
  const windowEnd = windowStart + windowDuration
  const legacyCaptions = legacyAll.filter((c) => c.startSec >= windowStart - 1e-6 && c.endSec <= windowEnd + 1e-6)
  const legacyLocal = legacyCaptions.map((c, i) => ({ ...c, startSec: c.startSec - windowStart, endSec: c.endSec - windowStart, displayOrder: i }))

  // ── 強調候補（比較専用データ。既存ジョブには保存しない） ──
  let emphasisCandidates = []
  if (args.emphasis) {
    const f = resolve(EDITOR_ROOT, 'data/local_caption_comparisons', args.emphasis.replace(/[^a-zA-Z0-9._-]/g, ''))
    emphasisCandidates = JSON.parse(readFileSync(f, 'utf-8')).phrases ?? []
  }

  // ── 安全確認 ──
  const inputRoots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sourceRealPath = validateSourcePath(job.sourcePath, inputRoots).realPath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  const srcBefore = statSync(sourceRealPath)
  const existingOutputs = new Map()
  {
    const { readdirSync } = await import('fs')
    for (const name of readdirSync(outputRoot)) {
      const st = statSync(join(outputRoot, name))
      existingOutputs.set(name, `${st.size}:${st.mtimeMs}`)
    }
  }
  const freeBefore = await getFreeBytes(outputRoot)

  const summary = {}
  let outputs = {}

  const { removed: tempDirRemoved } = await withTempDir('lcv-natural-cmp-', async (tmpDir) => {
    const wavPath = join(tmpDir, 'clip.wav')
    await extractAudioSegmentWav(sourceRealPath, wavPath, windowStart, windowDuration)
    const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wavPath))
    const { silences, thresholdDb } = detectSilences(samples, sampleRate, { minSilenceSec: 0.3 })
    const { db: frameDb, frameSec } = computeFrameDb(samples, sampleRate)

    // DTWトークン時刻（VADなし。DTW + 実測無音スナップが基本方針）
    const alignBase = join(tmpDir, 'align')
    const alignRun = await runWhisperCli(buildWhisperArgs({ modelPath, audioPath: wavPath, outputBase: alignBase, prompt: PUNCTUATION_PROMPT }))
    const align = parseWhisperJson(readWhisperJsonFile(`${alignBase}.json`))

    const natural = buildNaturalCaptions({
      legacyCaptions,
      windowStartSec: windowStart,
      windowDurationSec: windowDuration,
      tokens: align.tokens,
      silences,
      emphasisCandidates,
    })
    const semantic = buildSemanticCaptions({
      legacyCaptions,
      windowStartSec: windowStart,
      windowDurationSec: windowDuration,
      tokens: align.tokens,
      silences,
    })

    const canonicalText = natural.canonicalText
    const problems = []
    if (natural.captions.map((c) => c.text).join('') !== canonicalText) problems.push('本文が正本と一致しません')
    if (natural.captions.some((c) => /[\r\n]|\\N/.test(c.text))) problems.push('本文に改行/\\Nが混入')
    if (natural.captions.some((c) => c.lines.length > 2)) problems.push('3行以上のcaptionがあります')
    if (natural.captions.some((c) => c.text.length > 30)) problems.push('30文字を超えるcaptionがあります')

    const args2 = [windowDuration]
    const rawTiming = natural.timing // 全方式を同じ「DTW文字時刻」で採点する
    const legacyView = withIndex(legacyLocal)
    const semanticView = withIndex(semantic.captions)
    const naturalView = natural.captions
    const results = {
      legacy: summarize('legacy', legacyView, rawTiming, silences, frameDb, frameSec, thresholdDb, ...args2),
      semantic: summarize('semantic', semanticView, rawTiming, silences, frameDb, frameSec, thresholdDb, ...args2),
      natural: summarize('natural', naturalView, rawTiming, silences, frameDb, frameSec, thresholdDb, ...args2),
    }
    const emphasisLens = natural.emphasis.appliedLengths
    const metrics = {
      window: { startSec: round(windowStart, 2), endSec: round(windowEnd, 2), durationSec: windowDuration },
      alignment: {
        canonicalSpeechChars: natural.alignment.canonicalSpeechCount,
        matchedChars: natural.alignment.matchedCount,
        matchRatio: round(natural.alignment.matchedCount / Math.max(1, natural.alignment.canonicalSpeechCount), 4),
        dtwTokens: align.tokens.length,
        silencesOver0_3s: silences.length,
      },
      results,
      emphasis: {
        candidates: emphasisCandidates.length,
        applied: natural.emphasis.appliedCount,
        avgChars: emphasisLens.length ? round(emphasisLens.reduce((a, b) => a + b, 0) / emphasisLens.length, 1) : 0,
        rejected: natural.emphasis.rejected,
      },
      invariantProblems: problems,
      whisperAlignMs: alignRun.elapsedMs,
    }

    // ── 改善版の比較動画のみ生成（旧・semanticは既存の動画を再利用。上書き/再生成しない） ──
    if (!args.skipRender && problems.length === 0) {
      const assPath = join(tmpDir, 'natural.ass')
      writeFileSync(assPath, buildAssContent({ width: job.width, height: job.height, captions: naturalView }), 'utf-8')
      const outputPath = buildComparisonOutputPath('natural_timing', outputRoot, sourceRealPath)
      try {
        await renderPreviewClip({ sourceRealPath, assPath, outputPath, startSec: windowStart, clipDurationSec: windowDuration })
      } catch (err) {
        rmSync(outputPath, { force: true })
        throw err
      }
      const probe = await runFfprobe(outputPath)
      outputs = { natural_timing: { filename: outputPath.split('/').pop(), durationSec: round(probe.durationSec, 3), sizeBytes: statSync(outputPath).size } }
    }

    // ── 検証用の別データとして保存（git管理外 editor/data/。本文を含むため標準出力には出さない） ──
    const saveDir = resolve(EDITOR_ROOT, 'data/local_caption_comparisons')
    mkdirSync(saveDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const saveName = `natural_timing_comparison_${stamp}.json`
    writeFileSync(
      resolve(saveDir, saveName),
      JSON.stringify({ createdAt: new Date().toISOString(), jobId: job.id, metrics, silences, naturalCaptions: naturalView, outputs }, null, 2),
      'utf-8',
    )
    summary.metrics = metrics
    summary.savedAs = saveName
  })

  // ── 後片付けと不変性の確認 ──
  const srcAfter = statSync(sourceRealPath)
  const jobAfter = JSON.parse(readFileSync(jobFile, 'utf-8'))
  const { readdirSync } = await import('fs')
  const outputsAfter = new Map(readdirSync(outputRoot).map((n) => [n, `${statSync(join(outputRoot, n)).size}:${statSync(join(outputRoot, n)).mtimeMs}`]))
  const modifiedExisting = [...existingOutputs].filter(([n, v]) => outputsAfter.get(n) !== v).map(([n]) => n)
  const newFiles = [...outputsAfter.keys()].filter((n) => !existingOutputs.has(n))
  summary.outputs = outputs
  summary.safety = {
    sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
    jobFileByteIdentical: sha256(jobBytesBefore) === sha256(readFileSync(jobFile)),
    captionsRawSegmentsClassificationUnchanged: canonBefore === canonHash(jobAfter),
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
  console.error(`[localCaptionNaturalTimingComparison] ${err.message}`)
  process.exit(1)
})
