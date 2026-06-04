import { useState, useMemo } from 'react'
import { FactoryHistoryStats } from './FactoryHistoryStats'
import { FactoryHistoryFilters } from './FactoryHistoryFilters'
import { FactoryHistoryBulkBar } from './FactoryHistoryBulkBar'
import { FactoryHistoryItemCard } from './FactoryHistoryItemCard'

type FactoryHistoryFilter = 'all' | 'favorites' | 'highScore'

type EditingTagState = {
  itemId: string
  oldTag: string
  value: string
} | null

type FactoryHistoryItemLike = {
  id: string
  theme: string
  favorite?: boolean
  tags?: string[]
  generatedAt: string
  generatedCount: number
  selectedCount: number
  averageRecommendation: number
  queueAddedCount: number
  bestVariantName: string
  bestRecommendation: number
  topVariants: { name: string; recommendation: number }[]
}

type FactoryHistoryPanelProps = {
  factoryHistory: FactoryHistoryItemLike[]
  factoryRunning: boolean
  maxThemeLength: number
  quickTags: string[]

  onHistoryUpdate: (items: FactoryHistoryItemLike[]) => void
  onToggleFavorite: (id: string) => void
  onReuseTheme: (theme: string) => void
  onDuplicateTheme: (theme: string) => void
  onRerunFactory: (theme: string) => void
  onDelete: (id: string) => void
  onExportJson: () => void
  onExportCsv: () => void
  onImportFile: (file: File) => void
  onClearHistory: () => void
}

