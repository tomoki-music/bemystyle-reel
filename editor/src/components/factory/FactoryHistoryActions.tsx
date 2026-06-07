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
        {favorite ? '★ お気に入り済み' : '☆ お気に入り'}
      </button>
      <button
        className="btn-factory-theme-edit"
        onClick={() => onEditTheme(itemId, theme)}
      >
        テーマ編集
      </button>
      <button
        className="btn-factory-reuse"
        onClick={() => onReuseTheme(theme)}
      >
        テーマを再利用
      </button>
      <button
        className="btn-factory-duplicate"
        onClick={() => onDuplicateTheme(theme)}
      >
        複製
      </button>
      <button
        className="btn-factory-rerun"
        onClick={() => onRerunFactory(theme)}
        disabled={factoryRunning}
      >
        再実行
      </button>
      <button
        className="btn-factory-history-delete"
        onClick={() => onDelete(itemId)}
      >
        削除
      </button>
    </div>
  )
}
