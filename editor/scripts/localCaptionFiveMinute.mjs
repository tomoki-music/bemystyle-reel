// ローカルAIテロップ動画: 5分区間の実運用に近い検証ランナー（4ステージ）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT / OPENAI_API_KEY を使用）:
//   node scripts/localCaptionFiveMinute.mjs select  --job <jobId> [--reference-start 671.48 --reference-sec 60]
//   node scripts/localCaptionFiveMinute.mjs align   --job <jobId> [--start <sec>]
//   node scripts/localCaptionFiveMinute.mjs analyze --job <jobId> --allow-api        # gpt-4o-mini を1回だけ
//   node scripts/localCaptionFiveMinute.mjs render  --job <jobId> [--stills-dir <dir>] [--mobile-widths 390,430]
//   node scripts/localCaptionFiveMinute.mjs check   --job <jobId> [--stills-dir <dir>]      # AI結果なし・動画は生成しない（字幕サイズ/位置の実描画確認）
//
// 安全方針:
// - Whisper APIは呼ばない（ローカルのwhisper.cppのみ）。AI分析(analyze)だけが gpt-4o-mini を「1回だけ」呼ぶ。
//   自動retryなし。送信済みマーカーがあれば再送しない。結果は保存後に再利用する。
// - 既存ジョブJSON・元動画・既存の動画は読み取り専用/非変更。実行前後でハッシュ/サイズ/mtimeを比較する。
// - 一時音声・一時ASS・whisper出力は一時ディレクトリに作り、終了時に必ず削除する。
// - 動画は VIDEO_OUTPUT_ROOT 配下へ「一時ファイルへ書き出し → 成功後にrename」で保存する（不完全なMP4を残さない）。
// - 標準出力・保存データに絶対パス・APIキーを出さない。字幕本文・テーマ名・強調語・AI応答は標準出力へ出さない
//   （中間データは editor/data/ = git管理外にのみ保存する）。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync, renameSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import dotenv from 'dotenv'

import { validateSourcePath, validateOutputRoot } from '../server/lib/pathValidator.mjs'
import { extractAudioSegmentWav, renderPreviewClip, runFfprobe } from '../server/lib/ffmpegRunner.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { buildAssContent, planCaptionFits, getCaptionStyleDefs, CAPTION_FONT_SCALE } from '../server/lib/captionStyles.mjs'
import { buildComparisonOutputPath } from '../server/lib/outputNaming.mjs'
import { buildWhisperArgs, runWhisperCli, parseWhisperJson, readWhisperJsonFile, PUNCTUATION_PROMPT } from '../server/lib/whisperLocal.mjs'
import { readWavPcm16Mono, detectSilences, computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { buildNaturalCaptions } from '../server/lib/naturalCaptionPipeline.mjs'
import { planChunksFromRawSegments, alignCanonicalByChunks } from '../server/lib/chunkedAlignment.mjs'
import { selectFiveMinuteWindow, rerankWithVisual, darkMassMotion } from '../server/lib/windowSelector.mjs'
import { boundaryProblems } from '../server/lib/japaneseText.mjs'
import { measureSyncAgainstAudio, measureCaptionTiming, readabilityStats, countForbiddenBoundaries, stats } from '../server/lib/comparisonMetrics.mjs'
import { measureCaptionRender } from '../server/lib/assRenderMeasure.mjs'
import { getCaptionFitLimits } from '../server/lib/captionFit.mjs'
import { runAnalysisOnce, loadAnalysis, materializeAnalysis, fingerprintCaptions, AnalysisError } from '../server/lib/topicAnalysis.mjs'
import { fitTopicTitle } from '../server/lib/topicAss.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const EDITOR_ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/five_minute')
const WINDOW_SEC = 300

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const rounded = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))
const snapshotDir = (dir) => new Map(readdirSync(dir).map((n) => [n, `${statSync(join(dir, n)).size}:${statSync(join(dir, n)).mtimeMs}`]))

function parseArgs(argv) {
  const out = { stage: argv[0], mobileWidths: [], referenceSec: 60 }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') out.job = argv[++i]
    else if (a === '--start') out.start = Number(argv[++i])
    else if (a === '--reference-start') out.referenceStart = Number(argv[++i])
    else if (a === '--reference-sec') out.referenceSec = Number(argv[++i])
    else if (a === '--allow-api') out.allowApi = true
    else if (a === '--stills-dir') out.stillsDir = argv[++i]
    else if (a === '--mobile-widths') out.mobileWidths = argv[++i].split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
  }
  return out
}

