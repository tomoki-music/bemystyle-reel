// ローカルAIテロップ動画: 本編先頭の無音カット + 本編BGM（ユーザー指定のMP3）の分析・技術試験・確認動画。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionMainBgm.mjs intro-analyze --job <jobId> [--whisper] [--force]   # 先頭の無音を実測してカット点を決め、タイムマップ・不変性を検証して full_v6.* へ保存（動画は作らない）
//   node scripts/localCaptionMainBgm.mjs machinery     --job <jobId>                          # 合成MP3で本編BGMの機構を技術試験（一時フォルダのみ・成果物ではない・終了後に全削除）
//   node scripts/localCaptionMainBgm.mjs preview       --job <jobId> --main-bgm <MP3> --bgm <ダイジェストBGM> --qr <QR>   # 実MP3での確認動画を1本（--main-bgm が無ければ「素材待ち」で停止）
//   node scripts/localCaptionMainBgm.mjs preview-verify --job <jobId> --main-bgm <MP3> --bgm <..> --qr <..>               # 確認動画の検証（読み取りのみ）
//
// 安全方針: 外部AI API不使用（ローカルのffmpeg・ffprobe・whisper.cppと既存データだけ）。元動画・MP3・ジョブJSON・v3〜v5データ・既存動画は変更しない。
// 新しいデータは editor/data/local_caption_comparisons/full/ へ full_v6.* として別ファイル保存（git管理外・既存は上書きしない）。
// 標準出力・保存データに絶対パスを出さない。字幕本文は標準出力へ出さない（手動補完の候補文言だけ保存データに残す）。

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import os from 'os'
import dotenv from 'dotenv'

import { EDITOR_ROOT, FULL_DIR, loadJob, safetyContext, writeJsonAtomic } from './localCaptionFull.mjs'
import { pcm, measurePoint, ptsReport } from './localCaptionFullSync.mjs'
import { loadBase, SHORT_DIGEST_PICKS } from './localCaptionCuts.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { readWavPcm16Mono, computeFrameDb, detectSilences } from '../server/lib/silenceDetector.mjs'
import { findFirstSpeechOnset, planIntroCut, verifyIntroCutSilent, validateRecoveredCaptions, INTRO_CUT_DEFAULTS } from '../server/lib/introCut.mjs'
import { introCutItems, mapMainToFinal, mainAnchors } from '../server/lib/mainEdit.mjs'
import { findMidCaptionGaps } from '../server/lib/silenceCuts.mjs'
import { buildShortDigest, shortDigestCaptions, SHORT_DIGEST_DEFAULTS } from '../server/lib/shortDigest.mjs'
import { resolveCompositionConfig, validateCompositionConfig, planTimeline, digestThemeBlocks, buildFinalAss, buildCompositionArgs } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, renderCompositionToFile, checkFreeSpace, FULL_RENDER_MIN_FREE_BYTES } from '../server/lib/compositionRender.mjs'
import { inspectMainBgm, measureMainBgmLevels, prepareMainBgm } from '../server/lib/mainBgmAssets.mjs'
import { MAIN_BGM_DUCK, MAIN_BGM_GAP_TARGET, MAIN_BGM_LIMITER, buildMainBgmStemArgs, buildMainBgmFilters, planBgmGain, planBgmLoop, buildLoopUnitArgs, summarizeVoiceBgmGap, meanEnergyDb, resolveMainBgmConfig } from '../server/lib/mainBgm.mjs'
import { runWhisperCli, buildWhisperArgs, readWhisperJsonFile, parseWhisperJson } from '../server/lib/whisperLocal.mjs'

const execFileAsync = promisify(execFile)
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const FPS = 30
const SR = 48000
const BASE_KEY = 'full_v4' // 同期修正版（caption・テーマ）
const OUT_KEY = 'full_v6'
const pathFor = (name) => resolve(FULL_DIR, `${OUT_KEY}.${name}.json`)
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const ff = () => process.env.FFMPEG_BIN
const dirSnapshot = (dir) => Object.fromEntries(readdirSync(dir).map((n) => { const s = statSync(join(dir, n)); return [n, `${s.size}:${s.mtimeMs}`] }))
const fileSig = (p) => { const s = statSync(p); return `${s.size}:${s.mtimeMs}` }

function parseArgs(argv) {
  const o = { stage: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') o.job = argv[++i]
    else if (a === '--bgm') o.bgm = argv[++i]
    else if (a === '--qr') o.qr = argv[++i]
    else if (a === '--main-bgm') o.mainBgm = argv[++i]
    else if (a === '--whisper') o.whisper = true
    else if (a === '--force') o.force = true
    else if (a === '--length') o.length = Number(argv[++i])
  }
  return o
}

const decodeMono16k = async (args) => {
  const r = await execFileAsync(ff(), ['-v', 'error', ...args, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', '-c:a', 'pcm_s16le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 28 })
  return readWavPcm16Mono(r.stdout)
}

/** 手動補完caption（ユーザーが文言を確定したもの）。無ければ空。 */
export function loadRecovered(job) {
  const p = pathFor('intro-recovery')
  if (!existsSync(p)) return { captions: [], file: false }
  const doc = JSON.parse(readFileSync(p, 'utf-8'))
  if (doc.jobId !== job.id) throw new Error('手動補完captionのjobIdが一致しません')
  return { captions: doc.captions ?? [], file: true }
}

// ────────────────────────────────────────────────────────────────
// 共通: 先頭カット後の本編・タイムマップ・不変性の検証
// ────────────────────────────────────────────────────────────────
export function buildIntroCutPlanFromAudio(samples16k, sampleRate) {
  const { db, frameSec } = computeFrameDb(samples16k, sampleRate, INTRO_CUT_DEFAULTS.frameSec)
  const onset = findFirstSpeechOnset(db, frameSec)
  if (!onset.ok) return { ok: false, reason: onset.reason, db, frameSec }
  const plan = planIntroCut(onset.onsetSec)
  const silent = verifyIntroCutSilent(db, frameSec, plan.cutEndSec, onset.noiseFloorDb)
  return { ok: plan.ok && silent.ok, reason: plan.reason ?? (silent.ok ? undefined : 'カット範囲に音が含まれています'), onset, plan, silent, db, frameSec }
}

