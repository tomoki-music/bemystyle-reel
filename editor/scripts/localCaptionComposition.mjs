// ローカルAIテロップ動画: 構成確認動画（ダイジェスト → LINE案内 → 本編（約30秒）→ 末尾LINE案内）の生成と検証。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用。外部AI APIは呼ばない）:
//   node scripts/localCaptionComposition.mjs render --job <jobId> --bgm <BGMファイル> --qr <QR画像> [--main-offset 108 --main-sec 30]
//
// 安全方針: 元動画・ジョブJSON・5分比較データ・既存の完成動画は読み取り専用。素材のパスは標準出力・保存データへ出さない。
// 出力は VIDEO_OUTPUT_ROOT 配下へ一時ファイル→rename。字幕本文・テーマ名は標準出力へ出さない。

import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import dotenv from 'dotenv'

import { validateSourcePath, validateOutputRoot } from '../server/lib/pathValidator.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { buildComparisonOutputPath } from '../server/lib/outputNaming.mjs'
import { materializeAnalysis, loadAnalysis } from '../server/lib/topicAnalysis.mjs'
import { normalizeTopicSectionsContinuous } from '../server/lib/topicSections.mjs'
import { buildDigestStemArgs, resolveCompositionConfig, validateCompositionConfig, selectDigestClips, planTimeline, shiftMainCaptions, digestCaptions, mainThemeBlock, digestThemeBlocks, buildFinalAss } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, renderCompositionToFile, checkFreeSpace } from '../server/lib/compositionRender.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const EDITOR_ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/five_minute')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d
const snapshotDir = (dir) => new Map(readdirSync(dir).map((n) => [n, `${statSync(join(dir, n)).size}:${statSync(join(dir, n)).mtimeMs}`]))

function parseArgs(argv) {
  const o = { stage: argv[0], mainOffset: 108, mainSec: 30 }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') o.job = argv[++i]
    else if (a === '--bgm') o.bgm = argv[++i]
    else if (a === '--qr') o.qr = argv[++i]
    else if (a === '--main-offset') o.mainOffset = Number(argv[++i])
    else if (a === '--main-sec') o.mainSec = Number(argv[++i])
    else if (a === '--intro-sec') o.introSec = Number(argv[++i])
    else if (a === '--outro-sec') o.outroSec = Number(argv[++i])
    else if (a === '--render-json') o.renderJson = argv[++i]
    else if (a === '--frames-dir') o.framesDir = argv[++i]
  }
  return o
}

