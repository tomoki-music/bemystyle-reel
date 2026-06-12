type GeneratedAsset = {
  filename: string
  path: string
  size: number
}

type AssetsPanelProps = {
  assets: GeneratedAsset[]
  assetsLoading: boolean
  assetsMessage: string
  usedGeneratedImages: Set<string>
  onRefreshAssets: () => void
  onDeleteAsset: (filename: string) => void
  onDeleteUnusedAssets: (usedSet: Set<string>) => void
}

export function AssetsPanel({
  assets,
  assetsLoading,
  assetsMessage,
  usedGeneratedImages,
  onRefreshAssets,
  onDeleteAsset,
  onDeleteUnusedAssets,
}: AssetsPanelProps) {
  return (
    <div className="assets-section">
      <div className="assets-header-row">
        <p className="assets-label">生成済み素材</p>
        <div className="assets-header-actions">
          <button
            className="assets-refresh-btn"
            onClick={onRefreshAssets}
            disabled={assetsLoading}
            title="更新"
          >
            {assetsLoading ? '...' : '↻'}
          </button>
          <button
            className="assets-bulk-delete-btn"
            onClick={() => onDeleteUnusedAssets(usedGeneratedImages)}
            disabled={assetsLoading || assets.length === 0}
          >
            未使用画像を一括削除
          </button>
        </div>
      </div>
      {assetsMessage && (
        <p className={`assets-message${assetsMessage.includes('失敗') ? ' assets-message--error' : ' assets-message--ok'}`}>
          {assetsMessage}
        </p>
      )}
      {assets.length === 0 ? (
        <p className="assets-empty">生成済み画像はありません</p>
      ) : (
        <ul className="assets-list">
          {assets.map((asset) => {
            const isUsed = usedGeneratedImages.has(asset.path)
            return (
              <li key={asset.filename} className="assets-item">
                <div className="assets-item-info">
                  <span className="assets-item-name" title={asset.filename}>{asset.filename}</span>
                  <span className="assets-item-size">{(asset.size / 1024).toFixed(0)}KB</span>
                  {isUsed
                    ? <span className="assets-item-badge assets-item-badge--used">使用中</span>
                    : <span className="assets-item-badge assets-item-badge--unused">未使用</span>
                  }
                </div>
                <button
                  className="assets-delete-btn"
                  onClick={() => onDeleteAsset(asset.filename)}
                  disabled={isUsed}
                  title={isUsed ? '使用中のため削除できません' : '削除'}
                >
                  削除
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
