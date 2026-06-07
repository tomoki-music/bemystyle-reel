import React from 'react'
import { FactoryHistoryActions } from './FactoryHistoryActions'
import { FactoryHistoryTags } from './FactoryHistoryTags'

type TopVariant = {
  name: string
  recommendation: number
}

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
  topVariants: TopVariant[]
}

type FactoryHistoryItemCardProps = {
  item: FactoryHistoryItemLike

  selected: boolean
  onToggleSelection: (id: string) => void

  factoryRunning: boolean
  maxThemeLength: number

  editingTheme: { id: string; value: string } | null
  onEditingThemeChange: (value: string) => void
  onSaveThemeEdit: () => void
  onCancelThemeEdit: () => void

  quickTags: string[]

  editingTag: EditingTagState
  onEditingTagInputChange: (value: string) => void

  tagInputValue: string
  onTagInputChange: (value: string) => void

  onStartEditTag: (id: string, tag: string) => void
  onSaveEditTag: () => void
  onCancelEditTag: () => void
  onRemoveTag: (id: string, tag: string) => void
  onAddTag: (id: string) => void
  onQuickAddTag: (id: string, tag: string) => void

  onToggleFavorite: (id: string) => void
  onReuseTheme: (theme: string) => void
  onDuplicateTheme: (theme: string) => void
  onRerunFactory: (theme: string) => void
  onEditTheme: (id: string, theme: string) => void
  onDelete: (id: string) => void
}

export function FactoryHistoryItemCard({
  item,
  selected,
  onToggleSelection,
  factoryRunning,
  maxThemeLength,
  editingTheme,
  onEditingThemeChange,
  onSaveThemeEdit,
  onCancelThemeEdit,
  quickTags,
  editingTag,
  onEditingTagInputChange,
  tagInputValue,
  onTagInputChange,
  onStartEditTag,
  onSaveEditTag,
  onCancelEditTag,
  onRemoveTag,
  onAddTag,
  onQuickAddTag,
  onToggleFavorite,
  onReuseTheme,
  onDuplicateTheme,
  onRerunFactory,
  onEditTheme,
  onDelete,
}: FactoryHistoryItemCardProps) {
  const isEditingTheme = editingTheme?.id === item.id
  const isTruncated = item.theme.length > maxThemeLength
  const displayTheme = isTruncated
    ? `${item.theme.slice(0, maxThemeLength)}...`
    : item.theme

  return (
    <li
      className={`factory-history-item${item.favorite ? ' factory-history-item--favorite' : ''}${selected ? ' factory-history-item--selected' : ''}`}
    >
      <div className="factory-history-meta">
        <input
          type="checkbox"
          className="factory-history-select"
          checked={selected}
          onChange={() => onToggleSelection(item.id)}
        />
        <span className="factory-history-date">
          {new Date(item.generatedAt).toLocaleString()}
        </span>
        <span className="factory-history-stats">
          生成：{item.generatedCount} · 選定：{item.selectedCount} · 推奨：{item.averageRecommendation} · キュー：{item.queueAddedCount}
        </span>
        {item.favorite && <span className="factory-history-favorite-badge">★ お気に入り</span>}
      </div>
      <div className="factory-history-theme-row">
        {isEditingTheme ? (
          <div className="factory-history-theme-edit">
            <input
              className="factory-history-theme-edit-input"
              value={editingTheme!.value}
              onChange={(e) => onEditingThemeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onSaveThemeEdit() }
                if (e.key === 'Escape') onCancelThemeEdit()
              }}
              autoFocus
            />
            <div className="factory-history-theme-edit-actions">
              <button className="btn-factory-theme-save" onClick={onSaveThemeEdit}>保存</button>
              <button className="btn-factory-theme-cancel" onClick={onCancelThemeEdit}>キャンセル</button>
            </div>
          </div>
        ) : (
          <p className={`factory-history-theme${isTruncated ? ' factory-history-theme--truncated' : ''}`}>
            "<span title={item.theme}>{displayTheme}</span>"
            <span className="factory-history-theme-length">{item.theme.length} 文字</span>
          </p>
        )}
        <FactoryHistoryActions
          itemId={item.id}
          theme={item.theme}
          favorite={item.favorite}
          factoryRunning={factoryRunning}
          onToggleFavorite={onToggleFavorite}
          onReuseTheme={onReuseTheme}
          onDuplicateTheme={onDuplicateTheme}
          onRerunFactory={onRerunFactory}
          onEditTheme={onEditTheme}
          onDelete={onDelete}
        />
      </div>
      <p className="factory-history-best">
        ベスト: {item.bestVariantName} {'★'.repeat(item.bestRecommendation)}{'☆'.repeat(Math.max(0, 5 - item.bestRecommendation))}
      </p>
      {item.topVariants.length > 0 && (
        <div className="factory-history-top-variants">
          {item.topVariants.map((v, i) => (
            <span key={v.name} className="factory-history-variant-chip">
              #{i + 1} {v.name} ({v.recommendation})
            </span>
          ))}
        </div>
      )}
      <FactoryHistoryTags
        itemId={item.id}
        tags={item.tags}
        quickTags={quickTags}
        editingTag={editingTag}
        onEditingTagInputChange={onEditingTagInputChange}
        tagInputValue={tagInputValue}
        onTagInputChange={onTagInputChange}
        onStartEditTag={onStartEditTag}
        onSaveEditTag={onSaveEditTag}
        onCancelEditTag={onCancelEditTag}
        onRemoveTag={onRemoveTag}
        onAddTag={onAddTag}
        onQuickAddTag={onQuickAddTag}
      />
    </li>
  )
}
