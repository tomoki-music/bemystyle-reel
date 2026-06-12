import type { ReactNode } from 'react'

type RenderCompletePanelProps = {
  variant: 'priority' | 'standard'
  preview: RenderCompletePreviewProps
  actions: RenderCompleteActionsProps
  posting?: RenderCompletePostingProps
  reuse?: RenderCompleteReuseProps
  display?: RenderCompleteDisplayProps
}

type RenderCompletePreviewProps = {
  renderPreviewUrl: string
  latestViewUrl: string
  videoPreviewLoading: boolean
  videoPreviewError: string
  onRetryVideoPreview: (viewUrl: string) => void
  onVideoPreviewReady: () => void
  onVideoPreviewError: () => void
}

type RenderCompleteActionsProps = {
  onDownloadVideo: () => void
  onCopyRenderUrl?: () => void
  onScrollToHistory?: () => void
  onRerender?: () => void
}

type RenderCompletePostingProps = {
  isGeneratingSnsCaption?: boolean
  snsCaptionError?: string
  copiedAllCaption?: boolean
  hasSnsCaption?: boolean
  onGenerateSnsCaption?: () => void
  onCopyPostCaption?: () => void
  onGoToManageTab?: () => void
  postChecklistContent?: ReactNode
}

type RenderCompleteReuseProps = {
  reuseImageMode?: boolean
  cachedImagesCount?: number
  showReuseDiscoveryBanner?: boolean
  onDismissReuseHint?: () => void
}

type RenderCompleteDisplayProps = {
  showCreateTab?: boolean
  showPostTab?: boolean
  slideCount?: number
  copiedUrl?: boolean
  showDetailedFeatures?: boolean
  onShowDetails?: () => void
  detailsChildren?: ReactNode
}

function VideoPreview({
  className,
  renderPreviewUrl,
  videoPreviewLoading,
  videoPreviewError,
  muted,
  onRetryVideoPreview,
  onVideoPreviewReady,
  onVideoPreviewError,
}: {
  className: string
  renderPreviewUrl: string
  videoPreviewLoading: boolean
  videoPreviewError: string
  muted?: boolean
  onRetryVideoPreview: (viewUrl: string) => void
  onVideoPreviewReady: () => void
  onVideoPreviewError: () => void
}) {
  if (!renderPreviewUrl) {
    return (
      <p className="render-preview-missing">
        動画生成は完了しましたが、プレビューURLが見つかりません。
        「動画を開く」または「ダウンロード」から確認してください。
      </p>
    )
  }

  if (videoPreviewLoading) {
    return (
      <div className="video-preview-loading">
        <p className="video-preview-loading-icon">🎬</p>
        <p className="video-preview-loading-title">動画を準備しています</p>
        <p className="video-preview-loading-sub">プレビュー生成中...</p>
        <div className="video-preview-loading-bar">
          <div className="video-preview-loading-bar-fill" />
        </div>
      </div>
    )
  }

  if (videoPreviewError) {
    return (
      <div className="video-preview-error">
        <p className="video-preview-error-msg">⚠ {videoPreviewError}</p>
        <button
          className="btn-video-retry"
          onClick={() => onRetryVideoPreview(renderPreviewUrl)}
        >
          ↻ プレビュー再取得
        </button>
      </div>
    )
  }

  return (
    <video
      className={className}
      src={renderPreviewUrl}
      controls
      muted={muted}
      playsInline
      onLoadedData={onVideoPreviewReady}
      onCanPlay={onVideoPreviewReady}
      onError={onVideoPreviewError}
    />
  )
}

