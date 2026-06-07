import React, { useState } from 'react'
import { FactoryRunSection } from './FactoryRunSection'
import { FactorySummaryCard } from './FactorySummaryCard'
import { FactoryHistoryPanel } from './FactoryHistoryPanel'

type GeneratedSlide = { id: number; headline: string; image: string }

type FactoryHistoryItemLike = {
  id: string
  theme: string
  favorite?: boolean
  tags?: string[]
  generatedAt: string
  generatedCount: number
  selectedCount: number
  averageRecommendation: number
  queueAddedCount: number
  bestVariantName: string
  bestRecommendation: number
  topVariants: { name: string; recommendation: number }[]
}

type FactorySummaryData = {
  generatedCount: number
  selectedCount: number
  averageRecommendation: number
  bestVariantName: string
  bestRecommendation: number
  queueAddedCount: number
  generatedAt: string
  topVariants: {
    name: string
    recommendation: number
    predictedViews?: number
    savePotential?: number
    ctaStrength?: number
  }[]
}

type FactoryPanelProps = {
  // FactoryRunSection
  factoryRunning: boolean
  factoryStep: string
  factoryStepNum: number
  factoryError: string
  factoryLog: string[]
  factoryNotice: string
  factoryWarning: string
  isPipelineDisabled: boolean
  hasTheme: boolean
  onRunFactory: () => void

  // FactorySummaryCard
  factorySummary: FactorySummaryData | null
  findFactoryQueueItem: (variantName: string) => { id: string; variantName: string } | undefined
  onClearSummary: () => void
  onJumpToQueueItem: (variantName: string) => void

  // Generated image gallery
  generatedSlides: GeneratedSlide[]

  // FactoryHistoryPanel
  factoryHistory: FactoryHistoryItemLike[]
  maxThemeLength: number
  quickTags: string[]
  hideHistory?: boolean

  onHistoryUpdate: (items: FactoryHistoryItemLike[]) => void
  onToggleFavorite: (id: string) => void
  onReuseTheme: (theme: string) => void
  onDuplicateTheme: (theme: string) => void
  onRerunFactory: (theme: string) => void
  onDelete: (id: string) => void
  onExportJson: () => void
  onExportCsv: () => void
  onImportFile: (file: File) => void
  onClearHistory: () => void
}

function GeneratedImageGallery({ slides }: { slides: GeneratedSlide[] }) {
  const [open, setOpen] = useState(false)
  if (slides.length === 0) return null
  return (
    <div className="factory-image-gallery">
      <button className="factory-image-gallery-toggle" onClick={() => setOpen((v) => !v)}>
        <span>🖼️ 生成済み画像 ({slides.length}枚)</span>
        <span className="factory-image-gallery-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="factory-image-gallery-grid">
          {slides.map((s) => (
            <div key={s.id} className="factory-image-gallery-item">
              <img
                src={`/assets/${s.image}`}
                alt={s.headline || `スライド ${s.id}`}
                className="factory-image-gallery-thumb"
              />
              <p className="factory-image-gallery-label">{s.id}. {s.headline?.slice(0, 12) || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function FactoryPanel({
  factoryRunning,
  factoryStep,
  factoryStepNum,
  factoryError,
  factoryLog,
  factoryNotice,
  factoryWarning,
  isPipelineDisabled,
  hasTheme,
  onRunFactory,
  generatedSlides,
  factorySummary,
  findFactoryQueueItem,
  onClearSummary,
  onJumpToQueueItem,
  factoryHistory,
  maxThemeLength,
  quickTags,
  hideHistory = false,
  onHistoryUpdate,
  onToggleFavorite,
  onReuseTheme,
  onDuplicateTheme,
  onRerunFactory,
  onDelete,
  onExportJson,
  onExportCsv,
  onImportFile,
  onClearHistory,
}: FactoryPanelProps) {
  return (
    <div className="factory-panel">
      <p className="factory-panel-title">🏭 AI自動作成</p>
      <FactoryRunSection
        factoryRunning={factoryRunning}
        factoryStep={factoryStep}
        factoryStepNum={factoryStepNum}
        factoryError={factoryError}
        factoryLog={factoryLog}
        factoryNotice={factoryNotice}
        factoryWarning={factoryWarning}
        isPipelineDisabled={isPipelineDisabled}
        hasTheme={hasTheme}
        onRunFactory={onRunFactory}
      />
      <GeneratedImageGallery slides={generatedSlides} />
      {factorySummary && !factoryRunning && (
        <FactorySummaryCard
          factorySummary={factorySummary}
          findFactoryQueueItem={findFactoryQueueItem}
          onClearSummary={onClearSummary}
          onJumpToQueueItem={onJumpToQueueItem}
        />
      )}
      {!hideHistory && (
        <FactoryHistoryPanel
          factoryHistory={factoryHistory}
          factoryRunning={factoryRunning}
          maxThemeLength={maxThemeLength}
          quickTags={quickTags}
          onHistoryUpdate={onHistoryUpdate}
          onToggleFavorite={onToggleFavorite}
          onReuseTheme={onReuseTheme}
          onDuplicateTheme={onDuplicateTheme}
          onRerunFactory={onRerunFactory}
          onDelete={onDelete}
          onExportJson={onExportJson}
          onExportCsv={onExportCsv}
          onImportFile={onImportFile}
          onClearHistory={onClearHistory}
        />
      )}
    </div>
  )
}
