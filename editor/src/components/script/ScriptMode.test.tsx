import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ScriptMode } from './ScriptMode'

// 外部APIへは一切接続しない。fetch は全てモック。
const PATTERNS = [
  { title: '教育系', script: '教育系の台本です。' },
  { title: '共感系', script: '共感系の台本です。' },
  { title: '煽り系', script: '煽り系の台本です。' },
]
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const deferred = () => { let resolve!: (v: Response) => void; const promise = new Promise<Response>((r) => { resolve = r }); return { promise, resolve } }

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const concept = () => screen.getByLabelText('動画のコンセプト') as HTMLTextAreaElement
const generateBtn = () => screen.getByRole('button', { name: /AIで台本を生成|再生成|生成中/ }) as HTMLButtonElement
const generateOk = async (text = '歌が上手くなる方法') => {
  fetchMock.mockResolvedValueOnce(res(200, { ok: true, patterns: PATTERNS }))
  fireEvent.change(concept(), { target: { value: text } })
  fireEvent.click(generateBtn())
  await screen.findByRole('radiogroup', { name: '台本パターン' })
}

describe('ScriptMode', () => {
  it('開ける・日本語を入力できる・入力が空なら生成ボタンは押せない', () => {
    render(<ScriptMode />)
    expect(screen.getByRole('heading', { name: /台本作成/ })).toBeInTheDocument()
    expect(generateBtn()).toBeDisabled()
    fireEvent.change(concept(), { target: { value: 'ボイトレ初心者向け' } })
    expect(concept().value).toBe('ボイトレ初心者向け')
    expect(generateBtn()).toBeEnabled()
    fireEvent.change(concept(), { target: { value: '   ' } })
    expect(generateBtn()).toBeDisabled()
  })
  it('例チップでコンセプトへ追記できる', () => {
    render(<ScriptMode />)
    fireEvent.click(screen.getByRole('button', { name: '音程改善の秘訣' }))
    fireEvent.click(screen.getByRole('button', { name: '無料診断キャンペーン' }))
    expect(concept().value).toBe('音程改善の秘訣\n無料診断キャンペーン')
  })
  it('生成成功: 3パターンを表示し、トリム済みコンセプトを /api/generate-script へ送る', async () => {
    render(<ScriptMode />)
    await generateOk('  歌が上手くなる方法  ')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/generate-script')
    expect(JSON.parse(init.body)).toEqual({ concept: '歌が上手くなる方法' })
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText('教育系の台本です。')).toBeInTheDocument()
  })
  it('処理中は多重送信できず、入力とボタンが無効になる（連打しても1回だけ送る）', async () => {
    const d = deferred()
    fetchMock.mockReturnValueOnce(d.promise)
    render(<ScriptMode />)
    fireEvent.change(concept(), { target: { value: 'テーマ' } })
    fireEvent.click(generateBtn())
    fireEvent.click(generateBtn())
    fireEvent.click(generateBtn())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(generateBtn()).toBeDisabled()
    expect(generateBtn()).toHaveTextContent('生成中')
    expect(concept()).toBeDisabled()
    d.resolve(res(200, { ok: true, patterns: PATTERNS }))
    await screen.findByRole('radiogroup', { name: '台本パターン' })
    expect(generateBtn()).toBeEnabled()
  })
  it('生成エラーを表示し、入力を保持する。サーバーのメッセージをそのまま出す', async () => {
    fetchMock.mockResolvedValueOnce(res(500, { ok: false, message: 'OPENAI_API_KEY が設定されていません。' }))
    render(<ScriptMode />)
    fireEvent.change(concept(), { target: { value: '大事な入力' } })
    fireEvent.click(generateBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('OPENAI_API_KEY が設定されていません。')
    expect(concept().value).toBe('大事な入力')
    expect(generateBtn()).toBeEnabled()
  })
  it('通信失敗・非JSON応答でも分かりやすいエラーを出す', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<ScriptMode />)
    fireEvent.change(concept(), { target: { value: 'a' } })
    fireEvent.click(generateBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('接続できませんでした')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('x') } } as unknown as Response)
    fireEvent.click(generateBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('HTTP 502'))
  })
  it('選択 → 編集でき、編集内容が反映される。元に戻せる', async () => {
    render(<ScriptMode />)
    await generateOk()
    fireEvent.click(screen.getByRole('radio', { name: /共感系/ }))
    const editor = screen.getByLabelText(/台本を編集/) as HTMLTextAreaElement
    expect(editor.value).toBe('共感系の台本です。')
    fireEvent.change(editor, { target: { value: '編集した台本です。' } })
    expect((screen.getByLabelText(/台本を編集/) as HTMLTextAreaElement).value).toBe('編集した台本です。')
    expect(screen.getByRole('radio', { name: /共感系（編集済み）/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    fireEvent.click(screen.getByRole('radio', { name: /共感系/ }))
    expect((screen.getByLabelText(/台本を編集/) as HTMLTextAreaElement).value).toBe('編集した台本です。') // 切り替えても保持
    fireEvent.click(screen.getByRole('button', { name: /元の台本に戻す/ }))
    expect((screen.getByLabelText(/台本を編集/) as HTMLTextAreaElement).value).toBe('共感系の台本です。')
  })
  it('分割: 編集後の台本を /api/split-script へ送り、結果を表示。処理中は多重送信不可', async () => {
    render(<ScriptMode />)
    await generateOk()
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    fireEvent.change(screen.getByLabelText(/台本を編集/), { target: { value: '編集済みの台本' } })
    const d = deferred()
    fetchMock.mockReturnValueOnce(d.promise)
    const btn = screen.getByRole('button', { name: /スライド単位に分割/ })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(fetchMock).toHaveBeenCalledTimes(2) // 生成1回 + 分割1回
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/split-script')
    expect(JSON.parse(init.body)).toEqual({ script: '編集済みの台本' })
    expect(screen.getByRole('button', { name: /分割中/ })).toBeDisabled()
    d.resolve(res(200, { ok: true, slides: [{ text: '冒頭フック' }, { text: '本題' }, { text: 'まとめ' }] }))
    const region = await screen.findByRole('region', { name: '分割結果' })
    expect(within(region).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['冒頭フック', '本題', 'まとめ'])
    expect(within(region).getByText(/3枚/)).toBeInTheDocument()
  })
  it('分割後に台本を編集すると「分割し直してください」を表示する', async () => {
    render(<ScriptMode />)
    await generateOk()
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, slides: [{ text: 'a' }] }))
    fireEvent.click(screen.getByRole('button', { name: /スライド単位に分割/ }))
    await screen.findByRole('region', { name: '分割結果' })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(screen.getByLabelText(/台本を編集/), { target: { value: '変えた' } })
    expect(screen.getByRole('status')).toHaveTextContent('分割し直して')
  })
  it('分割エラーでも、入力・生成済みの台本・編集内容・以前の分割結果を失わない', async () => {
    render(<ScriptMode />)
    await generateOk('残したいコンセプト')
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    fireEvent.change(screen.getByLabelText(/台本を編集/), { target: { value: '残したい編集' } })
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, slides: [{ text: '前回の分割' }] }))
    fireEvent.click(screen.getByRole('button', { name: /スライド単位に分割/ }))
    await screen.findByText('前回の分割')
    fetchMock.mockResolvedValueOnce(res(502, { ok: false, message: 'OpenAI側で一時的なエラーが発生しました。' }))
    fireEvent.click(screen.getByRole('button', { name: /スライド単位に分割/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('一時的なエラー'))
    expect(concept().value).toBe('残したいコンセプト')
    expect((screen.getByLabelText(/台本を編集/) as HTMLTextAreaElement).value).toBe('残したい編集')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText('前回の分割')).toBeInTheDocument()
  })
  it('再生成が失敗しても、既存の台本と編集を失わない', async () => {
    render(<ScriptMode />)
    await generateOk()
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    fireEvent.change(screen.getByLabelText(/台本を編集/), { target: { value: '編集した台本' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockResolvedValueOnce(res(504, { ok: false, message: 'AIの応答がタイムアウトしました。もう一度お試しください。' }))
    fireEvent.click(generateBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('タイムアウト'))
    expect((screen.getByLabelText(/台本を編集/) as HTMLTextAreaElement).value).toBe('編集した台本')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })
  it('編集がある状態での再生成は確認を挟み、キャンセルなら送信しない', async () => {
    render(<ScriptMode />)
    await generateOk()
    fireEvent.click(screen.getByRole('radio', { name: /教育系/ }))
    fireEvent.change(screen.getByLabelText(/台本を編集/), { target: { value: '編集' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(generateBtn())
    expect(confirm).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('コンセプトが長すぎると生成できない', () => {
    render(<ScriptMode />)
    fireEvent.change(concept(), { target: { value: 'あ'.repeat(1001) } })
    expect(generateBtn()).toBeDisabled()
    expect(screen.getByText(/1001 \/ 1000/)).toBeInTheDocument()
  })
  it('コピー: クリップボードへ編集後の台本を書き込む', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ScriptMode />)
    await generateOk()
    fireEvent.click(screen.getByRole('radio', { name: /煽り系/ }))
    fireEvent.click(screen.getByRole('button', { name: /台本をコピー/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('煽り系の台本です。'))
  })
  it('戻るボタンで onClose を呼ぶ（onClose が無ければ表示しない）', () => {
    const onClose = vi.fn()
    const { unmount } = render(<ScriptMode onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /戻る/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    render(<ScriptMode />)
    expect(screen.queryByRole('button', { name: /戻る/ })).toBeNull()
  })
})
