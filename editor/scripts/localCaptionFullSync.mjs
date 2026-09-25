// ローカルAIテロップ動画: 音声・映像・字幕の同期の計測（レンダー前の短時間試験 / レンダー後の検証）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionFullSync.mjs pretest --job <jobId> --key <version> --bgm <BGM> --qr <QR>
//        # 修正済みの合成グラフで短い動画を数本作り（一時ディレクトリ・終了後に削除）、音声・映像・字幕の同期を測る。全編は作らない。
//   node scripts/localCaptionFullSync.mjs post --job <jobId> --key <version> --video <完成動画> [--main-offset <秒>]
//        # 完成動画（読み取りのみ）の同期・PTS・デコードを測る。--main-offset は本編の開始秒（省略時はキーのダイジェスト長）
//
// 測り方（元動画の時間軸が基準。元動画の音声は映像より遅れて始まるが、その相対関係をそのまま保てば同期は保たれる）:
// - 音声: 出力音声と元動画の音声を相互相関し、遅れ（+）・先行（−）をサンプル精度（16kHz）で測る。
// - 映像: 元動画のフレームと一致する出力フレームを探し、そのフレームの実PTSと期待時刻の差を測る。
// - 音声と映像のずれ = 音声の遅れ − 映像の遅れ。
// - 字幕: 出力音声の発話開始（無音→発話）と、直前・直後のcaption開始の差を測る（窓・区間ごとの中央値）。
// 外部AI APIは呼ばない。字幕本文・絶対パスは出力しない。

import { readFileSync, statSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import dotenv from 'dotenv'

import { EDITOR_ROOT, loadJob, safetyContext, setFullKey, fullKey, audioStartOffsetSec } from './localCaptionFull.mjs'
import { buildPlan } from './localCaptionFullRender.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { resolveCompositionAssets, renderCompositionToFile } from '../server/lib/compositionRender.mjs'
import { computeFrameDb, detectSilences } from '../server/lib/silenceDetector.mjs'

const execFileAsync = promisify(execFile)
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null }
const FPS = 30
const SR = 16000
const FRAME_REGION = 'crop=iw*0.34:ih*0.28:iw*0.33:ih*0.36,scale=64:40:flags=area' // 顔の周辺（字幕・テーマ・LINEパネルと重ならない）

function parseArgs(argv) {
  const o = { stage: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') o.job = argv[++i]
    else if (a === '--key') o.key = argv[++i]
    else if (a === '--bgm') o.bgm = argv[++i]
    else if (a === '--qr') o.qr = argv[++i]
    else if (a === '--video') o.video = argv[++i]
    else if (a === '--main-offset') o.mainOffset = Number(argv[++i])
    else if (a === '--regions') o.regions = String(argv[++i]).split(',').map((x) => x.split('-').map(Number)).map(([a, b]) => ({ a, b }))
    else if (a === '--regions-only') o.regionsOnly = true
  }
  return o
}

const ffmpeg = () => process.env.FFMPEG_BIN
const ffprobe = () => process.env.FFPROBE_BIN

