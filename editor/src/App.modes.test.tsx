import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import App from './App'

// 画面切り替え（?mode=）の回帰テスト。APIはすべてモックし、外部へは接続しない。
// 起動時の非同期取得（fetch）による状態更新を待ってから検証する
const renderApp = async () => { await act(async () => { render(<App />) }) }
const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: false, message: 'mock', jobs: [], slides: [], items: [] })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('App の ?mode= 切り替え', () => {
  it('?mode=script で台本作成モードが開く', async () => {
    window.history.pushState({}, '', '/?mode=script')
    await renderApp()
    expect(screen.getByTestId('script-mode')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /台本作成/ })).toBeInTheDocument()
  })
  it('?mode=local-caption では従来どおりローカル字幕モードが開き、台本作成モードは開かない', async () => {
    window.history.pushState({}, '', '/?mode=local-caption')
    await renderApp()
    expect(screen.queryByTestId('script-mode')).toBeNull()
    expect(document.querySelector('[class*="lcv"]')).not.toBeNull()
  })
  it('modeなしでは台本作成モードもローカル字幕モードも開かない（既存の画面のまま）', async () => {
    window.history.pushState({}, '', '/')
    await renderApp()
    expect(screen.queryByTestId('script-mode')).toBeNull()
  })
  it('台本作成モードの「戻る」で通常画面のURLへ戻る（modeパラメータなし）', async () => {
    window.history.pushState({}, '', '/?mode=script')
    const assign = vi.fn()
    const orig = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, search: orig.search, pathname: orig.pathname, assign } })
    try {
      await renderApp()
      fireEvent.click(screen.getByRole('button', { name: /戻る/ }))
      expect(assign).toHaveBeenCalledWith('/')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: orig })
    }
  })
})
