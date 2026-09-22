import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  JobStore,
  assertTransition,
  InvalidTransitionError,
  recoverIncompleteJobsOnStartup,
  IN_PROGRESS_STATUSES,
} from './jobStore.mjs'

let dir
let store

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobstore-test-'))
  store = new JobStore(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('assertTransition (状態遷移表)', () => {
  it('正しい遷移は許可する', () => {
    expect(() => assertTransition('uploaded', 'probing')).not.toThrow()
    expect(() => assertTransition('probing', 'ready_for_edit')).not.toThrow()
    expect(() => assertTransition('ready_for_edit', 'rendering')).not.toThrow()
    expect(() => assertTransition('rendering', 'completed')).not.toThrow()
  })

  it('不正な遷移は拒否する', () => {
    expect(() => assertTransition('uploaded', 'completed')).toThrow(InvalidTransitionError)
    expect(() => assertTransition('completed', 'extracting_audio')).toThrow(InvalidTransitionError)
    expect(() => assertTransition('ready_for_edit', 'transcribing')).toThrow(InvalidTransitionError)
  })
})

describe('JobStore CRUD', () => {
  it('作成・保存・読み込みができる', () => {
    let job = store.createInitial({
      sourcePath: '/allowed/video.mp4',
      sourceFilename: 'video.mp4',
      sourceSize: 123,
    })
    store.save(job)
    const loaded = store.load(job.id)
    expect(loaded.status).toBe('uploaded')
    expect(loaded.sourceFilename).toBe('video.mp4')
  })

  it('存在しないジョブはnullを返す', () => {
    expect(store.load('does-not-exist')).toBeNull()
  })

  it('transitionは不正な遷移を拒否する', () => {
    const job = store.createInitial({ sourcePath: '/a.mp4', sourceFilename: 'a.mp4', sourceSize: 1 })
    store.save(job)
    expect(() => store.transition(job, 'completed')).toThrow(InvalidTransitionError)
  })

  it('ロックは二重取得できない', () => {
    const job = store.createInitial({ sourcePath: '/a.mp4', sourceFilename: 'a.mp4', sourceSize: 1 })
    store.save(job)
    expect(store.acquireLock(job.id)).toBe(true)
    expect(store.acquireLock(job.id)).toBe(false)
    store.releaseLock(job.id)
    expect(store.acquireLock(job.id)).toBe(true)
  })

  it('list()はcreatedAt降順で返す', () => {
    const j1 = store.createInitial({ sourcePath: '/a.mp4', sourceFilename: 'a.mp4', sourceSize: 1 })
    j1.createdAt = '2024-01-01T00:00:00.000Z'
    store.save(j1)
    const j2 = store.createInitial({ sourcePath: '/b.mp4', sourceFilename: 'b.mp4', sourceSize: 1 })
    j2.createdAt = '2024-06-01T00:00:00.000Z'
    store.save(j2)
    const list = store.list()
    expect(list[0].id).toBe(j2.id)
    expect(list[1].id).toBe(j1.id)
  })
})

describe('recoverIncompleteJobsOnStartup', () => {
  it('extracting_audio/transcribing/renderingのジョブをfailedへ強制遷移する', () => {
    const j1 = store.createInitial({ sourcePath: '/a.mp4', sourceFilename: 'a.mp4', sourceSize: 1 })
    j1.status = 'extracting_audio'
    store.save(j1)

    const j2 = store.createInitial({ sourcePath: '/b.mp4', sourceFilename: 'b.mp4', sourceSize: 1 })
    j2.status = 'transcribing'
    store.save(j2)

    const j3 = store.createInitial({ sourcePath: '/c.mp4', sourceFilename: 'c.mp4', sourceSize: 1 })
    j3.status = 'rendering'
    j3.outputPath = resolve(dir, 'partial-output.mp4')
    writeFileSync(j3.outputPath, 'partial')
    store.save(j3)

    const j4 = store.createInitial({ sourcePath: '/d.mp4', sourceFilename: 'd.mp4', sourceSize: 1 })
    j4.status = 'ready_for_edit' // 処理中ではないので対象外
    store.save(j4)

    const recovered = recoverIncompleteJobsOnStartup(store)
    expect(recovered.length).toBe(3)

    for (const status of IN_PROGRESS_STATUSES) {
      expect(recovered.some((r) => store.load(r.job.id) === null)).toBe(false)
    }

    expect(store.load(j1.id).status).toBe('failed')
    expect(store.load(j1.id).errorMessage).toContain('サーバー再起動')
    expect(store.load(j2.id).status).toBe('failed')
    expect(store.load(j3.id).status).toBe('failed')
    expect(store.load(j3.id).outputPath).toBeNull()
    expect(store.load(j4.id).status).toBe('ready_for_edit') // 変化しない

    // 中途半端な出力ファイルの削除は呼び出し側(routes)の責務。ここではstaleOutputPathとして返す。
    const j3Recovered = recovered.find((r) => r.job.id === j3.id)
    expect(j3Recovered.staleOutputPath).toBe(j3.outputPath)
    expect(existsSync(j3Recovered.staleOutputPath)).toBe(true) // jobStore自体はファイル削除しない
  })
})
