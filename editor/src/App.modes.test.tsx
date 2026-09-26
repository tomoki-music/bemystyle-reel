import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
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

describe('ScriptMode → Wizard の受け渡し（App）', () => {
  const PATTERNS = [{ title: '教育系', script: '一つ目のシーンです。二つ目のシーンです。三つ目のシーンです。' }, { title: '共感系', script: '共感の台本です。' }]
  const setup = () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/generate-script') return jsonRes({ ok: true, patterns: PATTERNS })
      return jsonRes({ ok: false, message: 'mock', jobs: [], slides: [], items: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const goToWizardFromScriptMode = async () => {
    const fetchMock = setup()
    window.history.pushState({}, '', '/?mode=script')
    await renderApp()
    fireEvent.change(screen.getByLabelText('動画のコンセプト'), { target: { value: '歌が上手くなる方法' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /AIで台本を生成/ })) })
    await screen.findByRole('radiogroup', { name: '台本パターン' })
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    return fetchMock
  }

  it('「この台本で動画を作る」でWizardへ切り替わり、編集済みの台本がカードに入る。URLに本文は入らず、AIも呼ばない', async () => {
    const logs: string[] = []
    for (const m of ['log', 'error', 'warn', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
    localStorage.clear(); sessionStorage.clear()
    const fetchMock = await goToWizardFromScriptMode()
    fireEvent.change(screen.getByLabelText(/台本を編集/), { target: { value: '編集した一つ目です。編集した二つ目です。' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /この台本で動画を作る/ })) })
    expect(await screen.findByRole('heading', { name: /「歌が上手くなる方法」のストーリー/ })).toBeInTheDocument()
    expect(screen.queryByTestId('script-mode')).toBeNull()
    const cards = [...document.querySelectorAll('.wz-story-text')].map((e) => e.textContent)
    expect(cards).toEqual(['編集した一つ目です。', '編集した二つ目です。']) // 空カードで14枚に水増ししない
    expect(document.querySelectorAll('.wz-story-card')).toHaveLength(2)
    expect(cards.join('')).not.toContain('三つ目のシーンです') // 編集前の本文は渡らない
    expect(window.location.search).toBe('')
    expect(decodeURIComponent(window.location.href)).not.toContain('編集した')
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain('/api/generate-story')
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain('/api/split-script') // ボタンだけで追加のAPIは呼ばない
    // 本文はURL・localStorage・sessionStorage・ログのどこにも入らない
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain('編集した')
    expect(logs.join('\n')).not.toContain('編集した')
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/generate-script')).toHaveLength(1)
  })
  it('受け渡し後にWizardを再renderしても、ScriptModeへ戻らず台本のカードが保たれる', async () => {
    await goToWizardFromScriptMode()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /この台本で動画を作る/ })) })
    await screen.findByRole('heading', { name: /「歌が上手くなる方法」のストーリー/ })
    fireEvent.click(within(document.querySelectorAll('.wz-story-card')[0] as HTMLElement).getByRole('button', { name: '編集' }))
    fireEvent.change(document.querySelector('.wz-story-text-input') as HTMLTextAreaElement, { target: { value: 'Wizardで編集' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect([...document.querySelectorAll('.wz-story-text')][0].textContent).toBe('Wizardで編集')
  })
  it('通常起動では、Wizardに受け渡しはなくSTEP1（従来どおり）', async () => {
    setup()
    window.history.pushState({}, '', '/')
    await renderApp()
    expect(await screen.findByRole('heading', { name: /どんな動画を作りますか/ })).toBeInTheDocument()
    expect(screen.queryByText(/台本から\d+枚のシーン/)).toBeNull()
  })
})
