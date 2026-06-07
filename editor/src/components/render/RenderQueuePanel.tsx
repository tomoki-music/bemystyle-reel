import React from 'react'
import { Slide } from '../../types'
import { RenderQueueItemCard } from './RenderQueueItemCard'
import { RenderQueueHeader } from './RenderQueueHeader'
import { RenderQueueActions } from './RenderQueueActions'

type RenderQueueItem = {
  id: string
  variantName: string
  status: 'pending' | 'rendering' | 'completed' | 'failed'
  outputPath?: string
  renderedAt?: string
  slidesSnapshot?: Slide[]
  snapshotCreatedAt?: string
}

type RewriteExplainResult = {
  summary: string
  reasons: string[]
  improvedPoints: string[]
  risks: string[]
  nextSuggestions: string[]
}

type RenderQueuePanelProps = {
  renderQueue: RenderQueueItem[]
  expandedSnapshotIds: string[]
  expandedDiffIds: string[]
  rewriteExplainResults: Record<string, RewriteExplainResult>
  rewriteExplainLoadingIds: string[]
  rewriteExplainErrors: Record<string, string>
  isBatchRendering: boolean
  isAutoPipelineRunning: boolean
  isPipelineDisabled: boolean
  canRender: boolean
  slides: Slide[]
  onToggleSnapshotPreview: (id: string) => void
  onToggleDiffView: (id: string) => void
  onExplainRewrite: (item: RenderQueueItem) => void
  onRemoveFromQueue: (id: string) => void
  onBatchRender: () => void
  onClearQueue: () => void
  renderDiffPanel: (currentSlides: Slide[], snapshotSlides: Slide[]) => React.ReactNode
}

export function RenderQueuePanel({
  renderQueue,
  expandedSnapshotIds,
  expandedDiffIds,
  rewriteExplainResults,
  rewriteExplainLoadingIds,
  rewriteExplainErrors,
  isBatchRendering,
  isAutoPipelineRunning,
  isPipelineDisabled,
  canRender,
  slides,
  onToggleSnapshotPreview,
  onToggleDiffView,
  onExplainRewrite,
  onRemoveFromQueue,
  onBatchRender,
  onClearQueue,
  renderDiffPanel,
}: RenderQueuePanelProps) {
  const canBatchRender = !isPipelineDisabled && canRender && renderQueue.some((q) => q.status === 'pending')
  const canClearQueue = !isBatchRendering && !isAutoPipelineRunning && !renderQueue.every((q) => q.status === 'rendering')

  if (renderQueue.length === 0) {
    return (
      <div className="render-queue-empty">
        <p className="render-queue-empty-title">生成待ちの動画はありません</p>
        <p className="render-queue-empty-hint">「AI自動作成」を実行すると、バリアントが自動でキューに追加されます。</p>
      </div>
    )
  }

  return (
    <>
      <RenderQueueHeader renderQueue={renderQueue} />
      <ul className="render-queue-list">
        {renderQueue.map((q) => (
          <RenderQueueItemCard
            key={q.id}
            item={q}
            snapshotExpanded={expandedSnapshotIds.includes(q.id)}
            diffExpanded={expandedDiffIds.includes(q.id)}
            rewriteExplainResult={rewriteExplainResults[q.id]}
            rewriteExplainLoading={rewriteExplainLoadingIds.includes(q.id)}
            rewriteExplainError={rewriteExplainErrors[q.id]}
            isBatchRendering={isBatchRendering}
            isAutoPipelineRunning={isAutoPipelineRunning}
            slides={slides}
            onToggleSnapshot={() => onToggleSnapshotPreview(q.id)}
            onToggleDiff={() => onToggleDiffView(q.id)}
            onExplainRewrite={() => onExplainRewrite(q)}
            onRemove={() => onRemoveFromQueue(q.id)}
            renderDiffPanel={renderDiffPanel}
          />
        ))}
      </ul>
      <RenderQueueActions
        canBatchRender={canBatchRender}
        canClearQueue={canClearQueue}
        isBatchRendering={isBatchRendering}
        onBatchRender={onBatchRender}
        onClearQueue={onClearQueue}
      />
    </>
  )
}