/** ジョブを読み取り専用で読み、不変性確認用のハッシュを返す。 */
function loadJob(jobId) {
  const file = resolve(EDITOR_ROOT, 'data/local_caption_videos', `${String(jobId).replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  const bytes = readFileSync(file)
  const job = JSON.parse(bytes.toString('utf-8'))
  const canon = (j) => sha256(JSON.stringify({ captions: j.captions, rawSegments: j.rawSegments, cls: j.captionClassification ?? null }))
  return { file, bytes, job, canon }
}

function safetyContext(job) {
  const inputRoots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sourceRealPath = validateSourcePath(job.sourcePath, inputRoots).realPath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  return { sourceRealPath, outputRoot, srcBefore: statSync(sourceRealPath), existingOutputs: snapshotDir(outputRoot) }
}

/** キャプション本文の連結（正本）と、窓に完全に入るレガシーcaption。 */
function windowCaptions(job, startSec) {
  const endSec = startSec + WINDOW_SEC
  const legacy = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder).filter((c) => c.startSec >= startSec - 1e-6 && c.endSec <= endSec + 1e-6)
  const firstIdx = job.captions.findIndex((c) => c.id === legacy[0].id)
  const globalOffset = job.captions.slice(0, firstIdx).reduce((a, c) => a + c.text.length, 0)
  return { legacy, endSec, globalOffset }
}

// ────────────────────────────────────────────────────────────────
// select: 連続300秒の機械的な選定
// ────────────────────────────────────────────────────────────────
async function stageSelect(args) {
  const { job } = loadJob(args.job)
  const ref = Number.isFinite(args.referenceStart) ? { startSec: args.referenceStart, endSec: args.referenceStart + args.referenceSec } : null
  const sel = selectFiveMinuteWindow(job, { referenceWindow: ref })
  const { sourceRealPath } = safetyContext(job)
  // 上位3候補だけ、映像の変化量(顔の位置・姿勢の変化の代理指標)を12点サンプルして加点する（元動画は読み取りのみ）。
  const top = sel.candidates.filter((c) => c.eligible).slice(0, 3)
  const visual = {}
  for (const c of top) {
    const frames = []
    for (let k = 0; k < 12; k++) {
      const t = c.startSec + 5 + (k * (WINDOW_SEC - 10)) / 11
      const { stdout } = await execFileAsync(process.env.FFMPEG_BIN, ['-loglevel', 'error', '-ss', String(t), '-i', sourceRealPath, '-frames:v', '1', '-vf', 'scale=48:27', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 48 * 27 * 2 })
      frames.push(new Uint8Array(stdout))
    }
    visual[c.startSec] = darkMassMotion(frames, 48, 27)
  }
  const ranked = rerankWithVisual(sel.candidates, visual)
  const best = ranked.find((c) => c.eligible)
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(resolve(DATA_DIR, 'five_minute_selection.json'), JSON.stringify({ jobId: job.id, selectedAt: new Date().toISOString(), best, top: ranked.slice(0, 5) }, null, 2), 'utf-8')
  console.log(JSON.stringify({
    stage: 'select',
    candidatesTotal: sel.candidates.length,
    eligible: sel.candidates.filter((c) => c.eligible).length,
    selected: best && { startSec: round(best.startSec, 2), endSec: round(best.endSec, 2), score: round(best.score, 1), visualScore: round(best.visualScore ?? 0, 3), metrics: best.metrics },
    runnersUp: ranked.slice(1, 4).map((c) => ({ startSec: round(c.startSec, 2), score: round(c.score, 1), visualScore: round(c.visualScore ?? 0, 3), transitions: c.metrics.transitions })),
  }, null, 2))
}

// ────────────────────────────────────────────────────────────────
// align: ローカルwhisper.cpp + 区間単位アラインメント + 自然なページ分割
// ────────────────────────────────────────────────────────────────
async function stageAlign(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const startSec = Number.isFinite(args.start) ? args.start : JSON.parse(readFileSync(resolve(DATA_DIR, 'five_minute_selection.json'), 'utf-8')).best.startSec
  if (!process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN) throw new Error('FFMPEG_BIN / FFPROBE_BIN が未設定です')
  const modelPath = process.env.WHISPER_MODEL_PATH || join(os.homedir(), 'Library/Caches/bemystyle-reel/whisper-models/ggml-large-v3-turbo-q8_0.bin')
  if (!existsSync(modelPath)) throw new Error('whisperモデルが見つかりません（WHISPER_MODEL_PATH）')

  const { sourceRealPath, outputRoot, srcBefore, existingOutputs } = safetyContext(job)
  const freeBefore = await getFreeBytes(outputRoot)
  const { legacy, endSec, globalOffset } = windowCaptions(job, startSec)
  const canonicalText = legacy.map((c) => c.text).join('')
  const rawInWindow = job.rawSegments.filter((s) => s.endSec > startSec && s.startSec < endSec)

  // メモリ: このプロセスのRSSをサンプルし、whisperの子プロセス最大RSSは /usr/bin/time -l から取る。
  let peakNodeRss = process.memoryUsage().rss
  const sampler = setInterval(() => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss) }, 500)
  sampler.unref()
  const t0 = Date.now()
  const timings = {}
  let result

  const { removed: tempDirRemoved } = await withTempDir('lcv-five-min-', async (tmpDir) => {
    const wavPath = join(tmpDir, 'clip.wav')
    let t = Date.now()
    await extractAudioSegmentWav(sourceRealPath, wavPath, startSec, WINDOW_SEC)
    const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wavPath))
    const { silences, thresholdDb } = detectSilences(samples, sampleRate, { minSilenceSec: 0.3 })
    const { db: frameDb, frameSec } = computeFrameDb(samples, sampleRate)
    timings.audioMs = Date.now() - t

    // whisper.cpp（DTW + -nfa。VADなし）。/usr/bin/time -l 経由で起動して子プロセスの最大RSSを得る。
    t = Date.now()
    const outBase = join(tmpDir, 'align')
    const wargs = buildWhisperArgs({ modelPath, audioPath: wavPath, outputBase: outBase, prompt: PUNCTUATION_PROMPT })
    const spawnFn = (bin, a, o) => spawn('/usr/bin/time', ['-l', bin, ...a], o)
    const run = await runWhisperCli(wargs, { spawnFn, timeoutMs: 40 * 60 * 1000 })
    const align = parseWhisperJson(readWhisperJsonFile(`${outBase}.json`))
    timings.whisperMs = run.elapsedMs

    // 区間単位のアラインメント（rawSegment単位。5分全体を1つのLCSにしない）
    t = Date.now()
    const chunks = planChunksFromRawSegments({ rawSegments: job.rawSegments, globalOffset, textLength: canonicalText.length, windowStartSec: startSec, windowDurationSec: WINDOW_SEC })
    const timing = alignCanonicalByChunks({ canonicalText, chunks, tokens: align.tokens, silences, bounds: { startSec: 0, endSec: WINDOW_SEC } })
    const natural = buildNaturalCaptions({ legacyCaptions: legacy, windowStartSec: startSec, windowDurationSec: WINDOW_SEC, tokens: align.tokens, silences, timing })
    timings.alignAndSplitMs = Date.now() - t

    const caps = natural.captions
    const problems = []
    if (caps.map((c) => c.text).join('') !== canonicalText) problems.push('本文が正本と一致しません')
    if (caps.some((c) => /[\r\n]|\\N/.test(c.text))) problems.push('本文に改行/\\Nが混入')
    if (caps.some((c) => c.lines.length > 2)) problems.push('3行以上のcaptionがあります')
    if (caps.some((c) => c.lines.join('') !== c.text)) problems.push('linesが本文と一致しません')
    if (caps.some((c) => c.text.length > 30)) problems.push('30文字を超えるcaptionがあります')

    // ── 測定（承認済みの自然タイミング方式と同じ指標） ──
    const tm = measureCaptionTiming(caps, natural.timing, silences)
    const forb = countForbiddenBoundaries(caps.map((c) => c.text))
    const read = readabilityStats(caps)
    const sync = measureSyncAgainstAudio(caps, frameDb, frameSec, thresholdDb)
    const midWord = ['midtoken', 'compound', 'okurigana', 'fragment', 'bound', 'smallkana'].reduce((a, k) => a + (forb.byReason[k] ?? 0), 0)
    let twoLine = 0
    let badBreaks = 0
    for (const c of caps) {
      if (c.lines.length === 2) {
        twoLine += 1
        const p = boundaryProblems(c.lines[0], c.lines[1])
        if (p.midWord || p.particleStart) badBreaks += 1
      }
    }
    const lineLens = caps.flatMap((c) => c.lines.map((l) => Array.from(l).length))
    const metrics = {
      window: { startSec: round(startSec, 2), endSec: round(endSec, 2), durationSec: WINDOW_SEC },
      canonicalChars: canonicalText.length,
      rawSegmentsInWindow: rawInWindow.length,
      alignment: {
        canonicalSpeechChars: natural.alignment.canonicalSpeechCount,
        matchedChars: natural.alignment.matchedCount,
        matchRatio: round(natural.alignment.matchedCount / Math.max(1, natural.alignment.canonicalSpeechCount), 4),
        dtwTokens: align.tokens.length,
        chunkCount: timing.chunks.length,
        divergedChunks: timing.chunks.filter((c) => c.fallback).length,
        chunkMatchRatio: rounded(stats(timing.chunks.map((c) => c.matchRatio))),
        silencesOver0_3s: silences.length,
      },
      captions: {
        count: caps.length,
        pagesPerMinute: round((caps.length / WINDOW_SEC) * 60, 1),
        chars: rounded(read.chars),
        over30chars: caps.filter((c) => c.text.length > 30).length,
        displaySec: rounded(read.duration),
        under2sec: caps.filter((c) => c.endSec - c.startSec < 2).length,
        lineChars: rounded(stats(lineLens)),
        maxLineChars: Math.max(...lineLens),
        twoLinePages: twoLine,
        unnaturalLineBreaks: badBreaks,
        lowConfidence: caps.filter((c) => c.lowConfidence).length,
      },
      timing: {
        early500ms: tm.early500ms,
        late500ms: tm.late500ms,
        silentOver1s: tm.silentOver1s,
        laterSentenceEarlyOver1s: tm.laterSentenceEarlyOver1s,
        startLeadSec: rounded(tm.startLeadSec),
        endGapSec: rounded(tm.endGapSec),
        tailLeadOver1s: tm.tailLeadOver1s,
        silentDisplayRatio: round(sync.silentDisplayRatio, 4),
        audioLeadingSilentSec: rounded(sync.leadingSilentSec),
        audioTrailingSilentSec: rounded(sync.trailingSilentSec),
      },
      boundaries: { forbidden: forb.forbidden, midWord, particleStart: forb.byReason.particle ?? 0, byReason: forb.byReason },
      invariantProblems: problems,
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const key = `five_minute_${Math.round(startSec)}`
    result = { key, metrics, run, problems, stamp, caps }
    if (problems.length === 0) {
      mkdirSync(DATA_DIR, { recursive: true })
      // 中間データ（字幕本文を含む）は git管理外の editor/data/ にのみ保存する。標準出力へは出さない。
      writeFileSync(
        resolve(DATA_DIR, `${key}.pages.json`),
        JSON.stringify({ createdAt: new Date().toISOString(), jobId: job.id, window: metrics.window, canonicalSha256: sha256(canonicalText), captions: caps.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: c.text, lines: c.lines, captionType: 'normal', emphasisText: null, lowConfidence: c.lowConfidence, displayOrder: c.displayOrder })), silences, metrics }, null, 2),
        'utf-8',
      )
    }
  })
  clearInterval(sampler)

  const srcAfter = statSync(sourceRealPath)
  const outputsAfter = snapshotDir(outputRoot)
  console.log(JSON.stringify({
    stage: 'align',
    pagesFile: result.problems.length === 0 ? `${result.key}.pages.json` : null,
    metrics: result.metrics,
    performance: {
      totalMs: Date.now() - t0,
      ...timings,
      whisperCliMaxRssMB: result.run.maxRssBytes ? round(result.run.maxRssBytes / 1e6, 0) : null,
      nodePeakRssMB: round(peakNodeRss / 1e6, 0),
    },
    safety: {
      sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
      jobFileByteIdentical: sha256(bytes) === sha256(readFileSync(file)),
      captionsRawSegmentsClassificationUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))),
      outputRootUnchanged: [...existingOutputs].every(([n, v]) => outputsAfter.get(n) === v) && outputsAfter.size === existingOutputs.size,
      tempDirRemoved,
      freeBytesBefore: freeBefore,
      freeBytesAfter: await getFreeBytes(outputRoot),
      externalWhisperApiCalled: false,
      externalAiApiCalled: false,
    },
  }, null, 2))
  if (result.problems.length) process.exitCode = 1
}

// ────────────────────────────────────────────────────────────────
// analyze: gpt-4o-mini を1回だけ（テーマ + 強調）
// ────────────────────────────────────────────────────────────────
async function stageAnalyze(args) {
  if (!args.allowApi) throw new Error('AI分析には --allow-api が必要です（gpt-4o-mini を1回だけ呼びます）')
  const { job } = loadJob(args.job)
  const startSec = Number.isFinite(args.start) ? args.start : JSON.parse(readFileSync(resolve(DATA_DIR, 'five_minute_selection.json'), 'utf-8')).best.startSec
  const key = `five_minute_${Math.round(startSec)}`
  const pages = JSON.parse(readFileSync(resolve(DATA_DIR, `${key}.pages.json`), 'utf-8'))
  if (pages.jobId !== job.id) throw new Error('pagesのjobIdが一致しません')
  try {
    const r = await runAnalysisOnce({ dir: DATA_DIR, key, captions: pages.captions, apiKey: process.env.OPENAI_API_KEY })
    const a = r.analysis
    console.log(JSON.stringify({
      stage: 'analyze',
      model: a.model,
      apiRequestsThisRun: r.requestCount,
      reusedSavedResult: r.reused,
      topics: a.topics.length,
      emphasis: a.emphasis.length,
      warnings: r.warnings,
      savedAs: `${key}.analysis.json`,
    }, null, 2))
  } catch (err) {
    if (err instanceof AnalysisError) {
      console.error(`[localCaptionFiveMinute] AI分析を停止しました (${err.kind}): ${err.message}`)
      process.exit(2)
    }
    throw err
  }
}

// ────────────────────────────────────────────────────────────────
// render: 5分動画の生成と機械的な検証
// ────────────────────────────────────────────────────────────────
async function ffmpegNullDecode(sourceOrOut, startSec, durSec) {
  await execFileAsync(process.env.FFMPEG_BIN, ['-v', 'error', '-ss', String(startSec), '-i', sourceOrOut, '-t', String(durSec), '-f', 'null', '-'])
}

async function stageRender(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const startSec = Number.isFinite(args.start) ? args.start : JSON.parse(readFileSync(resolve(DATA_DIR, 'five_minute_selection.json'), 'utf-8')).best.startSec
  const key = `five_minute_${Math.round(startSec)}`
  const pagesPath = resolve(DATA_DIR, `${key}.pages.json`)
  const pagesBytes = readFileSync(pagesPath)
  const pages = JSON.parse(pagesBytes.toString('utf-8'))
  // check ステージは AI 結果なし・動画なし。render は保存済みの分析結果を再利用する（APIは呼ばない）。
  const checkOnly = args.stage === 'check'
  const analysisFile = resolve(DATA_DIR, `${key}.analysis.json`)
  const analysisBytes = checkOnly ? Buffer.alloc(0) : readFileSync(analysisFile)
  const analysis = checkOnly ? { topics: [], emphasis: [] } : loadAnalysis(DATA_DIR, key)
  if (!checkOnly && analysis.captionsFingerprint !== fingerprintCaptions(pages.captions)) throw new Error('分析結果が現在のcaption列と一致しません')
  const W = job.width
  const H = job.height
  const original = pages.captions
  const mat = materializeAnalysis(analysis, original)
  const captions = mat.captions
  const topicSections = mat.topicSections
  const captionHashBefore = sha256(JSON.stringify(original.map((c) => [c.id, c.startSec, c.endSec, c.text, c.lines])))

  const problems = []
  if (captions.some((c) => c.text !== original.find((o) => o.id === c.id).text)) problems.push('分析の反映でcaption本文が変わりました')
  if (captions.some((c) => c.emphasisText && !c.text.includes(c.emphasisText))) problems.push('強調語が本文に存在しません')
  const fitPlan = planCaptionFits(captions, W, H)
  const limits = getCaptionFitLimits(W, H)
  if (fitPlan.some((f) => !f.fits)) problems.push('動的縮小(下限)でも使用可能幅に収まらない字幕があります')
  if (fitPlan.some((f) => f.size < limits.minSizePx)) problems.push('字幕サイズが下限を下回っています')
  const topicFits = topicSections.map((t) => fitTopicTitle(t.title, W, H))

  const { sourceRealPath, outputRoot, srcBefore, existingOutputs } = safetyContext(job)
  const freeBefore = await getFreeBytes(outputRoot)
  const summary = {}
  let outputs = {}
  const stillsWritten = []
  const t0 = Date.now()

  const { removed: tempDirRemoved } = await withTempDir('lcv-five-min-render-', async (tmpDir) => {
    // ── 実描画による字幕幅の測定（全caption） ──
    const rows = []
    for (const [i, c] of captions.entries()) {
      const r = await measureCaptionRender({ caption: c, width: W, height: H, tmpDir, ffmpegBin: process.env.FFMPEG_BIN, name: `r${i}` })
      rows.push({ c, plan: fitPlan[i], r })
    }
    const usage = rows.map((x) => x.r.usageRatio)
    const renderMeasure = {
      captionCount: rows.length,
      usagePercent: { min: round(Math.min(...usage) * 100, 1), max: round(Math.max(...usage) * 100, 1), mean: round((usage.reduce((a, b) => a + b, 0) / usage.length) * 100, 1) },
      maxMeasuredWidthPx: Math.max(...rows.map((x) => x.r.measuredWidthPx)),
      minSideMarginPx: Math.min(...rows.map((x) => Math.min(x.r.leftMarginPx, x.r.rightMarginPx))),
      overflowCount: rows.filter((x) => x.r.overflow).length,
      maxLineCount: Math.max(...rows.map((x) => x.r.lineCount)),
      minBottomMarginPx: Math.min(...rows.map((x) => x.r.bottomMarginPx)),
      twoLineTopPercentMin: round((Math.min(...rows.filter((x) => x.r.lineCount === 2).map((x) => x.r.topPx)) / H) * 100, 1),
    }
    const minMargin = Math.floor(W * 0.06)
    if (rows.some((x) => x.r.overflow || Math.min(x.r.leftMarginPx, x.r.rightMarginPx) < minMargin || x.r.usageRatio > 0.88)) problems.push('実描画で、はみ出し・左右6%未満の余白・使用幅88%超の字幕があります')

    // ── 元音声との機械的な同期検証用（無音区間の再取得） ──
    const wavPath = join(tmpDir, 'clip.wav')
    await extractAudioSegmentWav(sourceRealPath, wavPath, startSec, WINDOW_SEC)
    const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wavPath))
    const { thresholdDb } = detectSilences(samples, sampleRate, { minSilenceSec: 0.3 })
    const { db: frameDb, frameSec } = computeFrameDb(samples, sampleRate)
    const sync = measureSyncAgainstAudio(captions, frameDb, frameSec, thresholdDb)

    let verification = null
    if (problems.length === 0 && checkOnly && args.stillsDir) {
      // 動画は生成せず、実映像の1フレームへ字幕を焼き込んだ静止画だけを作る（位置・サイズ・顔との距離の確認用）
      mkdirSync(args.stillsDir, { recursive: true })
      const assPath = join(tmpDir, 'check.ass')
      writeFileSync(assPath, buildAssContent({ width: W, height: H, captions }, { topicSections, topicAccentMode: 'label' }), 'utf-8')
      const esc = assPath.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
      const picks = [...captions.filter((c) => c.lines.length === 2)].filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 8)) === 0).slice(0, 8)
      for (const c of picks) {
        const png = join(args.stillsDir, `check_${c.id.replace('natural-', '')}.png`)
        await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-ss', String(startSec), '-i', sourceRealPath, '-ss', String(round((c.startSec + c.endSec) / 2, 2)), '-vf', `ass=${esc}`, '-frames:v', '1', png])
        stillsWritten.push(png.split('/').pop())
      }
      // 長文縮小の確認用: 縮小が発動する合成の長文字幕（24文字1行→94px）を実映像へ焼き込む
      const long = { startSec: 0, endSec: 1, text: 'あ'.repeat(24), lines: ['あ'.repeat(24)], captionType: 'normal', emphasisText: null, displayOrder: 0 }
      const longAss = join(tmpDir, 'synthetic_long.ass')
      writeFileSync(longAss, buildAssContent({ width: W, height: H, captions: [long] }), 'utf-8')
      const escL = longAss.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
      await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-ss', String(startSec + 100), '-i', sourceRealPath, '-ss', '0.2', '-vf', `ass=${escL}`, '-frames:v', '1', join(args.stillsDir, 'check_synthetic_shrink.png')])
      stillsWritten.push('check_synthetic_shrink.png')
    }
    if (problems.length === 0 && !checkOnly) {
      const assPath = join(tmpDir, 'five_minute.ass')
      writeFileSync(assPath, buildAssContent({ width: W, height: H, captions }, { topicSections, topicAccentMode: 'label' }), 'utf-8')
      const finalPath = buildComparisonOutputPath('five_minute_topics', outputRoot, sourceRealPath)
      const partialPath = finalPath.replace(/\.mp4$/, '.partial.mp4')
      try {
        await renderPreviewClip({ sourceRealPath, assPath, outputPath: partialPath, startSec, clipDurationSec: WINDOW_SEC })
        const probe = await runFfprobe(partialPath)
        if (Math.abs(probe.durationSec - WINDOW_SEC) > 0.5) throw new Error('動画尺が300秒ではありません')
        renameSync(partialPath, finalPath) // 成功後にだけ完成品の名前へ
      } catch (err) {
        rmSync(partialPath, { force: true })
        throw err
      }
      const probe = await runFfprobe(finalPath)
      outputs = { five_minute_topics: { filename: finalPath.split('/').pop(), durationSec: round(probe.durationSec, 3), sizeBytes: statSync(finalPath).size } }

      // 音声・デコードの機械検証
      const { stderr: volLog } = await execFileAsync(process.env.FFMPEG_BIN, ['-hide_banner', '-i', finalPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).catch((e) => ({ stderr: e.stderr ?? '' }))
      const meanDb = /mean_volume: (-?[\d.]+) dB/.exec(volLog)?.[1]
      const { stderr: silLog } = await execFileAsync(process.env.FFMPEG_BIN, ['-hide_banner', '-i', finalPath, '-vn', '-af', 'silencedetect=n=-50dB:d=2', '-f', 'null', '-']).catch((e) => ({ stderr: e.stderr ?? '' }))
      const longSilences = (silLog.match(/silence_start/g) ?? []).length
      let decodeOk = true
      for (const t of [0, WINDOW_SEC / 2 - 1, WINDOW_SEC - 3]) {
        try { await ffmpegNullDecode(finalPath, t, 2) } catch { decodeOk = false }
      }
      verification = {
        hasAudioStream: probe.hasAudio,
        audioCodec: probe.audioCodec,
        audioMeanVolumeDb: meanDb ? Number(meanDb) : null,
        silencesOver2sInOutputAudio: longSilences,
        decodedStartMiddleEnd: decodeOk,
        durationSec: round(probe.durationSec, 3),
      }

      // 代表フレーム（完成した動画から抽出。stills-dir は git 管理外を指定する）
      if (args.stillsDir) {
        mkdirSync(args.stillsDir, { recursive: true })
        const cap2 = captions.find((c) => c.lines.length === 2 && !c.emphasisText) ?? captions.find((c) => c.lines.length === 2)
        const capEmph = captions.find((c) => c.emphasisText)
        const times = [
          ['start', 1.5],
          ['q25', WINDOW_SEC * 0.25],
          ['q50', WINDOW_SEC * 0.5],
          ['q75', WINDOW_SEC * 0.75],
          ['end', WINDOW_SEC - 2.5],
          ...(cap2 ? [['twoline', (cap2.startSec + cap2.endSec) / 2]] : []),
          ...(capEmph ? [['emphasis', (capEmph.startSec + capEmph.endSec) / 2]] : []),
          ...topicSections.slice(1).flatMap((t, i) => [[`topic${i + 2}_before`, Math.max(0, t.startSec - 0.1)], [`topic${i + 2}_after`, t.startSec + 0.6]]),
          ...topicSections.map((t, i) => [`topic${i + 1}_mid`, (t.startSec + t.endSec) / 2]),
        ]
        for (const [name, t] of times) {
          const png = join(args.stillsDir, `frame_${name}.png`)
          await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-ss', String(round(t, 2)), '-i', finalPath, '-frames:v', '1', png])
          stillsWritten.push(`frame_${name}.png`)
          for (const w of args.mobileWidths) {
            await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:-2:flags=lanczos`, png.replace(/\.png$/, `_m${w}.png`)])
          }
        }
        // 長文縮小の確認用: 実映像の1フレームに、縮小が発動する合成の長文字幕を焼き込む（完成動画には含めない）
        const long = { startSec: 0, endSec: 1, text: 'あ'.repeat(24), lines: ['あ'.repeat(24)], captionType: 'normal', emphasisText: null, displayOrder: 0 }
        const longAss = join(tmpDir, 'synthetic_long.ass')
        writeFileSync(longAss, buildAssContent({ width: W, height: H, captions: [long] }, { topicSections: [] }), 'utf-8')
        const esc = longAss.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
        const png = join(args.stillsDir, 'frame_synthetic_shrink.png')
        await execFileAsync(process.env.FFMPEG_BIN, ['-y', '-loglevel', 'error', '-ss', String(startSec + 100), '-i', sourceRealPath, '-ss', '0.2', '-vf', `ass=${esc}`, '-frames:v', '1', png])
        stillsWritten.push('frame_synthetic_shrink.png')
      }
    }

    const sizeHist = fitPlan.reduce((h, f) => ({ ...h, [f.size]: (h[f.size] ?? 0) + 1 }), {})
    summary.metrics = {
      window: pages.window,
      captionCount: captions.length,
      fontSizesPx: { normal: getCaptionStyleDefs(W, H).normal.fontsize, main: getCaptionStyleDefs(W, H).main.fontsize, sub: getCaptionStyleDefs(W, H).sub.fontsize, emphasis: getCaptionStyleDefs(W, H).emphasis.fontsize, scale: CAPTION_FONT_SCALE },
      shrink: { shrunkCount: fitPlan.filter((f) => f.shrunk).length, sizeDistributionPx: sizeHist, allFit: fitPlan.every((f) => f.fits), minSizePx: Math.min(...fitPlan.map((f) => f.size)) },
      renderMeasure,
      topics: topicSections.map((t, i) => ({ id: t.id, source: t.source, startSec: round(t.startSec, 2), endSec: round(t.endSec, 2), displaySec: round(t.endSec - t.startSec, 1), titleChars: Array.from(t.title).length, lines: topicFits[i].lines.length, titlePx: topicFits[i].titleSize, shrunk: topicFits[i].shrunk, fits: topicFits[i].fits })),
      emphasis: { count: mat.emphasisCount, chars: captions.filter((c) => c.emphasisText).map((c) => Array.from(c.emphasisText).length) },
      audioSync: {
        early500ms: pages.metrics.timing.early500ms,
        late500ms: pages.metrics.timing.late500ms,
        silentDisplayRatioNow: round(sync.silentDisplayRatio, 4),
        silentDisplayRatioAtAlign: pages.metrics.timing.silentDisplayRatio,
        audioLeadingSilentSecMax: round(sync.leadingSilentSec.max, 3),
        audioTrailingSilentSecMax: round(sync.trailingSilentSec.max, 3),
        silentOver1s: pages.metrics.timing.silentOver1s,
      },
      verification,
      invariantProblems: problems,
    }
    summary.stillsWritten = stillsWritten
  })

  const srcAfter = statSync(sourceRealPath)
  const outputsAfter = snapshotDir(outputRoot)
  const modifiedExisting = [...existingOutputs].filter(([n, v]) => outputsAfter.get(n) !== v).map(([n]) => n)
  const newFiles = [...outputsAfter.keys()].filter((n) => !existingOutputs.has(n))
  summary.outputs = outputs
  summary.performance = { totalMs: Date.now() - t0 }
  summary.safety = {
    sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
    jobFileByteIdentical: sha256(bytes) === sha256(readFileSync(file)),
    captionsRawSegmentsClassificationUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))),
    pagesDataByteIdentical: sha256(pagesBytes) === sha256(readFileSync(pagesPath)),
    analysisDataByteIdentical: checkOnly ? null : sha256(analysisBytes) === sha256(readFileSync(analysisFile)),
    captionTextAndTimingHashUnchanged: captionHashBefore === sha256(JSON.stringify(original.map((c) => [c.id, c.startSec, c.endSec, c.text, c.lines]))),
    existingOutputFilesModifiedOrRemoved: modifiedExisting.length,
    newOutputFileCount: newFiles.length,
    newOutputFiles: newFiles,
    partialFilesLeft: newFiles.filter((n) => n.includes('.partial')).length,
    tempDirRemoved,
    freeBytesBefore: freeBefore,
    freeBytesAfter: await getFreeBytes(outputRoot),
    apiRequestsThisStage: 0,
    externalAiApiCalled: false,
  }
  console.log(JSON.stringify(summary, null, 2))
  if (problems.length) process.exitCode = 1
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (args.stage === 'select') return stageSelect(args)
  if (args.stage === 'align') return stageAlign(args)
  if (args.stage === 'analyze') return stageAnalyze(args)
  if (args.stage === 'render' || args.stage === 'check') return stageRender(args)
  throw new Error('ステージは select / align / analyze / render / check のいずれかです')
}

main().catch((err) => {
  console.error(`[localCaptionFiveMinute] ${err.message}`)
  process.exit(1)
})
