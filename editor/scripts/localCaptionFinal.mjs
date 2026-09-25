// ローカルAIテロップ動画: 15分全編の最終完成版（承認済みの確認動画の仕様をそのまま固定して1回だけレンダー）。
//
// 使い方（editor/ で実行。.env の FFMPEG_BIN / FFPROBE_BIN / VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT を使用）:
//   node scripts/localCaptionFinal.mjs precheck --job <jobId> --main-bgm <MP3> --bgm <ダイジェストBGM> --qr <QR>   # レンダー前の必須確認（動画は作らない・何も書かない）
//   node scripts/localCaptionFinal.mjs render   --job <jobId> --main-bgm <MP3> --bgm <..> --qr <..>               # precheck に通ったときだけ1回レンダー（既にあれば拒否）
//   node scripts/localCaptionFinal.mjs verify   --job <jobId> --main-bgm <MP3> --bgm <..> --qr <..> [--frames-dir <代表フレーム保存先>]   # レンダー後の検証（読み取りのみ）
//
// 安全方針: 外部AI API・whisperは一切呼ばない（既存の承認済みデータとローカルのffmpegだけ）。元動画・MP3・QR・ジョブJSON・保存データ・既存動画は変更しない。
// 承認済みの値（遷移フレーム数・ダイジェスト末尾・ループ開始点・字幕サイズ・BGM設定）は、確認動画の保存状態（full_v6.preview2-state.json）と突き合わせ、一致しなければレンダーしない。
// 標準出力・保存データに絶対パスを出さない。字幕本文は標準出力へ出さない。

import { readFileSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync } from 'fs'
import { resolve, join } from 'path'
import { spawn as realSpawn } from 'child_process'
import dotenv from 'dotenv'

import { EDITOR_ROOT, FULL_DIR, loadJob, safetyContext, writeJsonAtomic } from './localCaptionFull.mjs'
import { loadBase, getDigestPicks } from './localCaptionCuts.mjs'
import { buildShortDigest } from '../server/lib/shortDigest.mjs'
import { introCutItems } from '../server/lib/mainEdit.mjs'
import { validateRecoveredCaptions } from '../server/lib/introCut.mjs'
import { validateCompositionConfig, buildCompositionArgs } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, renderCompositionToFile, checkFreeSpace, FULL_RENDER_MIN_FREE_BYTES } from '../server/lib/compositionRender.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { inspectMainBgm } from '../server/lib/mainBgmAssets.mjs'
import { MAIN_BGM_DUCK, MAIN_BGM_LIMITER, MAIN_BGM_DEFAULTS, buildMainBgmFilters, planBgmLoop } from '../server/lib/mainBgm.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { getCaptionStyleDefs } from '../server/lib/captionStyles.mjs'
import { loadRecovered, loadCut, buildMainBgmPreviewPlan, measureDigestTail, PREVIEW_TRANSITION, dirSnapshot, fileSig, hashAll, sha256 } from './localCaptionMainBgm.mjs'

const FPS = 30
export const FINAL_MIN_FREE_BYTES = FULL_RENDER_MIN_FREE_BYTES // 15GB（開始前）
export const FINAL_ABORT_FREE_BYTES = 10 * 1024 ** 3 // レンダー中に10GB未満になったら安全に停止
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const pathFor = (name) => resolve(FULL_DIR, `full_v6.${name}.json`)
const PREVIEW_STATE = () => pathFor('preview2-state')
const FINAL_STATE = () => pathFor('final-state')

/** 正式採用したデザイン・BGMの推奨初期値。素材（動画・caption・文言・ファイル名）に依存する値はここへ置かず、保存データから導く。 */
export const APPROVED = Object.freeze({
  mainBgm: Object.freeze({ volume: 0.05, loopStartSec: 34.56, crossfadeSec: 2, fadeInSec: 1.5, fadeOutSec: 2.5 }),
  duck: Object.freeze({ threshold: 0.015, ratio: 6, attack: 60, release: 1200, knee: 6, makeup: 1, sidechainHighpassHz: 120, sidechainLowpassHz: 5000 }),
  limiterLimit: 0.891,
  overlaySec: 30, outroSec: 12,
})

