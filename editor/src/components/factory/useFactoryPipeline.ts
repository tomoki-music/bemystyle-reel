import { useState, useCallback, useEffect } from 'react'
import type React from 'react'
import type { Slide, ReelAiConfig, SimpleTemplateType } from '../../types'
import { generateStory, type AIPresetKey, type CustomPreset } from '../../storyGenerator'
import type { RenderQueueItem } from '../renderQueue/useRenderQueue'
import type { GeneratedVariant, VariantScore, VariantLearningEvent } from './useVariantManager'

// ==============================
// Types
// ==============================
export type LastPipeline = {
  completedCount: number
  failedCount: number
  finishedAt: string
}

export type FactorySummary = {
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

export type FactoryHistoryItem = FactorySummary & {
  id: string
  theme: string
  favorite?: boolean
  tags?: string[]
}

type RewrittenSlide = {
  headline: string
  subline?: string
  emphasis?: string
}

// ==============================
// Constants
// ==============================
export const LAST_PIPELINE_KEY = 'bemystyle-reel-last-pipeline'
export const FACTORY_SUMMARY_CACHE_KEY = 'bemystyle-reel-factory-summary-cache'
export const FACTORY_HISTORY_KEY = 'bemystyle-reel-factory-history'
export const IMAGE_CACHE_KEY = 'reel-image-cache-v1'
export const IMAGE_CACHE_META_KEY = 'reel-image-cache-meta-v1'
export const MAX_HISTORY_THEME_LENGTH = 80
export const FACTORY_QUICK_TAGS = ['音楽', '成長', '習慣', 'AI', 'コミュニティ', '歌唱診断']

// ==============================
// Utilities
// ==============================
const FACTORY_TAG_RULES: { tag: string; keywords: string[] }[] = [
  { tag: '音楽',     keywords: ['音楽', '歌', '演奏', 'バンド', 'ライブ', 'セッション'] },
  { tag: '成長',     keywords: ['成長', '挑戦', '努力', '練習', '上達', 'レベルアップ'] },
  { tag: '習慣',     keywords: ['習慣', '継続', '毎日', '積み重ね', 'ルーティン'] },
  { tag: 'AI',       keywords: ['ai', 'AI', '人工知能', '自動化'] },
  { tag: 'コミュニティ', keywords: ['コミュニティ', '仲間', '居場所', 'サークル', 'つながり'] },
  { tag: '歌唱診断', keywords: ['歌唱診断', 'ボーカル', 'ミックスボイス', '発声', '歌声'] },
]

export const inferFactoryTags = (theme: string): string[] => {
  const text = theme.toLowerCase()
  return FACTORY_TAG_RULES
    .filter(rule => rule.keywords.some(kw => text.includes(kw.toLowerCase())))
    .map(rule => rule.tag)
    .slice(0, 8)
}

export const escapeCsvValue = (value: unknown): string => {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export const isFactoryHistoryItem = (value: unknown): value is FactoryHistoryItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const item = value as Partial<FactoryHistoryItem>

  if (
    typeof item.id !== 'string' ||
    typeof item.theme !== 'string' ||
    typeof item.generatedAt !== 'string' ||
    typeof item.generatedCount !== 'number' ||
    typeof item.selectedCount !== 'number' ||
    typeof item.averageRecommendation !== 'number' ||
    typeof item.bestVariantName !== 'string' ||
    typeof item.bestRecommendation !== 'number' ||
    typeof item.queueAddedCount !== 'number' ||
    !Array.isArray(item.topVariants)
  ) return false

  if (!item.topVariants.every(v =>
    v && typeof v === 'object' &&
    typeof (v as Record<string, unknown>).name === 'string' &&
    typeof (v as Record<string, unknown>).recommendation === 'number'
  )) return false

  if (item.tags !== undefined && !Array.isArray(item.tags)) return false
  if (Array.isArray(item.tags) && !item.tags.every(t => typeof t === 'string')) return false
  if (item.favorite !== undefined && typeof item.favorite !== 'boolean') return false

  return true
}

export const shouldConfirmCostlyAiRun = ({
  reelAiConfig,
  imageCount,
  useUploadedImages,
}: {
  reelAiConfig: ReelAiConfig
  imageCount: number
  useUploadedImages: boolean
}) => {
  return (
    reelAiConfig.aiMode === 'real' &&
    !reelAiConfig.dryRun &&
    !reelAiConfig.testImageLimit &&
    !useUploadedImages &&
    imageCount >= 6
  )
}

export const buildCostConfirmMessage = (imageCount: number) =>
  `OpenAI APIを使用してAI画像を${imageCount}枚生成します。\n利用枠を消費しますが、実行しますか？`

const makePlaceholderDataUrl = (slideNum: number): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#1a1a1a"/><text x="540" y="490" fill="#666" font-size="72" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">Slide ${slideNum}</text><text x="540" y="590" fill="#444" font-size="36" font-family="sans-serif" text-anchor="middle">🧪 TEST MODE</text></svg>`
  )}`

// ==============================
// Hook
// ==============================
type UserUploadedImage = { id: string; name: string; url: string }

export type UseFactoryPipelineProps = {
  aiTheme: string
  setAiTheme: (theme: string) => void
  slides: Slide[]
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  setHasUnsavedChanges: (v: boolean) => void
  selectedPresetKey: AIPresetKey | ''
  selectedCustomPresetId: string | null
  customPresets: CustomPreset[]
  imageSourceMode: 'ai' | 'upload'
  costMode: 'normal' | 'save'
  effectiveQuality: string
  reelAiConfig: ReelAiConfig
  reuseImageMode: boolean
  simpleMode: boolean
  simpleTemplateType: SimpleTemplateType | null
  variantLearningEvents: VariantLearningEvent[]
  setGeneratedVariants: React.Dispatch<React.SetStateAction<GeneratedVariant[]>>
  setVariantScores: React.Dispatch<React.SetStateAction<VariantScore[]>>
  variantScoresRef: React.MutableRefObject<VariantScore[]>
  generatedVariantsRef: React.MutableRefObject<GeneratedVariant[]>
  renderQueue: RenderQueueItem[]
  renderQueueRef: React.MutableRefObject<RenderQueueItem[]>
  addQueueItems: (items: RenderQueueItem[]) => RenderQueueItem[]
  isBatchRendering: boolean
  isPreparingRender: boolean
  renderStatus: string
  batchRenderRef: React.MutableRefObject<(itemIds?: string[]) => Promise<void>>
  compareDashboardRef: React.MutableRefObject<HTMLDivElement | null>
  autoGenerateVariants: () => void
  setCachedImagesForTemplate: (images: string[]) => void
  setCachedImagesForTemplateSavedAt: (date: string | null) => void
  userUploadedImagesRef: React.MutableRefObject<UserUploadedImage[]>
  setQuotaError: (v: boolean) => void
  ensureSnapshotExpanded: (id: string) => void
  testMode: boolean
}

export function useFactoryPipeline({
  aiTheme,
  setAiTheme,
  slides,
  setSlides,
  setHasUnsavedChanges,
  selectedPresetKey,
  selectedCustomPresetId,
  customPresets,
  imageSourceMode,
  costMode,
  effectiveQuality,
  reelAiConfig,
  reuseImageMode,
  simpleMode,
  simpleTemplateType,
  variantLearningEvents,
  setGeneratedVariants,
  setVariantScores,
  variantScoresRef,
  generatedVariantsRef,
  renderQueue,
  renderQueueRef,
  addQueueItems,
  isBatchRendering,
  isPreparingRender,
  renderStatus,
  batchRenderRef,
  compareDashboardRef,
  autoGenerateVariants,
  setCachedImagesForTemplate,
  setCachedImagesForTemplateSavedAt,
  userUploadedImagesRef,
  setQuotaError,
  ensureSnapshotExpanded,
  testMode,
}: UseFactoryPipelineProps) {
  // Auto Render Pipeline (Phase14-C)
  const [isAutoPipelineRunning, setIsAutoPipelineRunning] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState('')
  const [lastPipeline, setLastPipeline] = useState<LastPipeline | null>(null)

  // AI Reel Factory (Phase15-A / Phase15-B)
  const [factoryRunning, setFactoryRunning] = useState(false)
  const [factoryStep, setFactoryStep] = useState('')
  const [factoryError, setFactoryError] = useState('')
  const [factoryLog, setFactoryLog] = useState<string[]>([])
  const [factoryCurrentImageIndex, setFactoryCurrentImageIndex] = useState<number | null>(null)
  const [factoryTotalImageCount, setFactoryTotalImageCount] = useState<number | null>(null)
  const [factorySummary, setFactorySummary] = useState<FactorySummary | null>(null)
  const [factoryHistory, setFactoryHistory] = useState<FactoryHistoryItem[]>([])
  const [factoryNotice, setFactoryNotice] = useState('')
  const [factoryWarning, setFactoryWarning] = useState('')

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_PIPELINE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setLastPipeline(parsed as LastPipeline)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FACTORY_SUMMARY_CACHE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setFactorySummary(parsed as FactorySummary)
      }
    } catch {
      console.warn('[Phase15-C] factory summary cache parse failed')
    }
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FACTORY_HISTORY_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setFactoryHistory((parsed as FactoryHistoryItem[]).slice(0, 20))
      }
    } catch {
      console.warn('[Phase15-E] factory history parse failed')
    }
  }, [])

  // ==============================
  // Auto Render Pipeline
  // ==============================
  const handleAutoRenderPipeline = useCallback(async () => {
    if (isAutoPipelineRunning || isBatchRendering || isPreparingRender || renderStatus === 'running') return
    setIsAutoPipelineRunning(true)
    setPipelineStatus('バリアント生成中...')
    try {
      autoGenerateVariants()
      // Wait for React to flush the setRenderQueue update so batchRenderRef picks up new items
      await new Promise<void>((resolve) => setTimeout(resolve, 200))
      setPipelineStatus('バリアントレンダリング中...')
      await batchRenderRef.current()
      setPipelineStatus('比較ダッシュボード準備完了')
      const q = renderQueueRef.current
      const completedCount = q.filter((item) => item.status === 'completed').length
      const failedCount = q.filter((item) => item.status === 'failed').length
      const data: LastPipeline = { completedCount, failedCount, finishedAt: new Date().toISOString() }
      try { localStorage.setItem(LAST_PIPELINE_KEY, JSON.stringify(data)) } catch {}
      setLastPipeline(data)
      setTimeout(() => {
        compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 300)
    } catch {
      setPipelineStatus('パイプライン失敗')
    } finally {
      setIsAutoPipelineRunning(false)
    }
  }, [isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, autoGenerateVariants, batchRenderRef, renderQueueRef, compareDashboardRef])

  // ==============================
  // Factory Summary helpers
  // ==============================
  const findFactoryQueueItem = useCallback((variantName: string) => {
    return renderQueue.find(
      (item) =>
        item.variantName === `${variantName}（Rewrite）` ||
        item.variantName === variantName
    )
  }, [renderQueue])

  const handleJumpToQueueItem = useCallback((variantName: string) => {
    const item = findFactoryQueueItem(variantName)
    if (!item) return
    ensureSnapshotExpanded(item.id)
    requestAnimationFrame(() => {
      document
        .getElementById(`render-queue-item-${item.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [findFactoryQueueItem, ensureSnapshotExpanded])

  const clearFactorySummary = useCallback(() => {
    setFactorySummary(null)
    localStorage.removeItem(FACTORY_SUMMARY_CACHE_KEY)
  }, [])

  // ==============================
  // AI Reel Factory
  // ==============================
  const handleRunReelFactory = useCallback(async (overrideTheme?: string) => {
    const themeForRun = (overrideTheme ?? aiTheme).trim()
    if (factoryRunning || !themeForRun) {
      if (!themeForRun) setFactoryError('テーマを入力してください')
      return
    }
    if (imageSourceMode === 'upload' && userUploadedImagesRef.current.length === 0) {
      setFactoryError('自分の画像を使う場合は、画像を1枚以上アップロードしてください。')
      return
    }
    const useUploadedImages = imageSourceMode === 'upload'
    const estimatedImageCount = costMode === 'save' ? Math.min(5, slides.length) : Math.min(14, slides.length)
    if (!testMode && shouldConfirmCostlyAiRun({ reelAiConfig, imageCount: estimatedImageCount, useUploadedImages })) {
      const confirmed = window.confirm(buildCostConfirmMessage(estimatedImageCount))
      if (!confirmed) {
        setFactoryLog(['高コスト実行をキャンセルしました'])
        return
      }
    }
    setFactoryRunning(true)
    setFactoryError('')
    setFactoryLog([])
    setFactoryWarning('')

    const addLog = (msg: string) => setFactoryLog((prev) => [...prev, msg])

    try {
      // Step 1: Story Generate
      setFactoryStep('Step 1/7: ストーリー生成中...')
      addLog('[1/7] Story Generate 開始')
      const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId)
      const story = await generateStory(
        { theme: themeForRun, sourceType: 'theme' },
        selectedPresetKey,
        selectedCustomPreset
          ? {
              tone: selectedCustomPreset.tone,
              targetAudience: selectedCustomPreset.targetAudience,
              platform: selectedCustomPreset.platform,
              imageStyle: selectedCustomPreset.imageStyle,
              ctaText: selectedCustomPreset.ctaText,
          }
          : null
      )
      if (story.warning) addLog(`⚠️ ${story.warning}`)
      const storySlides: Slide[] = slides.map((slide, index) => {
        const generated = story.slides[index]
        if (!generated) return slide
        return {
          ...slide,
          headline: generated.headline,
          subline: generated.subline ?? slide.subline,
          emphasis: generated.emphasis ?? slide.emphasis,
          imagePrompt: generated.imagePrompt ?? slide.imagePrompt,
        }
      })
      setSlides(storySlides)
      setHasUnsavedChanges(true)
      addLog(`[1/7] Story生成完了 (${storySlides.length}スライド)`)

      if (storySlides.length > 14) {
        setFactoryWarning('⚠️ ストーリーが15枚以上生成されたため、先頭14枚に調整して続行しました。')
      } else if (storySlides.length < 14) {
        setFactoryWarning('⚠️ ストーリー枚数が不足しています。再生成をおすすめします。')
      }

      // Step 2: Image (AI, Upload, or Reuse cached)
      let slidesWithImages = [...storySlides]
      if (reuseImageMode) {
        setFactoryStep('Step 2/7: キャッシュ画像適用中...')
        addLog('[2/7] 前回生成画像を再利用')
        try {
          const raw = localStorage.getItem(IMAGE_CACHE_KEY)
          const cache = raw ? JSON.parse(raw) as Record<string, string[]> : {}
          const cachedImages = simpleTemplateType ? (cache[simpleTemplateType] ?? []) : []
          if (cachedImages.length > 0) {
            slidesWithImages = storySlides.map((slide, index) => ({
              ...slide,
              image: cachedImages[index % cachedImages.length],
            }))
            setSlides([...slidesWithImages])
            addLog(`[2/7] キャッシュ画像適用完了 (${cachedImages.length}枚再利用)`)
          } else {
            addLog('[2/7] キャッシュ画像なし — AI生成へフォールバック')
          }
        } catch {
          addLog('[2/7] キャッシュ読み込みエラー — AI生成へフォールバック')
        }
      } else if (testMode && imageSourceMode === 'ai') {
        // Phase29-B: テストモード — AI画像生成スキップ
        setFactoryStep('Step 2/7: テストモード画像適用中...')
        addLog('[2/7] テストモード: AI画像生成をスキップします')
        const uploadedImages = userUploadedImagesRef.current
        if (uploadedImages.length > 0) {
          addLog(`[2/7] テストモード: アップロード画像 ${uploadedImages.length}枚を使用`)
          const serverUrls: string[] = []
          for (let ui = 0; ui < uploadedImages.length; ui++) {
            const img = uploadedImages[ui]
            try {
              const blobRes = await fetch(img.url)
              const blob = await blobRes.blob()
              const fd = new FormData()
              fd.append('image', blob, img.name)
              const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd })
              const uploadData = await uploadRes.json()
              if (uploadData.ok && uploadData.url) {
                serverUrls.push(uploadData.url)
              }
            } catch {}
          }
          if (serverUrls.length > 0) {
            slidesWithImages = storySlides.map((slide, index) => ({
              ...slide,
              image: serverUrls[index % serverUrls.length],
            }))
            setSlides([...slidesWithImages])
            addLog(`[2/7] テストモード: アップロード画像適用完了 (${serverUrls.length}枚)`)
          } else {
            addLog('[2/7] テストモード: アップロード失敗 → プレースホルダーを使用')
            slidesWithImages = storySlides.map((slide, index) => ({
              ...slide,
              image: makePlaceholderDataUrl(index + 1),
            }))
            setSlides([...slidesWithImages])
          }
        } else {
          try {
            const raw = localStorage.getItem(IMAGE_CACHE_KEY)
            const cache = raw ? JSON.parse(raw) as Record<string, string[]> : {}
            const cachedImages = simpleTemplateType ? (cache[simpleTemplateType] ?? []) : []
            if (cachedImages.length > 0) {
              addLog(`[2/7] テストモード: キャッシュ画像 ${cachedImages.length}枚を再利用`)
              slidesWithImages = storySlides.map((slide, index) => ({
                ...slide,
                image: cachedImages[index % cachedImages.length],
              }))
              setSlides([...slidesWithImages])
            } else {
              addLog('[2/7] テストモード: プレースホルダー画像を適用')
              slidesWithImages = storySlides.map((slide, index) => ({
                ...slide,
                image: makePlaceholderDataUrl(index + 1),
              }))
              setSlides([...slidesWithImages])
            }
          } catch {
            addLog('[2/7] テストモード: プレースホルダー画像を適用')
            slidesWithImages = storySlides.map((slide, index) => ({
              ...slide,
              image: makePlaceholderDataUrl(index + 1),
            }))
            setSlides([...slidesWithImages])
          }
        }
        addLog('[2/7] テストモード: 画像ステップ完了')
      } else if (imageSourceMode === 'ai') {
        throw new Error('AI画像生成は現在無効です。画像をアップロードしてください。')
      } else {
        // upload mode: transfer blob URLs to server then assign to slides
        setFactoryStep('Step 2/7: アップロード画像反映中...')
        addLog('[2/7] アップロード画像反映')
        const uploadedImages = userUploadedImagesRef.current
        addLog(`[2/7] アップロード画像: ${uploadedImages.length}枚`)
        const serverUrls: string[] = []
        for (let ui = 0; ui < uploadedImages.length; ui++) {
          const img = uploadedImages[ui]
          try {
            const blobRes = await fetch(img.url)
            const blob = await blobRes.blob()
            const fd = new FormData()
            fd.append('image', blob, img.name)
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd })
            const uploadData = await uploadRes.json()
            if (uploadData.ok && uploadData.url) {
              serverUrls.push(uploadData.url)
              addLog(`  ✅ アップロード完了 (${ui + 1}/${uploadedImages.length}): ${img.name}`)
            } else {
              addLog(`  ⚠️ アップロードスキップ: ${img.name}`)
            }
          } catch (uploadErr) {
            addLog(`  ⚠️ アップロードエラー: ${img.name}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`)
          }
        }
        if (serverUrls.length === 0) {
          throw new Error('アップロード画像のサーバー転送に失敗しました。')
        }
        slidesWithImages = storySlides.map((slide, index) => ({
          ...slide,
          image: serverUrls[index % serverUrls.length],
        }))
        setSlides([...slidesWithImages])
        addLog('[2/7] 画像適用完了')
      }

      // Step 3: Variant Generate
      setFactoryStep('Step 3/7: バリアント生成中...')
      addLog('[3/7] Variant Generate 開始')
      const genRes = await fetch('/api/variant-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: themeForRun, slides: storySlides }),
      })
      const genData = await genRes.json()
      if (!genData.ok) throw new Error(genData.message ?? 'Failed to generate variants')
      if (typeof genData.warning === 'string') addLog(`⚠️ ${genData.warning}`)
      const variants: GeneratedVariant[] = genData.variants
      setGeneratedVariants(variants)
      generatedVariantsRef.current = variants
      try { localStorage.setItem('bemystyle-reel-generated-variants', JSON.stringify(variants)) } catch {}
      addLog(`[3/7] Variant生成完了 (${variants.length}件)`)

      // Step 4: Score Variants
      setFactoryStep('Step 4/7: バリアントスコアリング中...')
      addLog('[4/7] Score Variants 開始')
      const scoreRes = await fetch('/api/score-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: themeForRun,
          variants,
          learningEvents: variantLearningEvents.slice(0, 50),
        }),
      })
      const scoreData = await scoreRes.json()
      if (!scoreData.ok) throw new Error(scoreData.message ?? 'Failed to score variants')
      if (typeof scoreData.warning === 'string') addLog(`⚠️ ${scoreData.warning}`)
      const scores: VariantScore[] = scoreData.scores
      setVariantScores(scores)
      variantScoresRef.current = scores
      try { localStorage.setItem('bemystyle-reel-variant-scores', JSON.stringify(scores)) } catch {}
      addLog(`[4/7] スコア完了 (${scores.length}件)`)

      // Step 5: Select top 3 with recommendation >= 4
      setFactoryStep('Step 5/7: トップバリアントを選定中...')
      addLog('[5/7] Top Variant 選定')
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
        addLog('[5/7] recommendation >= 4 のVariantが見つかりませんでした')
        setFactoryStep('Factory complete')
        setFactoryError('recommendation >= 4 のVariantが見つかりませんでした。Queue投入をスキップしました。')
        return
      }
      addLog(`[5/7] ${targets.length}件 選定 (Recommend: ${targets.map((t) => t.recommendation).join(', ')})`)

      // Step 6: Rewrite each target
      setFactoryStep('Step 6/7: バリアントをリライト中...')
      addLog('[6/7] Rewrite 開始')
      const queueItems: RenderQueueItem[] = []
      for (const target of targets) {
        addLog(`  Rewriting: ${target.variant.name}`)
        const rewriteRes = await fetch('/api/rewrite-story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            angle: target.variant.angle,
            slides: slidesWithImages.map((s) => ({ headline: s.headline, subline: s.subline, emphasis: s.emphasis })),
          }),
        })
        const rewriteData = await rewriteRes.json()
        if (!rewriteData.ok) throw new Error(rewriteData.message ?? `Failed to rewrite story for ${target.variant.name}`)
        if (typeof rewriteData.warning === 'string') addLog(`  ⚠️ ${rewriteData.warning}`)
        const rewritten: RewrittenSlide[] = rewriteData.slides
        const rewrittenSlides: Slide[] = slidesWithImages.map((s, i) => ({
          ...s,
          headline: rewritten[i]?.headline ?? s.headline,
          subline: rewritten[i]?.subline ?? s.subline,
          emphasis: rewritten[i]?.emphasis ?? s.emphasis,
        }))
        queueItems.push({
          id: crypto.randomUUID(),
          variantName: `${target.variant.name}（Rewrite）`,
          status: 'pending',
          slidesSnapshot: rewrittenSlides,
          snapshotCreatedAt: new Date().toISOString(),
        })
      }
      addLog(`[6/7] Rewrite完了 (${queueItems.length}件)`)

      // Step 7: Queue
      setFactoryStep('Step 7/7: キューに投入中...')
      addLog('[7/7] Queue投入')
      const newQueueItems = addQueueItems(queueItems)
      const actualQueueAdded = newQueueItems.length
      addLog(`[7/7] Queue投入完了 (${actualQueueAdded}件)`)

      // Build Factory Summary (Phase15-B)
      const sortedTargets = [...targets].sort((a, b) => {
        if (b.recommendation !== a.recommendation) return b.recommendation - a.recommendation
        if (b.predictedViews !== a.predictedViews) return b.predictedViews - a.predictedViews
        return b.savePotential - a.savePotential
      })
      const best = sortedTargets[0]
      const avgRec = scores.reduce((sum, s) => sum + s.recommendation, 0) / scores.length
      const summary: FactorySummary = {
        generatedCount: variants.length,
        selectedCount: targets.length,
        averageRecommendation: Math.round(avgRec * 10) / 10,
        bestVariantName: best.variant.name,
        bestRecommendation: best.recommendation,
        queueAddedCount: actualQueueAdded,
        generatedAt: new Date().toISOString(),
        topVariants: sortedTargets.slice(0, 3).map((t) => ({
          name: t.variant.name,
          recommendation: t.recommendation,
          predictedViews: t.predictedViews,
          savePotential: t.savePotential,
          ctaStrength: t.ctaStrength,
        })),
      }
      setFactorySummary(summary)
      try { localStorage.setItem(FACTORY_SUMMARY_CACHE_KEY, JSON.stringify(summary)) } catch {}

      if (newQueueItems.length === 0) {
        const message = '動画生成キューに追加できませんでした。画像生成結果を確認してください。'
        setFactoryStep('Factory failed')
        setFactoryError(message)
        addLog(`ERROR: ${message}`)
        return
      }

      // Factory History 追加 (Phase15-E)
      const autoTags = inferFactoryTags(themeForRun)
      const historyItem: FactoryHistoryItem = {
        ...summary,
        id: crypto.randomUUID(),
        theme: themeForRun,
        tags: autoTags.length > 0 ? autoTags : undefined,
      }
      if (autoTags.length > 0) {
        addLog(`自動タグ: ${autoTags.join(', ')}`)
      }
      setFactoryHistory((prev) => {
        const next = [historyItem, ...prev].slice(0, 20)
        try { localStorage.setItem(FACTORY_HISTORY_KEY, JSON.stringify(next)) } catch {}
        return next
      })

      // Phase17-C: Auto-render after factory
      if (reelAiConfig.dryRun) {
        setFactoryStep('Factory complete')
        addLog('Dry Runモードのため、自動動画生成をスキップしました。キュー投入まで確認済みです。')
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' })
        return
      }

      setFactoryStep('動画生成中...')
      addLog('AI自動作成が完了しました。続けて動画生成を開始しています。')
      // Wait for React to flush the setRenderQueue update so batchRenderRef picks up new items
      await new Promise<void>((resolve) => setTimeout(resolve, 200))
      try {
        const newQueueItemIds = new Set(newQueueItems.map((item) => item.id))
        await batchRenderRef.current([...newQueueItemIds])
        const q = renderQueueRef.current.filter((item) => newQueueItemIds.has(item.id))
        const completedCount = q.filter((item) => item.status === 'completed').length
        const failedCount = q.filter((item) => item.status === 'failed').length
        if (failedCount > 0 && completedCount === 0) {
          addLog(`自動動画生成に失敗しました。キューから再実行できます。(成功:${completedCount}件 / 失敗:${failedCount}件)`)
        } else if (failedCount > 0) {
          addLog(`動画生成が完了しました（一部失敗）。完成動画を確認できます。(成功:${completedCount}件 / 失敗:${failedCount}件)`)
        } else {
          addLog('動画生成が完了しました。完成動画を確認できます。')
        }
      } catch {
        addLog('自動動画生成に失敗しました。キューから再実行できます。')
      }

      setFactoryStep('Factory complete')
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Factory Run failed'
      setFactoryError(msg)
      setFactoryStep('Factory failed')
      addLog(`ERROR: ${msg}`)
    } finally {
      setFactoryRunning(false)
      setFactoryCurrentImageIndex(null)
      setFactoryTotalImageCount(null)
    }
  }, [factoryRunning, aiTheme, customPresets, selectedCustomPresetId, selectedPresetKey, slides, variantLearningEvents, imageSourceMode, costMode, effectiveQuality, reelAiConfig, reuseImageMode, simpleMode, simpleTemplateType, setCachedImagesForTemplate, setSlides, setHasUnsavedChanges, setGeneratedVariants, setVariantScores, variantScoresRef, generatedVariantsRef, addQueueItems, batchRenderRef, renderQueueRef, compareDashboardRef, userUploadedImagesRef, setQuotaError, testMode])

  const showFactoryNotice = useCallback((message: string) => {
    setFactoryNotice(message)
    window.setTimeout(() => {
      setFactoryNotice('')
    }, 3500)
  }, [])

  const handleReuseFactoryTheme = useCallback((theme: string) => {
    setAiTheme(theme)
    showFactoryNotice('テーマを再利用できます。必要に応じて編集してください')
    requestAnimationFrame(() => {
      document
        .getElementById('ai-theme-input')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [setAiTheme, showFactoryNotice])

  const handleDuplicateFactoryTheme = useCallback((theme: string) => {
    setAiTheme(`${theme} `)
    showFactoryNotice('テーマを編集してから Factory Run してください')
    requestAnimationFrame(() => {
      const el = document.getElementById('ai-theme-input') as HTMLInputElement | null
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }, [setAiTheme, showFactoryNotice])

  const handleRerunFactoryTheme = useCallback(async (theme: string) => {
    setAiTheme(theme)
    showFactoryNotice('過去テーマで Factory を再実行します')
    requestAnimationFrame(() => {
      document
        .getElementById('ai-theme-input')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    await handleRunReelFactory(theme)
  }, [setAiTheme, handleRunReelFactory, showFactoryNotice])

  // ==============================
  // Factory History
  // ==============================
  const toggleFactoryHistoryFavorite = useCallback((id: string) => {
    setFactoryHistory((prev) => {
      const next = prev.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item
      )
      try { localStorage.setItem(FACTORY_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const handleExportFactoryHistory = useCallback(() => {
    const blob = new Blob([JSON.stringify(factoryHistory, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bemystyle-reel-factory-history-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [factoryHistory])

  const handleExportFactoryHistoryCsv = useCallback(() => {
    const headers = [
      'generatedAt',
      'theme',
      'favorite',
      'bestVariantName',
      'bestRecommendation',
      'averageRecommendation',
      'generatedCount',
      'selectedCount',
      'queueAddedCount',
      'tags',
      'topVariants',
    ]

    const rows = factoryHistory.map(item => [
      item.generatedAt,
      item.theme,
      item.favorite ? 'true' : 'false',
      item.bestVariantName,
      item.bestRecommendation,
      item.averageRecommendation,
      item.generatedCount,
      item.selectedCount,
      item.queueAddedCount,
      (item.tags ?? []).join('|'),
      item.topVariants.map(v =>
        `${v.name}:rec${v.recommendation}/views${v.predictedViews ?? ''}/save${v.savePotential ?? ''}/cta${v.ctaStrength ?? ''}`
      ).join('|'),
    ])

    const csv = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map(row => row.map(escapeCsvValue).join(',')),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bemystyle-reel-factory-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [factoryHistory])

  const handleImportFactoryHistory = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!Array.isArray(parsed)) throw new Error('Invalid history file')
        const validItems = parsed.filter(isFactoryHistoryItem)
        if (validItems.length === 0) throw new Error('No valid history items')
        const next = [...validItems, ...factoryHistory].slice(0, 20)
        setFactoryHistory(next)
        localStorage.setItem(FACTORY_HISTORY_KEY, JSON.stringify(next))
        showFactoryNotice(`${validItems.length}件の履歴をImportしました`)
      } catch {
        showFactoryNotice('Factory History の読み込みに失敗しました')
      }
    }
    reader.readAsText(file)
  }, [factoryHistory, showFactoryNotice])

  const handleDeleteFactoryHistoryItem = useCallback((id: string) => {
    if (!window.confirm('この履歴を削除しますか？')) return
    setFactoryHistory((prev) => {
      const next = prev.filter((item) => item.id !== id)
      try { localStorage.setItem(FACTORY_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const handleClearFactoryHistory = useCallback(() => {
    setFactoryHistory([])
    localStorage.removeItem(FACTORY_HISTORY_KEY)
  }, [])

  const handleFactoryHistoryUpdate = useCallback((items: FactoryHistoryItem[]) => {
    setFactoryHistory(items)
    try { localStorage.setItem(FACTORY_HISTORY_KEY, JSON.stringify(items)) } catch {}
  }, [])

  const clearFactoryMessages = useCallback(() => {
    setFactoryWarning('')
    setFactoryNotice('')
  }, [])

  // ==============================
  // Derived values
  // ==============================
  const factoryStepNum =
    factoryStep === 'Step 1/7: ストーリー生成中...' ? 1 :
    factoryStep === 'Step 2/7: AI画像生成中...' ? 2 :
    factoryStep === 'Step 2/7: アップロード画像反映中...' ? 2 :
    factoryStep === 'Step 3/7: バリアント生成中...' ? 3 :
    factoryStep === 'Step 4/7: バリアントスコアリング中...' ? 4 :
    factoryStep === 'Step 5/7: トップバリアントを選定中...' ? 5 :
    factoryStep === 'Step 6/7: バリアントをリライト中...' ? 6 :
    factoryStep === 'Step 7/7: キューに投入中...' ? 7 :
    factoryStep === 'Factory complete' ? 8 : 0

  // Weighted progress: Story5% | AI/Upload65% | Variant10% | Score5% | Select5% | Rewrite5% | Queue5%
  const factoryProgress: number = (() => {
    if (factoryStepNum === 0) return 0
    if (factoryStepNum === 1) return 3
    if (factoryStepNum === 2) {
      const idx = factoryCurrentImageIndex ?? 0
      const tot = factoryTotalImageCount ?? 14
      return 5 + Math.round((idx / tot) * 65)
    }
    if (factoryStepNum === 3) return 70
    if (factoryStepNum === 4) return 80
    if (factoryStepNum === 5) return 85
    if (factoryStepNum === 6) return 90
    if (factoryStepNum === 7) return 95
    return 100
  })()

  return {
    // Auto Pipeline
    isAutoPipelineRunning,
    pipelineStatus,
    lastPipeline,
    handleAutoRenderPipeline,
    // Factory state
    factoryRunning,
    factoryStep,
    factoryStepNum,
    factoryProgress,
    factoryCurrentImageIndex,
    factoryTotalImageCount,
    factoryError,
    factoryLog,
    factoryNotice,
    factoryWarning,
    factorySummary,
    factoryHistory,
    // Factory callbacks
    handleRunReelFactory,
    showFactoryNotice,
    clearFactoryMessages,
    clearFactorySummary,
    findFactoryQueueItem,
    handleJumpToQueueItem,
    handleReuseFactoryTheme,
    handleDuplicateFactoryTheme,
    handleRerunFactoryTheme,
    toggleFactoryHistoryFavorite,
    handleExportFactoryHistory,
    handleExportFactoryHistoryCsv,
    handleImportFactoryHistory,
    handleDeleteFactoryHistoryItem,
    handleClearFactoryHistory,
    handleFactoryHistoryUpdate,
  }
}
