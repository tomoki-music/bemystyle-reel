// ローカルAIテロップ動画機能のルーター。
//
// editor/server.mjs から `createLocalCaptionVideoRouter({ jobsDir })` を呼び出して
// マウントする。この機能専用のロジックはすべてこのファイルと
// editor/server/lib/*.mjs に閉じ込め、server.mjs 本体への変更を最小限にする。
//
// セキュリティ上の要点（詳細は各 lib モジュールのコメント参照）:
// - 動画本体は一切コピーしない。常に検証済みパスを ffmpeg/ffprobe の引数として渡す。
// - すべての入力パスは毎リクエスト、許可ルート（VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT）
//   に対して realpath 込みで再検証する（キャッシュした「検証済みフラグ」は信用しない）。
// - console.log/error にはフルパスを出さない（basename or jobId のみ）。
//   ジョブJSON・APIレスポンスにフルパスが含まれるのは仕様上必要なため許容する
//   （この機能はネットワーク非公開・単一オペレーターのローカルツールのため）。

import express from 'express'
import {
  existsSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  statSync,
  realpathSync,
  readdirSync,
} from 'fs'
import { resolve, extname, basename } from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

import {
  validateSourcePath,
  validateBrowseDirectory,
  validateOutputRoot,
  resolveAllowedRoots,
  isInsideAnyRoot,
  PathValidationError,
} from './lib/pathValidator.mjs'
import { JobStore, recoverIncompleteJobsOnStartup, IN_PROGRESS_STATUSES } from './lib/jobStore.mjs'
import { runFfprobe, extractAudio, burnCaptions, getFileSize } from './lib/ffmpegRunner.mjs'
import {
  transcribeAudioFile,
  TranscriptionTimeoutError,
  TranscriptionApiError,
} from './lib/openaiTranscription.mjs'
import { buildAssContent, CAPTION_TYPES } from './lib/captionStyles.mjs'
import { checkDiskSpace } from './lib/diskSpace.mjs'
import { checkJapaneseFontAvailable } from './lib/fontCheck.mjs'
import { buildUniqueOutputPath } from './lib/outputNaming.mjs'

export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v'])
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const EDITABLE_STATUSES = ['ready_for_edit', 'completed', 'failed']
const MIME_BY_EXT = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v' }

export function getAllowedInputRoots() {
  return String(process.env.VIDEO_INPUT_ROOTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function getOutputRoot() {
  return process.env.VIDEO_OUTPUT_ROOT || ''
}

export function getTmpRoot() {
  const v = process.env.CAPTION_VIDEO_TMP_ROOT
  return v && v.trim() ? v.trim() : resolve(os.tmpdir(), 'bemystyle-caption-tmp')
}

function logSafe(event, jobId, extra) {
  // フルパスを絶対に含めない安全なログ出力。
  console.log(`[LocalCaptionVideo] ${event} job=${jobId ?? '-'}${extra ? ` ${extra}` : ''}`)
}

function streamVideoFile(req, res, absPath) {
  let stat
  try {
    stat = statSync(absPath)
  } catch {
    return res.status(404).json({ ok: false, message: 'ファイルが見つかりません' })
  }
  const fileSize = stat.size
  const contentType = MIME_BY_EXT[extname(absPath).toLowerCase()] || 'application/octet-stream'
  const range = req.headers.range

  if (!range) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(absPath).pipe(res)
    return
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range)
  if (!match || (!match[1] && !match[2])) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
    return res.end()
  }
  const start = match[1] ? parseInt(match[1], 10) : 0
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize || start < 0) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
    return res.end()
  }
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
  })
  createReadStream(absPath, { start, end }).pipe(res)
}

/**
 * @param {{ jobsDir: string }} options
 * @returns {import('express').Router}
 */
