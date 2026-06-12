import type { VariantLearningSummary } from './useVariantManager'

type VariantLearningPanelProps = {
  variantLearningSummary: VariantLearningSummary
  onClearLearningData: () => void
}

export function VariantLearningPanel({
  variantLearningSummary,
  onClearLearningData,
}: VariantLearningPanelProps) {
  return (
    <div className="variant-learning-section">
      <div className="variant-learning-header">
        <p className="variant-learning-title">バリアント学習</p>
        {variantLearningSummary.totalEvents > 0 && (
          <button className="btn-clear-learning" onClick={onClearLearningData}>
            学習データをリセット
          </button>
        )}
      </div>
      {variantLearningSummary.totalEvents === 0 ? (
        <p className="variant-learning-empty">
          スライドに適用 または ベスト選択を行うと学習データが蓄積されます。
        </p>
      ) : (
        <>
          <div className="vl-stats">
            <span className="vl-stat">合計: {variantLearningSummary.totalEvents}</span>
            <span className="vl-stat">適用: {variantLearningSummary.appliedCount}</span>
            <span className="vl-stat">ベスト選択: {variantLearningSummary.selectedBestCount}</span>
          </div>
          {variantLearningSummary.topAngles.length > 0 && (
            <div className="vl-top-angles">
              <p className="vl-subsection-title">よく選ばれたアングル</p>
              <ol className="vl-rank-list">
                {variantLearningSummary.topAngles.map((a, i) => (
                  <li key={a.angle} className="vl-rank-item">
                    <span className="vl-rank-num">{i + 1}.</span>
                    <span className="vl-rank-label">{a.angle}</span>
                    <span className="vl-rank-count">{a.count}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {variantLearningSummary.recentEvents.length > 0 && (
            <div className="vl-recent">
              <p className="vl-subsection-title">最近の学習</p>
              <ul className="vl-recent-list">
                {variantLearningSummary.recentEvents.map((e) => (
                  <li key={e.id} className="vl-recent-item">
                    <span className="vl-recent-date">
                      {new Date(e.createdAt).toLocaleDateString('ja-JP')}
                    </span>
                    <span className="vl-recent-angle">{e.angle}</span>
                    <span className="vl-recent-action">{e.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
