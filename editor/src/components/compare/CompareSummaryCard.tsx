import React from 'react'

interface CompareSummaryCardProps {
  completedCount: number
  bestVariantName: string | null
}

export function CompareSummaryCard({ completedCount, bestVariantName }: CompareSummaryCardProps) {
  return (
    <div className="compare-summary">
      <span>Completed Variants: {completedCount}</span>
      {bestVariantName && (
        <span className="compare-summary-best">
          Best Variant: {bestVariantName}
        </span>
      )}
    </div>
  )
}
