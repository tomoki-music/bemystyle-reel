import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Slide } from '../../types'
import type { RenderQueueItem } from '../renderQueue/useRenderQueue'

const BEST_VARIANT_KEY = 'bemystyle-reel-best-variant'
const BEST_VARIANT_ANALYSIS_KEY = 'bemystyle-reel-best-variant-analysis'
const REWRITE_EXPLAIN_CACHE_KEY = 'bemystyle-reel-rewrite-explain-cache'
const AUTO_ANALYZE_ON_BEST_SELECT = false

type GeneratedVariant = {
  name: string
  description: string
  angle: string
}

type VariantLearningEvent = {
  id: string
  theme: string
  variantName: string
  angle: string
  action: 'applied' | 'selected_best'
  createdAt: string
}

type VariantScore = {
  variantName: string
  angle: string
  recommendation: number
  predictedViews: number
  savePotential: number
  ctaStrength: number
  reason: string
}

export type BestVariantAnalysis = {
  strengths: string[]
  weaknesses: string[]
  bestFor: string[]
  nextActions: string[]
  summary: string
}

export type RewriteExplainResult = {
  summary: string
  reasons: string[]
  improvedPoints: string[]
  risks: string[]
  nextSuggestions: string[]
}

type UseCompareDashboardOptions = {
  renderQueue: RenderQueueItem[]
  generatedVariants: GeneratedVariant[]
  variantScores: VariantScore[]
  variantLearningEvents: VariantLearningEvent[]
  aiTheme: string
  slides: Slide[]
  recordLearningEvent: (event: Omit<VariantLearningEvent, 'id' | 'createdAt'>) => void
}

function loadBestVariantId(): string {
  try {
    return localStorage.getItem(BEST_VARIANT_KEY) ?? ''
  } catch {
    return ''
  }
}

