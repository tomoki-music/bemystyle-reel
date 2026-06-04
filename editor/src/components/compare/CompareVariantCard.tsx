import React from 'react'
import { Slide } from '../../types'

type RenderQueueItem = {
  id: string
  variantName: string
  status: 'pending' | 'rendering' | 'completed' | 'failed'
  outputPath?: string
  renderedAt?: string
  slidesSnapshot?: Slide[]
  snapshotCreatedAt?: string
}

type RewriteExplainResult = {
  summary: string
  reasons: string[]
  improvedPoints: string[]
  risks: string[]
  nextSuggestions: string[]
}

const AUTO_VARIANT_TEMPLATES = [
  'Default',
  'CTA強め版',
  '感情訴求版',
  '教育版',
  'ストーリー版',
  'YouTube版',
  'Instagram版',
]

type CompareVariantCardProps = {
  item: RenderQueueItem
  isBest: boolean
  snapshotExpanded: boolean
  diffExpanded: boolean
  rewriteExplainResult: RewriteExplainResult | undefined
  rewriteExplainLoading: boolean
  rewriteExplainError: string | undefined
  slides: Slide[]
  onSelectBest: () => void
  onToggleSnapshot: () => void
  onToggleDiff: () => void
  onExplainRewrite: () => void
  renderDiffPanel: (currentSlides: Slide[], snapshotSlides: Slide[]) => React.ReactNode
}

export function CompareVariantCard({
  item,
  isBest,
  snapshotExpanded,
  diffExpanded,
  rewriteExplainResult,
  rewriteExplainLoading,
  rewriteExplainError,
  slides,
  onSelectBest,
  onToggleSnapshot,
  onToggleDiff,
  onExplainRewrite,
  renderDiffPanel,
}: CompareVariantCardProps) {
  return (
    <div className={`compare-card${isBest ? ' compare-card--best' : ''}`}>
      {isBest && (
        <span className="compare-best-badge">🏆 Best</span>
      )}
      <p className="compare-card-name">
        {item.variantName}
        {AUTO_VARIANT_TEMPLATES.includes(item.variantName) && (
          <span className="compare-auto-badge">Auto</span>
        )}
        {item.slidesSnapshot && item.slidesSnapshot.length > 0 && (
          <span className="compare-snapshot-badge">📸 Snapshot Render</span>
        )}
      </p>
      {item.slidesSnapshot && item.slidesSnapshot.length > 0 && (
        <>
          <button
            className="btn-snapshot-preview"
            onClick={onToggleSnapshot}
          >
            {snapshotExpanded ? 'Hide Snapshot' : 'Preview Snapshot'}
          </button>
          <button
            className="btn-snapshot-diff"
            onClick={onToggleDiff}
          >
            {diffExpanded ? 'Hide Diff' : 'View Diff'}
          </button>
          {snapshotExpanded && (
            <div className="snapshot-preview-panel">
              {item.slidesSnapshot.slice(0, 5).map((slide, i) => (
                <div key={i} className="snapshot-preview-slide">
                  <p className="snapshot-preview-label">Slide {i + 1}</p>
                  {slide.headline && <p className="snapshot-preview-text"><span>Headline:</span> {slide.headline}</p>}
                  {slide.subline && <p className="snapshot-preview-text"><span>Subline:</span> {slide.subline}</p>}
                  {slide.emphasis && <p className="snapshot-preview-text"><span>Emphasis:</span> {slide.emphasis}</p>}
                </div>
              ))}
              {item.slidesSnapshot.length > 5 && (
                <p className="snapshot-preview-more">...and {item.slidesSnapshot.length - 5} more slides</p>
              )}
            </div>
          )}
          {diffExpanded && renderDiffPanel(slides, item.slidesSnapshot)}
          <button
            className="btn-rewrite-explain"
            onClick={onExplainRewrite}
            disabled={rewriteExplainLoading}
          >
            {rewriteExplainLoading
              ? 'Analyzing rewrite...'
              : rewriteExplainResult
                ? '↺ Refresh Explain'
                : '✦ Explain Rewrite'}
          </button>
          {rewriteExplainError && (
            <p className="rewrite-explain-error">{rewriteExplainError}</p>
          )}
          {rewriteExplainResult && (() => {
            const r = rewriteExplainResult
            return (
              <div className="rewrite-explain-panel">
                <p className="rewrite-explain-title">AI Rewrite Insight</p>
                {r.summary && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">Summary</p>
                    <p className="rewrite-explain-summary">{r.summary}</p>
                  </div>
                )}
                {r.reasons.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">Reasons</p>
                    <ul className="rewrite-explain-list">{r.reasons.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {r.improvedPoints.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">Improved Points</p>
                    <ul className="rewrite-explain-list rewrite-explain-list--improved">{r.improvedPoints.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {r.risks.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">Risks</p>
                    <ul className="rewrite-explain-list rewrite-explain-list--risk">{r.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {r.nextSuggestions.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">Next Suggestions</p>
                    <ul className="rewrite-explain-list">{r.nextSuggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
            )
          })()}
        </>
      )}
      {item.renderedAt && (
        <p className="compare-card-date">
          Rendered: {new Date(item.renderedAt).toLocaleString()}
        </p>
      )}
      {item.outputPath && (
        <video
          className="compare-card-video"
          src={item.outputPath}
          controls
          preload="metadata"
        />
      )}
      <div className="compare-card-actions">
        {item.outputPath && (
          <a className="btn-compare-dl" href={item.outputPath} download>
            Download
          </a>
        )}
        <button
          className={`btn-select-best${isBest ? ' btn-select-best--active' : ''}`}
          onClick={onSelectBest}
        >
          {isBest ? '🏆 Selected' : 'Select Best'}
        </button>
      </div>
    </div>
  )
}
