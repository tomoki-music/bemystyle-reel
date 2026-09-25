// ローカルAIテロップ動画: 本編BGM（MP3）の実ファイル検証・許可ルート内の選択・ラウドネス測定・ループ単位の生成（ファイルI/O側）。
//
// 安全設計:
// - 許可ルート（VIDEO_INPUT_ROOTS）内のMP3を「直接参照」する。ブラウザからのアップロード・コピーはしない。元MP3は読み取りのみ。
// - 拡張子・Content-Type は信用しない。ffprobe で実データ（音声ストリーム・コーデックがmp3・duration）を確認する。
// - ffmpeg / ffprobe は spawn + argv 配列（shell:false）。
// - 絶対パスは戻り値・エラーメッセージ・ログへ出さない（ファイル名・サイズ・長さ・サンプルレート・チャンネル数だけ）。
// - 一時ファイル（ループ単位のWAV・測定用WAV）は呼び出し側の一時ディレクトリへ書く（withTempDir が必ず削除する）。

import { spawn as realSpawn } from 'child_process'
import { readdirSync, readFileSync, statSync, realpathSync } from 'fs'
import { basename, join, extname } from 'path'
import { createHash } from 'crypto'
import { validateSourcePath, PathValidationError, resolveAllowedRoots, isInsideAnyRoot } from './pathValidator.mjs'
import { readWavPcm16Mono, computeFrameDb, detectSilences } from './silenceDetector.mjs'
import { parseMp3Probe, MAIN_BGM_MISSING_MESSAGE, MAIN_BGM_LOOP, planBgmLoop, planBgmGain, buildLoopUnitArgs, meanEnergyDb } from './mainBgm.mjs'
import { analyzeBgm, scoreLoopStarts, topDistinct, measureLoopBoundary } from './bgmLoopSelect.mjs'

const ffmpegBin = () => (process.env.FFMPEG_BIN && process.env.FFMPEG_BIN.trim()) || 'ffmpeg'
const ffprobeBin = () => (process.env.FFPROBE_BIN && process.env.FFPROBE_BIN.trim()) || 'ffprobe'
const r3 = (v) => Math.round(v * 1000) / 1000

function run(bin, args, { spawnFn = realSpawn, encoding = 'utf-8' } = {}) {
  return new Promise((res, rej) => {
    const child = spawnFn(bin, args, { shell: false })
    const out = []
    let err = ''
    child.stdout?.on('data', (d) => out.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))))
    child.stderr?.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => rej(new Error(`外部コマンドの起動に失敗しました: ${e.code ?? 'error'}`)))
    child.on('close', (code, signal) => {
      if (signal) return rej(Object.assign(new Error(`処理がシグナル${signal}で中断されました`), { canceled: true }))
      const buf = Buffer.concat(out)
      return code === 0 ? res(encoding === 'buffer' ? buf : buf.toString('utf-8')) : rej(Object.assign(new Error(`外部コマンドが終了コード${code}で失敗しました`), { stderr: err.slice(-800) }))
    })
  })
}

/**
 * 本編BGMのMP3を検証する。許可ルート内の実在する通常ファイルで、ffprobeが「MP3の音声ストリーム＋duration」を確認できること。
 * @returns {Promise<{ ok: boolean, error?: string, fileName?: string, sizeBytes?: number, durationSec?: number, sampleRate?: number, channels?: number, realPath?: string }>}
 */
