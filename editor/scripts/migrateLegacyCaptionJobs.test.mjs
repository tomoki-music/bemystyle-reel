import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { JobStore } from '../server/lib/jobStore.mjs'
import { migrateJob } from './migrateLegacyCaptionJobs.mjs'

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-legacy-caption-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function legacyJob(overrides = {}) {
  return {
    id: 'job-1',
    title: 'test',
    sourcePath: '/dummy/video.mp4',
    sourceFilename: 'video.mp4',
    sourceSize: 100,
    durationSec: 20,
    width: 1080,
    height: 1920,
    rotation: 0,
    status: 'ready_for_edit',
    errorMessage: null,
    transcriptionNote: null,
    captions: [
      { id: 'c1', startSec: 0, endSec: 10, text: '今日はとても良い天気です。散歩に出かけましょう。公園には花が咲いています。', captionType: 'normal', emphasisText: null, displayOrder: 0 },
      { id: 'c2', startSec: 10, endSec: 20, text: 'これは二つ目のsegmentです。もう少し短めです。', captionType: 'normal', emphasisText: null, displayOrder: 1 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    transcribedAt: new Date().toISOString(),
    renderedAt: null,
    ...overrides,
  }
}

describe('migrateJob (rawSegments が無い旧ジョブの一回限りの移行)', () => {
  it('rawSegmentsが無い旧ジョブを分割し、rawSegmentsに元テキスト・時刻をそのまま保持する', () => {
    const original = legacyJob()
    const { job, migrated } = migrateJob(original)
    expect(migrated).toBe(true)
    expect(job.rawSegments).toHaveLength(2)
    expect(job.rawSegments[0]).toEqual({ startSec: 0, endSec: 10, text: original.captions[0].text })
    expect(job.rawSegments[1]).toEqual({ startSec: 10, endSec: 20, text: original.captions[1].text })

    // 元のcaptions配列オブジェクト自体は書き換えない(破壊的変更をしない)
    expect(original.captions[0].text).toBe('今日はとても良い天気です。散歩に出かけましょう。公園には花が咲いています。')
  })

  it('分割後captionsの全文連結がrawSegmentsの全文連結と完全一致する', () => {
    const { job } = migrateJob(legacyJob())
    const rawConcat = job.rawSegments.map((s) => s.text).join('')
    const capConcat = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder).map((c) => c.text).join('')
    expect(capConcat).toBe(rawConcat)
  })

  it('既にrawSegmentsを持つジョブはスキップする(冪等)', () => {
    const alreadyMigrated = legacyJob({ rawSegments: [{ startSec: 0, endSec: 20, text: 'x' }] })
    const { job, migrated } = migrateJob(alreadyMigrated)
    expect(migrated).toBe(false)
    expect(job).toBe(alreadyMigrated)
  })

  it('captionsが空のジョブはスキップする', () => {
    const empty = legacyJob({ captions: [] })
    const { migrated } = migrateJob(empty)
    expect(migrated).toBe(false)
  })

  it('2回実行しても結果が変わらない(rawSegmentsを上書きしない)', () => {
    const store = new JobStore(dir)
    store.save(legacyJob())

    const first = migrateJob(store.load('job-1'))
    store.save(first.job)
    const afterFirst = store.load('job-1')

    const second = migrateJob(afterFirst)
    expect(second.migrated).toBe(false)
    expect(second.job.rawSegments).toEqual(afterFirst.rawSegments)
  })

  it('このスクリプトはWhisper APIを呼び出さない(openaiTranscriptionをimportしていない)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, 'migrateLegacyCaptionJobs.mjs'), 'utf-8')
    expect(src).not.toMatch(/openaiTranscription/)
    expect(src).not.toMatch(/transcribeAudioFile/)
  })
})
