import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { WizardMode } from './WizardMode'
import type { ScriptHandoff } from '../../types'

// 外部APIへは接続しない。fetch は全てモックし、呼ばれたかどうかを検証する。
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

const deepFreeze = <T,>(o: T): T => { Object.values(o as object).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v) }); return Object.freeze(o) }
const slides14 = Array.from({ length: 14 }, (_, i) => ({ text: `台本のシーン${i + 1}` }))
const FULL: ScriptHandoff = { title: '歌が上手くなる方法', script: '全文', slides: slides14 }
const withSlides = (n: number, title = '可変枚数'): ScriptHandoff => ({ title, script: '全文', slides: Array.from({ length: n }, (_, i) => ({ text: `シーン${i + 1}の本文` })) })
const ROLES = ['オープニング', '問題提起', '共感', 'ポイント①', '解説', 'ポイント②', '実践例', 'ポイント③', '深掘り', 'Before/After', '背中を押す', 'まとめ', 'CTA', 'エンディング']
const roleTexts = () => [...document.querySelectorAll('.wz-story-role')].map((e) => e.textContent)
const cardTexts = () => [...document.querySelectorAll('.wz-story-text')].map((e) => e.textContent)
const nextBtn = () => screen.getByRole('button', { name: /この内容で次へ|次へ →/ }) as HTMLButtonElement

