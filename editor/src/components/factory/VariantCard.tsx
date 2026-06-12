import type { Slide } from '../../types'
import type { RenderQueueItem } from '../renderQueue/useRenderQueue'
import type { GeneratedVariant, VariantScore } from './useVariantManager'

type VariantCardProps = {
  variant: GeneratedVariant
  variantScore?: VariantScore
  isRecommended: boolean
  renderQueue: RenderQueueItem[]
  slideCount: number
  isPipelineDisabled: boolean
  rewrittenStory?: Slide[]
  isRewriting: boolean
  rewriteError?: string
  onAddVariantToQueue: (variantName: string) => void
  onRewriteStory: (angle: string) => void
  onApplyRewrittenStory: (angle: string) => void
}

export function VariantCard({
  variant,
  variantScore,
  isRecommended,
  renderQueue,
  slideCount,
  isPipelineDisabled,
  rewrittenStory,
  isRewriting,
  rewriteError,
  onAddVariantToQueue,
  onRewriteStory,
  onApplyRewrittenStory,
}: VariantCardProps) {
  const isQueued = renderQueue.some((q) => q.variantName === variant.name)

  return (
    <li className={`generated-variant-card${isRecommended ? ' generated-variant-card--recommended' : ''}`}>
      <div className="generated-variant-info">
        <span className="generated-variant-name">🧠 {variant.name}</span>
        {isRecommended && <span className="variant-recommended-badge">⚡ 推奨</span>}
        <span className="generated-variant-desc">{variant.description}</span>
      </div>
      {variantScore && (
          <div className="variant-score-panel">
            <p className="variant-score-title">AIスコア</p>
            <div className="variant-score-grid">
              <span className="vs-label">推奨度</span><span className="vs-value">{variantScore.recommendation}/5</span>
              <span className="vs-label">再生数</span><span className="vs-value">{variantScore.predictedViews}/5</span>
              <span className="vs-label">保存率</span><span className="vs-value">{variantScore.savePotential}/5</span>
              <span className="vs-label">CTA</span><span className="vs-value">{variantScore.ctaStrength}/5</span>
            </div>
            <p className="vs-reason">{variantScore.reason}</p>
          </div>
      )}
      <div className="generated-variant-actions">
        <button
          className="btn-add-variant-queue"
          onClick={() => onAddVariantToQueue(variant.name)}
          disabled={isPipelineDisabled || isQueued}
        >
          {isQueued ? '✓' : '＋ キューに追加'}
        </button>
        {rewrittenStory ? (
          <button
            className="btn-rewrite-story btn-rewrite-story--regen"
            onClick={() => onRewriteStory(variant.angle)}
            disabled={isRewriting || isPipelineDisabled}
          >
            {isRewriting ? '🪄 リライト中...' : '🔄 再生成'}
          </button>
        ) : (
          <button
            className="btn-rewrite-story"
            onClick={() => onRewriteStory(variant.angle)}
            disabled={isRewriting || isPipelineDisabled || slideCount === 0}
          >
            {isRewriting ? '🪄 リライト中...' : '🪄 ストーリーリライト'}
          </button>
        )}
      </div>
      {rewriteError && (
        <p className="rewrite-story-error">{rewriteError}</p>
      )}
      {rewrittenStory && (
        <div className="story-preview">
          <div className="story-preview-header">
            <span className="story-preview-title">ストーリープレビュー</span>
            <button
              className="btn-apply-story"
              onClick={() => onApplyRewrittenStory(variant.angle)}
            >
              スライドに適用
            </button>
          </div>
          {rewrittenStory.slice(0, 3).map((s, si) => (
            <div key={si} className="story-preview-slide">
              {s.headline && <p className="sps-headline">{s.headline}</p>}
              {s.subline   && <p className="sps-subline">{s.subline}</p>}
              {s.emphasis  && <p className="sps-emphasis">{s.emphasis}</p>}
            </div>
          ))}
        </div>
      )}
    </li>
  )
}
