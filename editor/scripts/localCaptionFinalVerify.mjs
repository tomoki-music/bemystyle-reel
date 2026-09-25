// 最終完成版のレンダー後の検証（読み取りのみ。動画・元素材・保存データは変更しない）。localCaptionFinal.mjs verify から呼ばれる。
// 承認済みの確認動画（full_v6.preview2-state.json の outputName）と、デジタル的に同じ区間（ダイジェスト＋本編の先頭44秒）を比べ、承認した設計が保たれていることも確認する。
// 外部AI・whisperは使わない。標準出力に絶対パス・字幕本文は出さない。

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { EDITOR_ROOT, FULL_DIR } from './localCaptionFull.mjs'
import { measurePoint, ptsReport } from './localCaptionFullSync.mjs'
import { computeFrameDb } from '../server/lib/silenceDetector.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { planQrWindows, overlayPanelLayout } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, checkFreeSpace } from '../server/lib/compositionRender.mjs'
import { prepareMainBgm } from '../server/lib/mainBgmAssets.mjs'
import { buildMainBgmFilters } from '../server/lib/mainBgm.mjs'
import { estimateLineWidthPx } from '../server/lib/captionFit.mjs'
import { getCaptionStyleDefs } from '../server/lib/captionStyles.mjs'
import { buildFinalPlan, titleSpans, spanCheck } from './localCaptionFinal.mjs'
import { f32, peakOf, rmsDbOf, toDb, frameSeries, maxStep, maxDiff, winRms, truePeak, buildSwift, normText, lcsRatio, dirSnapshot, fileSig, hashAll, sha256 } from './localCaptionMainBgm.mjs'

const execFileAsync = promisify(execFile)
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const FPS = 30
const SR = 48000
const ff = () => process.env.FFMPEG_BIN

