// ローカルAIテロップ動画: 全編（約15分）の完成動画を作るランナー。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionFull.mjs align   --job <jobId>          # 全編を窓ごとにローカルwhisper.cpp(DTW)でアラインし、自然なページ分割（v3として保存）
//   node scripts/localCaptionFull.mjs prepare --job <jobId>          # 種別・強調の引き継ぎ、テーマ・ダイジェストの内部検証（保存済みデータのみ。動画は作らない）
//   node scripts/localCaptionFull.mjs render  --job <jobId> --bgm <BGM> --qr <QR> [--dry-run]   # 事前検証→フルレンダー1回
//   node scripts/localCaptionFull.mjs check   --job <jobId> --bgm <BGM> --qr <QR>   # レンダー後の基本検証（デコード・テーマ・不変性）
//   node scripts/localCaptionFull.mjs verify  --job <jobId> --bgm <BGM> --qr <QR> [--frames-dir <dir>]   # 字幕OCR・強調色・音声・QRの詳細検証
//
// 安全方針:
// - 外部AI API（Whisper API含む）は呼ばない。ローカルのwhisper.cppだけ。
// - 既存ジョブJSON・rawSegments・旧captions・5分比較データ・既存の完成動画は読み取り専用（前後でハッシュ比較）。
//   新しい全編データは editor/data/local_caption_comparisons/full/ へバージョン付き（v3）で別ファイルに保存する（git管理外）。
// - 標準出力・保存データに絶対パス・APIキーを出さない。字幕本文・テーマ名・強調語は標準出力へ出さない。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync, renameSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import os from 'os'
import dotenv from 'dotenv'

import { validateSourcePath, validateOutputRoot } from '../server/lib/pathValidator.mjs'
import { extractAudioSegmentWav } from '../server/lib/ffmpegRunner.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { buildWhisperArgs, runWhisperCli, parseWhisperJson, readWhisperJsonFile, PUNCTUATION_PROMPT } from '../server/lib/whisperLocal.mjs'
import { readWavPcm16Mono, detectSilences, computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { buildNaturalCaptions } from '../server/lib/naturalCaptionPipeline.mjs'
import { planChunksFromRawSegments, alignCanonicalByChunks } from '../server/lib/chunkedAlignment.mjs'
import { countBoundaryProblems } from '../server/lib/boundaryRules.mjs'
import { measureCaptionTiming, readabilityStats, countForbiddenBoundaries, stats } from '../server/lib/comparisonMetrics.mjs'
import { planFullWindows, clipLegacyCaptions, mergeWindowCaptions, validateFullCaptions } from '../server/lib/fullPipeline.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const EDITOR_ROOT = resolve(__dirname, '..')
export const FULL_DIR = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/full')
const FULL_KEY = 'full_v3'
const MIDWORD_SILENCE_SPAN_SEC = 0.9 // 承認済みの語中無音の例外（最大0.9秒）

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const rounded = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))
const snapshotDir = (dir) => new Map(readdirSync(dir).map((n) => [n, `${statSync(join(dir, n)).size}:${statSync(join(dir, n)).mtimeMs}`]))
const pagesPath = () => resolve(FULL_DIR, `${FULL_KEY}.pages.json`)

function parseArgs(argv) {
  const o = { stage: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') o.job = argv[++i]
    else if (a === '--bgm') o.bgm = argv[++i]
    else if (a === '--qr') o.qr = argv[++i]
    else if (a === '--frames-dir') o.framesDir = argv[++i]
    else if (a === '--from-cache') o.fromCache = true
    else if (a === '--dry-run') o.dryRun = true
  }
  return o
}

