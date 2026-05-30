import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Slide, CTAConfig, SlidesData, TemplateInfo, Template } from './types'
import { SlideList } from './components/SlideList'
import { SlidePreview } from './components/SlidePreview'
import { SlideForm } from './components/SlideForm'
import {
  TemplateVariableValues,
  extractTemplateVariables,
  applyTemplateVariables,
} from './templateVariables'
import './App.css'

const API_SERVER_ERROR = 'APIサーバーに接続できません。npm run editor で起動しているか確認してください。'

const RECENT_KEY = 'bemystyle-reel:recent-templates'
const RECENT_MAX = 5

const VIEW_MODE_KEY = 'bemystyle-reel:view-mode'
const USAGE_KEY = 'bemystyle-reel:template-usage'

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function saveRecentIds(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {}
}

function pushRecentId(id: string, current: string[]): string[] {
  return [id, ...current.filter((v) => v !== id)].slice(0, RECENT_MAX)
}

function loadViewMode(): 'grid' | 'list' {
  const v = localStorage.getItem(VIEW_MODE_KEY)
  return v === 'list' ? 'list' : 'grid'
}

function loadUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

type SortOrder = 'newest' | 'name' | 'favorite' | 'category'

const CATEGORIES = [
  { id: 'all',       label: 'すべて' },
  { id: 'singing',   label: '歌唱診断' },
  { id: 'community', label: 'コミュニティ' },
  { id: 'event',     label: 'イベント' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'note',      label: 'Note' },
  { id: 'campaign',  label: 'キャンペーン' },
  { id: 'other',     label: 'その他' },
] as const

