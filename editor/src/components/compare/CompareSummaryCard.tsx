import React from 'react'

interface CompareSummaryCardProps {
  completedCount: number
  bestVariantName: string | null
}

export function CompareSummaryCard({ completedCount, bestVariantName }: CompareSummaryCardProps) {
  return (
    <div className="compare-summary">
      <span>完了バリアント: {completedCount}</span>
      {bestVariantName && (
        <span className="compare-summary-best">
          最良バリアント: {bestVariantName}
        </span>
      )}
    </div>
  )
}