export async function inspectMainBgm(inputPath, allowedRoots, deps = {}) {
  if (!inputPath || typeof inputPath !== 'string') return { ok: false, error: MAIN_BGM_MISSING_MESSAGE }
  let v
  try {
    v = validateSourcePath(inputPath, allowedRoots)
  } catch (err) {
    return { ok: false, error: err instanceof PathValidationError && err.code === 'not_found' ? MAIN_BGM_MISSING_MESSAGE : `本編BGMを使用できません（${err instanceof PathValidationError ? err.message : '確認できません'}）` }
  }
  const name = basename(v.realPath)
  try {
    const out = await run(deps.ffprobeBin ?? ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', v.realPath], { spawnFn: deps.spawnFn })
    const parsed = parseMp3Probe(JSON.parse(out), name)
    if (!parsed.ok) return { ok: false, error: `本編BGMを使用できません（${parsed.error}）`, fileName: name }
    return { ok: true, fileName: name, sizeBytes: v.size, durationSec: parsed.durationSec, sampleRate: parsed.sampleRate, channels: parsed.channels, realPath: v.realPath }
  } catch {
    return { ok: false, error: '本編BGMを使用できません（中身を確認できません。壊れている可能性があります）', fileName: name }
  }
}

// ────────────────────────────────────────────────────────────────
// 許可ルート内のMP3一覧（UIの「MP3ファイルを選択」。パスは返さず、ファイル名と不透明なIDだけ）
// ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', '.Trash'])
const idOf = (realPath) => createHash('sha256').update(realPath).digest('hex').slice(0, 16)

/** 許可ルート配下（深さ4まで・隠しフォルダ除外・最大500件）の .mp3 を列挙する。 */
export function scanMp3Files(allowedRoots, { maxDepth = 4, maxFiles = 500 } = {}) {
  const roots = resolveAllowedRoots(allowedRoots)
  const found = []
  const walk = (dir, depth) => {
    if (found.length >= maxFiles) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (found.length >= maxFiles) return
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name)) walk(full, depth + 1)
      } else if ((e.isFile() || e.isSymbolicLink()) && extname(e.name).toLowerCase() === '.mp3') {
        try {
          const real = realpathSync(full)
          if (!isInsideAnyRoot(real, roots)) continue // シンボリックリンクでルート外へ出るものは除外
          const st = statSync(real)
          if (st.isFile()) found.push({ id: idOf(real), fileName: basename(real), sizeBytes: st.size, realPath: real })
        } catch {
          // 読めないものは無視
        }
      }
    }
  }
  for (const r of roots) walk(r, 0)
  return found.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ja'))
}

/** UI向け（パスを含めない）。 */
export const listMainBgmCandidates = (allowedRoots) => scanMp3Files(allowedRoots).map(({ id, fileName, sizeBytes }) => ({ id, fileName, sizeBytes }))

/** 選択ID → 実パス（許可ルート内のMP3だけ）。見つからなければ null。 */
export function resolveMainBgmId(id, allowedRoots) {
  if (!/^[0-9a-f]{16}$/.test(String(id ?? ''))) return null
  return scanMp3Files(allowedRoots).find((f) => f.id === id)?.realPath ?? null
}

// ────────────────────────────────────────────────────────────────
// ラウドネス測定・レンダー用の準備
// ────────────────────────────────────────────────────────────────

