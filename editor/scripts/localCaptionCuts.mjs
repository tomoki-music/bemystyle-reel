// ローカルAIテロップ動画: 約10秒の新ダイジェスト + 無音カットの分析・確認動画（15分全編は再レンダーしない）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionCuts.mjs analyze   --job <jobId>                      # 新ダイジェスト（v5）+ 全編の無音候補の分析 + 編集決定リスト + タイムマップ（保存のみ。動画は作らない）
//   node scripts/localCaptionCuts.mjs compare   --job <jobId> --bgm <BGM> --qr <QR>   # 確認動画を1本（一時ファイル→成功時だけrename）
//   node scripts/localCaptionCuts.mjs verify    --job <jobId> --bgm <BGM> --qr <QR> [--frames-dir <dir>]   # 確認動画の検証（読み取りのみ）
//   node scripts/localCaptionCuts.mjs machinery --job <jobId>                      # カット機構の技術試験（強制カットを一時ファイルで検証して削除。成果物ではない）
//
// 安全方針: 外部AI API不使用（ローカルのffmpeg・ffprobe・既存データだけ）。元動画・ジョブJSON・v3/v4データ・既存動画は変更しない。
// 新しいデータは editor/data/local_caption_comparisons/full/ へバージョン付き（full_v5）で別ファイル保存（git管理外・既存は上書きしない）。
// 標準出力・保存データに字幕本文・絶対パスを出さない。

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import dotenv from 'dotenv'

import { EDITOR_ROOT, FULL_DIR, loadJob, safetyContext, writeJsonAtomic } from './localCaptionFull.mjs'
import { pcm, audioDelay, measurePoint, ptsReport } from './localCaptionFullSync.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { readWavPcm16Mono, detectSilences, computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { normalizeTopicSectionsContinuous } from '../server/lib/topicSections.mjs'
import { extractSilenceCandidates, classifyCandidates, applyCutLimits, summarizeCuts, findMidCaptionGaps, CUT_DEFAULTS } from '../server/lib/silenceCuts.mjs'
import { buildEditTimeMap, itemsFromCuts, mapCaptions, mapThemes, verifyThemeCoverage, verifyMappedCaptions } from '../server/lib/editTimeMap.mjs'
import { buildShortDigest, shortDigestCaptions, SHORT_DIGEST_DEFAULTS } from '../server/lib/shortDigest.mjs'
import { resolveCompositionConfig, validateCompositionConfig, planTimeline, digestThemeBlocks, buildFinalAss, planQrWindows, planDigestCaptionSizes, buildDigestStemArgs } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, renderCompositionToFile, checkFreeSpace, FULL_RENDER_MIN_FREE_BYTES } from '../server/lib/compositionRender.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const BASE_KEY = 'full_v4' // 同期修正版（caption・テーマ）
const OUT_KEY = 'full_v5'
const FPS = 30
const pathFor = (key, name) => resolve(FULL_DIR, `${key}.${name}.json`)
const readJson = (key, name) => JSON.parse(readFileSync(pathFor(key, name), 'utf-8'))

/** 人が選んだダイジェストの発言（caption範囲。文頭〜文末）。結論 → その理由の順（続きが気になる順）。強調語は本文の完全な部分文字列。 */
export const SHORT_DIGEST_PICKS = [
  { firstIndex: 226, lastIndex: 227, emphasisText: '無理して一緒に' }, // 結論: 違うなら無理して一緒に続ける必要はない
  { firstIndex: 398, lastIndex: 400, emphasisText: '違います' }, // 原因: 同じ音楽好きでも目的・熱量は違う
]

/** 確認動画の代表区間（元動画の秒）。今回の無音分析では安全にカットできる箇所が無いため、カットしなかった代表的な箇所を並べる。 */
export const COMPARISON_PIECES = [
  { title: '区間A', note: '冒頭とLINEオーバーレイ（カットなし）', a: 0, b: 20 },
  { title: '区間B', note: '通常区間（テーマ切り替えを含む・カットなし）', a: 396, b: 411 },
  { title: '区間C', note: '語中無音0.67秒を残した区間', a: 563, b: 575 },
  { title: '区間D', note: '語中無音0.72秒を残した区間', a: 731, b: 743 },
]
const CARD_SEC = 1.5

function parseArgs(argv) {
  const o = { stage: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') o.job = argv[++i]
    else if (a === '--bgm') o.bgm = argv[++i]
    else if (a === '--qr') o.qr = argv[++i]
    else if (a === '--frames-dir') o.framesDir = argv[++i]
  }
  return o
}

const build = async (tmp, name) => {
  const bin = join(tmp, name)
  await execFileAsync('swiftc', ['-O', resolve(__dirname, 'tools', `${name}.swift`), '-o', bin], { timeout: 300000 })
  return bin
}

// ────────────────────────────────────────────────────────────────
// 共通: 新ダイジェスト・本編（編集項目）・確認動画の計画
// ────────────────────────────────────────────────────────────────
export function loadBase(job) {
  const capDoc = readJson(BASE_KEY, 'captions')
  const topics = readJson(BASE_KEY, 'topics')
  const pages = readJson(BASE_KEY, 'pages')
  if (capDoc.jobId !== job.id || topics.jobId !== job.id) throw new Error('保存済みデータのjobIdが一致しません')
  const norm = normalizeTopicSectionsContinuous(topics.sections, { startSec: 0, endSec: job.durationSec }).sections
  return { capDoc, topics, pages, norm, captions: capDoc.captions }
}