export function FactoryHistoryPanel({
  factoryHistory,
  factoryRunning,
  maxThemeLength,
  quickTags,
  onHistoryUpdate,
  onToggleFavorite,
  onReuseTheme,
  onDuplicateTheme,
  onRerunFactory,
  onDelete,
  onExportJson,
  onExportCsv,
  onImportFile,
  onClearHistory,
}: FactoryHistoryPanelProps) {
  const [filter, setFilter] = useState<FactoryHistoryFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingTagInputs, setEditingTagInputs] = useState<Record<string, string>>({})
  const [editingTag, setEditingTag] = useState<EditingTagState>(null)
  const [editingTheme, setEditingTheme] = useState<{ id: string; value: string } | null>(null)

  // 削除・クリア後に自動整合：factoryHistory に存在するIDのみ有効
  const historyIdSet = useMemo(
    () => new Set(factoryHistory.map((h) => h.id)),
    [factoryHistory]
  )
  const effectiveSelectedIds = useMemo(
    () => selectedIds.filter((id) => historyIdSet.has(id)),
    [selectedIds, historyIdSet]
  )

  const tagStats = useMemo(() => {
    return Array.from(
      factoryHistory
        .flatMap((item) => item.tags ?? [])
        .reduce((map, tag) => {
          map.set(tag, (map.get(tag) ?? 0) + 1)
          return map
        }, new Map<string, number>())
    )
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }, [factoryHistory])

  const visibleFactoryHistory = useMemo(() => {
    if (factoryHistory.length === 0) return []
    const keyword = search.trim().toLowerCase()
    return [...factoryHistory]
      .filter((item) => {
        if (filter === 'favorites') return !!item.favorite
        if (filter === 'highScore') return item.bestRecommendation >= 5
        return true
      })
      .filter((item) => {
        if (!keyword) return true
        return [item.theme, item.bestVariantName, ...item.topVariants.map((v) => v.name), ...(item.tags ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      })
      .filter((item) => {
        if (!selectedTag) return true
        return (item.tags ?? []).includes(selectedTag)
      })
      .sort((a, b) => {
        if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1
        return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
      })
  }, [factoryHistory, filter, search, selectedTag])

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const handleBulkDelete = () => {
    if (effectiveSelectedIds.length === 0) return
    if (!window.confirm(`${effectiveSelectedIds.length}件の履歴を削除しますか？`)) return
    const selected = new Set(effectiveSelectedIds)
    onHistoryUpdate(factoryHistory.filter((item) => !selected.has(item.id)))
    setSelectedIds([])
  }

  const handleTagInputChange = (id: string, value: string) => {
    setEditingTagInputs((prev) => ({ ...prev, [id]: value }))
  }

  const addTagValue = (id: string, tag: string) => {
    const value = tag.trim()
    if (!value) return
    const next = factoryHistory.map((item) => {
      if (item.id !== id) return item
      const currentTags = item.tags ?? []
      if (currentTags.includes(value)) return item
      return { ...item, tags: [...currentTags, value].slice(0, 8) }
    })
    onHistoryUpdate(next)
  }

  const addTag = (id: string) => {
    const value = editingTagInputs[id]?.trim()
    if (!value) return
    addTagValue(id, value)
    setEditingTagInputs((prev) => ({ ...prev, [id]: '' }))
  }

  const removeTag = (id: string, tag: string) => {
    const next = factoryHistory.map((item) =>
      item.id === id
        ? { ...item, tags: (item.tags ?? []).filter((t) => t !== tag) }
        : item
    )
    onHistoryUpdate(next)
  }

  const saveTagEdit = () => {
    if (!editingTag) return
    const nextTag = editingTag.value.trim()
    if (!nextTag) return
    const next = factoryHistory.map((item) => {
      if (item.id !== editingTag.itemId) return item
      const updatedTags = (item.tags ?? []).map((t) =>
        t === editingTag.oldTag ? nextTag : t
      )
      return { ...item, tags: Array.from(new Set(updatedTags)).slice(0, 8) }
    })
    onHistoryUpdate(next)
    setEditingTag(null)
  }

  const saveThemeEdit = () => {
    if (!editingTheme) return
    const nextTheme = editingTheme.value.trim()
    if (!nextTheme) return
    const next = factoryHistory.map((item) =>
      item.id === editingTheme.id
        ? { ...item, theme: nextTheme }
        : item
    )
    onHistoryUpdate(next)
    setEditingTheme(null)
  }

  const handleClearHistoryInternal = () => {
    setSelectedIds([])
    onClearHistory()
  }

  return (
    <div className="factory-history-panel">
      <div className="factory-history-header">
        <p className="factory-history-title">📋 Factory History</p>
        <div className="factory-history-header-actions">
          {factoryHistory.length > 0 && (
            <>
              <button className="btn-factory-export" onClick={onExportJson}>
                Export JSON
              </button>
              <button className="btn-factory-export-csv" onClick={onExportCsv}>
                Export CSV
              </button>
            </>
          )}
          <label className="btn-factory-import">
            Import
            <input
              className="factory-history-import-input"
              type="file"
              accept="application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onImportFile(file)
                e.currentTarget.value = ''
              }}
            />
          </label>
          {factoryHistory.length > 0 && (
            <button className="btn-factory-clear-history" onClick={handleClearHistoryInternal}>
              Clear History
            </button>
          )}
        </div>
      </div>
      <FactoryHistoryBulkBar
        selectedCount={effectiveSelectedIds.length}
        onBulkDelete={handleBulkDelete}
        onClearSelection={() => setSelectedIds([])}
      />
      <FactoryHistoryStats items={factoryHistory} />
      <FactoryHistoryFilters
        hasHistory={factoryHistory.length > 0}
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        onClearSearch={() => setSearch('')}
        selectedTag={selectedTag}
        tagStats={tagStats}
        onSelectedTagChange={(tag) => setSelectedTag((prev) => (prev === tag ? '' : tag))}
      />
      {factoryHistory.length === 0 ? (
        <p className="factory-history-empty">No factory history yet</p>
      ) : visibleFactoryHistory.length === 0 ? (
        <p className="factory-history-empty">No matching factory history</p>
      ) : (
        <ul className="factory-history-list">
          {visibleFactoryHistory.map((item) => (
            <FactoryHistoryItemCard
              key={item.id}
              item={item}
              selected={effectiveSelectedIds.includes(item.id)}
              onToggleSelection={toggleSelection}
              factoryRunning={factoryRunning}
              maxThemeLength={maxThemeLength}
              editingTheme={editingTheme}
              onEditingThemeChange={(value) =>
                setEditingTheme((prev) => (prev ? { ...prev, value } : null))
              }
              onSaveThemeEdit={saveThemeEdit}
              onCancelThemeEdit={() => setEditingTheme(null)}
              quickTags={quickTags}
              editingTag={editingTag?.itemId === item.id ? editingTag : null}
              onEditingTagInputChange={(value) =>
                setEditingTag((prev) => (prev ? { ...prev, value } : prev))
              }
              tagInputValue={editingTagInputs[item.id] ?? ''}
              onTagInputChange={(value) => handleTagInputChange(item.id, value)}
              onStartEditTag={(id, tag) =>
                setEditingTag({ itemId: id, oldTag: tag, value: tag })
              }
              onSaveEditTag={saveTagEdit}
              onCancelEditTag={() => setEditingTag(null)}
              onRemoveTag={removeTag}
              onAddTag={addTag}
              onQuickAddTag={addTagValue}
              onToggleFavorite={onToggleFavorite}
              onReuseTheme={onReuseTheme}
              onDuplicateTheme={onDuplicateTheme}
              onRerunFactory={onRerunFactory}
              onEditTheme={(id, theme) => setEditingTheme({ id, value: theme })}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
