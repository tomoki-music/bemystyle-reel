import { ReactNode } from 'react'
import { Slide } from '../../types'
import { CompareVariantCard } from './CompareVariantCard'
import { BestVariantAnalysisPanel } from './BestVariantAnalysisPanel'
import { LastPipelineSummaryCard } from './LastPipelineSummaryCard'
import { CompareSummaryCard } from './CompareSummaryCard'
import { CompareDashboardHeader } from './CompareDashboardHeader'

type RenderQueueItem = {
  id: string
  variantName: string
  status: 'pending' | 'rendering' | 'completed' | 'failed'
  outputPath?: string
  renderedAt?: string
  slidesSnapshot?: Slide[]
  snapshotCreatedAt?: string
}

type LastPipeline = {
  completedCount: number
  failedCount: number
  finishedAt: string
}

type BestVariantAnalysis = {
  strengths: string[]
  weaknesses: string[]
  bestFor: string[]
  nextActions: string[]
  summary: string
}

type RewriteExplainResult = {
  summary: string
  reasons: string[]
  improvedPoints: string[]
  risks: string[]
  nextSuggestions: string[]
}

type CompareDashboardPanelProps = {
  completedVariants: RenderQueueItem[]
  lastPipeline: LastPipeline | null
  bestVariantId: string
  bestVariantAnalysis: BestVariantAnalysis | null
  bestVariantAnalysisLoading: boolean
  bestVariantAnalysisError: string
  expandedSnapshotIds: string[]
  expandedDiffIds: string[]
  rewriteExplainResults: Record<string, RewriteExplainResult>
  rewriteExplainLoadingIds: string[]
  rewriteExplainErrors: Record<string, string>
  slides: Slide[]
  onSelectBestVariant: (id: string) => void
  onAnalyzeBestVariant: () => void
  onToggleSnapshotPreview: (id: string) => void
  onToggleDiffView: (id: string) => void
  onExplainRewrite: (item: RenderQueueItem) => void
  renderDiffPanel: (currentSlides: Slide[], snapshotSlides: Slide[]) => ReactNode
}

export function CompareDashboardPanel({
  completedVariants,
  lastPipeline,
  bestVariantId,
  bestVariantAnalysis,
  bestVariantAnalysisLoading,
  bestVariantAnalysisError,
  expandedSnapshotIds,
  expandedDiffIds,
  rewriteExplainResults,
  rewriteExplainLoadingIds,
  rewriteExplainErrors,
  slides,
  onSelectBestVariant,
  onAnalyzeBestVariant,
  onToggleSnapshotPreview,
  onToggleDiffView,
  onExplainRewrite,
  renderDiffPanel,
}: CompareDashboardPanelProps) {
  const selectedBestVariantName =
    bestVariantId && completedVariants.some((q) => q.id === bestVariantId)
      ? completedVariants.find((q) => q.id === bestVariantId)?.variantName ?? null
      : null

  return (
    <>
      <CompareDashboardHeader />

      <LastPipelineSummaryCard
        lastPipeline={lastPipeline}
        bestVariantName={selectedBestVariantName ?? '未選択'}
      />

      <CompareSummaryCard
        completedCount={completedVariants.length}
        bestVariantName={selectedBestVariantName}
      />

      {selectedBestVariantName !== null && (
        <BestVariantAnalysisPanel
          analysis={bestVariantAnalysis}
          loading={bestVariantAnalysisLoading}
          error={bestVariantAnalysisError}
          onAnalyze={onAnalyzeBestVariant}
        />
      )}

      {completedVariants.length === 0 ? (
        <p className="compare-empty">
          まだ比較できるレンダリング結果がありません。Queueからレンダリングしてください。
        </p>
      ) : (
        <div className="compare-card-grid">
          {completedVariants.map((q) => (
            <CompareVariantCard
              key={q.id}
              item={q}
              isBest={q.id === bestVariantId}
              snapshotExpanded={expandedSnapshotIds.includes(q.id)}
              diffExpanded={expandedDiffIds.includes(q.id)}
              rewriteExplainResult={rewriteExplainResults[q.id]}
              rewriteExplainLoading={rewriteExplainLoadingIds.includes(q.id)}
              rewriteExplainError={rewriteExplainErrors[q.id]}
              slides={slides}
              onSelectBest={() => onSelectBestVariant(q.id)}
              onToggleSnapshot={() => onToggleSnapshotPreview(q.id)}
              onToggleDiff={() => onToggleDiffView(q.id)}
              onExplainRewrite={() => onExplainRewrite(q)}
              renderDiffPanel={renderDiffPanel}
            />
          ))}
        </div>
      )}
    </>
  )
}
