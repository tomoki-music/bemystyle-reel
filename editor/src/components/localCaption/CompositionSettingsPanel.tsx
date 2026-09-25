import React, { useCallback, useEffect, useState } from 'react'

// 完成動画の構成（冒頭ダイジェスト → LINE案内 → 本編 → 末尾LINE案内）の設定パネル。
// - 既定はすべてON（完成動画レンダー時のみ）。短時間プレビューには追加区間を入れない。
// - 素材（BGM・QR画像）は環境設定で指定する。ここでは実在確認（サイズ・長さ・寸法）とQRプレビューだけを表示する。
//   素材の絶対パスは画面・ジョブJSON・APIレスポンスに出さない。

const API = '/api/local-caption-videos/composition'

export interface MainBgmOverrides { enabled?: boolean; sourceId?: string; volume?: number; autoGain?: boolean; ducking?: boolean; loop?: boolean; fadeInSec?: number; fadeOutSec?: number }
export interface MainBgmCandidate { id: string; fileName: string; sizeBytes: number }
export interface MainBgmPreviewOutcome { ok: boolean; message?: string; previewWindow?: { durationSec: number }; mainBgm?: { gainDb: number; preDuckGapDb: number; loops: number; needsLoop: boolean } | null }

export const MAIN_BGM_VOLUME_MAX = 0.06 // サーバー側の上限（mainBgm.mjs の MAIN_BGM_LIMITS.volumeMax）と同じ（標準の1.2倍）

export interface CompositionOverrides {
  mainBgm?: MainBgmOverrides
  digest?: { enabled?: boolean; durationSec?: number; grayscale?: boolean; bgm?: { volume?: number; fadeInSec?: number; fadeOutSec?: number } }
  lineIntro?: { enabled?: boolean; durationSec?: number; showQr?: boolean }
  lineOutro?: { enabled?: boolean; durationSec?: number; showQr?: boolean }
  preview?: { digest?: boolean; lineIntro?: boolean; lineOutro?: boolean }
}

interface AssetState { ok: boolean; error: string | null; sizeBytes: number | null; durationSec: number | null; width: number | null; height: number | null }
interface MainBgmAssetState { ok: boolean; error: string | null; fileName: string | null; sizeBytes: number | null; durationSec: number | null; sampleRate: number | null; channels: number | null }
interface MainBgmConfig { enabled: boolean; volume: number; autoGain: boolean; ducking: boolean; loop: boolean; fadeInSec: number; fadeOutSec: number }
const MAIN_BGM_FALLBACK: MainBgmConfig = { enabled: false, volume: 0.05, autoGain: true, ducking: true, loop: true, fadeInSec: 1.5, fadeOutSec: 2.5 }
interface Status {
  config: { digest: { enabled: boolean; durationSec: number; grayscale: boolean; bgm: { volume: number; fadeInSec: number; fadeOutSec: number; credit: { title: string; composer: string } } }; lineIntro: { enabled: boolean; durationSec: number; showQr: boolean }; lineOutro: { enabled: boolean; durationSec: number; showQr: boolean }; preview: { digest: boolean; lineIntro: boolean; lineOutro: boolean }; mainBgm?: MainBgmConfig }
  assets: { bgm: AssetState; qr: AssetState; mainBgm?: MainBgmAssetState }
  validation: { ok: boolean; errors: string[] }
  configuredByEnv: boolean
}

export function describeAsset(a: AssetState, kind: 'bgm' | 'qr'): string {
  if (!a.ok) return `未確認（${a.error ?? '不明'}）`
  if (kind === 'bgm') return `確認済み（約${Math.round(a.durationSec ?? 0)}秒）`
  return `確認済み（${a.width}×${a.height}px）`
}

export function describeMainBgmAsset(a: MainBgmAssetState | undefined): string {
  if (!a || !a.fileName) return '未選択'
  if (!a.ok) return `${a.fileName}（使用できません: ${a.error ?? '不明'}）`
  return `${a.fileName}（${Math.round((a.durationSec ?? 0) * 10) / 10}秒・${a.sampleRate ?? '?'}Hz・${a.channels === 1 ? 'モノラル' : a.channels === 2 ? 'ステレオ' : `${a.channels ?? '?'}ch`}）`
}

interface PanelProps {
  value: CompositionOverrides & { useComposition?: boolean }
  onChange: (v: CompositionOverrides & { useComposition?: boolean }) => void
  disabled?: boolean
  /** 本編BGM付きの30〜60秒プレビューを生成する（ジョブ画面から渡す。渡されなければボタンは出さない）。 */
  onMainBgmPreview?: () => Promise<MainBgmPreviewOutcome>
  previewBusy?: boolean
}

