// ローカルAIテロップ動画: 全編（約15分）の完成動画のレンダー前検証・フルレンダー（1回）・レンダー後検証。
// 安全方針は localCaptionFull.mjs と同じ（外部AI不使用・絶対パス/字幕本文/テーマ名/強調語を出力しない・既存ファイルは変更しない）。

import { readFileSync, existsSync, statSync, readdirSync, createReadStream, realpathSync, rmSync, mkdirSync } from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

import { EDITOR_ROOT, FULL_DIR, loadJob, safetyContext, writeJsonAtomic, fullKey } from './localCaptionFull.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { normalizeTopicSectionsContinuous } from '../server/lib/topicSections.mjs'
import { analyzeTopicAssEvents } from '../server/lib/topicAss.mjs'
import { resolveCompositionConfig, validateCompositionConfig, planTimeline, shiftMainCaptions, digestCaptions, mainThemeBlock, digestThemeBlocks, buildFinalAss, buildCompositionArgs, planQrWindows, planQrPlacement, qrLayout } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, renderCompositionToFile, checkFreeSpace, FULL_RENDER_MIN_FREE_BYTES } from '../server/lib/compositionRender.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const MIN_FREE_DURING_RENDER = 10 * 1024 ** 3
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
export const statePath = () => resolve(FULL_DIR, `${fullKey()}.render-state.json`)

const hashFile = (path) => new Promise((res, rej) => {
  const h = createHash('sha256')
  createReadStream(path).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')))
})
const dirSnapshot = (dir) => Object.fromEntries(readdirSync(dir).map((n) => { const s = statSync(join(dir, n)); return [n, `${s.size}:${s.mtimeMs}`] }))
const dirHashes = (dir) => Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => [n, sha256(readFileSync(join(dir, n)))]))

/** 保存済みデータ（caption・テーマ・ダイジェスト）と設定から、最終動画の計画（タイムライン・ASS）を組み立てる。 */
export function buildPlan(job, saved, paths, opts = {}) {
  const caps = saved.capDoc.captions
  // opts.range: 短い試験用に本編の範囲を絞る（{ startSec, endSec }）。opts.overrides: 構成設定の上書き（試験でダイジェスト・LINE案内を外すなど）
  const base = { digest: { ...saved.digest.config, bgm: { path: paths.bgm } }, line: { qrPath: paths.qr } }
  for (const [k, v] of Object.entries(opts.overrides ?? {})) base[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] ? { ...base[k], ...v } : v
  const cfg = resolveCompositionConfig(base)
  const norm = normalizeTopicSectionsContinuous(saved.topics.sections, { startSec: 0, endSec: job.durationSec })
  const clips = saved.digest.clips
  const mainStartSec = opts.range?.startSec ?? 0
  const mainEndSec = opts.range?.endSec ?? job.durationSec
  const timeline = planTimeline(cfg, { mainStartSec, mainEndSec, digestClips: clips })
  const digBlocks = digestThemeBlocks(norm.sections, clips, caps).blocks
  const mainBlock = mainThemeBlock(norm.sections, mainStartSec, mainEndSec, timeline.mainOffsetSec)
  const mainCaps = shiftMainCaptions(caps, mainStartSec, mainEndSec, timeline.mainOffsetSec)
  const digCaps = digestCaptions(caps, clips)
  return { cfg, caps, clips, timeline, norm, digBlocks, mainBlock, mainCaps, digCaps, mainStartSec, mainEndSec, width: job.width, height: job.height, buildAss: (qrSize) => buildFinalAss({ width: job.width, height: job.height, cfg, timeline, mainCaptions: mainCaps, digestCaps: digCaps, themeBlocks: [...digBlocks, mainBlock], qrSize }) }
}

const swiftBin = async (tmp, name) => {
  const bin = join(tmp, name)
  await execFileAsync('swiftc', ['-O', resolve(__dirname, 'tools', `${name}.swift`), '-o', bin], { timeout: 300000 })
  return bin
}
const decodeQr = async (bin, img) => {
  try { return JSON.parse((await execFileAsync(bin, [img])).stdout) } catch (e) { try { return JSON.parse(e.stdout) } catch { return { decoded: false } } }
}

