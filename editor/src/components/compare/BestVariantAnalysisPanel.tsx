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
        {loading ? '🧠 Analyzing...' : '🧠 Analyze Best Variant'}
      </button>
      {error && (
        <p className="analyze-best-error">{error}</p>
      )}
      {analysis && !loading && (
        <div className="best-variant-analysis">
          <p className="bva-title">AI Best Variant Analysis</p>
          {analysis.summary && (
            <div className="bva-section">
              <p className="bva-section-label">Summary</p>
              <p className="bva-summary-text">{analysis.summary}</p>
            </div>
          )}
          {analysis.strengths.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">Strengths</p>
              <ul className="bva-list bva-list--strengths">
                {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.weaknesses.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">Weaknesses</p>
              <ul className="bva-list bva-list--weaknesses">
                {analysis.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.bestFor.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">Best For</p>
              <ul className="bva-list">
                {analysis.bestFor.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.nextActions.length > 0 && (
            <div className="bva-section">
              <p className="bva-section-label">Next Actions</p>
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