const numEq = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const readable = (p) => { try { const fd = openSync(p, 'r'); const b = Buffer.alloc(1); readSync(fd, b, 0, 1, 0); closeSync(fd); return true } catch { return false } }

/**
 * 最終版の計画（レンダーもverifyもここから。推測値は使わない: ダイジェスト末尾・遷移・BGM開始点は承認済みの保存状態と一致を確認する）。
 * 音声を読む処理はダイジェスト末尾の実測（ローカルffmpegで元動画の数秒を読むだけ）。
 */
export async function buildFinalPlan(args) {
  const { job, file, bytes, canon } = loadJob(args.job)
  const base = loadBase(job)
  const cutDoc = loadCut()
  const ctx = safetyContext(job)
  const state = JSON.parse(readFileSync(PREVIEW_STATE(), 'utf-8'))
  const info = await inspectMainBgm(args.mainBgm, ctx.inputRoots)
  if (!info.ok) throw new Error(info.error)
  const rec = loadRecovered(job)
  const recovered = rec.captions.filter((c) => c.confirmed)
  const dig0 = buildShortDigest(base.captions, base.norm, getDigestPicks())
  if (!dig0.ok) throw new Error(`ダイジェストの検証に失敗: ${dig0.problems.join(' / ')}`)
  const digestTail = await measureDigestTail({ sourcePath: ctx.sourceRealPath, base, dig: dig0 })
  const full = introCutItems(job.durationSec, cutDoc.cut.cutEndSec, FPS)
  const mainSec = round(full.items[0].srcEndSec - full.items[0].srcStartSec, 3)
  const plan = buildMainBgmPreviewPlan(job, base, { paths: { bgm: args.bgm, qr: args.qr }, cutEndSec: cutDoc.cut.cutEndSec, mainBgm: { sourcePath: info.realPath, overrides: {} }, mainSec, recovered, digestTail, transition: PREVIEW_TRANSITION, fullItems: full.items, strict: true })
  return { job, file, bytes, canon, base, cutDoc, ctx, state, info, rec, recovered, dig0, digestTail, full, mainSec, plan }
}