/** 音声をモノラル16kHzのFloat64配列で読む（[ss, ss+dur)）。 */
export async function pcm(file, ss, dur) {
  const b = (await execFileAsync(ffmpeg(), ['-v', 'error', '-ss', String(Math.max(0, ss)), '-t', String(dur), '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 28 })).stdout
  const n = Math.floor(b.length / 2)
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) a[i] = b.readInt16LE(i * 2) / 32768
  return a
}

/**
 * out[i] ≈ src[i - d] となる d（サンプル）を、正規化相互相関で探す。d>0: 出力の音声が元より遅れている、d<0: 先行。
 * 放物線補間でサブサンプル精度にする。
 */
export function audioDelay(out, src, maxLag = 3200) {
  const N = Math.min(out.length, src.length)
  const lo = maxLag
  const hi = N - maxLag
  if (hi - lo < SR) return { ok: false }
  const pre = new Float64Array(N + 1)
  for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + src[i] * src[i]
  let eo = 0
  for (let i = lo; i < hi; i++) eo += out[i] * out[i]
  const score = (d) => {
    let s = 0
    for (let i = lo; i < hi; i++) s += out[i] * src[i - d]
    const es = pre[hi - d] - pre[lo - d]
    return s / Math.sqrt(eo * es + 1e-18)
  }
  let best = { d: 0, c: -2 }
  const cs = new Map()
  for (let d = -maxLag; d <= maxLag; d++) {
    const c = score(d)
    cs.set(d, c)
    if (c > best.c) best = { d, c }
  }
  const c0 = cs.get(best.d - 1) ?? best.c
  const c2 = cs.get(best.d + 1) ?? best.c
  const den = c0 - 2 * best.c + c2
  const frac = den < 0 ? (0.5 * (c0 - c2)) / den : 0
  return { ok: true, delaySamples: best.d + frac, delayMs: ((best.d + frac) / SR) * 1000, corr: best.c }
}

const RUN = 24 // 照合するフレーム数（約0.8秒。動きがあるほど判別できる）

const FR_W = 64
const FR_H = 40
const outFrameCache = new Map()
/** 出力動画の全フレーム（顔の周辺・グレー・64x40）を1回だけ順次デコードして持つ。出力は30fps一定なので、フレーム番号 n の時刻は n/30。 */
async function outputFrames(video) {
  if (!outFrameCache.has(video)) {
    const r = await execFileAsync(ffmpeg(), ['-v', 'error', '-i', video, '-an', '-vf', `${FRAME_REGION},fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 30 })
    outFrameCache.set(video, r.stdout)
  }
  return outFrameCache.get(video)
}

/**
 * 元動画の時刻 s（フレーム時刻）から RUN フレームと最もよく一致する出力フレームを探し、その先頭フレームのPTS（秒）を返す（±4フレーム）。
 * 元動画は「フレームの半分手前」からシークして、目的のフレームから確実に始める（PTSちょうどを指定すると丸めで1フレーム取りこぼすことがある）。
 * 出力はフレーム番号で扱う（-ss の丸めに依存しない）。ratio: 次点のコスト / 最良のコスト。1に近いと（静止に近い画面など）1フレームを判別できない。
 */
export async function videoMatchPts(video, source, s, expectedOut) {
  const kS = Math.round(s * FPS)
  // 元動画の映像フレームは 1/30 秒の格子に載っていない（約29.9977fps）ため、実際のPTSを取り、期待する出力時刻をそのぶん補正する。
  const sr = await execFileAsync(ffmpeg(), ['-hide_banner', '-copyts', '-ss', String(round(Math.max(0, (kS - 0.5) / FPS), 5)), '-i', source, '-frames:v', String(RUN), '-an', '-vf', `${FRAME_REGION},showinfo`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 27 })
  const src = sr.stdout
  const srcPts0 = Number([...sr.stderr.toString().matchAll(/pts_time:([0-9.]+)/g)][0]?.[1])
  const drift = Number.isFinite(srcPts0) ? srcPts0 - s : 0
  const out = await outputFrames(video)
  const size = FR_W * FR_H
  const nOut = Math.floor(out.length / size)
  const nSrc = Math.floor(src.length / size)
  const e = Math.round(expectedOut * FPS)
  const costs = []
  for (let j = -4; j <= 4; j++) {
    const start = e + j
    if (start < 0 || start + nSrc > nOut) { costs.push(Infinity); continue }
    let c = 0
    for (let i = 0; i < nSrc; i++) {
      let d = 0
      for (let k = 0; k < size; k++) d += Math.abs(out[(start + i) * size + k] - src[i * size + k])
      c += d / size
    }
    costs.push(c / nSrc)
  }
  const order = costs.map((c, j) => [c, j - 4]).filter((x) => Number.isFinite(x[0])).sort((x, y) => x[0] - y[0])
  if (!order.length) return { pts: null, diff: null, ratio: null }
  const [bestC, bestJ] = order[0]
  return { pts: (e + bestJ) / FPS - drift, diff: bestC, ratio: order.length > 1 ? order[1][0] / bestC : null, srcDriftMs: round(drift * 1000, 1) }
}

/** 音声の発話開始（無音→発話）の時刻（出力の時刻）。 */
export function speechOnsets(samples01, frameSec = 0.01) {
  const samples = samples01.map((v) => v * 32768) // silenceDetector は int16 スケールを前提にする
  const { thresholdDb } = detectSilences(samples, SR, { minSilenceSec: 0.3 })
  const { db } = computeFrameDb(samples, SR, frameSec)
  const quiet = Math.round(0.25 / frameSec)
  const out = []
  for (let i = quiet; i < db.length; i++) {
    if (db[i] <= thresholdDb) continue
    let allQuiet = true
    for (let k = 1; k <= quiet; k++) if (db[i - k] > thresholdDb) { allQuiet = false; break }
    if (allQuiet) out.push(i * frameSec)
  }
  return out
}

/**
 * captionの開始と音声の「音量の立ち上がり」の位置関係（系統的なオフセット）。
 * 直前のcaptionとの間に0.15秒以上の間があるcaptionだけを使い、各captionの開始 t に対して、音量が最も立ち上がる位置 t+δ を探す
 * （前後0.2秒の平均音量の差が最大になる δ の平均。10msフレームを放物線補間）。δ>0: 発話が字幕開始より後。字幕の設計上の先行（約0.08秒）が期待値。
 * 区間ごとの差（例: 再アラインメント窓の内外）が系統的なずれを表す。
 */
function captionLeadMs(events, samples01, t0Out, minGapSec = 0.15) {
  const frameSec = 0.01
  const { db } = computeFrameDb(samples01.map((v) => v * 32768), SR, frameSec)
  const W = 20
  const rise = (i0, dFrames) => {
    let after = 0
    let before = 0
    for (let k = 2; k < W; k++) { after += db[i0 + dFrames + k] ?? -120; before += db[i0 + dFrames - k] ?? -120 }
    return (after - before) / (W - 2)
  }
  const use = events.filter((e, i) => i > 0 && e.startSec - events[i - 1].endSec >= minGapSec)
  if (use.length < 5) return { used: use.length, leadMs: null }
  const score = []
  for (let d = -20; d <= 30; d++) {
    let s = 0
    let n = 0
    for (const e of use) {
      const i0 = Math.round((e.startSec - t0Out) / frameSec)
      if (i0 - W - 20 < 0 || i0 + W + 30 >= db.length) continue
      s += rise(i0, d)
      n++
    }
    score.push(n ? s / n : -1e9)
  }
  let bi = 0
  score.forEach((v, i) => { if (v > score[bi]) bi = i })
  const c0 = score[bi - 1] ?? score[bi]
  const c2 = score[bi + 1] ?? score[bi]
  const den = c0 - 2 * score[bi] + c2
  const frac = den < 0 ? (0.5 * (c0 - c2)) / den : 0
  return { used: use.length, leadMs: round((bi - 20 + frac) * frameSec * 1000, 1), peakRiseDb: round(score[bi], 2) }
}

/** 1点の測定: 音声の遅れ・映像の遅れ・音声と映像のずれ。srcSec は元動画の時刻、outSec は出力での期待時刻。 */
export async function measurePoint({ video, source, srcSec, outSec }) {
  let used = srcSec
  let a = { ok: false }
  for (let k = 0; k < 4 && !(a.ok && a.corr >= 0.6); k++) {
    used = srcSec + k * 3
    const o = await pcm(video, outSec + k * 3, 4)
    const s = await pcm(source, used, 4)
    a = audioDelay(o, s)
  }
  let v = { pts: null, ratio: 0 }
  let vUsed = srcSec
  for (let k = 0; k < 4; k++) {
    const t = srcSec + k * 3
    const frameT = Math.round(t * FPS) / FPS
    const expected = outSec + (frameT - srcSec)
    const m = await videoMatchPts(video, source, frameT, expected)
    if (m.pts !== null && (v.pts === null || (m.ratio ?? 0) > (v.ratio ?? 0))) v = { ...m, expected }
    if (m.pts !== null && (m.ratio ?? 0) >= 1.15) break
  }
  vUsed = v.pts === null ? null : v.expected
  const videoDelayMs = v.pts === null ? null : (v.pts - vUsed) * 1000
  return {
    srcSec: round(srcSec, 2),
    usedSrcSec: round(used, 2),
    audioDelayMs: a.ok ? round(a.delayMs, 2) : null,
    audioCorr: a.ok ? round(a.corr, 3) : null,
    videoPtsOffsetMs: videoDelayMs === null ? null : round(videoDelayMs, 2),
    videoMatchRatio: v.ratio == null ? null : round(v.ratio, 2), // 1.15以上なら1フレームを判別できている
    avOffsetMs: a.ok && videoDelayMs !== null ? round(a.delayMs - videoDelayMs, 2) : null,
  }
}

export async function ptsReport(video, expectedTotalSec) {
  const probe = JSON.parse((await execFileAsync(ffprobe(), ['-v', 'error', '-print_format', 'json', '-show_entries', 'stream=index,codec_type,start_time,start_pts,duration,time_base,nb_frames:format=start_time,duration', video])).stdout)
  const vs = probe.streams.find((s) => s.codec_type === 'video')
  const as = probe.streams.find((s) => s.codec_type === 'audio')
  const pk = (await execFileAsync(ffprobe(), ['-v', 'error', '-show_entries', 'packet=stream_index,pts_time,duration_time', '-of', 'csv=p=0', video], { maxBuffer: 1 << 29 })).stdout.trim().split('\n')
  const st = { 0: { min: Infinity, endMax: -Infinity, neg: 0 }, 1: { min: Infinity, endMax: -Infinity, neg: 0 } }
  const vi = Number(vs.index)
  for (const line of pk) {
    const [i, p, d] = line.split(',')
    const k = Number(i) === vi ? 0 : 1
    const t = Number(p)
    if (!Number.isFinite(t)) continue
    st[k].min = Math.min(st[k].min, t)
    st[k].endMax = Math.max(st[k].endMax, t + (Number(d) || 0))
    if (t < -1e-9) st[k].neg += 1
  }
  const fr = (await execFileAsync(ffprobe(), ['-v', 'error', '-select_streams', 'a:0', '-read_intervals', '%+#2', '-show_entries', 'frame=pts_time,nb_samples', '-of', 'csv=p=0', video])).stdout.trim().split('\n')
  return {
    formatStartSec: Number(probe.format.start_time),
    containerDurationSec: round(Number(probe.format.duration)),
    video: { startSec: Number(vs.start_time), startPts: Number(vs.start_pts), durationSec: round(Number(vs.duration)), firstPacketSec: st[0].min, endSec: round(st[0].endMax, 4), negativePts: st[0].neg },
    audio: { startSec: Number(as.start_time), startPts: Number(as.start_pts), durationSec: round(Number(as.duration)), firstPacketSec: st[1].min, endSec: round(st[1].endMax, 4), negativePts: st[1].neg, firstFrames: fr.slice(0, 2) },
    endDiffSec: round(Math.abs(st[0].endMax - st[1].endMax), 4),
    expectedTotalSec: expectedTotalSec ?? null,
  }
}

/** 元動画の音声先頭 offset 分の「無音」が、出力の本編先頭にあるか（padded silence）。 */
export async function paddedSilenceReport(video, source, mainOutSec, offsetSec) {
  const at = async (f, ss, dur) => {
    const b = (await execFileAsync(ffmpeg(), ['-v', 'error', '-ss', String(Math.max(0, ss)), '-t', String(dur), '-i', f, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
    return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))
  }
  const peak = (a, i, j) => { let m = 0; for (let k = Math.max(0, i); k < Math.min(a.length, j); k++) m = Math.max(m, Math.abs(a[k])); return m }
  const o = await at(video, mainOutSec - 0.05, 0.3) // 本編の開始の50ms前から
  const s = await at(source, 0, 0.25)
  const o0 = Math.round(0.05 * 48000)
  const pad = Math.round(offsetSec * 48000)
  // 出力: 本編開始から offset までの区間と、その後の区間の最大振幅。元: 音声の先頭250ms
  return {
    expectedPaddedSilenceMs: round(offsetSec * 1000, 3),
    outputPeakDuringPad: round(peak(o, o0, o0 + pad - 96), 6), // 末尾2msは符号化のなだらかな立ち上がりを避ける
    outputPeakAfterPad: round(peak(o, o0 + pad + 96, o0 + pad + 4800), 6),
    sourcePeakFirst100ms: round(peak(s, 0, 4800), 6),
  }
}

// ────────────────────────────────────────────────────────────────
// post: 完成動画の検証（読み取りのみ）
// ────────────────────────────────────────────────────────────────
async function measureVideo({ video, source, job, plan, mainOutSec, points, regions }) {
  const rows = []
  for (const p of points) rows.push({ label: p.label, ...(await measurePoint({ video, source, srcSec: p.s, outSec: mainOutSec + p.s })) })
  // 字幕と音声: 区間ごとの、字幕開始と音量の立ち上がりの位置関係
  const events = plan.mainCaps
  const capRows = []
  for (const r of regions) {
    const t0 = mainOutSec + r.a
    const o = await pcm(video, t0, r.b - r.a)
    const ev = events.filter((e) => e.startSec >= t0 + 0.5 && e.startSec < mainOutSec + r.b - 0.5)
    const g = captionLeadMs(ev, o, t0, 0.15) // 直前に間があるcaptionだけ
    const all = captionLeadMs(ev, o, t0, -1) // 全caption
    capRows.push({ region: `${r.a}-${r.b}s`, captions: ev.length, afterGap: g, all })
  }
  return { points: rows, captionVsAudio: capRows }
}

const POINTS = [
  { label: 'main-start', s: 0.3 }, { label: 'main-30s', s: 30 }, { label: 'main-150s', s: 150 }, { label: 'main-300s', s: 300 },
  { label: 'before-312s', s: 309.5 }, { label: 'after-312s', s: 313.5 }, { label: 'main-450s', s: 450 }, { label: 'main-600s', s: 600 },
  { label: 'main-750s', s: 750 }, { label: 'main-900s', s: 900 }, { label: 'main-end', s: 913 },
]
const REGIONS = [[0, 100], [100, 200], [200, 312], [312, 420], [420, 600], [600, 760], [760, 913]].map(([a, b]) => ({ a, b }))

async function stagePost(args) {
  const { job } = loadJob(args.job)
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  const video = args.video.includes('/') ? args.video : join(outputRoot, args.video)
  if (!existsSync(video)) throw new Error('動画が見つかりません')
  const capDoc = JSON.parse(readFileSync(resolve(EDITOR_ROOT, `data/local_caption_comparisons/full/${fullKey()}.captions.json`), 'utf-8'))
  const topics = JSON.parse(readFileSync(resolve(EDITOR_ROOT, `data/local_caption_comparisons/full/${fullKey()}.topics.json`), 'utf-8'))
  const digest = JSON.parse(readFileSync(resolve(EDITOR_ROOT, `data/local_caption_comparisons/full/${fullKey()}.digest.json`), 'utf-8'))
  const plan = buildPlan(job, { capDoc, topics, digest }, { bgm: args.bgm, qr: args.qr })
  const D = Number.isFinite(args.mainOffset) ? args.mainOffset : plan.timeline.mainOffsetSec
  const out = { stage: 'post', key: fullKey(), mainStartInVideoSec: D, audioStartOffsetSec: round(audioStartOffsetSec(sourceRealPath), 6) }
  out.pts = await ptsReport(video, plan.timeline.totalSec)
  out.paddedSilence = await paddedSilenceReport(video, sourceRealPath, D, out.audioStartOffsetSec)
  const m = await measureVideo({ video, source: sourceRealPath, job, plan, mainOutSec: D, points: args.regionsOnly ? [] : POINTS, regions: args.regions ?? REGIONS })
  out.points = m.points
  out.captionVsAudio = m.captionVsAudio
  const av = m.points.map((p) => p.avOffsetMs).filter((x) => x !== null)
  const au = m.points.map((p) => p.audioDelayMs).filter((x) => x !== null)
  if (args.regionsOnly) {
    console.log(JSON.stringify({ stage: 'post-regions', captionVsAudio: m.captionVsAudio }, null, 2))
    return
  }
  out.summary = { pointCount: m.points.length, avOffsetMs: { median: round(median(av), 2), maxAbs: round(Math.max(...av.map(Math.abs)), 2), min: Math.min(...av), max: Math.max(...av) }, audioDelayMs: { median: round(median(au), 2), min: Math.min(...au), max: Math.max(...au) }, driftMs: round(Math.max(...av) - Math.min(...av), 2), allWithinOneFrame: av.every((x) => Math.abs(x) < 1000 / FPS) }
  // 全体デコード
  let decodeOk = true
  let decodeMs = Date.now()
  try { await execFileAsync(ffmpeg(), ['-v', 'error', '-i', video, '-f', 'null', '-'], { maxBuffer: 1 << 26 }) } catch { decodeOk = false }
  out.decode = { fullDecodeNoErrors: decodeOk, ms: Date.now() - decodeMs }
  console.log(JSON.stringify(out, null, 2))
}

// ────────────────────────────────────────────────────────────────
// pretest: 短い試験（修正済みの合成グラフで、全編は作らない）
// ────────────────────────────────────────────────────────────────
async function stagePretest(args) {
  const { job } = loadJob(args.job)
  const { sourceRealPath, inputRoots } = safetyContext(job)
  const dir = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/full')
  const load = (n) => JSON.parse(readFileSync(resolve(dir, `${fullKey()}.${n}.json`), 'utf-8'))
  const saved = { capDoc: load('captions'), topics: load('topics'), digest: load('digest') }
  const offsetSec = audioStartOffsetSec(sourceRealPath)
  const report = { stage: 'pretest', key: fullKey(), audioStartOffsetSec: round(offsetSec, 6), cases: [] }
  const noExtras = { digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } }
  const cases = [
    { name: 'A: ダイジェスト+本編冒頭30秒+末尾案内（つなぎ目のPTS・先頭補正）', range: { startSec: 0, endSec: 30 }, overrides: {}, points: [{ label: 'main-start', s: 0.3 }, { label: 'main-10s', s: 10 }, { label: 'main-28s', s: 28 }], regions: [{ a: 0, b: 30 }] },
    { name: 'B: 本編300〜320秒（再アラインメント窓の境界312秒を含む）', range: { startSec: 300, endSec: 320 }, overrides: noExtras, points: [{ label: 'main-301s', s: 301 }, { label: 'before-312s', s: 309.5 }, { label: 'after-312s', s: 313.5 }, { label: 'main-318s', s: 316.5 }], regions: [{ a: 300, b: 320 }] },
    { name: 'C: 本編600秒付近', range: { startSec: 598, endSec: 612 }, overrides: noExtras, points: [{ label: 'main-600s', s: 600 }, { label: 'main-608s', s: 608 }], regions: [{ a: 598, b: 612 }] },
    { name: 'D: 本編900秒付近', range: { startSec: 898, endSec: 912 }, overrides: noExtras, points: [{ label: 'main-900s', s: 900 }, { label: 'main-908s', s: 908 }], regions: [{ a: 898, b: 912 }] },
  ]
  const { removed } = await withTempDir('lcv-sync-pretest-', async (tmp) => {
    for (const c of cases) {
      const plan = buildPlan(job, saved, { bgm: args.bgm, qr: args.qr }, { range: c.range, overrides: c.overrides })
      const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
      if (!assets.ok) throw new Error('素材を確認できません')
      const T = plan.timeline
      const assText = plan.buildAss({ width: assets.qr?.width, height: assets.qr?.height })
      const finalPath = join(tmp, `case-${cases.indexOf(c)}.mp4`)
      const t0 = Date.now()
      await renderCompositionToFile({ cfg: plan.cfg, timeline: T, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: c.range.startSec, mainEndSec: c.range.endSec, digestClips: plan.clips, bgmPath: assets.bgm?.realPath, qrPath: assets.qr?.realPath, qrSize: assets.qr ? { width: assets.qr.width, height: assets.qr.height } : undefined, assText, tmpDir: tmp, finalPath })
      const renderMs = Date.now() - t0
      // 期待: 出力の時刻 = 本編オフセット + (元の秒 - 本編開始)
      const mainOut = T.mainOffsetSec - c.range.startSec
      const pts = await ptsReport(finalPath, T.totalSec)
      const m = await measureVideo({ video: finalPath, source: sourceRealPath, job, plan, mainOutSec: mainOut, points: c.points, regions: c.regions })
      const av = m.points.map((p) => p.avOffsetMs).filter((x) => x !== null)
      const entry = { name: c.name, renderMs, totalSec: T.totalSec, mainOffsetSec: T.mainOffsetSec, pts, points: m.points, captionVsAudio: m.captionVsAudio, avOffsetMs: { min: Math.min(...av), max: Math.max(...av), maxAbs: round(Math.max(...av.map(Math.abs)), 2) } }
      if (c.name.startsWith('A')) entry.paddedSilence = await paddedSilenceReport(finalPath, sourceRealPath, T.mainOffsetSec, offsetSec)
      report.cases.push(entry)
    }
  })
  report.tempDirRemoved = removed
  // 全編と同じ音声フィルタ（-ss 0 の読み込み + first_pts=0）を、映像なしで本編の全長へ通し、時間経過によるずれの蓄積を測る。
  report.fullLengthAudio = await fullLengthAudioDrift({ job, sourceRealPath })
  const all = report.cases.flatMap((c) => c.points.map((p) => p.avOffsetMs)).filter((x) => x !== null)
  report.summary = { avOffsetMs: { min: Math.min(...all), max: Math.max(...all), maxAbs: round(Math.max(...all.map(Math.abs)), 2) }, allWithinOneFrame: all.every((x) => Math.abs(x) < 1000 / FPS), allWithin20ms: all.every((x) => Math.abs(x) <= 20), pass: all.every((x) => Math.abs(x) < 1000 / FPS) && report.fullLengthAudio.allWithinOneFrame && report.fullLengthAudio.driftMs < 1000 / FPS }
  console.log(JSON.stringify(report, null, 2))
  if (!report.summary.pass) process.exitCode = 2
}

async function fullLengthAudioDrift({ job, sourceRealPath }) {
  return withTempDir('lcv-sync-audio-', async (tmp) => {
    const wav = join(tmp, 'main-audio.wav')
    const md = round(job.durationSec, 3)
    // buildCompositionArgs の本編の音声チェーンと同じ（-ss 0 -t md → aresample first_pts=0 → atrim → asetpts）。出力は48kHzステレオWAV。
    await execFileAsync(ffmpeg(), ['-v', 'error', '-y', '-ss', '0', '-t', String(md), '-i', sourceRealPath, '-vn', '-filter_complex', `[0:a]aresample=48000:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${md},asetpts=PTS-STARTPTS[ma]`, '-map', '[ma]', '-c:a', 'pcm_s16le', wav], { maxBuffer: 1 << 26, timeout: 900000 })
    const pts = [{ label: 'main-start', s: 0.3 }, { label: 'main-30s', s: 30 }, { label: 'main-300s', s: 300 }, { label: 'before-312s', s: 309.5 }, { label: 'after-312s', s: 313.5 }, { label: 'main-600s', s: 600 }, { label: 'main-900s', s: 900 }]
    const rows = []
    for (const p of pts) {
      let a = { ok: false }
      for (let k = 0; k < 4 && !(a.ok && a.corr >= 0.6); k++) a = audioDelay(await pcm(wav, p.s + k * 3, 4), await pcm(sourceRealPath, p.s + k * 3, 4))
      rows.push({ label: p.label, audioDelayMs: a.ok ? round(a.delayMs, 2) : null, corr: a.ok ? round(a.corr, 3) : null })
    }
    const d = rows.map((r) => r.audioDelayMs).filter((x) => x !== null)
    const info = JSON.parse((await execFileAsync(ffprobe(), ['-v', 'error', '-print_format', 'json', '-show_entries', 'stream=start_time,duration', wav])).stdout).streams[0]
    return { rows, min: Math.min(...d), max: Math.max(...d), driftMs: round(Math.max(...d) - Math.min(...d), 2), allWithinOneFrame: d.every((x) => Math.abs(x) < 1000 / FPS), outputStartSec: Number(info.start_time), outputDurationSec: round(Number(info.duration)), expectedDurationSec: md }
  }).then((r) => r.result ?? r)
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const args = parseArgs(process.argv.slice(2))
  setFullKey(args.key)
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (args.stage === 'pretest') return stagePretest(args)
  if (args.stage === 'post') return stagePost(args)
  throw new Error('ステージは pretest / post のいずれかです')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[localCaptionFullSync] ${err.message}`)
    process.exit(1)
  })
}