describe('WizardMode: 台本の受け取り（initialScript）', () => {
  it('初期台本なし（通常起動）: 従来どおり STEP1 から。受け渡しの合図も出さない', () => {
    const consumed = vi.fn()
    render(<WizardMode onInitialScriptConsumed={consumed} />)
    expect(screen.getByRole('heading', { name: /どんな動画を作りますか/ })).toBeInTheDocument()
    expect(consumed).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('初期台本あり: タイトルがテーマ、シーンが14枚のカードに入り、STEP2から始まる（AIは呼ばない）', () => {
    const consumed = vi.fn()
    render(<WizardMode initialScript={FULL} onInitialScriptConsumed={consumed} />)
    expect(screen.getByRole('heading', { name: /「歌が上手くなる方法」のストーリー/ })).toBeInTheDocument()
    expect(cardTexts()).toEqual(slides14.map((s) => s.text))
    expect(screen.getByText(/台本から14枚のシーンを作成しました/)).toBeInTheDocument()
    expect(nextBtn()).toBeEnabled()
    expect(consumed).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('分割結果なしの台本は文ごとにカード化する', () => {
    render(<WizardMode initialScript={{ title: 't', script: Array.from({ length: 14 }, (_, i) => `文${i + 1}です。`).join('') }} />)
    expect(cardTexts()[0]).toBe('文1です。')
    expect(cardTexts()[13]).toBe('文14です。')
  })
  it('台本由来のカードは1・8・12・14枚の可変。空カードを作らず、枚数表示が実数になり、次へ進める', () => {
    for (const n of [1, 8, 12, 14]) {
      const { unmount } = render(<WizardMode initialScript={withSlides(n)} />)
      expect(cardTexts()).toEqual(Array.from({ length: n }, (_, i) => `シーン${i + 1}の本文`))
      expect(document.querySelectorAll('.wz-story-card')).toHaveLength(n)
      expect(cardTexts().every((t) => (t ?? '').trim().length > 0)).toBe(true)
      expect(screen.queryByText(/空のシーン/)).toBeNull()
      expect(screen.getByText(new RegExp(`^${n}枚のシーンを確認しましょう`))).toBeInTheDocument()
      expect(screen.getByText('シーン数').nextElementSibling).toHaveTextContent(`${n}枚`)
      expect(screen.getByText('想定時間').nextElementSibling).toHaveTextContent(n === 14 ? '約 45〜60 秒' : `約 ${n * 3} 秒`)
      expect(screen.getByText(new RegExp(`台本から${n}枚のシーンを作成しました`))).toBeInTheDocument()
      expect(nextBtn()).toBeEnabled()
      unmount()
    }
  })
  it('8枚のとき、空カード6枚を作らない（9〜14枚目は存在しない）', () => {
    render(<WizardMode initialScript={withSlides(8)} />)
    expect(document.querySelectorAll('.wz-story-card')).toHaveLength(8)
    expect(screen.queryByText('9')).toBeNull()
  })
  it('roleは全カード有効: 先頭=オープニング・末尾=エンディング・既存の役割だけ・重複なし。14枚は従来と同じ', () => {
    for (const n of [1, 2, 8, 12, 13, 14]) {
      const { unmount } = render(<WizardMode initialScript={withSlides(n)} />)
      const r = roleTexts() as string[]
      expect(r).toHaveLength(n)
      expect(r.every((x) => ROLES.includes(x))).toBe(true)
      expect(new Set(r).size).toBe(n)
      expect(r[0]).toBe('オープニング')
      if (n >= 2) expect(r[n - 1]).toBe('エンディング')
      if (n === 14) expect(r).toEqual(ROLES)
      unmount()
    }
  })
  it('空のシーンを自分で作ってしまった場合は注意を出し、次へ進めない。入力すると進める', () => {
    render(<WizardMode initialScript={withSlides(3)} />)
    fireEvent.click(within(document.querySelectorAll('.wz-story-card')[1] as HTMLElement).getByRole('button', { name: '編集' }))
    fireEvent.change(document.querySelector('.wz-story-text-input') as HTMLTextAreaElement, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText(/空のシーンが1枚あります/)).toBeInTheDocument()
    expect(nextBtn()).toBeDisabled()
    fireEvent.click(within(document.querySelectorAll('.wz-story-card')[1] as HTMLElement).getByRole('button', { name: '編集' }))
    fireEvent.change(document.querySelector('.wz-story-text-input') as HTMLTextAreaElement, { target: { value: '埋めた' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(nextBtn()).toBeEnabled()
  })
  it('通常起動のWizardは従来どおり14枚固定（AI生成が3枚返しても14枚に正規化）', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ story: { slides: [{ headline: 'AI1', subline: '' }, { headline: 'AI2', subline: '' }, { headline: 'AI3', subline: '' }] } }) })
    render(<WizardMode />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'テーマ' } })
    fireEvent.click(screen.getByRole('button', { name: /次へ →/ }))
    await waitFor(() => expect(cardTexts()[0]).toBe('AI1'))
    expect(document.querySelectorAll('.wz-story-card')).toHaveLength(14)
    expect(roleTexts()).toEqual(ROLES)
    expect(screen.getByText(/^14枚のシーンを確認しましょう/)).toBeInTheDocument()
  })
  it('下流: 8枚のまま素材(STEP3)→編集→完成→動画作成まで進め、/api/slides へ8枚だけ（空欄なし・id連番・画像対応）を送る', async () => {
    const posts: { url: string; body?: unknown }[] = []
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === 'POST') posts.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
      const json = url === '/api/upload' ? { ok: true, url: '/assets/uploads/x.png' } : { ok: true, status: 'running' }
      return { ok: true, status: 200, json: async () => json } as unknown as Response
    })
    render(<WizardMode initialScript={withSlides(8)} />)
    fireEvent.click(nextBtn()) // STEP3
    expect(await screen.findByText(/8枚の画像とBGMを準備してください/)).toBeInTheDocument()
    expect(screen.getByText('0 / 8')).toBeInTheDocument()
    expect(screen.queryByText(/\/ 14/)).toBeNull()
    const inputs = () => [...document.querySelectorAll('input[type=file]')] as HTMLInputElement[]
    expect(inputs().length).toBe(9) // 画像8 + BGM1
    for (let i = 0; i < 8; i++) {
      await act(async () => { fireEvent.change(inputs()[i], { target: { files: [new File(['x'], `s${i}.png`, { type: 'image/png' })] } }) })
    }
    await act(async () => { fireEvent.change(inputs()[8], { target: { files: [new File(['x'], 'bgm.mp3', { type: 'audio/mpeg' })] } }) })
    await waitFor(() => expect(screen.getByText('8 / 8')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /動画を作りに進む/ })) // STEP4
    expect(document.querySelectorAll('.wz-scene-thumb')).toHaveLength(8)
    expect(screen.getByText('8枚目をCTAカードにする')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /動画を仕上げる/ })) // STEP5
    fireEvent.click(screen.getByRole('button', { name: /動画を作成する/ }))
    expect(screen.getByText('🖼️ 画像 8枚')).toBeInTheDocument()
    expect(screen.getByText(/動画の長さ：約 24 秒/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '作成する' })) })
    const slidesPost = posts.find((p) => p.url === '/api/slides')!
    const payload = slidesPost.body as { title: string; slides: { id: number; headline: string; image: string; layout: string }[] }
    expect(payload.title).toBe('可変枚数')
    expect(payload.slides).toHaveLength(8)
    expect(payload.slides.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(payload.slides.map((x) => x.headline)).toEqual(Array.from({ length: 8 }, (_, i) => `シーン${i + 1}の本文`))
    expect(payload.slides.every((x) => x.image === '/assets/uploads/x.png' && x.headline.length > 0)).toBe(true)
    expect(posts.some((p) => p.url === '/api/generate-story' || p.url === '/api/split-script')).toBe(false)
  })
  it('初期値を取り込んだ後もWizard内で編集でき、親の再renderで元に戻らない（別の初期台本を渡し直しても上書きしない）', () => {
    const { rerender } = render(<WizardMode initialScript={FULL} />)
    fireEvent.click(within(document.querySelectorAll('.wz-story-card')[0] as HTMLElement).getByRole('button', { name: '編集' }))
    fireEvent.change(document.querySelector('.wz-story-text-input') as HTMLTextAreaElement, { target: { value: 'ユーザーが編集' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(cardTexts()[0]).toBe('ユーザーが編集')
    rerender(<WizardMode initialScript={FULL} />)
    rerender(<WizardMode initialScript={{ title: '別', script: 'x', slides: [{ text: '別のシーン' }] }} />)
    rerender(<WizardMode initialScript={null} />)
    expect(cardTexts()[0]).toBe('ユーザーが編集')
    expect(cardTexts()[1]).toBe('台本のシーン2')
    expect(screen.getByRole('heading', { name: /「歌が上手くなる方法」のストーリー/ })).toBeInTheDocument()
  })
  it('受け取った入力オブジェクトを変更しない（凍結していても動く）', () => {
    const frozen = deepFreeze({ title: 't', script: 's', slides: [{ text: 'a' }, { text: 'b' }] })
    const before = JSON.stringify(frozen)
    render(<WizardMode initialScript={frozen} />)
    expect(JSON.stringify(frozen)).toBe(before)
  })
  it('STEP1へ戻って「次へ」を押しても、テーマが同じならAIで作り直さず台本のカードを保つ', () => {
    render(<WizardMode initialScript={FULL} />)
    fireEvent.click(screen.getByRole('button', { name: /戻る/ }))
    expect(screen.getByRole('heading', { name: /どんな動画を作りますか/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /次へ →/ }))
    expect(cardTexts()).toEqual(slides14.map((s) => s.text))
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('テーマを変えて「次へ」を押した場合は従来どおりAIで作り直す（明示的な操作）', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ story: { slides: [{ headline: 'AIの1枚目', subline: '' }] } }) })
    render(<WizardMode initialScript={FULL} />)
    fireEvent.click(screen.getByRole('button', { name: /戻る/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '別のテーマ' } })
    fireEvent.click(screen.getByRole('button', { name: /次へ →/ }))
    await waitFor(() => expect(cardTexts()[0]).toBe('AIの1枚目'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/generate-story')
  })
  it('8枚の台本から「もう一度作り直す」でAI生成（14枚）に置き換えても、画像枠が14枚へ合う', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ story: { slides: Array.from({ length: 14 }, (_, i) => ({ headline: `AI${i + 1}`, subline: '' })) } }) })
    render(<WizardMode initialScript={withSlides(8)} />)
    fireEvent.click(screen.getByRole('button', { name: /もう一度作り直す/ }))
    await waitFor(() => expect(cardTexts()[0]).toBe('AI1'))
    expect(document.querySelectorAll('.wz-story-card')).toHaveLength(14)
    fireEvent.click(nextBtn())
    expect(await screen.findByText(/14枚の画像とBGMを準備してください/)).toBeInTheDocument()
    expect(screen.getByText('0 / 14')).toBeInTheDocument()
  })
  it('「もう一度作り直す」は従来どおりAIで作り直し、台本のカードを置き換える（注意書きが消える）', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ story: { slides: [{ headline: 'AI生成', subline: '' }] } }) })
    render(<WizardMode initialScript={FULL} />)
    fireEvent.click(screen.getByRole('button', { name: /もう一度作り直す/ }))
    await waitFor(() => expect(cardTexts()[0]).toBe('AI生成'))
    expect(screen.queryByText(/台本から14枚のシーンを作成しました/)).toBeNull()
  })
})
