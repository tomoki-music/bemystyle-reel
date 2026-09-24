import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CompositionSettingsPanel, describeAsset, type CompositionOverrides } from './CompositionSettingsPanel'

const status = (over: Partial<{ bgmOk: boolean; qrOk: boolean; env: boolean }> = {}) => ({
  ok: true,
  config: {
    digest: { enabled: true, durationSec: 26, grayscale: true, bgm: { volume: 0.05, fadeInSec: 1.2, fadeOutSec: 2, credit: { title: 'The maze of aqua', composer: '蒲鉾さちこ（Kamaboko Sachiko）' } } },
    lineIntro: { enabled: true, durationSec: 30, showQr: false },
    lineOutro: { enabled: true, durationSec: 12, showQr: true },
    preview: { digest: false, lineIntro: false, lineOutro: false },
  },
  assets: {
    bgm: over.bgmOk === false ? { ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null } : { ok: true, error: null, sizeBytes: 100, durationSec: 63.9, width: null, height: null },
    qr: over.qrOk === false ? { ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null } : { ok: true, error: null, sizeBytes: 100, durationSec: null, width: 554, height: 518 },
  },
  validation: { ok: true, errors: [] },
  configuredByEnv: over.env ?? true,
})

afterEach(() => { vi.unstubAllGlobals() })
const stub = (s: unknown) => {
  const calls: Array<{ url: string; body: string }> = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push({ url, body: String(init?.body ?? '') }); return { json: async () => s } })
  return calls
}

describe('CompositionSettingsPanel', () => {
  it('describeAsset: 素材の確認結果（BGMは長さ、QRは寸法）', () => {
    expect(describeAsset({ ok: true, error: null, sizeBytes: 1, durationSec: 63.9, width: null, height: null }, 'bgm')).toContain('64秒')
    expect(describeAsset({ ok: true, error: null, sizeBytes: 1, durationSec: null, width: 554, height: 518 }, 'qr')).toContain('554×518')
    expect(describeAsset({ ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null }, 'qr')).toContain('未設定')
  })

  it('既定のON/秒数・素材の確認・QRプレビュー・BGMクレジット・プレビュー既定OFFを表示する。パスは表示しない', async () => {
    stub(status())
    render(<CompositionSettingsPanel value={{}} onChange={() => {}} />)
    await screen.findByTestId('composition-settings-panel')
    expect((screen.getByLabelText('ダイジェストON') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('冒頭LINE案内ON') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('末尾LINE案内ON') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('冒頭LINE案内秒数') as HTMLInputElement).value).toBe('30')
    expect(screen.getByText(/BGM素材: 確認済み/)).toBeTruthy()
    expect(screen.getByText(/QR画像: 確認済み（554×518px）/)).toBeTruthy()
    expect(screen.getByAltText('LINE友だち登録QRのプレビュー')).toBeTruthy()
    expect(screen.getByText(/The maze of aqua/)).toBeTruthy()
    for (const k of ['digest', 'lineIntro', 'lineOutro']) expect((screen.getByLabelText(`プレビューに${k}`) as HTMLInputElement).checked).toBe(false)
    expect(document.body.textContent).not.toMatch(/\/Users\/|\.mp3|\.png/)
  })

  it('素材が未設定なら、QRプレビューを出さず「未確認」を表示する', async () => {
    stub(status({ qrOk: false, bgmOk: false, env: false }))
    render(<CompositionSettingsPanel value={{}} onChange={() => {}} />)
    await screen.findByTestId('composition-settings-panel')
    expect(screen.queryByAltText('LINE友だち登録QRのプレビュー')).toBeNull()
    expect(screen.getByText(/BGM素材: 未確認（未設定）/)).toBeTruthy()
    expect((screen.getByLabelText('構成を追加する') as HTMLInputElement).checked).toBe(false) // 素材未設定なら既定では適用されない
  })

  it('ON/OFFの変更は上書きとして親へ渡り、状態APIへ送られる（素材パスは送らない）', async () => {
    const calls = stub(status())
    const changes: Array<CompositionOverrides & { useComposition?: boolean }> = []
    render(<CompositionSettingsPanel value={{}} onChange={(v) => changes.push(v)} />)
    await screen.findByTestId('composition-settings-panel')
    fireEvent.click(screen.getByLabelText('ダイジェストON'))
    expect(changes[0].digest?.enabled).toBe(false)
    fireEvent.change(screen.getByLabelText('末尾LINE案内秒数'), { target: { value: '15' } })
    expect(changes[1].lineOutro?.durationSec).toBe(15)
    fireEvent.click(screen.getByLabelText('構成を追加する'))
    expect(changes[2].useComposition).toBe(false)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0].url).toContain('/composition/status')
    expect(calls[0].body).not.toMatch(/path|qrPath/i)
  })
})
