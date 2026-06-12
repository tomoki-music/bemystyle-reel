import { forwardRef } from 'react'
import type { HistoryItem } from '../history/useHistoryManager'

type GenerationHistoryPanelProps = {
  history: HistoryItem[]
  historyError: boolean
  formatHistoryDate: (iso: string) => string
  formatSize: (bytes: number) => string
}

export const GenerationHistoryPanel = forwardRef<HTMLDivElement, GenerationHistoryPanelProps>(
  function GenerationHistoryPanel({
    history,
    historyError,
    formatHistoryDate,
    formatSize,
  }, ref) {
    return (
      <div className="history-area" ref={ref}>
        <p className="history-title">生成履歴</p>
        {historyError ? (
          <p className="history-empty history-empty--error">生成履歴を取得できませんでした</p>
        ) : history.length === 0 ? (
          <p className="history-empty">生成履歴はまだありません</p>
        ) : (
          <ul className="history-list">
            {history.map((item, i) => (
              <li key={item.filename} className="history-item">
                {i === 0 && <span className="history-newest-badge">最新</span>}
                <span className="history-date">{formatHistoryDate(item.createdAt)}</span>
                <span className="history-size">{formatSize(item.size)}</span>
                <a className="history-dl" href={item.downloadUrl} download={item.filename}>DL</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
)