function loadBestVariantAnalysis(): BestVariantAnalysis | null {
  try {
    const raw = localStorage.getItem(BEST_VARIANT_ANALYSIS_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as BestVariantAnalysis
      : null
  } catch {
    return null
  }
}

function loadRewriteExplainResults(): Record<string, RewriteExplainResult> {
  try {
    const raw = localStorage.getItem(REWRITE_EXPLAIN_CACHE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, RewriteExplainResult>
      : {}
  } catch {
    console.warn('[Phase14-S] rewrite explain cache parse failed')
    return {}
  }
}

export function useCompareDashboard({
  renderQueue,
  generatedVariants,
  variantScores,
  variantLearningEvents,
  aiTheme,
  slides,
  recordLearningEvent,
}: UseCompareDashboardOptions) {
  const [bestVariantId, setBestVariantId] = useState(loadBestVariantId)
  const [bestVariantAnalysis, setBestVariantAnalysis] = useState<BestVariantAnalysis | null>(loadBestVariantAnalysis)
  const [isAnalyzingBestVariant, setIsAnalyzingBestVariant] = useState(false)
  const [bestVariantAnalysisError, setBestVariantAnalysisError] = useState('')
  const [expandedSnapshotIds, setExpandedSnapshotIds] = useState<string[]>([])
  const [expandedDiffIds, setExpandedDiffIds] = useState<string[]>([])
  const [rewriteExplainResults, setRewriteExplainResults] = useState<Record<string, RewriteExplainResult>>(loadRewriteExplainResults)
  const [rewriteExplainLoadingIds, setRewriteExplainLoadingIds] = useState<string[]>([])
  const [rewriteExplainErrors, setRewriteExplainErrors] = useState<Record<string, string>>({})

  const explainRewrite = useCallback(async (item: RenderQueueItem, opts?: { force?: boolean }) => {
    if (!item.slidesSnapshot || item.slidesSnapshot.length === 0) return
    if (rewriteExplainLoadingIds.includes(item.id)) return
    if (!opts?.force && rewriteExplainResults[item.id]) return
    setRewriteExplainLoadingIds(prev => [...prev, item.id])
    setRewriteExplainErrors(prev => { const n = { ...prev }; delete n[item.id]; return n })
    const score = variantScores.find(s => s.variantName === item.variantName)
    try {
      const res = await fetch('/api/explain-rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beforeSlides: slides,
          afterSlides: item.slidesSnapshot,
          variantName: item.variantName,
          score: score ? {
            recommendation: score.recommendation,
            predictedViews: score.predictedViews,
            savePotential: score.savePotential,
            ctaStrength: score.ctaStrength,
          } : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setRewriteExplainErrors(prev => ({ ...prev, [item.id]: data.message ?? 'リライト分析に失敗しました。' }))
        return
      }
      setRewriteExplainResults(prev => {
        const next = { ...prev, [item.id]: data.result }
        try { localStorage.setItem(REWRITE_EXPLAIN_CACHE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    } catch {
      setRewriteExplainErrors(prev => ({ ...prev, [item.id]: 'リライト分析に失敗しました。' }))
    } finally {
      setRewriteExplainLoadingIds(prev => prev.filter(x => x !== item.id))
    }
  }, [slides, variantScores, rewriteExplainLoadingIds, rewriteExplainResults])

  const explainRewriteFromPanel = useCallback((item: RenderQueueItem) => {
    explainRewrite(item, rewriteExplainResults[item.id] ? { force: true } : undefined)
  }, [explainRewrite, rewriteExplainResults])

  const selectBestVariant = useCallback((id: string) => {
    setBestVariantId(id)
    try { localStorage.setItem(BEST_VARIANT_KEY, id) } catch {}
    const item = renderQueue.find((q) => q.id === id)
    if (item) {
      const angle = generatedVariants.find((v) => v.name === item.variantName)?.angle ?? 'unknown'
      recordLearningEvent({ theme: aiTheme, variantName: item.variantName, angle, action: 'selected_best' })
      if (item.slidesSnapshot && item.slidesSnapshot.length > 0) {
        setExpandedDiffIds(prev => prev.includes(id) ? prev : [...prev, id])
        explainRewrite(item)
      }
    }
  }, [renderQueue, generatedVariants, aiTheme, recordLearningEvent, explainRewrite])

  const toggleSnapshotPreview = useCallback((id: string) => {
    setExpandedSnapshotIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const ensureSnapshotExpanded = useCallback((id: string) => {
    setExpandedSnapshotIds((prev) =>
      prev.includes(id) ? prev : [...prev, id]
    )
  }, [])

  const toggleDiffView = useCallback((id: string) => {
    setExpandedDiffIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const analyzeBestVariant = useCallback(async () => {
    if (!bestVariantId || isAnalyzingBestVariant) return
    const bestQueueItem = renderQueue.find((q) => q.id === bestVariantId)
    if (!bestQueueItem) return
    const variant = generatedVariants.find((v) => v.name === bestQueueItem.variantName)
    const score = variantScores.find(
      (s) => s.variantName === bestQueueItem.variantName || (variant && s.angle === variant.angle)
    )
    setIsAnalyzingBestVariant(true)
    setBestVariantAnalysisError('')
    try {
      const res = await fetch('/api/analyze-best-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: aiTheme.trim(),
          bestVariant: { name: bestQueueItem.variantName, angle: variant?.angle ?? 'unknown' },
          score: score
            ? {
                recommendation: score.recommendation,
                predictedViews: score.predictedViews,
                savePotential: score.savePotential,
                ctaStrength: score.ctaStrength,
              }
            : null,
          learningSummary: {
            topAngles: (() => {
              const counts: Record<string, number> = {}
              for (const e of variantLearningEvents) {
                if (e.angle && e.angle !== 'unknown') counts[e.angle] = (counts[e.angle] ?? 0) + 1
              }
              return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([angle, count]) => ({ angle, count }))
            })(),
          },
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? 'ベストバリアント分析に失敗しました')
      const analysis: BestVariantAnalysis = data.analysis
      setBestVariantAnalysis(analysis)
      try { localStorage.setItem(BEST_VARIANT_ANALYSIS_KEY, JSON.stringify(analysis)) } catch {}
    } catch (err) {
      setBestVariantAnalysisError(err instanceof Error ? err.message : 'ベストバリアント分析に失敗しました')
    } finally {
      setIsAnalyzingBestVariant(false)
    }
  }, [bestVariantId, isAnalyzingBestVariant, renderQueue, generatedVariants, variantScores, aiTheme, variantLearningEvents])

  useEffect(() => {
    if (!AUTO_ANALYZE_ON_BEST_SELECT) return
    if (bestVariantId) analyzeBestVariant()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestVariantId])

  const actions = useMemo(() => ({
    selectBestVariant,
    analyzeBestVariant,
    toggleSnapshotPreview,
    toggleDiffView,
    explainRewrite: explainRewriteFromPanel,
    ensureSnapshotExpanded,
  }), [selectBestVariant, analyzeBestVariant, toggleSnapshotPreview, toggleDiffView, explainRewriteFromPanel, ensureSnapshotExpanded])

  return {
    bestVariantId,
    bestVariantAnalysis,
    isAnalyzingBestVariant,
    bestVariantAnalysisError,
    expandedSnapshotIds,
    expandedDiffIds,
    rewriteExplainResults,
    rewriteExplainLoadingIds,
    rewriteExplainErrors,
    explainRewrite,
    explainRewriteFromPanel,
    selectBestVariant,
    analyzeBestVariant,
    toggleSnapshotPreview,
    toggleDiffView,
    ensureSnapshotExpanded,
    actions,
  }
}
