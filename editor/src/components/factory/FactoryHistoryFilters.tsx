import React from 'react'

type FactoryHistoryFilter = 'all' | 'favorites' | 'highScore'

type FactoryHistoryTagStat = {
  tag: string
  count: number
}

type FactoryHistoryFiltersProps = {
  hasHistory: boolean

  filter: FactoryHistoryFilter
  onFilterChange: (filter: FactoryHistoryFilter) => void

  search: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void

  selectedTag: string
  tagStats: FactoryHistoryTagStat[]
  onSelectedTagChange: (tag: string) => void
}

export function FactoryHistoryFilters({
  hasHistory,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  onClearSearch,
  selectedTag,
  tagStats,
  onSelectedTagChange,
}: FactoryHistoryFiltersProps) {
  if (!hasHistory) return null

  return (
    <>
      <div className="factory-history-filter">
        {(['all', 'favorites', 'highScore'] as const).map((f) => (
          <button
            key={f}
            className={`btn-factory-history-filter${filter === f ? ' btn-factory-history-filter--active' : ''}`}
            onClick={() => onFilterChange(f)}
          >
            {f === 'all' ? 'すべて' : f === 'favorites' ? 'お気に入り' : '高スコア'}
          </button>
        ))}
      </div>
      <div className="factory-history-search-row">
        <input
          className="factory-history-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="履歴を検索..."
        />
        {search && (
          <button className="btn-factory-history-clear-search" onClick={onClearSearch}>
            クリア
          </button>
        )}
      </div>
      {tagStats.length > 0 && (
        <div className="factory-history-tag-filter">
          <span className="factory-history-tag-filter-label">タグ：</span>
          <button
            className={`btn-factory-history-tag-filter${selectedTag === '' ? ' btn-factory-history-tag-filter--active' : ''}`}
            onClick={() => onSelectedTagChange('')}
          >
            すべてのタグ
          </button>
          {tagStats.map((stat) => (
            <button
              key={stat.tag}
              className={`btn-factory-history-tag-filter${selectedTag === stat.tag ? ' btn-factory-history-tag-filter--active' : ''}`}
              onClick={() => onSelectedTagChange(stat.tag)}
            >
              #{stat.tag}
              <span className="factory-history-tag-count">{stat.count}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
