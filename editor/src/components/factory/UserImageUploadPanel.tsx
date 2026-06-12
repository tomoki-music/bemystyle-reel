import { useCallback, useState } from 'react'
import type React from 'react'
import type { UserUploadedImage } from './useAssetManager'

type Props = {
  userUploadedImages: UserUploadedImage[]
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDropFiles: (files: File[]) => void
  onRemove: (id: string) => void
  onReorder: (id: string, direction: 'up' | 'down') => void
}

export function UserImageUploadPanel({ userUploadedImages, onUpload, onDropFiles, onRemove, onReorder }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const count = userUploadedImages.length
  const isFull = count >= 14

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!isFull) setIsDragging(true)
  }, [isFull])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (isFull) return
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) onDropFiles(files)
  }, [isFull, onDropFiles])

  return (
    <div className="user-image-upload user-image-upload--inline">
      <label
        className={`user-image-drop-zone${isDragging ? ' user-image-drop-zone--dragging' : ''}${isFull ? ' user-image-drop-zone--full' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="user-image-drop-zone-primary">
          {isFull ? '14枚上限に達しました' : 'ここに画像をドラッグ'}
        </span>
        {!isFull && (
          <span className="user-image-drop-zone-secondary">またはクリックして選択</span>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={isFull}
          onChange={onUpload}
        />
      </label>

      <p className="user-image-count-guide">
        現在 <strong>{count}/14</strong> 枚
        {count < 14 && (
          <span className="user-image-count-note">
            {count === 0
              ? '　14枚あると、全スライドを自分の画像で作れます。'
              : '　足りない分は既存ロジックで補完されます。'}
          </span>
        )}
      </p>

      {count > 0 && (
        <div className="user-image-list">
          {userUploadedImages.map((image, i) => (
            <div className="user-image-list-item" key={image.id}>
              <span className="user-image-list-index">{i + 1}枚目</span>
              <img src={image.url} alt={image.name} className="user-image-list-thumb" />
              <span className="user-image-list-name">{image.name}</span>
              <div className="user-image-list-actions">
                <button
                  className="btn-reorder-image"
                  disabled={i === 0}
                  onClick={() => onReorder(image.id, 'up')}
                  title="前へ"
                >&#x2191;</button>
                <button
                  className="btn-reorder-image"
                  disabled={i === count - 1}
                  onClick={() => onReorder(image.id, 'down')}
                  title="後ろへ"
                >&#x2193;</button>
                <button
                  className="btn-remove-upload-image"
                  onClick={() => onRemove(image.id)}
                >削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
