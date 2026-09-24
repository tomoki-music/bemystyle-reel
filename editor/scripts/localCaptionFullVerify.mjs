// ローカルAIテロップ動画: 全編の完成動画のレンダー後・詳細検証（字幕のOCR照合・強調色・白黒範囲・音声・QR・代表フレーム）。
// 動画は生成しない。外部AI APIは呼ばない（OCR/QRはmacOS Vision＝オンデバイス）。字幕本文・テーマ名・強調語・絶対パスは出力しない。

import { readFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { loadJob, safetyContext, FULL_DIR } from './localCaptionFull.mjs'
import { buildPlan } from './localCaptionFullRender.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { resolveCompositionAssets } from '../server/lib/compositionRender.mjs'
import { buildDigestStemArgs, planQrWindows } from '../server/lib/finalComposition.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const STATE_PATH = resolve(FULL_DIR, 'full_v3.render-state.json')

const norm = (s) => String(s).replace(/[\s、。！？!?,，「」『』（）()・…\n\\N]/g, '')
/** 最長共通部分列 / 期待文字数（OCRの誤認識・欠落に強い一致率）。 */
function lcsRatio(expected, got) {
  const a = Array.from(norm(expected))
  const b = Array.from(norm(got))
  if (a.length === 0) return 1
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp[a.length][b.length] / a.length
}
const pct = (arr, q) => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null }

