import React from 'react'

type FactoryHistoryActionsProps = {
  itemId: string
  theme: string
  favorite?: boolean
  factoryRunning: boolean

  onToggleFavorite: (id: string) => void
  onReuseTheme: (theme: string) => void
  onDuplicateTheme: (theme: string) => void
  onRerunFactory: (theme: string) => void
  onEditTheme: (id: string, theme: string) => void
  onDelete: (id: string) => void
}

export function FactoryHistoryActions({
  itemId,
  theme,
  favorite,
  factoryRunning,
  onToggleFavorite,
  onReuseTheme,
  onDuplicateTheme,
  onRerunFactory,
  onEditTheme,
  onDelete,
}: FactoryHistoryActionsProps) {
  return (
    <div className="factory-history-actions">
      <button
        className={`btn-factory-favorite${favorite ? ' btn-factory-favorite--active' : ''}`}
        onClick={() => onToggleFavorite(itemId)}
      >
        {favorite ? '★ Favorited' : '☆ Favorite'}
      </button>
      <button
        className="btn-factory-theme-edit"
        onClick={() => onEditTheme(itemId, theme)}
      >
        Edit Theme
      </button>
      <button
        className="btn-factory-reuse"
        onClick={() => onReuseTheme(theme)}
      >
        Reuse Theme
      </button>
      <button
        className="btn-factory-duplicate"
        onClick={() => onDuplicateTheme(theme)}
      >
        Duplicate
      </button>
      <button
        className="btn-factory-rerun"
        onClick={() => onRerunFactory(theme)}
        disabled={factoryRunning}
      >
        Rerun Factory
      </button>
      <button
        className="btn-factory-history-delete"
        onClick={() => onDelete(itemId)}
      >
        Delete
      </button>
    </div>
  )
}
