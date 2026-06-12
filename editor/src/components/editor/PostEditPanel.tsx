import type { ChangeEvent } from 'react'
import type { Slide } from '../../types'

type SlideTextField = 'headline' | 'subline' | 'emphasis'

type PostEditPanelProps = {
  slides: {
    items: Slide[]
    imageReplacingId: number | null
    imageReplaceErrors: Record<number, string>
    onChangeText: (slideId: number, field: SlideTextField, value: string) => void
    onReplaceImage: (slideId: number, event: ChangeEvent<HTMLInputElement>) => void
  }
  media: {
    bgmUploading: boolean
    bgmFileName: string
    bgmUploadError: string
    qrUploading: boolean
    qrFileName: string
    qrUploadError: string
    onBgmUpload: (event: ChangeEvent<HTMLInputElement>) => void
    onQrUpload: (event: ChangeEvent<HTMLInputElement>) => void
  }
  render: {
    isRendering: boolean
    isPreparingRender: boolean
    onRerenderAfterEdit: () => void | Promise<void>
  }
  actions: {
    isOpen: boolean
    onToggleOpen: () => void
  }
}

export function PostEditPanel({
  slides,
  media,
  render,
  actions,
}: PostEditPanelProps) {
  return (
    <div className="post-edit-panel">
      <button
        className="post-edit-panel-toggle"
        onClick={actions.onToggleOpen}
      >
        {actions.isOpen ? '▲ 編集パネルを閉じる' : '✏ 文字・画像・BGMを修正する'}
      </button>

      {actions.isOpen && (
        <div className="post-edit-panel-body">
          <div className="post-edit-section">
            <p className="post-edit-section-title">BGM差し替え</p>
            <label className="bgm-upload-label">
              {media.bgmUploading ? 'アップロード中...' : media.bgmFileName ? `現在：${media.bgmFileName}` : 'mp3 / wav / m4a を選択'}
              <input
                type="file"
                accept=".mp3,.wav,.m4a,audio/*"
                disabled={media.bgmUploading}
                onChange={media.onBgmUpload}
              />
            </label>
            {media.bgmUploadError && <p className="post-edit-error">{media.bgmUploadError}</p>}
            {media.bgmFileName && !media.bgmUploadError && (
              <p className="post-edit-success">BGMを「{media.bgmFileName}」に設定しました</p>
            )}
          </div>

          <div className="post-edit-section">
            <p className="post-edit-section-title">QRコード差し替え（14枚目）</p>
            <label className="bgm-upload-label">
              {media.qrUploading ? 'アップロード中...' : media.qrFileName ? `現在：${media.qrFileName}` : 'QR画像を選択（PNG / JPG）'}
              <input
                type="file"
                accept="image/*"
                disabled={media.qrUploading}
                onChange={media.onQrUpload}
              />
            </label>
            {media.qrUploadError && <p className="post-edit-error">{media.qrUploadError}</p>}
            {media.qrFileName && !media.qrUploadError && (
              <p className="post-edit-success">QRコードを「{media.qrFileName}」に変更しました。再生成で反映されます。</p>
            )}
          </div>

          <div className="post-edit-section">
            <p className="post-edit-section-title">スライド文字を修正</p>
            <div className="slide-text-editor">
              {slides.items.map((slide, idx) => (
                <div key={slide.id} className="slide-text-editor-item">
                  <p className="slide-text-editor-index">Slide {idx + 1}</p>
                  <label className="slide-text-field">
                    <span>見出し</span>
                    <input
                      type="text"
                      value={slide.headline}
                      onChange={(e) => slides.onChangeText(slide.id, 'headline', e.target.value)}
                    />
                  </label>
                  <label className="slide-text-field">
                    <span>サブ</span>
                    <input
                      type="text"
                      value={slide.subline ?? ''}
                      onChange={(e) => slides.onChangeText(slide.id, 'subline', e.target.value)}
                    />
                  </label>
                  <label className="slide-text-field">
                    <span>強調</span>
                    <input
                      type="text"
                      value={slide.emphasis ?? ''}
                      onChange={(e) => slides.onChangeText(slide.id, 'emphasis', e.target.value)}
                    />
                  </label>
                  <div className="slide-image-replace">
                    <label className="slide-image-replace-label">
                      {slides.imageReplacingId === slide.id ? '差し替え中...' : '画像を差し替え'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={slides.imageReplacingId === slide.id}
                        onChange={(e) => slides.onReplaceImage(slide.id, e)}
                      />
                    </label>
                    {slides.imageReplaceErrors[slide.id] && (
                      <p className="post-edit-error">{slides.imageReplaceErrors[slide.id]}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            className="btn-rerender-after-edit"
            onClick={render.onRerenderAfterEdit}
            disabled={render.isRendering || render.isPreparingRender}
          >
            修正内容で動画を再生成
          </button>
        </div>
      )}
    </div>
  )
}