export async function stageVerify(args, { composeFromSaved }) {
  const { job } = loadJob(args.job)
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  const video = join(outputRoot, state.outputName)
  if (!existsSync(video)) throw new Error('完成動画が見つかりません')
  const saved = composeFromSaved(job)
  const plan = buildPlan(job, saved, { bgm: args.bgm, qr: args.qr })
  const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
  const T = plan.timeline
  const D = T.digestSec
  const main = T.sections.find((s) => s.kind === 'main')
  const outro = T.sections.find((s) => s.kind === 'lineOutro')
  const ov = T.overlays[0]
  const fps = plan.cfg.fps
  const ff = process.env.FFMPEG_BIN
  const framesDir = args.framesDir
  if (framesDir) mkdirSync(framesDir, { recursive: true })
  const out = { stage: 'verify', outputName: state.outputName }

  await withTempDir('lcv-full-verify-', async (tmp) => {
    const build = async (name) => { const bin = join(tmp, name); await execFileAsync('swiftc', ['-O', resolve(__dirname, 'tools', `${name}.swift`), '-o', bin], { timeout: 300000 }); return bin }
    const qrBin = await build('qrDecode')
    const ocrBin = await build('ocrText')
    const frame = async (t, file, vf) => execFileAsync(ff, ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), file])
    const rgb = async (t, vf) => (await execFileAsync(ff, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
    const ocrMany = async (files) => {
      const res = []
      for (let i = 0; i < files.length; i += 40) {
        const o = (await execFileAsync(ocrBin, files.slice(i, i + 40), { maxBuffer: 1 << 26 })).stdout.trim().split('\n')
        for (const l of o) res.push(JSON.parse(l).text ?? '')
      }
      return res
    }
    const decodeQr = async (img) => { try { return JSON.parse((await execFileAsync(qrBin, [img])).stdout) } catch (e) { try { return JSON.parse(e.stdout) } catch { return { decoded: false } } } }

    // ── 1) 字幕: 全captionの中央フレームで、下部の字幕帯をOCRして本文と照合（時刻・表示の同期を実映像で確認） ──
    const events = [...plan.digCaps.map((c) => ({ ...c, part: 'digest' })), ...plan.mainCaps.map((c) => ({ ...c, part: 'main' }))]
    const band = 'crop=iw:ih*0.32:0:ih*0.66'
    const capFiles = []
    for (let i = 0; i < events.length; i++) {
      const f = join(tmp, `cap${i}.png`)
      await frame(round((events[i].startSec + events[i].endSec) / 2, 3), f, band)
      capFiles.push(f)
    }
    const capText = await ocrMany(capFiles)
    const ratios = events.map((e, i) => lcsRatio(e.text, capText[i]))
    const bad = events.map((e, i) => ({ i, part: e.part, atSec: round((e.startSec + e.endSec) / 2, 2), ratio: round(ratios[i], 2) })).filter((x) => x.ratio < 0.7)
    out.captionsOcr = { checked: events.length, digest: plan.digCaps.length, main: plan.mainCaps.length, meanRatio: round(ratios.reduce((a, b) => a + b, 0) / ratios.length, 4), p05: round(pct(ratios, 0.05), 3), min: round(Math.min(...ratios), 3), below0_7: bad.length, below0_7At: bad.slice(0, 30) }

    // ── 1b) 字幕の切り替わり直前の隙間（0.4秒以上）に字幕が残っていない（OCRの文字数） ──
    const gaps = []
    const seq = events.filter((e) => e.part === 'main')
    for (let i = 1; i < seq.length; i++) {
      const g = seq[i].startSec - seq[i - 1].endSec
      if (g >= 0.4) gaps.push({ t: round((seq[i - 1].endSec + seq[i].startSec) / 2, 3), g: round(g, 2) })
    }
    const gapFiles = []
    for (let i = 0; i < gaps.length; i++) {
      const f = join(tmp, `gap${i}.png`)
      await frame(gaps[i].t, f, band)
      gapFiles.push(f)
    }
    const gapText = await ocrMany(gapFiles)
    const ghosts = gaps.filter((_, i) => norm(gapText[i]).length >= 3)
    out.captionGaps = { sampledGaps: gaps.length, ghostCaptionFrames: ghosts.length, at: ghosts.slice(0, 20).map((x) => x.t) }

    // ── 2) 部分強調: 強調のあるcaptionだけ琥珀色の画素が字幕帯にある（強調のないcaptionには琥珀色がない） ──
    const amberCount = async (t) => {
      const b = await rgb(t, `${band},scale=960:-2:flags=area`)
      let n = 0
      for (let i = 0; i + 2 < b.length; i += 3) if (Math.abs(b[i] - 0xf0) < 14 && Math.abs(b[i + 1] - 0xb3) < 14 && Math.abs(b[i + 2] - 0x4a) < 24) n++
      return n
    }
    const emph = events.map((e, i) => ({ e, i })).filter((x) => x.e.emphasisText)
    const emphAmber = []
    for (const x of emph) emphAmber.push(await amberCount(round((x.e.startSec + x.e.endSec) / 2, 3)))
    const plainIdx = events.map((e, i) => i).filter((i) => !events[i].emphasisText && events[i].part === 'main').filter((_, k) => k % 6 === 0)
    const plainAmber = []
    for (const i of plainIdx) plainAmber.push(await amberCount(round((events[i].startSec + events[i].endSec) / 2, 3)))
    out.emphasis = { emphasizedChecked: emph.length, emphasizedWithAmber: emphAmber.filter((n) => n >= 40).length, minAmberPixels: Math.min(...emphAmber), plainChecked: plainIdx.length, plainWithAmber: plainAmber.filter((n) => n >= 40).length, maxPlainAmber: Math.max(...plainAmber) }

    // ── 3) トークテーマ: 各テーマの開始直後に、テーマ箱をOCRしてタイトルを照合 ──
    const secs = [...plan.digBlocks.flatMap((b) => b.sections), ...plan.mainBlock.sections]
    const themeFiles = []
    for (let i = 0; i < secs.length; i++) {
      const f = join(tmp, `th${i}.png`)
      await frame(round(secs[i].startSec + 0.8, 3), f, 'crop=820:300:90:56')
      themeFiles.push(f)
    }
    const themeText = await ocrMany(themeFiles)
    const themeRatios = secs.map((s, i) => lcsRatio(s.title, themeText[i]))
    out.themeOcr = { checked: secs.length, digestSections: plan.digBlocks.flatMap((b) => b.sections).length, mainSections: plan.mainBlock.sections.length, minRatio: round(Math.min(...themeRatios), 3), below0_7: themeRatios.filter((r) => r < 0.7).length }

    // ── 4) 白黒の範囲（背景の壁の彩度）: ダイジェストだけ白黒。本編・LINE案内は本編どおり ──
    const sat = async (t) => {
      const b = await rgb(t, 'crop=iw*0.3:ih*0.5:iw*0.62:ih*0.18,scale=48:27:flags=area')
      let s = 0
      const n = b.length / 3
      for (let i = 0; i < n; i++) s += (Math.max(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]) - Math.min(b[i * 3], b[i * 3 + 1], b[i * 3 + 2])) / 255
      return s / n
    }
    const digestSat = []
    let acc = 0
    for (const c of plan.clips) { digestSat.push(await sat(round(acc + c.durationSec / 2, 3))); acc += c.durationSec }
    const mainSat = []
    for (let k = 1; k <= 8; k++) mainSat.push(await sat(round(D + ((main.endSec - D) * k) / 9, 3)))
    out.grayscale = { digestWallSatMax: round(Math.max(...digestSat), 4), mainWallSatMin: round(Math.min(...mainSat), 4), digestOnlyGray: Math.max(...digestSat) < 0.02 && Math.min(...mainSat) > 0.02 }

    // ── 5) 映像同期: 出力フレームと元動画の対応フレームの差が、±0（ずれなし）で最小 ──
    const srcFrame = async (t, vf) => (await execFileAsync(ff, ['-v', 'error', '-ss', String(t), '-i', sourceRealPath, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
    const outFrame = async (t, vf) => (await execFileAsync(ff, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
    const region = 'crop=iw*0.34:ih*0.28:iw*0.33:ih*0.36,scale=64:40:flags=area' // 顔の周辺（字幕・テーマ・LINEパネルと重ならない）
    const syncRows = []
    const srcPoints = [30, 120, 240, 360, 480, 600, 700, 800, 900].map((s) => s)
    for (const s of srcPoints) {
      const tOut = s + D
      const diffs = []
      for (const off of [-2, -1, 0, 1, 2]) {
        const a = await outFrame(round(tOut + off / fps, 4), region)
        const b = await srcFrame(round(s, 4), region)
        diffs.push(a.reduce((x, v, i) => x + Math.abs(v - b[i]), 0) / a.length)
      }
      syncRows.push({ srcSec: s, bestOffsetFrames: [-2, -1, 0, 1, 2][diffs.indexOf(Math.min(...diffs))], diffAt0: round(diffs[2], 2) })
    }
    out.videoSync = { points: syncRows.length, allBestOffsetZero: syncRows.every((r) => r.bestOffsetFrames === 0), rows: syncRows }

    // ── 6) 音声: 本編（LINEオーバーレイ中を含む）が元動画と一致・遅れが一定（ずれ・途切れなし）。ダイジェストBGM・末尾の無音 ──
    const pcm = async (file, ss, dur) => {
      const b = (await execFileAsync(ff, ['-v', 'error', '-ss', String(ss), '-t', String(dur), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 28 })).stdout
      const n = Math.floor(b.length / 2)
      const a = new Float64Array(n)
      for (let i = 0; i < n; i++) a[i] = b.readInt16LE(i * 2) / 32768
      return a
    }
    const rmsDb = (a) => { let s = 0; for (const v of a) s += v * v; const r = Math.sqrt(s / Math.max(1, a.length)); return r > 0 ? 20 * Math.log10(r) : -120 }
    const corr = (o, s, maxLag = 480) => {
      let best = { c: -2, lag: 0 }
      const n = Math.min(o.length, s.length) - maxLag * 2
      for (let lag = -maxLag; lag <= maxLag; lag += 2) {
        let sxy = 0, sxx = 0, syy = 0
        for (let i = maxLag; i < maxLag + n; i += 3) { const x = o[i], y = s[i + lag]; sxy += x * y; sxx += x * x; syy += y * y }
        const c = sxy / Math.sqrt(sxx * syy || 1)
        if (c > best.c) best = { c, lag }
      }
      return best
    }
    const audioRows = []
    const audPoints = [{ s: 0.4, label: 'main-start' }, { s: 10, label: 'overlay' }, { s: 27.5, label: 'overlay-end-side' }, { s: 29.2, label: 'overlay-end-after' }, { s: 200 }, { s: 420 }, { s: 610 }, { s: 780 }, { s: 900, label: 'near-end' }]
    for (const p of audPoints) {
      const o = await pcm(video, round(D + p.s, 3), 3)
      const sAudio = await pcm(sourceRealPath, round(p.s, 3), 3)
      const c = corr(o, sAudio)
      audioRows.push({ srcSec: p.s, label: p.label ?? null, corr: round(c.c, 4), lagSamples16k: c.lag, rmsOutDb: round(rmsDb(o), 1), rmsSrcDb: round(rmsDb(sAudio), 1) })
    }
    const lags = audioRows.map((r) => r.lagSamples16k)
    out.audioSync = { rows: audioRows, minCorr: Math.min(...audioRows.map((r) => r.corr)), lagSpreadSamples: Math.max(...lags) - Math.min(...lags), maxRmsDiffDb: round(Math.max(...audioRows.map((r) => Math.abs(r.rmsOutDb - r.rmsSrcDb))), 2) }
    // ダイジェストのBGM: 声のみ・ducking後BGM・最終ミックス（本番と同じフィルタ）と実出力の比較
    const stems = {}
    {
      const o = { outVoice: join(tmp, 'v.wav'), outBgm: join(tmp, 'b.wav'), outMix: join(tmp, 'm.wav') }
      const { args: sa } = buildDigestStemArgs({ cfg: plan.cfg, digestClips: plan.clips, sourcePath: sourceRealPath, bgmPath: assets.bgm.realPath, ...o })
      await execFileAsync(ff, sa, { maxBuffer: 1 << 26 })
      const rd = async (f) => pcm(f, 0, 60)
      const v = await rd(o.outVoice)
      const b = await rd(o.outBgm)
      const m = await rd(o.outMix)
      const win = 1600
      const rows = []
      for (let i = 0; i + win <= v.length; i += win) rows.push({ v: rmsDb(v.subarray(i, i + win)), b: rmsDb(b.subarray(i, i + win)) })
      const vAll = rmsDb(v)
      const speech = rows.filter((r) => r.v > vAll - 3)
      stems.voiceRmsDb = round(vAll, 1)
      stems.bgmAfterDuckingRmsDb = round(rmsDb(b), 1)
      stems.mixRmsDb = round(rmsDb(m), 1)
      stems.voiceMinusBgmDuringSpeechDb = round(speech.reduce((a, r) => a + (r.v - r.b), 0) / Math.max(1, speech.length), 1)
      const oDigest = await pcm(video, 0, D)
      stems.outputDigestRmsDb = round(rmsDb(oDigest), 1)
      stems.outputMinusStemMixDb = round(rmsDb(oDigest) - rmsDb(m.subarray(0, oDigest.length)), 2)
      stems.bgmPresentInDigest = rmsDb(b) > -70 && stems.mixRmsDb >= stems.voiceRmsDb - 0.01
    }
    const fadeTail = await pcm(video, round(D - 2.5, 3), 2.4) // BGMのフェードアウト（2秒）
    const outroA = await pcm(video, round(outro.startSec + 0.3, 3), 11)
    out.bgm = { ...stems, digestTailRmsDb: round(rmsDb(fadeTail), 1), outroRmsDb: round(rmsDb(outroA), 1), outroSilent: rmsDb(outroA) < -60, mainAudioCorrelatesWithSourceSoNoBgmLeak: out.audioSync.minCorr > 0.9 }

    // ── 7) QR: 冒頭overlay（開始直後・中央・終了直前）と末尾（開始直後・中央・最終付近）を 1920/430/390px で読み取り、元画像と比較 ──
    const shots = [
      ['overlay-start', ov.startSec + 0.1], ['overlay-mid', (ov.startSec + ov.endSec) / 2], ['overlay-end', ov.endSec - 0.1],
      ['outro-start', outro.startSec + 0.1], ['outro-mid', (outro.startSec + outro.endSec) / 2], ['outro-last', T.totalSec - 0.1],
    ]
    const qrRows = []
    for (const [name, t] of shots) {
      const full = join(tmp, `qr-${name}.png`)
      await frame(round(t, 3), full)
      const row = { name, atSec: round(t, 2) }
      for (const w of [1920, 430, 390]) {
        const f = w === 1920 ? full : join(tmp, `qr-${name}-${w}.png`)
        if (w !== 1920) await execFileAsync(ff, ['-v', 'error', '-y', '-i', full, '-vf', `scale=${w}:-2:flags=lanczos`, f])
        const r = await decodeQr(f)
        row[`w${w}`] = Boolean(r.decoded && r.sha256 === state.originalQrSha256)
      }
      qrRows.push(row)
    }
    // 境界: 開始の直前（なし）→ 最初のフレーム（あり）、終了フレーム（あり）→ 直後（なし）
    const edge = async (t) => { const f = join(tmp, 'edge.png'); await frame(round(t, 4), f); const r = await decodeQr(f); return Boolean(r.decoded && r.sha256 === state.originalQrSha256) }
    const before = await edge(ov.startSec - 1.5 / fps)
    const first = await edge(ov.startSec + 0.5 / fps)
    const lastIn = await edge(ov.endSec - 1.5 / fps)
    const after = await edge(ov.endSec + 1.5 / fps)
    out.qr = { rows: qrRows, allReadable: qrRows.every((r) => r.w1920 && r.w430 && r.w390), sameLinkAsOriginal: qrRows.every((r) => r.w1920 && r.w430 && r.w390), overlayEdges: { beforeStartHasQr: before, firstFrameHasQr: first, lastFrameHasQr: lastIn, afterEndHasQr: after }, windows: planQrWindows(plan.cfg, T).map((w) => ({ kind: w.kind, startSec: w.startSec, endSec: w.endSec, sec: round(w.endSec - w.startSec, 3) })) }

    // ── 8) 目視用の代表フレーム（git管理外の一時ディレクトリへ。ラベル付き） ──
    if (framesDir) {
      const list = []
      plan.clips.forEach((c, k) => { let a = 0; for (let i = 0; i < k; i++) a += plan.clips[i].durationSec; list.push([`01-digest-clip${k + 1}`, a + c.durationSec / 2]) })
      list.push(['02-digest-end', D - 0.1], ['03-main-start', D + 0.1], ['04-overlay-start', ov.startSec + 0.05], ['05-overlay-5s', ov.startSec + 5.3], ['06-overlay-10s', ov.startSec + 10.3], ['07-overlay-mid', (ov.startSec + ov.endSec) / 2], ['08-overlay-end-before', ov.endSec - 0.1], ['09-overlay-end-after', ov.endSec + 0.1])
      secs.slice(plan.digBlocks.flatMap((b) => b.sections).length).forEach((s, k) => list.push([`10-theme${k + 1}`, s.startSec + 1.0]))
      emph.forEach((x, k) => list.push([`11-emph${String(k + 1).padStart(2, '0')}`, (x.e.startSec + x.e.endSec) / 2]))
      for (const q of [0.25, 0.5, 0.75]) list.push([`12-pct${q * 100}`, T.totalSec * q])
      list.push(['13-main-end', main.endSec - 0.3], ['14-outro-start', outro.startSec + 0.3], ['15-last', T.totalSec - 0.05])
      for (const [n, t] of list) await frame(round(t, 3), join(framesDir, `${n}.png`), 'scale=960:-2:flags=lanczos')
      out.frames = { saved: list.length }
    }
  })
  console.log(JSON.stringify(out, null, 2))
}
