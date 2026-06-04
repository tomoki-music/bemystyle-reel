type LastPipeline = {
  completedCount: number
  failedCount: number
  finishedAt: string
}

type LastPipelineSummaryCardProps = {
  lastPipeline: LastPipeline | null
  bestVariantName: string
}

export function LastPipelineSummaryCard({
  lastPipeline,
  bestVariantName,
}: LastPipelineSummaryCardProps) {
  if (!lastPipeline) return null

  return (
    <div className="pipeline-last-summary">
      <p className="pipeline-last-title">Last Pipeline</p>
      <div className="pipeline-last-stats">
        <span className="pipeline-last-stat pipeline-last-stat--ok">Completed: {lastPipeline.completedCount}</span>
        <span className={`pipeline-last-stat${lastPipeline.failedCount > 0 ? ' pipeline-last-stat--fail' : ''}`}>Failed: {lastPipeline.failedCount}</span>
        <span className="pipeline-last-stat pipeline-last-stat--best">
          Best: {bestVariantName}
        </span>
      </div>
    </div>
  )
}