/** caption・テーマ・強調・語中無音の不変性（先頭カットのタイムマップ適用後）。 */
export function verifyInvariants({ base, items, digestSec, recovered }) {
  const mapped = mapMainToFinal({ items, captions: base.captions, recovered, themes: base.norm, mainOffsetSec: digestSec, strict: true })
  const orig = base.captions
  const out = mapped.mainCaptions.filter((c) => c.source !== 'manual-intro-recovery')
  const byId = new Map(out.map((c) => [c.id, c]))
  const shift = items[0].srcStartSec - digestSec // 変換前後の差（すべてのcaptionで同じ）
  let maxShiftDeviation = 0
  for (const c of orig) {
    const m = byId.get(c.id)
    if (!m) continue
    maxShiftDeviation = Math.max(maxShiftDeviation, Math.abs(m.startSec - (c.startSec - shift)), Math.abs(m.endSec - (c.endSec - shift)))
  }
  const midGaps = (caps) => findMidCaptionGaps(caps, base.pages.charStart, base.pages.charEnd, 0.5)
  // 承認済みの語中無音（約0.67秒・約0.72秒）: captionを継続表示する例外。caption内の間はcaptionと一緒に同じ秒数だけ動くので、間の長さは変わらない
  const approved = [567.98, 736.19].map((at) => {
    const cap = orig.find((c) => Math.abs(c.startSec - at) < 0.1)
    const gap = cap ? midGaps([cap]).sort((a, b) => b.gapSec - a.gapSec)[0] : null
    const m = cap ? byId.get(cap.id) : null
    return { atSec: at, gapSec: gap ? gap.gapSec : null, captionSecOriginal: cap ? round(cap.endSec - cap.startSec, 3) : null, captionSecMapped: m ? round(m.endSec - m.startSec, 3) : null }
  })
  const themes = mapped.themesMapped
  const emphasis = (arr) => arr.filter((c) => c.emphasisText).length
  return {
    captions: { count: [orig.length, out.length], sameOrderAndText: orig.every((c, i) => out[i] && out[i].id === c.id && out[i].text === c.text), verified: mapped.verification.captions, maxShiftDeviationSec: round(maxShiftDeviation, 4), uniformShiftSec: round(shift, 4) },
    emphasis: { original: emphasis(orig), mapped: emphasis(out), maintained: emphasis(orig) === emphasis(out) },
    midWordSilences: { approved, keptTwo: approved.length === 2 && approved.every((a) => a.gapSec !== null && Math.abs(a.captionSecOriginal - a.captionSecMapped) < 1e-3) },
    themes: { count: [base.norm.length, themes.length], coverage: mapped.verification.themes.coverage, gapSec: mapped.verification.themes.gapSec, overlapSec: mapped.verification.themes.overlapSec, firstStartsAtMainZero: themes.length > 0 && themes[0].startSec === 0, lastEndsAtMainEnd: themes.length > 0 && Math.abs(themes.at(-1).endSec - mapped.tm.totalSec) < 1e-3 },
    mapped,
  }
}

