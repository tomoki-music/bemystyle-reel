type BestVariantAnalysis = {
  strengths: string[]
  weaknesses: string[]
  bestFor: string[]
  nextActions: string[]
  summary: string
}

type BestVariantAnalysisPanelProps = {
  analysis: BestVariantAnalysis | null
  loading: boolean
  error: string
  onAnalyze: () => void
}

export function BestVariantAnalysisPanel({
  analysis,
  loading,
  error,
  onAnalyze,
}: BestVariantAnalysisPanelProps) {
  return (
    <div className="analyze-best-section">
      <button
        className="btn-analyze-best"
        onClick={onAnalyze}
        disabled={loading}
      >
        {loading ? '🧠 分析中...' : '🧠 最良バリアント分析'}
      </button>
      {error && (
        <p className="analyze-best-error">{error}</p>
      )}
      {analysis && !loading && (
        <div className="best-variant-analysis">
          <p className="bva-title">AI最良バリアント分析</p>
          {analysis.summary && (
            <div className="bva-section">
              <p className="bva-section-label">サマリー</p>
              <p className="bva-summary-text">{analysis.summary}</p>
            </div>
          )}
          {analysis.strengths.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">強み</p>
              <ul className="bva-list bva-list--strengths">
                {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.weaknesses.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">弱み</p>
              <ul className="bva-list bva-list--weaknesses">
                {analysis.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.bestFor.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">最適なケース</p>
              <ul className="bva-list">
                {analysis.bestFor.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.nextActions.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">次のアクション</p>
              <ul className="bva-list bva-list--actions">
                {analysis.nextActions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
