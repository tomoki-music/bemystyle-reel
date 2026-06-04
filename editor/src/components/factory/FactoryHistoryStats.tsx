import React from 'react'

type FactoryHistoryStatsItem = {
  favorite?: boolean
  bestRecommendation: number
}

type FactoryHistoryStatsProps = {
  items: FactoryHistoryStatsItem[]
}

export function FactoryHistoryStats({ items }: FactoryHistoryStatsProps) {
  if (items.length === 0) return null

  const totalRuns = items.length
  const favoriteCount = items.filter((item) => item.favorite).length
  const highScoreCount = items.filter((item) => item.bestRecommendation >= 5).length
  const averageBestRecommendation =
    Math.round(
      (items.reduce((sum, item) => sum + item.bestRecommendation, 0) / items.length) * 10
    ) / 10

  return (
    <div className="factory-history-stats">
      <div className="factory-history-stat">
        <span className="factory-history-stat-label">Runs</span>
        <span className="factory-history-stat-value">{totalRuns}</span>
      </div>
      <div className="factory-history-stat">
        <span className="factory-history-stat-label">Favorites</span>
        <span className="factory-history-stat-value">{favoriteCount}</span>
      </div>
      <div className="factory-history-stat">
        <span className="factory-history-stat-label">High Score</span>
        <span className="factory-history-stat-value">{highScoreCount}</span>
      </div>
      <div className="factory-history-stat">
        <span className="factory-history-stat-label">Avg Best</span>
        <span className="factory-history-stat-value">{averageBestRecommendation}</span>
      </div>
    </div>
  )
}
