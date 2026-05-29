import React, { useState, useEffect, useCallback } from 'react'
import { Slide, CTAConfig, SlidesData } from './types'
import { SlideList } from './components/SlideList'
import { SlidePreview } from './components/SlidePreview'
import { SlideForm } from './components/SlideForm'
import './App.css'

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([])
  const [ctaConfig, setCtaConfig] = useState<CTAConfig>({ qrImage: 'qr-singing.png' })
  const [title, setTitle] = useState('BeMyStyle Reel')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

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
  }, [])

  const selectedSlide = slides.find((s) => s.id === selectedId) ?? null
  const selectedIdx = slides.findIndex((s) => s.id === selectedId)

  const updateSlide = useCallback((id: number, changes: Partial<Slide>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)))
  }, [])

  const toggleVisible = useCallback((id: number) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)))
  }, [])

  const moveSlide = useCallback((fromIdx: number, toIdx: number) => {
    setSlides((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }, [])

  const saveToServer = useCallback(async () => {
    const data: SlidesData = { title, slides, cta: ctaConfig }
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? `HTTP ${res.status}`)
      }
      setSaveStatus('ok')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      setSaveError(String(err))
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
    }
  }, [title, slides, ctaConfig])

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
          <span className="panel-title">スライド一覧</span>
          <span className="panel-badge">{slides.length}枚</span>
        </div>
        <SlideList
          slides={slides}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleVisible={toggleVisible}
          onMove={moveSlide}
        />
        <div className="download-area">
          <button
            className={`btn-save ${saveStatus === 'ok' ? 'btn-save--ok' : saveStatus === 'error' ? 'btn-save--error' : ''}`}
            onClick={saveToServer}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'ok' ? '✓ 保存しました' : saveStatus === 'error' ? '✗ 保存失敗' : '💾 保存'}
          </button>
          {saveStatus === 'error' && (
            <p className="save-error">{saveError}</p>
          )}
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
          <SlideForm
            slide={selectedSlide}
            onChange={(changes) => updateSlide(selectedSlide.id, changes)}
            ctaConfig={ctaConfig}
            onCtaChange={setCtaConfig}
          />
        ) : (
          <div className="empty-state">スライドを選択してください</div>
        )}
      </div>
    </div>
  )
}
