import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import type { Slide } from '../../types'
import type { RenderQueueItem } from '../renderQueue/useRenderQueue'
import {
  GENERATED_VARIANTS_KEY,
  VARIANT_SCORES_KEY,
  type GeneratedVariant,
  type VariantLearningEvent,
  type VariantScore,
} from './useVariantManager'

export type LastSmartPipeline = {
  generatedCount: number
  recommendedCount: number
  renderedCount: number
  failedCount: number
  finishedAt: string
}

export type LastSmartRewritePipeline = {
  selectedVariantName: string
  selectedAngle: string
  recommendation: number
  renderedCount: number
  failedCount: number
  finishedAt: string
}

export type LastMultiRewriteQueue = {
  rewrittenCount: number
  queuedCount: number
  renderedCount: number
  failedCount: number
  selectedVariants: string[]
  finishedAt: string
}

type RewrittenSlide = {
  headline: string
  subline?: string
  emphasis?: string
}

type UsePipelineRunnerParams = {
  aiTheme: string
  slides: Slide[]
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  variantLearningEvents: VariantLearningEvent[]
  setGeneratedVariants: React.Dispatch<React.SetStateAction<GeneratedVariant[]>>
  setVariantScores: React.Dispatch<React.SetStateAction<VariantScore[]>>
  generatedVariantsRef: React.MutableRefObject<GeneratedVariant[]>
  variantScoresRef: React.MutableRefObject<VariantScore[]>
  renderQueueRef: React.MutableRefObject<RenderQueueItem[]>
  addVariantNamesToQueue: (variantNames: string[]) => { added: number; skipped: number }
  addSnapshotItemToQueue: (variantName: string, slidesSnapshot: Slide[]) => string | null
  addQueueItems: (items: RenderQueueItem[]) => RenderQueueItem[]
  isAutoPipelineRunning: boolean
  isBatchRendering: boolean
  isPreparingRender: boolean
  renderStatus: string
  batchRenderRef: React.MutableRefObject<(itemIds?: string[]) => Promise<void>>
  compareDashboardRef: React.MutableRefObject<HTMLDivElement | null>
}

const LAST_SMART_PIPELINE_KEY = 'bemystyle-reel-last-smart-pipeline'
const LAST_SMART_REWRITE_PIPELINE_KEY = 'bemystyle-reel-last-smart-rewrite-pipeline'
const LAST_MULTI_REWRITE_QUEUE_KEY = 'bemystyle-reel-last-multi-rewrite-queue'

