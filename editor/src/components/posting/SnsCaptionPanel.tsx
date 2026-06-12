import type { TemplateInfo } from '../../types'
import {
  type CaptionEditKey,
  type SnsCaption,
  formatCaptionHashtags,
  formatInstagramCaption,
  formatTikTokCaption,
  formatXCaption,
  formatYouTubeCaption,
} from './usePostingManager'

type CopiedSnsField = 'ytTitle' | 'ytDesc' | 'ig' | 'tiktok' | 'x' | 'tags' | ''

type SnsCaptionPanelProps = {
  snsCaption: SnsCaption
  selectedTemplateId: string | null
  simpleTemplateId: string | null
  templates: TemplateInfo[]
  copiedAllCaption: boolean
  copiedCaptionLabel: string
  snsCaptionError: string
  copiedSnsField: string | null
  editingCaptionKey: CaptionEditKey | ''
  editingCaptionText: string
  regeneratingCaptionKey: CaptionEditKey | ''
  isGeneratingSnsCaption: boolean
  onCopyAllCaptions: (caption: SnsCaption) => void
  onCopyCaptionText: (label: string, text: string) => void
  onCopySnsText: (field: string, text: string) => void
  onStartCaptionEdit: (key: CaptionEditKey, text: string) => void
  onChangeEditingCaptionText: (text: string) => void
  onCancelCaptionEdit: () => void
  onSaveCaptionEdit: () => void
  onRegenerateCaptionPart: (key: CaptionEditKey) => void
  onGenerateSnsCaption: () => void
  onGoToManageTab?: () => void
}

type CaptionField = {
  key: CaptionEditKey
  label: string
  copyField: CopiedSnsField
  value: string
  textClassName?: string
  inputClassName?: string
  displayValue?: string
}

