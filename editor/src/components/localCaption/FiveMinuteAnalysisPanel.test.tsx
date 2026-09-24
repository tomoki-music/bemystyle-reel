import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { FiveMinuteAnalysisPanel, formatClock } from './FiveMinuteAnalysisPanel'

const payload = {
  ok: true,
  captions: [
    { id: 'natural-000', startSec: 0, endSec: 2, text: 'メンバーとの距離がとても大事です' },
    { id: 'natural-001', startSec: 3, endSec: 5, text: 'ライブの準備は絶対に必要です' },
  ],
  analysis: {
    topics: [{ id: 'topic-001', title: 'メンバーとの距離の取り方', startCaptionId: 'natural-000', endCaptionId: 'natural-001', source: 'ai', decision: 'accepted' }],
    emphasis: [{ captionId: 'natural-000', emphasisText: 'とても大事', category: 'keyword', source: 'ai', decision: 'accepted' }],
  },
  sections: [{ id: 'topic-001' }],
  emphasisCount: 1,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = handler(url, init)
    return { status: r.status ?? 200, json: async () => r.body }
  })
  return calls
}

describe('FiveMinuteAnalysisPanel', () => {
  it('formatClock は m:ss に整形し、不正値は 0:00', () => {
    expect(formatClock(75.4)).toBe('1:15')
    expect(formatClock(-1)).toBe('0:00')
  })

  it('データが無い(404/409)ときは何も表示しない', async () => {
    stubFetch(() => ({ status: 404, body: { ok: false } }))
    const { container } = render(<FiveMinuteAnalysisPanel jobId="job1" />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('AI候補のテーマ・強調を「AI候補」バッジ付きで表示し、絶対パスやAPIキーを出さない', async () => {
    stubFetch(() => ({ body: payload }))
    const { container } = render(<FiveMinuteAnalysisPanel jobId="job1" />)
    await screen.findByTestId('five-minute-analysis-panel')
    expect(screen.getAllByText('AI候補').length).toBe(2)
    expect((screen.getByLabelText('topic-001 テーマ名') as HTMLInputElement).value).toBe('メンバーとの距離の取り方')
    expect(container.textContent).not.toMatch(/\/Users\/|\/private\/|sk-[A-Za-z0-9]|OPENAI_API_KEY/)
  })

  it('テーマ名を編集すると PATCH /topics/:id を送る', async () => {
    const calls = stubFetch(() => ({ body: payload }))
    render(<FiveMinuteAnalysisPanel jobId="job1" />)
    const input = (await screen.findByLabelText('topic-001 テーマ名')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'メンバーとの付き合い方' } })
    fireEvent.blur(input)
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('/api/local-caption-videos/job1/five-minute/topics/topic-001')
    expect(JSON.parse(String(patch.init?.body))).toEqual({ title: 'メンバーとの付き合い方' })
  })

  it('AI候補のテーマを却下でき、強調を削除・追加できる', async () => {
    const calls = stubFetch(() => ({ body: payload }))
    render(<FiveMinuteAnalysisPanel jobId="job1" />)
    fireEvent.click(await screen.findByText('却下する'))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/topics/topic-001/decision'))).toBe(true))
    fireEvent.click(screen.getByText('削除'))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true))
    fireEvent.change(screen.getByLabelText('強調を追加するcaption'), { target: { value: 'natural-001' } })
    fireEvent.change(screen.getByLabelText('追加する強調語'), { target: { value: '絶対に必要' } })
    fireEvent.click(screen.getByText('強調を追加'))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT' && c.url.endsWith('/emphasis/natural-001'))).toBe(true))
  })

  it('サーバーが修正を拒否したら、メッセージを表示する', async () => {
    stubFetch((url, init) => (init?.method === 'PATCH' ? { body: { ok: false, message: 'タイトルが空です' } } : { body: payload }))
    render(<FiveMinuteAnalysisPanel jobId="job1" />)
    const input = (await screen.findByLabelText('topic-001 テーマ名')) as HTMLInputElement
    fireEvent.change(input, { target: { value: ' ' } })
    fireEvent.blur(input)
    expect(await screen.findByRole('alert')).toHaveTextContent('タイトルが空です')
  })
})