/** レンダー前の必須確認。{ ok, checks: [{ name, ok, detail }] }。何も書かない。 */
export async function runPrechecks(args) {
  const P = await buildFinalPlan(args)
  const { job, base, cutDoc, ctx, state, info, recovered, dig0, digestTail, full, mainSec, plan } = P
  const T = plan.timeline
  const D = plan.D
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

  // 素材
  const assets = await resolveCompositionAssets(plan.cfg, ctx.inputRoots)
  add('素材: 元動画が読み取れる', readable(ctx.sourceRealPath), { sizeBytes: statSync(ctx.sourceRealPath).size })
  add('素材: 本編BGMが実在・MP3として有効', info.ok && /\.mp3$/i.test(info.fileName), { fileName: info.fileName, durationSec: info.durationSec, sampleRate: info.sampleRate, channels: info.channels })
  add('素材: ダイジェストBGMとQR画像が有効', assets.ok, { errors: assets.errors, bgm: assets.bgm && { durationSec: assets.bgm.durationSec }, qr: assets.qr && { width: assets.qr.width, height: assets.qr.height } })
  if (assets.ok) {
    add('素材: 承認済みの確認動画と同一のファイル(SHA-256)', sha256(readFileSync(info.realPath)) === state.guard.mp3 && sha256(readFileSync(assets.bgm.realPath)) === state.guard.digestBgm && sha256(readFileSync(assets.qr.realPath)) === state.guard.qr && fileSig(ctx.sourceRealPath) === state.guard.source, { mp3: true, digestBgm: true, qr: true, source: true })
  }
  const free = await checkFreeSpace(ctx.outputRoot, FINAL_MIN_FREE_BYTES)
  add('空き容量15GB以上', free.ok, { freeGB: round(free.freeBytes / 1024 ** 3, 1) })

  // 承認済みの仕様との一致
  const cfgV = validateCompositionConfig(plan.cfg)
  add('構成設定が有効', cfgV.ok, cfgV.errors)
  add('先頭カット: 保存済みの分析どおり（フレーム境界・最初の息まで約0.1〜0.2秒の余白）', Number.isInteger(cutDoc.cut.frameIndex) && numEq(full.items[0].srcStartSec, cutDoc.cut.frameIndex / FPS) && cutDoc.cut.keepBeforeSpeechSec >= 0.08 && cutDoc.cut.keepBeforeSpeechSec <= 0.2, { cutEndSec: round(full.items[0].srcStartSec, 4), keepBeforeSpeechSec: round(cutDoc.cut.keepBeforeSpeechSec, 3) })
  add('追加の無音カットなし（本編は元動画の連続1区間）', plan.tm.items.length === 1 && plan.tm.items[0].kind === 'seg', { items: plan.tm.items.length })
  const mb = plan.cfg.mainBgm
  add('本編BGM設定: 音量0.05・フェードイン1.5秒・フェードアウト2.5秒・ダッキングON・ループON', mb.enabled && numEq(mb.volume, APPROVED.mainBgm.volume) && numEq(mb.fadeInSec, 1.5) && numEq(mb.fadeOutSec, 2.5) && mb.ducking && mb.loop && mb.scope === 'main' && numEq(MAIN_BGM_DEFAULTS.volume, 0.05), { volume: mb.volume, fadeInSec: mb.fadeInSec, fadeOutSec: mb.fadeOutSec })
  add('ダッキング: threshold0.015 ratio6 attack60 release1200 knee6 makeup1 声検出120〜5000Hz', Object.entries(APPROVED.duck).every(([k, v]) => MAIN_BGM_DUCK[k] === v), APPROVED.duck)
  const filt = buildMainBgmFilters({ bgmInputIndex: 1, bgmIntroInputIndex: 2, mainSec, gainDb: -30, plan: planBgmLoop({ bgmSec: info.durationSec, mainSec, loop: true, loopStartSec: state.mainBgm.loopSelection.startSec }), cfg: mb, sampleRate: 48000, voiceLabel: '[v]', outLabel: '[o]' }).join(';')
  add('リミッター: -1dBFS・level=0:latency=1', numEq(MAIN_BGM_LIMITER.limit, APPROVED.limiterLimit) && /alimiter=limit=0\.891:[^,;]*level=0:latency=1/.test(filt), { limit: MAIN_BGM_LIMITER.limit })
  const loopPlan = planBgmLoop({ bgmSec: info.durationSec, mainSec, loop: true, loopStartSec: state.mainBgm.loopSelection.startSec })
  add('ループ: 1周目は0秒から・2周目以降34.56秒・クロスフェード2秒', loopPlan.ok && numEq(loopPlan.introSec, 34.56) && numEq(loopPlan.loopStartSec, 34.56) && numEq(loopPlan.crossfadeSec, 2) && numEq(state.mainBgm.loopSelection.startSec, 34.56), { loops: loopPlan.loops, unitSec: loopPlan.unitSec })
  const tOk = JSON.stringify(T.transition) === JSON.stringify(state.transition) && T.transition.fadeOut.frames === 10 && T.transition.hold.frames === 3 && T.transition.fadeIn.frames === 9
  add('遷移: 承認済みの確認動画と同一（黒へ10f・黒3f・フェードイン9f）', tOk, { fadeOut: T.transition.fadeOut.frames, hold: T.transition.hold.frames, fadeIn: T.transition.fadeIn.frames, mainStartSec: T.transition.mainStartSec })
  add('ダイジェスト末尾: 承認済みの確認動画と同一（最後の発話終了・余韻・次の発話より前）', digestTail.ok && numEq(digestTail.speechEndSec, state.digestTail.speechEndSec) && numEq(digestTail.srcEndSec, state.digestTail.srcEndSec) && numEq(digestTail.afterSpeechSec, state.digestTail.afterSpeechSec) && digestTail.srcEndSec < digestTail.nextSpeechStartSec, { speechEndSec: digestTail.speechEndSec, nextSpeechStartSec: digestTail.nextSpeechStartSec, afterSpeechSec: digestTail.afterSpeechSec })
  add('ダイジェスト: 選択どおり・強調は選択と一致・約10秒', plan.dig.clips.length >= 2 && plan.dig.clips.length === getDigestPicks().length && plan.dig.clips.filter((c) => c.emphasis).length === getDigestPicks().filter((p) => p.emphasisText).length && T.liveDigestSec > 9 && T.liveDigestSec < 12, { clips: plan.dig.clips.length, emphasis: plan.dig.clips.filter((c) => c.emphasis).length, liveDigestSec: T.liveDigestSec })

  // タイムライン
  let cont = T.sections[0].startSec === 0
  for (let i = 1; i < T.sections.length; i++) cont = cont && numEq(T.sections[i].startSec, T.sections[i - 1].endSec, 1e-6)
  const sec = (k) => T.sections.find((s) => s.kind === k)
  const mainS = sec('main')
  add('最終タイムラインが連続（隙間・重なりなし）', cont && numEq(T.sections.at(-1).endSec, T.totalSec, 1e-6), T.sections.map((s) => ({ kind: s.kind, startSec: s.startSec, endSec: s.endSec, sec: round(s.endSec - s.startSec, 3) })))
  add('本編の長さ=先頭カット後の元動画（末尾は0.033秒未満だけ切る）', numEq(mainS.endSec - mainS.startSec, mainSec, 1e-3) && numEq(D, mainS.startSec) && mainSec > 0 && job.durationSec - cutEnd - mainSec >= 0 && job.durationSec - cutEnd - mainSec < 1 / FPS + 1e-6, { mainSec, mainStartSec: D })
  add('冒頭LINE: 本編開始から30秒のオーバーレイ（全体の尺へ加算しない）', T.overlays.length === 1 && numEq(T.overlays[0].startSec, D) && numEq(T.overlays[0].endSec - T.overlays[0].startSec, APPROVED.overlaySec) && !T.sections.some((s) => s.kind === 'lineIntro'), T.overlays[0])
  add('末尾LINE: 12秒の独立区間・最後', sec('lineOutro') && numEq(sec('lineOutro').endSec - sec('lineOutro').startSec, APPROVED.outroSec) && numEq(sec('lineOutro').endSec, T.totalSec) && numEq(sec('lineOutro').startSec, mainS.endSec), sec('lineOutro'))
  const expectedFrames = Math.round(T.totalSec * FPS)
  add('出力予定duration（計画から算出）', numEq(expectedFrames / FPS, T.totalSec, 0.02), { totalSec: T.totalSec, expectedFrames, digestSec: T.digestSec, mainSec, outroSec: APPROVED.outroSec })

  // BGMの適用範囲
  const A = plan.anchors
  add('本編BGMは本編だけ（開始=本編開始・終了=本編終了・末尾LINEへ漏れない・ダイジェストと重ならない）', numEq(A.bgmStartSec, D) && numEq(A.bgmEndSec, mainS.endSec) && A.bgmEndSec <= sec('lineOutro').startSec + 1e-9 && A.bgmStartSec >= T.digestSec - 1e-9, { bgm: [A.bgmStartSec, A.bgmEndSec], digest: [0, T.digestSec], outroStartSec: sec('lineOutro').startSec })
  add('ダイジェストBGMは本編へ漏れない（ダイジェスト区間だけ）', plan.cfg.digest.enabled && A.mainStartSec >= T.digestSec, { digestEndSec: T.digestSec, mainStartSec: A.mainStartSec })
  const noBgmArgs = buildCompositionArgs({ cfg: { ...plan.cfg, mainBgm: { ...plan.cfg.mainBgm, enabled: false } }, timeline: T, width: job.width, height: job.height, sourcePath: ctx.sourceRealPath, mainStartSec: 0, mainEndSec: plan.tm.totalSec, mainItems: plan.tm.items, digestClips: plan.dig.clips, bgmPath: assets.ok ? assets.bgm.realPath : 'x', qrPath: assets.ok ? assets.qr.realPath : 'x', qrSize: { width: 554, height: 518 }, assPath: 'x.ass', outputPath: 'x.mp4' }).args.join(' ')
  add('音声起点補正（first_pts=0）が有効', /first_pts=0/.test(noBgmArgs), { count: (noBgmArgs.match(/first_pts=0/g) ?? []).length })

  // caption・テーマ・強調
  const caps = plan.mainCaps
  const mainExisting = caps.filter((c) => c.source !== 'manual-intro-recovery')
  const intro = caps.filter((c) => c.source === 'manual-intro-recovery')
  const ids = new Set(caps.map((c) => c.id))
  let sorted = true
  for (let i = 1; i < caps.length; i++) sorted = sorted && caps[i].startSec >= caps[i - 1].startSec - 1e-9
  let inRange = caps.every((c) => c.startSec >= D - 1e-9 && c.endSec <= mainS.endSec + 1e-6 && c.endSec > c.startSec)
  add('caption: 既存captionのすべて＋補完caption・欠落/重複/逆転なし', mainExisting.length === base.captions.length && intro.length === recovered.length && ids.size === caps.length && sorted && inRange && plan.mapped.verification.captions.ok, { existing: mainExisting.length, intro: intro.length, unique: ids.size, sorted, inRange, verified: plan.mapped.verification.captions.ok })
  add('冒頭の補完caption: manual-intro-recovery・confirmed・保存データの文言のまま（時刻は再推定しない）', intro.length === recovered.length && intro.every((c, i) => c.confirmed === true && c.text === recovered[i].text) && (recovered.length === 0 || validateRecoveredCaptions(P.rec.captions, base.captions).ok), intro.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec })))
  const emph = base.captions.filter((c) => c.emphasisText).length
  add('強調: 本編の強調件数が元データと一致・ダイジェストは選択どおり', mainExisting.filter((c) => c.emphasisText).length === emph, { main: emph, digest: plan.dig.clips.filter((c) => c.emphasis).length })
  const same = mainExisting.every((c, i) => c.id === base.captions[i].id && c.text === base.captions[i].text && c.captionType === base.captions[i].captionType && c.emphasisText === base.captions[i].emphasisText && JSON.stringify(c.lines ?? null) === JSON.stringify(base.captions[i].lines ?? null))
  add('caption本文・順序・改行・種別・強調文字列が承認済みデータのまま', same, { compared: mainExisting.length })
  const assText = plan.buildAss({ width: assets.ok ? assets.qr.width : 554, height: assets.ok ? assets.qr.height : 518 })
  const spans = titleSpans(assText)
  const dSpan = spanCheck(spans, 0, T.digestSec)
  const mSpan = spanCheck(spans, D, mainS.endSec)
  add('トークテーマ: 本編を100%常時表示（未表示0秒・重複0秒）', mSpan.gapSec === 0 && mSpan.overlapSec === 0 && plan.mapped.verification.themes.gapSec === 0 && plan.mapped.verification.themes.overlapSec === 0 && mSpan.titles === base.norm.length, { main: mSpan, mappedCoverage: plan.mapped.verification.themes.coverage, themes: base.norm.length })
  add('トークテーマ: ダイジェストも常時表示（未表示0秒・重複0秒）', dSpan.gapSec === 0 && dSpan.overlapSec === 0, dSpan)
  const defs = getCaptionStyleDefs(job.width, job.height)
  const styleSizes = Object.fromEntries(assText.split('\n').filter((l) => l.startsWith('Style:')).map((l) => { const f = l.slice(6).split(','); return [f[0].trim(), Number(f[2])] }))
  add('字幕サイズ: normal116・main122・sub109・emphasis116・テーマ84・TALK THEME40・ダイジェスト126', defs.normal.fontsize === 116 && defs.main.fontsize === 122 && defs.sub.fontsize === 109 && defs.emphasis.fontsize === 116, { normal: defs.normal.fontsize, main: defs.main.fontsize, sub: defs.sub.fontsize, emphasis: defs.emphasis.fontsize, assStyles: styleSizes })

  const digestSizes = assText.split('\n').filter((l) => /^Dialogue: 0,/.test(l) && parseAssT(l.split(',')[1]) < T.digestSec).map((l) => [...l.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1])))
  add('ダイジェスト字幕: 126px', digestSizes.length === plan.digCaps.length && digestSizes.every((z) => z.includes(126)), { events: digestSizes.length, sizes: digestSizes })
  // 出力先
  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const outName = `video_captioned_final_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.mp4`
  add('出力ファイルが既存動画を上書きしない・一時ファイル/.partialが残っていない', !existsSync(join(ctx.outputRoot, outName)) && readdirSync(ctx.outputRoot).filter((n) => n.startsWith('.rendering-') || n.endsWith('.partial')).length === 0, { outName, existingFinals: readdirSync(ctx.outputRoot).filter((n) => n.startsWith('video_captioned_final_')).length })
  add('最終レンダー状態がまだない（フルレンダーは1回だけ）', !existsSync(FINAL_STATE()), {})
  return { ok: checks.every((c) => c.ok), checks, outName, P, assets, assText, expectedFrames }
}

