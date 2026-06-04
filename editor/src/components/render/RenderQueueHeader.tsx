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
      <p className="render-queue-title">Render Queue</p>
      <div className="render-queue-summary">
        <span className="rqs-pending">Pending: {queueSummary.pending}</span>
        {queueSummary.rendering > 0 && <span className="rqs-rendering">Rendering: {queueSummary.rendering}</span>}
        {queueSummary.completed > 0 && <span className="rqs-completed">Completed: {queueSummary.completed}</span>}
        {queueSummary.failed > 0 && <span className="rqs-failed">Failed: {queueSummary.failed}</span>}
      </div>
    </div>
  )
}
