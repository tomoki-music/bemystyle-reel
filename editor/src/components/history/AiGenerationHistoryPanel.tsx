import type React from 'react'
import type { AIGenerationHistory } from '../story/useStoryGenerator'

type AiHistoryPresetOption = {
  key: string
  label: string
}

type AiGenerationHistoryPanelProps = {
  aiGenerationHistory: AIGenerationHistory[]
  aiPresets: AiHistoryPresetOption[]
  importNotice: string
  importInputRef: React.RefObject<HTMLInputElement>
  isGenerating: boolean
  formatHistoryDate: (iso: string) => string
  onExportAIGenerationHistory: () => void
  onImportAIGenerationHistory: React.ChangeEventHandler<HTMLInputElement>
  onClearAIGenerationHistory: () => void
  onReuseHistory: (history: AIGenerationHistory) => void
  onDeleteAIGenerationHistoryItem: (id: string) => void
}

// AI生成テーマ / Story / 画像などの履歴。動画レンダリング履歴は GenerationHistoryPanel が担当します。
export function AiGenerationHistoryPanel({
  aiGenerationHistory,
  aiPresets,
  importNotice,
  importInputRef,
  isGenerating,
  formatHistoryDate,
  onExportAIGenerationHistory,
  onImportAIGenerationHistory,
  onClearAIGenerationHistory,
  onReuseHistory,
  onDeleteAIGenerationHistoryItem,
}: AiGenerationHistoryPanelProps) {
  if (aiGenerationHistory.length === 0) return null

  return (
    <div className="ai-gen-history">
      <div className="ai-gen-history-header">
        <p className="ai-gen-history-title">AI生成履歴</p>
        <div className="ai-gen-history-header-actions">
          <button
            className="ai-gen-history-io-btn"
            onClick={onExportAIGenerationHistory}
            title="履歴をJSONでダウンロード"
          >
            エクスポート
          </button>
          <button
            className="ai-gen-history-io-btn"
            onClick={() => importInputRef.current?.click()}
            title="JSONファイルから履歴をインポート"
          >
            インポート
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={onImportAIGenerationHistory}
          />
          <button
            className="ai-gen-history-clear-btn"
            onClick={onClearAIGenerationHistory}
          >
            全削除
          </button>
        </div>
      </div>
      {importNotice && (
        <p className={`ai-gen-history-import-notice${importNotice.includes('失敗') ? ' ai-gen-history-import-notice--error' : ' ai-gen-history-import-notice--ok'}`}>
          {importNotice}
        </p>
      )}
      <ul className="ai-gen-history-list">
        {aiGenerationHistory.map((h) => (
          <li key={h.id} className="ai-gen-history-item">
            <div className="ai-gen-history-item-main">
              <span className="ai-gen-history-theme" title={h.theme}>{h.theme}</span>
              {h.presetKey && (
                <span className="ai-gen-history-preset">
                  {aiPresets.find((p) => p.key === h.presetKey)?.label ?? h.presetKey}
                </span>
              )}
            </div>
            {h.templateName && (
              <p className="ai-gen-history-template">{h.templateName}</p>
            )}
            <div className="ai-gen-history-meta">
              <span>{formatHistoryDate(h.createdAt)}</span>
              <span>スライド{h.slideCount}枚</span>
              <span>画像{h.imageCount}枚</span>
              <span className={`ai-gen-history-render-status ai-gen-history-render-status--${h.renderStatus}`}>
                {h.renderStatus === 'none' ? '未レンダリング' : h.renderStatus === 'completed' ? '完了' : '失敗'}
              </span>
              {h.renderOutputPath && (
                <a className="ai-gen-history-render-dl" href={h.renderOutputPath} download>
                  DL
                </a>
              )}
              {h.snsCaption && (
                <span className="ai-gen-history-sns-badge">SNS文あり</span>
              )}
            </div>
            {(h.renderVariantName || h.renderedAt) && (
              <div className="ai-gen-history-variant">
                <span>バリアント: {h.renderVariantName ?? 'Default'}</span>
                {h.renderedAt && (
                  <span>生成日時: {new Date(h.renderedAt).toLocaleString()}</span>
                )}
              </div>
            )}
            {h.renderErrorMessage && (
              <p className="ai-gen-history-render-error">{h.renderErrorMessage}</p>
            )}
            <div className="ai-gen-history-actions">
              <button
                className="ai-gen-history-reuse-btn"
                onClick={() => onReuseHistory(h)}
                disabled={isGenerating}
              >
                このテーマで再生成
              </button>
              <button
                className="ai-gen-history-delete-btn"
                onClick={() => onDeleteAIGenerationHistoryItem(h.id)}
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
