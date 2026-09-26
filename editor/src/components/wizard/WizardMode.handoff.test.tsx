import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { WizardMode } from './WizardMode'
import type { ScriptHandoff } from '../../types'

// 外部APIへは接続しない。fetch は全てモックし、呼ばれたかどうかを検証する。
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

const deepFreeze = <T,>(o: T): T => { Object.values(o as object).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v) }); return Object.freeze(o) }
const slides14 = Array.from({ length: 14 }, (_, i) => ({ text: `台本のシーン${i + 1}` }))
const FULL: ScriptHandoff = { title: '歌が上手くなる方法', script: '全文', slides: slides14 }
const SHORT: ScriptHandoff = { title: '短い台本', script: '一つ目の文です。二つ目の文です。', slides: [{ text: '一つ目' }, { text: '二つ目' }] }
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
  it('空のシーンがあるときは注意を出し、次へ進めない。編集して埋めると進める', () => {
    render(<WizardMode initialScript={SHORT} />)
    expect(screen.getByText(/空のシーンが12枚あります/)).toBeInTheDocument()
    expect(nextBtn()).toBeDisabled()
    const cards = document.querySelectorAll('.wz-story-card')
    for (let i = 2; i < 14; i++) {
      fireEvent.click(within(cards[i] as HTMLElement).getByRole('button', { name: '編集' }))
      fireEvent.change(document.querySelector('.wz-story-text-input') as HTMLTextAreaElement, { target: { value: `追加${i + 1}` } })
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    }
    expect(screen.queryByText(/空のシーンが/)).toBeNull()
    expect(nextBtn()).toBeEnabled()
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
  it('「もう一度作り直す」は従来どおりAIで作り直し、台本のカードを置き換える（注意書きが消える）', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ story: { slides: [{ headline: 'AI生成', subline: '' }] } }) })
    render(<WizardMode initialScript={FULL} />)
    fireEvent.click(screen.getByRole('button', { name: /もう一度作り直す/ }))
    await waitFor(() => expect(cardTexts()[0]).toBe('AI生成'))
    expect(screen.queryByText(/台本から14枚のシーンを作成しました/)).toBeNull()
  })
})
