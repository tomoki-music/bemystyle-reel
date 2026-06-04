import React from 'react'

type TopVariant = {
  name: string
  recommendation: number
  predictedViews?: number
  savePotential?: number
  ctaStrength?: number
}

type FactorySummaryData = {
  generatedCount: number
  selectedCount: number
  averageRecommendation: number
  bestVariantName: string
  bestRecommendation: number
  queueAddedCount: number
  generatedAt: string
  topVariants: TopVariant[]
}

type QueueItemRef = {
  id: string
  variantName: string
}

type FactorySummaryCardProps = {
  factorySummary: FactorySummaryData
  findFactoryQueueItem: (variantName: string) => QueueItemRef | undefined
  onClearSummary: () => void
  onJumpToQueueItem: (variantName: string) => void
}

export function FactorySummaryCard({
  factorySummary,
  findFactoryQueueItem,
  onClearSummary,
  onJumpToQueueItem,
}: FactorySummaryCardProps) {
  return (
    <div className="factory-summary-card">
      <div className="factory-summary-header-row">
        <p className="factory-summary-header">🏭 Factory Summary</p>
        <button className="btn-factory-clear" onClick={onClearSummary}>
          Clear
        </button>
      </div>
      <p className="factory-summary-timestamp">
        Last Factory Run: {new Date(factorySummary.generatedAt).toLocaleString()}
      </p>
      <div className="factory-summary-grid">
        <div className="factory-summary-item">
          <span className="factory-summary-label">Generated Variants</span>
          <span className="factory-summary-value">{factorySummary.generatedCount}</span>
        </div>
        <div className="factory-summary-item">
          <span className="factory-summary-label">Selected Variants</span>
          <span className="factory-summary-value">{factorySummary.selectedCount}</span>
        </div>
        <div className="factory-summary-item">
          <span className="factory-summary-label">Average Recommendation</span>
          <span className="factory-summary-value">{factorySummary.averageRecommendation}</span>
        </div>
        <div className="factory-summary-item">
          <span className="factory-summary-label">Queue Added</span>
          <span className="factory-summary-value">{factorySummary.queueAddedCount}</span>
        </div>
      </div>
      <div className="factory-best-variant">
        <p className="factory-best-label">Best Variant</p>
        <p className="factory-best-name">{factorySummary.bestVariantName}</p>
        <p className="factory-best-rec">
          Recommendation {'★'.repeat(factorySummary.bestRecommendation)}
          {'☆'.repeat(Math.max(0, 5 - factorySummary.bestRecommendation))}
        </p>
      </div>
      {factorySummary.topVariants.length > 0 && (
        <div className="factory-top-variants">
          <p className="factory-top-variants-title">Top Variants</p>
          {factorySummary.topVariants.map((v, i) => {
            const queueItem = findFactoryQueueItem(v.name)
            return (
              <div key={v.name} className="factory-top-variant">
                <span className="factory-top-rank">#{i + 1}</span>
                <span className="factory-top-name">{v.name}</span>
                <span className="factory-top-scores">
                  Rec: {v.recommendation}
                  {v.predictedViews !== undefined && ` · Views: ${v.predictedViews}`}
                  {v.savePotential !== undefined && ` · Save: ${v.savePotential}`}
                  {v.ctaStrength !== undefined && ` · CTA: ${v.ctaStrength}`}
                </span>
                <div className="factory-top-variant-actions">
                  <button
                    className="btn-factory-view-snapshot"
                    onClick={() => onJumpToQueueItem(v.name)}
                    disabled={!queueItem}
                    title={
                      queueItem
                        ? 'Queue内のSnapshotへジャンプ'
                        : 'Queue内に該当Variantがありません'
                    }
                  >
                    View Snapshot
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
