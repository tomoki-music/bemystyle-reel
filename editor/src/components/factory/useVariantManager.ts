import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type React from 'react'
import type { Slide } from '../../types'

// ==============================
// Types
// ==============================

export type GeneratedVariant = {
  name: string
  description: string
  angle: string
}

export type VariantScore = {
  variantName: string
  angle: string
  recommendation: number
  predictedViews: number
  savePotential: number
  ctaStrength: number
  reason: string
}

export type VariantLearningEvent = {
  id: string
  theme: string
  variantName: string
  angle: string
  action: 'applied' | 'selected_best'
  createdAt: string
}

export type RewrittenStoryMap = Record<string, Slide[]>

export type VariantLearningSummary = {
  totalEvents: number
  appliedCount: number
  selectedBestCount: number
  topAngles: { angle: string; count: number }[]
  topVariantNames: { name: string; count: number }[]
  recentEvents: VariantLearningEvent[]
}

type RewrittenSlide = {
  headline: string
  subline?: string
  emphasis?: string
}

// ==============================
// Constants
// ==============================

export const GENERATED_VARIANTS_KEY = 'bemystyle-reel-generated-variants'
export const REWRITTEN_STORIES_KEY = 'bemystyle-reel-rewritten-stories'
export const VARIANT_LEARNING_EVENTS_KEY = 'bemystyle-reel-variant-learning-events'
export const VARIANT_SCORES_KEY = 'bemystyle-reel-variant-scores'

export const AUTO_VARIANT_TEMPLATES = [
  'Default',
  'CTA強め版',
  '感情訴求版',
  '教育版',
  'ストーリー版',
  'YouTube版',
  'Instagram版',
]

// ==============================
// Hook
// ==============================

export type UseVariantManagerProps = {
  aiTheme: string
  slides: Slide[]
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  addVariantNameToQueue: (name: string) => void
  addVariantNamesToQueue: (names: string[]) => { added: number; skipped: number }
}

