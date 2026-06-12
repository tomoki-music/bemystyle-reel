import type {
  LastMultiRewriteQueue,
  LastSmartPipeline,
  LastSmartRewritePipeline,
} from './usePipelineRunner'

export type SmartPipelinePanelProps = {
  aiTheme: string
  isPipelineDisabled: boolean

  isSmartPipelineRunning: boolean
  smartPipelineStep: number
  smartPipelineStatus: string
  smartPipelineError: string
  lastSmartPipeline: LastSmartPipeline | null
  onRunSmartPipeline: () => void

  isSmartRewritePipelineRunning: boolean
  smartRewritePipelineStep: number
  smartRewritePipelineStatus: string
  smartRewritePipelineError: string
  lastSmartRewritePipeline: LastSmartRewritePipeline | null
  onRunSmartRewritePipeline: () => void

  isMultiRewriteQueueRunning: boolean
  multiRewriteQueueStep: number
  multiRewriteQueueStatus: string
  multiRewriteQueueError: string
  lastMultiRewriteQueue: LastMultiRewriteQueue | null
  onRunMultiRewriteQueue: () => void
}

export function SmartPipelinePanel({
  aiTheme,
  isPipelineDisabled,
  isSmartPipelineRunning,
  smartPipelineStep,
  smartPipelineStatus,
  smartPipelineError,
  lastSmartPipeline,
  onRunSmartPipeline,
  isSmartRewritePipelineRunning,
  smartRewritePipelineStep,
  smartRewritePipelineStatus,
  smartRewritePipelineError,
  lastSmartRewritePipeline,
  onRunSmartRewritePipeline,
  isMultiRewriteQueueRunning,
  multiRewriteQueueStep,
  multiRewriteQueueStatus,
  multiRewriteQueueError,
  lastMultiRewriteQueue,
  onRunMultiRewriteQueue,
}: SmartPipelinePanelProps) {
  return (
    <>
      {/* 🧠⚡ Smart Pipeline (Phase14-I) */}
      <button
        className="btn-smart-pipeline"
        onClick={onRunSmartPipeline}
        disabled={isPipelineDisabled || !aiTheme.trim()}
      >
        {isSmartPipelineRunning ? '🧠⚡ スマートパイプライン実行中...' : '🧠⚡ スマートパイプライン'}
      </button>

      {/* Smart Pipeline Progress Card */}
      {isSmartPipelineRunning && (
        <div className="smart-pipeline-card smart-pipeline-card--running">
          <p className="smart-pipeline-card-title">🧠⚡ スマートパイプライン実行中</p>
          <div className="smart-pipeline-steps">
            {[
              { num: 1, label: 'AI生成' },
              { num: 2, label: 'スコアリング' },
              { num: 3, label: 'キュー投入' },
              { num: 4, label: 'レンダリング' },
              { num: 5, label: '比較' },
            ].map(({ num, label }) => (
              <div key={num} className={`smart-pipeline-step${smartPipelineStep >= num ? ' smart-pipeline-step--active' : ''}`}>
                <span className="smart-pipeline-step-num">ステップ {num}/5</span>
                <span className="smart-pipeline-step-label">{label}</span>
                {smartPipelineStep === num && <span className="smart-pipeline-step-spinner">⏳</span>}
                {smartPipelineStep > num && <span className="smart-pipeline-step-done">✅</span>}
              </div>
            ))}
          </div>
          <p className="smart-pipeline-status-text">{smartPipelineStatus}</p>
        </div>
      )}

      {/* Smart Pipeline Complete Card */}
      {!isSmartPipelineRunning && smartPipelineStatus === '比較ダッシュボード準備完了' && lastSmartPipeline && (
        <div className="smart-pipeline-card smart-pipeline-card--complete">
          <p className="smart-pipeline-card-title">✅ スマートパイプライン完了</p>
          <div className="smart-pipeline-stats">
            <span>生成: <strong>{lastSmartPipeline.generatedCount}</strong></span>
            <span>推奨: <strong>{lastSmartPipeline.recommendedCount}</strong></span>
            <span>レンダリング: <strong>{lastSmartPipeline.renderedCount}</strong></span>
            {lastSmartPipeline.failedCount > 0 && (
              <span className="smart-pipeline-stat--fail">失敗: <strong>{lastSmartPipeline.failedCount}</strong></span>
            )}
          </div>
          {smartPipelineError && <p className="smart-pipeline-notice">{smartPipelineError}</p>}
        </div>
      )}

      {/* Smart Pipeline Failed Card */}
      {!isSmartPipelineRunning && smartPipelineStatus === 'スマートパイプライン失敗' && (
        <div className="smart-pipeline-card smart-pipeline-card--failed">
          <p className="smart-pipeline-card-title">❌ スマートパイプライン失敗</p>
          <p className="smart-pipeline-error-text">{smartPipelineError}</p>
        </div>
      )}

      {/* 🪄⚡ Smart Rewrite Pipeline (Phase14-K) */}
      <button
        className="btn-smart-pipeline"
        onClick={onRunSmartRewritePipeline}
        disabled={isPipelineDisabled || !aiTheme.trim()}
      >
        {isSmartRewritePipelineRunning ? '🪄⚡ スマートリライト実行中...' : '🪄⚡ スマートリライト'}
      </button>

      {/* Smart Rewrite Pipeline Progress Card */}
      {isSmartRewritePipelineRunning && (
        <div className="smart-pipeline-card smart-pipeline-card--running">
          <p className="smart-pipeline-card-title">🪄⚡ スマートリライト実行中</p>
          <div className="smart-pipeline-steps">
            {[
              { num: 1, label: 'AI生成' },
              { num: 2, label: 'スコアリング' },
              { num: 3, label: 'トップ選定' },
              { num: 4, label: 'ストーリーリライト' },
              { num: 5, label: 'ストーリー適用' },
              { num: 6, label: 'キュー投入' },
              { num: 7, label: 'レンダリング' },
              { num: 8, label: '比較' },
            ].map(({ num, label }) => (
              <div key={num} className={`smart-pipeline-step${smartRewritePipelineStep >= num ? ' smart-pipeline-step--active' : ''}`}>
                <span className="smart-pipeline-step-num">ステップ {num}/8</span>
                <span className="smart-pipeline-step-label">{label}</span>
                {smartRewritePipelineStep === num && <span className="smart-pipeline-step-spinner">⏳</span>}
                {smartRewritePipelineStep > num && <span className="smart-pipeline-step-done">✅</span>}
              </div>
            ))}
          </div>
          <p className="smart-pipeline-status-text">{smartRewritePipelineStatus}</p>
        </div>
      )}

      {/* Smart Rewrite Pipeline Complete Card */}
      {!isSmartRewritePipelineRunning && smartRewritePipelineStatus === 'スマートリライト完了' && lastSmartRewritePipeline && (
        <div className="smart-pipeline-card smart-pipeline-card--complete">
          <p className="smart-pipeline-card-title">✅ スマートリライト完了</p>
          <div className="smart-pipeline-stats">
            {lastSmartRewritePipeline.selectedVariantName ? (
              <>
                <span>選定: <strong>{lastSmartRewritePipeline.selectedVariantName}</strong></span>
                <span>推奨度: <strong>{lastSmartRewritePipeline.recommendation}/5</strong></span>
                <span>レンダリング: <strong>{lastSmartRewritePipeline.renderedCount}</strong></span>
                {lastSmartRewritePipeline.failedCount > 0 && (
                  <span className="smart-pipeline-stat--fail">失敗: <strong>{lastSmartRewritePipeline.failedCount}</strong></span>
                )}
              </>
            ) : (
              <span className="smart-pipeline-notice">{smartRewritePipelineError}</span>
            )}
          </div>
          {smartRewritePipelineError && lastSmartRewritePipeline.selectedVariantName && (
            <p className="smart-pipeline-notice">{smartRewritePipelineError}</p>
          )}
        </div>
      )}

      {/* Smart Rewrite Pipeline Failed Card */}
      {!isSmartRewritePipelineRunning && smartRewritePipelineStatus === 'スマートリライト失敗' && (
        <div className="smart-pipeline-card smart-pipeline-card--failed">
          <p className="smart-pipeline-card-title">❌ スマートリライト失敗</p>
          <p className="smart-pipeline-error-text">{smartRewritePipelineError}</p>
        </div>
      )}

      {/* 🪄🧩 Multi Rewrite Queue (Phase14-L) */}
      <button
        className="btn-smart-pipeline"
        onClick={onRunMultiRewriteQueue}
        disabled={isPipelineDisabled || !aiTheme.trim()}
      >
        {isMultiRewriteQueueRunning ? '🪄🧩 マルチリライトキュー実行中...' : '🪄🧩 マルチリライトキュー'}
      </button>

      {/* Multi Rewrite Queue Progress Card */}
      {isMultiRewriteQueueRunning && (
        <div className="smart-pipeline-card smart-pipeline-card--running">
          <p className="smart-pipeline-card-title">🪄🧩 マルチリライトキュー実行中</p>
          <div className="smart-pipeline-steps">
            {[
              { num: 1, label: 'AI生成' },
              { num: 2, label: 'スコアリング' },
              { num: 3, label: 'トップ3選定' },
              { num: 4, label: 'バリアントリライト' },
              { num: 5, label: '最初のリライト適用' },
              { num: 6, label: 'リライトキュー投入' },
              { num: 7, label: 'レンダリング' },
              { num: 8, label: '比較' },
            ].map(({ num, label }) => (
              <div key={num} className={`smart-pipeline-step${multiRewriteQueueStep >= num ? ' smart-pipeline-step--active' : ''}`}>
                <span className="smart-pipeline-step-num">ステップ {num}/8</span>
                <span className="smart-pipeline-step-label">{label}</span>
                {multiRewriteQueueStep === num && <span className="smart-pipeline-step-spinner">⏳</span>}
                {multiRewriteQueueStep > num && <span className="smart-pipeline-step-done">✅</span>}
              </div>
            ))}
          </div>
          <p className="smart-pipeline-status-text">{multiRewriteQueueStatus}</p>
        </div>
      )}

      {/* Multi Rewrite Queue Complete Card */}
      {!isMultiRewriteQueueRunning && multiRewriteQueueStatus === 'マルチリライトキュー完了' && lastMultiRewriteQueue && (
        <div className="smart-pipeline-card smart-pipeline-card--complete">
          <p className="smart-pipeline-card-title">✅ マルチリライトキュー完了</p>
          <div className="smart-pipeline-stats">
            {lastMultiRewriteQueue.selectedVariants.length > 0 ? (
              <>
                <span>リライト: <strong>{lastMultiRewriteQueue.rewrittenCount}</strong></span>
                <span>キュー投入: <strong>{lastMultiRewriteQueue.queuedCount}</strong></span>
                <span>レンダリング: <strong>{lastMultiRewriteQueue.renderedCount}</strong></span>
                {lastMultiRewriteQueue.failedCount > 0 && (
                  <span className="smart-pipeline-stat--fail">失敗: <strong>{lastMultiRewriteQueue.failedCount}</strong></span>
                )}
              </>
            ) : (
              <span className="smart-pipeline-notice">{multiRewriteQueueError}</span>
            )}
          </div>
          {lastMultiRewriteQueue.selectedVariants.length > 0 && (
            <div className="smart-pipeline-selected-variants">
              <p className="smart-pipeline-selected-label">選定:</p>
              {lastMultiRewriteQueue.selectedVariants.map((name) => (
                <span key={name} className="smart-pipeline-variant-tag">{name}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Multi Rewrite Queue Failed Card */}
      {!isMultiRewriteQueueRunning && multiRewriteQueueStatus === 'マルチリライトキュー失敗' && (
        <div className="smart-pipeline-card smart-pipeline-card--failed">
          <p className="smart-pipeline-card-title">❌ マルチリライトキュー失敗</p>
          <p className="smart-pipeline-error-text">{multiRewriteQueueError}</p>
        </div>
      )}
    </>
  )
}