type CategoryId = typeof CATEGORIES[number]['id']

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

  // テンプレート関連
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [templateConfirmPending, setTemplateConfirmPending] = useState<string | null>(null)
  const [templateHints, setTemplateHints] = useState<Template['hints'] | null>(null)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateCategory, setSaveTemplateCategory] = useState<string>('other')
  const [saveTemplateDescription, setSaveTemplateDescription] = useState('')
  const [saveTemplateStatus, setSaveTemplateStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  // テンプレート変数 (Phase11.5-C)
  const [rawTemplateSlides, setRawTemplateSlides] = useState<Slide[] | null>(null)
  const [templateVariableKeys, setTemplateVariableKeys] = useState<string[]>([])
  const [variableValues, setVariableValues] = useState<TemplateVariableValues>({})

  // テンプレート管理 (Phase11 / Phase11.5-B)
  const [templateSearch, setTemplateSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all')
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>(() => loadRecentIds())
  const [renameTemplateId, setRenameTemplateId] = useState<string | null>(null)
  const [renameTemplateName, setRenameTemplateName] = useState('')
  const [renameTemplateStatus, setRenameTemplateStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting' | 'error'>('idle')

  // テンプレートギャラリー強化 (Phase11.5-F)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => loadViewMode())
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [usageMap, setUsageMap] = useState<Record<string, number>>(() => loadUsage())

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

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/templates')
      const data = await res.json()
      if (data.ok) setTemplates(data.templates as TemplateInfo[])
    } catch (_) {}
  }, [])

  const confirmLoadTemplate = useCallback((id: string) => {
    setTemplateConfirmPending(id)
  }, [])

  const loadTemplate = useCallback(async (id: string) => {
    setTemplateConfirmPending(null)
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!data.ok || !data.template) return
      const tpl = data.template as Template
      const keys = extractTemplateVariables(tpl.slides)
      setRawTemplateSlides(tpl.slides)
      setTemplateVariableKeys(keys)
      setVariableValues({})
      setSlides(tpl.slides)
      setCtaConfig(tpl.cta)
      setTitle(tpl.title ?? tpl.name)
      setTemplateHints(tpl.hints ?? null)
      setSelectedTemplateId(id)
      if (tpl.slides.length > 0) setSelectedId(tpl.slides[0].id)
      setHasUnsavedChanges(true)
      setRecentTemplateIds((prev) => {
        const next = pushRecentId(id, prev)
        saveRecentIds(next)
        return next
      })
      setUsageMap((prev) => {
        const next = { ...prev, [id]: (prev[id] ?? 0) + 1 }
        localStorage.setItem(USAGE_KEY, JSON.stringify(next))
        return next
      })
    } catch (_) {}
  }, [setRecentTemplateIds])

  const saveAsTemplate = useCallback(async () => {
    if (!saveTemplateName.trim()) return
    setSaveTemplateStatus('saving')
    try {
      const variables = extractTemplateVariables(rawTemplateSlides ?? slides)
      const payload = {
        name: saveTemplateName.trim(),
        title,
        slides,
        cta: ctaConfig,
        category: saveTemplateCategory,
        description: saveTemplateDescription.trim(),
        variables,
        thumbnail: slides[0]?.image ?? '',
      }
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      setSaveTemplateStatus('ok')
      await fetchTemplates()
      setTimeout(() => {
        setSaveTemplateStatus('idle')
        setSaveTemplateModal(false)
        setSaveTemplateName('')
        setSaveTemplateCategory('other')
        setSaveTemplateDescription('')
      }, 1500)
    } catch (_) {
      setSaveTemplateStatus('error')
      setTimeout(() => setSaveTemplateStatus('idle'), 3000)
    }
  }, [saveTemplateName, saveTemplateCategory, saveTemplateDescription, title, slides, ctaConfig, rawTemplateSlides, fetchTemplates])

  const duplicateTemplate = useCallback(async (id: string) => {
    try {
      const res = await fetch('/api/templates/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      await fetchTemplates()
    } catch (_) {}
  }, [fetchTemplates])

  const deleteTemplate = useCallback(async (id: string) => {
    setDeleteStatus('deleting')
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      if (selectedTemplateId === id) setSelectedTemplateId('')
      setDeleteConfirmId(null)
      setDeleteStatus('idle')
      await fetchTemplates()
    } catch (_) {
      setDeleteStatus('error')
      setTimeout(() => setDeleteStatus('idle'), 3000)
    }
  }, [fetchTemplates, selectedTemplateId])

  const renameTemplate = useCallback(async () => {
    if (!renameTemplateId || !renameTemplateName.trim()) return
    setRenameTemplateStatus('saving')
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(renameTemplateId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameTemplateName.trim() }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      setRenameTemplateStatus('ok')
      await fetchTemplates()
      setTimeout(() => {
        setRenameTemplateStatus('idle')
        setRenameTemplateId(null)
        setRenameTemplateName('')
      }, 1200)
    } catch (_) {
      setRenameTemplateStatus('error')
      setTimeout(() => setRenameTemplateStatus('idle'), 3000)
    }
  }, [renameTemplateId, renameTemplateName, fetchTemplates])

  const handleVariableChange = useCallback((key: string, value: string) => {
    setVariableValues((prev) => {
      const next = { ...prev, [key]: value }
      if (rawTemplateSlides) {
        setSlides(applyTemplateVariables(rawTemplateSlides, next))
        setHasUnsavedChanges(true)
      }
      return next
    })
  }, [rawTemplateSlides])

  const toggleFavorite = useCallback(async (id: string, current: boolean) => {
    try {
      await fetch(`/api/templates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !current }),
      })
      await fetchTemplates()
    } catch (_) {}
  }, [fetchTemplates])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

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
    fetchTemplates()
  }, [fetchHistory, fetchTemplates])

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

  const recentTemplates = recentTemplateIds
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is TemplateInfo => t !== undefined)

  const filteredTemplates = templates
    .filter((t) => {
      const catMatch = selectedCategory === 'all' || (t.category ?? 'other') === selectedCategory
      const searchMatch = !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())
      return catMatch && searchMatch
    })
    .sort((a, b) => {
      switch (sortOrder) {
        case 'name':
          return a.name.localeCompare(b.name, 'ja')
        case 'favorite':
          if (a.favorite && !b.favorite) return -1
          if (!a.favorite && b.favorite) return 1
          return 0
        case 'category':
          return (a.category ?? 'other').localeCompare(b.category ?? 'other')
        default:
          return 0
      }
    })

  const categoryCounts: Record<string, number> = { all: templates.length }
  for (const t of templates) {
    const cat = t.category ?? 'other'
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1
  }

  const templateStats = {
    total: templates.length,
    favorites: templates.filter((t) => t.favorite).length,
    categoryCount: new Set(templates.map((t) => t.category ?? 'other')).size,
  }

  const popularTemplates = [...templates]
    .filter((t) => (usageMap[t.id] ?? 0) > 0)
    .sort((a, b) => (usageMap[b.id] ?? 0) - (usageMap[a.id] ?? 0))
    .slice(0, 3)

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

  const deleteTargetName = deleteConfirmId
    ? (templates.find((t) => t.id === deleteConfirmId)?.name ?? deleteConfirmId)
    : ''

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
      {/* ── テンプレート読み込み確認 ── */}
      {templateConfirmPending && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレートを読み込みますか？</p>
            <p className="modal-body">現在の編集内容は破棄されます。</p>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setTemplateConfirmPending(null)}>
                キャンセル
              </button>
              <button className="btn-modal-ok" onClick={() => loadTemplate(templateConfirmPending)}>
                読み込む
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── テンプレート保存モーダル ── */}
      {saveTemplateModal && (
        <div className="modal-overlay">
          <div className="modal modal--wide">
            <p className="modal-title">テンプレートとして保存</p>
            <input
              className="modal-input"
              type="text"
              placeholder="テンプレート名を入力"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveAsTemplate()}
              autoFocus
            />
            <select
              className="modal-select"
              value={saveTemplateCategory}
              onChange={(e) => setSaveTemplateCategory(e.target.value)}
            >
              {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <textarea
              className="modal-textarea"
              placeholder="説明文（任意）"
              value={saveTemplateDescription}
              onChange={(e) => setSaveTemplateDescription(e.target.value)}
              rows={3}
            />
            {saveTemplateStatus === 'error' && (
              <p className="save-error">保存に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={() => {
                  setSaveTemplateModal(false)
                  setSaveTemplateName('')
                  setSaveTemplateCategory('other')
                  setSaveTemplateDescription('')
                  setSaveTemplateStatus('idle')
                }}
                disabled={saveTemplateStatus === 'saving'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-ok"
                onClick={saveAsTemplate}
                disabled={!saveTemplateName.trim() || saveTemplateStatus === 'saving'}
              >
                {saveTemplateStatus === 'saving' ? '保存中...' : saveTemplateStatus === 'ok' ? '✓ 保存完了' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 名前変更モーダル ── */}
      {renameTemplateId && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレート名を変更</p>
            <input
              className="modal-input"
              type="text"
              placeholder="新しいテンプレート名"
              value={renameTemplateName}
              onChange={(e) => setRenameTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && renameTemplate()}
              autoFocus
            />
            {renameTemplateStatus === 'error' && (
              <p className="save-error">名前変更に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={() => { setRenameTemplateId(null); setRenameTemplateName(''); setRenameTemplateStatus('idle') }}
                disabled={renameTemplateStatus === 'saving'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-ok"
                onClick={renameTemplate}
                disabled={!renameTemplateName.trim() || renameTemplateStatus === 'saving'}
              >
                {renameTemplateStatus === 'saving' ? '保存中...' : renameTemplateStatus === 'ok' ? '✓ 完了' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 削除確認ダイアログ ── */}
      {deleteConfirmId && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレートを削除しますか？</p>
            <p className="modal-body">「{deleteTargetName}」を削除します。この操作は取り消せません。</p>
            {deleteStatus === 'error' && (
              <p className="save-error">削除に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={() => { setDeleteConfirmId(null); setDeleteStatus('idle') }}
                disabled={deleteStatus === 'deleting'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-delete"
                onClick={() => deleteTemplate(deleteConfirmId)}
                disabled={deleteStatus === 'deleting'}
              >
                {deleteStatus === 'deleting' ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 左パネル: スライド一覧 ── */}
      <div className="panel panel-left">
        <div className="panel-header">
          <div className="panel-header-left">
            <span className="panel-title">スライド一覧</span>
            {hasUnsavedChanges && <span className="unsaved-badge">未保存</span>}
          </div>
          <span className="panel-badge">{slides.length}枚</span>
        </div>

        {/* テンプレートセクション */}
        <div className="template-section">
          <div className="template-header-row">
            <p className="template-label">テンプレート</p>
            <input
              className="template-search"
              type="text"
              placeholder="検索..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
            />
            <div className="template-view-toggle">
              <button
                className={`template-view-btn${viewMode === 'grid' ? ' template-view-btn--active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="グリッド表示"
              >⊞</button>
              <button
                className={`template-view-btn${viewMode === 'list' ? ' template-view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
                title="リスト表示"
              >☰</button>
            </div>
          </div>
          {templates.length > 0 && (
            <div className="template-stats">
              <span>テンプレート数 <strong>{templateStats.total}</strong></span>
              <span>お気に入り <strong>{templateStats.favorites}</strong></span>
              <span>カテゴリ数 <strong>{templateStats.categoryCount}</strong></span>
            </div>
          )}
          {recentTemplates.length > 0 && (
            <div className="template-recent">
              <p className="template-recent-label">最近使った</p>
              <div className="template-recent-list">
                {recentTemplates.map((t) => (
                  <button
                    key={t.id}
                    className={`template-recent-btn${t.id === selectedTemplateId ? ' template-recent-btn--active' : ''}`}
                    onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                    disabled={isRendering}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {popularTemplates.length > 0 && (
            <div className="template-popular">
              <p className="template-popular-label">人気テンプレ</p>
              <div className="template-popular-list">
                {popularTemplates.map((t, i) => (
                  <button
                    key={t.id}
                    className="template-popular-item"
                    onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                    disabled={isRendering}
                  >
                    <span className="template-popular-rank">{i + 1}位</span>
                    <span className="template-popular-name">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="template-sort-row">
            <select
              className="template-sort-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            >
              <option value="newest">最新</option>
              <option value="name">名前順</option>
              <option value="favorite">お気に入り優先</option>
              <option value="category">カテゴリ順</option>
            </select>
          </div>
          <div className="template-category-filter">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`template-cat-btn${selectedCategory === cat.id ? ' template-cat-btn--active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.label}({categoryCounts[cat.id] ?? 0})
              </button>
            ))}
          </div>
          <div className={`template-list${viewMode === 'list' ? ' template-list--list' : ''}`}>
            {filteredTemplates.map((t) => {
              const isCustom = t.id.startsWith('custom-')
              const isLoaded = t.id === selectedTemplateId
              const hasMeta = !!(t.description || (t.variables && t.variables.length > 0))
              return (
                <div key={t.id} className={`template-card${isLoaded ? ' template-card--active' : ''}`}>
                  <button
                    className="template-card-thumb-btn"
                    onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                    disabled={isRendering}
                    title={`${t.name} を読み込む`}
                  >
                    {t.thumbnail ? (
                      <img src={t.thumbnail} alt={t.name} className="template-card-img" />
                    ) : (
                      <div className="template-card-no-img">No Image</div>
                    )}
                  </button>
                  <div className="template-card-body">
                    <div className="template-item-row">
                      <button
                        className={`template-fav-btn${t.favorite ? ' template-fav-btn--active' : ''}`}
                        onClick={() => toggleFavorite(t.id, !!t.favorite)}
                        disabled={isRendering}
                        title="お気に入り"
                      >
                        {t.favorite ? '★' : '☆'}
                      </button>
                      <button
                        className="template-name-btn"
                        onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                        disabled={isRendering}
                        title={t.name}
                      >
                        {t.name}
                      </button>
                      <button
                        className="template-action-btn"
                        onClick={() => duplicateTemplate(t.id)}
                        disabled={isRendering}
                        title="複製"
                      >
                        複製
                      </button>
                      {isCustom && (
                        <>
                          <button
                            className="template-action-btn"
                            onClick={() => {
                              setRenameTemplateId(t.id)
                              setRenameTemplateName(t.name)
                              setRenameTemplateStatus('idle')
                            }}
                            disabled={isRendering}
                            title="名前変更"
                          >
                            ✏
                          </button>
                          <button
                            className="template-action-btn template-action-btn--danger"
                            onClick={() => setDeleteConfirmId(t.id)}
                            disabled={isRendering}
                            title="削除"
                          >
                            削除
                          </button>
                        </>
                      )}
                    </div>
                    {hasMeta && (
                      <div className="template-card-meta">
                        {t.description && (
                          <p className="template-item-desc">{t.description}</p>
                        )}
                        {t.variables && t.variables.length > 0 && (
                          <p className="template-item-vars">変数: {t.variables.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {filteredTemplates.length === 0 && (
              <p className="template-empty">テンプレートが見つかりません</p>
            )}
          </div>
          {templateHints && (
            <div className="template-hints">
              <span>推奨</span>
              <span>画像{templateHints.imageCount}枚</span>
              <span>動画{templateHints.durationSec}秒</span>
              <span>{templateHints.ctaNote}</span>
            </div>
          )}
          {templateVariableKeys.length > 0 && (
            <div className="template-variables">
              <p className="template-variables-label">テンプレート変数</p>
              <div className="template-variables-list">
                {templateVariableKeys.map((key) => (
                  <div key={key} className="template-variable-row">
                    <label className="template-variable-key">{key}</label>
                    <input
                      className="template-variable-input"
                      type="text"
                      placeholder={`{{${key}}}`}
                      value={variableValues[key] ?? ''}
                      onChange={(e) => handleVariableChange(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
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

          <button
            className="btn-save-template"
            onClick={() => {
              setSaveTemplateName('')
              setSaveTemplateCategory('other')
              setSaveTemplateDescription('')
              setSaveTemplateStatus('idle')
              setSaveTemplateModal(true)
            }}
            disabled={isRendering || slides.length === 0}
          >
            テンプレートとして保存
          </button>

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