// ────────────────────────────────────────────────────────────────
// intro-analyze
// ────────────────────────────────────────────────────────────────
async function stageIntroAnalyze(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const base = loadBase(job)
  const { sourceRealPath, srcBefore } = safetyContext(job)
  for (const n of ['intro-cut', 'timemap']) if (existsSync(pathFor(n)) && !args.force) throw new Error(`同じバージョンの保存データが既にあります（上書きしません。--force で再作成）: ${OUT_KEY}.${n}`)

  // 実音声（映像と同じ起点 0秒。音声トラックが遅れて始まる分は先頭を無音で埋める）の先頭15秒
  const audio = await decodeMono16k(['-i', sourceRealPath, '-af', 'aresample=first_pts=0', '-t', String(INTRO_CUT_DEFAULTS.scanLimitSec)])
  const cut = buildIntroCutPlanFromAudio(audio.samples, audio.sampleRate)
  if (!cut.ok) {
    console.log(JSON.stringify({ stage: 'intro-analyze', ok: false, reason: cut.reason, onset: cut.onset ?? null, note: 'カットしません（判断できない場合は人間の確認）' }, null, 2))
    return
  }
  const sampleAligned = Math.abs(cut.plan.cutEndSec * SR - Math.round(cut.plan.cutEndSec * SR)) < 1e-6 && Math.round(cut.plan.cutEndSec * SR) % (SR / FPS) === 0
  // 発話前の余白（先頭の無音の終わりから最初の音の立ち上がりまで）に、声の立ち上がりが切れていないか: 立ち上がり〜声の間のフレームがカット後に全て残る
  const speechKept = cut.plan.cutEndSec < cut.onset.onsetSec && cut.plan.cutEndSec < cut.onset.voiceSec

  // ローカルwhisperで最初の発話を照合（外部Whisper APIは使わない。推測で字幕を作らない）
  let whisper = null
  if (args.whisper) {
    const model = process.env.WHISPER_MODEL_PATH || join(os.homedir(), 'Library/Caches/bemystyle-reel/whisper-models/ggml-large-v3-turbo-q8_0.bin')
    if (!existsSync(model)) throw new Error('whisperモデルが見つかりません（WHISPER_MODEL_PATH）')
    const { result } = await withTempDir('lcv-intro-whisper-', async (tmp) => {
      const wav = join(tmp, 'intro.wav')
      await execFileAsync(ff(), ['-v', 'error', '-y', '-i', sourceRealPath, '-vn', '-af', 'aresample=first_pts=0', '-ac', '1', '-ar', '16000', '-t', '10', '-c:a', 'pcm_s16le', wav])
      const runs = []
      for (const [name, opts] of [['dtw', { useDtw: true }], ['plain', { useDtw: false }]]) {
        const of = join(tmp, name)
        await runWhisperCli(buildWhisperArgs({ modelPath: model, audioPath: wav, outputBase: of, ...opts }))
        runs.push({ name, segments: parseWhisperJson(readWhisperJsonFile(`${of}.json`)).segments.filter((s) => s.startSec < 8) })
      }
      return runs
    })
    whisper = result
  }

  const digest = buildShortDigest(base.captions, base.norm, SHORT_DIGEST_PICKS)
  if (!digest.ok) throw new Error(`ダイジェストの検証に失敗: ${digest.problems.join(' / ')}`)
  const D = digest.totalSec
  const { items, trimmedTailSec } = introCutItems(job.durationSec, cut.plan.cutEndSec, FPS)
  const recovered = loadRecovered(job)
  const recoveredOk = recovered.captions.length ? validateRecoveredCaptions(recovered.captions, base.captions) : { ok: true, problems: [] }
  const inv = verifyInvariants({ base, items, digestSec: D, recovered: recoveredOk.ok ? recovered.captions.filter((c) => c.confirmed) : [] })
  const tm = inv.mapped.tm
  const cfg = resolveCompositionConfig({ digest: { durationSec: 10, minSec: SHORT_DIGEST_DEFAULTS.minSec, maxSec: SHORT_DIGEST_DEFAULTS.maxSec, clipCount: SHORT_DIGEST_DEFAULTS.clipCount, clipSec: SHORT_DIGEST_DEFAULTS.clipSec } })
  const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: tm.totalSec, digestClips: digest.clips })
  const anchors = mainAnchors(timeline)

  const doc = {
    createdAt: new Date().toISOString(), version: 6, jobId: job.id, baseKey: BASE_KEY,
    measure: { onsetSec: cut.onset.onsetSec, voiceSec: cut.onset.voiceSec, noiseFloorDb: cut.onset.noiseFloorDb, onsetDb: cut.onset.onsetDb, frameSec: cut.frameSec },
    cut: { cutStartSec: 0, cutEndSec: cut.plan.cutEndSec, cutSec: cut.plan.cutSec, keepBeforeSpeechSec: cut.plan.keepBeforeSpeechSec, cutEndSample: Math.round(cut.plan.cutEndSec * SR), frameIndex: cut.plan.cutEndFrame, cutEndSecRounded: round(cut.plan.cutEndSec, 4) },
    silentInCut: cut.silent,
    whisper: whisper ? whisper.map((r) => ({ run: r.name, segments: r.segments })) : null,
    recovery: { status: recovered.file ? (recoveredOk.ok ? 'loaded' : 'invalid') : 'none', confirmed: recovered.captions.filter((c) => c.confirmed).length, problems: recoveredOk.problems },
    timemap: { items: tm.items, totalSec: tm.totalSec, trimmedTailSec, mainOffsetSec: D, anchors },
    invariants: { captions: inv.captions, emphasis: inv.emphasis, midWordSilences: inv.midWordSilences, themes: inv.themes },
  }
  writeJsonAtomic(pathFor('intro-cut'), doc)
  writeJsonAtomic(pathFor('timemap'), { createdAt: doc.createdAt, version: 6, jobId: job.id, items: tm.items, totalSec: tm.totalSec, mainOffsetSec: D, ...anchors, trimmedTailSec })

  console.log(JSON.stringify({
    stage: 'intro-analyze', ok: true,
    measure: doc.measure,
    cut: { ...doc.cut, cutEndSec: round(doc.cut.cutEndSec, 4), cutSec: round(doc.cut.cutSec, 4), sampleAligned, frameAligned: Math.abs(doc.cut.cutEndSec * FPS - Math.round(doc.cut.cutEndSec * FPS)) < 1e-6, removedSec: round(doc.cut.cutSec, 4), speechProtected: speechKept && cut.silent.ok, silentInCut: cut.silent },
    whisper: whisper ? whisper.map((r) => ({ run: r.name, segments: r.segments.length })) : 'not-run',
    recovery: doc.recovery,
    timemap: { totalSec: tm.totalSec, trimmedTailSec, mainOffsetSec: D, overlay: [anchors.overlayStartSec, anchors.overlayEndSec], outroStartSec: anchors.outroStartSec, bgm: [anchors.bgmStartSec, anchors.bgmEndSec], totalFinalSec: timeline.totalSec },
    invariants: { captionCount: inv.captions.count, captionsSameOrderAndText: inv.captions.sameOrderAndText, captionVerification: inv.captions.verified.ok, uniformShiftSec: inv.captions.uniformShiftSec, maxShiftDeviationSec: inv.captions.maxShiftDeviationSec, emphasis: inv.emphasis, midWordSilences: inv.midWordSilences, themes: { count: inv.themes.count, coverage: inv.themes.coverage, gapSec: inv.themes.gapSec, overlapSec: inv.themes.overlapSec, firstStartsAtMainZero: inv.themes.firstStartsAtMainZero, lastEndsAtMainEnd: inv.themes.lastEndsAtMainEnd } },
    safety: { jobFileByteIdentical: bytes.equals(readFileSync(file)), canonUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))), sourceUnchanged: fileSig(sourceRealPath) === `${srcBefore.size}:${srcBefore.mtimeMs}`, externalAiApiCalled: false },
  }, null, 2))
}

// ────────────────────────────────────────────────────────────────
// 確認動画の計画（preview / preview-verify / machinery で共通）
// ────────────────────────────────────────────────────────────────
export const PREVIEW_MAIN_SEC = 58 // 本編の長さ（ダイジェスト約10秒 + 本編58秒 + 末尾12秒 = 約80秒）