export function usePipelineRunner({
  aiTheme,
  slides,
  setSlides,
  variantLearningEvents,
  setGeneratedVariants,
  setVariantScores,
  generatedVariantsRef,
  variantScoresRef,
  renderQueueRef,
  addVariantNamesToQueue,
  addSnapshotItemToQueue,
  addQueueItems,
  isAutoPipelineRunning,
  isBatchRendering,
  isPreparingRender,
  renderStatus,
  batchRenderRef,
  compareDashboardRef,
}: UsePipelineRunnerParams) {
  // Smart Pipeline (Phase14-I)
  const [isSmartPipelineRunning, setIsSmartPipelineRunning] = useState(false)
  const [smartPipelineStatus, setSmartPipelineStatus] = useState('')
  const [smartPipelineError, setSmartPipelineError] = useState('')
  const [lastSmartPipeline, setLastSmartPipeline] = useState<LastSmartPipeline | null>(null)

  // Smart Rewrite Pipeline (Phase14-K)
  const [isSmartRewritePipelineRunning, setIsSmartRewritePipelineRunning] = useState(false)
  const [smartRewritePipelineStatus, setSmartRewritePipelineStatus] = useState('')
  const [smartRewritePipelineError, setSmartRewritePipelineError] = useState('')
  const [lastSmartRewritePipeline, setLastSmartRewritePipeline] = useState<LastSmartRewritePipeline | null>(null)

  // Multi Rewrite Queue (Phase14-L)
  const [isMultiRewriteQueueRunning, setIsMultiRewriteQueueRunning] = useState(false)
  const [multiRewriteQueueStatus, setMultiRewriteQueueStatus] = useState('')
  const [multiRewriteQueueError, setMultiRewriteQueueError] = useState('')
  const [lastMultiRewriteQueue, setLastMultiRewriteQueue] = useState<LastMultiRewriteQueue | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_SMART_PIPELINE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setLastSmartPipeline(parsed as LastSmartPipeline)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_SMART_REWRITE_PIPELINE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setLastSmartRewritePipeline(parsed as LastSmartRewritePipeline)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_MULTI_REWRITE_QUEUE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setLastMultiRewriteQueue(parsed as LastMultiRewriteQueue)
      }
    } catch {}
  }, [])

  const handleSmartPipeline = useCallback(async () => {
    if (isSmartPipelineRunning || isAutoPipelineRunning || isBatchRendering || isPreparingRender || renderStatus === 'running') return
    if (!aiTheme.trim()) return
    setIsSmartPipelineRunning(true)
    setSmartPipelineError('')
    try {
      // Step 1: AI Variant 生成
      setSmartPipelineStatus('AIバリアント生成中...')
      const genRes = await fetch('/api/variant-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: aiTheme.trim() }),
      })
      const genData = await genRes.json()
      if (!genData.ok) throw new Error(genData.message ?? 'Failed to generate variants')
      const variants: GeneratedVariant[] = genData.variants
      setGeneratedVariants(variants)
      generatedVariantsRef.current = variants
      try { localStorage.setItem(GENERATED_VARIANTS_KEY, JSON.stringify(variants)) } catch {}

      // Step 2: AI Score
      setSmartPipelineStatus('バリアントスコアリング中...')
      const scoreRes = await fetch('/api/score-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: aiTheme.trim(),
          variants,
          learningEvents: variantLearningEvents.slice(0, 50),
        }),
      })
      const scoreData = await scoreRes.json()
      if (!scoreData.ok) throw new Error(scoreData.message ?? 'Failed to score variants')
      const scores: VariantScore[] = scoreData.scores
      setVariantScores(scores)
      variantScoresRef.current = scores
      try { localStorage.setItem(VARIANT_SCORES_KEY, JSON.stringify(scores)) } catch {}

      // Step 3: Smart Queue 投入
      setSmartPipelineStatus('推奨バリアントをキューに追加中...')
      const recommended = scores.filter((s) => s.recommendation >= 4)
      const recommendedCount = recommended.length
      if (recommendedCount === 0) {
        setSmartPipelineStatus('比較ダッシュボード準備完了')
        setSmartPipelineError('おすすめ度4以上のVariantがありませんでした。Renderをスキップしました。')
        const data: LastSmartPipeline = {
          generatedCount: variants.length,
          recommendedCount: 0,
          renderedCount: 0,
          failedCount: 0,
          finishedAt: new Date().toISOString(),
        }
        try { localStorage.setItem(LAST_SMART_PIPELINE_KEY, JSON.stringify(data)) } catch {}
        setLastSmartPipeline(data)
        setTimeout(() => { compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 300)
        return
      }
      const targets = recommended.flatMap((score) => {
        const v = variants.find((v) => v.name === score.variantName || v.angle === score.angle)
        return v ? [v] : []
      })
      addVariantNamesToQueue(targets.map(v => v.name))
      // React の flush を待つ
      await new Promise<void>((resolve) => setTimeout(resolve, 200))

      // Step 4: Batch Render
      setSmartPipelineStatus('推奨バリアントのレンダリング中...')
      await batchRenderRef.current()

      // Step 5: Compare Dashboard
      setSmartPipelineStatus('比較ダッシュボード準備完了')
      const q = renderQueueRef.current
      const renderedCount = q.filter((item) => targets.some((t) => t.name === item.variantName) && item.status === 'completed').length
      const failedCount = q.filter((item) => targets.some((t) => t.name === item.variantName) && item.status === 'failed').length
      const data: LastSmartPipeline = {
        generatedCount: variants.length,
        recommendedCount,
        renderedCount,
        failedCount,
        finishedAt: new Date().toISOString(),
      }
      try { localStorage.setItem(LAST_SMART_PIPELINE_KEY, JSON.stringify(data)) } catch {}
      setLastSmartPipeline(data)
      setTimeout(() => { compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 300)
    } catch (err) {
      setSmartPipelineError(err instanceof Error ? err.message : 'スマートパイプライン失敗')
      setSmartPipelineStatus('スマートパイプライン失敗')
    } finally {
      setIsSmartPipelineRunning(false)
    }
  }, [isSmartPipelineRunning, isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, aiTheme, variantLearningEvents, setGeneratedVariants, generatedVariantsRef, setVariantScores, variantScoresRef, addVariantNamesToQueue, batchRenderRef, renderQueueRef, compareDashboardRef])

  const handleSmartRewritePipeline = useCallback(async () => {
    if (isSmartRewritePipelineRunning || isSmartPipelineRunning || isAutoPipelineRunning || isBatchRendering || isPreparingRender || renderStatus === 'running') return
    if (!aiTheme.trim()) return
    setIsSmartRewritePipelineRunning(true)
    setSmartRewritePipelineError('')
    try {
      // Step 1: AI Variant 生成
      setSmartRewritePipelineStatus('AIバリアント生成中...')
      const genRes = await fetch('/api/variant-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: aiTheme.trim() }),
      })
      const genData = await genRes.json()
      if (!genData.ok) throw new Error(genData.message ?? 'Failed to generate variants')
      const variants: GeneratedVariant[] = genData.variants
      setGeneratedVariants(variants)
      generatedVariantsRef.current = variants
      try { localStorage.setItem(GENERATED_VARIANTS_KEY, JSON.stringify(variants)) } catch {}

      // Step 2: Score
      setSmartRewritePipelineStatus('バリアントスコアリング中...')
      const scoreRes = await fetch('/api/score-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: aiTheme.trim(),
          variants,
          learningEvents: variantLearningEvents.slice(0, 50),
        }),
      })
      const scoreData = await scoreRes.json()
      if (!scoreData.ok) throw new Error(scoreData.message ?? 'Failed to score variants')
      const scores: VariantScore[] = scoreData.scores
      setVariantScores(scores)
      variantScoresRef.current = scores
      try { localStorage.setItem(VARIANT_SCORES_KEY, JSON.stringify(scores)) } catch {}

      // Step 3: Top Variant 選定
      setSmartRewritePipelineStatus('トップバリアントを選定中...')
      type ScoredWithVariant = VariantScore & { variant: GeneratedVariant }
      const scoredWithVariant: ScoredWithVariant[] = scores.flatMap((s) => {
        const v = variants.find((v) => v.name === s.variantName || v.angle === s.angle)
        return v ? [{ ...s, variant: v }] : []
      })
      const topScoredVariant = scoredWithVariant
        .filter((sv) => sv.recommendation >= 4)
        .sort((a, b) => {
          if (b.recommendation !== a.recommendation) return b.recommendation - a.recommendation
          if (b.predictedViews !== a.predictedViews) return b.predictedViews - a.predictedViews
          return b.savePotential - a.savePotential
        })[0]

      if (!topScoredVariant) {
        setSmartRewritePipelineStatus('スマートリライト完了')
        setSmartRewritePipelineError('おすすめ度4以上のVariantがありません')
        const data: LastSmartRewritePipeline = {
          selectedVariantName: '',
          selectedAngle: '',
          recommendation: 0,
          renderedCount: 0,
          failedCount: 0,
          finishedAt: new Date().toISOString(),
        }
        try { localStorage.setItem(LAST_SMART_REWRITE_PIPELINE_KEY, JSON.stringify(data)) } catch {}
        setLastSmartRewritePipeline(data)
        setTimeout(() => { compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 300)
        return
      }

      // Step 4: Rewrite Story
      setSmartRewritePipelineStatus('ストーリーをリライト中...')
      const rewriteRes = await fetch('/api/rewrite-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          angle: topScoredVariant.variant.angle,
          slides: slides.map((s) => ({ headline: s.headline, subline: s.subline, emphasis: s.emphasis })),
        }),
      })
      const rewriteData = await rewriteRes.json()
      if (!rewriteData.ok) throw new Error(rewriteData.message ?? 'ストーリーのリライトに失敗しました')
      const rewritten: RewrittenSlide[] = rewriteData.slides

      // Step 5: Apply rewritten story
      setSmartRewritePipelineStatus('リライトを適用中...')
      const mergedSlides: Slide[] = slides.map((s, i) => ({
        ...s,
        headline: rewritten[i]?.headline ?? s.headline,
        subline: rewritten[i]?.subline ?? s.subline,
        emphasis: rewritten[i]?.emphasis ?? s.emphasis,
      }))
      setSlides(mergedSlides)
      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Step 6: Queue投入（slidesSnapshot付き）
      setSmartRewritePipelineStatus('リライトバリアントをキューに追加中...')
      const rewriteVariantName = `${topScoredVariant.variant.name}（Rewrite）`
      addSnapshotItemToQueue(rewriteVariantName, mergedSlides)
      await new Promise<void>((resolve) => setTimeout(resolve, 200))

      // Step 7: Render
      setSmartRewritePipelineStatus('レンダリング中...')
      await batchRenderRef.current()

      // Step 8: Compare Dashboard
      setSmartRewritePipelineStatus('スマートリライト完了')
      const q = renderQueueRef.current
      const renderedCount = q.filter((item) => item.variantName === rewriteVariantName && item.status === 'completed').length
      const failedCount = q.filter((item) => item.variantName === rewriteVariantName && item.status === 'failed').length
      const data: LastSmartRewritePipeline = {
        selectedVariantName: topScoredVariant.variant.name,
        selectedAngle: topScoredVariant.variant.angle,
        recommendation: topScoredVariant.recommendation,
        renderedCount,
        failedCount,
        finishedAt: new Date().toISOString(),
      }
      try { localStorage.setItem(LAST_SMART_REWRITE_PIPELINE_KEY, JSON.stringify(data)) } catch {}
      setLastSmartRewritePipeline(data)
      setTimeout(() => { compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 300)
    } catch (err) {
      setSmartRewritePipelineError(err instanceof Error ? err.message : 'スマートリライト失敗')
      setSmartRewritePipelineStatus('スマートリライト失敗')
    } finally {
      setIsSmartRewritePipelineRunning(false)
    }
  }, [isSmartRewritePipelineRunning, isSmartPipelineRunning, isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, aiTheme, variantLearningEvents, slides, setGeneratedVariants, generatedVariantsRef, setVariantScores, variantScoresRef, setSlides, addSnapshotItemToQueue, batchRenderRef, renderQueueRef, compareDashboardRef])

  const handleMultiRewriteQueue = useCallback(async () => {
    if (isMultiRewriteQueueRunning || isSmartRewritePipelineRunning || isSmartPipelineRunning || isAutoPipelineRunning || isBatchRendering || isPreparingRender || renderStatus === 'running') return
    if (!aiTheme.trim()) return
    setIsMultiRewriteQueueRunning(true)
    setMultiRewriteQueueError('')
    try {
      // Step 1: AI Generate
      setMultiRewriteQueueStatus('AIバリアント生成中...')
      const genRes = await fetch('/api/variant-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: aiTheme.trim() }),
      })
      const genData = await genRes.json()
      if (!genData.ok) throw new Error(genData.message ?? 'Failed to generate variants')
      const variants: GeneratedVariant[] = genData.variants
      setGeneratedVariants(variants)
      generatedVariantsRef.current = variants
      try { localStorage.setItem(GENERATED_VARIANTS_KEY, JSON.stringify(variants)) } catch {}

      // Step 2: Score
      setMultiRewriteQueueStatus('バリアントスコアリング中...')
      const scoreRes = await fetch('/api/score-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: aiTheme.trim(),
          variants,
          learningEvents: variantLearningEvents.slice(0, 50),
        }),
      })
      const scoreData = await scoreRes.json()
      if (!scoreData.ok) throw new Error(scoreData.message ?? 'Failed to score variants')
      const scores: VariantScore[] = scoreData.scores
      setVariantScores(scores)
      variantScoresRef.current = scores
      try { localStorage.setItem(VARIANT_SCORES_KEY, JSON.stringify(scores)) } catch {}

      // Step 3: Select Top 3
      setMultiRewriteQueueStatus('トップバリアントを選定中...')
      type ScoredWithVariant = VariantScore & { variant: GeneratedVariant }
      const scoredWithVariant: ScoredWithVariant[] = scores.flatMap((s) => {
        const v = variants.find((v) => v.name === s.variantName || v.angle === s.angle)
        return v ? [{ ...s, variant: v }] : []
      })
      const targets = scoredWithVariant
        .filter((sv) => sv.recommendation >= 4)
        .sort((a, b) => {
          if (b.recommendation !== a.recommendation) return b.recommendation - a.recommendation
          if (b.predictedViews !== a.predictedViews) return b.predictedViews - a.predictedViews
          return b.savePotential - a.savePotential
        })
        .slice(0, 3)

      if (targets.length === 0) {
        setMultiRewriteQueueStatus('マルチリライトキュー完了')
        setMultiRewriteQueueError('おすすめ度4以上のVariantがありません')
        const data: LastMultiRewriteQueue = {
          rewrittenCount: 0,
          queuedCount: 0,
          renderedCount: 0,
          failedCount: 0,
          selectedVariants: [],
          finishedAt: new Date().toISOString(),
        }
        try { localStorage.setItem(LAST_MULTI_REWRITE_QUEUE_KEY, JSON.stringify(data)) } catch {}
        setLastMultiRewriteQueue(data)
        setTimeout(() => { compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 300)
        return
      }

      // Step 4: Rewrite each target (直列)
      setMultiRewriteQueueStatus('バリアントをリライト中...')
      const rewriteResults: { target: ScoredWithVariant; rewritten: RewrittenSlide[] }[] = []
      for (const target of targets) {
        const rewriteRes = await fetch('/api/rewrite-story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            angle: target.variant.angle,
            slides: slides.map((s) => ({ headline: s.headline, subline: s.subline, emphasis: s.emphasis })),
          }),
        })
        const rewriteData = await rewriteRes.json()
        if (!rewriteData.ok) throw new Error(rewriteData.message ?? `Failed to rewrite story for ${target.variant.name}`)
        rewriteResults.push({ target, rewritten: rewriteData.slides })
      }

      // Step 5: Apply first rewrite to editor
      setMultiRewriteQueueStatus('最初のリライトを適用中...')
      const firstRewrite = rewriteResults[0]
      if (firstRewrite) {
        const mergedSlides: Slide[] = slides.map((s, i) => ({
          ...s,
          headline: firstRewrite.rewritten[i]?.headline ?? s.headline,
          subline: firstRewrite.rewritten[i]?.subline ?? s.subline,
          emphasis: firstRewrite.rewritten[i]?.emphasis ?? s.emphasis,
        }))
        setSlides(mergedSlides)
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      }

      // Step 6: Queue rewritten variants（各Variant個別slidesSnapshot付き）
      setMultiRewriteQueueStatus('リライトバリアントをキューに投入中...')
      const rewriteQueueItems = rewriteResults.map((r) => ({
        variantName: `${r.target.variant.name}（Rewrite）`,
        snapshotSlides: slides.map((s, i) => ({
          ...s,
          headline: r.rewritten[i]?.headline ?? s.headline,
          subline: r.rewritten[i]?.subline ?? s.subline,
          emphasis: r.rewritten[i]?.emphasis ?? s.emphasis,
        })) as Slide[],
      }))
      const rewriteVariantNames = rewriteQueueItems.map((r) => r.variantName)
      addQueueItems(rewriteQueueItems.map(({ variantName, snapshotSlides }) => ({
        id: crypto.randomUUID(),
        variantName,
        status: 'pending' as const,
        slidesSnapshot: snapshotSlides,
        snapshotCreatedAt: new Date().toISOString(),
      })))
      await new Promise<void>((resolve) => setTimeout(resolve, 200))

      // Step 7: Batch Render
      setMultiRewriteQueueStatus('レンダリング中...')
      await batchRenderRef.current()

      // Step 8: Compare Dashboard
      setMultiRewriteQueueStatus('マルチリライトキュー完了')
      const q = renderQueueRef.current
      const renderedCount = q.filter((item) => rewriteVariantNames.includes(item.variantName) && item.status === 'completed').length
      const failedCount = q.filter((item) => rewriteVariantNames.includes(item.variantName) && item.status === 'failed').length
      const data: LastMultiRewriteQueue = {
        rewrittenCount: rewriteResults.length,
        queuedCount: rewriteVariantNames.length,
        renderedCount,
        failedCount,
        selectedVariants: targets.map((t) => t.variant.name),
        finishedAt: new Date().toISOString(),
      }
      try { localStorage.setItem(LAST_MULTI_REWRITE_QUEUE_KEY, JSON.stringify(data)) } catch {}
      setLastMultiRewriteQueue(data)
      setTimeout(() => { compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 300)
    } catch (err) {
      setMultiRewriteQueueError(err instanceof Error ? err.message : 'マルチリライトキュー失敗')
      setMultiRewriteQueueStatus('マルチリライトキュー失敗')
    } finally {
      setIsMultiRewriteQueueRunning(false)
    }
  }, [isMultiRewriteQueueRunning, isSmartRewritePipelineRunning, isSmartPipelineRunning, isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, aiTheme, variantLearningEvents, slides, setGeneratedVariants, generatedVariantsRef, setVariantScores, variantScoresRef, setSlides, addQueueItems, batchRenderRef, renderQueueRef, compareDashboardRef])

  return {
    isSmartPipelineRunning,
    smartPipelineStatus,
    smartPipelineError,
    lastSmartPipeline,
    isSmartRewritePipelineRunning,
    smartRewritePipelineStatus,
    smartRewritePipelineError,
    lastSmartRewritePipeline,
    isMultiRewriteQueueRunning,
    multiRewriteQueueStatus,
    multiRewriteQueueError,
    lastMultiRewriteQueue,
    handleSmartPipeline,
    handleSmartRewritePipeline,
    handleMultiRewriteQueue,
  }
}