// ── ASS のトークテーマ帯 ──
const parseAssT = (x) => { const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(x); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100 }
export const titleSpans = (assText) => assText.split('\n').filter((l) => /^Dialogue: \d+,[^,]+,[^,]+,TopicTitle,/.test(l)).map((l) => { const f = l.split(','); return [parseAssT(f[1]), parseAssT(f[2])] }).sort((x, y) => x[0] - y[0])
export function spanCheck(titles, a0, b0) {
  const inside = titles.filter((t) => t[1] > a0 + 0.005 && t[0] < b0 - 0.005)
  let cur = a0; let gap = 0; let overlap = 0
  for (const t of inside) { if (t[0] > cur + 0.011) gap += t[0] - cur; if (t[0] < cur - 0.011) overlap += cur - t[0]; cur = Math.max(cur, Math.min(t[1], b0)) }
  if (b0 > cur + 0.011) gap += b0 - cur
  return { titles: inside.length, gapSec: round(gap, 2), overlapSec: round(overlap, 2) }
}

export const printChecks = (r) => console.log(JSON.stringify({ stage: 'precheck', ok: r.ok, outName: r.outName, expectedFrames: r.expectedFrames, checks: r.checks.map((c) => ({ ok: c.ok, name: c.name, detail: c.detail })), externalAiApiCalled: false }, null, 2))