export function useVariantManager({
  aiTheme,
  slides,
  setSlides,
  addVariantNameToQueue,
  addVariantNamesToQueue,
}: UseVariantManagerProps) {
  // --- State ---
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([])
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false)
  const [variantGenerateError, setVariantGenerateError] = useState('')

  const [variantScores, setVariantScores] = useState<VariantScore[]>([])
  const [isScoringVariants, setIsScoringVariants] = useState(false)
  const [variantScoreError, setVariantScoreError] = useState('')

  const [rewrittenStories, setRewrittenStories] = useState<RewrittenStoryMap>({})
  const [isRewritingStory, setIsRewritingStory] = useState<Record<string, boolean>>({})
  const [rewriteStoryError, setRewriteStoryError] = useState<Record<string, string>>({})

  const [variantLearningEvents, setVariantLearningEvents] = useState<VariantLearningEvent[]>([])

  const [autoGenerateNotice, setAutoGenerateNotice] = useState('')
  const [smartQueueMessage, setSmartQueueMessage] = useState('')

  // --- Refs (exposed for smart pipeline interop) ---
  const generatedVariantsRef = useRef<GeneratedVariant[]>([])
  const variantScoresRef = useRef<VariantScore[]>([])
  generatedVariantsRef.current = generatedVariants
  variantScoresRef.current = variantScores

  // --- localStorage read effects ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GENERATED_VARIANTS_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) setGeneratedVariants(parsed as GeneratedVariant[])
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REWRITTEN_STORIES_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setRewrittenStories(parsed as RewrittenStoryMap)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VARIANT_LEARNING_EVENTS_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) setVariantLearningEvents(parsed as VariantLearningEvent[])
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VARIANT_SCORES_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) setVariantScores(parsed as VariantScore[])
    } catch {}
  }, [])

  // --- Callbacks ---

  const generateAIVariants = useCallback(async () => {
    if (!aiTheme.trim()) return
    setIsGeneratingVariants(true)
    setVariantGenerateError('')
    try {
      const res = await fetch('/api/variant-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: aiTheme.trim() }),
      })
      const data = await res.json()
      if (!data.ok) {
        setVariantGenerateError(data.message ?? 'Failed to generate variants')
        return
      }
      const variants: GeneratedVariant[] = data.variants
      setGeneratedVariants(variants)
      try { localStorage.setItem(GENERATED_VARIANTS_KEY, JSON.stringify(variants)) } catch {}
    } catch {
      setVariantGenerateError('Failed to generate variants')
    } finally {
      setIsGeneratingVariants(false)
    }
  }, [aiTheme])

  const autoGenerateVariants = useCallback(() => {
    const { added, skipped } = addVariantNamesToQueue(AUTO_VARIANT_TEMPLATES)
    setTimeout(() => {
      setAutoGenerateNotice(
        skipped > 0
          ? `${added}件追加しました（${skipped}件は既に存在します）`
          : `${added}件追加しました`
      )
      setTimeout(() => setAutoGenerateNotice(''), 4000)
    }, 0)
  }, [addVariantNamesToQueue])

  const scoreVariants = useCallback(async () => {
    if (!aiTheme.trim() || generatedVariants.length === 0) return
    setIsScoringVariants(true)
    setVariantScoreError('')
    try {
      const res = await fetch('/api/score-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: aiTheme.trim(),
          variants: generatedVariants,
          learningEvents: variantLearningEvents.slice(0, 50),
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        setVariantScoreError(data.message ?? 'Failed to score variants')
        return
      }
      const scores: VariantScore[] = data.scores
      setVariantScores(scores)
      try { localStorage.setItem(VARIANT_SCORES_KEY, JSON.stringify(scores)) } catch {}
    } catch {
      setVariantScoreError('Failed to score variants')
    } finally {
      setIsScoringVariants(false)
    }
  }, [aiTheme, generatedVariants, variantLearningEvents])

  const recordLearningEvent = useCallback((event: Omit<VariantLearningEvent, 'id' | 'createdAt'>) => {
    const full: VariantLearningEvent = { ...event, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    setVariantLearningEvents((prev) => {
      const next = [full, ...prev]
      try { localStorage.setItem(VARIANT_LEARNING_EVENTS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const clearLearningData = useCallback(() => {
    setVariantLearningEvents([])
    try { localStorage.removeItem(VARIANT_LEARNING_EVENTS_KEY) } catch {}
  }, [])

  const rewriteStory = useCallback(async (angle: string) => {
    if (slides.length === 0) return
    setIsRewritingStory((prev) => ({ ...prev, [angle]: true }))
    setRewriteStoryError((prev) => ({ ...prev, [angle]: '' }))
    try {
      const res = await fetch('/api/rewrite-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          angle,
          slides: slides.map((s) => ({ headline: s.headline, subline: s.subline, emphasis: s.emphasis })),
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        setRewriteStoryError((prev) => ({ ...prev, [angle]: data.message ?? 'ストーリーのリライトに失敗しました' }))
        return
      }
      const rewritten: RewrittenSlide[] = data.slides
      const merged: Slide[] = slides.map((s, i) => ({
        ...s,
        headline: rewritten[i]?.headline ?? s.headline,
        subline: rewritten[i]?.subline ?? s.subline,
        emphasis: rewritten[i]?.emphasis ?? s.emphasis,
      }))
      setRewrittenStories((prev) => {
        const next = { ...prev, [angle]: merged }
        try { localStorage.setItem(REWRITTEN_STORIES_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    } catch {
      setRewriteStoryError((prev) => ({ ...prev, [angle]: 'ストーリーのリライトに失敗しました' }))
    } finally {
      setIsRewritingStory((prev) => ({ ...prev, [angle]: false }))
    }
  }, [slides])

  const applyRewrittenStory = useCallback((angle: string) => {
    const rewritten = rewrittenStories[angle]
    if (!rewritten) return
    const merged: Slide[] = slides.map((s, i) => {
      const r = rewritten[i]
      if (!r) return s
      return { ...s, headline: r.headline, subline: r.subline, emphasis: r.emphasis }
    })
    setSlides(merged)
    const variantName = generatedVariants.find((v) => v.angle === angle)?.name ?? angle
    recordLearningEvent({ theme: aiTheme, variantName, angle, action: 'applied' })
  }, [rewrittenStories, slides, generatedVariants, aiTheme, recordLearningEvent, setSlides])

  const addVariantToQueue = useCallback((variantName: string) => {
    addVariantNameToQueue(variantName)
  }, [addVariantNameToQueue])

  const addAllVariantsToQueue = useCallback(() => {
    addVariantNamesToQueue(generatedVariants.map(v => v.name))
  }, [generatedVariants, addVariantNamesToQueue])

  const addSmartQueue = useCallback(() => {
    const recommended = variantScores.filter((s) => s.recommendation >= 4)
    if (recommended.length === 0) {
      setSmartQueueMessage('おすすめ度4以上のVariantがありません')
      return
    }
    const targets = recommended.flatMap((score) => {
      const v = generatedVariants.find(
        (v) => v.name === score.variantName || v.angle === score.angle
      )
      return v ? [v] : []
    })
    const { added: addedCount, skipped: skippedCount } = addVariantNamesToQueue(targets.map(v => v.name))
    if (addedCount === 0) {
      setSmartQueueMessage(`全${targets.length}件は既にQueueにあります`)
    } else if (skippedCount > 0) {
      setSmartQueueMessage(`${addedCount}件追加しました / ${skippedCount}件は既にQueueにあります`)
    } else {
      setSmartQueueMessage(`${addedCount}件をSmart Queueに追加しました`)
    }
  }, [variantScores, generatedVariants, addVariantNamesToQueue])

  // --- useMemo ---

  const variantLearningSummary = useMemo<VariantLearningSummary>(() => {
    const totalEvents = variantLearningEvents.length
    const appliedCount = variantLearningEvents.filter((e) => e.action === 'applied').length
    const selectedBestCount = variantLearningEvents.filter((e) => e.action === 'selected_best').length

    const angleCounts: Record<string, number> = {}
    for (const e of variantLearningEvents) {
      if (e.angle !== 'unknown') angleCounts[e.angle] = (angleCounts[e.angle] ?? 0) + 1
    }
    const topAngles = Object.entries(angleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([angle, count]) => ({ angle, count }))

    const variantCounts: Record<string, number> = {}
    for (const e of variantLearningEvents) {
      variantCounts[e.variantName] = (variantCounts[e.variantName] ?? 0) + 1
    }
    const topVariantNames = Object.entries(variantCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))

    const recentEvents = variantLearningEvents.slice(0, 5)

    return { totalEvents, appliedCount, selectedBestCount, topAngles, topVariantNames, recentEvents }
  }, [variantLearningEvents])

  return {
    // state
    generatedVariants,
    isGeneratingVariants,
    variantGenerateError,
    variantScores,
    isScoringVariants,
    variantScoreError,
    rewrittenStories,
    isRewritingStory,
    rewriteStoryError,
    variantLearningEvents,
    autoGenerateNotice,
    smartQueueMessage,
    variantLearningSummary,
    // actions
    generateAIVariants,
    autoGenerateVariants,
    scoreVariants,
    rewriteStory,
    applyRewrittenStory,
    recordLearningEvent,
    clearLearningData,
    addVariantToQueue,
    addAllVariantsToQueue,
    addSmartQueue,
    // exposed for smart pipeline interop (useFactoryPipeline + handleSmartPipeline etc.)
    setGeneratedVariants,
    setVariantScores,
    generatedVariantsRef,
    variantScoresRef,
  }
}
