import { useState, useEffect } from 'react'
import type { TemplateInfo } from '../../types'

// ── Local constants ─────────────────────────────────────────────────────────
const VIEW_MODE_KEY = 'bemystyle-reel:view-mode'

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

function loadViewMode(): 'grid' | 'list' {
  const v = localStorage.getItem(VIEW_MODE_KEY)
  return v === 'list' ? 'list' : 'grid'
}

// ── Props ───────────────────────────────────────────────────────────────────
interface TemplateGalleryPanelProps {
  templates: TemplateInfo[]
  selectedTemplateId: string
  isRendering: boolean
  recentTemplateIds: string[]
  usageMap: Record<string, number>
  onConfirmLoadTemplate: (id: string) => void
  onDuplicateTemplate: (id: string) => void
  onToggleFavorite: (id: string, fav: boolean) => void
  onDeleteTemplate: (id: string) => Promise<void>
  onRenameTemplate: (id: string, name: string) => Promise<void>
}

// ── Component ───────────────────────────────────────────────────────────────
export function TemplateGalleryPanel({
  templates,
  selectedTemplateId,
  isRendering,
  recentTemplateIds,
  usageMap,
  onConfirmLoadTemplate,
  onDuplicateTemplate,
  onToggleFavorite,
  onDeleteTemplate,
  onRenameTemplate,
}: TemplateGalleryPanelProps) {
  const [templateSearch, setTemplateSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => loadViewMode())
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [renameTemplateId, setRenameTemplateId] = useState<string | null>(null)
  const [renameTemplateName, setRenameTemplateName] = useState('')
  const [renameTemplateStatus, setRenameTemplateStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting' | 'error'>('idle')

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleRename = async () => {
    if (!renameTemplateId || !renameTemplateName.trim()) return
    setRenameTemplateStatus('saving')
    try {
      await onRenameTemplate(renameTemplateId, renameTemplateName.trim())
      setRenameTemplateStatus('ok')
      setTimeout(() => {
        setRenameTemplateStatus('idle')
        setRenameTemplateId(null)
        setRenameTemplateName('')
      }, 1200)
    } catch {
      setRenameTemplateStatus('error')
      setTimeout(() => setRenameTemplateStatus('idle'), 3000)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteStatus('deleting')
    try {
      await onDeleteTemplate(id)
      setDeleteConfirmId(null)
      setDeleteStatus('idle')
    } catch {
      setDeleteStatus('error')
      setTimeout(() => setDeleteStatus('idle'), 3000)
    }
  }

  // ── Derived data ────────────────────────────────────────────────────────────
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

  const deleteTargetName = deleteConfirmId
    ? (templates.find((t) => t.id === deleteConfirmId)?.name ?? deleteConfirmId)
    : ''

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
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
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
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
                onClick={handleRename}
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
                onClick={() => handleDelete(deleteConfirmId)}
                disabled={deleteStatus === 'deleting'}
              >
                {deleteStatus === 'deleting' ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ギャラリー ── */}
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
                onClick={() => !isRendering && onConfirmLoadTemplate(t.id)}
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
                onClick={() => !isRendering && onConfirmLoadTemplate(t.id)}
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
                onClick={() => !isRendering && onConfirmLoadTemplate(t.id)}
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
                    onClick={() => onToggleFavorite(t.id, !!t.favorite)}
                    disabled={isRendering}
                    title="お気に入り"
                  >
                    {t.favorite ? '★' : '☆'}
                  </button>
                  <button
                    className="template-name-btn"
                    onClick={() => !isRendering && onConfirmLoadTemplate(t.id)}
                    disabled={isRendering}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                  <button
                    className="template-action-btn"
                    onClick={() => onDuplicateTemplate(t.id)}
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
    </>
  )
}
