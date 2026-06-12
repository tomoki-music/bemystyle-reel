import { SlideForm } from '../SlideForm'
import type { CTAConfig, Slide } from '../../types'

type SlideEditPanelProps = {
  selectedSlide: Slide | null
  ctaConfig: CTAConfig
  isRendering: boolean
  imageGeneratingId: number | null
  imageGenerateErrors: Record<number, string>
  onUpdateSlide: (id: number, changes: Partial<Slide>) => void
  onCtaChange: (config: CTAConfig) => void
  onGenerateImage: (id: number, imagePrompt: string) => void
}

export function SlideEditPanel({
  selectedSlide,
  ctaConfig,
  isRendering,
  imageGeneratingId,
  imageGenerateErrors,
  onUpdateSlide,
  onCtaChange,
  onGenerateImage,
}: SlideEditPanelProps) {
  return (
    <div className="panel panel-right">
      <div className="panel-header">
        <span className="panel-title">
          {selectedSlide?.layout === 'cta' ? 'CTA スライド編集' : '編集フォーム'}
        </span>
        {selectedSlide && (
          <span className="panel-badge">#{selectedSlide.id}</span>
        )}
      </div>
      {selectedSlide ? (
        <>
          {isRendering && (
            <div className="render-lock-notice">
              ⏳ 動画生成中のため、編集はロックされています。完了までお待ちください。
            </div>
          )}
          <SlideForm
            slide={selectedSlide}
            onChange={(changes) => onUpdateSlide(selectedSlide.id, changes)}
            ctaConfig={ctaConfig}
            onCtaChange={onCtaChange}
            disabled={isRendering}
            onGenerateImage={selectedSlide.imagePrompt ? () => onGenerateImage(selectedSlide.id, selectedSlide.imagePrompt!) : undefined}
            isGeneratingImage={imageGeneratingId === selectedSlide.id}
            generateImageError={imageGenerateErrors[selectedSlide.id]}
          />
        </>
      ) : (
        <div className="empty-state">スライドを選択してください</div>
      )}
    </div>
  )
}