export async function stageVerify(args) {
  const P = await buildFinalPlan(args)
  const { job, file, bytes, base, cutDoc, ctx, info, plan, mainSec, full, recovered, digestTail } = P
  const st = JSON.parse(readFileSync(join(FULL_DIR, 'full_v6.final-state.json'), 'utf-8'))
  if (st.status !== 'done') throw new Error(`最終レンダーの状態が done ではありません（${st.status}）`)
  const video = join(ctx.outputRoot, st.outputName)
  if (!existsSync(video)) throw new Error('完成動画が見つかりません')
  const assets = await resolveCompositionAssets(plan.cfg, ctx.inputRoots)
  const T = plan.timeline
  const TR = T.transition
  const D = plan.D
  const A = plan.anchors
  const cutEnd = cutDoc.cut.cutEndSec
  const dc = plan.dig.clips
  const out = { stage: 'verify', outputName: st.outputName, sizeBytes: statSync(video).size, renderMs: st.renderMs }
  const step = (label) => process.stderr.write(`[verify] ${label}\n`)

  // 1-4. duration・解像度・ストリーム・PTS・全編デコード
  step('pts / probe')
  out.pts = await ptsReport(video, T.totalSec)
  const probe = JSON.parse((await execFileAsync(process.env.FFPROBE_BIN, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration,size', '-of', 'json', video])).stdout)
  const vs = probe.streams.find((s) => s.codec_type === 'video')
  const as = probe.streams.find((s) => s.codec_type === 'audio')
  const cnt = JSON.parse((await execFileAsync(process.env.FFPROBE_BIN, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', video], { maxBuffer: 1 << 26 })).stdout).streams[0]
  out.basic = { totalSecPlanned: T.totalSec, containerDurationSec: round(Number(probe.format.duration)), videoDurationSec: out.pts.video.durationSec, audioDurationSec: out.pts.audio.durationSec, width: vs.width, height: vs.height, is1920x1080: vs.width === 1920 && vs.height === 1080, videoCodec: vs.codec_name, audioCodec: as?.codec_name, audioSampleRate: as && Number(as.sample_rate), audioChannels: as?.channels, hasVideo: Boolean(vs), hasAudio: Boolean(as), frames: Number(cnt.nb_read_frames), expectedFrames: Math.round(T.totalSec * FPS), fileSizeBytes: statSync(video).size }
  step('full decode')
  const dec = await execFileAsync(ff(), ['-v', 'error', '-xerror', '-i', video, '-f', 'null', '-'], { maxBuffer: 1 << 26 }).then((r) => ({ ok: true, stderr: r.stderr })).catch((e) => ({ ok: false, stderr: `${e.stderr ?? e.message}` }))
  out.decode = { errors: dec.ok && dec.stderr.trim() === '' ? 0 : dec.stderr.trim().split('\n').length, ok: dec.ok && dec.stderr.trim() === '' }

  // 5-6. A/V 同期（冒頭・25%・50%・75%・終了付近。本編は元動画と1対1の連続区間）
  step('a/v sync')
  const mainStartSrc = cutEnd
  const pts = [['intro', mainStartSrc + 4], ['25%', mainStartSrc + mainSec * 0.25], ['50%', mainStartSrc + mainSec * 0.5], ['75%', mainStartSrc + mainSec * 0.75], ['near-end', mainStartSrc + mainSec - 20]]
  const rows = []
  for (const [label, s] of pts) rows.push({ label, srcSec: round(s, 2), ...(await measurePoint({ video, source: ctx.sourceRealPath, srcSec: s, outSec: D + (s - cutEnd) })) })
  rows.push({ label: 'digest-clip1', srcSec: round(dc[0].srcStartSec + 0.5, 2), ...(await measurePoint({ video, source: ctx.sourceRealPath, srcSec: dc[0].srcStartSec + 0.5, outSec: 0.5 })) })
  rows.push({ label: 'digest-clip2', srcSec: round(dc[1].srcStartSec + 0.5, 2), ...(await measurePoint({ video, source: ctx.sourceRealPath, srcSec: dc[1].srcStartSec + 0.5, outSec: dc[0].durationSec + 0.5 })) })
  const mainRows = rows.filter((r) => !r.label.startsWith('digest'))
  const av = mainRows.map((r) => r.avOffsetMs)
  const ad = mainRows.map((r) => r.audioDelayMs)
  out.avSync = { rows: rows.map((r) => ({ label: r.label, srcSec: r.srcSec, avOffsetMs: r.avOffsetMs, audioDelayMs: r.audioDelayMs, videoPtsOffsetMs: r.videoPtsOffsetMs })), maxAbsAvOffsetMs: round(Math.max(...rows.map((r) => Math.abs(r.avOffsetMs ?? 999))), 2), mainAvDriftMs: round(Math.max(...av) - Math.min(...av), 2), mainAudioDelayDriftMs: round(Math.max(...ad) - Math.min(...ad), 2), maxAbsAudioDelayMs: round(Math.max(...rows.map((r) => Math.abs(r.audioDelayMs ?? 999))), 2), allWithinOneFrame: rows.every((r) => r.avOffsetMs !== null && Math.abs(r.avOffsetMs) < 1000 / FPS) }

  step('audio decode')
  const all = await f32(video, null, 0)
  const seg = (a, b) => all.subarray(Math.max(0, Math.round(a * SR)), Math.min(all.length, Math.round(b * SR)))
  const sec = (k) => T.sections.find((s) => s.kind === k)
  const outro = sec('lineOutro')

  // 7-8. 遷移・本編最初の息
  step('transition')
  const f0 = Math.round(T.liveDigestSec * FPS) - 3
  const nFr = 3 + TR.fadeOut.frames + TR.hold.frames + TR.fadeIn.frames + 12
  const Y = await frameSeries(video, 'YAVG', f0 / FPS, nFr)
  const SAT = await frameSeries(video, 'SATAVG', f0 / FPS, nFr)
  const idx = (t) => Math.round(t * FPS) - f0
  const iOut0 = idx(TR.fadeOut.startSec); const iHold0 = idx(TR.hold.startSec); const iMain0 = idx(TR.mainStartSec)
  const nonIncr = (a) => a.every((v, i) => i === 0 || v <= a[i - 1] + 0.6)
  const nonDecr = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 0.6)
  const holdRange = [round(D - TR.hold.frames / FPS, 3), D]
  const clickAt = (t) => round(maxStep(all, t - 0.005, t + 0.005) / Math.max(1e-9, Math.max(maxStep(all, t - 0.5, t - 0.05), maxStep(all, t + 0.05, t + 0.5))), 3)
  const first = await f32(video, D, 1.6, 16000)
  const fdb = computeFrameDb(Int16Array.from(first, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))), 16000, 0.01)
  const onFrame = fdb.db.findIndex((v) => v > -43)
  const expectOnset = round(cutDoc.measure.onsetSec - cutEnd, 3)
  out.transition = {
    plan: { fadeOutFrames: TR.fadeOut.frames, holdFrames: TR.hold.frames, fadeInFrames: TR.fadeIn.frames, liveEndSec: TR.liveEndSec, digestEndSec: T.digestSec, mainStartSec: D },
    fadeOutMonotone: nonIncr(Y.slice(iOut0, iHold0)), fadeInMonotone: nonDecr(Y.slice(iMain0, iMain0 + TR.fadeIn.frames + 3)), holdIsBlack: Y.slice(iHold0, iMain0).every((y) => y <= 17.5), holdY: Y.slice(iHold0, iMain0).map((v) => round(v, 1)),
    saturation: { digest: round(SAT[Math.max(0, iOut0 - 2)], 2), mainAfterFadeIn: round(SAT[iMain0 + TR.fadeIn.frames + 2], 2), grayThenColor: SAT[Math.max(0, iOut0 - 2)] < 1 && SAT[iMain0 + TR.fadeIn.frames + 2] > 3 },
    audio: { holdRmsDb: round(winRms(all, holdRange[0] + 0.005, holdRange[1] - 0.005), 1), holdPeak: round(peakOf(seg(holdRange[0] + 0.01, holdRange[1] - 0.01)), 6), clickRatioAtDigestEnd: clickAt(T.digestSec), clickRatioAtMainStart: clickAt(D) },
    firstBreath: { onsetAfterMainStartSec: round(onFrame * fdb.frameSec, 3), expectedOnsetSec: expectOnset, preserved: onFrame >= 0 && Math.abs(onFrame * fdb.frameSec - expectOnset) <= 0.021 },
    frameCount: { expected: out.basic.expectedFrames, actual: out.basic.frames, ok: out.basic.expectedFrames === out.basic.frames },
  }

  // 9-10. ダイジェストBGM・本編BGMの範囲
  const outroPeak = peakOf(seg(outro.startSec + 0.05, outro.endSec))
  const lastMain = { rmsLast100msDb: round(winRms(all, A.mainEndSec - 0.1, A.mainEndSec), 1) }
  out.bgmScope = {
    outroPeakDb: round(toDb(outroPeak), 1), outroRmsDb: round(rmsDbOf(seg(outro.startSec + 0.05, outro.endSec)), 1), outroSilent: outroPeak < 1e-3, // 末尾LINE案内は無音（AAC後の量子化ノイズ以下）
    holdSilent: peakOf(seg(holdRange[0] + 0.01, holdRange[1] - 0.01)) < 1e-3, lastMain,
    ranges: { digest: [0, T.digestSec], hold: [T.digestSec, D], mainBgm: [A.bgmStartSec, A.bgmEndSec], outro: [outro.startSec, outro.endSec] },
  }
  // 承認済みの確認動画との一致: ダイジェスト（本編BGMなし・ダイジェストBGMのみ）と本編先頭44秒（本編BGM・ダッキング・フェードイン）が同じ
  step('compare with approved preview')
  const prevName = JSON.parse(readFileSync(join(FULL_DIR, 'full_v6.preview2-state.json'), 'utf-8')).outputName
  const prevVideo = join(ctx.outputRoot, prevName)
  const CMP = D + 44
  const prev = await f32(prevVideo, null, 0)
  let sq = 0; const nDig = Math.round(CMP * SR)
  for (let i = Math.round(0.15 * SR); i < nDig; i++) { const d = all[i] - prev[i]; sq += d * d }
  const psnr = async () => { const r = await execFileAsync(ff(), ['-hide_banner', '-nostats', '-t', String(CMP), '-i', video, '-t', String(CMP), '-i', prevVideo, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], { maxBuffer: 1 << 26 }).catch((e) => e); const m = /average:(\S+)/.exec(`${r.stderr ?? ''}`); return m ? m[1] : null }
  out.approvedPreviewMatch = {
    comparedSec: round(CMP, 3), digestMaxAudioDiff: round(maxDiff(all, prev, 0.15, T.digestSec - 0.05), 6), holdMaxAudioDiff: round(maxDiff(all, prev, T.digestSec, D), 6),
    mainFirst44sMaxAudioDiff: round(maxDiff(all, prev, D, CMP), 5), mainFirst44sDiffRmsDb: round(toDb(Math.sqrt(sq / (nDig - Math.round(0.15 * SR)))), 1), videoPsnrAvgDb: await psnr(),
    digestAudioIdentical: maxDiff(all, prev, 0.15, T.digestSec - 0.05) < 2e-3, digestBgmDoesNotEnterMain: maxDiff(all, prev, T.digestSec, D + 0.1) < 2e-3 && winRms(all, T.digestSec - 0.02, T.digestSec) < -50,
  }

  // 11. 本編BGMのループ境界（本番と同じトラックでBGMだけを再構成し、各継ぎ目のクリックと音量差を測る）
  step('bgm loop boundaries')
  const loop = await withTempDir('lcv-final-verify-bgm-', async (tmp) => {
    const t = (n) => join(tmp, n)
    const r = await prepareMainBgm({ cfg: plan.cfg, roots: ctx.inputRoots, sourcePath: ctx.sourceRealPath, mainItems: plan.tm.items, mainSec, planMainSec: mainSec, levelItems: full.items, tmpDir: tmp })
    if (!r.ok) throw new Error(r.error)
    const pr = r.prep
    const g = buildMainBgmFilters({ bgmInputIndex: 1, bgmIntroInputIndex: 2, mainSec, gainDb: pr.gainDb, plan: pr.plan, cfg: { ...plan.cfg.mainBgm, ducking: false }, sampleRate: SR, voiceLabel: '[vin]', outLabel: '[o]' })
    await execFileAsync(ff(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`, '-stream_loop', '-1', '-i', pr.inputPath, '-i', pr.introPath, '-filter_complex', [`[0:a]atrim=0:${mainSec},asetpts=PTS-STARTPTS[vin]`, ...g].join(';'), '-map', '[o]', '-c:a', 'pcm_f32le', t('bgmonly.wav')], { maxBuffer: 1 << 26 })
    const bo = await f32(t('bgmonly.wav'), null, 0)
    const w = pr.plan
    const bounds = []
    for (let k = 0; ; k++) { const b = w.introSec + k * w.unitSec; if (b > mainSec - 1) break; bounds.push({ k, atMainSec: round(b, 3) }) }
    const rms = (x, a, b) => rmsDbOf(x.subarray(Math.round(a * SR), Math.round(b * SR)))
    const rowsB = bounds.map((b) => {
      const s0 = maxStep(bo, b.atMainSec - 0.005, b.atMainSec + 0.005)
      const around = Math.max(maxStep(bo, b.atMainSec - 1.5, b.atMainSec - 0.05), maxStep(bo, b.atMainSec + 0.05, b.atMainSec + 1.5))
      const mixAt = D + b.atMainSec
      const m0 = maxStep(all, mixAt - 0.005, mixAt + 0.005)
      const mAround = Math.max(maxStep(all, mixAt - 1.5, mixAt - 0.05), maxStep(all, mixAt + 0.05, mixAt + 1.5))
      return { ...b, atFinalSec: round(mixAt, 3), bgmStepRatio: round(s0 / Math.max(around, 1e-9), 3), bgmLevelDiff500msDb: round(Math.abs(rms(bo, b.atMainSec - 0.5, b.atMainSec) - rms(bo, b.atMainSec, b.atMainSec + 0.5)), 2), bgmLevelDiff100msDb: round(Math.abs(rms(bo, b.atMainSec - 0.1, b.atMainSec) - rms(bo, b.atMainSec, b.atMainSec + 0.1)), 2), mixStepRatio: round(m0 / Math.max(mAround, 1e-9), 3), mixMaxStep: round(m0, 5) }
    })
    const fo = plan.cfg.mainBgm.fadeOutSec
    return {
      sameGainAsApprovedPreview: Math.abs(pr.gain.gainDb - st.mainBgm.gain.gainDb) < 0.01, gainDb: pr.gain.gainDb, loopStartSec: pr.loopSelection?.startSec, sourceLoops: pr.plan.loops, unitSec: pr.plan.unitSec, crossfadeSec: pr.plan.crossfadeSec, introSec: pr.plan.introSec,
      boundaries: rowsB, allBgmClickFree: rowsB.every((x) => x.bgmStepRatio <= 1.5), allLevelDiffSmall: rowsB.every((x) => x.bgmLevelDiff500msDb <= 2.0), allMixClickFree: rowsB.every((x) => x.mixStepRatio <= 2.0),
      fades: { firstSampleAbs: round(Math.abs(bo[0]), 6), rmsAt1p5sDb: round(rms(bo, 1.5, 1.7), 1), rmsFirst100msDb: round(rms(bo, 0, 0.1), 1), lastSampleAbs: round(Math.abs(bo[bo.length - 1]), 6), rmsLast200msDb: round(rms(bo, mainSec - 0.2, mainSec), 1), rmsBeforeFadeOutDb: round(rms(bo, mainSec - fo - 0.4, mainSec - fo - 0.2), 1), lengthSec: round(bo.length / SR, 3) },
    }
  })
  out.bgmLoop = loop.result
  out.bgmLoop.tempRemoved = loop.removed

  // 12-14. caption・テーマ・強調（ASS と実フレームのOCR）
  step('captions / themes (ASS)')
  const assText = plan.buildAss({ width: assets.qr.width, height: assets.qr.height })
  const capStyles = new Set(['Normal', 'Main', 'Sub', 'Emphasis'])
  const dial = assText.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => { const f = l.split(','); return { style: f[3], startSec: parseAssT(f[1]), endSec: parseAssT(f[2]) } })
  const mainDial = dial.filter((d) => capStyles.has(d.style) && d.startSec >= D - 1e-6)
  const digDial = dial.filter((d) => capStyles.has(d.style) && d.startSec < T.digestSec)
  const titles = titleSpans(assText)
  const themeSpans = plan.mapped.themesMapped.map((th) => ({ id: th.id, title: th.title, startSec: round(th.startSec + D, 3), endSec: round(th.endSec + D, 3) }))
  out.captions = {
    astDialogueMain: mainDial.length, expectedMain: plan.mainCaps.length, existing495: plan.mainCaps.filter((c) => c.source !== 'manual-intro-recovery').length, intro4: plan.mainCaps.filter((c) => c.source === 'manual-intro-recovery').length,
    digestDialogue: digDial.length, emphasisMain: plan.mainCaps.filter((c) => c.emphasisText).length, digestEmphasis: dc.filter((c) => c.emphasis).length,
    themes: { count: themeSpans.length, main: spanCheck(titles, D, A.mainEndSec), digest: spanCheck(titles, 0, T.digestSec), outroHasTitles: titles.filter((x) => x[0] >= outro.startSec - 0.005).length },
  }
  const styleSizes = Object.fromEntries(assText.split('\n').filter((l) => l.startsWith('Style:')).map((l) => { const f = l.slice(6).split(','); return [f[0].trim(), Number(f[2])] }))
  out.captions.styleSizes = { Normal: styleSizes.Normal, Main: styleSizes.Main, Sub: styleSizes.Sub, Emphasis: styleSizes.Emphasis, TopicTitle: styleSizes.TopicTitle, TopicLabel: styleSizes.TopicLabel }

  // 15-17. QR・OCR・重なり（実フレーム）
  step('frames / QR / OCR')
  const saveDir = args.framesDir
  if (saveDir) mkdirSync(saveDir, { recursive: true })
  const ov = T.overlays[0]
  const panel = overlayPanelLayout(job.width, job.height, plan.cfg.line.text, true, assets.qr.width, assets.qr.height)
  const defs = getCaptionStyleDefs(job.width, job.height)
  const capGeo = plan.mainCaps.filter((c) => c.startSec < ov.endSec && c.endSec > ov.startSec).map((c) => {
    const size = defs[c.captionType === 'main' ? 'main' : c.captionType === 'sub' ? 'sub' : c.captionType === 'emphasis' ? 'emphasis' : 'normal'].fontsize
    const lines = c.lines ?? String(c.text).split('\n')
    const w = Math.max(...lines.map((l) => estimateLineWidthPx(l, size)))
    const left = (job.width - w) / 2; const right = (job.width + w) / 2
    const top = job.height - Math.max(24, Math.round(job.height * 0.06)) - lines.length * size * 1.2
    return { id: c.id, insideScreen: left >= 0 && right <= job.width, overlapsPanel: right > panel.panel.x && left < panel.panel.x + panel.panel.w && top < panel.panel.y + panel.panel.h }
  })
  out.overlapGeometry = { panel: panel.panel, captionsDuringOverlay: capGeo.length, anyOverlapWithPanel: capGeo.some((c) => c.overlapsPanel), anyOutsideScreen: capGeo.some((c) => !c.insideScreen) }
  const q = await withTempDir('lcv-final-frames-', async (tmp) => {
    const qrBin = await buildSwift(tmp, 'qrDecode')
    const ocrBin = await buildSwift(tmp, 'ocrText')
    const frame = (tt, f, vf) => execFileAsync(ff(), ['-v', 'error', '-y', '-ss', String(round(tt, 3)), '-i', video, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), f])
    const decodeQr = async (img) => { try { return JSON.parse((await execFileAsync(qrBin, [img])).stdout) } catch (e) { try { return JSON.parse(e.stdout) } catch { return { decoded: false } } } }
    const ocr = async (files) => { const r = []; for (let i = 0; i < files.length; i += 40) for (const l of (await execFileAsync(ocrBin, files.slice(i, i + 40), { maxBuffer: 1 << 26 })).stdout.trim().split('\n')) r.push(JSON.parse(l).text ?? ''); return r }
    const band = 'crop=iw:ih*0.32:0:ih*0.66'
    // 冒頭の補完4件
    const intro = plan.mainCaps.filter((c) => c.source === 'manual-intro-recovery')
    const iFiles = []
    for (let i = 0; i < intro.length; i++) { const f = join(tmp, `i${i}.png`); await frame((intro[i].startSec + intro[i].endSec) / 2, f, band); iFiles.push(f) }
    const iText = await ocr(iFiles)
    const introOcr = intro.map((c, i) => ({ id: c.id, ocrRatio: round(lcsRatio(c.text, iText[i]), 2), shows: normText(iText[i]).includes(normText(c.text)) }))
    // 既存caption: 全編から均等に40件＋強調13件
    const existing = plan.mainCaps.filter((c) => c.source !== 'manual-intro-recovery')
    const sample = [...new Set([...Array.from({ length: 40 }, (_, i) => Math.floor((i * (existing.length - 1)) / 39)), ...existing.map((c, i) => (c.emphasisText ? i : -1)).filter((i) => i >= 0)])].sort((a, b) => a - b)
    const sFiles = []
    for (const i of sample) { const c = existing[i]; const f = join(tmp, `s${i}.png`); await frame((c.startSec + c.endSec) / 2, f, band); sFiles.push(f) }
    const sText = await ocr(sFiles)
    const capRows = sample.map((i, k) => ({ i, emphasis: Boolean(existing[i].emphasisText), ratio: lcsRatio(existing[i].text, sText[k]), emphShows: existing[i].emphasisText ? normText(sText[k]).includes(normText(existing[i].emphasisText)) : null }))
    const emph = capRows.filter((r) => r.emphasis)
    // ダイジェスト字幕
    const dFiles = []
    for (let i = 0; i < plan.digCaps.length; i++) { const f = join(tmp, `d${i}.png`); await frame(Math.min((plan.digCaps[i].startSec + plan.digCaps[i].endSec) / 2, T.liveDigestSec - 0.1), f, band); dFiles.push(f) }
    const dText = await ocr(dFiles)
    const dRatios = plan.digCaps.map((c, i) => lcsRatio(c.text, dText[i]))
    const dEmph = dc.map((c, i) => ({ clip: i + 1, text: c.emphasis?.text ?? null }))
    // トークテーマ: 全9件の始め・中央・終わりの実フレーム（全画面OCRにテーマ名が出る）
    const tFiles = []; const tMeta = []
    for (const th of themeSpans) for (const [lab, tt] of [['start', th.startSec + 0.4], ['mid', (th.startSec + th.endSec) / 2], ['end', th.endSec - 0.4]]) { const f = join(tmp, `t${tFiles.length}.png`); await frame(tt, f); tFiles.push(f); tMeta.push({ th, lab }) }
    const tText = await ocr(tFiles)
    const themeRows = tMeta.map((m, i) => ({ id: m.th.id, at: m.lab, ratio: round(lcsRatio(m.th.title, tText[i]), 2), shows: normText(tText[i]).includes(normText(m.th.title)) }))
    // QR: 冒頭オーバーレイ・末尾（開始直後・中央・終了直前）を 1920/430/390 で
    const orig = await decodeQr(assets.qr.realPath)
    const shots = [['overlay-start', ov.startSec + 0.05], ['overlay-mid', (ov.startSec + ov.endSec) / 2], ['overlay-end', ov.endSec - 0.1], ['outro-start', outro.startSec + 0.05], ['outro-mid', (outro.startSec + outro.endSec) / 2], ['outro-last', T.totalSec - 0.1]]
    const qrRows = []
    for (const [name, tt] of shots) {
      const fullP = join(tmp, `qr-${name}.png`); await frame(tt, fullP)
      const row = { name, atSec: round(tt, 2) }
      for (const w of [1920, 430, 390]) { const f = w === 1920 ? fullP : join(tmp, `qr-${name}-${w}.png`); if (w !== 1920) await execFileAsync(ff(), ['-v', 'error', '-y', '-i', fullP, '-vf', `scale=${w}:-2:flags=lanczos`, f]); const r = await decodeQr(f); row[`w${w}`] = Boolean(r.decoded && r.sha256 === orig.sha256) }
      qrRows.push(row)
    }
    const noQr = []
    for (const tt of [1, T.digestSec - 0.3, D - 0.05, ov.endSec + 3, D + 300, A.mainEndSec - 3]) { const f = join(tmp, `nq-${round(tt, 1)}.png`); await frame(tt, f); noQr.push(!(await decodeQr(f)).decoded) }
    // 冒頭オーバーレイは本編の最初のフレームから（黒の保持の間は出ない）: 右上パネル領域の明るさ
    const probe = async (tt) => { const f = join(tmp, `pp-${round(tt, 3)}.png`); await frame(tt, f, 'crop=iw*0.4:ih*0.5:iw*0.6:0,scale=64:-2'); const r = await execFileAsync(ff(), ['-v', 'error', '-i', f, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 24 }); return Number((r.stdout.match(/YAVG=([\d.]+)/) ?? [])[1]) }
    const overlayProbe = { holdYavg: round(await probe(D - 0.05), 1), firstMainFrameYavg: round(await probe(D + 1 / FPS), 1), mainPlus0p6sYavg: round(await probe(D + 0.6), 1), afterOverlayYavg: round(await probe(ov.endSec + 2), 1) }
    if (saveDir) {
      const list = [['01-digest', 2], ['02-digest-lastspeech', T.liveDigestSec - 0.3], ['03-fadeout-mid', TR.fadeOut.startSec + 0.17], ['04-black', D - 0.05], ['05-fadein-mid', D + 0.13], ['06-main-first', D + 0.5], ['07-intro-cap1', (intro[0].startSec + intro[0].endSec) / 2], ['08-intro-cap4', (intro[3].startSec + intro[3].endSec) / 2], ['09-overlay-mid', D + 15], ['10-overlay-last', ov.endSec - 0.3], ['11-after-overlay', ov.endSec + 5], ['12-main-25', D + mainSec * 0.25], ['13-main-50', D + mainSec * 0.5], ['14-main-75', D + mainSec * 0.75], ['15-main-end', A.mainEndSec - 1], ['16-outro-start', outro.startSec + 0.1], ['17-outro-mid', (outro.startSec + outro.endSec) / 2], ['18-outro-last', T.totalSec - 0.1]]
      for (const [n, tt] of list) await frame(tt, join(saveDir, `${n}.png`), 'scale=960:-2:flags=lanczos')
      const eIdx = sample.find((i) => existing[i].emphasisText)
      if (eIdx !== undefined) { const c = existing[eIdx]; await frame((c.startSec + c.endSec) / 2, join(saveDir, '19-emphasis.png'), 'scale=960:-2:flags=lanczos') }
      await frame((plan.digCaps[0].startSec + plan.digCaps[0].endSec) / 2, join(saveDir, '20-digest-emphasis.png'), 'scale=960:-2:flags=lanczos')
    }
    return {
      introOcr, existingOcr: { sampled: capRows.length, min: round(Math.min(...capRows.map((r) => r.ratio)), 2), avg: round(capRows.reduce((a, r) => a + r.ratio, 0) / capRows.length, 2), below0p6: capRows.filter((r) => r.ratio < 0.6).length }, emphasisOcr: { checked: emph.length, shows: emph.filter((r) => r.emphShows).length },
      digestOcr: { min: round(Math.min(...dRatios), 2), avg: round(dRatios.reduce((a, b) => a + b, 0) / dRatios.length, 2) }, digestEmphasis: dEmph,
      themeOcr: { checked: themeRows.length, shows: themeRows.filter((r) => r.shows).length, misses: themeRows.filter((r) => !r.shows).map((r) => [r.id, r.at, r.ratio]) },
      overlayProbe, qr: { original: Boolean(orig.decoded), allReadable: qrRows.every((r) => r.w1920 && r.w430 && r.w390), rows: qrRows.map((r) => [r.name, r.atSec, r.w1920, r.w430, r.w390]), noQrElsewhere: noQr.every(Boolean), windows: planQrWindows(plan.cfg, T).map((w) => ({ kind: w.kind, startSec: w.startSec, endSec: w.endSec, sec: round(w.endSec - w.startSec, 3) })) },
    }
  })
  Object.assign(out.captions, { introOcr: q.result.introOcr, existingOcr: q.result.existingOcr, emphasisOcr: q.result.emphasisOcr, digestOcr: q.result.digestOcr, digestEmphasis: q.result.digestEmphasis, themeOcr: q.result.themeOcr })
  out.overlay = { startSec: ov.startSec, endSec: ov.endSec, secFromMainStart: round(ov.endSec - ov.startSec, 3), startsWithMain: Math.abs(ov.startSec - D) < 1e-6, addsToTotal: false, probe: q.result.overlayProbe }
  out.qr = q.result.qr

  // 18-20. 不変性・一時ファイル・空き容量
  const files = [...readdirSync(FULL_DIR).filter((n) => /^full_v[3-6]\./.test(n) && !n.includes('final-state')).map((n) => join(FULL_DIR, n)), join(EDITOR_ROOT, 'data/local_caption_videos', `${job.id}.json`)]
  const dirNow = dirSnapshot(ctx.outputRoot)
  const free = await checkFreeSpace(ctx.outputRoot, 0)
  out.immutability = {
    sourceUnchanged: fileSig(ctx.sourceRealPath) === st.guard.source, mp3Unchanged: sha256(readFileSync(info.realPath)) === st.guard.mp3, digestBgmUnchanged: sha256(readFileSync(assets.bgm.realPath)) === st.guard.digestBgm, qrUnchanged: sha256(readFileSync(assets.qr.realPath)) === st.guard.qr,
    dataAndJobJsonUnchanged: JSON.stringify(hashAll(files)) === JSON.stringify(st.guard.files), jobFileByteIdentical: bytes.equals(readFileSync(file)),
    existingOutputsUnchanged: Object.entries(st.before).every(([n, x]) => dirNow[n] === x), newOutputs: Object.keys(dirNow).filter((n) => !(n in st.before)),
  }
  out.leftovers = { tempOrPartialInOutput: readdirSync(ctx.outputRoot).filter((n) => n.startsWith('.rendering-') || n.endsWith('.partial') || n.startsWith('.machinery-') || n.startsWith('.rehearsal-')), tmpDirsUnderOsTmp: readdirSync(os.tmpdir()).filter((n) => n.startsWith('lcv-')) }
  out.freeGBAfter = round(free.freeBytes / 1024 ** 3, 1)
  out.externalAiApiCalled = false
  console.log(JSON.stringify(out, null, 2))
}

const parseAssT = (x) => { const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(x); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100 }
