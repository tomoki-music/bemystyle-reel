import React from 'react'

type FactoryRunSectionProps = {
  factoryRunning: boolean
  factoryStep: string
  factoryStepNum: number
  factoryError: string
  factoryLog: string[]
  factoryNotice: string
  isPipelineDisabled: boolean

  onRunFactory: () => void
}

export function FactoryRunSection({
  factoryRunning,
  factoryStep,
  factoryStepNum,
  factoryError,
  factoryLog,
  factoryNotice,
  isPipelineDisabled,
  onRunFactory,
}: FactoryRunSectionProps) {
  return (
    <>
      <p className="factory-panel-desc">テーマ入力から Story → Variant → Score → Rewrite → Queue を一括実行します。</p>
      <button
        className="btn-factory-run"
        onClick={onRunFactory}
        disabled={isPipelineDisabled || factoryRunning}
      >
        {factoryRunning ? '🏭 Factory Running...' : '🏭 Factory Run'}
      </button>

      {factoryNotice && (
        <div className="factory-notice">
          {factoryNotice}
        </div>
      )}

      {/* Running */}
      {factoryRunning && (
        <div className="factory-card factory-card--running">
          <p className="factory-card-title">🏭 Factory Running</p>
          <div className="factory-steps">
            {[
              { num: 1, label: 'Story Generate' },
              { num: 2, label: 'Variant Generate' },
              { num: 3, label: 'Score Variants' },
              { num: 4, label: 'Select Top 3' },
              { num: 5, label: 'Rewrite Variants' },
              { num: 6, label: 'Queue' },
            ].map(({ num, label }) => (
              <div key={num} className={`factory-step${factoryStepNum >= num ? ' factory-step--active' : ''}`}>
                <span className="factory-step-num">Step {num}/6</span>
                <span className="factory-step-label">{label}</span>
                {factoryStepNum === num && <span className="factory-step-spinner">⏳</span>}
                {factoryStepNum > num && <span className="factory-step-done">✅</span>}
              </div>
            ))}
          </div>
          <p className="factory-status-text">{factoryStep}</p>
        </div>
      )}

      {/* Complete */}
      {!factoryRunning && factoryStep === 'Factory complete' && (
        <div className="factory-card factory-card--complete">
          <p className="factory-card-title">✅ Factory Complete</p>
          {factoryError && <p className="factory-notice">{factoryError}</p>}
        </div>
      )}

      {/* Failed */}
      {!factoryRunning && factoryStep === 'Factory failed' && (
        <div className="factory-card factory-card--failed">
          <p className="factory-card-title">❌ Factory Failed</p>
          <p className="factory-error-text">{factoryError}</p>
        </div>
      )}

      {/* Progress Log */}
      {factoryLog.length > 0 && (
        <div className="factory-log">
          {factoryLog.map((line, i) => (
            <p key={i} className="factory-log-line">{line}</p>
          ))}
        </div>
      )}
    </>
  )
}