export function loadJob(jobId) {
  const file = resolve(EDITOR_ROOT, 'data/local_caption_videos', `${String(jobId).replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  const bytes = readFileSync(file)
  const job = JSON.parse(bytes.toString('utf-8'))
  const canon = (j) => sha256(JSON.stringify({ captions: j.captions, rawSegments: j.rawSegments, cls: j.captionClassification ?? null }))
  return { file, bytes, job, canon }
}

export function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf-8', mode: 0o600 })
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export function safetyContext(job) {
  const inputRoots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sourceRealPath = validateSourcePath(job.sourcePath, inputRoots).realPath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  return { inputRoots, sourceRealPath, outputRoot, srcBefore: statSync(sourceRealPath), existingOutputs: snapshotDir(outputRoot) }
}

// ────────────────────────────────────────────────────────────────
// align
// ────────────────────────────────────────────────────────────────
async function stageAlign(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  if (!process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN) throw new Error('FFMPEG_BIN / FFPROBE_BIN が未設定です')
  const modelPath = process.env.WHISPER_MODEL_PATH || join(os.homedir(), 'Library/Caches/bemystyle-reel/whisper-models/ggml-large-v3-turbo-q8_0.bin')
  if (!existsSync(modelPath)) throw new Error('whisperモデルが見つかりません（WHISPER_MODEL_PATH）')
  const { sourceRealPath, outputRoot, srcBefore, existingOutputs } = safetyContext(job)
  const freeBefore = await getFreeBytes(outputRoot)

  const legacy = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  const canonicalText = legacy.map((c) => c.text).join('')
  if (job.rawSegments.map((s) => s.text).join('') !== canonicalText) throw new Error('rawSegmentsの連結が正本と一致しません')
  const windows = planFullWindows(job.rawSegments, { windowCount: 3, durationSec: job.durationSec })

  let peakNodeRss = process.memoryUsage().rss
  const sampler = setInterval(() => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss) }, 500)
  sampler.unref()
  const t0 = Date.now()
  let whisperMaxRss = 0
  const perWindow = []
  const problems = []

  const { removed: tempDirRemoved } = await withTempDir('lcv-full-', async (tmpDir) => {
    for (const w of windows) {
      const cachePath = resolve(FULL_DIR, `${FULL_KEY}.window-${w.index}.align-cache.json`)
      const text = canonicalText.slice(w.startIndex, w.endIndex)
      let align, silences, thresholdDb, frameDb, frameSec, run
      let tw = Date.now()
      if (args.fromCache) {
        const cache = JSON.parse(readFileSync(cachePath, 'utf-8'))
        if (cache.canonicalSha256 !== sha256(text)) throw new Error('キャッシュが現在の正本と一致しません')
        ;({ silences, thresholdDb, frameDb, frameSec, run } = cache)
        align = { tokens: cache.tokens }
      } else {
        const wavPath = join(tmpDir, `w${w.index}.wav`)
        await extractAudioSegmentWav(sourceRealPath, wavPath, w.startSec, w.durationSec)
        const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wavPath))
        const det = detectSilences(samples, sampleRate, { minSilenceSec: 0.3 })
        silences = det.silences
        thresholdDb = det.thresholdDb
        const fdb = computeFrameDb(samples, sampleRate)
        frameDb = fdb.db
        frameSec = fdb.frameSec
        const outBase = join(tmpDir, `align${w.index}`)
        const wargs = buildWhisperArgs({ modelPath, audioPath: wavPath, outputBase: outBase, prompt: PUNCTUATION_PROMPT })
        const spawnFn = (bin, a, o) => spawn('/usr/bin/time', ['-l', bin, ...a], o)
        run = await runWhisperCli(wargs, { spawnFn, timeoutMs: 40 * 60 * 1000 })
        align = parseWhisperJson(readWhisperJsonFile(`${outBase}.json`))
        writeJsonAtomic(cachePath, { canonicalSha256: sha256(text), tokens: align.tokens, silences, thresholdDb, frameDb: frameDb.map((v) => round(v, 2)), frameSec, run })
        rmSync(wavPath, { force: true })
      }
      whisperMaxRss = Math.max(whisperMaxRss, run?.maxRssBytes ?? 0)

      // 窓ごとの区間単位アラインメント（全編を1つのLCSにしない）
      const chunks = planChunksFromRawSegments({ rawSegments: job.rawSegments, globalOffset: w.startIndex, textLength: text.length, windowStartSec: w.startSec, windowDurationSec: w.durationSec })
      const timing = alignCanonicalByChunks({ canonicalText: text, chunks, tokens: align.tokens, silences, bounds: { startSec: 0, endSec: w.durationSec } })
      const legacyWin = clipLegacyCaptions(legacy, w.startIndex, w.endIndex)
      const naturalArgs = { legacyCaptions: legacyWin, windowStartSec: w.startSec, windowDurationSec: w.durationSec, tokens: align.tokens, silences, timing }
      let repairReport = null
      const natural = buildNaturalCaptions({ ...naturalArgs, splitOptions: { repair: true, targetPagesPerMinute: 30, midWordSilenceSpanSec: MIDWORD_SILENCE_SPAN_SEC, onRepairReport: (r) => { repairReport = r } } })
      const caps = natural.captions
      const wp = []
      if (caps.map((c) => c.text).join('') !== text) wp.push('窓の本文が正本と一致しません')
      if ((repairReport?.unresolved.length ?? 1) > 0) wp.push('修正できない禁止境界・極端に短いページがあります')
      const tm = measureCaptionTiming(caps, natural.timing, silences)
      const forb = countForbiddenBoundaries(caps.map((c) => c.text)) // 素朴な（strict）判定。承認済みの判定は下の refined
      // 承認済みの判定（refined）: caption間の実測ギャップを考慮した禁止境界・孤立した接続詞
      const gapsOf = (cs) => cs.slice(0, -1).map((c, i) => {
        const nonPunct = (q) => /[^\s。、！？!?,，「」『』（）()・…]/.test(text[q])
        const lastIdx = c.startIndex + c.text.length - 1
        const a = [...Array(c.text.length).keys()].map((k) => c.startIndex + k).filter(nonPunct).pop() ?? lastIdx
        const b = [...Array(cs[i + 1].text.length).keys()].map((k) => cs[i + 1].startIndex + k).find(nonPunct) ?? cs[i + 1].startIndex
        return Math.max(0, natural.timing.charStart[b] - natural.timing.charEnd[a])
      })
      const bn = countBoundaryProblems(caps.map((c) => c.text), { gaps: gapsOf(caps) })
      // 語中無音の例外の診断（本文なし）
      const exceptions = (repairReport?.midWordExceptions ?? []).map((e) => {
        const q = e.position
        const overlap = silences.filter((sl) => sl.startSec < natural.timing.charStart[q] && sl.endSec > natural.timing.charEnd[q - 1] - 1e-6).map((sl) => round(sl.endSec - sl.startSec, 3))
        return { silenceSec: e.silenceSec, measuredSilenceSec: overlap.length ? Math.max(...overlap) : null, limitSec: e.limitSec, atSec: round(caps[e.pageIndex].startSec + w.startSec, 2) }
      })
      perWindow.push({
        w, caps, tm, forb, bn, exceptions, problems: wp,
        // 文字ごとの時刻（窓内の相対）。全編の検証に使う
        timing: { charStart: natural.timing.charStart, charEnd: natural.timing.charEnd },
        silences,
        alignment: { canonicalSpeechChars: natural.alignment.canonicalSpeechCount, matchedChars: natural.alignment.matchedCount, chunks: timing.chunks.length, divergedChunks: timing.chunks.filter((c) => c.fallback).length, dtwTokens: align.tokens.length, silencesOver0_3s: silences.length },
        whisperMs: run?.elapsedMs ?? null,
        elapsedMs: Date.now() - tw,
        repair: { unresolved: repairReport?.unresolved.length ?? null, unresolvedItems: repairReport?.unresolved ?? null, refined: { forbidden: bn.refined.forbidden, midWord: bn.refined.midWord, particleStart: bn.refined.particleStart, dangling: bn.danglingConjunction }, consolidated: repairReport?.consolidated ?? 0, actions: repairReport ? repairReport.actions.reduce((h, a) => ({ ...h, [a.kind]: (h[a.kind] ?? 0) + 1 }), {}) : {} },
      })
      problems.push(...wp.map((p) => `窓${w.index}: ${p}`))
    }
  })
  clearInterval(sampler)

  // ── 全編の結合と検証 ──
  const merged = mergeWindowCaptions(windows, perWindow.map((p) => p.caps))
  const v = validateFullCaptions(merged, canonicalText)
  problems.push(...v.problems)
  const capsForStats = merged
  const read = readabilityStats(capsForStats)
  const sum = (k) => perWindow.reduce((a, p) => a + (p.tm[k] ?? 0), 0)
  const strictForbidden = perWindow.reduce((a, p) => a + p.forb.forbidden, 0)
  const byReason = perWindow.reduce((h, p) => { for (const [k, n] of Object.entries(p.forb.byReason)) h[k] = (h[k] ?? 0) + n; return h }, {})
  const forbidden = perWindow.reduce((a, p) => a + p.bn.refined.forbidden, 0)
  const midWord = perWindow.reduce((a, p) => a + p.bn.refined.midWord, 0)
  const particleStart = perWindow.reduce((a, p) => a + p.bn.refined.particleStart, 0)
  const dangling = perWindow.reduce((a, p) => a + p.bn.danglingConjunction, 0)
  const smallKanaOrLongVowelStart = merged.filter((c) => /^[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー]/.test(c.text)).length
  const exceptions = perWindow.flatMap((p) => p.exceptions)
  if (forbidden > 0) problems.push(`禁止境界が${forbidden}件あります`)
  if (particleStart > 0) problems.push(`助詞で始まる/孤立するページが${particleStart}件あります`)
  if (dangling > 0) problems.push(`孤立した接続詞が${dangling}件あります`)
  if (smallKanaOrLongVowelStart > 0) problems.push(`小書き仮名・長音で始まるcaptionが${smallKanaOrLongVowelStart}件あります`)
  if (sum('early500ms') > 0) problems.push(`500ms以上の先行が${sum('early500ms')}件あります`)
  if (sum('late500ms') > 0) problems.push(`500ms以上の遅延が${sum('late500ms')}件あります`)
  if (sum('silentOver1s') > 0) problems.push(`1秒以上の無音中に残るcaptionが${sum('silentOver1s')}件あります`)
  if (exceptions.some((e) => !(e.silenceSec <= MIDWORD_SILENCE_SPAN_SEC + 1e-6))) problems.push('語中無音の例外が上限0.9秒を超えています')
  // 隣接する窓のつなぎ目: 時刻が単調で重複しない（validateFullCaptionsで確認済み）。つなぎ目のギャップも記録する。
  const joins = windows.slice(1).map((w, i) => {
    const prev = perWindow[i].caps[perWindow[i].caps.length - 1]
    const cur = perWindow[i + 1].caps[0]
    return { atSec: round(w.startSec, 2), gapSec: round(cur.startSec + w.startSec - (prev.endSec + windows[i].startSec), 3) }
  })
  const lineLens = merged.flatMap((c) => c.lines.map((l) => Array.from(l).length))
  const doc = {
    createdAt: new Date().toISOString(),
    pagesVersion: 3,
    jobId: job.id,
    canonicalSha256: sha256(canonicalText),
    canonicalChars: canonicalText.length,
    windows: windows.map((w) => ({ index: w.index, startIndex: w.startIndex, endIndex: w.endIndex, startSec: round(w.startSec, 3), endSec: round(w.endSec, 3), durationSec: round(w.durationSec, 3) })),
    ok: problems.length === 0,
    problems,
    captions: merged.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: c.text, lines: c.lines, startIndex: c.startIndex, captionType: 'normal', emphasisText: null, lowConfidence: Boolean(c.lowConfidence), boundaryKind: c.boundaryKind ?? null, displayOrder: c.displayOrder, windowIndex: c.windowIndex })),
    silences: perWindow.flatMap((p) => p.silences.map((s) => ({ startSec: round(s.startSec + p.w.startSec, 3), endSec: round(s.endSec + p.w.startSec, 3) }))),
    // 文字ごとの時刻（全編の絶対時刻。検証・低信頼の再確認用）
    charStart: perWindow.flatMap((p) => p.timing.charStart.map((t) => round(t + p.w.startSec, 3))),
    charEnd: perWindow.flatMap((p) => p.timing.charEnd.map((t) => round(t + p.w.startSec, 3))),
  }
  const metrics = {
    windows: perWindow.map((p) => ({ index: p.w.index, startSec: round(p.w.startSec, 2), durationSec: round(p.w.durationSec, 2), captions: p.caps.length, alignment: p.alignment, whisperMs: p.whisperMs, elapsedMs: p.elapsedMs, repair: p.repair, problems: p.problems })),
    joins,
    captions: {
      count: merged.length,
      canonicalMatch: v.ok || !v.problems.some((x) => x.includes('正本')),
      chars: rounded(read.chars),
      displaySec: rounded(read.duration),
      under2sec: merged.filter((c) => c.endSec - c.startSec < 2).length,
      over30chars: merged.filter((c) => Array.from(c.text).length > 30).length,
      over2lines: merged.filter((c) => c.lines.length > 2).length,
      lineChars: rounded(stats(lineLens)),
      maxLineChars: Math.max(...lineLens),
      twoLinePages: merged.filter((c) => c.lines.length === 2).length,
      lowConfidence: merged.filter((c) => c.lowConfidence).length,
      lowConfidenceRatio: round(merged.filter((c) => c.lowConfidence).length / merged.length, 4),
      empty: merged.filter((c) => !c.text.trim()).length,
    },
    timing: { early500ms: sum('early500ms'), late500ms: sum('late500ms'), silentOver1s: sum('silentOver1s'), laterSentenceEarlyOver1s: sum('laterSentenceEarlyOver1s'), tailLeadOver1s: sum('tailLeadOver1s') },
    boundaries: { forbidden, midWord, particleStart, danglingConjunction: dangling, smallKanaOrLongVowelStart, strictForbiddenBeforeExceptionsAndGapRefinement: strictForbidden, strictByReason: byReason },
    midWordSilenceExceptions: { limitSec: MIDWORD_SILENCE_SPAN_SEC, count: exceptions.length, items: exceptions },
    reversedOrOverlapped: v.stats,
  }
  doc.metrics = metrics
  if (!args.dryRun) writeJsonAtomic(pagesPath(), doc)

  const srcAfter = statSync(sourceRealPath)
  const outputsAfter = snapshotDir(outputRoot)
  console.log(JSON.stringify({
    stage: 'align',
    pagesFile: args.dryRun ? null : `${FULL_KEY}.pages.json`,
    ok: doc.ok,
    problems,
    metrics,
    performance: { totalMs: Date.now() - t0, whisperMs: perWindow.map((p) => p.whisperMs), whisperCliMaxRssMB: whisperMaxRss ? round(whisperMaxRss / 1e6, 0) : null, nodePeakRssMB: round(peakNodeRss / 1e6, 0) },
    safety: {
      sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
      jobFileByteIdentical: sha256(bytes) === sha256(readFileSync(file)),
      captionsRawSegmentsClassificationUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))),
      outputRootUnchanged: [...existingOutputs].every(([n, x]) => outputsAfter.get(n) === x) && outputsAfter.size === existingOutputs.size,
      tempDirRemoved,
      freeBytesBefore: freeBefore,
      freeBytesAfter: await getFreeBytes(outputRoot),
      externalWhisperApiCalled: false,
      externalAiApiCalled: false,
    },
  }, null, 2))
  if (!doc.ok) process.exitCode = 1
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (args.stage === 'align') return stageAlign(args)
  const { stageRest } = await import('./localCaptionFullStages.mjs')
  return stageRest(args)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[localCaptionFull] ${err.message}`)
    process.exit(1)
  })
}
