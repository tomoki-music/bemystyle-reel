import React from 'react'
import { FactoryRunSection } from './FactoryRunSection'
import { FactorySummaryCard } from './FactorySummaryCard'
import { FactoryHistoryPanel } from './FactoryHistoryPanel'

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
  isPipelineDisabled: boolean
  onRunFactory: () => void

  // FactorySummaryCard
  factorySummary: FactorySummaryData | null
  findFactoryQueueItem: (variantName: string) => { id: string; variantName: string } | undefined
  onClearSummary: () => void
  onJumpToQueueItem: (variantName: string) => void

  // FactoryHistoryPanel
  factoryHistory: FactoryHistoryItemLike[]
  maxThemeLength: number
  quickTags: string[]

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

export function FactoryPanel({
  factoryRunning,
  factoryStep,
  factoryStepNum,
  factoryError,
  factoryLog,
  factoryNotice,
  isPipelineDisabled,
  onRunFactory,
  factorySummary,
  findFactoryQueueItem,
  onClearSummary,
  onJumpToQueueItem,
  factoryHistory,
  maxThemeLength,
  quickTags,
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
      <p className="factory-panel-title">🏭 AI Reel Factory</p>
      <FactoryRunSection
        factoryRunning={factoryRunning}
        factoryStep={factoryStep}
        factoryStepNum={factoryStepNum}
        factoryError={factoryError}
        factoryLog={factoryLog}
        factoryNotice={factoryNotice}
        isPipelineDisabled={isPipelineDisabled}
        onRunFactory={onRunFactory}
      />
      {factorySummary && !factoryRunning && (
        <FactorySummaryCard
          factorySummary={factorySummary}
          findFactoryQueueItem={findFactoryQueueItem}
          onClearSummary={onClearSummary}
          onJumpToQueueItem={onJumpToQueueItem}
        />
      )}
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
    </div>
  )
}
