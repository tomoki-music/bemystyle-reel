import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { checkDiskSpace } from './diskSpace.mjs'

// spawn/statfsSync は依存性注入（deps.spawnFn / deps.statfsSyncFn）でフェイクを渡す。
// vi.mock による組み込みモジュール差し替えはこの環境では確実でないため使わない。

const mockSpawn = vi.fn()

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdout = new EventEmitter()
  }
}

beforeEach(() => {
  mockSpawn.mockReset()
})

const deps = { spawnFn: mockSpawn, statfsSyncFn: undefined } // 常にdfフォールバック経路を通す

describe('checkDiskSpace (df フォールバック経由)', () => {
  it('十分な空きがあればok:true', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = checkDiskSpace('/out', 1000, deps)
    child.stdout.emit(
      'data',
      Buffer.from('Filesystem 1K-blocks Used Available Capacity Mounted\n/dev/disk1 100 10 999999999 1% /\n')
    )
    child.emit('close', 0)
    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.freeBytes).toBeGreaterThan(1000)
  })

  it('空きが不足していればok:false', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = checkDiskSpace('/out', 10 * 1024 ** 3, deps)
    child.stdout.emit('data', Buffer.from('Filesystem 1K-blocks Used Available Capacity Mounted\n/dev/disk1 100 10 100 1% /\n'))
    child.emit('close', 0)
    const result = await promise
    expect(result.ok).toBe(false)
  })

  it('df自体が失敗した場合は判定不能としてok:true（ベストエフォート）を返す', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = checkDiskSpace('/out', 1000, deps)
    child.emit('close', 1)
    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.freeBytes).toBeNull()
  })

  it('statfsSyncが利用可能な場合はそちらを優先する', async () => {
    const statfsSyncFn = vi.fn(() => ({ bavail: 1000, bsize: 4096 }))
    const result = await checkDiskSpace('/out', 1000, { spawnFn: mockSpawn, statfsSyncFn })
    expect(result.freeBytes).toBe(1000 * 4096)
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})