async function stageRender(args) {
  const jobFile = resolve(EDITOR_ROOT, 'data/local_caption_videos', `${String(args.job).replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  const jobBytes = readFileSync(jobFile)
  const job = JSON.parse(jobBytes.toString('utf-8'))
  const roots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sourceRealPath = validateSourcePath(job.sourcePath, roots).realPath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  const srcBefore = statSync(sourceRealPath)
  const outBefore = snapshotDir(outputRoot)

  const key = 'five_minute_613'
  const pagesFile = resolve(DATA_DIR, `${key}.pages.v2.json`)
  const pagesBytes = readFileSync(pagesFile)
  const pages = JSON.parse(pagesBytes.toString('utf-8'))
  const analysisBytes = readFileSync(resolve(DATA_DIR, `${key}.analysis.json`))
  const analysis = loadAnalysis(DATA_DIR, key)
  const winStart = pages.window.startSec
  const W = job.width
  const H = job.height

  // 設定（完成動画レンダー時の既定=すべてON）。素材パスだけ引数で指定する。
  const cfg = resolveCompositionConfig({
    digest: { bgm: { path: args.bgm } },
    lineIntro: Number.isFinite(args.introSec) ? { durationSec: args.introSec } : {},
    lineOutro: Number.isFinite(args.outroSec) ? { durationSec: args.outroSec } : {},
    line: { qrPath: args.qr },
  })
  const v = validateCompositionConfig(cfg)
  if (!v.ok) throw new Error(`構成設定が不正です: ${v.errors.join(' / ')}`)
  const assets = await resolveCompositionAssets(cfg, roots)
  if (!assets.ok) throw new Error(`素材を確認できません: ${assets.errors.join(' / ')}`)

  // 保存済みの caption・テーマ・強調を再利用（元動画の秒へ変換）
  const mat = materializeAnalysis(analysis, pages.captions)
  const captions = mat.captions.map((c) => ({ ...c, startSec: c.startSec + winStart, endSec: c.endSec + winStart }))
  const cont = normalizeTopicSectionsContinuous(mat.topicSections, { startSec: 0, endSec: pages.window.durationSec })
  const themes = cont.sections.map((t) => ({ id: t.id, title: t.title, startSec: t.startSec + winStart, endSec: t.endSec + winStart }))

  // 本編（構成確認用の約30秒。caption境界へ合わせる）
  const wantStart = winStart + args.mainOffset
  const inMain = captions.filter((c) => c.startSec >= wantStart && c.endSec <= wantStart + args.mainSec)
  const mainStartSec = inMain[0].startSec
  const mainEndSec = inMain[inMain.length - 1].endSec

  const sel = selectDigestClips({ captions, themes, config: cfg.digest })
  if (sel.reasons.length) throw new Error(`ダイジェストを作れません: ${sel.reasons.join(' / ')}`)
  const timeline = planTimeline(cfg, { mainStartSec, mainEndSec, digestClips: sel.clips })
  const mainCaps = shiftMainCaptions(captions, mainStartSec, mainEndSec, timeline.mainOffsetSec)
  const digCaps = digestCaptions(captions, sel.clips)
  const dTheme = digestThemeBlocks(themes, sel.clips, captions)
  const mTheme = mainThemeBlock(themes, mainStartSec, mainEndSec, timeline.mainOffsetSec)
  const assText = buildFinalAss({ width: W, height: H, cfg, timeline, mainCaptions: mainCaps, digestCaps: digCaps, themeBlocks: [...dTheme.blocks, mTheme] })

  const free = await checkFreeSpace(outputRoot, 2 * 1024 ** 3) // 構成確認動画（約100秒）。完成動画(フル)は15GB
  if (!free.ok) throw new Error('出力先の空き容量が不足しています')

  const t0 = Date.now()
  let finalName = null
  const { removed: tempDirRemoved } = await withTempDir('lcv-composition-', async (tmpDir) => {
    const finalPath = buildComparisonOutputPath('composition_check', outputRoot, sourceRealPath)
    await renderCompositionToFile({
      cfg, timeline, width: W, height: H, sourcePath: sourceRealPath, mainStartSec, mainEndSec,
      digestClips: sel.clips, bgmPath: assets.bgm?.realPath, qrPath: assets.qr?.realPath, qrSize: assets.qr ? { width: assets.qr.width, height: assets.qr.height } : undefined, assText, tmpDir, finalPath,
    })
    finalName = finalPath.split('/').pop()
  })

  const outAfter = snapshotDir(outputRoot)
  const modified = [...outBefore].filter(([n, x]) => outAfter.get(n) !== x).map(([n]) => n)
  const srcAfter = statSync(sourceRealPath)
  console.log(JSON.stringify({
    stage: 'render',
    output: { filename: finalName, sizeBytes: statSync(resolve(outputRoot, finalName)).size },
    width: W,
    height: H,
    timeline: timeline.sections,
    mainOffsetSec: timeline.mainOffsetSec,
    totalSec: timeline.totalSec,
    digest: { clips: sel.clips.map((c) => ({ index: [c.firstIndex, c.lastIndex], srcStartSec: round(c.srcStartSec), durationSec: round(c.durationSec), themeId: c.themeId, score: c.score })), totalSec: round(sel.totalSec), themeBlocks: dTheme.blocks.map((b) => ({ startSec: b.startSec, endSec: b.endSec, sections: b.sections.map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec })) })), clipsWithoutTheme: dTheme.clipsWithoutTheme },
    main: { srcStartSec: round(mainStartSec), srcEndSec: round(mainEndSec), captionCount: mainCaps.length, emphasisCount: mainCaps.filter((c) => c.emphasisText).length, themeSections: mTheme.sections.map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec })) },
    assets: { bgmDurationSec: assets.bgm && round(assets.bgm.durationSec, 2), qrWidth: assets.qr?.width, qrHeight: assets.qr?.height },
    config: { digest: { enabled: cfg.digest.enabled, grayscale: cfg.digest.grayscale, bgmVolume: cfg.digest.bgm.volume, duck: cfg.digest.bgm.duck, fadeInSec: cfg.digest.bgm.fadeInSec, fadeOutSec: cfg.digest.bgm.fadeOutSec, credit: cfg.digest.bgm.credit }, lineIntroSec: cfg.lineIntro.durationSec, lineOutroSec: cfg.lineOutro.durationSec },
    performance: { totalMs: Date.now() - t0 },
    safety: {
      sourceUnchanged: srcAfter.size === srcBefore.size && srcAfter.mtimeMs === srcBefore.mtimeMs,
      jobFileByteIdentical: sha256(jobBytes) === sha256(readFileSync(jobFile)),
      pagesByteIdentical: sha256(pagesBytes) === sha256(readFileSync(pagesFile)),
      analysisByteIdentical: sha256(analysisBytes) === sha256(readFileSync(resolve(DATA_DIR, `${key}.analysis.json`))),
      existingOutputsModified: modified.length,
      newOutputFiles: [...outAfter.keys()].filter((n) => !outBefore.has(n)),
      tempDirRemoved,
      externalAiApiCalled: false,
    },
  }, null, 2))
}


// ────────────────────────────────────────────────────────────────
// verify: 完成した構成確認動画を読み取り検証する（映像・音声・QR・テーマ・白黒の範囲）。字幕本文・素材パスは出力しない。
// ────────────────────────────────────────────────────────────────
const ffmpeg = () => process.env.FFMPEG_BIN
const rawOut = async (args) => (await execFileAsync(ffmpeg(), ['-v', 'error', ...args], { encoding: 'buffer', maxBuffer: 1 << 29 })).stdout

/** 指定時刻の小さなRGBフレーム（領域は比率で指定）。 */
async function regionRgb(video, t, region, w, h) {
  const buf = await rawOut(['-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `crop=iw*${region.w}:ih*${region.h}:iw*${region.x}:ih*${region.y},scale=${w}:${h}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
  return buf
}
const meanSat = (buf) => {
  let s = 0
  const n = buf.length / 3
  for (let i = 0; i < n; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2]
    s += (Math.max(r, g, b) - Math.min(r, g, b)) / 255
  }
  return s / n
}
const isAmber = (buf) => {
  const n = buf.length / 3
  let r = 0, g = 0, b = 0
  for (let i = 0; i < n; i++) { r += buf[i * 3]; g += buf[i * 3 + 1]; b += buf[i * 3 + 2] }
  r /= n; g /= n; b /= n
  return Math.abs(r - 240) < 30 && Math.abs(g - 179) < 30 && Math.abs(b - 74) < 40
}
async function pcm(video, start, dur) {
  const buf = await rawOut(['-ss', String(start), '-t', String(dur), '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'])
  const a = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
  return Float64Array.from(a, (v) => v / 32768)
}
const rmsDb = (a) => { let s = 0; for (const v of a) s += v * v; const r = Math.sqrt(s / Math.max(1, a.length)); return r > 0 ? 20 * Math.log10(r) : -120 }

