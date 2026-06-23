import { useState, useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import type { Slide, TemplateInfo, SimpleTemplateType } from '../../types'
import { generateStory, type AIPresetKey, type CustomPreset } from '../../storyGenerator'
import { type TemplateVariableValues, applyTemplateVariables } from '../../templateVariables'
import type { SnsCaption } from '../posting/usePostingManager'

// ==============================
// Exported Types
// ==============================
export type AIGenerationHistory = {
  id: string
  createdAt: string
  theme: string
  presetKey: AIPresetKey | ""
  templateId?: string
  templateName?: string
  slideCount: number
  imageCount: number
  renderStatus: "none" | "completed" | "failed"
  renderOutputPath?: string
  renderErrorMessage?: string
  renderVariantName?: string
  renderedAt?: string
  snsCaption?: SnsCaption
}

export type RecommendedPreset = {
  name: string
  tone: string
  targetAudience: string
  platform: string
  imageStyle: string
  ctaText: string
  reason: string
}

export type PresetInsight = {
  summary: string
  strongestPresets: string[]
  improvementIdeas: string[]
  recommendedCombinations: RecommendedPreset[]
}

// ==============================
// Constants (PRESET_TEMPLATE_CATEGORY_MAP exported for App.tsx useMemo)
// ==============================
const CUSTOM_PRESETS_KEY = 'bemystyle-reel-custom-presets'
const VALID_CUSTOM_PRESET_KEYS = new Set<string>(['note', 'singing_pr', 'session', 'youtube_shorts', 'instagram_reels', 'mmm_event', ''])
const AI_GENERATION_HISTORY_KEY = 'bemystyle-reel-ai-generation-history'

export const PRESET_TEMPLATE_CATEGORY_MAP: Record<AIPresetKey, string[]> = {
  note:            ['note', 'essay', 'story'],
  singing_pr:      ['singing', 'pr', 'promo'],
  session:         ['session', 'event', 'community'],
  youtube_shorts:  ['shorts', 'youtube'],
  instagram_reels: ['reels', 'instagram', 'stylish'],
  mmm_event:       ['mmm', 'event', 'announcement', 'community'],
}

// ==============================
// Hook Params
// ==============================
type UseStoryGeneratorParams = {
  slides: Slide[]
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  setHasUnsavedChanges: (v: boolean) => void
  simpleTemplateType: SimpleTemplateType | null
  simpleTemplateId: string
  rawTemplateSlides: Slide[] | null
  templateVariableKeys: string[]
  variableValues: TemplateVariableValues
  setVariableValues: React.Dispatch<React.SetStateAction<TemplateVariableValues>>
  selectedTemplateId: string
  templates: TemplateInfo[]
  visualStyleTags: string[]
  recommendedCtaLabel: string
  setQuotaError: (v: boolean) => void
  confirmLoadTemplate: (id: string) => void
  usageMap: Record<string, number>
}

export function useStoryGenerator({
  slides,
  setSlides,
  setHasUnsavedChanges,
  simpleTemplateType,
  simpleTemplateId,
  rawTemplateSlides,
  templateVariableKeys,
  variableValues,
  setVariableValues,
  selectedTemplateId,
  templates,
  visualStyleTags,
  recommendedCtaLabel,
  setQuotaError,
  confirmLoadTemplate,
  usageMap,
}: UseStoryGeneratorParams) {
  // --- Story generation state ---
  const [aiTheme, setAiTheme] = useState('')
  const [selectedPresetKey, setSelectedPresetKey] = useState<AIPresetKey | ''>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [generateSuccess, setGenerateSuccess] = useState(false)

  // --- Auto-apply template state ---
  const [autoApplyRecommendedTemplate, setAutoApplyRecommendedTemplate] = useState(false)
  const [autoApplyTemplateNotice, setAutoApplyTemplateNotice] = useState('')

  // --- AI generation history state ---
  const [aiGenerationHistory, setAiGenerationHistory] = useState<AIGenerationHistory[]>([])
  const [importNotice, setImportNotice] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)

  // --- Custom preset state ---
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [customPresetForm, setCustomPresetForm] = useState({
    name: '',
    presetKey: '' as AIPresetKey | '',
    tone: '',
    targetAudience: '',
    platform: '',
    imageStyle: '',
    ctaText: '',
  })
  const [selectedCustomPresetId, setSelectedCustomPresetId] = useState('')
  const [presetImportNotice, setPresetImportNotice] = useState('')
  const presetImportRef = useRef<HTMLInputElement>(null)

  // --- Editing custom preset state ---
  const [editingCustomPresetId, setEditingCustomPresetId] = useState('')
  const [editingCustomPresetForm, setEditingCustomPresetForm] = useState<{
    name: string
    presetKey: AIPresetKey | ''
    tone: string
    targetAudience: string
    platform: string
    imageStyle: string
    ctaText: string
  } | null>(null)

  // --- AI preset insight state ---
  const [presetInsight, setPresetInsight] = useState<PresetInsight | null>(null)
  const [isGeneratingPresetInsight, setIsGeneratingPresetInsight] = useState(false)
  const [presetInsightError, setPresetInsightError] = useState('')
  const [createdInsightIndices, setCreatedInsightIndices] = useState<Set<number>>(new Set())
  const [isAnalyticsExpanded, setIsAnalyticsExpanded] = useState(false)

  // --- localStorage restore effects ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_GENERATION_HISTORY_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) setAiGenerationHistory(parsed.slice(0, 20))
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_PRESETS_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) setCustomPresets(parsed.slice(0, 10))
    } catch {}
  }, [])

  // --- Auto-apply recommended template (Phase12-M) ---
  useEffect(() => {
    if (!autoApplyRecommendedTemplate || !selectedPresetKey) return

    const categories = PRESET_TEMPLATE_CATEGORY_MAP[selectedPresetKey]
    const matched = templates.filter((t) => categories.includes(t.category ?? '')).slice(0, 3)
    const fallback = [...templates]
      .sort((a, b) => (usageMap[b.id] ?? 0) - (usageMap[a.id] ?? 0))
      .slice(0, 3)
    const target = (matched.length > 0 ? matched : fallback)[0]

    if (!target) {
      setAutoApplyTemplateNotice('おすすめテンプレートが見つかりませんでした')
      setTimeout(() => setAutoApplyTemplateNotice(''), 3000)
      return
    }

    confirmLoadTemplate(target.id)
    setAutoApplyTemplateNotice(`「${target.name}」を自動選択しました`)
    setTimeout(() => setAutoApplyTemplateNotice(''), 4000)
  }, [selectedPresetKey, autoApplyRecommendedTemplate, templates, usageMap, confirmLoadTemplate])

  // --- Core callbacks ---
  const handleAIGenerate = useCallback(async (): Promise<boolean> => {
    if (!aiTheme.trim() || isGenerating) return false
    setIsGenerating(true)
    setGenerateError('')
    setGenerateSuccess(false)
    try {
      const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId)
      const effectivePresetKey = simpleTemplateId === 'mmm-event' ? 'mmm_event' : selectedPresetKey
      const story = await generateStory(
        { theme: aiTheme.trim(), sourceType: 'theme' },
        effectivePresetKey,
        selectedCustomPreset
          ? {
              tone: selectedCustomPreset.tone,
              targetAudience: selectedCustomPreset.targetAudience,
              platform: selectedCustomPreset.platform,
              imageStyle: selectedCustomPreset.imageStyle,
              ctaText: selectedCustomPreset.ctaText,
            }
          : null,
        visualStyleTags.length > 0 ? visualStyleTags : undefined
      )

      const next: TemplateVariableValues = { ...variableValues }
      for (const [key, value] of Object.entries(story.variables)) {
        if (templateVariableKeys.includes(key)) {
          next[key] = value
        }
      }
      const shouldApplyRecommendedCta = simpleTemplateType !== 'custom' && recommendedCtaLabel
      if (shouldApplyRecommendedCta && templateVariableKeys.includes('cta')) {
        next.cta = recommendedCtaLabel
      }
      setVariableValues(next)

      const baseSlides = rawTemplateSlides
        ? applyTemplateVariables(rawTemplateSlides, next)
        : slides

      const nextSlides = baseSlides.map((slide, index) => {
        const generated = story.slides[index]
        if (!generated) return slide
        return {
          ...slide,
          headline: generated.headline,
          subline: generated.subline ?? slide.subline,
          emphasis: generated.emphasis ?? slide.emphasis,
          imagePrompt: generated.imagePrompt ?? slide.imagePrompt,
          ctaLabel: slide.layout === 'cta' && shouldApplyRecommendedCta ? recommendedCtaLabel : slide.ctaLabel,
        }
      })

      setSlides(nextSlides)
      setHasUnsavedChanges(true)
      setGenerateSuccess(true)

      const historyEntry: AIGenerationHistory = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        theme: aiTheme.trim(),
        presetKey: selectedPresetKey,
        templateId: selectedTemplateId || undefined,
        templateName: templates.find((t) => t.id === selectedTemplateId)?.name,
        slideCount: story.slides.length,
        imageCount: nextSlides.filter((s) => s.image?.startsWith('generated/')).length,
        renderStatus: 'none',
      }
      setAiGenerationHistory((prev) => {
        const updated = [historyEntry, ...prev].slice(0, 20)
        try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(updated)) } catch {}
        return updated
      })

      if (selectedCustomPresetId) {
        const now = new Date().toISOString()
        setCustomPresets((prev) => {
          const updated = prev.map((p) => {
            if (p.id !== selectedCustomPresetId) return p
            const logs = [...(p.usedAt ?? []), now].slice(-100)
            return { ...p, useCount: (p.useCount ?? 0) + 1, usedAt: logs, lastUsedAt: now }
          })
          try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
          return updated
        })
      }

      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI生成に失敗しました'
      if (err instanceof Error && (err as Error & { errorType?: string }).errorType === 'quota') {
        setQuotaError(true)
      }
      setGenerateError(msg)
      return false
    } finally {
      setIsGenerating(false)
    }
  }, [
    aiTheme, selectedPresetKey, isGenerating, variableValues, templateVariableKeys,
    rawTemplateSlides, slides, selectedTemplateId, templates, customPresets,
    selectedCustomPresetId, visualStyleTags, recommendedCtaLabel, simpleTemplateType,
    simpleTemplateId, setSlides, setHasUnsavedChanges, setVariableValues, setQuotaError,
  ])

  const updateLatestHistory = useCallback((patch: Partial<AIGenerationHistory>) => {
    setAiGenerationHistory((prev) => {
      if (prev.length === 0) return prev
      const updated = [{ ...prev[0], ...patch }, ...prev.slice(1)]
      try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [])

  const deleteAIGenerationHistoryItem = useCallback((id: string) => {
    setAiGenerationHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id)
      try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [])

  const clearAIGenerationHistory = useCallback(() => {
    setAiGenerationHistory([])
    try { localStorage.removeItem(AI_GENERATION_HISTORY_KEY) } catch {}
  }, [])

  const exportAIGenerationHistory = useCallback(() => {
    const blob = new Blob([JSON.stringify(aiGenerationHistory, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bemystyle-reel-ai-history.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [aiGenerationHistory])

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed: unknown = JSON.parse(ev.target?.result as string)
        if (!Array.isArray(parsed)) throw new Error('配列ではありません')
        const validated = (parsed as unknown[]).filter((item): item is AIGenerationHistory => {
          return (
            typeof item === 'object' && item !== null &&
            typeof (item as AIGenerationHistory).id === 'string' &&
            typeof (item as AIGenerationHistory).createdAt === 'string' &&
            typeof (item as AIGenerationHistory).theme === 'string'
          )
        })
        if (validated.length === 0) throw new Error('有効な履歴が見つかりません')
        setAiGenerationHistory((prev) => {
          const seen = new Set<string>()
          const updated = [...validated, ...prev].filter((h) => {
            if (seen.has(h.id)) return false
            seen.add(h.id)
            return true
          }).slice(0, 20)
          try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(updated)) } catch {}
          return updated
        })
        setImportNotice(`${validated.length}件をインポートしました`)
      } catch (err) {
        setImportNotice(err instanceof Error ? `インポート失敗: ${err.message}` : 'インポートに失敗しました')
      }
      setTimeout(() => setImportNotice(''), 4000)
      if (importInputRef.current) importInputRef.current.value = ''
    }
    reader.readAsText(file)
  }, [])

  // --- Custom preset callbacks ---
  const handleSaveCustomPreset = useCallback(() => {
    const { name, tone, targetAudience, platform, imageStyle, ctaText } = customPresetForm
    if (!name || !tone || !targetAudience || !platform || !imageStyle || !ctaText) return
    const base = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...customPresetForm,
    }
    setCustomPresets((prev) => {
      const newPreset: CustomPreset = { ...base, sortOrder: prev.length }
      const updated = [newPreset, ...prev].slice(0, 10)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
    setCustomPresetForm({ name: '', presetKey: '', tone: '', targetAudience: '', platform: '', imageStyle: '', ctaText: '' })
  }, [customPresetForm])

  const handleDeleteCustomPreset = useCallback((id: string) => {
    setCustomPresets((prev) => {
      const updated = prev.filter((p) => p.id !== id)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
    setSelectedCustomPresetId((current) => current === id ? '' : current)
  }, [])

  const handleUseCustomPreset = useCallback((preset: CustomPreset) => {
    setSelectedCustomPresetId(preset.id)
    setSelectedPresetKey(preset.presetKey)
  }, [])

  const handleExportCustomPresets = useCallback(() => {
    const blob = new Blob([JSON.stringify(customPresets, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bemystyle-reel-custom-presets.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [customPresets])

  const handleImportCustomPresets = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const input = e.target
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed: unknown = JSON.parse(ev.target?.result as string)
        if (!Array.isArray(parsed)) throw new Error('JSON形式を確認してください')
        const validated = (parsed as unknown[]).filter((item): item is CustomPreset => {
          if (typeof item !== 'object' || item === null) return false
          const p = item as Record<string, unknown>
          return (
            typeof p.id === 'string' &&
            typeof p.name === 'string' && (p.name as string).trim() !== '' &&
            typeof p.tone === 'string' && (p.tone as string).trim() !== '' &&
            typeof p.targetAudience === 'string' && (p.targetAudience as string).trim() !== '' &&
            typeof p.platform === 'string' && (p.platform as string).trim() !== '' &&
            typeof p.imageStyle === 'string' && (p.imageStyle as string).trim() !== '' &&
            typeof p.ctaText === 'string' && (p.ctaText as string).trim() !== '' &&
            typeof p.createdAt === 'string' &&
            (p.presetKey === undefined || VALID_CUSTOM_PRESET_KEYS.has(p.presetKey as string))
          )
        })
        if (validated.length === 0) throw new Error('有効なプリセットが見つかりません')
        setCustomPresets((prev) => {
          const seen = new Set<string>(prev.map((p) => p.id))
          const newOnes = validated.filter((p) => !seen.has(p.id))
          const updated = [...newOnes, ...prev].slice(0, 10)
          try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
          return updated
        })
        setPresetImportNotice(`${validated.length}件のカスタムプリセットをインポートしました`)
      } catch (err) {
        setPresetImportNotice(
          err instanceof Error ? `インポート失敗: ${err.message}` : 'インポート失敗: JSON形式を確認してください'
        )
      }
      setTimeout(() => setPresetImportNotice(''), 4000)
      input.value = ''
    }
    reader.readAsText(file)
  }, [])

  const handleSaveEditCustomPreset = useCallback(() => {
    if (!editingCustomPresetForm) return
    const { name, tone, targetAudience, platform, imageStyle, ctaText } = editingCustomPresetForm
    if (!name || !tone || !targetAudience || !platform || !imageStyle || !ctaText) return
    setCustomPresets((prev) => {
      const updated = prev.map((preset) =>
        preset.id === editingCustomPresetId
          ? { ...preset, ...editingCustomPresetForm }
          : preset
      )
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
    setEditingCustomPresetId('')
    setEditingCustomPresetForm(null)
  }, [editingCustomPresetId, editingCustomPresetForm])

  const handleDuplicateCustomPreset = useCallback((preset: CustomPreset) => {
    if (customPresets.length >= 10) {
      setPresetImportNotice('プリセットは最大10件です。先に削除してください。')
      setTimeout(() => setPresetImportNotice(''), 3000)
      return
    }
    const base = {
      ...preset,
      id: crypto.randomUUID(),
      name: `${preset.name} コピー`,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      useCount: 0,
    }
    setCustomPresets((prev) => {
      const newPreset: CustomPreset = { ...base, sortOrder: prev.length }
      const updated = [...prev, newPreset]
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [customPresets.length])

  const handleClearCustomPresets = useCallback(() => {
    if (!window.confirm('カスタムプリセットをすべて削除しますか？')) return
    setCustomPresets([])
    setSelectedCustomPresetId('')
    try { localStorage.removeItem(CUSTOM_PRESETS_KEY) } catch {}
  }, [])

  const handleExportAnalyticsCsv = useCallback(() => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const header = ['id', 'name', 'presetKey', 'isFavorite', 'useCount', 'sortOrder', 'platform', 'imageStyle', 'ctaText', 'createdAt', 'lastUsedAt', 'usedAtCount']
    const rows = customPresets.map((p) => [
      esc(p.id),
      esc(p.name),
      esc(p.presetKey),
      p.isFavorite ? 'true' : 'false',
      String(p.useCount ?? 0),
      String(p.sortOrder ?? ''),
      esc(p.platform),
      esc(p.imageStyle),
      esc(p.ctaText),
      esc(p.createdAt),
      esc(p.lastUsedAt ?? ''),
      String((p.usedAt ?? []).length),
    ].join(','))
    const csv = '﻿' + [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `custom-presets-analytics-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [customPresets])

  // --- AI Preset Insight callbacks ---
  const handleGeneratePresetInsight = useCallback(async () => {
    if (customPresets.length === 0) return
    setIsGeneratingPresetInsight(true)
    setPresetInsightError('')
    setPresetInsight(null)
    try {
      const payload = customPresets.map((p) => ({
        name: p.name,
        presetKey: p.presetKey,
        tone: p.tone,
        targetAudience: p.targetAudience,
        platform: p.platform,
        imageStyle: p.imageStyle,
        ctaText: p.ctaText,
        useCount: p.useCount ?? 0,
        isFavorite: p.isFavorite ?? false,
        lastUsedAt: p.lastUsedAt ?? '',
        usedAtCount: (p.usedAt ?? []).length,
      }))
      const res = await fetch('/api/custom-preset-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets: payload }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? 'AI提案の取得に失敗しました')
      const raw = data.insight
      const combos: RecommendedPreset[] = (raw.recommendedCombinations ?? []).map((item: unknown) =>
        typeof item === 'string'
          ? { name: item, tone: '', targetAudience: '', platform: '', imageStyle: '', ctaText: '', reason: '' }
          : { name: '', tone: '', targetAudience: '', platform: '', imageStyle: '', ctaText: '', reason: '', ...(item as object) }
      )
      setPresetInsight({ ...raw, recommendedCombinations: combos })
      setCreatedInsightIndices(new Set())
    } catch (err) {
      setPresetInsightError(err instanceof Error ? err.message : 'AI提案の取得に失敗しました')
    } finally {
      setIsGeneratingPresetInsight(false)
    }
  }, [customPresets])

  const handleSaveInsightPreset = useCallback((combo: RecommendedPreset, index: number) => {
    setCustomPresets((prev) => {
      if (prev.length >= 10) return prev
      const now = new Date().toISOString()
      const newPreset: CustomPreset = {
        id: `custom-${Date.now()}`,
        name: combo.name || 'AI提案プリセット',
        presetKey: '',
        tone: combo.tone || '',
        targetAudience: combo.targetAudience || '',
        platform: combo.platform || '',
        imageStyle: combo.imageStyle || '',
        ctaText: combo.ctaText || '',
        createdAt: now,
        isFavorite: false,
        useCount: 0,
        sortOrder: prev.length,
        usedAt: [],
        lastUsedAt: '',
      }
      const updated = [...prev, newPreset]
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
    setCreatedInsightIndices((prev) => new Set([...prev, index]))
  }, [])

  const handleToggleFavoriteCustomPreset = useCallback((id: string) => {
    setCustomPresets((prev) => {
      const updated = prev.map((p) => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [])

  const handleMoveCustomPreset = useCallback((id: string, direction: 'up' | 'down') => {
    setCustomPresets((prev) => {
      const sorted = [...prev].sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1
        if (!a.isFavorite && b.isFavorite) return 1
        const ao = a.sortOrder ?? Infinity
        const bo = b.sortOrder ?? Infinity
        if (ao !== bo) return ao - bo
        const ac = a.useCount ?? 0
        const bc = b.useCount ?? 0
        if (ac !== bc) return bc - ac
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      const idx = sorted.findIndex((p) => p.id === id)
      if (idx < 0) return prev
      if (direction === 'up') {
        if (idx === 0) return prev
        if (!sorted[idx].isFavorite && sorted[idx - 1].isFavorite) return prev
        ;[sorted[idx - 1], sorted[idx]] = [sorted[idx], sorted[idx - 1]]
      } else {
        if (idx === sorted.length - 1) return prev
        if (sorted[idx].isFavorite && !sorted[idx + 1].isFavorite) return prev
        ;[sorted[idx], sorted[idx + 1]] = [sorted[idx + 1], sorted[idx]]
      }
      const byId = Object.fromEntries(sorted.map((p, i) => [p.id, { ...p, sortOrder: i }]))
      const updated = prev.map((p) => byId[p.id] ?? p)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [])

  return {
    // story generation state
    aiTheme,
    setAiTheme,
    selectedPresetKey,
    setSelectedPresetKey,
    isGenerating,
    generateError,
    generateSuccess,
    autoApplyRecommendedTemplate,
    setAutoApplyRecommendedTemplate,
    autoApplyTemplateNotice,
    // AI generation history state
    aiGenerationHistory,
    importNotice,
    importInputRef,
    // custom preset state
    customPresets,
    customPresetForm,
    setCustomPresetForm,
    selectedCustomPresetId,
    setSelectedCustomPresetId,
    presetImportNotice,
    presetImportRef,
    editingCustomPresetId,
    setEditingCustomPresetId,
    editingCustomPresetForm,
    setEditingCustomPresetForm,
    // AI insight state
    presetInsight,
    isGeneratingPresetInsight,
    presetInsightError,
    createdInsightIndices,
    isAnalyticsExpanded,
    setIsAnalyticsExpanded,
    // story generation callbacks
    handleAIGenerate,
    updateLatestHistory,
    deleteAIGenerationHistoryItem,
    clearAIGenerationHistory,
    exportAIGenerationHistory,
    handleImport,
    // custom preset callbacks
    handleSaveCustomPreset,
    handleDeleteCustomPreset,
    handleUseCustomPreset,
    handleExportCustomPresets,
    handleImportCustomPresets,
    handleSaveEditCustomPreset,
    handleDuplicateCustomPreset,
    handleClearCustomPresets,
    handleExportAnalyticsCsv,
    // AI insight callbacks
    handleGeneratePresetInsight,
    handleSaveInsightPreset,
    handleToggleFavoriteCustomPreset,
    handleMoveCustomPreset,
  }
}
