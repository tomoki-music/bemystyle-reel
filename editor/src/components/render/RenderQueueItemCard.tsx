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

interface RenderQueueItemCardProps {
  item: RenderQueueItem
  snapshotExpanded: boolean
  diffExpanded: boolean
  rewriteExplainResult: RewriteExplainResult | undefined
  rewriteExplainLoading: boolean
  rewriteExplainError: string | undefined
  isBatchRendering: boolean
  isAutoPipelineRunning: boolean
  slides: Slide[]
  onToggleSnapshot: () => void
  onToggleDiff: () => void
  onExplainRewrite: () => void
  onRemove: () => void
  renderDiffPanel: (currentSlides: Slide[], snapshotSlides: Slide[]) => React.ReactNode
}

export function RenderQueueItemCard({
  item,
  snapshotExpanded,
  diffExpanded,
  rewriteExplainResult,
  rewriteExplainLoading,
  rewriteExplainError,
  isBatchRendering,
  isAutoPipelineRunning,
  slides,
  onToggleSnapshot,
  onToggleDiff,
  onExplainRewrite,
  onRemove,
  renderDiffPanel,
}: RenderQueueItemCardProps) {
  return (
    <li id={`render-queue-item-${item.id}`} className={`render-queue-item render-queue-item--${item.status}`}>
      <span className="render-queue-icon">
        {item.status === 'pending' ? '⏳' : item.status === 'rendering' ? '🎬' : item.status === 'completed' ? '✅' : '❌'}
      </span>
      <span className="render-queue-name">{item.variantName}</span>
      {item.slidesSnapshot && item.slidesSnapshot.length > 0 && (
        <>
          <span className="render-queue-snapshot-badge" title={`スライド: ${item.slidesSnapshot.length}`}>
            📸 スナップショット
            <span className="render-queue-snapshot-count">スライド: {item.slidesSnapshot.length}</span>
          </span>
          <button
            className="btn-snapshot-preview"
            onClick={onToggleSnapshot}
          >
            {snapshotExpanded ? 'スナップショットを隠す' : 'スナップショットを見る'}
          </button>
          <button
            className="btn-snapshot-diff"
            onClick={onToggleDiff}
          >
            {diffExpanded ? '差分を隠す' : '差分を見る'}
          </button>
          {snapshotExpanded && (
            <div className="snapshot-preview-panel">
              {item.slidesSnapshot.slice(0, 5).map((slide, i) => (
                <div key={i} className="snapshot-preview-slide">
                  <p className="snapshot-preview-label">スライド {i + 1}</p>
                  {slide.headline && <p className="snapshot-preview-text"><span>ヘッドライン:</span> {slide.headline}</p>}
                  {slide.subline && <p className="snapshot-preview-text"><span>サブライン:</span> {slide.subline}</p>}
                  {slide.emphasis && <p className="snapshot-preview-text"><span>強調:</span> {slide.emphasis}</p>}
                </div>
              ))}
              {item.slidesSnapshot.length > 5 && (
                <p className="snapshot-preview-more">...他 {item.slidesSnapshot.length - 5} 枚</p>
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
              ? '分析中...'
              : rewriteExplainResult
                ? '↺ 再分析'
                : '✦ リライト分析'}
          </button>
          {rewriteExplainError && (
            <p className="rewrite-explain-error">{rewriteExplainError}</p>
          )}
          {rewriteExplainResult && (() => {
            const r = rewriteExplainResult
            return (
              <div className="rewrite-explain-panel">
                <p className="rewrite-explain-title">AIリライト分析</p>
                {r.summary && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">サマリー</p>
                    <p className="rewrite-explain-summary">{r.summary}</p>
                  </div>
                )}
                {r.reasons.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">理由</p>
                    <ul className="rewrite-explain-list">{r.reasons.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {r.improvedPoints.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">改善点</p>
                    <ul className="rewrite-explain-list rewrite-explain-list--improved">{r.improvedPoints.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {r.risks.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">リスク</p>
                    <ul className="rewrite-explain-list rewrite-explain-list--risk">{r.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {r.nextSuggestions.length > 0 && (
                  <div className="rewrite-explain-section">
                    <p className="rewrite-explain-section-label">次のアドバイス</p>
                    <ul className="rewrite-explain-list">{r.nextSuggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
            )
          })()}
        </>
      )}
      {item.outputPath && (
        <a className="render-queue-dl" href={item.outputPath} download>ダウンロード</a>
      )}
      <button
        className="render-queue-delete"
        onClick={onRemove}
        disabled={item.status === 'rendering' || isBatchRendering || isAutoPipelineRunning}
      >
        削除
      </button>
    </li>
  )
}