export function buildMainBgmPreviewPlan(job, base, { paths, cutEndSec, mainBgm, mainSec = PREVIEW_MAIN_SEC, recovered = [] }) {
  const dig = buildShortDigest(base.captions, base.norm, SHORT_DIGEST_PICKS)
  if (!dig.ok) throw new Error(`ダイジェストの検証に失敗: ${dig.problems.join(' / ')}`)
  const frames = Math.round(mainSec * FPS)
  const items = [{ kind: 'seg', srcStartSec: round(cutEndSec), srcEndSec: round(cutEndSec + frames / FPS) }]
  const cfg = resolveCompositionConfig({
    digest: { durationSec: 10, minSec: SHORT_DIGEST_DEFAULTS.minSec, maxSec: SHORT_DIGEST_DEFAULTS.maxSec, clipCount: SHORT_DIGEST_DEFAULTS.clipCount, clipSec: SHORT_DIGEST_DEFAULTS.clipSec, bgm: { path: paths.bgm } },
    line: { qrPath: paths.qr },
    mainBgm: { enabled: Boolean(mainBgm), sourcePath: mainBgm?.sourcePath ?? null, ...(mainBgm?.overrides ?? {}) },
  })
  const digestSec = dig.totalSec
  const mapped = mapMainToFinal({ items, captions: base.captions, recovered, themes: base.norm, mainOffsetSec: digestSec, strict: false })
  const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: mapped.tm.totalSec, digestClips: dig.clips })
  const D = timeline.mainOffsetSec
  const digCaps = shortDigestCaptions(base.captions, dig.clips)
  const digBlocks = digestThemeBlocks(base.norm, dig.clips, base.captions).blocks
  return {
    cfg, dig, tm: mapped.tm, items, timeline, D, mainCaps: mapped.mainCaptions, digCaps, mainBlocks: mapped.themeBlocks, anchors: mainAnchors(timeline),
    buildAss: (qrSize) => buildFinalAss({ width: job.width, height: job.height, cfg, timeline, mainCaptions: mapped.mainCaptions, digestCaps: digCaps, themeBlocks: [...digBlocks, ...mapped.themeBlocks], qrSize, digestStyle: 'strong' }),
  }
}

const loadCut = () => {
  if (!existsSync(pathFor('intro-cut'))) throw new Error('先に intro-analyze を実行してください')
  return JSON.parse(readFileSync(pathFor('intro-cut'), 'utf-8'))
}

// ────────────────────────────────────────────────────────────────
// 音声の測定（最終動画から）
// ────────────────────────────────────────────────────────────────
const f32 = async (file, ss, dur, ar = SR) => {
  const r = await execFileAsync(ff(), ['-v', 'error', ...(ss !== null ? ['-ss', String(round(ss, 4)), '-t', String(round(dur, 4))] : []), '-i', file, '-vn', '-ac', '1', '-ar', String(ar), '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 29 })
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4))
}
const peakOf = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p }
const rmsDbOf = (x) => { let s = 0; for (const v of x) s += v * v; const r = Math.sqrt(s / Math.max(1, x.length)); return r > 0 ? 20 * Math.log10(r) : -120 }
const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -120)

/** 最終ミックスのピーク（サンプルピーク。AAC後）と、区間ごとのRMS。 */
async function stereoPeak(video) {
  const r = await execFileAsync(ff(), ['-v', 'error', '-i', video, '-vn', '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 29 })
  return peakOf(new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)))
}
async function mixReport(video, T) {
  const all = await f32(video, null, 0)
  const seg = (a, b) => all.subarray(Math.max(0, Math.floor(a * SR)), Math.min(all.length, Math.floor(b * SR)))
  const main = T.sections.find((s) => s.kind === 'main')
  const outro = T.sections.find((s) => s.kind === 'lineOutro')
  const digest = T.sections.find((s) => s.kind === 'digest')
  return {
    samplePeakDb: round(toDb(await stereoPeak(video)), 2), // ステレオの各チャンネルの最大（AACデコード後）
    digestRmsDb: digest ? round(rmsDbOf(seg(digest.startSec, digest.endSec)), 1) : null,
    mainRmsDb: round(rmsDbOf(seg(main.startSec, main.endSec)), 1),
    outroPeakDb: outro ? round(toDb(peakOf(seg(outro.startSec + 0.05, outro.endSec))), 1) : null, // 末尾LINE案内は無音（BGMが漏れない）
    outroRmsDb: outro ? round(rmsDbOf(seg(outro.startSec + 0.05, outro.endSec)), 1) : null,
    totalSamples: all.length,
  }
}

