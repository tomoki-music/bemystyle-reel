import React from 'react'

type FactoryRunSectionProps = {
  factoryRunning: boolean
  factoryStep: string
  factoryStepNum: number
  factoryProgress: number
  factoryCurrentImageIndex: number | null
  factoryTotalImageCount: number | null
  factoryError: string
  factoryLog: string[]
  factoryNotice: string
  factoryWarning?: string
  isPipelineDisabled: boolean
  hasTheme: boolean

  onRunFactory: () => void
}

const STEP_LABELS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '📝', label: 'ストーリー生成中...' },
  2: { emoji: '🎨', label: 'AI画像生成中...' },
  3: { emoji: '🧠', label: 'バリアント生成中...' },
  4: { emoji: '⭐', label: 'スコアリング中...' },
  5: { emoji: '🎯', label: 'トップバリアント選定中...' },
  6: { emoji: '✍️', label: 'バリアントリライト中...' },
  7: { emoji: '🎬', label: 'キュー投入中...' },
}

const STEP_LIST = [
  { num: 1, label: 'ストーリー生成' },
  { num: 2, label: 'AI画像生成' },
  { num: 3, label: 'バリアント生成' },
  { num: 4, label: 'スコアリング' },
  { num: 5, label: 'トップ3選定' },
  { num: 6, label: 'バリアントリライト' },
  { num: 7, label: 'キュー投入' },
]

const isUploadStep = (step: string) => step.includes('アップロード画像反映')

export function FactoryRunSection({
  factoryRunning,
  factoryStep,
  factoryStepNum,
  factoryProgress,
  factoryCurrentImageIndex,
  factoryTotalImageCount,
  factoryError,
  factoryLog,
  factoryNotice,
  factoryWarning,
  isPipelineDisabled,
  hasTheme,
  onRunFactory,
}: FactoryRunSectionProps) {
  const remainingSec = (factoryCurrentImageIndex != null && factoryTotalImageCount != null)
    ? (factoryTotalImageCount - factoryCurrentImageIndex) * 50
    : null

  const remainingMin = remainingSec != null ? Math.ceil(remainingSec / 60) : null

  const currentStepInfo = STEP_LABELS[factoryStepNum]
  const uploadMode = isUploadStep(factoryStep)

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

          {/* Big status message */}
          {currentStepInfo && (
            <div className="factory-status-hero">
              <span className="factory-status-hero-emoji">
                {uploadMode ? '⚡' : currentStepInfo.emoji}
              </span>
              <span className="factory-status-hero-label">
                {uploadMode ? 'アップロード画像反映中...' : currentStepInfo.label}
              </span>
            </div>
          )}

          {/* Image progress (AI mode only) */}
          {factoryStepNum === 2 && !uploadMode && factoryCurrentImageIndex != null && factoryTotalImageCount != null && (
            <div className="factory-image-progress">
              <p className="factory-image-progress-count">
                現在 <strong>{factoryCurrentImageIndex}</strong> / {factoryTotalImageCount} 枚目を生成しています
              </p>
              {remainingMin != null && remainingMin > 0 && (
                <p className="factory-image-progress-remaining">
                  残り時間の目安：約 {remainingMin} 分
                </p>
              )}
              {remainingMin === 0 && (
                <p className="factory-image-progress-remaining">
                  まもなく完了します
                </p>
              )}
            </div>
          )}

          {/* Upload mode message */}
          {uploadMode && (
            <p className="factory-upload-mode-note">⚡ AI画像生成をスキップ — アップロード画像を利用しています</p>
          )}

          {/* Weighted progress bar */}
          <div className="factory-progress-bar-wrap">
            <div
              className="factory-progress-bar-fill"
              style={{ width: `${factoryProgress}%` }}
            />
          </div>
          <p className="factory-progress-pct">{factoryProgress}%</p>

          {/* Step list */}
          <div className="factory-steps">
            {STEP_LIST.map(({ num, label }) => (
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
          <p className="factory-card-title">✅ 動画生成完了</p>
          <p className="factory-complete-sub">MP4の準備ができました</p>
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
