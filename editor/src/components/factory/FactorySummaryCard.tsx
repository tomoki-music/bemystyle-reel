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
        <p className="factory-summary-header">🏭 AI自動作成サマリー</p>
        <button className="btn-factory-clear" onClick={onClearSummary}>
          クリア
        </button>
      </div>
      <p className="factory-summary-timestamp">
        最終実行：{new Date(factorySummary.generatedAt).toLocaleString()}
      </p>
      <div className="factory-summary-grid">
        <div className="factory-summary-item">
          <span className="factory-summary-label">生成バリアント数</span>
          <span className="factory-summary-value">{factorySummary.generatedCount}</span>
        </div>
        <div className="factory-summary-item">
          <span className="factory-summary-label">選定バリアント数</span>
          <span className="factory-summary-value">{factorySummary.selectedCount}</span>
        </div>
        <div className="factory-summary-item">
          <span className="factory-summary-label">平均おすすめ度</span>
          <span className="factory-summary-value">{factorySummary.averageRecommendation}</span>
        </div>
        <div className="factory-summary-item">
          <span className="factory-summary-label">キュー追加数</span>
          <span className="factory-summary-value">{factorySummary.queueAddedCount}</span>
        </div>
      </div>
      <div className="factory-best-variant">
        <p className="factory-best-label">ベストバリアント</p>
        <p className="factory-best-name">{factorySummary.bestVariantName}</p>
        <p className="factory-best-rec">
          おすすめ度 {'★'.repeat(factorySummary.bestRecommendation)}
          {'☆'.repeat(Math.max(0, 5 - factorySummary.bestRecommendation))}
        </p>
      </div>
      {factorySummary.topVariants.length > 0 && (
        <div className="factory-top-variants">
          <p className="factory-top-variants-title">トップバリアント</p>
          {factorySummary.topVariants.map((v, i) => {
            const queueItem = findFactoryQueueItem(v.name)
            return (
              <div key={v.name} className="factory-top-variant">
                <span className="factory-top-rank">#{i + 1}</span>
                <span className="factory-top-name">{v.name}</span>
                <span className="factory-top-scores">
                  おすすめ度: {v.recommendation}
                  {v.predictedViews !== undefined && ` · 再生数: ${v.predictedViews}`}
                  {v.savePotential !== undefined && ` · 保存率: ${v.savePotential}`}
                  {v.ctaStrength !== undefined && ` · CTA: ${v.ctaStrength}`}
                </span>
                <div className="factory-top-variant-actions">
                  <button
                    className="btn-factory-view-snapshot"
                    onClick={() => onJumpToQueueItem(v.name)}
                    disabled={!queueItem}
                    title={
                      queueItem
                        ? 'キュー内のスナップショットへジャンプ'
                        : 'キュー内に該当バリアントがありません'
                    }
                  >
                    スナップショットを見る
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