/** 確認動画の計画（タイムマップ・ダイジェスト・ASS・タイムライン）。compare と verify で同じものを使う。 */
export function buildComparisonPlan(job, paths, base) {
  const dig = buildShortDigest(base.captions, base.norm, SHORT_DIGEST_PICKS)
  if (!dig.ok) throw new Error(`ダイジェストの検証に失敗: ${dig.problems.join(' / ')}`)
  const items = []
  COMPARISON_PIECES.forEach((p, k) => {
    if (k > 0) items.push({ kind: 'card', durationSec: CARD_SEC, label: `${p.title}｜${p.note}`, title: p.title, note: p.note })
    items.push({ kind: 'seg', srcStartSec: p.a, srcEndSec: p.b })
  })
  const tm = buildEditTimeMap(items)
  const cfg = resolveCompositionConfig({
    digest: { durationSec: 10, minSec: SHORT_DIGEST_DEFAULTS.minSec, maxSec: SHORT_DIGEST_DEFAULTS.maxSec, clipCount: SHORT_DIGEST_DEFAULTS.clipCount, clipSec: SHORT_DIGEST_DEFAULTS.clipSec, bgm: { path: paths.bgm } },
    line: { qrPath: paths.qr },
    lineIntro: { durationSec: COMPARISON_PIECES[0].b - COMPARISON_PIECES[0].a }, // 確認動画では、冒頭の区間の長さだけ重ねる（本番は30秒）
  })
  const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: tm.totalSec, digestClips: dig.clips })
  const D = timeline.mainOffsetSec
  const mainCaps = mapCaptions(base.captions, tm).map((c) => ({ ...c, startSec: round(c.startSec + D), endSec: round(c.endSec + D) }))
  const digCaps = shortDigestCaptions(base.captions, dig.clips)
  const digBlocks = digestThemeBlocks(base.norm, dig.clips, base.captions).blocks
  // 本編のテーマ: 区切りカードで分かれる連続区間ごとに1ブロック（カードの間はテーマ箱を出さない）
  const mapped = mapThemes(base.norm, tm)
  const runs = []
  for (const it of tm.items) {
    if (it.kind === 'card') continue
    const last = runs[runs.length - 1]
    if (last && Math.abs(last.endSec - it.editedStartSec) < 1e-3) last.endSec = it.editedEndSec
    else runs.push({ startSec: it.editedStartSec, endSec: it.editedEndSec })
  }
  const mainBlocks = runs.map((r) => ({
    startSec: round(D + r.startSec),
    endSec: round(D + r.endSec),
    sections: mapped.filter((t) => t.endSec > r.startSec + 1e-3 && t.startSec < r.endSec - 1e-3).map((t) => ({ id: t.id, title: t.title, startSec: round(D + Math.max(t.startSec, r.startSec)), endSec: round(D + Math.min(t.endSec, r.endSec)) })),
  }))
  const cardEvents = tm.items.filter((i) => i.kind === 'card').map((c) => {
    const t = (s) => {
      const total = Math.round(s * 100)
      const p2 = (n) => String(n).padStart(2, '0')
      return `0:${p2(Math.floor(total / 6000) % 60)}:${p2(Math.floor(total / 100) % 60)}.${p2(total % 100)}`
    }
    return `Dialogue: 20,${t(D + c.editedStartSec)},${t(D + c.editedEndSec)},LineHead,,0,0,0,,{\\an5\\pos(${Math.round(job.width / 2)},${Math.round(job.height / 2)})\\fs60\\bord3}${c.title}\\N${c.note}`
  })
  return { cfg, dig, tm, timeline, D, mainCaps, digCaps, digBlocks, mainBlocks, cardEvents, mapped, buildAss: (qrSize) => buildFinalAss({ width: job.width, height: job.height, cfg, timeline, mainCaptions: mainCaps, digestCaps: digCaps, themeBlocks: [...digBlocks, ...mainBlocks], qrSize, digestStyle: 'strong', extraEvents: cardEvents }) }
}