const decodeMono16k = async (ffmpeg, args, { spawnFn } = {}) => {
  const buf = await run(ffmpeg, ['-v', 'error', ...args, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', '-c:a', 'pcm_s16le', 'pipe:1'], { spawnFn, encoding: 'buffer' })
  return readWavPcm16Mono(buf)
}

/**
 * 声（本編トークの発話中）とBGM音源の平均ラウドネス(RMS, dBFS)を測る。元動画・MP3は読み取りのみ。
 * 声は編集後の本編に使う区間（items の seg）だけを、発話とみなせるフレーム（無音しきい値より大きい）のエネルギー平均で測る。
 * @returns {Promise<{ voiceSpeechDb: number, voiceOverallDb: number, bgmDb: number, speechFrames: number }>}
 */
export async function measureMainBgmLevels({ sourcePath, mainItems, bgmPath, bgmFromSec = 0 }, deps = {}) {
  const ff = deps.ffmpegBin ?? ffmpegBin()
  // bgmFromSec: ループするとき、本編の大半で鳴るのは開始点以降（曲頭の静かな部分は最初の1回だけ）なので、その範囲のラウドネスで測る
  const bgm = await decodeMono16k(ff, [...(bgmFromSec > 0 ? ['-ss', String(bgmFromSec)] : []), '-i', bgmPath], deps)
  const bgmDb = meanEnergyDb(computeFrameDb(bgm.samples, bgm.sampleRate, 0.02).db, -80)
  const speechDbs = []
  const allDbs = []
  const items = (mainItems ?? [{ kind: 'seg', srcStartSec: 0, srcEndSec: 0 }]).filter((i) => i.kind === 'seg')
  for (const it of items) {
    const args = it.srcEndSec > it.srcStartSec ? ['-ss', String(it.srcStartSec), '-t', String(r3(it.srcEndSec - it.srcStartSec)), '-i', sourcePath] : ['-i', sourcePath]
    const v = await decodeMono16k(ff, args, deps)
    const { db } = computeFrameDb(v.samples, v.sampleRate, 0.02)
    const det = detectSilences(v.samples, v.sampleRate, { minSilenceSec: 0.3, frameSec: 0.02 })
    for (const x of db) {
      allDbs.push(x)
      if (x > det.thresholdDb) speechDbs.push(x)
    }
  }
  return { voiceSpeechDb: meanEnergyDb(speechDbs), voiceOverallDb: meanEnergyDb(allDbs, -80), bgmDb, speechFrames: speechDbs.length }
}

const decodeF32 = async (ffmpeg, args, { sampleRate, channels = 1, spawnFn } = {}) => {
  const buf = await run(ffmpeg, ['-v', 'error', ...args, '-vn', '-ac', String(channels), '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], { spawnFn, encoding: 'buffer' })
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - (buf.byteLength % 4)))
}

/** ループ境界が自然と言える基準（機械測定）。 */
export const LOOP_BOUNDARY_LIMITS = Object.freeze({ levelDiffDb: 1.5, dipDb: 1.5, xfadeLevelDb: 1.5, maxStepRatio: 1.5 })

/**
 * ループ開始点を選ぶ: 曲の4秒以降の候補を、拍・音量・音色の一致で並べ（bgmLoopSelect）、上位の候補は実際にループ単位WAVを作って境界を測る
 * （境界前後の音量差・クロスフェードの落ち込み・クリック）。基準を満たすもののうち、もっとも自然な（スコアが高い）ものを採用する。
 * 聴感の確認はできない（機械測定のみ）。ループ単位は tmpDir へ書く（呼び出し側の一時フォルダごと削除される）。
 * @returns {Promise<{ startSec: number, unitPath: string, crossfadeSec: number, candidates: object[], allMeetCriteria: boolean, searched: number } | null>} 候補が取れない（短い曲）ときは null
 */
export async function selectLoopStart({ bgmPath, durationSec, tmpDir, crossfadeSec, topN = 8, fromSec = MAIN_BGM_LOOP.minStartSec, toSec = 40 }, deps = {}) {
  const ff = deps.ffmpegBin ?? ffmpegBin()
  const SR = 48000
  const mono = await decodeF32(ff, ['-i', bgmPath], { sampleRate: 24000, spawnFn: deps.spawnFn }) // 24000Hz: 10msが240サンプルで割り切れる（解析の時刻が実時間と一致する）
  const scored = scoreLoopStarts(analyzeBgm(mono, 24000), { lengthSec: durationSec, crossfadeSec, fromSec, toSec })
  const top = topDistinct(scored, topN)
  if (top.length === 0) return null // 曲が短くて4秒以降の候補が取れない → 従来のループ（曲頭へ戻る）
  const measured = []
  for (const [i, c] of top.entries()) {
    const unitPath = join(tmpDir, `loop-cand-${i}.wav`)
    await run(ff, buildLoopUnitArgs({ bgmPath, outPath: unitPath, bgmSec: durationSec, crossfadeSec, sampleRate: SR, loopStartSec: c.startSec }).args, { spawnFn: deps.spawnFn })
    const u = await decodeF32(ff, ['-i', unitPath], { sampleRate: SR, spawnFn: deps.spawnFn })
    const m = measureLoopBoundary(u, SR, crossfadeSec)
    const meets = m.levelDiffDb <= LOOP_BOUNDARY_LIMITS.levelDiffDb && m.level500msDiffDb <= LOOP_BOUNDARY_LIMITS.levelDiffDb && m.dipDb >= -LOOP_BOUNDARY_LIMITS.dipDb && Math.abs(m.xfadeLevelDb) <= LOOP_BOUNDARY_LIMITS.xfadeLevelDb && m.maxStepRatio <= LOOP_BOUNDARY_LIMITS.maxStepRatio
    measured.push({ ...c, ...m, meets, unitPath })
  }
  const pool = measured.some((m) => m.meets) ? measured.filter((m) => m.meets) : [...measured].sort((a, b) => a.levelDiffDb - b.levelDiffDb)
  const best = measured.some((m) => m.meets) ? [...pool].sort((a, b) => b.score - a.score)[0] : pool[0]
  return { startSec: best.startSec, unitPath: best.unitPath, crossfadeSec, candidates: measured.map(({ unitPath, ...rest }) => rest), allMeetCriteria: best.meets, searched: scored.length }
}

/**
 * レンダー用に本編BGMを準備する: 音源の検証 → ループ開始点の選定 → ラウドネス測定 → ゲイン・ループの計画 → （必要なら）ループ単位のWAVを tmpDir へ書く。
 * planMainSec / levelItems: ゲイン・ループの計画に使う本編の長さと、声のラウドネスを測る区間（確認動画では、実際に流す長さ・区間ではなく最終版のもので計画する）。省略時は mainSec / mainItems。
 * @returns {Promise<{ ok: boolean, error?: string, prep?: { inputPath: string, introPath: string | null, plan: object, gainDb: number, gain: object, levels: object, info: object, loopUnitPath: string | null, loopSelection: object | null } }>}
 */
export async function prepareMainBgm({ cfg, roots, sourcePath, mainItems, levelItems, mainSec, planMainSec, tmpDir, transform }, deps = {}) {
  const mb = cfg.mainBgm
  const info = await inspectMainBgm(mb.sourcePath, roots, deps)
  if (!info.ok) return { ok: false, error: info.error }
  let plan = planBgmLoop({ bgmSec: info.durationSec, mainSec: planMainSec ?? mainSec, loop: mb.loop })
  if (!plan.ok) return { ok: false, error: plan.error }
  let loopUnitPath = null
  let loopSelection = null
  if (plan.needsLoop) {
    loopSelection = await selectLoopStart({ bgmPath: info.realPath, durationSec: info.durationSec, tmpDir, crossfadeSec: plan.crossfadeSec }, deps)
    if (loopSelection) {
      loopUnitPath = loopSelection.unitPath
      plan = planBgmLoop({ bgmSec: info.durationSec, mainSec: planMainSec ?? mainSec, loop: mb.loop, loopStartSec: loopSelection.startSec })
      if (!plan.ok) return { ok: false, error: plan.error }
    } else {
      // 短い曲: 従来のループ単位（末尾と先頭のクロスフェード）
      loopUnitPath = join(tmpDir, `main-bgm-loop-${process.pid}-${Date.now()}.wav`)
      await run(deps.ffmpegBin ?? ffmpegBin(), buildLoopUnitArgs({ bgmPath: info.realPath, outPath: loopUnitPath, bgmSec: info.durationSec, crossfadeSec: plan.crossfadeSec, sampleRate: 48000 }).args, { spawnFn: deps.spawnFn })
    }
  }
  const levels = await measureMainBgmLevels({ sourcePath, mainItems: levelItems ?? mainItems, bgmPath: info.realPath, bgmFromSec: plan.needsLoop ? plan.loopStartSec : 0 }, deps)
  const gain = planBgmGain({ voiceSpeechDb: levels.voiceSpeechDb, bgmDb: levels.bgmDb, volume: mb.volume, autoGain: mb.autoGain, ducking: mb.ducking })
  const { realPath, ...publicInfo } = info
  let inputPath = plan.needsLoop ? loopUnitPath : realPath
  let effectivePlan = plan
  if (planMainSec && planMainSec !== mainSec) effectivePlan = planBgmLoop({ bgmSec: info.durationSec, mainSec, loop: mb.loop }) // 実際に流す長さ（確認動画。トラックは transform が作る）
  // 確認動画用: 入力のBGMを別の音声（例: ループ境界の区間を差し込んだトラック）へ差し替える。一時ファイルは tmpDir へ作る
  if (transform) ({ inputPath, plan: effectivePlan } = await transform({ realPath, info, plan, tmpDir, unitPath: loopUnitPath, mainSec, loopSelection }))
  return { ok: true, prep: { inputPath, introPath: effectivePlan.needsLoop && effectivePlan.introSec > 0 ? realPath : null, plan: effectivePlan, sourcePlan: plan, gainDb: gain.gainDb, gain, levels, info: publicInfo, loopUnitPath, loopSelection: loopSelection && { startSec: loopSelection.startSec, crossfadeSec: loopSelection.crossfadeSec, candidates: loopSelection.candidates, allMeetCriteria: loopSelection.allMeetCriteria, searched: loopSelection.searched } } }
}
