import type React from 'react'
import type { EventPostRecord, MmmEventPreset } from '../../types'
import type { EventPostFilter, EventPostRecordForm } from '../factory/useEventPosting'
import { EVENT_POST_RECORD_SNS_OPTIONS } from '../factory/useEventPosting'
import type { PostedRecord, PostedSns } from './usePostingManager'
import { PostingRecordsPanel } from '../bottom/PostingRecordsPanel'

type PostedReport = {
  total: number
  counts: Record<PostedSns, number>
  latest?: PostedRecord
  urlCount: number
}

type EventPostReport = {
  total: number
  counts: Record<EventPostRecord['sns'], number>
  urlCount: number
}

type EventDashboardStats = {
  thisMonthCount: number
  urlCount: number
  total: number
  snsCounts: Record<EventPostRecord['sns'], number>
  recentRecords: EventPostRecord[]
  unpostedPresets: MmmEventPreset[]
}

type EventPostManagementPanelEventPostingProps = {
  isVisible: boolean
  simpleTemplateId: string | null
  aiTheme: string
  mmmEventForm: {
    title: string
  }
  eventPostRecords: EventPostRecord[]
  eventPostRecordForm: EventPostRecordForm
  eventPostFilter: EventPostFilter
  eventPostReport: EventPostReport
  eventDashboardStats: EventDashboardStats
  filteredEventPostRecords: EventPostRecord[]
  isEventPostFilterActive: boolean
}

type EventPostManagementPanelPostingRecordsProps = {
  records: PostedRecord[]
  form: PostedRecord
  importMessage: string
  importError: string
  report: PostedReport
}

type EventPostManagementPanelBackupProps = {
  importMessage: string
  importError: string
  onExportJson: () => void
  onImportJson: (event: React.ChangeEvent<HTMLInputElement>) => void
}

type EventPostManagementPanelActionsProps = {
  onChangeEventPostRecordForm: React.Dispatch<React.SetStateAction<EventPostRecordForm>>
  onChangeEventPostFilter: React.Dispatch<React.SetStateAction<EventPostFilter>>
  onSaveEventPostRecord: () => void
  onDeleteEventPostRecord: (id: string) => void
  onExportEventPostRecordsCsv: () => void
  onChangePostedForm: React.Dispatch<React.SetStateAction<PostedRecord>>
  onAddPostedRecord: () => void
  onDeletePostedRecord: (index: number) => void
  onExportPostedRecordsCsv: () => void
  onExportPostedRecordsJson: () => void
  onImportPostedRecordsJson: (event: React.ChangeEvent<HTMLInputElement>) => void
}

type EventPostManagementPanelProps = {
  eventPosting: EventPostManagementPanelEventPostingProps
  postingRecords: EventPostManagementPanelPostingRecordsProps
  backup: EventPostManagementPanelBackupProps
  actions: EventPostManagementPanelActionsProps
}

