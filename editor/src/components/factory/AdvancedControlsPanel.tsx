import { AutoPipelinePanel } from './AutoPipelinePanel'
import { SmartPipelinePanel, type SmartPipelinePanelProps } from './SmartPipelinePanel'
import { VariantGeneratorPanel, type VariantGeneratorPanelProps } from './VariantGeneratorPanel'
import type { LastPipeline } from './useFactoryPipeline'

type AdvancedControlsPanelProps = {
  aiTheme: string
  isPipelineDisabled: boolean
  autoPipeline: {
    isRunning: boolean
    step: number
    status: string
    warning: string
    error: string
    lastPipeline: LastPipeline | null
    onRun: () => void
  }
  smartPipeline: SmartPipelinePanelProps
  variantGenerator: VariantGeneratorPanelProps
}

export function AdvancedControlsPanel({
  aiTheme,
  isPipelineDisabled,
  autoPipeline,
  smartPipeline,
  variantGenerator,
}: AdvancedControlsPanelProps) {
  return (
    <details className="advanced-panel">
      <summary className="advanced-panel-summary">🔧 上級者向け機能</summary>
      <div className="advanced-panel-body">
        <AutoPipelinePanel
          aiTheme={aiTheme}
          isPipelineDisabled={isPipelineDisabled}
          isAutoPipelineRunning={autoPipeline.isRunning}
          pipelineStep={autoPipeline.step}
          pipelineStatus={autoPipeline.status}
          factoryWarning={autoPipeline.warning}
          factoryError={autoPipeline.error}
          lastPipeline={autoPipeline.lastPipeline}
          onRunAutoPipeline={autoPipeline.onRun}
        />

        <SmartPipelinePanel {...smartPipeline} />

        {/* 🧠 AI Variant Generator (Phase14-D) */}
        <VariantGeneratorPanel {...variantGenerator} />
      </div>{/* advanced-panel-body */}
    </details>
  )
}
