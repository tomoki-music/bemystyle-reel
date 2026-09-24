// ローカルAIテロップ動画: 構成動画（ダイジェスト+LINE案内+本編）のレンダーと素材の確認。
//
// 安全設計:
// - ffmpeg は spawn + argv 配列（shell:false）。素材・元動画は読み取りのみ（変更・コピー・移動・削除しない）。
// - 出力は隠し一時ファイル（.rendering-*）へ書き、成功後にだけ最終名へ rename する。失敗時は一時動画・ASSを削除する。
// - 既存の完成動画は上書きしない（呼び出し側が buildComparisonOutputPath / buildUniqueOutputPath で新しい名前を用意する）。
// - 空き容量を事前確認する（完成動画は15GB未満なら開始しない）。
// - 素材の絶対パスは戻り値・エラーメッセージ・ログに出さない。外部AIは呼ばない。

import { spawn as realSpawn } from 'child_process'
import { existsSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { extname, dirname, resolve } from 'path'
import { validateSourcePath, PathValidationError } from './pathValidator.mjs'
import { getFreeBytes } from './diskSpace.mjs'
import { buildCompositionArgs, sectionShowsQr, QR_MISSING_MESSAGE } from './finalComposition.mjs'

export const FULL_RENDER_MIN_FREE_BYTES = 15 * 1024 ** 3
export const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac']
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg']

const ffmpegBin = () => (process.env.FFMPEG_BIN && process.env.FFMPEG_BIN.trim()) || 'ffmpeg'
const ffprobeBin = () => (process.env.FFPROBE_BIN && process.env.FFPROBE_BIN.trim()) || 'ffprobe'

function run(bin, args, spawnFn = realSpawn) {
  return new Promise((res, rej) => {
    const child = spawnFn(bin, args, { shell: false })
    let out = ''
    let err = ''
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.stderr?.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => rej(new Error(`外部コマンドの起動に失敗しました: ${e.code ?? 'error'}`)))
    child.on('close', (code, signal) => {
      if (signal) return rej(Object.assign(new Error(`処理がシグナル${signal}で中断されました`), { canceled: true }))
      return code === 0 ? res(out) : rej(Object.assign(new Error(`外部コマンドが終了コード${code}で失敗しました`), { stderr: err.slice(-800) }))
    })
  })
}

/**
 * 素材（BGM・QR画像）を検証する。許可フォルダ内の実在する通常ファイルで、拡張子・中身（ffprobe）が想定どおりであること。
 * 絶対パスは返さない（実在・種別・サイズ・寸法・長さだけ）。@returns {{ ok: boolean, error?: string, kind: string, sizeBytes?: number, durationSec?: number, width?: number, height?: number, realPath?: string }}
 */
export async function inspectAsset(inputPath, kind, allowedRoots, deps = {}) {
  const exts = kind === 'bgm' ? AUDIO_EXTS : IMAGE_EXTS
  if (!inputPath) return { ok: false, kind, error: `${kind === 'bgm' ? 'BGM' : 'QR画像'}のパスが設定されていません` }
  if (!exts.includes(extname(inputPath).toLowerCase())) return { ok: false, kind, error: `${kind === 'bgm' ? 'BGM' : 'QR画像'}の拡張子が対応外です` }
  let v
  try {
    v = validateSourcePath(inputPath, allowedRoots)
  } catch (err) {
    return { ok: false, kind, error: err instanceof PathValidationError ? `${kind === 'bgm' ? 'BGM' : 'QR画像'}を使用できません（${err.message}）` : `${kind === 'bgm' ? 'BGM' : 'QR画像'}を確認できません` }
  }
  try {
    const out = await run(deps.ffprobeBin ?? ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', v.realPath], deps.spawnFn)
    const j = JSON.parse(out)
    if (kind === 'bgm') {
      const a = (j.streams ?? []).find((s) => s.codec_type === 'audio')
      if (!a) return { ok: false, kind, error: 'BGMに音声ストリームがありません' }
      return { ok: true, kind, sizeBytes: v.size, durationSec: Number(j.format?.duration), realPath: v.realPath }
    }
    const s = (j.streams ?? []).find((x) => x.codec_type === 'video')
    if (!s || !(s.width > 0) || !(s.height > 0)) return { ok: false, kind, error: 'QR画像を読み取れません' }
    return { ok: true, kind, sizeBytes: v.size, width: s.width, height: s.height, realPath: v.realPath }
  } catch {
    return { ok: false, kind, error: `${kind === 'bgm' ? 'BGM' : 'QR画像'}の中身を確認できません` }
  }
}

/** 設定に必要な素材を検証する。有効な機能に必要な素材が無ければ errors に理由を入れる（レンダーは開始しない）。 */
export async function resolveCompositionAssets(cfg, allowedRoots, deps = {}) {
  const errors = []
  let bgm = null
  let qr = null
  const needQr = sectionShowsQr(cfg, 'lineIntro') || sectionShowsQr(cfg, 'lineOutro')
  if (cfg.digest.enabled && cfg.digest.bgm.path) {
    bgm = await inspectAsset(cfg.digest.bgm.path, 'bgm', allowedRoots, deps)
    if (!bgm.ok) errors.push(bgm.error)
  }
  if (needQr) {
    qr = await inspectAsset(cfg.line.qrPath, 'qr', allowedRoots, deps)
    if (!qr.ok) errors.push(QR_MISSING_MESSAGE) // 素材の絶対パス・詳細は出さない。QRを省略してレンダーを続けない
  }
  return { ok: errors.length === 0, errors, bgm, qr }
}

/** 空き容量の事前確認。@returns {{ ok: boolean, freeBytes: number }} */
export async function checkFreeSpace(outputRoot, minFreeBytes, deps = {}) {
  const freeBytes = await (deps.getFreeBytes ?? getFreeBytes)(outputRoot)
  return { ok: Number.isFinite(freeBytes) && freeBytes >= minFreeBytes, freeBytes }
}

/**
 * 構成動画を一時ファイルへレンダーし、成功後に最終名へrenameする。失敗時は一時動画とASSを削除する。
 * @param {{ cfg: object, timeline: object, width: number, height: number, sourcePath: string, mainStartSec: number, mainEndSec: number,
 *   digestClips: object[], bgmPath?: string, qrPath?: string, assText: string, tmpDir: string, finalPath: string, spawnFn?: Function }} p
 * @returns {Promise<{ finalPath: string }>}
 */
export async function renderCompositionToFile(p) {
  if (existsSync(p.finalPath)) throw new Error('出力先に同名のファイルが既にあります（上書きしません）')
  mkdirSync(p.tmpDir, { recursive: true })
  const assPath = resolve(p.tmpDir, `composition-${process.pid}-${Date.now()}.ass`)
  const tempOut = resolve(dirname(p.finalPath), `.rendering-composition-${process.pid}-${Date.now()}${extname(p.finalPath)}`)
  try {
    writeFileSync(assPath, p.assText, 'utf-8')
    const { args } = buildCompositionArgs({ ...p, assPath, outputPath: tempOut })
    await run(ffmpegBin(), args, p.spawnFn)
    if (!existsSync(tempOut) || statSync(tempOut).size === 0) throw new Error('レンダー結果が空です')
    if (existsSync(p.finalPath)) throw new Error('出力先に同名のファイルが既にあります（上書きしません）')
    renameSync(tempOut, p.finalPath) // 成功後にだけ最終名へ
    return { finalPath: p.finalPath }
  } catch (err) {
    rmSync(tempOut, { force: true })
    throw err
  } finally {
    rmSync(assPath, { force: true })
  }
}