// ────────────────────────────────────────────────────────────────
// machinery: 合成MP3による本編BGM機構の技術試験（成果物ではない。一時フォルダのみ・終了後に全削除）
// ────────────────────────────────────────────────────────────────
async function stageMachinery(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const base = loadBase(job)
  const cutDoc = loadCut()
  const { sourceRealPath, outputRoot, inputRoots, srcBefore } = safetyContext(job)
  const outBefore = dirSnapshot(outputRoot)
  const report = { stage: 'machinery', note: '合成MP3による機構の技術試験。実際のMP3の値ではありません（成果物ではなく、終了後にすべて削除）' }
  const gate = -45
  // 許可ルート内（出力フォルダ直下の隠し一時フォルダ）に置く。inspectMainBgm は許可ルート内のファイルだけを受け付ける
  const tmpBase = mkdtempSync(join(outputRoot, '.machinery-main-bgm-'))
  let tempExists = true
  try {
    const t = (n) => join(tmpBase, n)
    const gen = (out, expr, secs = 24) => execFileAsync(ff(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=220:d=${secs}`, '-f', 'lavfi', '-i', `sine=f=277.18:d=${secs}`, '-f', 'lavfi', '-i', `sine=f=329.63:d=${secs}`, '-f', 'lavfi', '-i', `anoisesrc=d=${secs}:c=pink:a=0.05`, '-filter_complex', expr, '-c:a', 'libmp3lame', '-b:a', '192k', out])
    const musicExpr = '[0][1][2][3]amix=inputs=4:normalize=0,tremolo=f=1.5:d=0.4,aformat=channel_layouts=stereo,volume=0.6'
    await gen(t('synth.MP3'), musicExpr, 24) // 大文字の拡張子
    await gen(t('long.mp3'), musicExpr, 120)
    const synthSig = sha256(readFileSync(t('synth.MP3')))

    // 1) MP3の実データ検証（正常・大文字拡張子・不正各種）
    writeFileSync(t('text.mp3'), 'これはMP3ではありません')
    await execFileAsync(ff(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', t('videoonly.mp4')])
    writeFileSync(t('videoonly.mp3'), readFileSync(t('videoonly.mp4')))
    await execFileAsync(ff(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=1', t('wav.wav')])
    writeFileSync(t('wavrenamed.mp3'), readFileSync(t('wav.wav')))
    writeFileSync(t('truncated.mp3'), readFileSync(t('synth.MP3')).subarray(0, 300))
    writeFileSync(t('empty.mp3'), '')
    const insp = {}
    for (const n of ['synth.MP3', 'long.mp3', 'text.mp3', 'videoonly.mp3', 'wavrenamed.mp3', 'truncated.mp3', 'empty.mp3', 'missing.mp3']) {
      const r = await inspectMainBgm(t(n), inputRoots)
      insp[n] = r.ok ? { ok: true, durationSec: r.durationSec, sampleRate: r.sampleRate, channels: r.channels } : { ok: false, error: r.error }
    }
    report.mp3Validation = { valid: insp['synth.MP3'], long: insp['long.mp3'], rejected: Object.fromEntries(Object.entries(insp).filter(([, v]) => !v.ok).map(([k, v]) => [k, v.error])) }
    report.mp3Validation.allBadRejected = ['text.mp3', 'videoonly.mp3', 'wavrenamed.mp3', 'truncated.mp3', 'empty.mp3', 'missing.mp3'].every((n) => !insp[n].ok) && insp['synth.MP3'].ok

    // 2) ラウドネス・ゲイン・ループ（実際の本編の声で）
    const cutEnd = cutDoc.cut.cutEndSec
    const L = 60
    const items = [{ kind: 'seg', srcStartSec: round(cutEnd + 240), srcEndSec: round(cutEnd + 240 + L) }] // 本編の中ほど60秒（発話が続く区間）
    const levels = await measureMainBgmLevels({ sourcePath: sourceRealPath, mainItems: items, bgmPath: t('synth.MP3') })
    report.levels = levels
    const stems = {}
    const cfgOn = resolveMainBgmConfig({ enabled: true, sourcePath: t('synth.MP3') })
    for (const ducking of [true, false]) {
      const cfg = { ...cfgOn, ducking }
      const gain = planBgmGain({ voiceSpeechDb: levels.voiceSpeechDb, bgmDb: levels.bgmDb, volume: cfg.volume, autoGain: true, ducking })
      const plan = planBgmLoop({ bgmSec: insp['synth.MP3'].durationSec, mainSec: L, loop: true })
      await execFileAsync(ff(), buildLoopUnitArgs({ bgmPath: t('synth.MP3'), outPath: t('unit.wav'), bgmSec: insp['synth.MP3'].durationSec, crossfadeSec: plan.crossfadeSec, sampleRate: SR }).args.slice(0))
      await execFileAsync(ff(), ['-v', 'error', '-y', '-ss', String(items[0].srcStartSec), '-t', String(L), '-i', sourceRealPath, '-vn', '-af', 'aresample=first_pts=0,aformat=channel_layouts=stereo', '-ar', String(SR), '-c:a', 'pcm_f32le', t('voice.wav')])
      const { args: sa } = buildMainBgmStemArgs({ voicePath: t('voice.wav'), bgmPath: t('synth.MP3'), loopUnitPath: t('unit.wav'), mainSec: L, gainDb: gain.gainDb, plan, cfg, sampleRate: SR, outVoice: t(`v_${ducking}.wav`), outBgm: t(`b_${ducking}.wav`), outMix: t(`m_${ducking}.wav`) })
      await execFileAsync(ff(), ['-v', 'error', ...sa])
      const rd = (p) => readWavPcm16Mono(readFileSync(p))
      const vdb = computeFrameDb(rd(t(`v_${ducking}.wav`)).samples, 16000, 0.02).db
      const bdb = computeFrameDb(rd(t(`b_${ducking}.wav`)).samples, 16000, 0.02).db
      const gap = summarizeVoiceBgmGap(vdb, bdb, gate)
      const speechB = meanEnergyDb(bdb.filter((_, i) => vdb[i] > gate))
      const pauseB = meanEnergyDb(bdb.filter((_, i) => vdb[i] <= gate - 8))
      const mix = rd(t(`m_${ducking}.wav`)).samples
      // mixSamplePeakDb は16kHzモノでの値（ステレオ同相のとき +3dB 高く出る安全側の値）
      stems[ducking ? 'ducking' : 'noDucking'] = { gain, plan: { loops: plan.loops, unitSec: plan.unitSec, crossfadeSec: plan.crossfadeSec }, gap, bgmReturnInPausesDb: round(pauseB - speechB, 1), mixSamplePeakDb: round(toDb(peakOf(Float32Array.from(mix, (v) => v / 32768))), 2) }
    }
    report.mix = stems
    report.ducking = { filter: 'sidechaincompress', threshold: MAIN_BGM_DUCK.threshold, ratio: MAIN_BGM_DUCK.ratio, attackMs: MAIN_BGM_DUCK.attack, releaseMs: MAIN_BGM_DUCK.release, knee: MAIN_BGM_DUCK.knee, makeup: MAIN_BGM_DUCK.makeup, sidechain: `highpass ${MAIN_BGM_DUCK.sidechainHighpassHz}Hz + lowpass ${MAIN_BGM_DUCK.sidechainLowpassHz}Hz + acompressor(${JSON.stringify(MAIN_BGM_DUCK.sidechainNormalize)})`, targetPreDuckGapDb: MAIN_BGM_GAP_TARGET, limiter: MAIN_BGM_LIMITER }

    // 3) BGM単独（声を無音にして）: ループ境界・ループごとの音量・フェード・本編終了での切れ
    const mainSec = 58
    const plan58 = planBgmLoop({ bgmSec: insp['synth.MP3'].durationSec, mainSec, loop: true })
    const cfgBgmOnly = { ...cfgOn, ducking: false }
    const gain58 = planBgmGain({ voiceSpeechDb: levels.voiceSpeechDb, bgmDb: levels.bgmDb, volume: cfgOn.volume, autoGain: true, ducking: false })
    const bgmOnlyArgs = ['-y', '-hide_banner', '-nostats', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`, '-stream_loop', '-1', '-i', t('unit.wav'),
      '-filter_complex', ['[0:a]atrim=0:58,asetpts=PTS-STARTPTS[vin]', ...buildMainBgmFilters({ bgmInputIndex: 1, mainSec, gainDb: gain58.gainDb, plan: plan58, cfg: cfgBgmOnly, sampleRate: SR, voiceLabel: '[vin]', outLabel: '[o]' })].join(';'), '-map', '[o]', '-c:a', 'pcm_f32le', t('bgmonly.wav')]
    await execFileAsync(ff(), bgmOnlyArgs)
    const bo = await f32(t('bgmonly.wav'), null, 0)
    const win = (a, b) => bo.subarray(Math.floor(a * SR), Math.floor(b * SR))
    const unit = plan58.unitSec
    const loops = []
    for (let k = 1; k * unit < mainSec - 3; k++) {
      const at = Math.round(k * unit * SR)
      let maxStepAt = 0
      for (let i = at - 240; i < at + 240; i++) maxStepAt = Math.max(maxStepAt, Math.abs(bo[i] - bo[i - 1]))
      loops.push({ atSec: round(k * unit, 3), maxStepAtBoundary: round(maxStepAt, 5), rmsBeforeDb: round(rmsDbOf(bo.subarray(at - 4800, at)), 2), rmsAfterDb: round(rmsDbOf(bo.subarray(at, at + 4800)), 2) })
    }
    let maxStepElsewhere = 0
    for (let i = Math.floor(6 * SR); i < Math.floor(unit * SR) - 240; i++) maxStepElsewhere = Math.max(maxStepElsewhere, Math.abs(bo[i] - bo[i - 1]))
    const perLoopRms = []
    for (let k = 0; (k + 1) * unit <= mainSec - 3 + 1e-6 && k < 4; k++) perLoopRms.push(round(rmsDbOf(win(k * unit + 3, k * unit + 3 + 10)), 2))
    report.loop = { loops: plan58.loops, unitSec: unit, crossfadeSec: plan58.crossfadeSec, boundaries: loops, maxStepElsewhere: round(maxStepElsewhere, 5), boundaryClickFree: loops.every((b) => b.maxStepAtBoundary <= maxStepElsewhere * 1.5 + 1e-4 && Math.abs(b.rmsBeforeDb - b.rmsAfterDb) < 1.5), levelAcrossLoopsDb: perLoopRms, levelStable: Math.max(...perLoopRms) - Math.min(...perLoopRms) < 1.5 }
    const endAmp = peakOf(bo.subarray(bo.length - 480))
    report.fades = {
      fadeInSec: cfgOn.fadeInSec, fadeOutSec: cfgOn.fadeOutSec,
      firstSamplePeak: round(peakOf(bo.subarray(0, 48)), 6), rmsFirst100ms: round(rmsDbOf(win(0, 0.1)), 1), rmsAt1s: round(rmsDbOf(win(1.4, 1.6)), 1), rmsAt3s: round(rmsDbOf(win(3, 3.2)), 1),
      rmsBeforeFadeOutDb: round(rmsDbOf(win(mainSec - cfgOn.fadeOutSec - 0.4, mainSec - cfgOn.fadeOutSec - 0.2)), 1), rmsLast200ms: round(rmsDbOf(win(mainSec - 0.2, mainSec)), 1), lastSamplePeak: round(endAmp, 6),
      lengthSec: round(bo.length / SR, 4), lengthMatchesMain: Math.abs(bo.length / SR - mainSec) < 0.002,
    }
    const long = planBgmLoop({ bgmSec: insp['long.mp3'].durationSec, mainSec: 58, loop: true })
    report.longerThanMain = { needsLoop: long.needsLoop, playSec: long.playSec }

    // 4) 3区間の合成（ダイジェスト＋先頭カット済み本編＋末尾LINE案内）: BGMあり/なしの2本を一時フォルダへレンダー
    const qrPath = args.qr
    const bgmPath = args.bgm
    if (!qrPath || !bgmPath) throw new Error('--bgm（ダイジェストBGM）と --qr を指定してください')
    const mkPlan = (withBgm) => buildMainBgmPreviewPlan(job, base, { paths: { bgm: bgmPath, qr: qrPath }, cutEndSec: cutEnd, mainBgm: withBgm ? { sourcePath: t('synth.MP3') } : null, mainSec: 24 })
    const outs = {}
    for (const withBgm of [true, false]) {
      const plan = mkPlan(withBgm)
      const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
      if (!assets.ok) throw new Error('素材を確認できません')
      const finalPath = t(withBgm ? 'with.mp4' : 'without.mp4')
      const r = await renderCompositionToFile({
        cfg: plan.cfg, timeline: plan.timeline, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: plan.tm.totalSec, mainItems: plan.tm.items, digestClips: plan.dig.clips,
        bgmPath: assets.bgm.realPath, qrPath: assets.qr.realPath, qrSize: { width: assets.qr.width, height: assets.qr.height }, assText: plan.buildAss({ width: assets.qr.width, height: assets.qr.height }), tmpDir: tmpBase, finalPath,
        mainBgmRequest: { roots: inputRoots },
      })
      outs[withBgm ? 'with' : 'without'] = { plan, finalPath, mainBgm: r.mainBgm }
    }
    const P = outs.with.plan
    const T = P.timeline
    const digestSec = T.digestSec
    const mixWith = await mixReport(outs.with.finalPath, T)
    const wAll = await f32(outs.with.finalPath, null, 0)
    const woAll = await f32(outs.without.finalPath, null, 0)
    let digestDiff = 0
    let digestDiffAt = 0
    let digestDiffSq = 0
    for (let i = Math.floor(0.15 * SR); i < Math.floor((digestSec - 0.5) * SR); i++) { // 境界の手前0.5秒はAACの符号化フレームが本編側とまたがるため比べない
      const d = Math.abs(wAll[i] - woAll[i])
      digestDiffSq += d * d
      if (d > digestDiff) { digestDiff = d; digestDiffAt = i / SR }
    }
    const outro = T.sections.find((s) => s.kind === 'lineOutro')
    let outroDiff = 0
    for (let i = Math.floor((outro.startSec + 0.05) * SR); i < Math.min(wAll.length, woAll.length); i++) outroDiff = Math.max(outroDiff, Math.abs(wAll[i] - woAll[i]))
    let mainDiff = 0
    for (let i = Math.floor((digestSec + 3) * SR); i < Math.floor((outro.startSec - 3) * SR); i++) mainDiff += Math.abs(wAll[i] - woAll[i])
    const pts = await ptsReport(outs.with.finalPath, T.totalSec)
    const avRows = []
    for (const s of [cutEnd + 6, cutEnd + 14]) avRows.push({ srcSec: s, ...(await measurePoint({ video: outs.with.finalPath, source: sourceRealPath, srcSec: s, outSec: digestSec + (s - cutEnd) })) })
    let decodeOk = true
    try { await execFileAsync(ff(), ['-v', 'error', '-i', outs.with.finalPath, '-f', 'null', '-'], { maxBuffer: 1 << 26 }) } catch { decodeOk = false }
    const graph = buildCompositionArgs({ cfg: P.cfg, timeline: T, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: P.tm.totalSec, mainItems: P.items, digestClips: P.dig.clips, bgmPath, qrPath, qrSize: { width: 554, height: 518 }, assPath: '/x.ass', outputPath: '/x.mp4', mainBgm: { inputPath: t('unit.wav'), plan: plan58, gainDb: gain58.gainDb } }).filterComplex
    const chains = graph.split(';')
    const mainBgmChains = chains.filter((c) => /\[mbgm|\[mainaudio\]|\[mainvoice\]|\[mixraw\]|\[mmix\]/.test(c) && !c.includes('concat=n=3'))
    report.composition = {
      totalSec: T.totalSec, digestSec, mainSec: round(T.sections.find((s) => s.kind === 'main').endSec - digestSec, 3), outroStartSec: outro.startSec, bgmRange: [P.anchors.bgmStartSec, P.anchors.bgmEndSec],
      mix: mixWith, digestIdenticalWithoutMainBgm: digestDiff < 2e-3, digestMaxDiff: round(digestDiff, 6), digestMaxDiffAtSec: round(digestDiffAt, 3), digestDiffRmsDb: round(toDb(Math.sqrt(digestDiffSq / ((digestSec - 0.65) * SR))), 1), outroIdenticalWithoutMainBgm: outroDiff < 1e-4, mainDiffersWithBgm: mainDiff > 1,
      mainBgmOnlyInMainChain: mainBgmChains.every((c) => !c.includes('[dvid]') && !c.includes('[dvoice]') && !c.includes('[dA]') && !c.includes('[lov]') && !c.includes('[lo')) && graph.includes('[dvid][dA][mainvid][mainaudio][lov][loa]concat=n=3'),
      pts: { videoStart: pts.video.startSec, audioStart: pts.audio.startSec, endDiffSec: pts.endDiffSec, videoDur: pts.video.durationSec, audioDur: pts.audio.durationSec },
      avOffsetMs: avRows.map((r) => r.avOffsetMs), avWithinOneFrame: avRows.every((r) => r.avOffsetMs !== null && Math.abs(r.avOffsetMs) < 1000 / FPS), decodeOk,
      mainBgm: outs.with.mainBgm ? { gainDb: outs.with.mainBgm.gain.gainDb, preDuckGapDb: outs.with.mainBgm.gain.preDuckGapDb, loops: outs.with.mainBgm.plan.loops } : null,
    }
    report.mp3Unchanged = sha256(readFileSync(t('synth.MP3'))) === synthSig
    report.leftoverInsideTmp = readdirSync(tmpBase).filter((n) => n.startsWith('main-bgm-')).length
  } finally {
    rmSync(tmpBase, { recursive: true, force: true })
    tempExists = existsSync(tmpBase)
  }
  const outAfter = dirSnapshot(outputRoot)
  report.cleanup = { tempDirRemoved: !tempExists, outputRootUnchanged: JSON.stringify(outBefore) === JSON.stringify(outAfter), outputRootLeftover: readdirSync(outputRoot).filter((n) => n.startsWith('.rendering-') || n.startsWith('.machinery-')).length }
  report.safety = { jobFileByteIdentical: bytes.equals(readFileSync(file)), canonUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))), sourceUnchanged: fileSig(sourceRealPath) === `${srcBefore.size}:${srcBefore.mtimeMs}`, externalAiApiCalled: false }
  console.log(JSON.stringify(report, null, 2))
}

