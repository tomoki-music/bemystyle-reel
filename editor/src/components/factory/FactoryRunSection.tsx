import React from 'react'

type FactoryRunSectionProps = {
  factoryRunning: boolean
  factoryStep: string
  factoryStepNum: number
  factoryError: string
  factoryLog: string[]
  factoryNotice: string
  factoryWarning?: string
  isPipelineDisabled: boolean
  hasTheme: boolean

  onRunFactory: () => void
}

export function FactoryRunSection({
  factoryRunning,
  factoryStep,
  factoryStepNum,
  factoryError,
  factoryLog,
  factoryNotice,
  factoryWarning,
  isPipelineDisabled,
  hasTheme,
  onRunFactory,
}: FactoryRunSectionProps) {
  return (
    <>
      <p className="factory-panel-desc">テーマ入力から Story → 画像生成 → Variant → Score → Rewrite → Queue を一括実行します。</p>
      <div className="factory-preconditions">
        <p className={`factory-precondition-item${hasTheme ? ' factory-precondition-item--ok' : ' factory-precondition-item--warn'}`}>
          {hasTheme ? '✅' : '⚠️'} テーマ入力済み
        </p>
        <p className="factory-precondition-item factory-precondition-item--info">
          ℹ️ ストーリー・画像生成は自動実行（手動での事前操作不要）
        </p>
      </div>
      <button
        className="btn-factory-run"
        onClick={onRunFactory}
        disabled={isPipelineDisabled || factoryRunning}
      >
        {factoryRunning ? '🏭 実行中...' : '🏭 ファクトリー実行'}
      </button>

      {factoryNotice && (
        <div className="factory-notice">
          {factoryNotice}
        </div>
      )}

      {factoryWarning && !factoryRunning && (
        <div className="factory-warning">
          {factoryWarning}
        </div>
      )}

      {/* Running */}
      {factoryRunning && (
        <div className="factory-card factory-card--running">
          <p className="factory-card-title">🏭 ファクトリー実行中</p>
          <div className="factory-steps">
            {[
              { num: 1, label: 'ストーリー生成' },
              { num: 2, label: 'AI画像生成' },
              { num: 3, label: 'バリアント生成' },
              { num: 4, label: 'バリアントスコアリング' },
              { num: 5, label: 'トップ3選定' },
              { num: 6, label: 'バリアントリライト' },
              { num: 7, label: 'キュー投入' },
            ].map(({ num, label }) => (
              <div key={num} className={`factory-step${factoryStepNum >= num ? ' factory-step--active' : ''}`}>
                <span className="factory-step-num">ステップ {num}/7</span>
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
          <p className="factory-card-title">✅ 完了</p>
          {factoryError && <p className="factory-notice">{factoryError}</p>}
        </div>
      )}

      {/* Failed */}
      {!factoryRunning && factoryStep === 'Factory failed' && (
        <div className="factory-card factory-card--failed">
          <p className="factory-card-title">❌ 失敗</p>
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
