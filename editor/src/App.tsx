import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Slide, CTAConfig, SlidesData } from './types'
import { SlideList } from './components/SlideList'
import { SlidePreview } from './components/SlidePreview'
import { SlideForm } from './components/SlideForm'
import './App.css'

const API_SERVER_ERROR = 'APIサーバーに接続できません。npm run editor で起動しているか確認してください。'

interface HistoryItem {
  filename: string
  size: number
  createdAt: string
  downloadUrl: string
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    throw new Error(`${API_SERVER_ERROR}\n\n${text.slice(0, 120)}`)
  }
  return res.json()
}

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([])
  const [ctaConfig, setCtaConfig] = useState<CTAConfig>({ qrImage: 'qr-singing.png' })
  const [title, setTitle] = useState('BeMyStyle Reel')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [renderStatus, setRenderStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const [renderError, setRenderError] = useState('')
  const [isPreparingRender, setIsPreparingRender] = useState(false)
  const [latestDownloadUrl, setLatestDownloadUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyError, setHistoryError] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/render/history')
      const data = await res.json()
      if (data.ok) {
        setHistory(data.items as HistoryItem[])
        setHistoryError(false)
      } else {
        setHistoryError(true)
      }
    } catch (_) {
      setHistoryError(true)
    }
  }, [])

  useEffect(() => {
    fetch('/data/slides.json')
      .then((r) => r.json())
      .then((data: SlidesData) => {
        setSlides(data.slides)
        setCtaConfig(data.cta)
        setTitle(data.title)
        if (data.slides.length > 0) setSelectedId(data.slides[0].id)
      })
      .catch(() => alert('slides.json の読み込みに失敗しました。'))
      .finally(() => setLoading(false))
    fetchHistory()
  }, [fetchHistory])

  const selectedSlide = slides.find((s) => s.id === selectedId) ?? null
  const selectedIdx = slides.findIndex((s) => s.id === selectedId)

  const updateSlide = useCallback((id: number, changes: Partial<Slide>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)))
    setHasUnsavedChanges(true)
  }, [])

  const toggleVisible = useCallback((id: number) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)))
    setHasUnsavedChanges(true)
  }, [])

  const moveSlide = useCallback((fromIdx: number, toIdx: number) => {
    setSlides((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleCtaChange = useCallback((config: CTAConfig) => {
    setCtaConfig(config)
    setHasUnsavedChanges(true)
  }, [])

  const saveToServer = useCallback(async (): Promise<boolean> => {
    const data: SlidesData = { title, slides, cta: ctaConfig }
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = await parseJsonResponse(res)
      if (!res.ok) throw new Error((body.message as string) ?? `HTTP ${res.status}`)
      setSaveStatus('ok')
      setHasUnsavedChanges(false)
      setTimeout(() => setSaveStatus('idle'), 2500)
      return true
    } catch (err) {
      setSaveError(String(err))
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
      return false
    }
  }, [title, slides, ctaConfig])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/render/status')
        const data = await parseJsonResponse(res)
        const status = data.status as string
        setRenderStatus(status as 'idle' | 'running' | 'completed' | 'failed')
        if (status === 'completed' || status === 'failed') {
          stopPolling()
          if (status === 'failed') setRenderError((data.error as string) ?? '不明なエラー')
          if (status === 'completed') {
            fetchHistory()
            const url = data.downloadUrl as string
            if (url) setLatestDownloadUrl(url)
          }
        }
      } catch (err) {
        stopPolling()
        setRenderStatus('failed')
        setRenderError(String(err))
      }
    }, 2000)
  }, [stopPolling, fetchHistory])

  const startRender = useCallback(async () => {
    setRenderError('')
    setRenderStatus('idle')

    if (hasUnsavedChanges) {
      setIsPreparingRender(true)
      const ok = await saveToServer()
      setIsPreparingRender(false)
      if (!ok) return
    }

    try {
      const res = await fetch('/api/render', { method: 'POST' })
      const data = await parseJsonResponse(res)
      if (!res.ok) {
        setRenderStatus('failed')
        setRenderError((data.message as string) ?? `HTTP ${res.status}`)
        return
      }
      setRenderStatus('running')
      startPolling()
    } catch (err) {
      setRenderStatus('failed')
      setRenderError(String(err))
    }
  }, [startPolling, hasUnsavedChanges, saveToServer])

  const downloadVideo = useCallback(() => {
    window.location.href = latestDownloadUrl ?? '/api/render/download'
  }, [latestDownloadUrl])

  const latestViewUrl = latestDownloadUrl
    ? latestDownloadUrl.replace('/api/render/download/', '/api/render/view/')
    : '/api/render/view'

  const formatHistoryDate = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

  const downloadJSON = useCallback(() => {
    const data: SlidesData = { title, slides, cta: ctaConfig }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'slides.json'
    a.click()
    URL.revokeObjectURL(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }, [title, slides, ctaConfig])

  const isRendering = isPreparingRender || renderStatus === 'running'

  const renderBtnLabel = isPreparingRender
    ? '⏳ 保存して動画生成中...'
    : renderStatus === 'running'
    ? '⏳ 生成中...'
    : renderStatus === 'completed'
    ? '✓ 動画生成完了'
    : renderStatus === 'failed'
    ? '✗ 生成失敗'
    : '🎬 動画生成'

  const renderStatusMsg = isPreparingRender
    ? '保存してから動画生成しています...'
    : renderStatus === 'running'
    ? '動画生成中です。少し待ってください。'
    : renderStatus === 'completed'
    ? '動画生成が完了しました！'
    : renderStatus === 'failed'
    ? '生成に失敗しました。内容を確認してください。'
    : hasUnsavedChanges
    ? '未保存の変更があります'
    : null

  const renderStatusClass =
    isPreparingRender || renderStatus === 'running'
      ? 'render-status-msg render-status-msg--info'
      : renderStatus === 'completed'
      ? 'render-status-msg render-status-msg--ok'
      : renderStatus === 'failed'
      ? 'render-status-msg render-status-msg--error'
      : hasUnsavedChanges
      ? 'render-status-msg render-status-msg--warning'
      : 'render-status-msg'

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-dot" />
        読み込み中...
      </div>
    )
  }

  return (
    <div className="app">
      {/* ── 左パネル: スライド一覧 ── */}
      <div className="panel panel-left">
        <div className="panel-header">
          <div className="panel-header-left">
            <span className="panel-title">スライド一覧</span>
            {hasUnsavedChanges && <span className="unsaved-badge">未保存</span>}
          </div>
          <span className="panel-badge">{slides.length}枚</span>
        </div>
        <SlideList
          slides={slides}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleVisible={toggleVisible}
          onMove={moveSlide}
          disabled={isRendering}
        />
        <div className="download-area">
          <button
            className={`btn-save ${saveStatus === 'ok' ? 'btn-save--ok' : saveStatus === 'error' ? 'btn-save--error' : hasUnsavedChanges && saveStatus === 'idle' ? 'btn-save--unsaved' : ''}`}
            onClick={saveToServer}
            disabled={saveStatus === 'saving' || isRendering}
          >
            {saveStatus === 'saving'
              ? '保存中...'
              : saveStatus === 'ok'
              ? '✓ 保存しました！'
              : saveStatus === 'error'
              ? '✗ 保存に失敗しました'
              : hasUnsavedChanges
              ? '⚠ 未保存の変更を保存する'
              : '💾 保存する'}
          </button>
          {saveStatus === 'error' && (
            <p className="save-error">{saveError}</p>
          )}

          <div className="render-area">
            {renderStatusMsg && (
              <p className={renderStatusClass}>{renderStatusMsg}</p>
            )}
            <button
              className={`btn-render ${isRendering ? 'btn-render--running' : renderStatus === 'completed' ? 'btn-render--ok' : renderStatus === 'failed' ? 'btn-render--error' : ''}`}
              onClick={startRender}
              disabled={isRendering}
            >
              {renderBtnLabel}
            </button>
            {renderStatus === 'failed' && renderError && (
              <p className="save-error">{renderError}</p>
            )}
            {renderStatus === 'completed' && (
              <div className="render-complete-actions">
                <button className="btn-download-mp4" onClick={downloadVideo}>
                  ↓ mp4 をダウンロード
                </button>
                <a
                  className="btn-open-video"
                  href={latestViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ↗ 動画を開く
                </a>
              </div>
            )}
          </div>

          {/* 生成履歴 */}
          <div className="history-area">
            <p className="history-title">生成履歴</p>
            {historyError ? (
              <p className="history-empty history-empty--error">生成履歴を取得できませんでした</p>
            ) : history.length === 0 ? (
              <p className="history-empty">生成履歴はまだありません</p>
            ) : (
              <ul className="history-list">
                {history.map((item, i) => (
                  <li key={item.filename} className="history-item">
                    {i === 0 && <span className="history-newest-badge">最新</span>}
                    <span className="history-date">{formatHistoryDate(item.createdAt)}</span>
                    <span className="history-size">{formatSize(item.size)}</span>
                    <a className="history-dl" href={item.downloadUrl} download={item.filename}>DL</a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button className={`btn-download ${saved ? 'btn-download--saved' : ''}`} onClick={downloadJSON}>
            {saved ? '✓ ダウンロード完了！' : '↓ slides.json をダウンロード'}
          </button>
          <p className="download-hint">
            ※ ダウンロードは保険用です
          </p>
        </div>
      </div>

      {/* ── 中央パネル: プレビュー ── */}
      <div className="panel panel-center">
        <div className="panel-header">
          <span className="panel-title">プレビュー</span>
          {selectedSlide && (
            <div className="preview-nav">
              <button
                className="nav-btn"
                disabled={selectedIdx <= 0}
                onClick={() => setSelectedId(slides[selectedIdx - 1].id)}
              >
                ←
              </button>
              <span className="nav-label">{selectedIdx + 1} / {slides.length}</span>
              <button
                className="nav-btn"
                disabled={selectedIdx >= slides.length - 1}
                onClick={() => setSelectedId(slides[selectedIdx + 1].id)}
              >
                →
              </button>
            </div>
          )}
        </div>
        <div className="preview-area">
          {selectedSlide ? (
            <SlidePreview slide={selectedSlide} ctaConfig={ctaConfig} />
          ) : (
            <div className="empty-state">スライドを選択してください</div>
          )}
        </div>
      </div>

      {/* ── 右パネル: 編集フォーム ── */}
      <div className="panel panel-right">
        <div className="panel-header">
          <span className="panel-title">
            {selectedSlide?.layout === 'cta' ? 'CTA スライド編集' : '編集フォーム'}
          </span>
          {selectedSlide && (
            <span className="panel-badge">#{selectedSlide.id}</span>
          )}
        </div>
        {selectedSlide ? (
          <>
            {isRendering && (
              <div className="render-lock-notice">
                ⏳ 動画生成中のため、編集はロックされています。完了までお待ちください。
              </div>
            )}
            <SlideForm
              slide={selectedSlide}
              onChange={(changes) => updateSlide(selectedSlide.id, changes)}
              ctaConfig={ctaConfig}
              onCtaChange={handleCtaChange}
              disabled={isRendering}
            />
          </>
        ) : (
          <div className="empty-state">スライドを選択してください</div>
        )}
      </div>
    </div>
  )
}