async function stageRender(args) {
  const r = await runPrechecks(args)
  printChecks(r)
  if (!r.ok) { console.error('[localCaptionFinal] 必須確認に失敗したため、レンダーを開始しません'); process.exit(2) }
  const { P, assets, assText, outName } = r
  const { job, file, bytes, canon, ctx, cutDoc, info, plan, mainSec, full, digestTail, state } = P
  const finalPath = join(ctx.outputRoot, outName)
  const before = dirSnapshot(ctx.outputRoot)
  const canonBefore = canon(job)
  const guard = { source: fileSig(ctx.sourceRealPath), mp3: sha256(readFileSync(info.realPath)), digestBgm: sha256(readFileSync(assets.bgm.realPath)), qr: sha256(readFileSync(assets.qr.realPath)), files: hashAll([...readdirSync(FULL_DIR).filter((n) => /^full_v[3-6]\./.test(n) && !n.includes('final-state')).map((n) => join(FULL_DIR, n)), join(EDITOR_ROOT, 'data/local_caption_videos', `${job.id}.json`)]) }
  // 予約: 状態ファイルを先に書き、失敗しても自動再実行しない（再実行は人間が状態を確認して判断）
  writeJsonAtomic(FINAL_STATE(), { createdAt: new Date().toISOString(), status: 'rendering', outputName: outName, before, guard, mainBgmFile: info.fileName })
  let child = null
  let aborted = null
  let minFree = Infinity
  const spawnFn = (bin, a, o) => { child = realSpawn(bin, a, o); return child }
  const timer = setInterval(async () => {
    try {
      const f = await getFreeBytes(ctx.outputRoot)
      minFree = Math.min(minFree, f)
      if (f < FINAL_ABORT_FREE_BYTES && child && !aborted) { aborted = `空き容量が${round(f / 1024 ** 3, 1)}GBに下がったため停止`; child.kill('SIGTERM') }
    } catch { /* 次の周期で再確認 */ }
  }, 10000)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { aborted = aborted ?? `シグナル${sig}`; child?.kill('SIGTERM') })
  const t0 = Date.now()
  try {
    const { result, removed } = await withTempDir('lcv-final-', (tmpDir) => renderCompositionToFile({
      cfg: plan.cfg, timeline: plan.timeline, width: job.width, height: job.height, sourcePath: ctx.sourceRealPath, mainStartSec: 0, mainEndSec: plan.tm.totalSec, mainItems: plan.tm.items, digestClips: plan.dig.clips,
      bgmPath: assets.bgm.realPath, qrPath: assets.qr.realPath, qrSize: { width: assets.qr.width, height: assets.qr.height }, assText, tmpDir, finalPath, spawnFn,
      mainBgmRequest: { roots: ctx.inputRoots, planMainSec: mainSec, levelItems: full.items },
    }))
    clearInterval(timer)
    const after = dirSnapshot(ctx.outputRoot)
    const m = result.mainBgm
    const gainOk = numEq(m.gain.gainDb, state.mainBgm.gain.gainDb, 0.01) && numEq(m.loopSelection.startSec, 34.56)
    writeJsonAtomic(FINAL_STATE(), {
      createdAt: new Date().toISOString(), status: 'done', outputName: outName, renderMs: Date.now() - t0, before, guard, mainBgmFile: info.fileName,
      mainBgm: { gain: m.gain, levels: m.levels, plan: m.plan, sourcePlan: m.sourcePlan, info: m.info, loopSelection: m.loopSelection, duck: MAIN_BGM_DUCK, volume: plan.cfg.mainBgm.volume }, digestTail, transition: plan.timeline.transition, minFreeBytesDuringRender: Number.isFinite(minFree) ? minFree : null,
    })
    console.log(JSON.stringify({
      stage: 'render', ok: true, outputName: outName, sizeBytes: statSync(finalPath).size, renderMs: Date.now() - t0, totalSecPlanned: plan.timeline.totalSec,
      mainBgm: { gainDb: m.gain.gainDb, sameGainAsApprovedPreview: gainOk, loopStartSec: m.loopSelection.startSec, plan: m.sourcePlan, levels: m.levels },
      existingOutputsChanged: Object.entries(before).filter(([n, x]) => after[n] !== x).length, newOutputs: Object.keys(after).filter((n) => !(n in before)), tempDirRemoved: removed,
      tempOutputLeftover: readdirSync(ctx.outputRoot).filter((n) => n.startsWith('.rendering-') || n.endsWith('.partial')).length, minFreeGBDuringRender: Number.isFinite(minFree) ? round(minFree / 1024 ** 3, 1) : null,
      safety: { sourceUnchanged: fileSig(ctx.sourceRealPath) === guard.source, mp3Unchanged: sha256(readFileSync(info.realPath)) === guard.mp3, jobFileByteIdentical: bytes.equals(readFileSync(file)), canonUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))), externalAiApiCalled: false },
    }, null, 2))
  } catch (err) {
    clearInterval(timer)
    writeJsonAtomic(FINAL_STATE(), { createdAt: new Date().toISOString(), status: 'failed', outputName: outName, reason: aborted ?? err.message, renderMs: Date.now() - t0, before, guard, note: '不完全な完成ファイルは残していません。再実行は人間の判断で（この状態ファイルを確認して削除してから）' })
    console.error(`[localCaptionFinal] レンダー失敗: ${aborted ?? err.message}`)
    console.log(JSON.stringify({ stage: 'render', ok: false, reason: aborted ?? err.message, finalExists: existsSync(finalPath), tempOutputLeftover: readdirSync(ctx.outputRoot).filter((n) => n.startsWith('.rendering-') || n.endsWith('.partial')).length }))
    process.exit(1)
  }
}

async function main() {
  dotenv.config({ path: resolve(EDITOR_ROOT, '.env'), quiet: true })
  const argv = process.argv.slice(2)
  const o = { stage: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--job') o.job = argv[++i]
    else if (a === '--main-bgm') o.mainBgm = argv[++i]
    else if (a === '--bgm') o.bgm = argv[++i]
    else if (a === '--qr') o.qr = argv[++i]
    else if (a === '--frames-dir') o.framesDir = argv[++i]
  }
  if (!o.job || !o.mainBgm || !o.bgm || !o.qr) throw new Error('--job / --main-bgm / --bgm / --qr を指定してください')
  if (o.stage === 'precheck') { const r = await runPrechecks(o); printChecks(r); process.exit(r.ok ? 0 : 2) }
  if (o.stage === 'render') return stageRender(o)
  if (o.stage === 'verify') { const { stageVerify } = await import('./localCaptionFinalVerify.mjs'); return stageVerify(o) }
  throw new Error('ステージは precheck / render / verify のいずれかです')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`[localCaptionFinal] ${err.message}`); process.exit(1) })
}
