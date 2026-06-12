import { SlidePreview } from '../SlidePreview'
import type { CTAConfig, Slide } from '../../types'

type PreviewWorkspaceProps = {
  selectedSlide: Slide | null
  selectedSlideIndex: number
  slideCount: number
  ctaConfig: CTAConfig
  slides: Slide[]
  onSelectSlide: (id: number) => void
}

export function PreviewWorkspace({
  selectedSlide,
  selectedSlideIndex,
  slideCount,
  ctaConfig,
  slides,
  onSelectSlide,
}: PreviewWorkspaceProps) {
  return (
    <div className="panel panel-center">
      <div className="panel-header">
        <span className="panel-title">プレビュー</span>
        {selectedSlide && (
          <div className="preview-nav">
            <button
              className="nav-btn"
              disabled={selectedSlideIndex <= 0}
              onClick={() => onSelectSlide(slides[selectedSlideIndex - 1].id)}
            >
              ←
            </button>
            <span className="nav-label">{selectedSlideIndex + 1} / {slideCount}</span>
            <button
              className="nav-btn"
              disabled={selectedSlideIndex >= slideCount - 1}
              onClick={() => onSelectSlide(slides[selectedSlideIndex + 1].id)}
            >
              →
            </button>
          </div>
        )}
      </div>
      <div className="preview-area">
        {selectedSlide ? (
          <SlidePreview slide={selectedSlide} ctaConfig={ctaConfig} />
        ) : (
          <div className="empty-state">スライドを選択してください</div>
        )}
      </div>
    </div>
  )
}
