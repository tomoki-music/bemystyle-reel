import { useMemo } from 'react'
import type { ComponentProps } from 'react'
import type { Slide, ReelAiConfig } from '../../types'
import type { CompareDashboardPanel } from '../compare/CompareDashboardPanel'
import type { RenderQueuePanel } from '../render/RenderQueuePanel'
import type { RenderQueueItem } from '../renderQueue/useRenderQueue'
import type { useCompareDashboard } from '../compare/useCompareDashboard'
import type { useRenderQueueRunner } from '../renderQueue/useRenderQueueRunner'
import type { useStoryGenerator } from '../story/useStoryGenerator'
import type { FactoryPanel } from './FactoryPanel'
import {
  FACTORY_QUICK_TAGS,
  MAX_HISTORY_THEME_LENGTH,
} from './useFactoryPipeline'
import type { useFactoryPipeline } from './useFactoryPipeline'
import type { useRenderUI } from './useRenderUI'

type RenderQueuePanelProps = ComponentProps<typeof RenderQueuePanel>
type FactoryPanelProps = ComponentProps<typeof FactoryPanel>
type ComparePanelProps = ComponentProps<typeof CompareDashboardPanel>

type UsePanelPropsBuilderOptions = {
  slides: Slide[]
  simpleMode: boolean
  aiTheme: string
  reelAiConfig: ReelAiConfig
  reuseImageMode: boolean
  quotaError: boolean
  renderQueue: RenderQueueItem[]
  renderUI: ReturnType<typeof useRenderUI>
  renderRunner: ReturnType<typeof useRenderQueueRunner>
  factoryPipeline: ReturnType<typeof useFactoryPipeline>
  compareDashboard: ReturnType<typeof useCompareDashboard>
  storyGenerator: ReturnType<typeof useStoryGenerator>
  renderQueueActions: Pick<RenderQueuePanelProps['actions'], 'removeFromQueue' | 'clearQueue'>
  handlers: {
    setQuotaError: (value: boolean) => void
    renderDiffPanel: RenderQueuePanelProps['context']['renderDiffPanel']
  }
}

