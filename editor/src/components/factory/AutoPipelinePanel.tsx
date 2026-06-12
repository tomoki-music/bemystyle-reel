import type { LastPipeline } from './useFactoryPipeline'

type AutoPipelinePanelProps = {
  aiTheme: string
  isPipelineDisabled: boolean
  isAutoPipelineRunning: boolean
  pipelineStep: number
  pipelineStatus: string
  factoryWarning: string
  factoryError: string
  lastPipeline: LastPipeline | null
  onRunAutoPipeline: () => void
}

export function AutoPipelinePanel({
  aiTheme,
  isPipelineDisabled,
  isAutoPipelineRunning,
  pipelineStep,
  pipelineStatus,
  lastPipeline,
  onRunAutoPipeline,
}: AutoPipelinePanelProps) {
  return (
    <>
      {/* 🚀 Auto Render Pipeline (Phase14-C) */}
      <button
        className="btn-auto-pipeline"
        onClick={onRunAutoPipeline}
        disabled={isPipelineDisabled || !aiTheme.trim()}
      >
        {isAutoPipelineRunning ? '🚀 パイプライン実行中...' : '🚀 自動レンダーパイプライン'}
      </button>

      {/* Pipeline Progress Card */}
      {isAutoPipelineRunning && (
        <div className="pipeline-progress-card">
          <p className="pipeline-progress-title">🚀 自動パイプライン実行中</p>
          <div className="pipeline-steps">
            <div className={`pipeline-step${pipelineStep >= 1 ? ' pipeline-step--active' : ''}`}>
              <span className="pipeline-step-num">Step 1/3</span>
              <span className="pipeline-step-label">バリアント生成</span>
              {pipelineStep === 1 && <span className="pipeline-step-spinner">⏳</span>}
              {pipelineStep > 1 && <span className="pipeline-step-done">✅</span>}
            </div>
            <div className={`pipeline-step${pipelineStep >= 2 ? ' pipeline-step--active' : ''}`}>
              <span className="pipeline-step-num">Step 2/3</span>
              <span className="pipeline-step-label">レンダリング</span>
              {pipelineStep === 2 && <span className="pipeline-step-spinner">⏳</span>}
              {pipelineStep > 2 && <span className="pipeline-step-done">✅</span>}
            </div>
            <div className={`pipeline-step${pipelineStep >= 3 ? ' pipeline-step--active' : ''}`}>
              <span className="pipeline-step-num">Step 3/3</span>
              <span className="pipeline-step-label">比較ダッシュボード準備</span>
              {pipelineStep === 3 && <span className="pipeline-step-spinner">⏳</span>}
            </div>
          </div>
          <p className="pipeline-status-text">{pipelineStatus}</p>
        </div>
      )}

      {/* Pipeline Complete Card */}
      {!isAutoPipelineRunning && pipelineStatus === '比較ダッシュボード準備完了' && lastPipeline && (
        <div className="pipeline-complete-card">
          <p className="pipeline-complete-title">✅ パイプライン完了</p>
          <p className="pipeline-complete-stat">{lastPipeline.completedCount} バリアントをレンダリング</p>
          <p className="pipeline-complete-sub">比較できます</p>
        </div>
      )}

      {/* Pipeline Failed Card */}
      {!isAutoPipelineRunning && pipelineStatus === 'パイプライン失敗' && (
        <div className="pipeline-failed-card">
          <p className="pipeline-failed-title">❌ パイプライン失敗</p>
          <p className="pipeline-failed-sub">レンダーログを確認してください</p>
        </div>
      )}
    </>
  )
}
