import type { RenderQueueItem } from '../renderQueue/useRenderQueue'
import { VariantCard } from './VariantCard'
import type { GeneratedVariant, RewrittenStoryMap, VariantScore } from './useVariantManager'

export type VariantGeneratorPanelProps = {
  aiTheme: string
  slideCount: number
  isPipelineDisabled: boolean
  generatedVariants: GeneratedVariant[]
  isGeneratingVariants: boolean
  variantGenerateError: string
  variantScores: VariantScore[]
  isScoringVariants: boolean
  variantScoreError: string
  smartQueueMessage: string
  renderQueue: RenderQueueItem[]
  rewrittenStories: RewrittenStoryMap
  isRewritingStory: Record<string, boolean>
  rewriteStoryError: Record<string, string>
  onGenerateVariants: () => void
  onScoreVariants: () => void
  onAddAllVariantsToQueue: () => void
  onAddSmartQueue: () => void
  onAddVariantToQueue: (variantName: string) => void
  onRewriteStory: (angle: string) => void
  onApplyRewrittenStory: (angle: string) => void
}

export function VariantGeneratorPanel({
  aiTheme,
  slideCount,
  isPipelineDisabled,
  generatedVariants,
  isGeneratingVariants,
  variantGenerateError,
  variantScores,
  isScoringVariants,
  variantScoreError,
  smartQueueMessage,
  renderQueue,
  rewrittenStories,
  isRewritingStory,
  rewriteStoryError,
  onGenerateVariants,
  onScoreVariants,
  onAddAllVariantsToQueue,
  onAddSmartQueue,
  onAddVariantToQueue,
  onRewriteStory,
  onApplyRewrittenStory,
}: VariantGeneratorPanelProps) {
  return (
    <div className="ai-variant-generator">
      <button
        className="btn-ai-generate-variants"
        onClick={onGenerateVariants}
        disabled={isPipelineDisabled || isGeneratingVariants || !aiTheme.trim()}
      >
        {isGeneratingVariants ? '🧠 生成中...' : '🧠 AIバリアント生成'}
      </button>
      {variantGenerateError && (
        <p className="variant-generate-error">{variantGenerateError}</p>
      )}
      {generatedVariants.length > 0 && (
        <div className="generated-variants-panel">
          <div className="generated-variants-header">
            <p className="generated-variants-title">生成済みバリアント</p>
            <div className="generated-variants-header-actions">
              <button
                className="btn-score-variants"
                onClick={onScoreVariants}
                disabled={isPipelineDisabled || isScoringVariants || !aiTheme.trim()}
              >
                {isScoringVariants ? '📊 スコアリング中...' : '📊 スコアリング'}
              </button>
              <button
                className="btn-add-all-variants"
                onClick={onAddAllVariantsToQueue}
                disabled={isPipelineDisabled}
              >
                ＋ 全てキューに追加
              </button>
              <button
                className="btn-smart-queue"
                onClick={onAddSmartQueue}
                disabled={isPipelineDisabled || variantScores.length === 0}
              >
                ⚡ スマートキュー
              </button>
            </div>
          </div>
          {(() => {
            const candidateCount = variantScores.filter((s) => s.recommendation >= 4).length
            return variantScores.length > 0 ? (
              <div className="smart-queue-summary">
                <span>スマートキュー候補: <strong>{candidateCount}</strong></span>
                <span className="smart-queue-threshold">基準: 推奨度4以上</span>
              </div>
            ) : null
          })()}
          {smartQueueMessage && (
            <p className="smart-queue-message">{smartQueueMessage}</p>
          )}
          {variantScoreError && (
            <p className="variant-score-error">{variantScoreError}</p>
          )}
          <ul className="generated-variants-list">
            {generatedVariants.map((variant, i) => {
              const variantScore = variantScores.find((s) => s.variantName === variant.name || s.angle === variant.angle)
              const isRecommended = variantScore ? variantScore.recommendation >= 4 : false
              const rewrittenStory = rewrittenStories[variant.angle]
              const isRewriting = Boolean(isRewritingStory[variant.angle])
              const rewriteError = rewriteStoryError[variant.angle]
              return (
                <VariantCard
                  key={i}
                  variant={variant}
                  variantScore={variantScore}
                  isRecommended={isRecommended}
                  renderQueue={renderQueue}
                  slideCount={slideCount}
                  isPipelineDisabled={isPipelineDisabled}
                  rewrittenStory={rewrittenStory}
                  isRewriting={isRewriting}
                  rewriteError={rewriteError}
                  onAddVariantToQueue={onAddVariantToQueue}
                  onRewriteStory={onRewriteStory}
                  onApplyRewrittenStory={onApplyRewrittenStory}
                />
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