export function usePanelPropsBuilder({
  slides,
  simpleMode,
  aiTheme,
  reelAiConfig,
  reuseImageMode,
  quotaError,
  renderQueue,
  renderUI,
  renderRunner,
  factoryPipeline,
  compareDashboard,
  storyGenerator,
  renderQueueActions,
  handlers,
}: UsePanelPropsBuilderOptions) {
  const renderQueuePanelProps = useMemo<RenderQueuePanelProps>(() => ({
    queue: renderQueue,
    runner: {
      batchRender: renderRunner.batchRender,
      isBatchRendering: renderRunner.isBatchRendering,
    },
    actions: {
      toggleSnapshotPreview: compareDashboard.toggleSnapshotPreview,
      toggleDiffView: compareDashboard.toggleDiffView,
      explainRewrite: compareDashboard.actions.explainRewrite,
      removeFromQueue: renderQueueActions.removeFromQueue,
      clearQueue: renderQueueActions.clearQueue,
    },
    rewrite: {
      results: compareDashboard.rewriteExplainResults,
      loadingIds: compareDashboard.rewriteExplainLoadingIds,
      errors: compareDashboard.rewriteExplainErrors,
    },
    viewState: {
      expandedSnapshotIds: compareDashboard.expandedSnapshotIds,
      expandedDiffIds: compareDashboard.expandedDiffIds,
    },
    context: {
      isAutoPipelineRunning: factoryPipeline.isAutoPipelineRunning,
      isPipelineDisabled: renderUI.isPipelineDisabled,
      canRender: renderUI.renderPrecheck.canRender,
      slides,
      renderDiffPanel: handlers.renderDiffPanel,
    },
  }), [
    compareDashboard.toggleSnapshotPreview,
    compareDashboard.toggleDiffView,
    compareDashboard.actions.explainRewrite,
    compareDashboard.rewriteExplainResults,
    compareDashboard.rewriteExplainLoadingIds,
    compareDashboard.rewriteExplainErrors,
    compareDashboard.expandedSnapshotIds,
    compareDashboard.expandedDiffIds,
    renderQueue,
    renderRunner.batchRender,
    renderRunner.isBatchRendering,
    renderQueueActions.removeFromQueue,
    renderQueueActions.clearQueue,
    factoryPipeline.isAutoPipelineRunning,
    renderUI.isPipelineDisabled,
    renderUI.renderPrecheck.canRender,
    slides,
    handlers.renderDiffPanel,
  ])

  const factoryPanelProps = useMemo<FactoryPanelProps>(() => ({
    theme: !simpleMode
      ? {
          value: aiTheme,
          isGenerating: storyGenerator.isGenerating,
          generateError: storyGenerator.generateError || undefined,
          generateSuccess: storyGenerator.generateSuccess,
          quotaError,
          onChange: storyGenerator.setAiTheme,
          onGenerate: storyGenerator.handleAIGenerate,
          onQuotaErrorDismiss: () => handlers.setQuotaError(false),
        }
      : undefined,
    run: {
      isRunning: factoryPipeline.factoryRunning,
      step: factoryPipeline.factoryStep,
      stepNum: factoryPipeline.factoryStepNum,
      progress: factoryPipeline.factoryProgress,
      currentImageIndex: factoryPipeline.factoryCurrentImageIndex,
      totalImageCount: factoryPipeline.factoryTotalImageCount,
      error: factoryPipeline.factoryError,
      log: factoryPipeline.factoryLog,
      notice: factoryPipeline.factoryNotice,
      warning: factoryPipeline.factoryWarning,
      isPipelineDisabled: renderUI.isPipelineDisabled || !aiTheme.trim(),
      hasTheme: aiTheme.trim().length > 0,
      reelAiConfig,
      reuseImageMode,
      onRun: () => factoryPipeline.handleRunReelFactory(),
    },
    summary: {
      data: factoryPipeline.factorySummary,
      findQueueItem: factoryPipeline.findFactoryQueueItem,
      onClear: factoryPipeline.clearFactorySummary,
      onJumpToQueueItem: factoryPipeline.handleJumpToQueueItem,
    },
    gallery: {
      generatedSlides: renderUI.renderQueueDerived.factoryGeneratedSlides,
    },
    history: {
      items: factoryPipeline.factoryHistory,
      maxThemeLength: MAX_HISTORY_THEME_LENGTH,
      quickTags: FACTORY_QUICK_TAGS,
      onUpdate: factoryPipeline.handleFactoryHistoryUpdate,
      onToggleFavorite: factoryPipeline.toggleFactoryHistoryFavorite,
      onReuseTheme: factoryPipeline.handleReuseFactoryTheme,
      onDuplicateTheme: factoryPipeline.handleDuplicateFactoryTheme,
      onRerunFactory: factoryPipeline.handleRerunFactoryTheme,
      onDelete: factoryPipeline.handleDeleteFactoryHistoryItem,
      onExportJson: factoryPipeline.handleExportFactoryHistory,
      onExportCsv: factoryPipeline.handleExportFactoryHistoryCsv,
      onImportFile: factoryPipeline.handleImportFactoryHistory,
      onClear: factoryPipeline.handleClearFactoryHistory,
    },
    viewState: {
      hideHistory: simpleMode,
    },
  }), [
    simpleMode,
    aiTheme,
    storyGenerator.isGenerating,
    storyGenerator.generateError,
    storyGenerator.generateSuccess,
    storyGenerator.setAiTheme,
    storyGenerator.handleAIGenerate,
    quotaError,
    handlers.setQuotaError,
    factoryPipeline.factoryRunning,
    factoryPipeline.factoryStep,
    factoryPipeline.factoryStepNum,
    factoryPipeline.factoryProgress,
    factoryPipeline.factoryCurrentImageIndex,
    factoryPipeline.factoryTotalImageCount,
    factoryPipeline.factoryError,
    factoryPipeline.factoryLog,
    factoryPipeline.factoryNotice,
    factoryPipeline.factoryWarning,
    factoryPipeline.handleRunReelFactory,
    factoryPipeline.factorySummary,
    factoryPipeline.findFactoryQueueItem,
    factoryPipeline.clearFactorySummary,
    factoryPipeline.handleJumpToQueueItem,
    factoryPipeline.factoryHistory,
    factoryPipeline.handleFactoryHistoryUpdate,
    factoryPipeline.toggleFactoryHistoryFavorite,
    factoryPipeline.handleReuseFactoryTheme,
    factoryPipeline.handleDuplicateFactoryTheme,
    factoryPipeline.handleRerunFactoryTheme,
    factoryPipeline.handleDeleteFactoryHistoryItem,
    factoryPipeline.handleExportFactoryHistory,
    factoryPipeline.handleExportFactoryHistoryCsv,
    factoryPipeline.handleImportFactoryHistory,
    factoryPipeline.handleClearFactoryHistory,
    renderUI.isPipelineDisabled,
    renderUI.renderQueueDerived.factoryGeneratedSlides,
    reelAiConfig,
    reuseImageMode,
  ])

  const comparePanelProps = useMemo<ComparePanelProps>(() => ({
    data: {
      completedVariants: renderUI.renderQueueDerived.completedVariants,
      lastPipeline: factoryPipeline.lastPipeline,
      bestVariantId: compareDashboard.bestVariantId,
    },
    analysis: {
      result: compareDashboard.bestVariantAnalysis,
      loading: compareDashboard.isAnalyzingBestVariant,
      error: compareDashboard.bestVariantAnalysisError,
    },
    rewrite: {
      results: compareDashboard.rewriteExplainResults,
      loadingIds: compareDashboard.rewriteExplainLoadingIds,
      errors: compareDashboard.rewriteExplainErrors,
    },
    viewState: {
      expandedSnapshotIds: compareDashboard.expandedSnapshotIds,
      expandedDiffIds: compareDashboard.expandedDiffIds,
    },
    actions: {
      selectBestVariant: compareDashboard.selectBestVariant,
      analyzeBestVariant: compareDashboard.analyzeBestVariant,
      toggleSnapshotPreview: compareDashboard.toggleSnapshotPreview,
      toggleDiffView: compareDashboard.toggleDiffView,
      explainRewrite: compareDashboard.actions.explainRewrite,
    },
    context: {
      slides,
      renderDiffPanel: handlers.renderDiffPanel,
    },
  }), [
    renderUI.renderQueueDerived.completedVariants,
    factoryPipeline.lastPipeline,
    compareDashboard.bestVariantId,
    compareDashboard.bestVariantAnalysis,
    compareDashboard.isAnalyzingBestVariant,
    compareDashboard.bestVariantAnalysisError,
    compareDashboard.rewriteExplainResults,
    compareDashboard.rewriteExplainLoadingIds,
    compareDashboard.rewriteExplainErrors,
    compareDashboard.expandedSnapshotIds,
    compareDashboard.expandedDiffIds,
    compareDashboard.selectBestVariant,
    compareDashboard.analyzeBestVariant,
    compareDashboard.toggleSnapshotPreview,
    compareDashboard.toggleDiffView,
    compareDashboard.actions.explainRewrite,
    slides,
    handlers.renderDiffPanel,
  ])

  return {
    renderQueuePanelProps,
    factoryPanelProps,
    comparePanelProps,
  }
}
