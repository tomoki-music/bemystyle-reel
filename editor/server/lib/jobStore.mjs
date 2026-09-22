// ローカルAIテロップ動画ジョブの永続化（JSONファイル・1ジョブ1ファイル）と
// ステータス状態遷移の管理。DBは使わず、ディスク上のJSONのみで完結させる。

import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve, basename } from 'path'
import { randomUUID } from 'crypto'

export const STATUSES = [
  'uploaded',
  'probing',
  'extracting_audio',
  'transcribing',
  'ready_for_edit',
  'rendering',
  'completed',
  'failed',
]

// ステータス状態遷移表。ここに無い遷移は assertTransition() が拒否する。
export const ALLOWED_TRANSITIONS = {
  uploaded: ['probing', 'failed'],
  probing: ['ready_for_edit', 'failed'],
  ready_for_edit: ['extracting_audio', 'rendering', 'failed'],
  extracting_audio: ['transcribing', 'failed'],
  transcribing: ['ready_for_edit', 'failed'],
  rendering: ['completed', 'failed', 'ready_for_edit'], // ready_for_edit はキャンセル時の復帰
  completed: ['rendering'], // 完成後の再レンダーを許可（captions編集後の再生成）
  // failed からは、直前に何を試みていたかに応じて呼び出し側が
  // ready_for_edit / probing / extracting_audio へ明示的に再遷移させる（リトライ操作）。
  failed: ['probing', 'extracting_audio', 'ready_for_edit'],
}

// サーバー再起動時に「処理中のまま止まっていた」とみなして failed にするステータス。
export const IN_PROGRESS_STATUSES = ['extracting_audio', 'transcribing', 'rendering']

export class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`不正な状態遷移です: ${from} -> ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

/**
 * @param {string} from
 * @param {string} to
 */
export function assertTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to)
  }
}

export class JobStore {
  /**
   * @param {string} dir JSONファイルを保存するディレクトリ
   */
  constructor(dir) {
    this.dir = dir
    mkdirSync(this.dir, { recursive: true })
    /** @type {Set<string>} 二重実行防止のジョブ単位ロック */
    this.processingLocks = new Set()
  }

  filePathFor(id) {
    const safeId = basename(id)
    if (!safeId || safeId.includes('..') || safeId !== id) {
      throw new Error('不正なジョブIDです')
    }
    return resolve(this.dir, `${safeId}.json`)
  }

  /** @returns {object} 新規ジョブの初期レコード（保存はしない） */
  createInitial(fields) {
    const now = new Date().toISOString()
    return {
      id: randomUUID(),
      title: fields.title ?? fields.sourceFilename ?? 'Untitled',
      sourcePath: fields.sourcePath,
      sourceFilename: fields.sourceFilename,
      sourceSize: fields.sourceSize,
      durationSec: null,
      width: null,
      height: null,
      rotation: null,
      videoCodec: null,
      audioCodec: null,
      container: null,
      hasAudio: null,
      outputPath: null,
      status: 'uploaded',
      errorMessage: null,
      transcriptionNote: null,
      captions: [],
      createdAt: now,
      updatedAt: now,
      transcribedAt: null,
      renderedAt: null,
    }
  }

  save(job) {
    job.updatedAt = new Date().toISOString()
    writeFileSync(this.filePathFor(job.id), JSON.stringify(job, null, 2), 'utf-8')
    return job
  }

  load(id) {
    const p = this.filePathFor(id)
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf-8'))
    } catch {
      return null
    }
  }

  list() {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(resolve(this.dir, f), 'utf-8'))
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  delete(id) {
    const p = this.filePathFor(id)
    if (existsSync(p)) unlinkSync(p)
  }

  /**
   * ステータス遷移を検証しつつ更新して保存する。
   * @param {object} job
   * @param {string} nextStatus
   * @param {object} patch 追加で更新するフィールド
   */
  transition(job, nextStatus, patch = {}) {
    assertTransition(job.status, nextStatus)
    const updated = { ...job, ...patch, status: nextStatus }
    return this.save(updated)
  }

  acquireLock(jobId) {
    if (this.processingLocks.has(jobId)) return false
    this.processingLocks.add(jobId)
    return true
  }

  releaseLock(jobId) {
    this.processingLocks.delete(jobId)
  }

  isLocked(jobId) {
    return this.processingLocks.has(jobId)
  }
}

/**
 * サーバー起動時のクラッシュ復旧: IN_PROGRESS_STATUSES のまま残っているジョブを
 * failed へ強制遷移させる。中途半端な出力ファイルが残っていれば呼び出し側で削除する
 * （このモジュールはファイル削除の判断材料として outputPath を返すのみ）。
 *
 * @param {JobStore} store
 * @returns {Array<{ job: object, staleOutputPath: string | null }>} 復旧処理したジョブ一覧
 */
export function recoverIncompleteJobsOnStartup(store) {
  const recovered = []
  for (const job of store.list()) {
    if (!IN_PROGRESS_STATUSES.includes(job.status)) continue
    const staleOutputPath = job.status === 'rendering' && job.outputPath ? job.outputPath : null
    const updated = {
      ...job,
      status: 'failed',
      errorMessage: 'サーバー再起動により処理が中断されました。もう一度実行してください。',
      outputPath: job.status === 'rendering' ? null : job.outputPath,
    }
    store.save(updated)
    recovered.push({ job: updated, staleOutputPath })
  }
  return recovered
}
