import { useState, useEffect, useCallback, useRef } from 'react'
import { generateStory, GeneratedStory, AIPresetKey } from '../../storyGenerator'
import type { Slide } from '../../types'
import {
  MassTemplateType,
  MassPostChecklist,
  MassThemeItem,
  MassQueueSummary,
  MassPipelineMode,
} from './massModeTypes'

const MASS_ITEMS_KEY = 'bemystyle-reel-mass-items-v1'

// --- Pure helpers (moved from App.tsx) ---

function buildMassThemeText(item: MassThemeItem): string {
  switch (item.templateType) {
    case 'mmm-event':
      return `MMMイベント告知「${item.theme}」のSNSショート動画にしてください。`
    case 'free-diagnosis':
      return `無料歌唱診断「${item.theme}」。申し込みを増やすためのSNSショート動画にしてください。`
    case 'note-article':
      return `Note記事「${item.theme}」。記事への流入を増やすSNSショート動画にしてください。`
  }
}

function getMassPresetKey(templateType: MassTemplateType): AIPresetKey {
  switch (templateType) {
    case 'mmm-event': return 'mmm_event'
    case 'free-diagnosis': return 'singing_pr'
    case 'note-article': return 'note'
  }
}

function buildMassCaption(item: MassThemeItem): string {
  const hashtags: Record<MassTemplateType, string> = {
    'mmm-event': '#MMM #音楽 #MMMイベント #歌 #セッション',
    'free-diagnosis': '#無料歌唱診断 #歌 #ボイトレ #歌唱力 #歌手',
    'note-article': '#Note #音楽 #歌 #記事 #ミュージシャン',
  }
  const body = item.storyResult
    ? item.storyResult.slides.filter((_, i) => i < 3).map(s => s.headline).join('\n')
    : item.theme
  return `【${item.theme}】\n${body}\n${hashtags[item.templateType]}`
}

async function fetchMassImages(storyResult: GeneratedStory): Promise<{ imageUrls: string[]; failCount: number }> {
  const prompts = storyResult.slides
    .map(s => s.imagePrompt)
    .filter((p): p is string => Boolean(p))
    .slice(0, 5)
  if (prompts.length === 0) throw new Error('画像プロンプトが見つかりません')
  const CONCURRENCY = 3
  const imageUrls: string[] = []
  let failCount = 0
  for (let i = 0; i < prompts.length; i += CONCURRENCY) {
    const batch = prompts.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(prompt =>
        fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, quality: 'standard' }),
        }).then(res => res.json() as Promise<{ ok?: boolean; image?: string; errorType?: string; message?: string }>)
      )
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok && result.value.image) {
        imageUrls.push(result.value.image)
      } else {
        failCount++
      }
    }
  }
  if (imageUrls.length === 0) throw new Error('画像生成に失敗しました')
  return { imageUrls, failCount }
}

function buildMassSlidesSnapshot(story: GeneratedStory, imageUrls: string[]): Slide[] {
  const slideCount = story.slides.length
  return story.slides.map((generated, idx) => {
    const isCta = idx === slideCount - 1
    return {
      id: idx + 1,
      durationSec: isCta ? 5 : 3,
      visible: true,
      headline: generated.headline,
      subline: generated.subline ?? '',
      emphasis: generated.emphasis ?? '',
      image: imageUrls[idx] ?? '',
      layout: isCta ? 'cta' as const : 'bottom' as const,
      showParticles: false,
      imagePrompt: generated.imagePrompt,
      ...(isCta ? { showCTA: true, ctaLabel: story.variables.cta } : {}),
    }
  })
}

// --- Hook ---

interface UseMassModeOptions {
  addToRenderQueue: (variantName: string, slidesSnapshot: Slide[]) => string
}

