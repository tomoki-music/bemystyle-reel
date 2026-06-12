import type React from 'react'
import {
  POSTED_SNS_LABELS,
  type PostedRecord,
  type PostedSns,
} from '../posting/usePostingManager'

type PostedReport = {
  total: number
  counts: Record<PostedSns, number>
  latest?: PostedRecord
  urlCount: number
}

type PostingRecordsPanelProps = {
  records: PostedRecord[]
  form: PostedRecord
  importMessage: string
  importError: string
  report: PostedReport
  onChangeForm: React.Dispatch<React.SetStateAction<PostedRecord>>
  onAddRecord: () => void
  onDeleteRecord: (index: number) => void
  onExportCsv: () => void
  onExportJson: () => void
  onImportJson: (event: React.ChangeEvent<HTMLInputElement>) => void
}

export function PostingRecordsPanel({
  records,
  form,
  importMessage,
  importError,
  report,
  onChangeForm,
  onAddRecord,
  onDeleteRecord,
  onExportCsv,
  onExportJson,
  onImportJson,
}: PostingRecordsPanelProps) {
  return (
    <div className="posted-records-panel">
      <div className="posted-records-header">
        <div className="posted-records-title-group">
          <p className="posted-records-title">投稿済み管理</p>
          <p className="posted-records-lead">
            投稿できたら最後にここへ記録します。投稿漏れの確認・複数SNSの管理・あとからの振り返りに使えます。
          </p>
        </div>
        <div className="posted-records-header-actions">
          <button
            className="btn-posted-records-export"
            onClick={onExportCsv}
            disabled={records.length === 0}
          >
            CSVエクスポート
          </button>
          <button
            className="btn-posted-records-export"
            onClick={onExportJson}
          >
            JSONバックアップ
          </button>
          <label className="btn-posted-records-export btn-posted-records-import">
            JSONインポート
            <input
              type="file"
              accept="application/json,.json"
              onChange={onImportJson}
            />
          </label>
        </div>
      </div>
      {importMessage && (
        <p className="posted-records-import-message">{importMessage}</p>
      )}
      {importError && (
        <p className="posted-records-import-error">{importError}</p>
      )}
      <div className="post-report">
        <p className="post-report-title">投稿レポート</p>
        {report.total === 0 ? (
          <p className="post-report-empty">
            まだ投稿記録はありません。投稿後に、投稿日・投稿先・URL・メモを1件残してみましょう。
          </p>
        ) : (
          <>
            <div className="post-report-grid">
              <div className="post-report-card">
                <span className="post-report-label">総投稿数</span>
                <strong className="post-report-value">{report.total}件</strong>
              </div>
              <div className="post-report-card">
                <span className="post-report-label">Instagram</span>
                <strong className="post-report-value">{report.counts.instagram}件</strong>
              </div>
              <div className="post-report-card">
                <span className="post-report-label">TikTok</span>
                <strong className="post-report-value">{report.counts.tiktok}件</strong>
              </div>
              <div className="post-report-card">
                <span className="post-report-label">YouTube</span>
                <strong className="post-report-value">{report.counts.youtube}件</strong>
              </div>
              <div className="post-report-card">
                <span className="post-report-label">X</span>
                <strong className="post-report-value">{report.counts.x}件</strong>
              </div>
              <div className="post-report-card">
                <span className="post-report-label">URL登録済み</span>
                <strong className="post-report-value">{report.urlCount}件</strong>
              </div>
            </div>
            {report.latest && (
              <p className="post-report-latest">
                最新投稿：{report.latest.postedAt} / {POSTED_SNS_LABELS[report.latest.sns]}
              </p>
            )}
          </>
        )}
      </div>

      <div className="posted-records-form">
        <p className="posted-records-form-guide">
          SNSに投稿したあと、分かる範囲で入力して「投稿記録を追加」を押してください。URLはあとから見返す控えになり、メモは反応や改善点の記録に使えます。
        </p>
        <label className="posted-records-field">
          <span>投稿先SNS</span>
          <select
            value={form.sns}
            onChange={(e) => onChangeForm((prev) => ({ ...prev, sns: e.target.value as PostedSns }))}
          >
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="x">X</option>
          </select>
        </label>
        <label className="posted-records-field">
          <span>投稿日</span>
          <input
            type="date"
            value={form.postedAt}
            onChange={(e) => onChangeForm((prev) => ({ ...prev, postedAt: e.target.value }))}
          />
        </label>
        <label className="posted-records-field posted-records-field--wide">
          <span>投稿URL</span>
          <input
            type="text"
            value={form.url}
            onChange={(e) => onChangeForm((prev) => ({ ...prev, url: e.target.value }))}
            placeholder="https://..."
          />
        </label>
        <label className="posted-records-field posted-records-field--wide">
          <span>メモ</span>
          <input
            type="text"
            value={form.memo}
            onChange={(e) => onChangeForm((prev) => ({ ...prev, memo: e.target.value }))}
            placeholder="反応や投稿時のメモ"
          />
        </label>
        <button
          className="btn-posted-record-add"
          onClick={onAddRecord}
          disabled={!form.postedAt}
        >
          投稿記録を追加
        </button>
      </div>

      {records.length > 0 && (
        <ul className="posted-records-list">
          {records.map((record, index) => (
            <li className="posted-record-item" key={`${record.sns}-${record.postedAt}-${index}`}>
              <div className="posted-record-item-main">
                <p className="posted-record-item-title">
                  {POSTED_SNS_LABELS[record.sns]} / {record.postedAt}
                </p>
                {record.url && (
                  <a
                    className="posted-record-item-url"
                    href={record.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {record.url}
                  </a>
                )}
                {record.memo && (
                  <p className="posted-record-item-memo">メモ：{record.memo}</p>
                )}
              </div>
              <button
                className="btn-posted-record-delete"
                onClick={() => onDeleteRecord(index)}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
