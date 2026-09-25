import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CompositionSettingsPanel, describeAsset, describeMainBgmAsset, MAIN_BGM_VOLUME_MAX, type CompositionOverrides } from './CompositionSettingsPanel'

const mainBgmAsset = { ok: true, error: null, fileName: 'my-song.mp3', sizeBytes: 5_000_000, durationSec: 63.9, sampleRate: 44100, channels: 2 }
const status = (over: Partial<{ bgmOk: boolean; qrOk: boolean; env: boolean; mainBgm: boolean; mainBgmFile: boolean }> = {}) => ({
  ok: true,
  config: {
    digest: { enabled: true, durationSec: 26, grayscale: true, bgm: { volume: 0.05, fadeInSec: 1.2, fadeOutSec: 2, credit: { title: 'The maze of aqua', composer: '蒲鉾さちこ（Kamaboko Sachiko）' } } },
    lineIntro: { enabled: true, durationSec: 30, showQr: false },
    lineOutro: { enabled: true, durationSec: 12, showQr: true },
    preview: { digest: false, lineIntro: false, lineOutro: false },
    mainBgm: { enabled: over.mainBgm ?? false, volume: 0.03, autoGain: true, ducking: true, loop: true, fadeInSec: 1.5, fadeOutSec: 2.5 },
  },
  assets: {
    mainBgm: over.mainBgmFile ? mainBgmAsset : { ok: false, error: '未設定', fileName: null, sizeBytes: null, durationSec: null, sampleRate: null, channels: null },
    bgm: over.bgmOk === false ? { ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null } : { ok: true, error: null, sizeBytes: 100, durationSec: 63.9, width: null, height: null },
    qr: over.qrOk === false ? { ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null } : { ok: true, error: null, sizeBytes: 100, durationSec: null, width: 554, height: 518 },
  },
  validation: { ok: true, errors: [] },
  configuredByEnv: over.env ?? true,
})

