import React from 'react'

type FactoryHistoryBulkBarProps = {
  selectedCount: number
  onBulkDelete: () => void
  onClearSelection: () => void
}

export function FactoryHistoryBulkBar({
  selectedCount,
  onBulkDelete,
  onClearSelection,
}: FactoryHistoryBulkBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="factory-history-bulk-bar">
      <span className="factory-history-bulk-count">{selectedCount} selected</span>
      <button className="btn-factory-bulk-delete" onClick={onBulkDelete}>
        Bulk Delete
      </button>
      <button className="btn-factory-clear-selection" onClick={onClearSelection}>
        Clear Selection
      </button>
    </div>
  )
}