export function useMassMode({ addToRenderQueue }: UseMassModeOptions) {
  const [isMassMode, setIsMassMode] = useState(false)
  const [massThemes, setMassThemes] = useState<MassThemeItem[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(MASS_ITEMS_KEY) ?? '[]')
      return raw.map((item: MassThemeItem) => ({
        ...item,
        status: item.status === 'running' ? 'pending' : (item.status ?? 'pending'),
      }))
    } catch { return [] }
  })
  const [massInputType, setMassInputType] = useState<MassTemplateType>('mmm-event')
  const [massInputTheme, setMassInputTheme] = useState('')
  const [massQueueRunning, setMassQueueRunning] = useState(false)
  const massAbortRef = useRef(false)
  const [massQueueSummary, setMassQueueSummary] = useState<MassQueueSummary | null>(null)
  const [massStoryPreviewId, setMassStoryPreviewId] = useState<string | null>(null)
  const [massRegeneratingId, setMassRegeneratingId] = useState<string | null>(null)
  const [massImageGeneratingId, setMassImageGeneratingId] = useState<string | null>(null)
  const [massPipelineMode, setMassPipelineMode] = useState<MassPipelineMode>('story-only')
  const [massCopiedId, setMassCopiedId] = useState<string | null>(null)
  const [massCollapseDone, setMassCollapseDone] = useState(true)

  // Phase22-B: 量産テーマリストを localStorage に同期
  useEffect(() => {
    try { localStorage.setItem(MASS_ITEMS_KEY, JSON.stringify(massThemes)) } catch { /* noop */ }
  }, [massThemes])

  const addMassTheme = useCallback(() => {
    const trimmed = massInputTheme.trim()
    if (!trimmed) return
    setMassThemes(prev => [...prev, { id: `mass-${Date.now()}-${Math.random()}`, templateType: massInputType, theme: trimmed, status: 'pending' }])
    setMassInputTheme('')
  }, [massInputTheme, massInputType])

  const deleteMassTheme = useCallback((id: string) => {
    setMassThemes(prev => prev.filter(item => item.id !== id))
  }, [])

  const clearMassThemes = useCallback(() => {
    setMassThemes([])
  }, [])

  const clearCompletedMassThemes = useCallback(() => {
    setMassThemes(prev => prev.filter(item => item.status !== 'completed'))
  }, [])

  const startMassQueue = useCallback(async () => {
    const pendingItems = massThemes.filter(item => item.status === 'pending')
    if (pendingItems.length === 0) return
    massAbortRef.current = false
    setMassQueueRunning(true)
    setMassQueueSummary(null)
    let completedCount = 0
    let failedCount = 0

    for (const item of pendingItems) {
      if (massAbortRef.current) break

      // --- Step 1: Story生成 ---
      setMassThemes(prev => prev.map(i => i.id === item.id ? { ...i, status: 'running', resultMessage: 'Story生成中...' } : i))
      let story: GeneratedStory
      try {
        story = await generateStory(buildMassThemeText(item), getMassPresetKey(item.templateType), null)
      } catch (err) {
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'failed', resultMessage: err instanceof Error ? err.message : 'Story生成エラー',
        } : i))
        failedCount++
        continue
      }
      if (massAbortRef.current) {
        setMassThemes(prev => prev.map(i => i.id === item.id ? { ...i, status: 'pending', resultMessage: undefined } : i))
        break
      }

      if (massPipelineMode === 'story-only') {
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'completed', resultMessage: 'Story生成完了', storyResult: story,
        } : i))
        completedCount++
        continue
      }

      // --- Step 2: 画像生成 ---
      setMassThemes(prev => prev.map(i => i.id === item.id ? {
        ...i, resultMessage: '画像生成中...', storyResult: story,
        imageStatus: 'running', imageError: undefined, imageUrls: undefined,
      } : i))
      let imageUrls: string[]
      let failCount: number
      try {
        ;({ imageUrls, failCount } = await fetchMassImages(story))
      } catch (err) {
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'failed',
          resultMessage: err instanceof Error ? err.message : '画像生成エラー',
          storyResult: story, imageStatus: 'failed',
          imageError: err instanceof Error ? err.message : '画像生成エラー',
        } : i))
        failedCount++
        continue
      }
      if (massAbortRef.current) {
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'pending', resultMessage: undefined,
          imageStatus: 'completed', imageUrls,
          imageError: failCount > 0 ? `${failCount}枚失敗` : undefined,
        } : i))
        break
      }

      if (massPipelineMode === 'story-image') {
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'completed', resultMessage: 'Story + 画像完了',
          storyResult: story, imageStatus: 'completed', imageUrls,
          imageError: failCount > 0 ? `${failCount}枚失敗` : undefined,
        } : i))
        completedCount++
        continue
      }

      // --- Step 3: Render Queue投入 ---
      setMassThemes(prev => prev.map(i => i.id === item.id ? { ...i, resultMessage: 'キュー投入中...' } : i))
      try {
        const slidesSnapshot = buildMassSlidesSnapshot(story, imageUrls)
        const variantName = `[量産] ${item.theme.slice(0, 24)}_${Date.now()}`
        const queueItemId = addToRenderQueue(variantName, slidesSnapshot)
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'completed', resultMessage: 'Story + 画像 + キュー投入完了',
          storyResult: story, imageStatus: 'completed', imageUrls,
          imageError: failCount > 0 ? `${failCount}枚失敗` : undefined,
          renderQueued: true, renderQueueId: queueItemId, renderQueueError: undefined,
        } : i))
        completedCount++
      } catch (err) {
        setMassThemes(prev => prev.map(i => i.id === item.id ? {
          ...i, status: 'failed', resultMessage: 'キュー投入失敗',
          storyResult: story, imageStatus: 'completed', imageUrls,
          renderQueued: false,
          renderQueueError: err instanceof Error ? err.message : 'キュー投入エラー',
        } : i))
        failedCount++
      }
    }

    setMassQueueRunning(false)
    setMassQueueSummary({
      total: pendingItems.length,
      completed: completedCount,
      failed: failedCount,
      stopped: massAbortRef.current,
    })
  }, [massThemes, massPipelineMode, addToRenderQueue])

  const stopMassQueue = useCallback(() => {
    massAbortRef.current = true
  }, [])

  const reGenerateMassItem = useCallback(async (id: string) => {
    const item = massThemes.find(i => i.id === id)
    if (!item) return
    setMassRegeneratingId(id)
    setMassStoryPreviewId(null)
    setMassThemes(prev => prev.map(i => i.id === id ? { ...i, status: 'running', resultMessage: undefined, storyResult: undefined } : i))
    try {
      const story = await generateStory(buildMassThemeText(item), getMassPresetKey(item.templateType), null)
      setMassThemes(prev => prev.map(i => i.id === id ? { ...i, status: 'completed', resultMessage: 'Story生成完了', storyResult: story } : i))
    } catch (err) {
      setMassThemes(prev => prev.map(i => i.id === id ? { ...i, status: 'failed', resultMessage: err instanceof Error ? err.message : '不明なエラー' } : i))
    } finally {
      setMassRegeneratingId(null)
    }
  }, [massThemes])

  const generateMassImages = useCallback(async (id: string) => {
    const item = massThemes.find(i => i.id === id)
    if (!item?.storyResult) return
    setMassImageGeneratingId(id)
    setMassThemes(prev => prev.map(i => i.id === id ? { ...i, imageStatus: 'running', imageError: undefined, imageUrls: undefined } : i))
    try {
      const { imageUrls, failCount } = await fetchMassImages(item.storyResult)
      setMassThemes(prev => prev.map(i => i.id === id ? {
        ...i, imageStatus: 'completed', imageUrls,
        imageError: failCount > 0 ? `${failCount}枚失敗` : undefined,
      } : i))
    } catch (err) {
      setMassThemes(prev => prev.map(i => i.id === id ? { ...i, imageStatus: 'failed', imageError: err instanceof Error ? err.message : '画像生成エラー' } : i))
    } finally {
      setMassImageGeneratingId(null)
    }
  }, [massThemes])

  const addMassItemToQueue = useCallback((id: string) => {
    const item = massThemes.find(i => i.id === id)
    if (!item || !item.storyResult || !item.imageUrls || item.imageUrls.length === 0) return
    try {
      const slidesSnapshot = buildMassSlidesSnapshot(item.storyResult, item.imageUrls)
      const variantName = `[量産] ${item.theme.slice(0, 24)}_${Date.now()}`
      const queueItemId = addToRenderQueue(variantName, slidesSnapshot)
      setMassThemes(prev => prev.map(i => i.id === id
        ? { ...i, renderQueued: true, renderQueueId: queueItemId, renderQueueError: undefined }
        : i
      ))
    } catch (err) {
      setMassThemes(prev => prev.map(i => i.id === id
        ? { ...i, renderQueued: false, renderQueueError: err instanceof Error ? err.message : 'キュー投入エラー' }
        : i
      ))
    }
  }, [massThemes, addToRenderQueue])

  const toggleMassPostChecklist = useCallback((id: string, key: keyof MassPostChecklist) => {
    setMassThemes(prev => prev.map(i => {
      if (i.id !== id) return i
      const prev_checklist: MassPostChecklist = i.postChecklist ?? { mp4Checked: false, captionReady: false, platformDecided: false, posted: false }
      return { ...i, postChecklist: { ...prev_checklist, [key]: !prev_checklist[key] } }
    }))
  }, [])

  const updateMassPostCaption = useCallback((id: string, caption: string) => {
    setMassThemes(prev => prev.map(i => i.id === id ? { ...i, postCaption: caption } : i))
  }, [])

  const generateMassCaptionForItem = useCallback((id: string) => {
    const item = massThemes.find(i => i.id === id)
    if (!item) return
    const caption = buildMassCaption(item)
    setMassThemes(prev => prev.map(i => i.id === id ? { ...i, postCaption: caption } : i))
  }, [massThemes])

  const copyMassCaption = useCallback((id: string, caption: string) => {
    navigator.clipboard.writeText(caption).then(() => {
      setMassCopiedId(id)
      setTimeout(() => setMassCopiedId(prev => prev === id ? null : prev), 2000)
    })
  }, [])

  return {
    // App.tsx の entry button 用
    isMassMode,
    enterMassMode: () => setIsMassMode(true),
    // MassModePanel props
    massThemes,
    massQueueRunning,
    massQueueSummary,
    massPipelineMode,
    massRegeneratingId,
    massImageGeneratingId,
    massInputType,
    massInputTheme,
    massStoryPreviewId,
    massCopiedId,
    massCollapseDone,
    onExitMassMode: () => setIsMassMode(false),
    onAddTheme: addMassTheme,
    onDeleteTheme: deleteMassTheme,
    onClearThemes: clearMassThemes,
    onClearCompletedThemes: clearCompletedMassThemes,
    onStartQueue: startMassQueue,
    onStopQueue: stopMassQueue,
    onReGenerateItem: reGenerateMassItem,
    onGenerateImages: generateMassImages,
    onAddItemToQueue: addMassItemToQueue,
    onTogglePostChecklist: toggleMassPostChecklist,
    onUpdatePostCaption: updateMassPostCaption,
    onGenerateCaptionForItem: generateMassCaptionForItem,
    onCopyCaption: copyMassCaption,
    onInputTypeChange: (t: MassTemplateType) => setMassInputType(t),
    onInputValueChange: setMassInputTheme,
    onStoryPreviewToggle: (id: string) => setMassStoryPreviewId(prev => prev === id ? null : id),
    onCollapseDoneToggle: () => setMassCollapseDone(prev => !prev),
    onPipelineModeChange: setMassPipelineMode,
  }
}