export function CompositionSettingsPanel({ value, onChange, disabled, onMainBgmPreview, previewBusy }: PanelProps) {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<MainBgmCandidate[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [previewNote, setPreviewNote] = useState<string | null>(null)

  const { useComposition, ...overrides } = value
  const key = JSON.stringify(overrides)
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ composition: JSON.parse(key) }) })
      const json = await res.json()
      if (!json.ok) throw new Error(json.message || '取得に失敗しました')
      setStatus(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
    }
  }, [key])
  useEffect(() => {
    void load()
  }, [load])

  if (!status) return error ? <p role="alert">{error}</p> : null
  const c = status.config
  const set = (patch: CompositionOverrides) => onChange({ ...value, digest: { ...value.digest, ...patch.digest, bgm: { ...value.digest?.bgm, ...patch.digest?.bgm } }, lineIntro: { ...value.lineIntro, ...patch.lineIntro }, lineOutro: { ...value.lineOutro, ...patch.lineOutro }, preview: { ...value.preview, ...patch.preview }, ...(patch.mainBgm || value.mainBgm ? { mainBgm: { ...value.mainBgm, ...patch.mainBgm } } : {}) })
  const mb = status.config.mainBgm ?? MAIN_BGM_FALLBACK
  const mbAsset = status.assets.mainBgm
  const mbLocked = disabled || !mb.enabled
  const openPicker = async () => {
    setPicking(true)
    try {
      const res = await fetch(`${API}/main-bgm/candidates`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.message || 'MP3の一覧を取得できませんでした')
      setCandidates(json.files as MainBgmCandidate[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MP3の一覧を取得できませんでした')
      setPicking(false)
    }
  }
  const runPreview = async () => {
    if (!onMainBgmPreview) return
    setPreviewNote(null)
    const r = await onMainBgmPreview()
    setPreviewNote(r.ok ? `プレビューを生成しました（約${Math.round(r.previewWindow?.durationSec ?? 0)}秒${r.mainBgm ? `・BGM初期ゲイン ${r.mainBgm.gainDb}dB${r.mainBgm.needsLoop ? `・ループ${r.mainBgm.loops}回` : ''}` : ''}）。上の「短時間プレビュー」欄で再生できます。` : null)
  }
  const on = useComposition ?? status.configuredByEnv
  const num = (label: string, v: number, apply: (n: number) => void, min: number, max: number) => (
    <label>{label}{' '}<input type="number" aria-label={label} min={min} max={max} step={1} value={v} disabled={disabled || !on} onChange={(e) => apply(Number(e.target.value))} /></label>
  )

  return (
    <section className="lcv-panel" data-testid="composition-settings-panel">
      <h2>完成動画の構成（ダイジェスト・LINE案内）</h2>
      <label>
        <input type="checkbox" aria-label="構成を追加する" checked={on} disabled={disabled} onChange={(e) => onChange({ ...value, useComposition: e.target.checked })} />{' '}
        完成動画に「冒頭ダイジェスト → LINE案内 → 本編 → 末尾LINE案内」を追加する
      </label>
      <p className="lcv-muted">短時間プレビューには追加区間を入れません（プレビューだけで有効にしたい機能は下の「プレビューにも入れる」）。</p>
      {error && <p role="alert" className="lcv-error">{error}</p>}
      {!status.validation.ok && <p role="alert" className="lcv-error">{status.validation.errors.join(' / ')}</p>}

      <h3>冒頭ダイジェスト</h3>
      <label><input type="checkbox" aria-label="ダイジェストON" checked={c.digest.enabled} disabled={disabled || !on} onChange={(e) => set({ digest: { enabled: e.target.checked } })} /> ON（映像だけ白黒・BGMは「{c.digest.bgm.credit.title}」／{c.digest.bgm.credit.composer}）</label>{' '}
      <label><input type="checkbox" aria-label="白黒" checked={c.digest.grayscale} disabled={disabled || !on || !c.digest.enabled} onChange={(e) => set({ digest: { grayscale: e.target.checked } })} /> 白黒</label>
      <div>
        {num('ダイジェスト秒数', c.digest.durationSec, (n) => set({ digest: { durationSec: n } }), 20, 30)}{' '}
        <label>BGM音量{' '}<input type="number" aria-label="BGM音量" min={0} max={1} step={0.01} value={c.digest.bgm.volume} disabled={disabled || !on} onChange={(e) => set({ digest: { bgm: { volume: Number(e.target.value) } } })} /></label>
      </div>
      <p>BGM素材: {describeAsset(status.assets.bgm, 'bgm')}</p>

      <h3>LINE案内</h3>
      <label><input type="checkbox" aria-label="冒頭LINE案内ON" checked={c.lineIntro.enabled} disabled={disabled || !on} onChange={(e) => set({ lineIntro: { enabled: e.target.checked } })} /> 冒頭（ダイジェスト直後）</label>{' '}
      {num('冒頭LINE案内秒数', c.lineIntro.durationSec, (n) => set({ lineIntro: { durationSec: n } }), 3, 90)}
      <br />
      <label><input type="checkbox" aria-label="末尾LINE案内ON" checked={c.lineOutro.enabled} disabled={disabled || !on} onChange={(e) => set({ lineOutro: { enabled: e.target.checked } })} /> 末尾（QR画像つき）</label>{' '}
      {num('末尾LINE案内秒数', c.lineOutro.durationSec, (n) => set({ lineOutro: { durationSec: n } }), 3, 60)}
      <p>QR画像: {describeAsset(status.assets.qr, 'qr')}</p>
      {status.assets.qr.ok && <img src={`${API}/qr-image`} alt="LINE友だち登録QRのプレビュー" width={160} style={{ background: '#fff', padding: 8 }} />}

      <h3>本編BGM（ユーザー指定のMP3）</h3>
      <p className="lcv-muted">本編（冒頭LINE案内の間を含む）だけに小さく流します。ダイジェスト・末尾LINE案内には使いません。MP3はコピー・アップロードせず、許可フォルダ内のファイルを直接参照します。</p>
      <label><input type="checkbox" aria-label="本編BGMを使用する" checked={mb.enabled} disabled={disabled} onChange={(e) => set({ mainBgm: { enabled: e.target.checked } })} /> 本編BGMを使用する</label>
      <div>
        <button type="button" disabled={mbLocked} onClick={() => void openPicker()}>MP3ファイルを選択</button>{' '}
        <button type="button" disabled={mbLocked || !mbAsset?.fileName} onClick={() => { set({ mainBgm: { enabled: false, sourceId: '' } }); setPicking(false) }}>音源を解除</button>
      </div>
      {picking && candidates && (
        <div role="listbox" aria-label="MP3ファイルの候補" className="lcv-muted">
          {candidates.length === 0 && <p>許可フォルダ内にMP3が見つかりません。</p>}
          {candidates.map((f) => (
            <div key={f.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { set({ mainBgm: { sourceId: f.id } }); setPicking(false) }}>{f.fileName}</button>{' '}
              <span>{Math.round(f.sizeBytes / 1024 / 1024 * 10) / 10}MB</span>
            </div>
          ))}
        </div>
      )}
      <p data-testid="main-bgm-file">選択中: {describeMainBgmAsset(mbAsset)}</p>
      <div>
        <label>音量{' '}<input type="range" aria-label="本編BGM音量" min={0} max={MAIN_BGM_VOLUME_MAX} step={0.005} value={mb.volume} disabled={mbLocked} onChange={(e) => set({ mainBgm: { volume: Number(e.target.value) } })} /></label>{' '}
        <span>{mb.volume.toFixed(3)}（標準 0.050・上限 {MAIN_BGM_VOLUME_MAX.toFixed(2)}。声との差が12dB未満にならないよう自動で制限）</span>
      </div>
      <div>
        <label><input type="checkbox" aria-label="自動ダッキング" checked={mb.ducking} disabled={mbLocked} onChange={(e) => set({ mainBgm: { ducking: e.target.checked } })} /> 自動ダッキング（発話中にBGMを下げる）</label>{' '}
        <label><input type="checkbox" aria-label="BGMをループ" checked={mb.loop} disabled={mbLocked} onChange={(e) => set({ mainBgm: { loop: e.target.checked } })} /> ループ</label>
      </div>
      <div>
        <label>フェードイン秒{' '}<input type="number" aria-label="本編BGMフェードイン秒" min={0} max={10} step={0.5} value={mb.fadeInSec} disabled={mbLocked} onChange={(e) => set({ mainBgm: { fadeInSec: Number(e.target.value) } })} /></label>{' '}
        <label>フェードアウト秒{' '}<input type="number" aria-label="本編BGMフェードアウト秒" min={0} max={10} step={0.5} value={mb.fadeOutSec} disabled={mbLocked} onChange={(e) => set({ mainBgm: { fadeOutSec: Number(e.target.value) } })} /></label>
      </div>
      {onMainBgmPreview && (
        <div>
          <button type="button" disabled={mbLocked || !mbAsset?.ok || previewBusy} onClick={() => void runPreview()}>{previewBusy ? 'BGM付きプレビュー生成中…' : 'BGM付きプレビュー（30〜60秒）'}</button>
          {previewNote && <p role="status">{previewNote}</p>}
        </div>
      )}

      <h3>プレビューにも入れる（既定はすべてOFF）</h3>
      {(['digest', 'lineIntro', 'lineOutro'] as const).map((k) => (
        <label key={k}>
          <input type="checkbox" aria-label={`プレビューに${k}`} checked={c.preview[k]} disabled={disabled} onChange={(e) => set({ preview: { [k]: e.target.checked } })} />{' '}
          {k === 'digest' ? 'ダイジェスト' : k === 'lineIntro' ? '冒頭LINE案内' : '末尾LINE案内'}{' '}
        </label>
      ))}
    </section>
  )
}
