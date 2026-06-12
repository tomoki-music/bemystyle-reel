import React from 'react'
import { FactoryThemeInput } from './FactoryThemeInput'
import {
  MassThemeItem,
  MassQueueSummary,
  MassPipelineMode,
  MassTemplateType,
  MassPostChecklist,
  MASS_MODE_TEMPLATES,
  getMassItemProgress,
  getMassNextAction,
} from './massModeTypes'

interface MassModePanelProps {
  massThemes: MassThemeItem[]
  massQueueRunning: boolean
  massQueueSummary: MassQueueSummary | null
  massPipelineMode: MassPipelineMode
  massRegeneratingId: string | null
  massImageGeneratingId: string | null
  massInputType: MassTemplateType
  massInputTheme: string
  massStoryPreviewId: string | null
  massCopiedId: string | null
  massCollapseDone: boolean

  onExitMassMode: () => void
  onAddTheme: () => void
  onDeleteTheme: (id: string) => void
  onClearThemes: () => void
  onClearCompletedThemes: () => void
  onStartQueue: () => void
  onStopQueue: () => void
  onReGenerateItem: (id: string) => void
  onGenerateImages: (id: string) => void
  onAddItemToQueue: (id: string) => void
  onTogglePostChecklist: (id: string, key: keyof MassPostChecklist) => void
  onUpdatePostCaption: (id: string, caption: string) => void
  onGenerateCaptionForItem: (id: string) => void
  onCopyCaption: (id: string, caption: string) => void
  onInputTypeChange: (type: MassTemplateType) => void
  onInputValueChange: (value: string) => void
  onStoryPreviewToggle: (id: string) => void
  onCollapseDoneToggle: () => void
  onPipelineModeChange: (mode: MassPipelineMode) => void
}