// ────────────────────────────────────────────────────────────────
// analyze
// ────────────────────────────────────────────────────────────────
async function motionMax(source, a, b) {
  const dur = Math.max(0.2, Math.min(b - a, 30))
  const r = await execFileAsync(process.env.FFMPEG_BIN, ['-v', 'error', '-ss', String(a), '-t', String(dur), '-i', source, '-an', '-vf', 'fps=6,scale=64:36:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 27 })
  const size = 64 * 36
  const n = Math.floor(r.stdout.length / size)
  let mx = 0
  for (let i = 1; i < n; i++) {
    let d = 0
    for (let k = 0; k < size; k++) d += Math.abs(r.stdout[i * size + k] - r.stdout[(i - 1) * size + k])
    mx = Math.max(mx, d / size)
  }
  return round(mx, 2)
}

async function stageAnalyze(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const base = loadBase(job)
  const { sourceRealPath, outputRoot } = safetyContext(job)
  for (const n of ['digest', 'silence-plan', 'timemap']) if (existsSync(pathFor(OUT_KEY, n))) throw new Error(`同じバージョンの保存データが既にあります（上書きしません）: ${OUT_KEY}.${n}`)

  // 1) 新ダイジェスト
  const dig = buildShortDigest(base.captions, base.norm, SHORT_DIGEST_PICKS)
  if (!dig.ok) throw new Error(`ダイジェストの検証に失敗: ${dig.problems.join(' / ')}`)
  const digCaps = shortDigestCaptions(base.captions, dig.clips)
  const sizes = planDigestCaptionSizes(job.width, job.height, digCaps)

  // 2) 全編の音声をローカルで解析（同期修正版と同じ音声起点。外部AIなし）
  const cfg = CUT_DEFAULTS
  const { result: audio } = await withTempDir('lcv-cuts-', async (tmp) => {
    const wav = join(tmp, 'full.wav')
    await execFileAsync(process.env.FFMPEG_BIN, ['-v', 'error', '-y', '-i', sourceRealPath, '-vn', '-af', 'aresample=first_pts=0', '-ac', '1', '-ar', '16000', '-t', String(job.durationSec), '-c:a', 'pcm_s16le', wav], { maxBuffer: 1 << 26 })
    const { samples, sampleRate } = readWavPcm16Mono(readFileSync(wav))
    const det = detectSilences(samples, sampleRate, { minSilenceSec: 0.6, frameSec: 0.02 })
    const { db, frameSec } = computeFrameDb(samples, sampleRate, 0.02)
    return { silences: det.silences, thresholdDb: det.thresholdDb, db, frameSec }
  })
  const meanDb = (a, b) => {
    const x = audio.db.slice(Math.floor(a / audio.frameSec), Math.ceil(b / audio.frameSec))
    return x.length ? round(x.reduce((p, q) => p + q, 0) / x.length, 1) : null
  }
  const stat = (o) => ({ ...o, meanDb: meanDb(o.startSec, o.endSec), thresholdDb: round(audio.thresholdDb, 1) })
  const audioCands = extractSilenceCandidates(audio.silences, cfg).map((s) => ({ ...stat(s), kind: 'audio-silence' }))
  // captionが1.2秒以上出ていない時間（音声が無音かは実測で判断する。発話があれば「無音ではない」として禁止）
  const caps = base.captions
  const gapCands = []
  const gaps = [{ startSec: 0, endSec: caps[0].startSec }]
  for (let i = 1; i < caps.length; i++) gaps.push({ startSec: caps[i - 1].endSec, endSec: caps[i].startSec })
  gaps.push({ startSec: caps.at(-1).endSec, endSec: job.durationSec })
  for (const g of gaps) if (g.endSec - g.startSec >= cfg.minSilenceSec - 1e-9) gapCands.push({ ...stat({ ...g, silenceSec: round(g.endSec - g.startSec) }), kind: 'caption-gap' })
  const candidates = [...audioCands, ...gapCands].sort((a, b) => a.startSec - b.startSec)
  for (const c of candidates) c.motionMax = await motionMax(sourceRealPath, c.startSec, c.endSec)

  const protectedGaps = findMidCaptionGaps(caps, base.pages.charStart, base.pages.charEnd, cfg.midWordMinGapSec)
  const approved = [567.98, 736.19].map((at) => {
    const cap = caps.find((c) => Math.abs(c.startSec - at) < 0.1)
    const g = cap ? protectedGaps.find((x) => x.captionId === cap.id) : null
    return { atSec: at, protectedGapSec: g ? g.gapSec : null }
  })
  const classified = classifyCandidates(candidates, { captions: caps, themes: base.norm, protectedGaps, excludeRanges: dig.clips.map((c) => ({ startSec: c.srcStartSec, endSec: c.srcEndSec, label: 'ダイジェスト' })), cfg })
  const rows = applyCutLimits(classified, cfg).map((r, i) => ({ ...r, kind: candidates[i].kind, meanDb: candidates[i].meanDb, motionMax: candidates[i].motionMax }))
  const summary = summarizeCuts(rows, job.durationSec)

  // 3) タイムマップ（採用カットだけを除く。今回は採用0のため全区間が残る）と、caption・テーマの不変性検証
  const adopted = rows.filter((r) => r.decision === 'adopt')
  const tm = buildEditTimeMap(itemsFromCuts(job.durationSec, adopted))
  const mappedCaps = mapCaptions(caps, tm, { strict: true })
  const capCheck = verifyMappedCaptions(caps, mappedCaps)
  const mappedThemes = mapThemes(base.norm, tm)
  const themeCheck = verifyThemeCoverage(mappedThemes, tm)
  const D = dig.totalSec

  const belowMin = (lo, hi) => audio.silences.filter((s) => s.endSec - s.startSec >= lo && s.endSec - s.startSec < hi).length
  writeJsonAtomic(pathFor(OUT_KEY, 'digest'), { createdAt: new Date().toISOString(), version: 5, jobId: job.id, baseKey: BASE_KEY, picks: SHORT_DIGEST_PICKS.map((p) => ({ firstIndex: p.firstIndex, lastIndex: p.lastIndex })), config: { minSec: SHORT_DIGEST_DEFAULTS.minSec, maxSec: SHORT_DIGEST_DEFAULTS.maxSec, clipCount: SHORT_DIGEST_DEFAULTS.clipCount }, clips: dig.clips, totalSec: dig.totalSec, captionSizesPx: sizes.map((s) => s.size), mainNormalSizePx: sizes[0]?.mainSize })
  const plan = {
    createdAt: new Date().toISOString(), version: 5, jobId: job.id, baseKey: BASE_KEY, durationSec: job.durationSec,
    config: cfg,
    analysis: { thresholdDb: round(audio.thresholdDb, 1), silencesOver0_6s: audio.silences.length, silences0_6to1_2s: belowMin(0.6, 1.2), silences0_8to1_2s: belowMin(0.8, 1.2), silencesOver1_2s: audio.silences.filter((s) => s.endSec - s.startSec >= 1.2).length, protectedMidCaptionGaps: protectedGaps.length, approvedExceptions: approved },
    candidates: rows,
    summary,
  }
  writeJsonAtomic(pathFor(OUT_KEY, 'silence-plan'), plan)
  writeJsonAtomic(pathFor(OUT_KEY, 'timemap'), { createdAt: new Date().toISOString(), version: 5, jobId: job.id, items: tm.items, totalSec: tm.totalSec, keptSec: tm.keptSec, mainOffsetSec: D, lineOverlay: { startSec: D, endSec: round(D + Math.min(30, tm.totalSec)) }, outroStartSec: round(D + tm.totalSec), verification: { captions: capCheck, themes: themeCheck } })

  console.log(JSON.stringify({
    stage: 'analyze',
    digest: { clips: dig.clips.map((c) => ({ durationSec: c.durationSec, themeId: c.themeId, emphasisChars: c.emphasis ? Array.from(c.emphasis.text).length : 0, srcStartSec: c.srcStartSec, srcEndSec: c.srcEndSec })), totalSec: dig.totalSec, emphasisCount: dig.clips.filter((c) => c.emphasis).length, captionSizesPx: [...new Set(sizes.map((s) => s.size))], mainNormalSizePx: sizes[0]?.mainSize, sizeRatio: round(Math.min(...sizes.map((s) => s.size)) / sizes[0].mainSize, 3) },
    analysis: plan.analysis,
    summary,
    candidates: rows.map((r) => ({ kind: r.kind, silenceStartSec: r.silenceStartSec, silenceSec: r.silenceSec, meanDb: r.meanDb, motionMax: r.motionMax, class: r.class, decision: r.decision, reason: r.reason, cutSec: r.cutSec })),
    timemap: { totalSec: tm.totalSec, keptSec: tm.keptSec, items: tm.items.length, captions: capCheck, themes: themeCheck, mainOffsetSec: D, lineOverlay: { startSec: D, endSec: round(D + Math.min(30, tm.totalSec)) }, outroStartSec: round(D + tm.totalSec) },
    safety: { jobFileByteIdentical: bytes.equals(readFileSync(file)), canonUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))), externalAiApiCalled: false },
  }, null, 2))
}