export function SnsCaptionPanel({
  snsCaption,
  selectedTemplateId,
  simpleTemplateId,
  templates,
  copiedAllCaption,
  copiedCaptionLabel,
  snsCaptionError,
  copiedSnsField,
  editingCaptionKey,
  editingCaptionText,
  regeneratingCaptionKey,
  isGeneratingSnsCaption,
  onCopyAllCaptions,
  onCopyCaptionText,
  onCopySnsText,
  onStartCaptionEdit,
  onChangeEditingCaptionText,
  onCancelCaptionEdit,
  onSaveCaptionEdit,
  onRegenerateCaptionPart,
  onGenerateSnsCaption,
  onGoToManageTab,
}: SnsCaptionPanelProps) {
  const selectedTemplateName = (selectedTemplateId || simpleTemplateId)
    ? (templates.find((t) => t.id === (selectedTemplateId || simpleTemplateId))?.name ?? (selectedTemplateId || simpleTemplateId))
    : '汎用'

  const captionFields: CaptionField[] = [
    {
      key: 'youtubeTitle',
      label: 'YouTube Shorts タイトル',
      copyField: 'ytTitle',
      value: snsCaption.youtubeTitle,
      textClassName: 'sns-caption-text sns-caption-text--title',
      inputClassName: 'sns-caption-edit-input sns-caption-edit-input--title',
    },
    {
      key: 'youtubeDescription',
      label: 'YouTube 説明文',
      copyField: 'ytDesc',
      value: snsCaption.youtubeDescription,
    },
    {
      key: 'instagramCaption',
      label: 'Instagram 投稿文',
      copyField: 'ig',
      value: snsCaption.instagramCaption,
    },
    {
      key: 'tiktokCaption',
      label: 'TikTok 用',
      copyField: 'tiktok',
      value: snsCaption.tiktokCaption || snsCaption.instagramCaption,
    },
    {
      key: 'xCaption',
      label: 'X 用',
      copyField: 'x',
      value: snsCaption.xCaption || snsCaption.instagramCaption,
    },
    {
      key: 'hashtags',
      label: 'ハッシュタグ',
      copyField: 'tags',
      value: formatCaptionHashtags(snsCaption),
      textClassName: 'sns-caption-text sns-caption-text--tags',
      inputClassName: 'sns-caption-edit-input sns-caption-edit-input--tags',
      displayValue: formatCaptionHashtags(snsCaption).split(' ').join('　'),
    },
  ]

  return (
    <div className="sns-caption-panel">
      <div className="sns-caption-panel-header">
        <div className="sns-caption-panel-title-group">
          <p className="sns-caption-panel-title">SNS投稿文</p>
          <span className="sns-caption-template-type">
            投稿文タイプ：{selectedTemplateName}
          </span>
        </div>
        <button
          className="btn-sns-copy-all"
          onClick={() => onCopyAllCaptions(snsCaption)}
        >
          {copiedAllCaption ? '✓ コピー済み' : '📋 投稿文をコピー'}
        </button>
      </div>
      <div className="sns-caption-guide">
        <p>① 投稿文をコピー → ② SNSへ貼り付け → ③ 投稿後は管理タブへ。</p>
        <p>投稿日・投稿先・URL・メモを残すと、あとから成果を振り返りやすくなります。</p>
      </div>
      {copiedAllCaption && (
        <p className="sns-copy-toast">投稿文をコピーしました</p>
      )}
      <div className="sns-copy-actions">
        <button
          className="btn-sns-copy-platform"
          onClick={() => onCopyCaptionText('YouTube', formatYouTubeCaption(snsCaption))}
        >
          📋 YouTube用をコピー
        </button>
        <button
          className="btn-sns-copy-platform"
          onClick={() => onCopyCaptionText('Instagram', formatInstagramCaption(snsCaption))}
        >
          📋 Instagram用をコピー
        </button>
        <button
          className="btn-sns-copy-platform"
          onClick={() => onCopyCaptionText('TikTok', formatTikTokCaption(snsCaption))}
        >
          📋 TikTok用をコピー
        </button>
        <button
          className="btn-sns-copy-platform"
          onClick={() => onCopyCaptionText('X', formatXCaption(snsCaption))}
        >
          📋 X用をコピー
        </button>
      </div>
      {copiedCaptionLabel && (
        <p className="sns-copy-toast">{copiedCaptionLabel}用をコピーしました</p>
      )}
      <p className="sns-copy-next-hint">
        コピー後は、動画ファイルと一緒に各SNSへ投稿してください。投稿URLが分かったら記録しておくと、投稿漏れ防止や複数SNSの管理にも使えます。
      </p>
      {onGoToManageTab && (
        <div className="sns-after-post-cta">
          <p className="sns-after-post-cta-title">投稿できたら最後の一歩</p>
          <p>管理タブで投稿日・投稿先・URL・メモを残しましょう。</p>
          <button
            className="btn-go-manage-tab"
            onClick={onGoToManageTab}
            type="button"
          >
            投稿後はこちら：管理タブへ
          </button>
        </div>
      )}
      {snsCaptionError && (
        <p className="sns-caption-error">{snsCaptionError}</p>
      )}

      {captionFields.map((field) => (
        <div className="sns-caption-field" key={field.key}>
          <div className="sns-caption-field-header">
            <span className="sns-caption-field-label">{field.label}</span>
            <div className="sns-caption-field-actions">
              {editingCaptionKey === field.key ? (
                <>
                  <button className="btn-sns-copy" onClick={onSaveCaptionEdit}>保存</button>
                  <button className="btn-sns-copy" onClick={onCancelCaptionEdit}>キャンセル</button>
                  <button
                    className="btn-sns-copy"
                    onClick={() => onRegenerateCaptionPart(field.key)}
                    disabled={!!regeneratingCaptionKey}
                  >
                    {regeneratingCaptionKey === field.key ? '再生成中...' : '再生成'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-sns-copy"
                    onClick={() => onCopySnsText(field.copyField, field.value)}
                  >
                    {copiedSnsField === field.copyField ? '✓ コピー済み' : 'コピー'}
                  </button>
                  <button
                    className="btn-sns-copy"
                    onClick={() => onStartCaptionEdit(field.key, field.value)}
                  >
                    編集
                  </button>
                  <button
                    className="btn-sns-copy"
                    onClick={() => onRegenerateCaptionPart(field.key)}
                    disabled={!!regeneratingCaptionKey}
                  >
                    {regeneratingCaptionKey === field.key ? '再生成中...' : '再生成'}
                  </button>
                </>
              )}
            </div>
          </div>
          {editingCaptionKey === field.key ? (
            <textarea
              className={field.inputClassName ?? 'sns-caption-edit-input'}
              value={editingCaptionText}
              onChange={(e) => onChangeEditingCaptionText(e.target.value)}
            />
          ) : (
            <p className={field.textClassName ?? 'sns-caption-text'}>{field.displayValue ?? field.value}</p>
          )}
        </div>
      ))}

      <button
        className="btn-sns-caption btn-sns-caption--regen"
        onClick={onGenerateSnsCaption}
        disabled={isGeneratingSnsCaption || !!regeneratingCaptionKey}
      >
        {isGeneratingSnsCaption ? '⏳ 生成中...' : 'SNS投稿文を再生成'}
      </button>
    </div>
  )
}
