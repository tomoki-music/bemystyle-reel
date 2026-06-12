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
  queue: RenderQueueItem[]
  runner: {
    batchRender: () => void
    isBatchRendering: boolean
  }
  actions: {
    toggleSnapshotPreview: (id: string) => void
    toggleDiffView: (id: string) => void
    explainRewrite: (item: RenderQueueItem) => void
    removeFromQueue: (id: string) => void
    clearQueue: () => void
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
  context: {
    isAutoPipelineRunning: boolean
    isPipelineDisabled: boolean
    canRender: boolean
    slides: Slide[]
    renderDiffPanel: (currentSlides: Slide[], snapshotSlides: Slide[]) => React.ReactNode
  }
}

export function RenderQueuePanel({
  queue,
  runner,
  actions,
  rewrite,
  viewState,
  context,
}: RenderQueuePanelProps) {
  const canBatchRender = !context.isPipelineDisabled && context.canRender && queue.some((q) => q.status === 'pending')
  const canClearQueue = !runner.isBatchRendering && !context.isAutoPipelineRunning && !queue.every((q) => q.status === 'rendering')

  if (queue.length === 0) {
    return (
      <div className="render-queue-empty">
        <p className="render-queue-empty-title">生成待ちの動画はありません</p>
        <p className="render-queue-empty-hint">「AI自動作成」を実行すると、バリアントが自動でキューに追加されます。</p>
      </div>
    )
  }

  return (
    <>
      <RenderQueueHeader renderQueue={queue} />
      <ul className="render-queue-list">
        {queue.map((q) => (
          <RenderQueueItemCard
            key={q.id}
            item={q}
            snapshotExpanded={viewState.expandedSnapshotIds.includes(q.id)}
            diffExpanded={viewState.expandedDiffIds.includes(q.id)}
            rewriteExplainResult={rewrite.results[q.id]}
            rewriteExplainLoading={rewrite.loadingIds.includes(q.id)}
            rewriteExplainError={rewrite.errors[q.id]}
            isBatchRendering={runner.isBatchRendering}
            isAutoPipelineRunning={context.isAutoPipelineRunning}
            slides={context.slides}
            onToggleSnapshot={() => actions.toggleSnapshotPreview(q.id)}
            onToggleDiff={() => actions.toggleDiffView(q.id)}
            onExplainRewrite={() => actions.explainRewrite(q)}
            onRemove={() => actions.removeFromQueue(q.id)}
            renderDiffPanel={context.renderDiffPanel}
          />
        ))}
      </ul>
      <RenderQueueActions
        canBatchRender={canBatchRender}
        canClearQueue={canClearQueue}
        isBatchRendering={runner.isBatchRendering}
        onBatchRender={runner.batchRender}
        onClearQueue={actions.clearQueue}
      />
    </>
  )
}