// ────────────────────────────────────────────────────────────────
// compare: 確認動画を1本
// ────────────────────────────────────────────────────────────────
const dirSnapshot = (dir) => Object.fromEntries(readdirSync(dir).map((n) => { const s = statSync(join(dir, n)); return [n, `${s.size}:${s.mtimeMs}`] }))
const STATE = () => pathFor(OUT_KEY, 'compare-state')

async function stageCompare(args) {
  const { job } = loadJob(args.job)
  if (!args.bgm || !args.qr) throw new Error('--bgm と --qr を指定してください')
  const base = loadBase(job)
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  if (existsSync(STATE())) throw new Error('確認動画は既に生成済みです（1本だけ。上書きしません）')
  const free = await checkFreeSpace(outputRoot, FULL_RENDER_MIN_FREE_BYTES)
  if (!free.ok) throw new Error('空き容量が15GB未満のため開始しません')
  const plan = buildComparisonPlan(job, { bgm: args.bgm, qr: args.qr }, base)
  const v = validateCompositionConfig(plan.cfg)
  if (!v.ok) throw new Error(`構成設定が不正です: ${v.errors.join(' / ')}`)
  const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
  if (!assets.ok) throw new Error('素材を確認できません')
  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const outName = `comparison_short_digest_silence_cuts_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.mp4`
  const finalPath = join(outputRoot, outName)
  if (existsSync(finalPath)) throw new Error('出力ファイルが既にあります（上書きしません）')
  const before = dirSnapshot(outputRoot)
  const assText = plan.buildAss({ width: assets.qr.width, height: assets.qr.height })
  const t0 = Date.now()
  await withTempDir('lcv-cuts-render-', async (tmpDir) => {
    await renderCompositionToFile({
      cfg: plan.cfg, timeline: plan.timeline, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: plan.tm.totalSec, mainItems: plan.tm.items,
      digestClips: plan.dig.clips, bgmPath: assets.bgm.realPath, qrPath: assets.qr.realPath, qrSize: { width: assets.qr.width, height: assets.qr.height }, assText, tmpDir, finalPath,
    })
  })
  const after = dirSnapshot(outputRoot)
  writeJsonAtomic(STATE(), { createdAt: new Date().toISOString(), outputName: outName, before })
  console.log(JSON.stringify({
    stage: 'compare', outputName: outName, sizeBytes: statSync(finalPath).size, renderMs: Date.now() - t0, totalSecPlanned: plan.timeline.totalSec, digestSec: plan.timeline.digestSec, mainOffsetSec: plan.D,
    existingOutputsChanged: Object.entries(before).filter(([n, x]) => after[n] !== x).length, tempOutputLeftover: readdirSync(outputRoot).filter((n) => n.startsWith('.rendering-composition-')).length, externalAiApiCalled: false,
  }, null, 2))
}