export function EventPostManagementPanel({
  eventPosting,
  postingRecords,
  backup,
  actions,
}: EventPostManagementPanelProps) {
  const {
    isVisible,
    simpleTemplateId,
    aiTheme,
    mmmEventForm,
    eventPostRecords,
    eventPostRecordForm,
    eventPostFilter,
    eventPostReport,
    eventDashboardStats,
    filteredEventPostRecords,
    isEventPostFilterActive,
  } = eventPosting
  const {
    records: postedRecords,
    form: postedForm,
    importMessage: postedRecordsImportMessage,
    importError: postedRecordsImportError,
    report: postedReport,
  } = postingRecords
  const {
    importMessage: backupImportMessage,
    importError: backupImportError,
    onExportJson: onExportReelBackupJson,
    onImportJson: onImportReelBackupJson,
  } = backup
  const {
    onChangeEventPostRecordForm,
    onChangeEventPostFilter,
    onSaveEventPostRecord,
    onDeleteEventPostRecord,
    onExportEventPostRecordsCsv,
    onChangePostedForm,
    onAddPostedRecord,
    onDeletePostedRecord,
    onExportPostedRecordsCsv,
    onExportPostedRecordsJson,
    onImportPostedRecordsJson,
  } = actions

  if (!isVisible) return null

  return (
    <>
      {/* Phase19-O: 運用ダッシュボード */}
      {simpleTemplateId === 'mmm-event' && (
        <div className="event-dashboard-panel">
          <p className="event-dashboard-title">運用ダッシュボード</p>
          <div className="event-dashboard-stats">
            <div className="event-dashboard-stat">
              <span className="event-dashboard-stat-label">今月の投稿数</span>
              <strong className="event-dashboard-stat-value">{eventDashboardStats.thisMonthCount}件</strong>
            </div>
            <div className="event-dashboard-stat">
              <span className="event-dashboard-stat-label">URL付き投稿</span>
              <strong className="event-dashboard-stat-value">{eventDashboardStats.urlCount}件</strong>
            </div>
            <div className="event-dashboard-stat">
              <span className="event-dashboard-stat-label">総投稿数</span>
              <strong className="event-dashboard-stat-value">{eventDashboardStats.total}件</strong>
            </div>
          </div>

          {eventDashboardStats.total > 0 && (
            <div className="event-dashboard-sns">
              <p className="event-dashboard-section-label">SNS別</p>
              <div className="event-dashboard-sns-row">
                {(
                  [
                    { key: 'instagram', label: 'Instagram' },
                    { key: 'x', label: 'X' },
                    { key: 'tiktok', label: 'TikTok' },
                    { key: 'youtube', label: 'YouTube' },
                    { key: 'other', label: 'その他' },
                  ] as const
                ).map(({ key, label }) =>
                  eventDashboardStats.snsCounts[key] > 0 ? (
                    <span key={key} className="event-dashboard-sns-badge">
                      {label} {eventDashboardStats.snsCounts[key]}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )}

          {eventDashboardStats.recentRecords.length > 0 && (
            <div className="event-dashboard-recent">
              <p className="event-dashboard-section-label">直近投稿</p>
              <ul className="event-dashboard-recent-list">
                {eventDashboardStats.recentRecords.map((r) => (
                  <li key={r.id} className="event-dashboard-recent-item">
                    <span className="event-dashboard-recent-date">{r.postDate || r.createdAt.slice(0, 10)}</span>
                    <span className="event-dashboard-recent-sns">
                      {EVENT_POST_RECORD_SNS_OPTIONS.find((o) => o.value === r.sns)?.label ?? r.sns}
                    </span>
                    <span className="event-dashboard-recent-title">{r.eventTitle || '（タイトルなし）'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {eventDashboardStats.unpostedPresets.length > 0 && (
            <div className="event-dashboard-unposted">
              <p className="event-dashboard-section-label">未投稿イベント</p>
              <ul className="event-dashboard-unposted-list">
                {eventDashboardStats.unpostedPresets.map((p) => (
                  <li key={p.id} className="event-dashboard-unposted-item">
                    {p.name}
                    {p.date && <span className="event-dashboard-unposted-date"> — {p.date}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="event-dashboard-actions">
            <button
              className="btn-event-dashboard-action"
              onClick={onExportEventPostRecordsCsv}
              disabled={filteredEventPostRecords.length === 0}
            >
              表示中のCSV出力
            </button>
            <button
              className="btn-event-dashboard-action"
              onClick={onExportReelBackupJson}
            >
              JSONバックアップ
            </button>
          </div>
        </div>
      )}

      {/* Phase19-K: MMMイベント投稿記録 */}
      {simpleTemplateId === 'mmm-event' && (
        <div className="event-post-record-panel">
          <div className="event-post-record-header">
            <div className="event-post-record-title-group">
              <p className="event-post-record-title">投稿記録を残す</p>
              <p className="event-post-record-lead">
                SNSへ投稿できたら、ここで投稿日・投稿先・URL・メモを保存します。投稿漏れ防止とSNS別の振り返りに使えます。
              </p>
            </div>
            <button
              className="btn-event-post-record-csv"
              onClick={onExportEventPostRecordsCsv}
              disabled={filteredEventPostRecords.length === 0}
            >
              表示中のCSV出力
            </button>
          </div>

          {/* Phase19-M: 絞り込みUI */}
          {eventPostRecords.length > 0 && (
            <div className="event-post-filter">
              <div className="event-post-filter-row">
                <label className="event-post-filter-field">
                  <span className="event-post-filter-label">SNS</span>
                  <select
                    className="event-post-filter-select"
                    value={eventPostFilter.sns}
                    onChange={(e) => onChangeEventPostFilter((prev) => ({ ...prev, sns: e.target.value }))}
                  >
                    <option value="all">すべて</option>
                    {EVENT_POST_RECORD_SNS_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="event-post-filter-field">
                  <span className="event-post-filter-label">URL</span>
                  <select
                    className="event-post-filter-select"
                    value={eventPostFilter.urlStatus}
                    onChange={(e) => onChangeEventPostFilter((prev) => ({ ...prev, urlStatus: e.target.value }))}
                  >
                    <option value="all">すべて</option>
                    <option value="with">URLあり</option>
                    <option value="without">URLなし</option>
                  </select>
                </label>
              </div>
              <div className="event-post-filter-row">
                <label className="event-post-filter-field event-post-filter-field--grow">
                  <span className="event-post-filter-label">イベント名・メモ検索</span>
                  <input
                    type="text"
                    className="event-post-filter-input"
                    value={eventPostFilter.keyword}
                    onChange={(e) => onChangeEventPostFilter((prev) => ({ ...prev, keyword: e.target.value }))}
                    placeholder="キーワード"
                  />
                </label>
                <label className="event-post-filter-field">
                  <span className="event-post-filter-label">投稿日</span>
                  <input
                    type="date"
                    className="event-post-filter-input"
                    value={eventPostFilter.postDate}
                    onChange={(e) => onChangeEventPostFilter((prev) => ({ ...prev, postDate: e.target.value }))}
                  />
                </label>
              </div>
              <div className="event-post-filter-footer">
                <span className="event-post-filter-count">
                  表示中：{filteredEventPostRecords.length} / {eventPostRecords.length} 件
                </span>
                {isEventPostFilterActive && (
                  <button
                    className="btn-event-post-filter-reset"
                    onClick={() => onChangeEventPostFilter({ sns: 'all', keyword: '', postDate: '', urlStatus: 'all' })}
                  >
                    絞り込み解除
                  </button>
                )}
              </div>
            </div>
          )}

          {/* レポート */}
          {eventPostReport.total > 0 && (
            <div className="event-post-record-report">
              <p className="event-post-record-report-total">イベント告知投稿数：{eventPostReport.total}件</p>
              <div className="event-post-record-report-grid">
                {EVENT_POST_RECORD_SNS_OPTIONS.map(({ value, label }) =>
                  eventPostReport.counts[value] > 0 ? (
                    <span key={value} className="event-post-record-report-item">
                      {label}：{eventPostReport.counts[value]}件
                    </span>
                  ) : null
                )}
                {eventPostReport.urlCount > 0 && (
                  <span className="event-post-record-report-item event-post-record-report-item--url">
                    URL付き：{eventPostReport.urlCount}件
                  </span>
                )}
              </div>
            </div>
          )}

          {/* フォーム */}
          <div className="event-post-record-form">
            <p className="event-post-record-form-guide">
              最低限「投稿日」と「SNS」を選べば保存できます。投稿URLや反応メモは、あとから成果を振り返るための控えです。
            </p>
            <div className="event-post-record-field">
              <span className="event-post-record-label">イベント名</span>
              <span className="event-post-record-event-name">
                {mmmEventForm.title || aiTheme || '未設定イベント'}
              </span>
            </div>
            <label className="event-post-record-field">
              <span className="event-post-record-label">SNS</span>
              <select
                className="event-post-record-select"
                value={eventPostRecordForm.sns}
                onChange={(e) => onChangeEventPostRecordForm((prev) => ({ ...prev, sns: e.target.value as EventPostRecord['sns'] }))}
              >
                {EVENT_POST_RECORD_SNS_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="event-post-record-field">
              <span className="event-post-record-label">投稿日</span>
              <input
                type="date"
                className="event-post-record-input"
                value={eventPostRecordForm.postDate}
                onChange={(e) => onChangeEventPostRecordForm((prev) => ({ ...prev, postDate: e.target.value }))}
              />
            </label>
            <label className="event-post-record-field event-post-record-field--wide">
              <span className="event-post-record-label">投稿URL</span>
              <input
                type="text"
                className="event-post-record-input"
                value={eventPostRecordForm.postUrl}
                onChange={(e) => onChangeEventPostRecordForm((prev) => ({ ...prev, postUrl: e.target.value }))}
                placeholder="https://..."
              />
            </label>
            <label className="event-post-record-field event-post-record-field--wide">
              <span className="event-post-record-label">メモ</span>
              <textarea
                className="event-post-record-textarea"
                value={eventPostRecordForm.memo}
                onChange={(e) => onChangeEventPostRecordForm((prev) => ({ ...prev, memo: e.target.value }))}
                placeholder="反応や投稿時のメモ"
                rows={2}
              />
            </label>
            <button
              className="btn-event-post-record-save"
              onClick={onSaveEventPostRecord}
              disabled={!eventPostRecordForm.sns || !eventPostRecordForm.postDate}
            >
              投稿記録を保存
            </button>
          </div>

          {/* 一覧（最大5件・フィルター済み） */}
          {filteredEventPostRecords.length > 0 && (
            <ul className="event-post-record-list">
              {filteredEventPostRecords.slice(0, 5).map((record) => (
                <li key={record.id} className="event-post-record-item">
                  <div className="event-post-record-item-main">
                    <p className="event-post-record-item-header">
                      {record.postDate} / {EVENT_POST_RECORD_SNS_OPTIONS.find((o) => o.value === record.sns)?.label ?? record.sns} / {record.eventTitle}
                    </p>
                    {record.postUrl && (
                      <a
                        className="event-post-record-item-url"
                        href={record.postUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {record.postUrl}
                      </a>
                    )}
                    {record.memo && (
                      <p className="event-post-record-item-memo">メモ：{record.memo}</p>
                    )}
                  </div>
                  <button
                    className="btn-event-post-record-delete"
                    onClick={() => onDeleteEventPostRecord(record.id)}
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <PostingRecordsPanel
        records={postedRecords}
        form={postedForm}
        importMessage={postedRecordsImportMessage}
        importError={postedRecordsImportError}
        report={postedReport}
        onChangeForm={onChangePostedForm}
        onAddRecord={onAddPostedRecord}
        onDeleteRecord={onDeletePostedRecord}
        onExportCsv={onExportPostedRecordsCsv}
        onExportJson={onExportPostedRecordsJson}
        onImportJson={onImportPostedRecordsJson}
      />

      {/* Phase19-N: 全データバックアップ */}
      <div className="reel-backup-panel">
        <p className="reel-backup-title">JSONバックアップ</p>
        <div className="reel-backup-actions">
          <button
            className="btn-reel-backup"
            onClick={onExportReelBackupJson}
          >
            バックアップ出力
          </button>
          <label className="btn-reel-backup btn-reel-backup--import">
            ファイルを選択して復元
            <input
              type="file"
              accept="application/json,.json"
              onChange={onImportReelBackupJson}
            />
          </label>
        </div>
        {backupImportMessage && (
          <p className="reel-backup-message">{backupImportMessage}</p>
        )}
        {backupImportError && (
          <p className="reel-backup-error">{backupImportError}</p>
        )}
      </div>
    </>
  )
}
