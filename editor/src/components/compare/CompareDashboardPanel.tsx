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
  data: {
    completedVariants: RenderQueueItem[]
    lastPipeline: LastPipeline | null
    bestVariantId: string
  }
  analysis: {
    result: BestVariantAnalysis | null
    loading: boolean
    error: string
  }
  rewrite: {
    results: Record<string, RewriteExplainResult>
    loadingIds: string[]
    errors: Record<string, string>
  }
  viewState: {
    expandedSnapshotIds: string[]
    expandedDiffIds: string[]
  }
  actions: {
    selectBestVariant: (id: string) => void
    analyzeBestVariant: () => void
    toggleSnapshotPreview: (id: string) => void
    toggleDiffView: (id: string) => void
    explainRewrite: (item: RenderQueueItem) => void
  }
  context: {
    slides: Slide[]
    renderDiffPanel: (currentSlides: Slide[], snapshotSlides: Slide[]) => ReactNode
  }
}

export function CompareDashboardPanel({
  data,
  analysis,
  rewrite,
  viewState,
  actions,
  context,
}: CompareDashboardPanelProps) {
  const { completedVariants, lastPipeline, bestVariantId } = data
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
          analysis={analysis.result}
          loading={analysis.loading}
          error={analysis.error}
          onAnalyze={actions.analyzeBestVariant}
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
              snapshotExpanded={viewState.expandedSnapshotIds.includes(q.id)}
              diffExpanded={viewState.expandedDiffIds.includes(q.id)}
              rewriteExplainResult={rewrite.results[q.id]}
              rewriteExplainLoading={rewrite.loadingIds.includes(q.id)}
              rewriteExplainError={rewrite.errors[q.id]}
              slides={context.slides}
              onSelectBest={() => actions.selectBestVariant(q.id)}
              onToggleSnapshot={() => actions.toggleSnapshotPreview(q.id)}
              onToggleDiff={() => actions.toggleDiffView(q.id)}
              onExplainRewrite={() => actions.explainRewrite(q)}
              renderDiffPanel={context.renderDiffPanel}
            />
          ))}
        </div>
      )}
    </>
  )
}
