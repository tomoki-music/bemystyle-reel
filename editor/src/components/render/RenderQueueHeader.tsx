import React from 'react'

type RenderQueueItem = {
  status: 'pending' | 'rendering' | 'completed' | 'failed'
}

interface RenderQueueHeaderProps {
  renderQueue: RenderQueueItem[]
}

export function RenderQueueHeader({ renderQueue }: RenderQueueHeaderProps) {
  const queueSummary = {
    pending:   renderQueue.filter((q) => q.status === 'pending').length,
    rendering: renderQueue.filter((q) => q.status === 'rendering').length,
    completed: renderQueue.filter((q) => q.status === 'completed').length,
    failed:    renderQueue.filter((q) => q.status === 'failed').length,
  }

  return (
    <div className="render-queue-header">
      <p className="render-queue-title">レンダーキュー</p>
      <div className="render-queue-summary">
        <span className="rqs-pending">待機: {queueSummary.pending}</span>
        {queueSummary.rendering > 0 && <span className="rqs-rendering">レンダリング中: {queueSummary.rendering}</span>}
        {queueSummary.completed > 0 && <span className="rqs-completed">完了: {queueSummary.completed}</span>}
        {queueSummary.failed > 0 && <span className="rqs-failed">失敗: {queueSummary.failed}</span>}
      </div>
    </div>
  )
}
