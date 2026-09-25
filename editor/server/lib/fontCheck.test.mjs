import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { checkJapaneseFontAvailable } from './fontCheck.mjs'

// spawn は依存性注入（deps.spawnFn）でフェイクを渡す。
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

describe('checkJapaneseFontAvailable', () => {
  it('argv形式で fc-list :lang=ja を呼び出す', async () => {
    const child = new FakeChild()
    mockSpawn.mockImplementation((cmd, args) => {
      expect(cmd).toBe('fc-list')
      expect(args).toEqual([':lang=ja'])
      return child
    })
    const promise = checkJapaneseFontAvailable({ spawnFn: mockSpawn })
    child.stdout.emit('data', Buffer.from('/System/Library/Fonts/NotoSansCJK.ttc: Noto Sans CJK JP\n'))
    child.emit('close', 0)
    const result = await promise
    expect(result.status).toBe('available')
  })

  it('フォントが見つからない場合はmissing', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = checkJapaneseFontAvailable({ spawnFn: mockSpawn })
    child.emit('close', 0)
    const result = await promise
    expect(result.status).toBe('missing')
  })

  it('fc-listが存在しない(spawnエラー)場合はunknownとして扱い、ハードエラーにしない', async () => {
    const child = new FakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = checkJapaneseFontAvailable({ spawnFn: mockSpawn })
    child.emit('error', new Error('ENOENT'))
    const result = await promise
    expect(result.status).toBe('unknown')
  })

  it('spawn自体が例外を投げても拒否せずunknownを返す', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn EACCES')
    })
    const result = await checkJapaneseFontAvailable({ spawnFn: mockSpawn })
    expect(result.status).toBe('unknown')
  })
})
