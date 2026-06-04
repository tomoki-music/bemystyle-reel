import React from 'react'

type RenderQueueActionsProps = {
  canBatchRender: boolean
  canClearQueue: boolean
  isBatchRendering: boolean
  onBatchRender: () => void
  onClearQueue: () => void
}

export function RenderQueueActions({
  canBatchRender,
  canClearQueue,
  isBatchRendering,
  onBatchRender,
  onClearQueue,
}: RenderQueueActionsProps) {
  return (
    <div className="render-queue-actions">
      <button
        className="btn-batch-render"
        onClick={onBatchRender}
        disabled={!canBatchRender}
      >
        {isBatchRendering ? '🎬 レンダリング中...' : '▶ Queue Render'}
      </button>
      <button
        className="btn-clear-queue"
        onClick={onClearQueue}
        disabled={!canClearQueue}
      >
        全削除
      </button>
    </div>
  )
}
