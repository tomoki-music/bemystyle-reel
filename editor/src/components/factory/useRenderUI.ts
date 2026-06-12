import { useMemo } from 'react'
import type { Slide } from '../../types'
import type { RenderQueueItem } from '../renderQueue/useRenderQueue'

type UseRenderUIParams = {
  slides: Slide[]
  renderQueue: RenderQueueItem[]
  renderStatus: string
  elapsedSec: number
  hasUnsavedChanges: boolean
  isPreparingRender: boolean
  isAutoPipelineRunning: boolean
  isBatchRendering: boolean
  isSmartPipelineRunning: boolean
  isSmartRewritePipelineRunning: boolean
  isMultiRewriteQueueRunning: boolean
  factoryRunning: boolean
  pipelineStatus: string
  smartPipelineStatus: string
  smartRewritePipelineStatus: string
  multiRewriteQueueStatus: string
}

export function useRenderUI({
  slides,
  renderQueue,
  renderStatus,
  elapsedSec,
  hasUnsavedChanges,
  isPreparingRender,
  isAutoPipelineRunning,
  isBatchRendering,
  isSmartPipelineRunning,
  isSmartRewritePipelineRunning,
  isMultiRewriteQueueRunning,
  factoryRunning,
  pipelineStatus,
  smartPipelineStatus,
  smartRewritePipelineStatus,
  multiRewriteQueueStatus,
}: UseRenderUIParams) {
  const renderPrecheck = useMemo(() => {
    const TARGET = 14
    const generatedCount = slides.filter((s) => s.image?.startsWith('generated/')).length
    const noImageCount = slides.filter((s) => !s.image).length
    const checks: { label: string; ok: boolean }[] = [
      {
        label: `ストーリー ${slides.length} 枚${slides.length > 0 && slides.length !== TARGET ? `（推奨 ${TARGET} 枚）` : ''}`,
        ok: slides.length === TARGET,
      },
      {
        label: `生成済み画像 ${generatedCount} / ${slides.length} 枚`,
        ok: slides.length > 0 && generatedCount === slides.length,
      },
      {
        label: '保存済み',
        ok: !hasUnsavedChanges,
      },
    ]
    if (noImageCount > 0) {
      checks.push({ label: `未設定画像 ${noImageCount} 枚あり`, ok: false })
    }
    return { checks, canRender: slides.length > 0 }
  }, [hasUnsavedChanges, slides])

  const isRendering = isPreparingRender || renderStatus === 'running'

  const renderQueueDerived = useMemo(() => {
    const completedVariants = [...renderQueue]
      .filter((q) => q.status === 'completed')
      .sort((a, b) => {
        const ta = a.renderedAt ? new Date(a.renderedAt).getTime() : 0
        const tb = b.renderedAt ? new Date(b.renderedAt).getTime() : 0
        return tb - ta
      })
    const factoryGeneratedSlides = slides
      .filter((s): s is typeof s & { image: string } => !!s.image?.startsWith('generated/'))
      .map((s) => ({ id: s.id, headline: s.headline, image: s.image }))
    return { completedVariants, factoryGeneratedSlides }
  }, [renderQueue, slides])

  const renderStepInfo = isPreparingRender
    ? { step: 1, total: 3, label: '保存中' }
    : renderStatus === 'running'
    ? { step: 2, total: 3, label: 'レンダリング中' }
    : renderStatus === 'completed'
    ? { step: 3, total: 3, label: '完了' }
    : null

  const renderProgressPct = renderStatus === 'completed'
    ? 100
    : isRendering
    ? Math.min(Math.round((elapsedSec / 120) * 100), 95)
    : 0

  const renderBtnLabel = isPreparingRender
    ? '⏳ 保存して動画生成中...'
    : renderStatus === 'running'
    ? '⏳ 生成中...'
    : renderStatus === 'completed'
    ? '✓ 動画生成完了'
    : renderStatus === 'failed'
    ? '✗ 生成失敗'
    : '🎬 動画生成'

  const renderStatusMsg = isPreparingRender
    ? '⏳ 保存してから動画生成しています...'
    : renderStatus === 'running'
    ? '⏳ 動画生成中… 完了まで 1〜3 分かかります'
    : renderStatus === 'completed'
    ? '✓ 動画生成が完了しました！'
    : renderStatus === 'failed'
    ? '✗ 生成に失敗しました。エラー内容を確認してください。'
    : hasUnsavedChanges
    ? '未保存の変更があります'
    : null

  const renderStatusClass =
    isPreparingRender || renderStatus === 'running'
      ? 'render-status-msg render-status-msg--info'
      : renderStatus === 'completed'
      ? 'render-status-msg render-status-msg--ok'
      : renderStatus === 'failed'
      ? 'render-status-msg render-status-msg--error'
      : hasUnsavedChanges
      ? 'render-status-msg render-status-msg--warning'
      : 'render-status-msg'

  const pipelineStep =
    pipelineStatus === 'バリアント生成中...' ? 1 :
    pipelineStatus === 'バリアントレンダリング中...' ? 2 :
    pipelineStatus === '比較ダッシュボード準備完了' ? 3 : 0

  const isPipelineDisabled = isAutoPipelineRunning || isBatchRendering || isRendering || isSmartPipelineRunning || isSmartRewritePipelineRunning || isMultiRewriteQueueRunning || factoryRunning

  const multiRewriteQueueStep =
    multiRewriteQueueStatus === 'AIバリアント生成中...' ? 1 :
    multiRewriteQueueStatus === 'バリアントスコアリング中...' ? 2 :
    multiRewriteQueueStatus === 'トップバリアントを選定中...' ? 3 :
    multiRewriteQueueStatus === 'バリアントをリライト中...' ? 4 :
    multiRewriteQueueStatus === '最初のリライトを適用中...' ? 5 :
    multiRewriteQueueStatus === 'リライトバリアントをキューに投入中...' ? 6 :
    multiRewriteQueueStatus === 'レンダリング中...' ? 7 :
    multiRewriteQueueStatus === 'マルチリライトキュー完了' ? 8 : 0

  const smartRewritePipelineStep =
    smartRewritePipelineStatus === 'AIバリアント生成中...' ? 1 :
    smartRewritePipelineStatus === 'バリアントスコアリング中...' ? 2 :
    smartRewritePipelineStatus === 'トップバリアントを選定中...' ? 3 :
    smartRewritePipelineStatus === 'ストーリーをリライト中...' ? 4 :
    smartRewritePipelineStatus === 'リライトを適用中...' ? 5 :
    smartRewritePipelineStatus === 'リライトバリアントをキューに追加中...' ? 6 :
    smartRewritePipelineStatus === 'レンダリング中...' ? 7 :
    smartRewritePipelineStatus === 'スマートリライト完了' ? 8 : 0

  const smartPipelineStep =
    smartPipelineStatus === 'AIバリアント生成中...' ? 1 :
    smartPipelineStatus === 'バリアントスコアリング中...' ? 2 :
    smartPipelineStatus === '推奨バリアントをキューに追加中...' ? 3 :
    smartPipelineStatus === '推奨バリアントのレンダリング中...' ? 4 :
    smartPipelineStatus === '比較ダッシュボード準備完了' ? 5 : 0

  return {
    renderBtnLabel,
    renderStatusMsg,
    renderStatusClass,
    renderStepInfo,
    renderProgressPct,
    pipelineStep,
    isPipelineDisabled,
    smartPipelineStep,
    smartRewritePipelineStep,
    multiRewriteQueueStep,
    renderPrecheck,
    renderQueueDerived,
    isRendering,
  }
}