afterEach(() => { vi.unstubAllGlobals() })
const last = <T,>(a: T[]): T | undefined => a[a.length - 1]
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

  describe('本編BGM', () => {
    it('describeMainBgmAsset: ファイル名・長さ・sample rate・channelsだけ（絶対パスなし）。未選択・使用不可の表示', () => {
      expect(describeMainBgmAsset(mainBgmAsset)).toBe('my-song.mp3（63.9秒・44100Hz・ステレオ）')
      expect(describeMainBgmAsset(undefined)).toBe('未選択')
      expect(describeMainBgmAsset({ ...mainBgmAsset, ok: false, error: '中身がMP3ではありません' })).toContain('使用できません')
    })
    it('既定はOFF（従来どおり）。ON/OFF・ダッキング・ループ・フェード・音量の設定項目を表示する', async () => {
      stub(status())
      render(<CompositionSettingsPanel value={{}} onChange={() => {}} />)
      await screen.findByTestId('composition-settings-panel')
      expect((screen.getByLabelText('本編BGMを使用する') as HTMLInputElement).checked).toBe(false)
      expect((screen.getByLabelText('自動ダッキング') as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText('BGMをループ') as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText('本編BGMフェードイン秒') as HTMLInputElement).value).toBe('1.5')
      expect((screen.getByLabelText('本編BGMフェードアウト秒') as HTMLInputElement).value).toBe('2.5')
      const vol = screen.getByLabelText('本編BGM音量') as HTMLInputElement
      expect(vol.max).toBe(String(MAIN_BGM_VOLUME_MAX))
      expect(vol.disabled).toBe(true) // OFFのときは操作できない
      expect(screen.getByTestId('main-bgm-file').textContent).toContain('未選択')
    })
    it('選択中のファイル名・音源duration・sample rate・channelsを表示する。絶対パスは表示しない', async () => {
      stub(status({ mainBgm: true, mainBgmFile: true }))
      render(<CompositionSettingsPanel value={{ mainBgm: { enabled: true } }} onChange={() => {}} />)
      await screen.findByTestId('composition-settings-panel')
      expect(screen.getByTestId('main-bgm-file').textContent).toContain('my-song.mp3（63.9秒・44100Hz・ステレオ）')
      expect(document.body.textContent).not.toMatch(/\/Users\/|\/tmp\//)
    })
    it('設定変更は上書きとして親へ渡る（ON・音量・ダッキング・ループ・フェード）。状態APIへ素材パスは送らない', async () => {
      const calls = stub(status({ mainBgm: true, mainBgmFile: true }))
      const changes: Array<CompositionOverrides & { useComposition?: boolean }> = []
      render(<CompositionSettingsPanel value={{ mainBgm: { enabled: true } }} onChange={(v) => changes.push(v)} />)
      await screen.findByTestId('composition-settings-panel')
      fireEvent.click(screen.getByLabelText('自動ダッキング'))
      expect(last(changes)?.mainBgm?.ducking).toBe(false)
      fireEvent.click(screen.getByLabelText('BGMをループ'))
      expect(last(changes)?.mainBgm?.loop).toBe(false)
      fireEvent.change(screen.getByLabelText('本編BGM音量'), { target: { value: '0.05' } })
      expect(last(changes)?.mainBgm?.volume).toBe(0.05)
      fireEvent.change(screen.getByLabelText('本編BGMフェードイン秒'), { target: { value: '2' } })
      expect(last(changes)?.mainBgm?.fadeInSec).toBe(2)
      fireEvent.change(screen.getByLabelText('本編BGMフェードアウト秒'), { target: { value: '3' } })
      expect(last(changes)?.mainBgm?.fadeOutSec).toBe(3)
      fireEvent.click(screen.getByLabelText('本編BGMを使用する'))
      expect(last(changes)?.mainBgm?.enabled).toBe(false)
      await waitFor(() => expect(calls.length).toBeGreaterThan(0))
      expect(calls.every((c) => !/sourcePath|"path"/i.test(c.body))).toBe(true)
    })
    it('「MP3ファイルを選択」: 許可フォルダ内のMP3の候補（ファイル名のみ）から選ぶと、選択IDが上書きに入る。「音源を解除」で外す', async () => {
      const calls: string[] = []
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        calls.push(String(url))
        if (String(url).includes('/main-bgm/candidates')) return { json: async () => ({ ok: true, files: [{ id: '0123456789abcdef', fileName: 'song-a.mp3', sizeBytes: 3_000_000 }, { id: 'fedcba9876543210', fileName: 'song-b.mp3', sizeBytes: 4_000_000 }] }) }
        return { json: async () => status({ mainBgm: true, mainBgmFile: true }) }
      })
      const changes: Array<CompositionOverrides & { useComposition?: boolean }> = []
      render(<CompositionSettingsPanel value={{ mainBgm: { enabled: true } }} onChange={(v) => changes.push(v)} />)
      await screen.findByTestId('composition-settings-panel')
      fireEvent.click(screen.getByText('MP3ファイルを選択'))
      const opt = await screen.findByText('song-b.mp3')
      expect(document.body.textContent).not.toMatch(/\/Users\//)
      fireEvent.click(opt)
      expect(last(changes)?.mainBgm).toMatchObject({ enabled: true, sourceId: 'fedcba9876543210' })
      fireEvent.click(screen.getByText('音源を解除'))
      expect(last(changes)?.mainBgm).toMatchObject({ enabled: false, sourceId: '' })
      expect(calls.some((u) => u.includes('/main-bgm/candidates'))).toBe(true)
    })
    it('BGM付きプレビュー（30〜60秒）: 音源が確認済み・ONのときだけ押せる。押すとプレビュー生成を呼び、結果を表示する', async () => {
      stub(status({ mainBgm: true, mainBgmFile: true }))
      const onPreview = vi.fn(async () => ({ ok: true, previewWindow: { durationSec: 45 }, mainBgm: { gainDb: -22.1, preDuckGapDb: 20, loops: 3, needsLoop: true } }))
      render(<CompositionSettingsPanel value={{ mainBgm: { enabled: true } }} onChange={() => {}} onMainBgmPreview={onPreview} />)
      await screen.findByTestId('composition-settings-panel')
      const btn = screen.getByText('BGM付きプレビュー（30〜60秒）') as HTMLButtonElement
      expect(btn.disabled).toBe(false)
      fireEvent.click(btn)
      await screen.findByRole('status')
      expect(onPreview).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('status').textContent).toContain('45秒')
      expect(screen.getByRole('status').textContent).toContain('ループ3回')
    })
    it('音源が未確認・OFFのとき、プレビューボタンは押せない', async () => {
      stub(status())
      render(<CompositionSettingsPanel value={{}} onChange={() => {}} onMainBgmPreview={async () => ({ ok: true })} />)
      await screen.findByTestId('composition-settings-panel')
      expect((screen.getByText('BGM付きプレビュー（30〜60秒）') as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
