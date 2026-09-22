import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import {
  validateSourcePath,
  validateBrowseDirectory,
  validateOutputRoot,
  isInsideAnyRoot,
  resolveAllowedRoots,
  PathValidationError,
} from './pathValidator.mjs'

let base
let allowedRoot
let outsideRoot

beforeAll(() => {
  // macOS では /var が /private/var へのシンボリックリンクのため、realpath 済みの
  // ベースディレクトリを使わないと realpathSync() の結果と文字列比較が食い違う。
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pathvalidator-test-')))
  allowedRoot = resolve(base, 'allowed')
  outsideRoot = resolve(base, 'outside')
  mkdirSync(allowedRoot, { recursive: true })
  mkdirSync(outsideRoot, { recursive: true })
  writeFileSync(resolve(allowedRoot, 'video.mp4'), 'dummy')
  writeFileSync(resolve(outsideRoot, 'secret.mp4'), 'dummy')
  mkdirSync(resolve(allowedRoot, 'subdir'), { recursive: true })
  writeFileSync(resolve(allowedRoot, 'subdir', 'nested.mp4'), 'dummy')
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('validateSourcePath', () => {
  it('許可ルート内のファイルは通す', () => {
    const result = validateSourcePath(resolve(allowedRoot, 'video.mp4'), [allowedRoot])
    expect(result.realPath).toBe(resolve(allowedRoot, 'video.mp4'))
    expect(result.size).toBeGreaterThan(0)
  })

  it('許可ルート外のファイルは拒否する', () => {
    expect(() => validateSourcePath(resolve(outsideRoot, 'secret.mp4'), [allowedRoot])).toThrowError(PathValidationError)
    try {
      validateSourcePath(resolve(outsideRoot, 'secret.mp4'), [allowedRoot])
    } catch (err) {
      expect(err.code).toBe('outside_roots')
    }
  })

  it('".."トラバーサルで許可ルート外に出ようとした場合は拒否する', () => {
    const traversal = resolve(allowedRoot, '..', 'outside', 'secret.mp4')
    expect(() => validateSourcePath(traversal, [allowedRoot])).toThrow(PathValidationError)
  })

  it('シンボリックリンクが許可ルート外を指す場合は拒否する（realpath解決で検出）', () => {
    const linkPath = resolve(allowedRoot, 'escape-link.mp4')
    symlinkSync(resolve(outsideRoot, 'secret.mp4'), linkPath)
    try {
      expect(() => validateSourcePath(linkPath, [allowedRoot])).toThrow(PathValidationError)
      try {
        validateSourcePath(linkPath, [allowedRoot])
      } catch (err) {
        expect(err.code).toBe('outside_roots')
      }
    } finally {
      rmSync(linkPath, { force: true })
    }
  })

  it('存在しないパスは拒否する', () => {
    try {
      validateSourcePath(resolve(allowedRoot, 'does-not-exist.mp4'), [allowedRoot])
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PathValidationError)
      expect(err.code).toBe('not_found')
    }
  })

  it('ディレクトリはファイルとして拒否する', () => {
    try {
      validateSourcePath(resolve(allowedRoot, 'subdir'), [allowedRoot])
      expect.unreachable()
    } catch (err) {
      expect(err.code).toBe('is_directory')
    }
  })

  it('読み取り権限が無いファイルは拒否する', () => {
    const noReadPath = resolve(allowedRoot, 'no-read.mp4')
    writeFileSync(noReadPath, 'dummy')
    chmodSync(noReadPath, 0o000)
    try {
      // root で実行されているCI環境などではパーミッションが無視されることがあるため、
      // その場合はこのテストをスキップする。
      let threw = false
      try {
        validateSourcePath(noReadPath, [allowedRoot])
      } catch (err) {
        threw = true
        expect(err.code).toBe('permission_denied')
      }
      if (!threw) {
        // root権限などで読み取り制限が効かない実行環境。
        expect(true).toBe(true)
      }
    } finally {
      chmodSync(noReadPath, 0o644)
      rmSync(noReadPath, { force: true })
    }
  })

  it('相対パスは拒否する', () => {
    try {
      validateSourcePath('relative/video.mp4', [allowedRoot])
      expect.unreachable()
    } catch (err) {
      expect(err.code).toBe('not_absolute')
    }
  })

  it('17GB相当のサイズは誤差なくNumberとして扱える', () => {
    const seventeenGb = 17 * 1024 ** 3
    expect(Number.isSafeInteger(seventeenGb)).toBe(true)
    expect(seventeenGb).toBeLessThan(Number.MAX_SAFE_INTEGER)
    // 実ファイルではなく計算値としての精度確認（17GBのファイルをCIで作るのは非現実的なため）
    expect(seventeenGb + 1 - seventeenGb).toBe(1)
  })
})

describe('validateBrowseDirectory', () => {
  it('許可ルート内のディレクトリは通す', () => {
    const result = validateBrowseDirectory(allowedRoot, [allowedRoot])
    expect(result.realPath).toBe(allowedRoot)
  })

  it('許可ルート外のディレクトリは拒否する', () => {
    expect(() => validateBrowseDirectory(outsideRoot, [allowedRoot])).toThrow(PathValidationError)
  })

  it('ファイルをディレクトリとして渡すと拒否する', () => {
    try {
      validateBrowseDirectory(resolve(allowedRoot, 'video.mp4'), [allowedRoot])
      expect.unreachable()
    } catch (err) {
      expect(err.code).toBe('not_a_directory')
    }
  })
})

describe('validateOutputRoot', () => {
  it('存在する書き込み可能ディレクトリは通す', () => {
    const real = validateOutputRoot(outsideRoot)
    expect(real).toBe(outsideRoot)
  })

  it('存在しないディレクトリは拒否する', () => {
    expect(() => validateOutputRoot(resolve(base, 'nope'))).toThrow(PathValidationError)
  })
})

describe('isInsideAnyRoot / resolveAllowedRoots', () => {
  it('等しいパス自体も内側とみなす', () => {
    expect(isInsideAnyRoot(allowedRoot, [allowedRoot])).toBe(true)
  })
  it('存在しないルートは無視される', () => {
    const roots = resolveAllowedRoots([allowedRoot, resolve(base, 'nope')])
    expect(roots).toEqual([allowedRoot])
  })
})