export function MassModePanel(props: MassModePanelProps) {
  const {
    massThemes,
    massQueueRunning,
    massQueueSummary,
    massPipelineMode,
    massRegeneratingId,
    massImageGeneratingId,
    massInputType,
    massInputTheme,
    massStoryPreviewId,
    massCopiedId,
    massCollapseDone,
    onExitMassMode,
    onAddTheme,
    onDeleteTheme,
    onClearThemes,
    onClearCompletedThemes,
    onStartQueue,
    onStopQueue,
    onReGenerateItem,
    onGenerateImages,
    onAddItemToQueue,
    onTogglePostChecklist,
    onUpdatePostCaption,
    onGenerateCaptionForItem,
    onCopyCaption,
    onInputTypeChange,
    onInputValueChange,
    onStoryPreviewToggle,
    onCollapseDoneToggle,
    onPipelineModeChange,
  } = props

  const massPendingCount = massThemes.filter(i => i.status === 'pending').length
  const massCompletedCount = massThemes.filter(i => i.status === 'completed').length
  const massRunningItem = massThemes.find(i => i.status === 'running')
  const massSummaryInProgress = massThemes.filter(i => !i.renderQueued && !i.postChecklist?.posted).length
  const massSummaryPostPreparing = massThemes.filter(i => i.renderQueued && !i.postChecklist?.posted).length
  const massSummaryDone = massThemes.filter(i => i.postChecklist?.posted === true).length
  const massActiveItems = massThemes.filter(i => !i.postChecklist?.posted)
  const massDoneItems = massThemes.filter(i => i.postChecklist?.posted === true)

  return (
    <div className="simple-step-card mass-mode-panel">
      <div className="mass-mode-header">
        <p className="mass-mode-title">🏭 量産モード</p>
        <button
          className="btn-mass-mode-exit"
          onClick={onExitMassMode}
          disabled={massQueueRunning}
          type="button"
        >
          ← 通常モードに戻る
        </button>
      </div>
      <p className="mass-mode-desc">複数テーマをまとめて入力できます。週末にまとめて作るときに便利です。</p>

      {/* Phase22-K: 全体サマリー */}
      {massThemes.length > 0 && (
        <div className="mass-overall-summary">
          <div className="mass-summary-stat">
            <span className="mass-summary-num">{massSummaryInProgress}</span>
            <span className="mass-summary-label">作成中</span>
          </div>
          <div className="mass-summary-stat">
            <span className="mass-summary-num">{massSummaryPostPreparing}</span>
            <span className="mass-summary-label">投稿準備中</span>
          </div>
          <div className="mass-summary-stat mass-summary-stat--done">
            <span className="mass-summary-num">{massSummaryDone}</span>
            <span className="mass-summary-label">完了</span>
          </div>
        </div>
      )}

      {/* テーマ追加エリア (Phase22-M: FactoryThemeInput へ移動) */}
      <FactoryThemeInput
        heading="作りたい動画のテーマを追加"
        example="例：6月のMMMセッション会を紹介"
        templates={MASS_MODE_TEMPLATES}
        inputType={massInputType}
        onInputTypeChange={(t) => onInputTypeChange(t as MassTemplateType)}
        inputValue={massInputTheme}
        onInputValueChange={onInputValueChange}
        onAdd={onAddTheme}
        isDisabled={massQueueRunning}
        placeholder="テーマを入力（例：6月27日の大演奏会告知）"
      />

      {/* テーマ一覧 */}
      {massThemes.length > 0 ? (
        <div className="mass-mode-list">
          <div className="mass-mode-list-header">
            <p className="mass-mode-list-title">{massThemes.length}件</p>
            <div className="mass-mode-list-header-actions">
              {massCompletedCount > 0 && (
                <button
                  className="btn-mass-clear-completed"
                  onClick={onClearCompletedThemes}
                  disabled={massQueueRunning}
                  type="button"
                >
                  完了済みを削除
                </button>
              )}
              <button
                className="btn-mass-mode-clear"
                onClick={onClearThemes}
                disabled={massQueueRunning}
                type="button"
              >
                全件クリア
              </button>
            </div>
          </div>
          {massActiveItems.map((item, i) => {
            const _prog = getMassItemProgress(item)
            const _nextAction = getMassNextAction(item)
            return (
              <div key={item.id} className="mass-mode-item-wrapper">
                {/* Phase22-K: ステップバー */}
                <div className="mass-step-bar">
                  <div className="mass-step-bar-steps">
                    {([
                      { n: 1, label: 'Story' },
                      { n: 2, label: '画像' },
                      { n: 3, label: '動画' },
                      { n: 4, label: '投稿' },
                    ]).map(({ n, label }) => (
                      <div key={n} className={`mass-step${n <= _prog.completedSteps ? ' mass-step--done' : n === _prog.completedSteps + 1 ? ' mass-step--active' : ''}`}>
                        <span className="mass-step-circle">{n <= _prog.completedSteps ? '✓' : n}</span>
                        <span className="mass-step-label">{label}</span>
                      </div>
                    ))}
                  </div>
                  <span className={`mass-step-percent${_prog.percent === 100 ? ' mass-step-percent--done' : ''}`}>進捗 {_prog.percent}%</span>
                </div>
                <div className={`mass-mode-list-item mass-mode-list-item--${item.status}`}>
                  <span className="mass-mode-list-num">{i + 1}</span>
                  <span className="mass-mode-list-type">
                    {MASS_MODE_TEMPLATES.find((t) => t.type === item.templateType)?.label}
                  </span>
                  <div className="mass-mode-list-theme-cell">
                    <span className="mass-mode-list-theme">{item.theme}</span>
                    {item.resultMessage && (
                      <span className="mass-mode-list-result">{item.resultMessage}</span>
                    )}
                  </div>
                  <span className={`mass-mode-status-badge mass-mode-status-badge--${item.status}`}>
                    {item.status === 'pending' && '待機'}
                    {item.status === 'running' && '処理中'}
                    {item.status === 'completed' && '完了'}
                    {item.status === 'failed' && '失敗'}
                  </span>
                  {item.status === 'completed' && (
                    <div className="mass-mode-item-actions">
                      {item.storyResult && (
                        <button
                          className="btn-mass-story-preview"
                          onClick={() => onStoryPreviewToggle(item.id)}
                          type="button"
                        >
                          {massStoryPreviewId === item.id ? '閉じる' : 'Storyを見る'}
                        </button>
                      )}
                      {item.storyResult && (
                        <button
                          className={`btn-mass-generate-images${item.imageStatus === 'completed' ? ' has-images' : ''}`}
                          onClick={() => onGenerateImages(item.id)}
                          disabled={massQueueRunning || massRegeneratingId !== null || massImageGeneratingId !== null}
                          type="button"
                        >
                          {item.imageStatus === 'running' ? '画像生成中...' : item.imageStatus === 'completed' ? '画像再生成' : '画像生成'}
                        </button>
                      )}
                      {/* Phase22-H: Render Queue投入ボタン */}
                      {item.storyResult && item.imageStatus === 'completed' && item.imageUrls && item.imageUrls.length > 0 && (
                        <button
                          className={`btn-mass-queue-add${item.renderQueued ? ' queued' : ''}`}
                          onClick={() => { if (!item.renderQueued) onAddItemToQueue(item.id) }}
                          disabled={item.renderQueued}
                          type="button"
                        >
                          {item.renderQueued ? '✓ 追加済み' : '動画キューに追加'}
                        </button>
                      )}
                      <button
                        className="btn-mass-regenerate"
                        onClick={() => onReGenerateItem(item.id)}
                        disabled={massQueueRunning || massRegeneratingId !== null || massImageGeneratingId !== null}
                        type="button"
                      >
                        再生成
                      </button>
                    </div>
                  )}
                  {/* Phase22-H: Queue投入エラー表示 */}
                  {item.renderQueueError && (
                    <span className="mass-queue-item-error">{item.renderQueueError}</span>
                  )}
                  <button
                    className="btn-mass-mode-delete"
                    onClick={() => onDeleteTheme(item.id)}
                    disabled={massQueueRunning || massRegeneratingId === item.id || massImageGeneratingId === item.id}
                    type="button"
                    aria-label="削除"
                  >
                    ×
                  </button>
                </div>
                {massStoryPreviewId === item.id && item.storyResult && (
                  <div className="mass-story-preview">
                    <div className="mass-story-preview-header">
                      <span className="mass-story-preview-title">{item.storyResult.variables.title}</span>
                      {item.storyResult.variables.subtitle && (
                        <span className="mass-story-preview-subtitle">{item.storyResult.variables.subtitle}</span>
                      )}
                    </div>
                    <ol className="mass-story-slide-list">
                      {item.storyResult.slides.map((slide, idx) => (
                        <li key={idx} className="mass-story-slide-item">
                          <span className="mass-story-slide-num">{idx + 1}</span>
                          <div className="mass-story-slide-body">
                            <span className="mass-story-slide-headline">{slide.headline}</span>
                            {slide.subline && <span className="mass-story-slide-subline">{slide.subline}</span>}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="mass-story-preview-cta">CTA：{item.storyResult.variables.cta}</div>
                  </div>
                )}
                {/* Phase22-G: 画像サムネイル（storyプレビューとは独立して常時表示） */}
                {item.imageStatus === 'running' && (
                  <div className="mass-image-section mass-image-section--running">
                    <span className="mass-image-generating-label">画像生成中...</span>
                  </div>
                )}
                {item.imageStatus === 'completed' && item.imageUrls && item.imageUrls.length > 0 && (
                  <div className="mass-image-section">
                    <div className="mass-image-thumbnails">
                      {item.imageUrls.slice(0, 5).map((url, idx) => (
                        <img
                          key={idx}
                          src={url.startsWith('generated/') ? `/assets/${url}` : url}
                          alt={`画像${idx + 1}`}
                          className="mass-image-thumb"
                        />
                      ))}
                    </div>
                    {item.imageUrls.length > 5 && (
                      <span className="mass-image-more">+{item.imageUrls.length - 5}枚</span>
                    )}
                    {item.imageError && <p className="mass-image-partial-error">{item.imageError}</p>}
                  </div>
                )}
                {item.imageStatus === 'failed' && (
                  <div className="mass-image-section mass-image-section--failed">
                    <span className="mass-image-error">{item.imageError ?? '画像生成に失敗しました'}</span>
                  </div>
                )}
                {/* Phase22-J: 投稿準備パネル */}
                {item.renderQueued && (
                  <div className="mass-post-panel">
                    <div className="mass-post-panel-header">
                      <span className="mass-post-panel-title">投稿準備</span>
                    </div>
                    <ul className="mass-post-status-list">
                      <li className="mass-post-status-item mass-post-status-item--done">✓ 動画キュー追加済み</li>
                      <li className="mass-post-status-item">MP4完成後にダウンロード</li>
                      <li className="mass-post-status-item">キャプション作成</li>
                      <li className="mass-post-status-item">投稿チェック</li>
                    </ul>
                    <div className="mass-post-checklist">
                      {([
                        { key: 'mp4Checked' as const, label: 'MP4を確認した' },
                        { key: 'captionReady' as const, label: 'キャプションを用意した' },
                        { key: 'platformDecided' as const, label: '投稿先を決めた' },
                        { key: 'posted' as const, label: '投稿した' },
                      ]).map(({ key, label }) => (
                        <label key={key} className="mass-post-checklist-item">
                          <input
                            type="checkbox"
                            className="mass-post-checklist-checkbox"
                            checked={item.postChecklist?.[key] ?? false}
                            onChange={() => onTogglePostChecklist(item.id, key)}
                          />
                          <span className={item.postChecklist?.[key] ? 'mass-post-checklist-label--checked' : ''}>{label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mass-post-caption-section">
                      <div className="mass-post-caption-header">
                        <span className="mass-post-caption-label">キャプション</span>
                        <button
                          className="btn-mass-generate-caption"
                          onClick={() => onGenerateCaptionForItem(item.id)}
                          type="button"
                        >
                          キャプション生成
                        </button>
                      </div>
                      <textarea
                        className="mass-post-caption-textarea"
                        value={item.postCaption ?? ''}
                        onChange={(e) => onUpdatePostCaption(item.id, e.target.value)}
                        placeholder="キャプション生成ボタンで自動作成、または直接入力できます"
                        rows={5}
                      />
                      {item.postCaption && (
                        <div className="mass-post-caption-footer">
                          <button
                            className="btn-mass-copy-caption"
                            onClick={() => onCopyCaption(item.id, item.postCaption!)}
                            type="button"
                          >
                            コピー
                          </button>
                          {massCopiedId === item.id && (
                            <span className="mass-post-copied-msg">コピーしました</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Phase22-K: 次にやること */}
                {item.status === 'completed' && (
                  <div className={`mass-next-action${_nextAction.includes('🎉') ? ' mass-next-action--done' : ''}`}>
                    <span className="mass-next-action-lead">👉 次にやること</span>
                    <span className="mass-next-action-text">{_nextAction}</span>
                  </div>
                )}
              </div>
            )
          })}
          {/* Phase22-K: 完了済みアイテム折りたたみ */}
          {massDoneItems.length > 0 && (
            <div className="mass-done-section">
              <button
                className="btn-mass-done-toggle"
                onClick={onCollapseDoneToggle}
                type="button"
              >
                {massCollapseDone ? '▶' : '▼'} 完了済み（{massDoneItems.length}件）
              </button>
              {!massCollapseDone && massDoneItems.map((doneItem) => (
                <div key={doneItem.id} className="mass-done-item-row">
                  <span className="mass-done-item-check">✓</span>
                  <span className="mass-done-item-theme">{doneItem.theme}</span>
                  <button
                    className="btn-mass-mode-delete"
                    onClick={() => onDeleteTheme(doneItem.id)}
                    disabled={massQueueRunning}
                    type="button"
                    aria-label="削除"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mass-mode-empty">テーマを追加してください</p>
      )}

      {/* Phase22-C/I: キュー実行コントロール */}
      {massThemes.length > 0 && (
        <div className="mass-queue-control">
          {massQueueRunning ? (
            <>
              <div className="mass-queue-progress">
                <span className="mass-queue-progress-text">
                  {massRunningItem
                    ? `${massRunningItem.resultMessage ?? '処理中'}：${massRunningItem.theme}`
                    : '準備中...'}
                </span>
                <span className="mass-queue-progress-count">
                  {massCompletedCount} / {massThemes.length} 件完了
                </span>
              </div>
              <button
                className="btn-mass-queue-stop"
                onClick={onStopQueue}
                type="button"
              >
                ■ 停止
              </button>
            </>
          ) : (
            <div className="mass-pipeline-control">
              {/* Phase22-I: パイプラインモードセレクタ */}
              <div className="mass-pipeline-mode-row">
                <span className="mass-pipeline-mode-label">どこまで自動処理する？</span>
                <div className="mass-pipeline-mode-btns">
                  {([
                    { mode: 'story-only' as const, label: 'Storyのみ' },
                    { mode: 'story-image' as const, label: 'Story + 画像' },
                    { mode: 'story-image-queue' as const, label: 'Story + 画像 + キュー投入' },
                  ]).map(({ mode, label }) => (
                    <button
                      key={mode}
                      className={`mass-pipeline-mode-btn${massPipelineMode === mode ? ' active' : ''}`}
                      onClick={() => onPipelineModeChange(mode)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="btn-mass-queue-start"
                onClick={onStartQueue}
                disabled={massPendingCount === 0}
                type="button"
              >
                ▶ まとめて作成（{massPendingCount}件）
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase22-D: キュー完了サマリー */}
      {!massQueueRunning && massQueueSummary && (
        <div className={`mass-queue-summary mass-queue-summary--${massQueueSummary.stopped ? 'stopped' : massQueueSummary.failed > 0 ? 'partial' : 'done'}`}>
          <p className="mass-queue-summary-title">
            {massQueueSummary.stopped ? '⏸ 停止しました' : massQueueSummary.failed > 0 ? '⚠ 処理完了（一部失敗）' : '✅ すべて完了しました'}
          </p>
          <div className="mass-queue-summary-stats">
            <span>全 {massQueueSummary.total} 件</span>
            <span className="mass-queue-summary-stat--completed">完了 {massQueueSummary.completed} 件</span>
            {massQueueSummary.failed > 0 && <span className="mass-queue-summary-stat--failed">失敗 {massQueueSummary.failed} 件</span>}
            {massQueueSummary.stopped && <span className="mass-queue-summary-stat--stopped">中断あり</span>}
          </div>
        </div>
      )}
    </div>
  )
}