// ────────────────────────────────────────────────────────────────
// preview: 実際のMP3での確認動画（1本だけ）
// ────────────────────────────────────────────────────────────────
const STATE = () => pathFor('preview-state')

async function stagePreview(args) {
  if (!args.mainBgm) {
    console.log(JSON.stringify({ stage: 'preview', status: 'waiting-for-mp3', message: '本編BGMのMP3が指定されていません（--main-bgm）。素材待ちのため確認動画は作りません。' }, null, 2))
    return
  }
  const { job } = loadJob(args.job)
  if (!args.bgm || !args.qr) throw new Error('--bgm（ダイジェストBGM）と --qr を指定してください')
  if (existsSync(STATE())) throw new Error('確認動画は既に生成済みです（1本だけ。上書きしません）')
  const base = loadBase(job)
  const cutDoc = loadCut()
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  const info = await inspectMainBgm(args.mainBgm, inputRoots)
  if (!info.ok) throw new Error(info.error)
  const free = await checkFreeSpace(outputRoot, FULL_RENDER_MIN_FREE_BYTES)
  if (!free.ok) throw new Error('空き容量が15GB未満のため開始しません')
  const recovered = loadRecovered(job)
  const rv = recovered.captions.length ? validateRecoveredCaptions(recovered.captions, base.captions) : { ok: true }
  if (!rv.ok) throw new Error(`手動補完captionが不正です: ${rv.problems.join(' / ')}`)
  const confirmed = recovered.captions.filter((c) => c.confirmed)
  const plan = buildMainBgmPreviewPlan(job, base, { paths: { bgm: args.bgm, qr: args.qr }, cutEndSec: cutDoc.cut.cutEndSec, mainBgm: { sourcePath: info.realPath }, mainSec: args.length || PREVIEW_MAIN_SEC, recovered: confirmed })
  const v = validateCompositionConfig(plan.cfg)
  if (!v.ok) throw new Error(`構成設定が不正です: ${v.errors.join(' / ')}`)
  const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
  if (!assets.ok) throw new Error('素材を確認できません')
  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const outName = `comparison_main_bgm_intro_cut_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.mp4`
  const finalPath = join(outputRoot, outName)
  if (existsSync(finalPath)) throw new Error('出力ファイルが既にあります（上書きしません）')
  const before = dirSnapshot(outputRoot)
  const srcSig = fileSig(sourceRealPath)
  const mp3Sig = sha256(readFileSync(info.realPath))
  const t0 = Date.now()
  const { result } = await withTempDir('lcv-main-bgm-preview-', (tmpDir) => renderCompositionToFile({
    cfg: plan.cfg, timeline: plan.timeline, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: plan.tm.totalSec, mainItems: plan.tm.items, digestClips: plan.dig.clips,
    bgmPath: assets.bgm.realPath, qrPath: assets.qr.realPath, qrSize: { width: assets.qr.width, height: assets.qr.height }, assText: plan.buildAss({ width: assets.qr.width, height: assets.qr.height }), tmpDir, finalPath,
    mainBgmRequest: { roots: inputRoots },
  }))
  const after = dirSnapshot(outputRoot)
  writeJsonAtomic(STATE(), { createdAt: new Date().toISOString(), outputName: outName, before, mainBgmFile: info.fileName, mainBgm: { gain: result.mainBgm.gain, levels: result.mainBgm.levels, plan: result.mainBgm.plan } })
  console.log(JSON.stringify({
    stage: 'preview', outputName: outName, sizeBytes: statSync(finalPath).size, renderMs: Date.now() - t0, totalSecPlanned: plan.timeline.totalSec, digestSec: plan.timeline.digestSec, mainOffsetSec: plan.D,
    mainBgm: { fileName: info.fileName, durationSec: info.durationSec, sampleRate: info.sampleRate, channels: info.channels, ...result.mainBgm.gain, loops: result.mainBgm.plan.loops, crossfadeSec: result.mainBgm.plan.crossfadeSec, levels: result.mainBgm.levels },
    existingOutputsChanged: Object.entries(before).filter(([n, x]) => after[n] !== x).length, tempOutputLeftover: readdirSync(outputRoot).filter((n) => n.startsWith('.rendering-composition-')).length,
    safety: { sourceUnchanged: fileSig(sourceRealPath) === srcSig, mp3Unchanged: sha256(readFileSync(info.realPath)) === mp3Sig, externalAiApiCalled: false },
  }, null, 2))
}