function SnsPostActions({
  copiedAllCaption,
  hasSnsCaption,
  compact,
  onCopyPostCaption,
}: {
  copiedAllCaption?: boolean
  hasSnsCaption?: boolean
  compact?: boolean
  onCopyPostCaption?: () => void
}) {
  if (compact) {
    return (
      <div className="render-complete-actions render-complete-actions--priority">
        <button
          className="btn-sns-post btn-sns-post--instagram"
          onClick={() => window.open('https://www.instagram.com/', '_blank')}
        >
          Instagramに投稿
        </button>
        <button
          className="btn-sns-post btn-sns-post--tiktok"
          onClick={() => window.open('https://www.tiktok.com/upload', '_blank')}
        >
          TikTokに投稿
        </button>
        <button
          className="btn-sns-post btn-sns-post--youtube"
          onClick={() => window.open('https://studio.youtube.com', '_blank')}
        >
          YouTube Shortsに投稿
        </button>
      </div>
    )
  }

  return (
    <div className="sns-post-actions">
      <p className="sns-post-actions-title">SNSへ投稿</p>
      <button
        className="btn-sns-post btn-sns-post--instagram"
        onClick={() => window.open('https://www.instagram.com/', '_blank')}
      >
        <span className="btn-sns-post-icon">📱</span>
        <span className="btn-sns-post-body">
          <span className="btn-sns-post-label">Instagramに投稿</span>
          <span className="btn-sns-post-hint">動画を保存してInstagramアプリへ投稿してください</span>
        </span>
      </button>
      <button
        className="btn-sns-post btn-sns-post--tiktok"
        onClick={() => window.open('https://www.tiktok.com/upload', '_blank')}
      >
        <span className="btn-sns-post-icon">🎵</span>
        <span className="btn-sns-post-label">TikTokに投稿</span>
      </button>
      <button
        className="btn-sns-post btn-sns-post--youtube"
        onClick={() => window.open('https://studio.youtube.com', '_blank')}
      >
        <span className="btn-sns-post-icon">▶</span>
        <span className="btn-sns-post-label">YouTube Shortsに投稿</span>
      </button>
      <button
        className="btn-sns-post btn-sns-post--x"
        onClick={onCopyPostCaption}
        disabled={!hasSnsCaption}
      >
        <span className="btn-sns-post-icon">𝕏</span>
        <span className="btn-sns-post-label">投稿文をコピー</span>
      </button>
      {copiedAllCaption && (
        <p className="sns-copy-toast">投稿文をコピーしました</p>
      )}
    </div>
  )
}

function RenderNextActions() {
  return (
    <div className="render-next-actions">
      <p className="render-next-actions-title">完成後の流れ</p>
      <ol>
        <li><strong>動画を確認</strong><span>問題なければMP4をダウンロード。直したい場合は編集・再レンダリングへ。</span></li>
        <li><strong>投稿文を作成</strong><span>投稿タブでSNS投稿文を生成し、必要なら編集します。</span></li>
        <li><strong>SNSへ投稿</strong><span>YouTube / Instagram / TikTok / X に動画と投稿文を貼り付けます。</span></li>
        <li><strong>投稿記録を残す</strong><span>投稿後に投稿日・投稿先・URL・メモを管理タブへ保存します。</span></li>
      </ol>
    </div>
  )
}

