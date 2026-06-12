type RenderQueueTopActionsProps = {
  aiTheme: string
  renderQueueLength: number
  isPipelineDisabled: boolean
  autoGenerateNotice: string

  onAutoGenerateVariants: () => void
  onAddToQueue: () => void
}

export function RenderQueueTopActions({
  isPipelineDisabled,
  autoGenerateNotice,
  onAutoGenerateVariants,
  onAddToQueue,
}: RenderQueueTopActionsProps) {
  return (
    <>
      <div className="render-queue-top-actions">
        <button
          className="btn-auto-generate"
          onClick={onAutoGenerateVariants}
          disabled={isPipelineDisabled}
        >
          ✨ 自動生成
        </button>
        <button
          className="btn-add-queue"
          onClick={onAddToQueue}
          disabled={isPipelineDisabled}
        >
          ＋ 追加
        </button>
      </div>
      {autoGenerateNotice && (
        <p className="auto-generate-notice">{autoGenerateNotice}</p>
      )}
    </>
  )
}
