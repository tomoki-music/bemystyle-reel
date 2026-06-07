import React from 'react'

type EditingTagState = {
  itemId: string
  oldTag: string
  value: string
} | null

type FactoryHistoryTagsProps = {
  itemId: string
  tags?: string[]
  quickTags: string[]

  editingTag: EditingTagState
  onEditingTagInputChange: (value: string) => void

  tagInputValue: string
  onTagInputChange: (value: string) => void

  onStartEditTag: (itemId: string, tag: string) => void
  onSaveEditTag: () => void
  onCancelEditTag: () => void
  onRemoveTag: (itemId: string, tag: string) => void
  onAddTag: (itemId: string) => void
  onQuickAddTag: (itemId: string, tag: string) => void
}

export function FactoryHistoryTags({
  itemId,
  tags,
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
}: FactoryHistoryTagsProps) {
  const currentTags = tags ?? []

  return (
    <div className="factory-history-tags">
      {currentTags.map((tag) => {
        const isEditing =
          editingTag?.itemId === itemId && editingTag?.oldTag === tag
        if (isEditing) {
          return (
            <span key={tag} className="factory-history-tag-edit">
              <input
                className="factory-history-tag-edit-input"
                value={editingTag.value}
                onChange={(e) => onEditingTagInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); onSaveEditTag() }
                  if (e.key === 'Escape') onCancelEditTag()
                }}
                autoFocus
              />
              <button className="btn-factory-tag-save" onClick={onSaveEditTag}>保存</button>
              <button className="btn-factory-tag-cancel" onClick={onCancelEditTag}>キャンセル</button>
            </span>
          )
        }
        return (
          <span key={tag} className="factory-history-tag">
            #{tag}
            <button
              className="btn-factory-tag-edit"
              onClick={() => onStartEditTag(itemId, tag)}
            >編集</button>
            <button
              className="factory-history-tag-remove"
              onClick={() => onRemoveTag(itemId, tag)}
            >×</button>
          </span>
        )
      })}
      <div className="factory-history-tag-form">
        <input
          className="factory-history-tag-input"
          placeholder="タグを追加..."
          value={tagInputValue}
          onChange={(e) => onTagInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onAddTag(itemId) }
          }}
        />
        <button className="btn-factory-add-tag" onClick={() => onAddTag(itemId)}>追加</button>
      </div>
      <div className="factory-history-quick-tags">
        <span className="factory-history-quick-label">クイック：</span>
        {quickTags.map((qt) => (
          <button
            key={qt}
            className="btn-factory-quick-tag"
            onClick={() => onQuickAddTag(itemId, qt)}
            disabled={currentTags.includes(qt) || currentTags.length >= 8}
          >
            {qt}
          </button>
        ))}
      </div>
    </div>
  )
}