// ────────────────────────────────────────────────────────────────
// verify: 確認動画の検証（読み取りのみ）
// ────────────────────────────────────────────────────────────────
const norm = (s) => String(s).replace(/[\s、。！？!?,，「」『』（）()・…\n\\N]/g, '')
function lcsRatio(expected, got) {
  const a = Array.from(norm(expected))
  const b = Array.from(norm(got))
  if (a.length === 0) return 1
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp[a.length][b.length] / a.length
}
const rmsDb = (a) => { let s = 0; for (const v of a) s += v * v; const r = Math.sqrt(s / Math.max(1, a.length)); return r > 0 ? 20 * Math.log10(r) : -120 }

async function stageVerify(args) {
  const { job } = loadJob(args.job)
  const base = loadBase(job)
  const state = JSON.parse(readFileSync(STATE(), 'utf-8'))
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  const video = join(outputRoot, state.outputName)
  if (!existsSync(video)) throw new Error('確認動画が見つかりません')
  const plan = buildComparisonPlan(job, { bgm: args.bgm, qr: args.qr }, base)
  const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
  const T = plan.timeline
  const D = plan.D
  const ff = process.env.FFMPEG_BIN
  const ov = T.overlays[0]
  const outro = T.sections.find((s) => s.kind === 'lineOutro')
  const out = { stage: 'verify', outputName: state.outputName }
  if (args.framesDir) mkdirSync(args.framesDir, { recursive: true })

  // 基本情報・PTS・全体デコード
  out.pts = await ptsReport(video, T.totalSec)
  const cnt = JSON.parse((await execFileAsync(process.env.FFPROBE_BIN, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', video], { maxBuffer: 1 << 26 })).stdout).streams[0]
  out.basic = { frames: Number(cnt.nb_read_frames), expectedFrames: Math.round(T.totalSec * FPS), width: cnt.width, height: cnt.height, sizeBytes: statSync(video).size, expectedTotalSec: T.totalSec, digestSec: T.digestSec }
  let decodeOk = true
  try { await execFileAsync(ff, ['-v', 'error', '-i', video, '-f', 'null', '-'], { maxBuffer: 1 << 26 }) } catch { decodeOk = false }
  out.decode = { fullDecodeNoErrors: decodeOk }

  await withTempDir('lcv-cuts-verify-', async (tmp) => {
    const qrBin = await build(tmp, 'qrDecode')
    const ocrBin = await build(tmp, 'ocrText')
    const frame = (t, file, vf) => execFileAsync(ff, ['-v', 'error', '-y', '-ss', String(round(t, 3)), '-i', video, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), file])
    const rgb = async (t, vf) => (await execFileAsync(ff, ['-v', 'error', '-ss', String(round(t, 3)), '-i', video, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
    const ocr = async (files) => {
      const res = []
      for (let i = 0; i < files.length; i += 40) for (const l of (await execFileAsync(ocrBin, files.slice(i, i + 40), { maxBuffer: 1 << 26 })).stdout.trim().split('\n')) res.push(JSON.parse(l).text ?? '')
      return res
    }
    const decodeQr = async (img) => { try { return JSON.parse((await execFileAsync(qrBin, [img])).stdout) } catch (e) { try { return JSON.parse(e.stdout) } catch { return { decoded: false } } } }
    const band = 'crop=iw:ih*0.32:0:ih*0.66'

    // ── ダイジェスト ──
    const clips = plan.dig.clips
    const starts = []
    let acc = 0
    for (const c of clips) { starts.push(acc); acc += c.durationSec }
    const digEvents = plan.digCaps
    const digFiles = []
    for (let i = 0; i < digEvents.length; i++) { const f = join(tmp, `dc${i}.png`); await frame((digEvents[i].startSec + digEvents[i].endSec) / 2, f, band); digFiles.push(f) }
    const digText = await ocr(digFiles)
    const digRatios = digEvents.map((e, i) => lcsRatio(e.text, digText[i]))
    const amber = async (t) => { const b = await rgb(t, `${band},scale=960:-2:flags=area`); let n = 0; for (let i = 0; i + 2 < b.length; i += 3) if (Math.abs(b[i] - 0xf0) < 14 && Math.abs(b[i + 1] - 0xb3) < 14 && Math.abs(b[i + 2] - 0x4a) < 24) n++; return n }
    const emphRows = []
    for (const e of digEvents.filter((x) => x.emphasisText)) emphRows.push(await amber((e.startSec + e.endSec) / 2))
    const plainAmber = []
    for (const e of digEvents.filter((x) => !x.emphasisText)) plainAmber.push(await amber((e.startSec + e.endSec) / 2))
    const sat = async (t) => { const b = await rgb(t, 'crop=iw*0.3:ih*0.5:iw*0.62:ih*0.18,scale=48:27:flags=area'); let s = 0; const n = b.length / 3; for (let i = 0; i < n; i++) s += (Math.max(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]) - Math.min(b[i * 3], b[i * 3 + 1], b[i * 3 + 2])) / 255; return s / n }
    const digSat = []
    for (let k = 0; k < clips.length; k++) digSat.push(round(await sat(starts[k] + clips[k].durationSec / 2), 4))
    const mainSat = round(await sat(D + 5), 4)
    // テーマ（ダイジェストの各クリップ）
    const thFiles = []
    const digSecs = plan.digBlocks.flatMap((b) => b.sections)
    for (let i = 0; i < digSecs.length; i++) { const f = join(tmp, `dt${i}.png`); await frame(digSecs[i].startSec + 0.8, f, 'crop=820:300:90:56'); thFiles.push(f) }
    const thText = await ocr(thFiles)
    // 声・BGM（本番と同じフィルタのstemと実出力の比較）
    const o = { outVoice: join(tmp, 'v.wav'), outBgm: join(tmp, 'b.wav'), outMix: join(tmp, 'm.wav') }
    await execFileAsync(ff, buildDigestStemArgs({ cfg: plan.cfg, digestClips: clips, sourcePath: sourceRealPath, bgmPath: assets.bgm.realPath, ...o }).args, { maxBuffer: 1 << 26 })
    const pc = (f) => pcm(f, 0, 30)
    const v = await pc(o.outVoice)
    const b = await pc(o.outBgm)
    const outDig = await pcm(video, 0, T.digestSec)
    const tail = (a, sec) => a.subarray(Math.max(0, a.length - Math.round(sec * 16000)))
    const mainStartAudio = await pcm(video, D + 0.5, 3)
    out.digest = {
      totalSec: T.digestSec, clips: clips.map((c) => c.durationSec), clipCount: clips.length,
      captionOcr: { checked: digEvents.length, minRatio: round(Math.min(...digRatios), 3) },
      emphasis: { count: clips.filter((c) => c.emphasis).length, perClipMax: Math.max(...clips.map((c) => (c.emphasis ? 1 : 0))), amberPixelsMin: emphRows.length ? Math.min(...emphRows) : null, plainCaptionsWithAmber: plainAmber.filter((n) => n >= 40).length },
      grayscale: { digestWallSatMax: Math.max(...digSat), mainWallSat: mainSat, digestOnlyGray: Math.max(...digSat) < 0.02 && mainSat > 0.02 },
      themeOcr: digSecs.map((s, i) => ({ minRatio: round(lcsRatio(s.title, thText[i]), 3) })),
      audio: { voiceRmsDb: round(rmsDb(v), 1), bgmAfterDuckingRmsDb: round(rmsDb(b), 1), outputRmsDb: round(rmsDb(outDig), 1), voiceMinusBgmDb: round(rmsDb(v) - rmsDb(b), 1), bgmLast0_3sRmsDb: round(rmsDb(tail(b, 0.3)), 1), bgmEndsCompletely: rmsDb(tail(b, 0.1)) < -80, mainStartRmsDb: round(rmsDb(mainStartAudio), 1) },
      captionSizePx: { digest: plan.digCaps.length ? planDigestCaptionSizes(job.width, job.height, plan.digCaps).map((s) => s.size) : [], main: planDigestCaptionSizes(job.width, job.height, plan.digCaps)[0]?.mainSize },
    }

    // ── 本編の各区間: 音声・映像のずれ、字幕OCR、テーマ ──
    const rows = []
    for (const it of plan.tm.items.filter((i) => i.kind === 'seg')) {
      const len = it.srcEndSec - it.srcStartSec
      for (const f of [0.25, 0.6]) {
        const s = it.srcStartSec + Math.min(len - 6, len * f)
        rows.push({ srcSec: round(s, 2), ...(await measurePoint({ video, source: sourceRealPath, srcSec: s, outSec: D + it.editedStartSec + (s - it.srcStartSec) })) })
      }
    }
    const av = rows.map((r) => r.avOffsetMs).filter((x) => x !== null)
    out.sync = { points: rows.map((r) => ({ srcSec: r.srcSec, audioDelayMs: r.audioDelayMs, videoPtsOffsetMs: r.videoPtsOffsetMs, avOffsetMs: r.avOffsetMs, audioCorr: r.audioCorr })), avOffsetMsMaxAbs: av.length ? round(Math.max(...av.map(Math.abs)), 2) : null, allWithinOneFrame: av.every((x) => Math.abs(x) < 1000 / FPS) }
    const evs = plan.mainCaps
    const capFiles = []
    for (let i = 0; i < evs.length; i++) { const f = join(tmp, `mc${i}.png`); await frame((evs[i].startSec + evs[i].endSec) / 2, f, band); capFiles.push(f) }
    const capText = await ocr(capFiles)
    const cr = evs.map((e, i) => lcsRatio(e.text, capText[i]))
    out.mainCaptions = { checked: evs.length, minRatio: round(Math.min(...cr), 3), below0_7: cr.filter((x) => x < 0.7).length }
    const secs = plan.mainBlocks.flatMap((bl) => bl.sections)
    const mf = []
    for (let i = 0; i < secs.length; i++) { const f = join(tmp, `mt${i}.png`); await frame(secs[i].startSec + 0.8, f, 'crop=820:300:90:56'); mf.push(f) }
    const mt = await ocr(mf)
    out.mainThemes = { checked: secs.length, minRatio: secs.length ? round(Math.min(...secs.map((s, i) => lcsRatio(s.title, mt[i]))), 3) : null }
    const assText = plan.buildAss({ width: assets.qr.width, height: assets.qr.height })
    // テーマ表示: ASSの実イベント（TopicTitle）を読み、ダイジェストと本編の各連続区間が隙間・重複なく覆われているかを確認する
    const parseT = (x) => { const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(x); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100 }
    const titles = assText.split('\n').filter((l) => /^Dialogue: \d+,[^,]+,[^,]+,TopicTitle,/.test(l)).map((l) => { const f = l.split(','); return [parseT(f[1]), parseT(f[2])] }).sort((a, b) => a[0] - b[0])
    const spanCheck = (label, a, bb) => {
      const inside = titles.filter((t) => t[1] > a + 0.005 && t[0] < bb - 0.005)
      let cur = a
      let gap = 0
      let overlap = 0
      for (const t of inside) { if (t[0] > cur + 0.011) gap += t[0] - cur; if (t[0] < cur - 0.011) overlap += cur - t[0]; cur = Math.max(cur, Math.min(t[1], bb)) }
      if (bb > cur + 0.011) gap += bb - cur
      return { label, titles: inside.length, gapSec: round(gap, 2), overlapSec: round(overlap, 2) }
    }
    out.themeAss = [spanCheck('digest', 0, D), ...plan.mainBlocks.map((bl, i) => spanCheck(`main-run${i + 1}`, bl.startSec, bl.endSec))]

    // ── LINE・QR ──
    const shots = [['overlay-start', ov.startSec + 0.1], ['overlay-mid', (ov.startSec + ov.endSec) / 2], ['overlay-end', ov.endSec - 0.1], ['outro-start', outro.startSec + 0.1], ['outro-mid', (outro.startSec + outro.endSec) / 2], ['outro-last', T.totalSec - 0.1]]
    const qrRows = []
    let originalSha = null
    {
      const r0 = await decodeQr(assets.qr.realPath)
      originalSha = r0.sha256 ?? null
    }
    for (const [name, t] of shots) {
      const full = join(tmp, `qr-${name}.png`)
      await frame(t, full)
      const row = { name, atSec: round(t, 2) }
      for (const w of [1920, 430, 390]) {
        const f = w === 1920 ? full : join(tmp, `qr-${name}-${w}.png`)
        if (w !== 1920) await execFileAsync(ff, ['-v', 'error', '-y', '-i', full, '-vf', `scale=${w}:-2:flags=lanczos`, f])
        const r = await decodeQr(f)
        row[`w${w}`] = Boolean(r.decoded && r.sha256 === originalSha)
      }
      qrRows.push(row)
    }
    const edge = async (t) => { const f = join(tmp, 'edge.png'); await frame(t, f); const r = await decodeQr(f); return Boolean(r.decoded && r.sha256 === originalSha) }
    out.qr = { allReadable: qrRows.every((r) => r.w1920 && r.w430 && r.w390), rows: qrRows.map((r) => [r.name, r.w1920, r.w430, r.w390]), overlayEdges: { beforeStart: await edge(ov.startSec - 1.5 / FPS), firstFrame: await edge(ov.startSec + 0.5 / FPS), lastFrame: await edge(ov.endSec - 1.5 / FPS), afterEnd: await edge(ov.endSec + 1.5 / FPS) }, windows: planQrWindows(plan.cfg, T).map((w) => ({ kind: w.kind, startSec: w.startSec, endSec: w.endSec, sec: round(w.endSec - w.startSec, 3) })) }
    const outroA = await pcm(video, outro.startSec + 0.3, 11)
    out.outro = { sec: round(outro.endSec - outro.startSec, 3), silent: rmsDb(outroA) < -60 }

    // ── 目視用フレーム ──
    if (args.framesDir) {
      const list = []
      clips.forEach((c, k) => list.push([`01-digest-clip${k + 1}-mid`, starts[k] + c.durationSec / 2], [`01-digest-clip${k + 1}-start`, starts[k] + 0.3]))
      list.push(['02-digest-end', T.digestSec - 0.05], ['03-main-start', D + 0.1], ['04-overlay-mid', (ov.startSec + ov.endSec) / 2], ['05-overlay-end-before', ov.endSec - 0.1], ['06-overlay-end-after', ov.endSec + 0.1])
      plan.tm.items.forEach((it, k) => { if (it.kind === 'card') list.push([`07-card${k}`, D + it.editedStartSec + 0.6]); else list.push([`08-seg${k}-mid`, D + (it.editedStartSec + it.editedEndSec) / 2]) })
      list.push(['09-outro-start', outro.startSec + 0.4], ['10-last', T.totalSec - 0.05])
      for (const [n, t] of list) await frame(t, join(args.framesDir, `${n}.png`), 'scale=960:-2:flags=lanczos')
      out.frames = { saved: list.length }
    }
  })
  console.log(JSON.stringify(out, null, 2))
}

// ────────────────────────────────────────────────────────────────
// machinery: カット機構の技術試験（成果物ではない。強制カットを一時ファイルで検証し、終了後に削除する）
// ────────────────────────────────────────────────────────────────
async function stageMachinery(args) {
  const { job } = loadJob(args.job)
  const base = loadBase(job)
  const { sourceRealPath, inputRoots } = safetyContext(job)
  // 実測で100%無音（-60dB台）の 0.62秒の間（408.66〜409.28秒付近）から、前後の余白を残して 0.3秒だけを強制カットする（採用条件は満たさない。技術試験のみ）
  const cut = { cutStartSec: 408.9, cutEndSec: 409.2 }
  const region = { a: 400, b: 418 }
  const tm = buildEditTimeMap(itemsFromCuts(region.b, [cut]).filter((i) => i.srcEndSec > region.a).map((i) => ({ ...i, srcStartSec: Math.max(i.srcStartSec, region.a) })))
  const caps = base.captions.filter((c) => c.startSec >= region.a && c.endSec <= region.b)
  const okCaps = caps.filter((c) => !(c.startSec < cut.cutEndSec && c.endSec > cut.cutStartSec))
  const mapped = mapCaptions(okCaps, tm, { strict: true })
  const report = { stage: 'machinery', cut, captionsTotal: caps.length, captionsCrossingCut: caps.length - okCaps.length, mappedCaptions: mapped.length, captionCheck: verifyMappedCaptions(okCaps, mapped) }
  const cfg = resolveCompositionConfig({ digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false }, qr: { enabled: false } })
  const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: tm.totalSec, digestClips: [] })
  const { result, removed } = await withTempDir('lcv-cuts-mech-', async (tmp) => {
    const finalPath = join(tmp, 'mech.mp4')
    await renderCompositionToFile({ cfg, timeline, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: tm.totalSec, mainItems: tm.items, digestClips: [], assText: '[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: N,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n', tmpDir: tmp, finalPath })
    const pts = await ptsReport(finalPath, tm.totalSec)
    // カット前後の点で、元動画との音声・映像のずれ（編集後の時刻 = 元の時刻 - 区間開始 - （カット後ならカット長））
    const cutLen = cut.cutEndSec - cut.cutStartSec
    const rows = []
    for (const s of [402, 404.5, 412, 415]) {
      const outSec = s < cut.cutStartSec ? s - region.a : s - region.a - cutLen
      rows.push({ srcSec: s, ...(await measurePoint({ video: finalPath, source: sourceRealPath, srcSec: s, outSec })) })
    }
    // 接続点のクリックノイズ: 接続点（編集後の時刻）前後 ±10ms の音声の最大振幅と、隣り合うサンプルの最大差
    const joinAt = cut.cutStartSec - region.a
    const a48 = (await execFileAsync(process.env.FFMPEG_BIN, ['-v', 'error', '-ss', String(round(joinAt - 0.1, 3)), '-t', '0.2', '-i', finalPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
    const x = new Float32Array(a48.buffer, a48.byteOffset, Math.floor(a48.length / 4))
    let peak = 0
    let maxStep = 0
    const c0 = Math.round(0.1 * 48000)
    for (let i = c0 - 480; i < c0 + 480; i++) { peak = Math.max(peak, Math.abs(x[i])); maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1])) }
    let ref = 0
    for (let i = 1; i < x.length; i++) ref = Math.max(ref, Math.abs(x[i] - x[i - 1]))
    let dec = true
    try { await execFileAsync(process.env.FFMPEG_BIN, ['-v', 'error', '-i', finalPath, '-f', 'null', '-'], { maxBuffer: 1 << 26 }) } catch { dec = false }
    return { pts, rows, joinClick: { peakAmp: round(peak, 5), maxSampleStep: round(maxStep, 5), maxStepInWholeClip: round(ref, 5) }, decodeOk: dec, durationExpected: tm.totalSec }
  })
  report.render = result
  report.tempDirRemoved = removed
  const av = result.rows.map((r) => r.avOffsetMs).filter((v) => v !== null)
  report.avOffsetMs = { maxAbs: av.length ? round(Math.max(...av.map(Math.abs)), 2) : null, allWithinOneFrame: av.every((v) => Math.abs(v) < 1000 / FPS) }
  console.log(JSON.stringify(report, null, 2))
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (args.stage === 'analyze') return stageAnalyze(args)
  if (args.stage === 'compare') return stageCompare(args)
  if (args.stage === 'verify') return stageVerify(args)
  if (args.stage === 'machinery') return stageMachinery(args)
  throw new Error('ステージは analyze / compare / verify / machinery のいずれかです')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[localCaptionCuts] ${err.message}`)
    process.exit(1)
  })
}
