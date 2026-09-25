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
import { parseMp3Probe, MAIN_BGM_MISSING_MESSAGE, planBgmLoop, planBgmGain, buildLoopUnitArgs, meanEnergyDb } from './mainBgm.mjs'

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
export async function measureMainBgmLevels({ sourcePath, mainItems, bgmPath }, deps = {}) {
  const ff = deps.ffmpegBin ?? ffmpegBin()
  const bgm = await decodeMono16k(ff, ['-i', bgmPath], deps)
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

/**
 * レンダー用に本編BGMを準備する: 音源の検証 → ラウドネス測定 → ゲイン・ループの計画 → （必要なら）ループ単位のWAVを tmpDir へ書く。
 * @returns {Promise<{ ok: boolean, error?: string, prep?: { inputPath: string, plan: object, gainDb: number, gain: object, levels: object, info: object, loopUnitPath: string | null } }>}
 */
export async function prepareMainBgm({ cfg, roots, sourcePath, mainItems, mainSec, tmpDir, transform }, deps = {}) {
  const mb = cfg.mainBgm
  const info = await inspectMainBgm(mb.sourcePath, roots, deps)
  if (!info.ok) return { ok: false, error: info.error }
  const plan = planBgmLoop({ bgmSec: info.durationSec, mainSec, loop: mb.loop })
  if (!plan.ok) return { ok: false, error: plan.error }
  const levels = await measureMainBgmLevels({ sourcePath, mainItems, bgmPath: info.realPath }, deps)
  const gain = planBgmGain({ voiceSpeechDb: levels.voiceSpeechDb, bgmDb: levels.bgmDb, volume: mb.volume, autoGain: mb.autoGain, ducking: mb.ducking })
  let loopUnitPath = null
  if (plan.needsLoop) {
    loopUnitPath = join(tmpDir, `main-bgm-loop-${process.pid}-${Date.now()}.wav`)
    await run(deps.ffmpegBin ?? ffmpegBin(), buildLoopUnitArgs({ bgmPath: info.realPath, outPath: loopUnitPath, bgmSec: info.durationSec, crossfadeSec: plan.crossfadeSec, sampleRate: 48000 }).args, { spawnFn: deps.spawnFn })
  }
  const { realPath, ...publicInfo } = info
  let inputPath = plan.needsLoop ? loopUnitPath : realPath
  let effectivePlan = plan
  // 確認動画用: 入力のBGMを別の音声（例: ループ境界の区間を差し込んだトラック）へ差し替える。一時ファイルは tmpDir へ作る
  if (transform) ({ inputPath, plan: effectivePlan } = await transform({ realPath, info, plan, tmpDir, unitPath: loopUnitPath, mainSec }))
  return { ok: true, prep: { inputPath, plan: effectivePlan, sourcePlan: plan, gainDb: gain.gainDb, gain, levels, info: publicInfo, loopUnitPath } }
}