export function RenderCompletePanel({
  variant,
  preview,
  actions,
  posting = {},
  reuse = {},
  display = {},
}: RenderCompletePanelProps) {
  const {
    renderPreviewUrl,
    latestViewUrl,
    videoPreviewLoading,
    videoPreviewError,
    onRetryVideoPreview,
    onVideoPreviewReady,
    onVideoPreviewError,
  } = preview
  const {
    onDownloadVideo,
    onCopyRenderUrl,
    onScrollToHistory,
    onRerender,
  } = actions
  const {
    isGeneratingSnsCaption = false,
    snsCaptionError = '',
    copiedAllCaption = false,
    hasSnsCaption = false,
    onGenerateSnsCaption,
    onCopyPostCaption,
    onGoToManageTab,
    postChecklistContent,
  } = posting
  const {
    reuseImageMode = false,
    cachedImagesCount = 0,
    showReuseDiscoveryBanner = false,
    onDismissReuseHint,
  } = reuse
  const {
    showCreateTab = false,
    showPostTab = false,
    slideCount = 0,
    copiedUrl = false,
    showDetailedFeatures = false,
    onShowDetails,
    detailsChildren,
  } = display
  if (variant === 'priority') {
    return (
      <div className="render-complete-priority">
        <p className="render-complete-priority-title">🎉 動画が完成しました</p>
        {reuseImageMode && (
          <p className="reuse-image-complete-note">⚡ 画像再利用で作成しました</p>
        )}
        <VideoPreview
          className="render-complete-video render-complete-video--priority"
          renderPreviewUrl={renderPreviewUrl}
          videoPreviewLoading={videoPreviewLoading}
          videoPreviewError={videoPreviewError}
          onRetryVideoPreview={onRetryVideoPreview}
          onVideoPreviewReady={onVideoPreviewReady}
          onVideoPreviewError={onVideoPreviewError}
        />
        <p className="render-complete-first-subtitle">MP4ファイルをダウンロードできます</p>
        <div className="render-complete-cta-row">
          <button className="btn-download-mp4 btn-download-mp4--large" onClick={onDownloadVideo}>
            ⬇ MP4ダウンロード
          </button>
          <a
            className="btn-open-video btn-open-video--large"
            href={latestViewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            🔗 新しいタブで開く
          </a>
        </div>
        <RenderNextActions />
        {showReuseDiscoveryBanner && (
          <div className="reuse-discovery-banner">
            <button className="reuse-discovery-banner-close" onClick={onDismissReuseHint} aria-label="閉じる">×</button>
            <p className="reuse-discovery-banner-title">⚡ 次回はもっと早く作れます</p>
            <p className="reuse-discovery-banner-body">
              今回生成した画像は保存されました（{cachedImagesCount}枚）。<br />
              次回から「前回の画像を使う」を選択すると、約4〜6分短縮できます。
            </p>
            <button className="reuse-discovery-banner-ok" onClick={onDismissReuseHint}>わかった</button>
          </div>
        )}
        {!showDetailedFeatures && (
          <button
            className="btn-show-details"
            onClick={onShowDetails}
          >
            詳細機能を表示
          </button>
        )}
        {showDetailedFeatures && (
          <>
            <SnsPostActions compact />
            {detailsChildren}
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {showCreateTab && (
        <>
          <div className="render-complete-card-header">
            🎬 完成動画ができました！
          </div>
          <VideoPreview
            className="render-complete-video"
            renderPreviewUrl={renderPreviewUrl}
            videoPreviewLoading={videoPreviewLoading}
            videoPreviewError={videoPreviewError}
            muted
            onRetryVideoPreview={onRetryVideoPreview}
            onVideoPreviewReady={onVideoPreviewReady}
            onVideoPreviewError={onVideoPreviewError}
          />
          <div className="render-complete-cta-row">
            <button className="btn-download-mp4 btn-download-mp4--large" onClick={onDownloadVideo}>
              ⬇ MP4ダウンロード
            </button>
            <a
              className="btn-open-video btn-open-video--large"
              href={latestViewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              🔗 新しいタブで開く
            </a>
          </div>
          <ul className="render-complete-specs">
            <li>1080 × 1920 縦型動画</li>
            <li>YouTube Shorts / Instagram Reels 対応</li>
            <li>{slideCount} 枚スライド構成</li>
          </ul>
          <RenderNextActions />
          <div className="render-complete-actions">
            <button className="btn-download-mp4" onClick={onDownloadVideo}>
              ↓ 動画をダウンロード
            </button>
            <a
              className="btn-open-video"
              href={latestViewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              ↗ 動画を開く
            </a>
          </div>
          <div className="render-complete-sub-actions">
            <button className="btn-copy-url" onClick={onCopyRenderUrl}>
              {copiedUrl ? '✓ コピー済み' : 'URLをコピー'}
            </button>
            <button className="btn-scroll-history" onClick={onScrollToHistory}>
              履歴を見る
            </button>
            <button className="btn-rerender btn-rerender--inline" onClick={onRerender}>
              再レンダリング
            </button>
          </div>
        </>
      )}
      {showPostTab && (
        <>
          <div className="posting-flow-hint">
            <p className="posting-flow-hint-title">投稿タブでやること</p>
            <p>まず「SNS投稿文を作成」を押し、投稿先に合わせてコピーしてSNSへ貼り付けます。投稿できたら最後に管理タブへ記録を残しましょう。</p>
            {onGoToManageTab && (
              <button
                className="btn-go-manage-tab"
                onClick={onGoToManageTab}
                type="button"
              >
                投稿後はこちら：管理タブへ
              </button>
            )}
          </div>
          <SnsPostActions
            copiedAllCaption={copiedAllCaption}
            hasSnsCaption={hasSnsCaption}
            onCopyPostCaption={onCopyPostCaption}
          />
          {postChecklistContent}
          <button
            className="btn-sns-caption"
            onClick={onGenerateSnsCaption}
            disabled={isGeneratingSnsCaption}
          >
            {isGeneratingSnsCaption ? '⏳ 生成中...' : 'SNS投稿文を作成'}
          </button>
          {snsCaptionError && (
            <p className="sns-caption-error">{snsCaptionError}</p>
          )}
        </>
      )}
    </>
  )
}
