import {
  POST_CHECKLIST_ITEMS,
  type PostChecklistKey,
} from '../posting/usePostingManager'
import {
  EVENT_POST_CHECKLIST_ITEMS,
  type EventPostChecklistKey,
} from './useEventPosting'

type PostingChecklistPanelProps = {
  simpleTemplateId: string | null
  postChecklist: Record<PostChecklistKey, boolean>
  isPostChecklistComplete: boolean
  onTogglePostChecklist: (key: PostChecklistKey) => void
  eventPostChecklist: Record<EventPostChecklistKey, boolean>
  eventPostDate: string
  eventPostChecklistCount: number
  isEventPostChecklistComplete: boolean
  onToggleEventPostChecklist: (key: EventPostChecklistKey) => void
  onChangeEventPostDate: (value: string) => void
}

export function PostingChecklistPanel({
  simpleTemplateId,
  postChecklist,
  isPostChecklistComplete,
  onTogglePostChecklist,
  eventPostChecklist,
  eventPostDate,
  eventPostChecklistCount,
  isEventPostChecklistComplete,
  onToggleEventPostChecklist,
  onChangeEventPostDate,
}: PostingChecklistPanelProps) {
  return (
    <>
      {/* 投稿前チェックリスト (Phase18-C) */}
      <div className="sns-post-checklist">
        <p className="sns-post-checklist-title">投稿前チェック</p>
        <ul className="sns-post-checklist-list">
          {POST_CHECKLIST_ITEMS.map((item) => (
            <li key={item.key}>
              <label className="sns-post-checklist-item">
                <input
                  type="checkbox"
                  checked={postChecklist[item.key]}
                  onChange={() => onTogglePostChecklist(item.key)}
                />
                <span>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {isPostChecklistComplete && (
          <p className="sns-post-checklist-complete">投稿完了おつかれさまでした！</p>
        )}
      </div>

      {/* Phase19-I: MMMイベント投稿前チェックリスト */}
      {simpleTemplateId === 'mmm-event' && (<>
        <div className="event-post-checklist">
          <div className="event-post-checklist-header">
            <p className="event-post-checklist-title">投稿前チェック</p>
            {isEventPostChecklistComplete ? (
              <p className="event-post-checklist-complete">投稿準備完了</p>
            ) : (
              <p className="event-post-checklist-progress">
                {eventPostChecklistCount} / {EVENT_POST_CHECKLIST_ITEMS.length} 完了
                {EVENT_POST_CHECKLIST_ITEMS.length - eventPostChecklistCount > 0 && (
                  <span className="event-post-checklist-remaining">
                    　あと{EVENT_POST_CHECKLIST_ITEMS.length - eventPostChecklistCount}つ確認すると投稿準備完了です
                  </span>
                )}
              </p>
            )}
          </div>
          <ul className="event-post-checklist-list">
            {EVENT_POST_CHECKLIST_ITEMS.map((item) => (
              <li key={item.key}>
                <label className="event-post-checklist-item">
                  <input
                    type="checkbox"
                    checked={eventPostChecklist[item.key]}
                    onChange={() => onToggleEventPostChecklist(item.key)}
                  />
                  <span>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="event-post-date-row">
            <label className="event-post-date-label">投稿日</label>
            <input
              type="date"
              className="event-post-date-input"
              value={eventPostDate}
              onChange={(e) => onChangeEventPostDate(e.target.value)}
            />
          </div>
        </div>
      </>)}
    </>
  )
}