async function stageVerify(args) {
  const plan = JSON.parse(readFileSync(args.renderJson, 'utf-8'))
  args.source = JSON.parse(readFileSync(resolve(EDITOR_ROOT, 'data/local_caption_videos', `${String(args.job).replace(/[^a-zA-Z0-9-]/g, '')}.json`), 'utf-8')).sourcePath
  const outputRoot = validateOutputRoot(process.env.VIDEO_OUTPUT_ROOT || '')
  const video = resolve(outputRoot, plan.output.filename)
  const roots = String(process.env.VIDEO_INPUT_ROOTS || '').split(',').map((x) => x.trim()).filter(Boolean)
  const framesDir = args.framesDir
  if (framesDir) mkdirSync(framesDir, { recursive: true })
  const sec = Object.fromEntries(plan.timeline.map((x) => [x.kind, x]))
  const total = plan.totalSec

  // ── ストリーム・duration ──
  const { stdout: pj } = await execFileAsync(process.env.FFPROBE_BIN, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', video])
  const pr = JSON.parse(pj)
  const vs = pr.streams.find((x) => x.codec_type === 'video')
  const as = pr.streams.find((x) => x.codec_type === 'audio')
  const streams = { formatDurationSec: round(Number(pr.format.duration)), videoDurationSec: round(Number(vs.duration)), audioDurationSec: round(Number(as.duration)), width: vs.width, height: vs.height, videoCodec: vs.codec_name, audioCodec: as.codec_name, audioSampleRate: Number(as.sample_rate), avDiffSec: round(Math.abs(Number(vs.duration) - Number(as.duration))) }

  // ── 白黒の範囲（背景の壁・ギター領域の彩度）と、テーマ縦ラインの有無（1秒ごと） ──
  const wall = { x: 0.62, y: 0.18, w: 0.3, h: 0.5 }
  const satAt = async (t) => meanSat(await regionRgb(video, t, wall, 48, 27))
  const bar = { x: 96 / plan.width, y: 80 / plan.height, w: 12 / plan.width, h: 120 / plan.height }
  const themeAt = async (t) => isAmber(await regionRgb(video, t, bar, 1, 1))
  const kinds = ['digest', 'lineIntro', 'main', 'lineOutro'].filter((k) => sec[k])
  const perSection = {}
  for (const k of kinds) {
    const a = sec[k].startSec, b = sec[k].endSec
    const ts = []
    for (let t = a + 0.3; t < b - 0.2; t += 1) ts.push(round(t, 2))
    const sats = []
    const themes = []
    for (const t of ts) { sats.push(await satAt(t)); themes.push(await themeAt(t)) }
    perSection[k] = { samples: ts.length, wallSatMax: round(Math.max(...sats), 4), wallSatMean: round(sats.reduce((x, y) => x + y, 0) / sats.length, 4), themeBarPresentRatio: round(themes.filter(Boolean).length / themes.length, 3) }
  }
  // 区間境界の前後フレーム（0.1秒前後）でも白黒・テーマの状態を確認
  const boundaries = []
  for (const k of kinds.slice(1)) {
    const t = sec[k].startSec
    boundaries.push({ at: k, beforeWallSat: round(await satAt(t - 0.12), 4), afterWallSat: round(await satAt(t + 0.12), 4), beforeTheme: await themeAt(t - 0.12), afterTheme: await themeAt(t + 0.12) })
  }

  // ── 代表フレーム（目視用。git管理外へ保存） ──
  const shots = []
  const shot = async (name, t, width) => {
    if (!framesDir) return
    const f = join(framesDir, `${name}.png`)
    await execFileAsync(ffmpeg(), ['-y', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', ...(width ? ['-vf', `scale=${width}:-2:flags=lanczos`] : []), f])
    shots.push(f)
    return f
  }
  const pts = { digest_a: sec.digest.startSec + 3, digest_b: sec.digest.endSec - 3, digest_end: sec.digest.endSec - 0.15, intro_a: sec.lineIntro.startSec + 1.0, intro_b: sec.lineIntro.startSec + 0.5 * (sec.lineIntro.endSec - sec.lineIntro.startSec), intro_c: sec.lineIntro.endSec - 3, main_a: sec.main.startSec + 0.4, main_theme_change: plan.main.themeSections[1] ? plan.main.themeSections[1].startSec + 0.2 : sec.main.startSec + 10, main_end: sec.main.endSec - 0.4, outro_a: sec.lineOutro.startSec + 0.3, outro_b: sec.lineOutro.startSec + 5, outro_end: sec.lineOutro.endSec - 0.4 }
  for (const [n, t] of Object.entries(pts)) await shot(n, round(t, 2))
  for (const w of [390, 430]) for (const n of ['digest_a', 'intro_c', 'main_a', 'outro_b']) await shot(`${n}_w${w}`, round(pts[n], 2), w)

  // ── QR読み取り（元画像・レンダー後フレーム・スマホ相当幅） ──
  const qrResult = { tool: 'unavailable' }
  if (framesDir) {
    const qrSrc = validateSourcePath(args.qr, roots).realPath
    await withTempDir('lcv-qr-', async (tmp) => {
      const swiftSrc = resolve(__dirname, 'tools/qrDecode.swift')
      const bin = join(tmp, 'qrDecode')
      try {
        await execFileAsync('swiftc', ['-O', swiftSrc, '-o', bin], { timeout: 240000 })
        qrResult.tool = 'macOS Vision (VNDetectBarcodesRequest)'
      } catch {
        return
      }
      const dec = async (img) => { try { return JSON.parse((await execFileAsync(bin, [img])).stdout) } catch (e) { try { return JSON.parse(e.stdout) } catch { return { decoded: false } } } }
      qrResult.original = await dec(qrSrc)
      const shotsOf = async (label, t, filter) => {
        const f = join(tmp, `${label}.png`)
        await execFileAsync(ffmpeg(), ['-y', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', ...(filter ? ['-vf', filter] : []), f])
        return dec(f)
      }
      const t = pts.outro_b
      qrResult.renderedFrameFull = await shotsOf('full', t)
      qrResult.rendered1280 = await shotsOf('w1280', t, 'scale=1280:-2:flags=lanczos')
      qrResult.rendered430 = await shotsOf('w430', t, 'scale=430:-2:flags=lanczos')
      qrResult.rendered390 = await shotsOf('w390', t, 'scale=390:-2:flags=lanczos')
      const same = (r) => Boolean(r?.decoded && qrResult.original?.decoded && r.sha256 === qrResult.original.sha256)
      qrResult.sameLinkAsOriginal = { full: same(qrResult.renderedFrameFull), w1280: same(qrResult.rendered1280), w430: same(qrResult.rendered430), w390: same(qrResult.rendered390) }
      // 最終フレーム付近でも
      qrResult.lastSecondsFrame = await shotsOf('last', sec.lineOutro.endSec - 0.4)
      qrResult.sameLinkAtEnd = same(qrResult.lastSecondsFrame)
    })
  }

  // ── 音声 ──
  const D = sec.digest.endSec - sec.digest.startSec
  const audio = {}
  const seg = async (a, b) => pcm(video, a, b - a)
  const dAll = await seg(sec.digest.startSec, sec.digest.endSec)
  audio.digestRmsDb = round(rmsDb(dAll), 1)
  audio.digestFirstHalfSecRmsDb = round(rmsDb(await seg(sec.digest.startSec, sec.digest.startSec + 0.5)), 1)
  audio.digestLastHalfSecRmsDb = round(rmsDb(await seg(sec.digest.endSec - 0.5, sec.digest.endSec)), 1)
  audio.lineIntroRmsDb = round(rmsDb(await seg(sec.lineIntro.startSec + 0.05, sec.lineIntro.endSec - 0.05)), 1) // BGMが漏れていないこと（無音）
  audio.lineOutroRmsDb = round(rmsDb(await seg(sec.lineOutro.startSec + 0.05, sec.lineOutro.endSec - 0.05)), 1)
  audio.mainFirstHalfSecRmsDb = round(rmsDb(await seg(sec.main.startSec, sec.main.startSec + 0.5)), 1)
  // 声とBGMのバランス（本番と同じフィルタで、声・ducking後のBGM・最終ミックスを別々に書き出して測る）
  {
    const srcForStems = validateSourcePath(args.source, roots).realPath
    const bgmForStems = validateSourcePath(args.bgm, roots).realPath
    const cfgS = resolveCompositionConfig({ digest: { bgm: { path: args.bgm, volume: plan.config.digest.bgmVolume, duck: plan.config.digest.duck, fadeInSec: plan.config.digest.fadeInSec, fadeOutSec: plan.config.digest.fadeOutSec } } })
    await withTempDir('lcv-stems-', async (tmp) => {
      const o = { outVoice: join(tmp, 'v.wav'), outBgm: join(tmp, 'b.wav'), outMix: join(tmp, 'm.wav') }
      const { args: sa } = buildDigestStemArgs({ cfg: cfgS, digestClips: plan.digest.clips.map((c) => ({ srcStartSec: c.srcStartSec, durationSec: c.durationSec })), sourcePath: srcForStems, bgmPath: bgmForStems, ...o })
      await execFileAsync(ffmpeg(), sa, { maxBuffer: 1 << 26 })
      const rd = async (f) => { const buf = await rawOut(['-i', f, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1']); return Float64Array.from(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)), (v) => v / 32768) }
      const v = await rd(o.outVoice), b = await rd(o.outBgm), m = await rd(o.outMix)
      audio.stemVoiceRmsDb = round(rmsDb(v), 1)
      audio.stemBgmAfterDuckingRmsDb = round(rmsDb(b), 1)
      audio.stemMixRmsDb = round(rmsDb(m), 1)
      // 声が出ている区間（声のフレームRMSが上位の区間）だけで、声とBGMの差を測る
      const win = 1600
      const rows = []
      for (let i = 0; i + win <= v.length; i += win) rows.push({ v: rmsDb(v.subarray(i, i + win)), b: rmsDb(b.subarray(i, i + win)) })
      const speech = rows.filter((r) => r.v > audio.stemVoiceRmsDb - 3)
      audio.speechWindows = speech.length
      audio.voiceMinusBgmDuringSpeechDb = round(speech.reduce((a, r) => a + (r.v - r.b), 0) / speech.length, 1)
      audio.minVoiceMinusBgmDuringSpeechDb = round(Math.min(...speech.map((r) => r.v - r.b)), 1)
      audio.stemMixMinusVoiceDb = round(audio.stemMixRmsDb - audio.stemVoiceRmsDb, 1)
    })
  }
  // 声とBGMのバランス（簡易）: 元の声（元動画の各クリップ）と、最終ミックス・BGM単体（音量・フェード適用後・ducking前=上限）のRMS
  const roots2 = roots
  const srcReal = validateSourcePath(args.source, roots2).realPath
  let voiceSum = 0, voiceN = 0
  for (const c of plan.digest.clips) {
    const buf = await rawOut(['-ss', String(c.srcStartSec), '-t', String(c.durationSec), '-i', srcReal, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'])
    const a = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
    for (const v of a) { voiceSum += (v / 32768) ** 2; voiceN++ }
  }
  audio.voiceOnlyRmsDb = round(10 * Math.log10(voiceSum / voiceN), 1)
  const bgmBuf = await rawOut(['-t', String(D), '-i', validateSourcePath(args.bgm, roots).realPath, '-vn', '-ac', '1', '-ar', '16000', '-af', `volume=${plan.config.digest.bgmVolume}`, '-f', 's16le', 'pipe:1'])
  const bgm = Float64Array.from(new Int16Array(bgmBuf.buffer, bgmBuf.byteOffset, Math.floor(bgmBuf.length / 2)), (v) => v / 32768)
  audio.bgmOnlyRmsDbBeforeDucking = round(rmsDb(bgm), 1)
  audio.voiceMinusBgmDb = round(audio.voiceOnlyRmsDb - audio.bgmOnlyRmsDbBeforeDucking, 1)
  audio.mixMinusVoiceDb = round(audio.digestRmsDb - audio.voiceOnlyRmsDb, 1) // 0に近いほど、BGMが声を圧迫していない
  // 本編の音声が元動画と一致（BGMが混ざっていない）: 相関
  const finalMain = await pcm(video, sec.main.startSec + 1, 6)
  const srcMain = await (async () => { const buf = await rawOut(['-ss', String(plan.main.srcStartSec + 1), '-t', '6', '-i', srcReal, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']); return Float64Array.from(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)), (v) => v / 32768) })()
  let best = 0
  for (let lag = -800; lag <= 800; lag += 4) {
    let sxy = 0, sxx = 0, syy = 0
    const n = Math.min(finalMain.length, srcMain.length) - 1000
    for (let i = 800; i < n; i += 2) { const x = finalMain[i], y = srcMain[i + lag]; sxy += x * y; sxx += x * x; syy += y * y }
    best = Math.max(best, sxy / Math.sqrt(sxx * syy || 1))
  }
  audio.mainAudioCorrelationWithSource = round(best, 4)

  console.log(JSON.stringify({ stage: 'verify', streams, expectedTotalSec: total, perSection, boundaries, qr: qrResult, audio, framesSaved: shots.length }, null, 2))
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const args = parseArgs(process.argv.slice(2))
  if (!args.job) throw new Error('--job <jobId> を指定してください')
  if (args.stage === 'render') return stageRender(args)
  if (args.stage === 'verify') return stageVerify(args)
  throw new Error('ステージは render です')
}

main().catch((err) => {
  console.error(`[localCaptionComposition] ${err.message}`)
  process.exit(1)
})