// ────────────────────────────────────────────────────────────────
// render: 事前検証 → 全て通った場合だけフルレンダー（1回）
// ────────────────────────────────────────────────────────────────
export async function stageRender(args, { composeFromSaved }) {
  const t0 = Date.now()
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) })
  if (!args.bgm || !args.qr) throw new Error('--bgm と --qr を指定してください')
  const ctx = safetyContext(job)
  const { sourceRealPath, outputRoot, inputRoots } = ctx
  const outputReal = realpathSync(outputRoot)
  const srcDirReal = realpathSync(dirname(sourceRealPath))
  const free = await checkFreeSpace(outputRoot, FULL_RENDER_MIN_FREE_BYTES)
  check('空き容量15GB以上', free.ok, { freeGB: round(free.freeBytes / 1024 ** 3, 1) })
  check('出力先が元動画のあるディレクトリと異なる', outputReal !== srcDirReal)
  check('元動画が読み取り可能', statSync(sourceRealPath).size === job.sourceSize)

  const saved = composeFromSaved(job)
  const canonical = job.captions.slice().sort((a, b) => a.displayOrder - b.displayOrder).map((c) => c.text).join('')
  check('caption正本と一致（連結のSHA-256）', sha256(saved.capDoc.captions.map((c) => c.text).join('')) === sha256(canonical) && saved.capDoc.canonicalSha256 === sha256(canonical))
  check('align検証が成功している', saved.pages.ok === true && saved.pages.problems.length === 0)
  check('テーマはすべて manual', saved.topics.sections.every((s) => s.source === 'manual'))

  const plan = buildPlan(job, saved, { bgm: args.bgm, qr: args.qr })
  const v = validateCompositionConfig(plan.cfg)
  check('構成設定が妥当', v.ok, v.errors)
  const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
  check('BGMが読み取り可能', assets.bgm?.ok === true, assets.errors.length ? '素材エラー' : undefined)
  check('QRが読み取り可能', assets.qr?.ok === true)
  check('QR画像が想定寸法(554x518)', assets.qr?.width === 554 && assets.qr?.height === 518, { width: assets.qr?.width, height: assets.qr?.height })

  // タイムライン
  const T = plan.timeline
  const main = T.sections.find((s) => s.kind === 'main')
  const outro = T.sections.find((s) => s.kind === 'lineOutro')
  const digestSec = T.digestSec
  const ov = T.overlays[0]
  check('ダイジェストが25〜30秒・4〜6クリップ', digestSec >= 25 && digestSec <= 30 && plan.clips.length >= 4 && plan.clips.length <= 6, { digestSec: round(digestSec, 3), clips: plan.clips.length })
  check('本編が元動画全体の長さ', Math.abs((main.endSec - main.startSec) - job.durationSec) < 1e-3)
  check('冒頭LINEオーバーレイが本編の最初の30秒だけ', !!ov && ov.startSec === main.startSec && Math.abs(ov.endSec - ov.startSec - 30) < 1e-6 && ov.endSec <= main.endSec)
  check('末尾LINE案内が12秒・本編の直後', Math.abs(outro.endSec - outro.startSec - 12) < 1e-6 && outro.startSec === main.endSec)
  check('最終durationがダイジェスト+本編+12秒（冒頭30秒を加算しない）', Math.abs(T.totalSec - (digestSec + job.durationSec + 12)) < 2e-3, { totalSec: T.totalSec })
  check('本編オフセットがダイジェストの長さだけ', Math.abs(T.mainOffsetSec - digestSec) < 1e-6)
  const qw = planQrWindows(plan.cfg, T)
  check('QR表示区間が冒頭overlayと末尾に一致', qw.length === 2 && qw[0].startSec === ov.startSec && qw[0].endSec === ov.endSec && qw[1].startSec === outro.startSec && qw[1].endSec === outro.endSec)

  // ダイジェスト各区間が有効（元動画の範囲内・時系列・重複なし）
  const okClips = plan.clips.every((c, i) => c.srcStartSec >= 0 && c.srcStartSec + c.durationSec <= job.durationSec && c.durationSec >= 4 && c.durationSec <= 8.5 && (i === 0 || c.srcStartSec >= plan.clips[i - 1].srcStartSec + plan.clips[i - 1].durationSec))
  check('ダイジェストの全区間が有効（範囲内・時系列・重複なし）', okClips)

  // ffmpegグラフ: BGMフィルタがダイジェスト内だけ・QR/overlay
  const built = buildCompositionArgs({ cfg: plan.cfg, timeline: T, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: job.durationSec, digestClips: plan.clips, bgmPath: assets.bgm?.realPath, qrPath: assets.qr?.realPath, qrSize: { width: assets.qr?.width, height: assets.qr?.height }, assPath: '/tmp/x.ass', outputPath: '/tmp/x.mp4' })
  const chains = built.filterComplex.split(';')
  const bgmChains = chains.filter((c) => c.includes('[bgm]') || c.includes('[bgmd]') || c.includes('sidechaincompress'))
  check('BGMフィルタがダイジェスト内だけ（本編・LINE案内のチェーンに入らない）', built.args.filter((a) => a === assets.bgm?.realPath).length === 1 && bgmChains.every((c) => !c.includes('[ma]') && !c.includes('[mv]') && !c.includes('[lov]') && !c.includes('[loa]')) && built.filterComplex.includes(`atrim=0:${round(digestSec, 3)}`) && built.filterComplex.includes('[dvid][dA][mv][ma][lov][loa]concat=n=3'))
  check('LINEオーバーレイが本編最初の30秒だけ・QRは不透明（フィルタ）', !/fade|colorchannelmixer|geq|gblur|boxblur|hue=/.test(chains.filter((c) => c.startsWith('[qs')).join(';')) && chains.some((c) => c.includes(`between(t,${ov.startSec},${ov.endSec})`)))

  // ASS: テーマ常時表示（ダイジェスト・本編）
  const assText = plan.buildAss({ width: assets.qr?.width, height: assets.qr?.height })
  const an = (a, b) => analyzeTopicAssEvents(assText, { startSec: a, endSec: b })
  const aD = an(0, digestSec)
  const aAll = an(0, main.endSec)
  check('ダイジェストのテーマ被覆100%（空白・重複0）', aD.title.gapSec === 0 && aD.title.overlapSec === 0 && aD.background.gapSec === 0 && aD.label.gapSec === 0)
  check('ダイジェスト+本編のテーマ被覆100%（背景・縦ライン・ラベル・タイトルの空白・重複0）', [aAll.title, aAll.background, aAll.accentBar, aAll.label].every((x) => x.gapSec === 0 && x.overlapSec === 0) && aAll.boundaries.every((b) => b.exact))
  const themeNorm = plan.norm.stats
  check('テーマのカバー率100%・空白0・重複0', themeNorm.afterCoverage === 1 && themeNorm.undisplayedSec === 0 && themeNorm.overlapSec === 0)

  // 出力名（汎用名）
  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const prefix = String(args.outPrefix || 'video_captioned_complete').replace(/[^a-zA-Z0-9_-]/g, '')
  const outName = `${prefix}_${stamp}.mp4`
  const finalPath = join(outputRoot, outName)
  check('出力ファイルが未存在（上書きしない）', !existsSync(finalPath))
  check('出力名に元動画名・絶対パスを含まない', !outName.includes(job.sourceFilename.replace(/\.[^.]+$/, '')) && !outName.includes('/'))

  // QR: 元画像とカード（レンダーと同じフィルタ）のリンクが一致
  let qrOk = false
  let originalSha = null
  await withTempDir('lcv-full-pre-', async (tmp) => {
    const bin = await swiftBin(tmp, 'qrDecode')
    const orig = await decodeQr(bin, assets.qr.realPath)
    originalSha = orig.sha256 ?? null
    const q = planQrPlacement({ mode: 'overlay' }, job.width, job.height, { width: 554, height: 518 }, plan.cfg)
    const card = join(tmp, 'card.png')
    await execFileAsync(process.env.FFMPEG_BIN, ['-v', 'error', '-y', '-i', assets.qr.realPath, '-vf', `scale=${q.innerW}:${q.innerH}:flags=bicubic,pad=${q.innerW + q.quiet * 2}:${q.innerH + q.quiet * 2}:${q.quiet}:${q.quiet}:color=white,pad=${q.totalW}:${q.totalH}:${q.frame}:${q.frame}:color=0x8a968f,format=yuv420p`, '-frames:v', '1', card])
    const c = await decodeQr(bin, card)
    qrOk = Boolean(orig.decoded && c.decoded && orig.sha256 === c.sha256)
  })
  check('QRが読み取れ、リンクが元画像と一致（冒頭カード）', qrOk)

  // 元動画のハッシュ（フル）と既存データ・既存出力のスナップショット（レンダー前）
  const srcHashBefore = await hashFile(sourceRealPath)
  const srcStatBefore = statSync(sourceRealPath)
  const five = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/five_minute')
  const before = { srcHash: srcHashBefore, srcSize: srcStatBefore.size, srcMtimeMs: srcStatBefore.mtimeMs, jobSha: sha256(bytes), fiveMinute: dirHashes(five), outputDir: dirSnapshot(outputRoot), freeBytes: await getFreeBytes(outputRoot) }

  const failed = checks.filter((c) => !c.ok)
  console.log(JSON.stringify({ stage: 'render-precheck', ok: failed.length === 0, failed: failed.map((c) => c.name), checks, plan: { digestSec: round(digestSec, 3), mainStartSec: main.startSec, mainEndSec: round(main.endSec, 3), overlay: ov, outro, totalSec: T.totalSec, clips: plan.clips.length, captions: plan.caps.length, themes: plan.norm.sections.length }, output: { name: outName }, elapsedMs: Date.now() - t0 }, null, 2))
  if (failed.length) {
    process.exitCode = 2
    return
  }
  if (args.dryRun) return // 事前検証だけ

  // ── フルレンダー（1回だけ。自動再試行しない） ──
  if (existsSync(statePath())) throw new Error('同じバージョンのレンダー状態が既にあります（上書きしません。別の --key を指定してください）')
  writeJsonAtomic(statePath(), { createdAt: new Date().toISOString(), outputName: outName, originalQrSha256: originalSha, before })
  let child = null
  let aborted = null
  const monitor = setInterval(async () => {
    try {
      const f = await getFreeBytes(outputRoot)
      if (f < MIN_FREE_DURING_RENDER && child && !aborted) {
        aborted = `空き容量が10GBを下回りそうなため、安全に停止しました（空き ${round(f / 1024 ** 3, 1)}GB）`
        child.kill('SIGTERM')
      }
    } catch { /* 監視の一時的な失敗では止めない */ }
  }, 10000)
  let minFree = Infinity
  const sampler = setInterval(async () => { try { minFree = Math.min(minFree, await getFreeBytes(outputRoot)) } catch { /* noop */ } }, 5000)
  const tr0 = Date.now()
  let error = null
  try {
    await withTempDir('lcv-full-render-', async (tmpDir) => {
      await renderCompositionToFile({
        cfg: plan.cfg, timeline: T, width: job.width, height: job.height, sourcePath: sourceRealPath, mainStartSec: 0, mainEndSec: job.durationSec,
        digestClips: plan.clips, bgmPath: assets.bgm.realPath, qrPath: assets.qr.realPath, qrSize: { width: assets.qr.width, height: assets.qr.height }, assText, tmpDir, finalPath,
        spawnFn: (bin, argv, opts) => { child = spawn(bin, argv, opts); return child },
      })
    })
  } catch (e) {
    error = aborted ?? e.message
  } finally {
    clearInterval(monitor)
    clearInterval(sampler)
  }
  const elapsedMs = Date.now() - tr0
  const leftover = readdirSync(outputRoot).filter((n) => n.startsWith('.rendering-composition-'))
  console.log(JSON.stringify({
    stage: 'render',
    ok: !error,
    error,
    renderCount: 1,
    elapsedMs,
    output: !error ? { name: outName, sizeBytes: statSync(finalPath).size } : null,
    tempOutputLeftover: leftover.length,
    minFreeGBDuringRender: round(minFree / 1024 ** 3, 1),
    freeGBAfter: round((await getFreeBytes(outputRoot)) / 1024 ** 3, 1),
    canonUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))),
    externalAiApiCalled: false,
  }, null, 2))
  if (error) process.exitCode = 3
}