export function createLocalCaptionVideoRouter({ jobsDir }) {
  const store = new JobStore(jobsDir)

  // 起動時クラッシュ復旧: extracting_audio/transcribing/rendering のまま残っていたジョブを failed へ。
  const recovered = recoverIncompleteJobsOnStartup(store)
  for (const { job, staleOutputPath } of recovered) {
    logSafe('startup-recovery: marked failed', job.id)
    if (staleOutputPath) {
      try {
        if (existsSync(staleOutputPath)) unlinkSync(staleOutputPath)
      } catch {
        // best effort
      }
    }
  }

  const router = express.Router()

  // レンダー（字幕焼き込み）はアプリ全体で同時に1件まで。
  let activeRenderJobId = null
  /** @type {Map<string, import('node:child_process').ChildProcess>} */
  const activeRenderChildren = new Map()

  function loadJobOr404(req, res) {
    const job = store.load(req.params.id)
    if (!job) {
      res.status(404).json({ ok: false, message: 'ジョブが見つかりません' })
      return null
    }
    return job
  }

  function assertEditable(job, res) {
    if (!EDITABLE_STATUSES.includes(job.status)) {
      res.status(409).json({ ok: false, message: '処理中は字幕を編集できません' })
      return false
    }
    return true
  }

  // ── 入力フォルダ一覧 / ディレクトリブラウズ ──────────────────────

  router.get('/roots', (_req, res) => {
    const configuredRoots = getAllowedInputRoots()
    // 各ルートを個別に realpath 解決し、実在確認する（1件でも欠けていても他は判定できるように）。
    const inputRoots = configuredRoots.map((p) => ({ path: p, available: resolveAllowedRoots([p]).length > 0 }))

    const outputRoot = getOutputRoot()
    let outputAvailable = false
    try {
      validateOutputRoot(outputRoot)
      outputAvailable = true
    } catch {
      outputAvailable = false
    }
    res.json({
      ok: true,
      inputRoots,
      outputRoot: { path: outputRoot, available: outputAvailable },
    })
  })

  router.get('/browse', (req, res) => {
    const roots = getAllowedInputRoots()
    const queryPath = typeof req.query.path === 'string' ? req.query.path : ''

    if (!queryPath) {
      const realRoots = resolveAllowedRoots(roots)
      const entries = realRoots.map((real, i) => ({
        name: roots[i] ?? real,
        path: real,
        isDirectory: true,
        isVideo: false,
        size: null,
      }))
      return res.json({ ok: true, path: null, entries })
    }

    let real
    try {
      ;({ realPath: real } = validateBrowseDirectory(queryPath, roots))
    } catch (err) {
      const message = err instanceof PathValidationError ? err.message : '不正なパスです'
      return res.status(400).json({ ok: false, message })
    }

    try {
      const names = readdirSync(real)
      const entries = names
        .map((name) => {
          const full = resolve(real, name)
          let stat
          try {
            stat = statSync(full)
          } catch {
            return null
          }
          const isDirectory = stat.isDirectory()
          const isVideo = !isDirectory && VIDEO_EXTS.has(extname(name).toLowerCase())
          if (!isDirectory && !isVideo) return null
          return { name, path: full, isDirectory, isVideo, size: isDirectory ? null : stat.size }
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      res.json({ ok: true, path: real, entries })
    } catch {
      res.status(500).json({ ok: false, message: 'ディレクトリの読み取りに失敗しました' })
    }
  })

  // ── ジョブ作成・一覧・取得・削除 ──────────────────────

  router.post('/', async (req, res) => {
    const { sourcePath, title } = req.body ?? {}
    if (!sourcePath || typeof sourcePath !== 'string') {
      return res.status(400).json({ ok: false, message: 'sourcePath が必要です' })
    }

    let validated
    try {
      validated = validateSourcePath(sourcePath, getAllowedInputRoots())
    } catch (err) {
      const message = err instanceof PathValidationError ? err.message : 'パスの検証に失敗しました'
      return res.status(400).json({ ok: false, message })
    }

    const ext = extname(validated.realPath).toLowerCase()
    if (!VIDEO_EXTS.has(ext)) {
      return res.status(400).json({ ok: false, message: '対応していないファイル形式です（mp4 / mov / m4v のみ）' })
    }

    let job = store.createInitial({
      title: typeof title === 'string' && title.trim() ? title.trim() : basename(validated.realPath),
      sourcePath: validated.realPath,
      sourceFilename: basename(validated.realPath),
      sourceSize: validated.size,
    })
    store.save(job)
    job = store.transition(job, 'probing')
    logSafe('created + probing', job.id)

    try {
      const meta = await runFfprobe(validated.realPath)
      const patch = {
        ...meta,
        transcriptionNote: meta.hasAudio
          ? null
          : 'この動画には音声が確認できませんでした。文字起こしを利用できません。手動でテロップを追加してください。',
      }
      job = store.transition(job, 'ready_for_edit', patch)
      res.json({ ok: true, job })
    } catch (err) {
      job = store.transition(store.load(job.id) ?? job, 'failed', {
        errorMessage: `動画情報の取得に失敗しました: ${err.message}`,
      })
      logSafe('probe failed', job.id)
      res.status(502).json({ ok: false, message: job.errorMessage, job })
    }
  })

  router.get('/', (_req, res) => {
    res.json({ ok: true, jobs: store.list() })
  })

  router.get('/:id', (req, res) => {
    const job = loadJobOr404(req, res)
    if (!job) return
    res.json({ ok: true, job })
  })

  router.delete('/:id', (req, res) => {
    const job = loadJobOr404(req, res)
    if (!job) return
    if (IN_PROGRESS_STATUSES.includes(job.status) || store.isLocked(job.id)) {
      return res.status(409).json({ ok: false, message: '処理中のジョブは削除できません' })
    }
    // 自分たちが生成した出力ファイルのみ削除。元動画には絶対に触れない。
    if (job.outputPath) {
      try {
        const outRoot = validateOutputRoot(getOutputRoot())
        if (existsSync(job.outputPath)) {
          const real = realpathSync(job.outputPath)
          if (isInsideAnyRoot(real, [outRoot])) unlinkSync(real)
        }
      } catch {
        // best effort。出力先が不正でも「削除できないだけ」でジョブ自体の削除は続行する。
      }
    }
    store.delete(job.id)
    logSafe('deleted', job.id)
    res.json({ ok: true, message: '削除しました' })
  })

  router.post('/:id/reprobe', async (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (job.status !== 'failed' || job.durationSec !== null) {
      return res.status(409).json({ ok: false, message: '再取得できる状態ではありません' })
    }
    if (!store.acquireLock(job.id)) {
      return res.status(409).json({ ok: false, message: 'すでに処理中です' })
    }
    try {
      job = store.transition(job, 'probing')
      const meta = await runFfprobe(job.sourcePath)
      const patch = {
        ...meta,
        transcriptionNote: meta.hasAudio
          ? null
          : 'この動画には音声が確認できませんでした。文字起こしを利用できません。手動でテロップを追加してください。',
      }
      job = store.transition(job, 'ready_for_edit', patch)
      res.json({ ok: true, job })
    } catch (err) {
      job = store.transition(store.load(job.id) ?? job, 'failed', {
        errorMessage: `動画情報の取得に失敗しました: ${err.message}`,
      })
      res.status(502).json({ ok: false, message: job.errorMessage, job })
    } finally {
      store.releaseLock(job.id)
    }
  })

  // ── 音声抽出＋文字起こし ──────────────────────

  async function runProcessingPipeline(jobId, apiKey) {
    const tmpRoot = getTmpRoot()
    mkdirSync(tmpRoot, { recursive: true })
    const audioPath = resolve(tmpRoot, `${jobId}.mp3`)
    try {
      const startJob = store.load(jobId)
      if (!startJob) return
      await extractAudio(startJob.sourcePath, audioPath)

      const size = getFileSize(audioPath)
      if (size > MAX_AUDIO_BYTES) {
        const j = store.load(jobId)
        if (j) {
          store.transition(j, 'failed', {
            errorMessage: `抽出した音声ファイルがサイズ上限(24MB)を超えました（${(size / 1024 / 1024).toFixed(1)}MB）。文字起こしを実行できません。`,
          })
        }
        return
      }

      let job = store.load(jobId)
      if (!job) return
      job = store.transition(job, 'transcribing')

      let segments
      try {
        segments = await transcribeAudioFile(audioPath, apiKey)
      } catch (err) {
        const message =
          err instanceof TranscriptionTimeoutError
            ? '文字起こしがタイムアウトしました。もう一度「文字起こしを開始」を押してください（自動リトライは行いません）。'
            : err instanceof TranscriptionApiError
              ? `OpenAI APIエラー: ${err.message}`
              : `文字起こし中にエラーが発生しました: ${err.message}`
        const j = store.load(jobId)
        if (j) store.transition(j, 'failed', { errorMessage: message })
        return
      }

      const current = store.load(jobId)
      if (!current) return
      const existingCaptions = Array.isArray(current.captions) ? current.captions : []
      let nextOrder = existingCaptions.length
      const newCaptions = segments.map((seg) => ({
        id: randomUUID(),
        startSec: seg.startSec,
        endSec: seg.endSec,
        text: seg.text,
        captionType: 'normal',
        emphasisText: null,
        displayOrder: nextOrder++,
      }))
      store.transition(current, 'ready_for_edit', {
        captions: [...existingCaptions, ...newCaptions],
        transcribedAt: new Date().toISOString(),
      })
      logSafe('transcription complete', jobId, `captions=${newCaptions.length}`)
    } catch (err) {
      const j = store.load(jobId)
      if (j) store.transition(j, 'failed', { errorMessage: `音声抽出に失敗しました: ${err.message}` })
      logSafe('extraction failed', jobId)
    } finally {
      try {
        if (existsSync(audioPath)) unlinkSync(audioPath)
      } catch {
        // best effort
      }
      store.releaseLock(jobId)
    }
  }

  router.post('/:id/start-processing', (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!(job.status === 'ready_for_edit' || job.status === 'failed')) {
      return res.status(409).json({ ok: false, message: 'この状態からは開始できません' })
    }
    if (job.hasAudio !== true) {
      return res.status(409).json({ ok: false, message: job.transcriptionNote || 'この動画には音声がありません' })
    }
    const apiKey = process.env.OPENAI_API_KEY
    // .present? ではなく length で空文字トラップを検出する（本番障害知見と同様の注意点）
    if (!apiKey || apiKey.length === 0) {
      return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
    }
    if (!store.acquireLock(job.id)) {
      return res.status(409).json({ ok: false, message: 'すでに処理中です' })
    }

    job = store.transition(job, 'extracting_audio')
    logSafe('start-processing', job.id)
    res.json({ ok: true, job })

    runProcessingPipeline(job.id, apiKey).catch((err) => {
      logSafe('processing pipeline unexpected error', job.id, err?.name || 'Error')
    })
  })

  // ── 字幕 CRUD ──────────────────────

  router.post('/:id/captions', (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!assertEditable(job, res)) return
    const { startSec, endSec, text, captionType, emphasisText } = req.body ?? {}
    const s = Number(startSec)
    const e = Number(endSec)
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
      return res.status(400).json({ ok: false, message: '開始/終了時刻が不正です（終了は開始より後である必要があります）' })
    }
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ ok: false, message: 'テキストが空です' })
    }
    const type = CAPTION_TYPES.includes(captionType) ? captionType : 'normal'
    const captions = Array.isArray(job.captions) ? [...job.captions] : []
    const newCaption = {
      id: randomUUID(),
      startSec: s,
      endSec: e,
      text: text.trim(),
      captionType: type,
      emphasisText: typeof emphasisText === 'string' && emphasisText.trim() ? emphasisText.trim() : null,
      displayOrder: captions.length,
    }
    captions.push(newCaption)
    job = store.save({ ...job, captions })
    res.json({ ok: true, job })
  })

  router.patch('/:id/captions/:captionId', (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!assertEditable(job, res)) return
    const captions = Array.isArray(job.captions) ? job.captions : []
    const idx = captions.findIndex((c) => c.id === req.params.captionId)
    if (idx === -1) return res.status(404).json({ ok: false, message: '字幕が見つかりません' })

    const { startSec, endSec, text, captionType, emphasisText } = req.body ?? {}
    const next = { ...captions[idx] }
    if (startSec !== undefined) {
      const s = Number(startSec)
      if (!Number.isFinite(s) || s < 0) return res.status(400).json({ ok: false, message: '開始時刻が不正です' })
      next.startSec = s
    }
    if (endSec !== undefined) {
      const e = Number(endSec)
      if (!Number.isFinite(e)) return res.status(400).json({ ok: false, message: '終了時刻が不正です' })
      next.endSec = e
    }
    if (next.endSec <= next.startSec) {
      return res.status(400).json({ ok: false, message: '終了時刻は開始時刻より後である必要があります' })
    }
    if (text !== undefined) {
      if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ ok: false, message: 'テキストが空です' })
      next.text = text.trim()
    }
    if (captionType !== undefined) {
      if (!CAPTION_TYPES.includes(captionType)) return res.status(400).json({ ok: false, message: '不正な captionType です' })
      next.captionType = captionType
    }
    if (emphasisText !== undefined) {
      next.emphasisText = typeof emphasisText === 'string' && emphasisText.trim() ? emphasisText.trim() : null
    }

    const nextCaptions = [...captions]
    nextCaptions[idx] = next
    job = store.save({ ...job, captions: nextCaptions })
    res.json({ ok: true, job })
  })

  router.delete('/:id/captions/:captionId', (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!assertEditable(job, res)) return
    const captions = Array.isArray(job.captions) ? job.captions : []
    const nextCaptions = captions
      .filter((c) => c.id !== req.params.captionId)
      .map((c, i) => ({ ...c, displayOrder: i }))
    job = store.save({ ...job, captions: nextCaptions })
    res.json({ ok: true, job })
  })

  router.post('/:id/captions/reorder', (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!assertEditable(job, res)) return
    const { orderedIds } = req.body ?? {}
    const captions = Array.isArray(job.captions) ? job.captions : []
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length !== captions.length ||
      new Set(orderedIds).size !== captions.length ||
      !orderedIds.every((id) => captions.some((c) => c.id === id))
    ) {
      return res.status(400).json({ ok: false, message: 'orderedIds が不正です（既存の字幕IDと一致しません）' })
    }
    const byId = new Map(captions.map((c) => [c.id, c]))
    const nextCaptions = orderedIds.map((id, i) => ({ ...byId.get(id), displayOrder: i }))
    job = store.save({ ...job, captions: nextCaptions })
    res.json({ ok: true, job })
  })

  router.post('/:id/captions/reset-types', (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!assertEditable(job, res)) return
    const captions = Array.isArray(job.captions) ? job.captions : []
    const nextCaptions = captions.map((c) => ({ ...c, captionType: 'normal' }))
    job = store.save({ ...job, captions: nextCaptions })
    res.json({ ok: true, job })
  })

  // ── レンダー（字幕焼き込み） ──────────────────────

  router.post('/:id/render', async (req, res) => {
    let job = loadJobOr404(req, res)
    if (!job) return
    if (!['ready_for_edit', 'failed', 'completed'].includes(job.status)) {
      return res.status(409).json({ ok: false, message: 'この状態からはレンダーを開始できません' })
    }
    if (!Array.isArray(job.captions) || job.captions.length === 0) {
      return res.status(400).json({ ok: false, message: '字幕が1件もありません' })
    }
    if (activeRenderJobId && activeRenderJobId !== job.id) {
      return res.status(409).json({ ok: false, message: '他のジョブのレンダーが進行中です。完了までお待ちください。' })
    }
    if (!store.acquireLock(job.id)) {
      return res.status(409).json({ ok: false, message: 'このジョブはすでに処理中です' })
    }

    let outputRootReal
    try {
      outputRootReal = validateOutputRoot(getOutputRoot())
    } catch (err) {
      store.releaseLock(job.id)
      return res.status(500).json({ ok: false, message: err.message })
    }

    const estimatedNeeded = Math.max(200 * 1024 * 1024, Number(job.sourceSize || 0) * 1.2)
    const diskCheck = await checkDiskSpace(outputRootReal, estimatedNeeded)
    if (!diskCheck.ok) {
      store.releaseLock(job.id)
      const freeGb = diskCheck.freeBytes ? (diskCheck.freeBytes / 1024 / 1024 / 1024).toFixed(1) : '不明'
      const neededGb = (estimatedNeeded / 1024 / 1024 / 1024).toFixed(1)
      return res.status(507).json({
        ok: false,
        message: `出力先の空き容量が不足している可能性があります（空き: ${freeGb}GB / 推定必要: ${neededGb}GB）`,
      })
    }

    let outputPath
    try {
      outputPath = buildUniqueOutputPath(job.sourceFilename, outputRootReal, job.sourcePath)
    } catch (err) {
      store.releaseLock(job.id)
      return res.status(500).json({ ok: false, message: err.message })
    }

    const fontStatus = await checkJapaneseFontAvailable()

    const tmpRoot = getTmpRoot()
    mkdirSync(tmpRoot, { recursive: true })
    const assPath = resolve(tmpRoot, `${job.id}.ass`)
    try {
      writeFileSync(assPath, buildAssContent(job), 'utf-8')
    } catch (err) {
      store.releaseLock(job.id)
      return res.status(500).json({ ok: false, message: `字幕ファイルの生成に失敗しました: ${err.message}` })
    }

    activeRenderJobId = job.id
    job = store.transition(job, 'rendering', { outputPath, renderProgress: 0 })
    logSafe('render start', job.id)
    res.json({
      ok: true,
      job,
      fontWarning: fontStatus.status !== 'available' ? fontStatus.detail : null,
    })

    burnCaptions({
      sourceRealPath: job.sourcePath,
      assPath,
      outputPath,
      durationSec: job.durationSec,
      onProgress: (percent) => {
        const current = store.load(job.id)
        if (current && current.status === 'rendering') {
          store.save({ ...current, renderProgress: Math.round(percent) })
        }
      },
      onSpawn: (child) => {
        activeRenderChildren.set(job.id, child)
      },
    })
      .then(() => {
        const current = store.load(job.id)
        if (current) {
          store.transition(current, 'completed', { renderedAt: new Date().toISOString(), renderProgress: 100 })
          logSafe('render complete', job.id)
        }
      })
      .catch((err) => {
        const current = store.load(job.id)
        if (!current) return
        try {
          if (existsSync(outputPath)) unlinkSync(outputPath)
        } catch {
          // best effort
        }
        if (err && err.canceled) {
          store.transition(current, 'ready_for_edit', { outputPath: null, renderProgress: null })
          logSafe('render canceled', job.id)
        } else {
          store.transition(current, 'failed', {
            errorMessage: `レンダーに失敗しました: ${err.message}`,
            outputPath: null,
            renderProgress: null,
          })
          logSafe('render failed', job.id)
        }
      })
      .finally(() => {
        activeRenderChildren.delete(job.id)
        if (activeRenderJobId === job.id) activeRenderJobId = null
        store.releaseLock(job.id)
        try {
          if (existsSync(assPath)) unlinkSync(assPath)
        } catch {
          // best effort
        }
      })
  })

  router.post('/:id/render/cancel', (req, res) => {
    const job = store.load(req.params.id)
    if (!job) return res.status(404).json({ ok: false, message: 'ジョブが見つかりません' })
    if (job.status !== 'rendering') {
      return res.status(409).json({ ok: false, message: 'レンダー中ではありません' })
    }
    const child = activeRenderChildren.get(job.id)
    if (!child) {
      return res.status(409).json({ ok: false, message: 'レンダープロセスが見つかりません' })
    }
    child.kill('SIGTERM')
    const killTimer = setTimeout(() => {
      if (activeRenderChildren.has(job.id)) {
        try {
          child.kill('SIGKILL')
        } catch {
          // best effort
        }
      }
    }, 5000)
    child.once('close', () => clearTimeout(killTimer))
    logSafe('render cancel requested', job.id)
    res.json({ ok: true, message: 'キャンセルを要求しました' })
  })

  // ── プレビュー用ストリーミング（Range対応） ──────────────────────

  router.get('/:id/source-stream', (req, res) => {
    const job = store.load(req.params.id)
    if (!job || !job.sourcePath) return res.status(404).json({ ok: false, message: 'ファイルが見つかりません' })
    let real
    try {
      real = validateSourcePath(job.sourcePath, getAllowedInputRoots()).realPath
    } catch {
      return res.status(403).json({ ok: false, message: '元動画への安全なアクセスを確認できませんでした' })
    }
    streamVideoFile(req, res, real)
  })

  router.get('/:id/output-stream', (req, res) => {
    const job = store.load(req.params.id)
    if (!job || !job.outputPath) return res.status(404).json({ ok: false, message: '出力ファイルがありません' })
    let outRoot
    try {
      outRoot = validateOutputRoot(getOutputRoot())
    } catch (err) {
      return res.status(500).json({ ok: false, message: err.message })
    }
    let real
    try {
      real = realpathSync(job.outputPath)
    } catch {
      return res.status(404).json({ ok: false, message: 'ファイルが見つかりません' })
    }
    if (!isInsideAnyRoot(real, [outRoot])) {
      return res.status(403).json({ ok: false, message: 'アクセスが拒否されました' })
    }
    streamVideoFile(req, res, real)
  })

  return router
}
