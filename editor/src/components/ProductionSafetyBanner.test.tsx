import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ProductionSafetyBanner } from './ProductionSafetyBanner'
import type { ReelAiConfig } from '../types'

const normal: ReelAiConfig = { aiMode: 'real', dryRun: false, testImageLimit: null }

function renderBanner(config: Partial<ReelAiConfig>) {
  return render(<ProductionSafetyBanner reelAiConfig={{ ...normal, ...config }} />)
}

// ── 警告バナー ────────────────────────────────────────────────

describe('警告バナー表示', () => {
  it('aiMode=mock のとき警告バナーが表示される', () => {
    renderBanner({ aiMode: 'mock' })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/本番利用前に確認してください/)).toBeInTheDocument()
  })

  it('dryRun=true のとき警告バナーが表示される', () => {
    renderBanner({ dryRun: true })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/本番利用前に確認してください/)).toBeInTheDocument()
  })

  it('testImageLimit が設定されているとき警告バナーが表示される', () => {
    renderBanner({ testImageLimit: 3 })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/本番利用前に確認してください/)).toBeInTheDocument()
  })

  it('複数の開発設定が同時に有効でも警告バナーは1つだけ表示される', () => {
    renderBanner({ aiMode: 'mock', dryRun: true, testImageLimit: 2 })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

// ── 警告バナー内容 ────────────────────────────────────────────

describe('警告バナーの内容', () => {
  it('aiMode=mock のとき Mock タグが表示される', () => {
    renderBanner({ aiMode: 'mock' })
    expect(screen.getByText('Mock（ダミーデータ）')).toBeInTheDocument()
  })

  it('dryRun=true のとき Dry Run タグが表示される', () => {
    renderBanner({ dryRun: true })
    expect(screen.getByText('Dry Run（書き出しスキップ）')).toBeInTheDocument()
  })

  it('testImageLimit=5 のとき枚数タグが表示される', () => {
    renderBanner({ testImageLimit: 5 })
    expect(screen.getByText('上限 5 枚')).toBeInTheDocument()
  })

  it('チェックリスト5項目が表示される', () => {
    renderBanner({ aiMode: 'mock' })
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThanOrEqual(5)
  })
})

// ── OK バナー ─────────────────────────────────────────────────

describe('OK バナー表示', () => {
  it('すべて通常設定のとき OK バナーが表示される', () => {
    renderBanner({})
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/本番利用準備OK/)).toBeInTheDocument()
  })

  it('OK バナーに通常設定の説明文が含まれる', () => {
    renderBanner({})
    expect(screen.getByRole('status')).toHaveTextContent('通常設定')
  })
})

// ── 同時表示されない ──────────────────────────────────────────

describe('警告バナーと OK バナーの排他表示', () => {
  it('開発設定が有効なとき OK バナーが表示されない', () => {
    renderBanner({ aiMode: 'mock' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('すべて通常設定のとき警告バナーが表示されない', () => {
    renderBanner({})
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