// ────────────────────────────────────────────────────────────────
// check: レンダー後の機械検証（動画は生成しない・外部AI不使用）
// ────────────────────────────────────────────────────────────────
export async function stageCheck(args, { composeFromSaved }) {
  const { job } = loadJob(args.job)
  const state = JSON.parse(readFileSync(statePath(), 'utf-8'))
  const { sourceRealPath, outputRoot, inputRoots } = safetyContext(job)
  const video = join(outputRoot, state.outputName)
  if (!existsSync(video)) throw new Error('完成動画が見つかりません')
  const saved = composeFromSaved(job)
  const plan = buildPlan(job, saved, { bgm: args.bgm, qr: args.qr })
  const assets = await resolveCompositionAssets(plan.cfg, inputRoots)
  const assText = plan.buildAss({ width: assets.qr.width, height: assets.qr.height })
  const T = plan.timeline
  const fps = plan.cfg.fps
  const out = { stage: 'check' }
  const ff = process.env.FFMPEG_BIN
  const fp = process.env.FFPROBE_BIN
  const rawOut = async (a) => (await execFileAsync(ff, ['-v', 'error', ...a], { encoding: 'buffer', maxBuffer: 1 << 30 })).stdout

  // 基本情報
  const probe = JSON.parse((await execFileAsync(fp, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', video])).stdout)
  const vs = probe.streams.find((s) => s.codec_type === 'video')
  const as = probe.streams.find((s) => s.codec_type === 'audio')
  const cnt = JSON.parse((await execFileAsync(fp, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', video], { maxBuffer: 1 << 26 })).stdout)
  out.basic = { containerDurationSec: round(Number(probe.format.duration)), videoDurationSec: round(Number(vs.duration)), audioDurationSec: round(Number(as.duration)), width: vs.width, height: vs.height, frames: Number(cnt.streams[0].nb_read_frames), expectedFramesApprox: Math.round(T.totalSec * fps), sizeBytes: statSync(video).size, audioCodec: as.codec_name, sampleRate: Number(as.sample_rate), channels: as.channels, expectedTotalSec: T.totalSec, avDiffSec: round(Math.abs(Number(vs.duration) - Number(as.duration))) }
  // 全体デコード（エラーなし）
  let decodeOk = true
  try { await execFileAsync(ff, ['-v', 'error', '-i', video, '-f', 'null', '-'], { maxBuffer: 1 << 26 }) } catch { decodeOk = false }
  const decodeAt = async (t) => { try { return (await rawOut(['-ss', String(t), '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-vf', 'scale=16:9', 'pipe:1'])).length === 144 } catch { return false } }
  out.decode = { fullDecodeNoErrors: decodeOk, first: await decodeAt(0), middle: await decodeAt(T.totalSec / 2), last: await decodeAt(T.totalSec - 0.1) }

  // テーマの表示（フレームごと。焼き込まれた映像の縦ラインを画素で確認）と、ASS上の重複
  const bar = { x: 96, y: 80, w: 12, h: 120 }
  const barBuf = await rawOut(['-i', video, '-an', '-vf', `crop=${bar.w}:${bar.h}:${bar.x}:${bar.y},scale=1:1:flags=area,format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  const nFrames = Math.floor(barBuf.length / 3)
  const isAmber = (i) => Math.abs(barBuf[i * 3] - 0xf0) < 32 && Math.abs(barBuf[i * 3 + 1] - 0xb3) < 32 && Math.abs(barBuf[i * 3 + 2] - 0x4a) < 44
  const themeEnd = T.sections.find((s) => s.kind === 'main').endSec
  let missing = 0
  let unexpected = 0
  for (let i = 0; i < nFrames; i++) {
    const t = i / fps
    const expected = t < themeEnd - 1e-3
    const present = isAmber(i)
    if (expected && !present) missing += 1
    if (!expected && present) unexpected += 1
  }
  // ASS: 各フレーム時刻でアクティブなテーマタイトルの数（未表示0・重複0）
  const titleIv = []
  for (const line of assText.split('\n')) {
    const m = /^Dialogue: \d+,(\d+):(\d\d):(\d\d)\.(\d\d),(\d+):(\d\d):(\d\d)\.(\d\d),TopicTitle,/.exec(line)
    if (m) titleIv.push([+m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100, +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 100])
  }
  let noTitle = 0
  let multiTitle = 0
  for (let i = 0; i < Math.floor(themeEnd * fps); i++) {
    const t = (i + 0.5) / fps
    const n = titleIv.filter(([a, b]) => t >= a && t < b).length
    if (n === 0) noTitle += 1
    if (n > 1) multiTitle += 1
  }
  out.theme = { framesAnalyzed: nFrames, expectedFrames: Math.floor(themeEnd * fps), pixelMissingFrames: missing, pixelUnexpectedFramesInOutro: unexpected, assFramesWithoutTitle: noTitle, assFramesWithMultipleTitles: multiTitle, titleEvents: titleIv.length }

  // 元動画の不変性（レンダー後）
  const srcStat = statSync(sourceRealPath)
  const srcHashAfter = await hashFile(sourceRealPath)
  const five = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/five_minute')
  const outAfter = dirSnapshot(outputRoot)
  const changedOutputs = Object.entries(state.before.outputDir).filter(([n, v]) => outAfter[n] !== v).map(([n]) => n)
  out.invariance = {
    sourceSizeSame: srcStat.size === state.before.srcSize,
    sourceMtimeSame: srcStat.mtimeMs === state.before.srcMtimeMs,
    sourceSha256Same: srcHashAfter === state.before.srcHash,
    jobJsonSame: sha256(readFileSync(loadJob(args.job).file)) === state.before.jobSha,
    fiveMinuteDataSame: JSON.stringify(dirHashes(five)) === JSON.stringify(state.before.fiveMinute),
    existingOutputsChanged: changedOutputs.length,
    newOutputs: Object.keys(outAfter).filter((n) => !(n in state.before.outputDir)),
  }
  out.originalQrSha256 = state.originalQrSha256
  console.log(JSON.stringify(out, null, 2))
}