async function stagePreviewVerify(args) {
  if (!existsSync(STATE())) throw new Error('確認動画がまだ生成されていません')
  const { job } = loadJob(args.job)
  const base = loadBase(job)
  const cutDoc = loadCut()
  const state = JSON.parse(readFileSync(STATE(), 'utf-8'))
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  const video = join(outputRoot, state.outputName)
  if (!existsSync(video)) throw new Error('確認動画が見つかりません')
  const info = await inspectMainBgm(args.mainBgm, inputRoots)
  if (!info.ok) throw new Error(info.error)
  const recovered = loadRecovered(job).captions.filter((c) => c.confirmed)
  const plan = buildMainBgmPreviewPlan(job, base, { paths: { bgm: args.bgm, qr: args.qr }, cutEndSec: cutDoc.cut.cutEndSec, mainBgm: { sourcePath: info.realPath }, recovered })
  const T = plan.timeline
  const D = plan.D
  const out = { stage: 'preview-verify', outputName: state.outputName }
  out.pts = await ptsReport(video, T.totalSec)
  out.mix = await mixReport(video, T)
  const avRows = []
  for (const s of [cutDoc.cut.cutEndSec + 4, cutDoc.cut.cutEndSec + 20, cutDoc.cut.cutEndSec + 40]) avRows.push({ srcSec: round(s, 2), ...(await measurePoint({ video, source: sourceRealPath, srcSec: s, outSec: D + (s - cutDoc.cut.cutEndSec) })) })
  out.avOffset = { rows: avRows, allWithinOneFrame: avRows.every((r) => r.avOffsetMs !== null && Math.abs(r.avOffsetMs) < 1000 / FPS) }
  // 最初の声の開始（ダイジェスト直後、声が出るまでの時間）
  const first = await f32(video, D, 1.5, 16000)
  const { db, frameSec } = computeFrameDb(Int16Array.from(first, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))), 16000, 0.01)
  const onset = findFirstSpeechOnset(db, frameSec, { ...INTRO_CUT_DEFAULTS, scanLimitSec: 1.4 })
  out.firstVoice = onset.ok ? { onsetAfterDigestSec: onset.onsetSec, voiceAfterDigestSec: onset.voiceSec } : { error: onset.reason }
  out.ranges = { digest: [0, T.digestSec], main: [D, plan.anchors.mainEndSec], overlay: [plan.anchors.overlayStartSec, plan.anchors.overlayEndSec], outro: [plan.anchors.outroStartSec, T.totalSec], mainBgm: [plan.anchors.bgmStartSec, plan.anchors.bgmEndSec] }
  console.log(JSON.stringify(out, null, 2))
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (args.stage === 'intro-analyze') return stageIntroAnalyze(args)
  if (args.stage === 'machinery') return stageMachinery(args)
  if (args.stage === 'preview') return stagePreview(args)
  if (args.stage === 'preview-verify') return stagePreviewVerify(args)
  throw new Error('ステージは intro-analyze / machinery / preview / preview-verify のいずれかです')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[localCaptionMainBgm] ${err.message}`)
    process.exit(1)
  })
}
