import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Slide, CTAConfig, SlidesData, TemplateInfo, Template } from './types'
import { SlideList } from './components/SlideList'
import { SlidePreview } from './components/SlidePreview'
import { SlideForm } from './components/SlideForm'
import {
  TemplateVariableValues,
  extractTemplateVariables,
  applyTemplateVariables,
} from './templateVariables'
import { generateStory, AIPresetKey, CustomPreset } from './storyGenerator'
import './App.css'

const API_SERVER_ERROR = 'APIサーバーに接続できません。npm run editor で起動しているか確認してください。'

type AIPreset = {
  key: AIPresetKey
  label: string
  description: string
  themeTemplate: string
}

type RenderStatus = "none" | "completed" | "failed"

type RecommendedPreset = {
  name: string
  tone: string
  targetAudience: string
  platform: string
  imageStyle: string
  ctaText: string
  reason: string
}

type PresetInsight = {
  summary: string
  strongestPresets: string[]
  improvementIdeas: string[]
  recommendedCombinations: RecommendedPreset[]
}

type SnsCaption = {
  youtubeTitle: string
  youtubeDescription: string
  instagramCaption: string
  hashtags: string[]
}

type AIGenerationHistory = {
  id: string
  createdAt: string
  theme: string
  presetKey: AIPresetKey | ""
  templateId?: string
  templateName?: string
  slideCount: number
  imageCount: number
  renderStatus: RenderStatus
  renderOutputPath?: string
  renderErrorMessage?: string
  snsCaption?: SnsCaption
}

const AI_PRESETS: AIPreset[] = [
  {
    key: 'note',
    label: 'Note記事風',
    description: '人生・仕事・趣味に効く深掘りショート',
    themeTemplate: 'Note記事風。人生・趣味・仕事に効く、共感と学びのあるショート動画にしてください。テーマ：',
  },
  {
    key: 'singing_pr',
    label: '歌唱診断PR',
    description: '無料歌唱診断への導線を作るPR動画',
    themeTemplate: '歌唱診断PR。歌が好きな人に向けて、無料歌唱診断を受けたくなるショート動画にしてください。テーマ：',
  },
  {
    key: 'session',
    label: 'セッション告知',
    description: '音楽サークルやイベント告知向け',
    themeTemplate: 'セッション告知。初心者も経験者も参加したくなる、温かく楽しい音楽イベント告知ショートにしてください。テーマ：',
  },
  {
    key: 'youtube_shorts',
    label: 'YouTube Shorts',
    description: '冒頭の引きが強いショート動画',
    themeTemplate: 'YouTube Shorts向け。冒頭1秒で引きつけ、最後まで見たくなるショート動画にしてください。テーマ：',
  },
  {
    key: 'instagram_reels',
    label: 'Instagram Reels',
    description: '雰囲気と世界観重視のリール動画',
    themeTemplate: 'Instagram Reels向け。おしゃれで共感されやすく、保存したくなるリール動画にしてください。テーマ：',
  },
]

const PRESET_TEMPLATE_CATEGORY_MAP: Record<AIPresetKey, string[]> = {
  note:             ['note', 'essay', 'story'],
  singing_pr:       ['singing', 'pr', 'promo'],
  session:          ['session', 'event', 'community'],
  youtube_shorts:   ['shorts', 'youtube'],
  instagram_reels:  ['reels', 'instagram', 'stylish'],
}

const RECENT_KEY = 'bemystyle-reel:recent-templates'
const CUSTOM_PRESETS_KEY = 'bemystyle-reel-custom-presets'
const VALID_CUSTOM_PRESET_KEYS = new Set<string>(['note', 'singing_pr', 'session', 'youtube_shorts', 'instagram_reels', ''])
const RECENT_MAX = 5

const VIEW_MODE_KEY = 'bemystyle-reel:view-mode'
const USAGE_KEY = 'bemystyle-reel:template-usage'
const AI_GENERATION_HISTORY_KEY = 'bemystyle-reel-ai-generation-history'

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function saveRecentIds(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {}
}

function pushRecentId(id: string, current: string[]): string[] {
  return [id, ...current.filter((v) => v !== id)].slice(0, RECENT_MAX)
}

function loadViewMode(): 'grid' | 'list' {
  const v = localStorage.getItem(VIEW_MODE_KEY)
  return v === 'list' ? 'list' : 'grid'
}

function loadUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

type SortOrder = 'newest' | 'name' | 'favorite' | 'category'

type AIWorkflowStep = 'theme' | 'story' | 'images' | 'save' | 'render' | 'done'

const WORKFLOW_ORDER: AIWorkflowStep[] = ['theme', 'story', 'images', 'save', 'render', 'done']

const CATEGORIES = [
  { id: 'all',       label: 'すべて' },
  { id: 'singing',   label: '歌唱診断' },
  { id: 'community', label: 'コミュニティ' },
  { id: 'event',     label: 'イベント' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'note',      label: 'Note' },
  { id: 'campaign',  label: 'キャンペーン' },
  { id: 'other',     label: 'その他' },
] as const

type CategoryId = typeof CATEGORIES[number]['id']

interface HistoryItem {
  filename: string
  size: number
  createdAt: string
  downloadUrl: string
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    throw new Error(`${API_SERVER_ERROR}\n\n${text.slice(0, 120)}`)
  }
  return res.json()
}

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([])
  const [ctaConfig, setCtaConfig] = useState<CTAConfig>({ qrImage: 'qr-singing.png' })
  const [title, setTitle] = useState('BeMyStyle Reel')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [renderStatus, setRenderStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const [renderError, setRenderError] = useState('')
  const [isPreparingRender, setIsPreparingRender] = useState(false)
  const [renderStartedAt, setRenderStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [latestDownloadUrl, setLatestDownloadUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [snsCaption, setSnsCaption] = useState<SnsCaption | null>(null)
  const [isGeneratingSnsCaption, setIsGeneratingSnsCaption] = useState(false)
  const [snsCaptionError, setSnsCaptionError] = useState('')
  const [copiedSnsField, setCopiedSnsField] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const historyAreaRef = useRef<HTMLDivElement | null>(null)

  // テンプレート関連
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [templateConfirmPending, setTemplateConfirmPending] = useState<string | null>(null)
  const [templateHints, setTemplateHints] = useState<Template['hints'] | null>(null)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateCategory, setSaveTemplateCategory] = useState<string>('other')
  const [saveTemplateDescription, setSaveTemplateDescription] = useState('')
  const [saveTemplateStatus, setSaveTemplateStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  // テンプレート変数 (Phase11.5-C)
  const [rawTemplateSlides, setRawTemplateSlides] = useState<Slide[] | null>(null)
  const [templateVariableKeys, setTemplateVariableKeys] = useState<string[]>([])
  const [variableValues, setVariableValues] = useState<TemplateVariableValues>({})

  // AI テンプレ生成 (Phase12-A/B/C)
  const [aiTheme, setAiTheme] = useState('')
  const [selectedPresetKey, setSelectedPresetKey] = useState<AIPresetKey | ''>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [generateSuccess, setGenerateSuccess] = useState(false)

  // 自動テンプレ適用 (Phase12-M)
  const [autoApplyRecommendedTemplate, setAutoApplyRecommendedTemplate] = useState(false)
  const [autoApplyTemplateNotice, setAutoApplyTemplateNotice] = useState('')

  // AI生成履歴 (Phase12-N/O)
  const [aiGenerationHistory, setAiGenerationHistory] = useState<AIGenerationHistory[]>([])
  const [importNotice, setImportNotice] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)

  // カスタムプリセット (Phase12-P)
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

  // AI Insight (Phase12-X/Y)
  const [presetInsight, setPresetInsight] = useState<PresetInsight | null>(null)
  const [isGeneratingPresetInsight, setIsGeneratingPresetInsight] = useState(false)
  const [presetInsightError, setPresetInsightError] = useState('')
  const [createdInsightIndices, setCreatedInsightIndices] = useState<Set<number>>(new Set())
  const [isAnalyticsExpanded, setIsAnalyticsExpanded] = useState(false)

  // カスタムプリセット 編集 (Phase12-R)
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

  // AI 画像生成 (Phase12-E)
  const [imageGeneratingId, setImageGeneratingId] = useState<number | null>(null)
  const [imageGenerateErrors, setImageGenerateErrors] = useState<Record<number, string>>({})

  // AI 一括画像生成 (Phase12-F)
  const [bulkImageGenerating, setBulkImageGenerating] = useState(false)
  const [bulkImageProgress, setBulkImageProgress] = useState({ current: 0, total: 0 })
  const [bulkImageMessage, setBulkImageMessage] = useState('')

  // AIワークフロー (Phase12-H)
  const [workflowStep, setWorkflowStep] = useState<AIWorkflowStep>('theme')
  const [workflowMessage, setWorkflowMessage] = useState('')
  const [workflowError, setWorkflowError] = useState('')

  // 自動ワークフロー (Phase12-I)
  const [autoWorkflowRunning, setAutoWorkflowRunning] = useState(false)

  // 生成済み素材管理 (Phase12-G)
  const [generatedAssets, setGeneratedAssets] = useState<Array<{ filename: string; path: string; size: number; createdAt: string }>>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsMessage, setAssetsMessage] = useState('')

  // テンプレート管理 (Phase11 / Phase11.5-B)
  const [templateSearch, setTemplateSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all')
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>(() => loadRecentIds())
  const [renameTemplateId, setRenameTemplateId] = useState<string | null>(null)
  const [renameTemplateName, setRenameTemplateName] = useState('')
  const [renameTemplateStatus, setRenameTemplateStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting' | 'error'>('idle')

  // テンプレートギャラリー強化 (Phase11.5-F)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => loadViewMode())
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [usageMap, setUsageMap] = useState<Record<string, number>>(() => loadUsage())

  const fetchGeneratedAssets = useCallback(async () => {
    setAssetsLoading(true)
    try {
      const res = await fetch('/api/assets/generated')
      const data = await res.json()
      if (data.ok) setGeneratedAssets(data.assets)
    } catch (_) {}
    finally { setAssetsLoading(false) }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/render/history')
      const data = await res.json()
      if (data.ok) {
        setHistory(data.items as HistoryItem[])
        setHistoryError(false)
      } else {
        setHistoryError(true)
      }
    } catch (_) {
      setHistoryError(true)
    }
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/templates')
      const data = await res.json()
      if (data.ok) setTemplates(data.templates as TemplateInfo[])
    } catch (_) {}
  }, [])

  const confirmLoadTemplate = useCallback((id: string) => {
    setTemplateConfirmPending(id)
  }, [])

  const loadTemplate = useCallback(async (id: string) => {
    setTemplateConfirmPending(null)
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!data.ok || !data.template) return
      const tpl = data.template as Template
      const keys = extractTemplateVariables(tpl.slides)
      setRawTemplateSlides(tpl.slides)
      setTemplateVariableKeys(keys)
      setVariableValues({})
      setSlides(tpl.slides)
      setCtaConfig(tpl.cta)
      setTitle(tpl.title ?? tpl.name)
      setTemplateHints(tpl.hints ?? null)
      setSelectedTemplateId(id)
      if (tpl.slides.length > 0) setSelectedId(tpl.slides[0].id)
      setHasUnsavedChanges(true)
      setRecentTemplateIds((prev) => {
        const next = pushRecentId(id, prev)
        saveRecentIds(next)
        return next
      })
      setUsageMap((prev) => {
        const next = { ...prev, [id]: (prev[id] ?? 0) + 1 }
        localStorage.setItem(USAGE_KEY, JSON.stringify(next))
        return next
      })
    } catch (_) {}
  }, [setRecentTemplateIds])

  const saveAsTemplate = useCallback(async () => {
    if (!saveTemplateName.trim()) return
    setSaveTemplateStatus('saving')
    try {
      const variables = extractTemplateVariables(rawTemplateSlides ?? slides)
      const payload = {
        name: saveTemplateName.trim(),
        title,
        slides,
        cta: ctaConfig,
        category: saveTemplateCategory,
        description: saveTemplateDescription.trim(),
        variables,
        thumbnail: slides[0]?.image ?? '',
      }
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      setSaveTemplateStatus('ok')
      await fetchTemplates()
      setTimeout(() => {
        setSaveTemplateStatus('idle')
        setSaveTemplateModal(false)
        setSaveTemplateName('')
        setSaveTemplateCategory('other')
        setSaveTemplateDescription('')
      }, 1500)
    } catch (_) {
      setSaveTemplateStatus('error')
      setTimeout(() => setSaveTemplateStatus('idle'), 3000)
    }
  }, [saveTemplateName, saveTemplateCategory, saveTemplateDescription, title, slides, ctaConfig, rawTemplateSlides, fetchTemplates])

  const duplicateTemplate = useCallback(async (id: string) => {
    try {
      const res = await fetch('/api/templates/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      await fetchTemplates()
    } catch (_) {}
  }, [fetchTemplates])

  const deleteTemplate = useCallback(async (id: string) => {
    setDeleteStatus('deleting')
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      if (selectedTemplateId === id) setSelectedTemplateId('')
      setDeleteConfirmId(null)
      setDeleteStatus('idle')
      await fetchTemplates()
    } catch (_) {
      setDeleteStatus('error')
      setTimeout(() => setDeleteStatus('idle'), 3000)
    }
  }, [fetchTemplates, selectedTemplateId])

  const renameTemplate = useCallback(async () => {
    if (!renameTemplateId || !renameTemplateName.trim()) return
    setRenameTemplateStatus('saving')
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(renameTemplateId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameTemplateName.trim() }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      setRenameTemplateStatus('ok')
      await fetchTemplates()
      setTimeout(() => {
        setRenameTemplateStatus('idle')
        setRenameTemplateId(null)
        setRenameTemplateName('')
      }, 1200)
    } catch (_) {
      setRenameTemplateStatus('error')
      setTimeout(() => setRenameTemplateStatus('idle'), 3000)
    }
  }, [renameTemplateId, renameTemplateName, fetchTemplates])

  const handleVariableChange = useCallback((key: string, value: string) => {
    setVariableValues((prev) => {
      const next = { ...prev, [key]: value }
      if (rawTemplateSlides) {
        setSlides(applyTemplateVariables(rawTemplateSlides, next))
        setHasUnsavedChanges(true)
      }
      return next
    })
  }, [rawTemplateSlides])

  const handleAIGenerate = useCallback(async (): Promise<boolean> => {
    if (!aiTheme.trim() || isGenerating) return false
    setIsGenerating(true)
    setGenerateError('')
    setGenerateSuccess(false)
    try {
      const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId)
      const story = await generateStory(
        aiTheme.trim(),
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

      // 1. variables を更新
      const next: TemplateVariableValues = { ...variableValues }
      for (const [key, value] of Object.entries(story.variables)) {
        if (templateVariableKeys.includes(key)) {
          next[key] = value
        }
      }
      setVariableValues(next)

      // 2. rawTemplateSlides に variables 反映
      const baseSlides = rawTemplateSlides
        ? applyTemplateVariables(rawTemplateSlides, next)
        : slides

      // 3. story.slides を上書き
      const nextSlides = baseSlides.map((slide, index) => {
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
        const next = [historyEntry, ...prev].slice(0, 20)
        try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(next)) } catch {}
        return next
      })

      if (selectedCustomPresetId) {
        const now = new Date().toISOString()
        setCustomPresets((prev) => {
          const next = prev.map((p) => {
            if (p.id !== selectedCustomPresetId) return p
            const logs = [...(p.usedAt ?? []), now].slice(-100)
            return { ...p, useCount: (p.useCount ?? 0) + 1, usedAt: logs, lastUsedAt: now }
          })
          try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
          return next
        })
      }

      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI生成に失敗しました'
      setGenerateError(msg)
      return false
    } finally {
      setIsGenerating(false)
    }
  }, [aiTheme, selectedPresetKey, isGenerating, variableValues, templateVariableKeys, rawTemplateSlides, slides, selectedTemplateId, templates, customPresets, selectedCustomPresetId])

  const deleteAIGenerationHistoryItem = useCallback((id: string) => {
    setAiGenerationHistory((prev) => {
      const next = prev.filter((h) => h.id !== id)
      try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const clearAIGenerationHistory = useCallback(() => {
    setAiGenerationHistory([])
    try { localStorage.removeItem(AI_GENERATION_HISTORY_KEY) } catch {}
  }, [])

  const updateLatestHistory = useCallback((patch: Partial<AIGenerationHistory>) => {
    setAiGenerationHistory((prev) => {
      if (prev.length === 0) return prev
      const next = [{ ...prev[0], ...patch }, ...prev.slice(1)]
      try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
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
      const next = [newPreset, ...prev].slice(0, 10)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setCustomPresetForm({ name: '', presetKey: '', tone: '', targetAudience: '', platform: '', imageStyle: '', ctaText: '' })
  }, [customPresetForm])

  const handleDeleteCustomPreset = useCallback((id: string) => {
    setCustomPresets((prev) => {
      const next = prev.filter((p) => p.id !== id)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setSelectedCustomPresetId((current) => current === id ? '' : current)
  }, [])

  const handleUseCustomPreset = useCallback((preset: CustomPreset) => {
    setSelectedCustomPresetId(preset.id)
    setSelectedPresetKey(preset.presetKey)
    setWorkflowMessage('カスタムプリセットを適用しました。')
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
          const next = [...newOnes, ...prev].slice(0, 10)
          try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
          return next
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
      const next = prev.map((preset) =>
        preset.id === editingCustomPresetId
          ? { ...preset, ...editingCustomPresetForm }
          : preset
      )
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
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
      const next = [...prev, newPreset]
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
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
      const next = [...prev, newPreset]
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setCreatedInsightIndices((prev) => new Set([...prev, index]))
  }, [])

  const handleToggleFavoriteCustomPreset = useCallback((id: string) => {
    setCustomPresets((prev) => {
      const next = prev.map((p) => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
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
      const next = prev.map((p) => byId[p.id] ?? p)
      try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

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
          const next = [...validated, ...prev].filter((h) => {
            if (seen.has(h.id)) return false
            seen.add(h.id)
            return true
          }).slice(0, 20)
          try { localStorage.setItem(AI_GENERATION_HISTORY_KEY, JSON.stringify(next)) } catch {}
          return next
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

  const handleReuseHistory = useCallback((h: AIGenerationHistory) => {
    setAiTheme(h.theme)
    setSelectedPresetKey(h.presetKey)
    setWorkflowStep('theme')
    setSnsCaption(h.snsCaption ?? null)
    if (h.templateId && templates.some((t) => t.id === h.templateId)) {
      confirmLoadTemplate(h.templateId)
      setWorkflowMessage('履歴からテーマとテンプレートを復元しました。')
    } else if (h.templateId) {
      setWorkflowMessage('テンプレートが見つからないため、テーマのみ復元しました。')
    } else {
      setWorkflowMessage('履歴からテーマを復元しました。')
    }
  }, [templates, confirmLoadTemplate])

  const deleteGeneratedAsset = useCallback(async (filename: string) => {
    try {
      const res = await fetch(`/api/assets/generated/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      setGeneratedAssets((prev) => prev.filter((a) => a.filename !== filename))
      setAssetsMessage('削除しました')
    } catch (err) {
      setAssetsMessage(err instanceof Error ? err.message : '削除に失敗しました')
    }
    setTimeout(() => setAssetsMessage(''), 3000)
  }, [])

  const deleteUnusedAssets = useCallback(async (usedSet: Set<string>) => {
    const unused = generatedAssets.filter((a) => !usedSet.has(a.path))
    if (unused.length === 0) { setAssetsMessage('未使用画像はありません'); setTimeout(() => setAssetsMessage(''), 3000); return }
    for (const asset of unused) {
      try {
        await fetch(`/api/assets/generated/${encodeURIComponent(asset.filename)}`, { method: 'DELETE' })
      } catch (_) {}
    }
    setGeneratedAssets((prev) => prev.filter((a) => usedSet.has(a.path)))
    setAssetsMessage(`${unused.length}枚の未使用画像を削除しました`)
    setTimeout(() => setAssetsMessage(''), 3000)
  }, [generatedAssets])

  const toggleFavorite = useCallback(async (id: string, current: boolean) => {
    try {
      await fetch(`/api/templates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !current }),
      })
      await fetchTemplates()
    } catch (_) {}
  }, [fetchTemplates])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

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

  // 自動テンプレ適用 (Phase12-M)
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

  useEffect(() => {
    fetch('/data/slides.json')
      .then((r) => r.json())
      .then((data: SlidesData) => {
        setSlides(data.slides)
        setCtaConfig(data.cta)
        setTitle(data.title)
        if (data.slides.length > 0) setSelectedId(data.slides[0].id)
      })
      .catch(() => alert('slides.json の読み込みに失敗しました。'))
      .finally(() => setLoading(false))
    fetchHistory()
    fetchTemplates()
    fetchGeneratedAssets()
  }, [fetchHistory, fetchTemplates, fetchGeneratedAssets])

  const usedGeneratedImages = new Set(
    slides.map((s) => s.image).filter((img): img is string => !!img?.startsWith('generated/'))
  )

  const selectedSlide = slides.find((s) => s.id === selectedId) ?? null
  const selectedIdx = slides.findIndex((s) => s.id === selectedId)

  const updateSlide = useCallback((id: number, changes: Partial<Slide>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)))
    setHasUnsavedChanges(true)
  }, [])

  const handleGenerateImage = useCallback(async (slideId: number, imagePrompt: string) => {
    setImageGeneratingId(slideId)
    setImageGenerateErrors((prev) => { const next = { ...prev }; delete next[slideId]; return next })
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: imagePrompt }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? '画像生成に失敗しました')
      updateSlide(slideId, { image: data.image })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '画像生成に失敗しました'
      setImageGenerateErrors((prev) => ({ ...prev, [slideId]: msg }))
    } finally {
      setImageGeneratingId(null)
    }
  }, [updateSlide])

  const handleGenerateAllImages = useCallback(async (): Promise<boolean> => {
    const targets = slides.filter((slide) => slide.imagePrompt)
    if (targets.length === 0) return false

    setBulkImageGenerating(true)
    setBulkImageProgress({ current: 0, total: targets.length })
    setBulkImageMessage('')

    try {
      let nextSlides = [...slides]

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        setBulkImageProgress({ current: i + 1, total: targets.length })

        const response = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: target.imagePrompt }),
        })

        if (!response.ok) throw new Error('画像生成に失敗しました')

        const data = await response.json()
        nextSlides = nextSlides.map((slide) =>
          slide.id === target.id ? { ...slide, image: data.image } : slide
        )
        setSlides(nextSlides)
      }

      updateLatestHistory({
        imageCount: nextSlides.filter((s) => s.image?.startsWith('generated/')).length,
      })
      setBulkImageMessage('14枚のAI画像生成が完了しました')
      return true
    } catch (_) {
      setBulkImageMessage('一部の画像生成に失敗しました。生成済み画像は保持されています。')
      return false
    } finally {
      setBulkImageGenerating(false)
    }
  }, [slides, updateLatestHistory])

  const toggleVisible = useCallback((id: number) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)))
    setHasUnsavedChanges(true)
  }, [])

  const moveSlide = useCallback((fromIdx: number, toIdx: number) => {
    setSlides((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleCtaChange = useCallback((config: CTAConfig) => {
    setCtaConfig(config)
    setHasUnsavedChanges(true)
  }, [])

  const saveToServer = useCallback(async (): Promise<boolean> => {
    const data: SlidesData = { title, slides, cta: ctaConfig }
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = await parseJsonResponse(res)
      if (!res.ok) throw new Error((body.message as string) ?? `HTTP ${res.status}`)
      setSaveStatus('ok')
      setHasUnsavedChanges(false)
      setTimeout(() => setSaveStatus('idle'), 2500)
      return true
    } catch (err) {
      setSaveError(String(err))
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
      return false
    }
  }, [title, slides, ctaConfig])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/render/status')
        const data = await parseJsonResponse(res)
        const status = data.status as string
        setRenderStatus(status as 'idle' | 'running' | 'completed' | 'failed')
        if (status === 'completed' || status === 'failed') {
          stopPolling()
          if (status === 'failed') {
            const errMsg = (data.error as string) ?? '不明なエラー'
            setRenderError(errMsg)
            updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
          }
          if (status === 'completed') {
            fetchHistory()
            const url = data.downloadUrl as string
            if (url) setLatestDownloadUrl(url)
            updateLatestHistory({ renderStatus: 'completed', renderOutputPath: url ?? undefined })
          }
        }
      } catch (err) {
        stopPolling()
        const errMsg = String(err)
        setRenderStatus('failed')
        setRenderError(errMsg)
        updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
      }
    }, 2000)
  }, [stopPolling, fetchHistory, updateLatestHistory])

  useEffect(() => {
    const active = isPreparingRender || renderStatus === 'running'
    if (!active || renderStartedAt === null) return
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - renderStartedAt) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [isPreparingRender, renderStatus, renderStartedAt])

  const startRender = useCallback(async () => {
    setRenderError('')
    setRenderStatus('idle')
    setRenderStartedAt(Date.now())
    setElapsedSec(0)

    if (slides.length === 0) {
      setRenderStatus('failed')
      setRenderError('スライドがありません。先にストーリーを生成してください。')
      return
    }

    if (hasUnsavedChanges) {
      setIsPreparingRender(true)
      const ok = await saveToServer()
      setIsPreparingRender(false)
      if (!ok) return
    }

    try {
      const res = await fetch('/api/render', { method: 'POST' })
      const data = await parseJsonResponse(res)
      if (!res.ok) {
        setRenderStatus('failed')
        setRenderError((data.message as string) ?? `HTTP ${res.status}`)
        return
      }
      setRenderStatus('running')
      startPolling()
    } catch (err) {
      setRenderStatus('failed')
      setRenderError(String(err))
    }
  }, [startPolling, hasUnsavedChanges, saveToServer, slides.length])

  const handleWorkflowStory = useCallback(async () => {
    setWorkflowError('')
    const ok = await handleAIGenerate()
    if (ok) setWorkflowStep('images')
    else setWorkflowError('このステップで失敗しました。内容を確認して再試行してください。')
  }, [handleAIGenerate])

  const handleWorkflowImages = useCallback(async () => {
    setWorkflowError('')
    const ok = await handleGenerateAllImages()
    if (ok) setWorkflowStep('save')
    else setWorkflowError('このステップで失敗しました。内容を確認して再試行してください。')
  }, [handleGenerateAllImages])

  const handleWorkflowSave = useCallback(async () => {
    setWorkflowError('')
    const ok = await saveToServer()
    if (ok) setWorkflowStep('render')
    else setWorkflowError('このステップで失敗しました。内容を確認して再試行してください。')
  }, [saveToServer])

  const handleWorkflowRender = useCallback(async () => {
    setWorkflowError('')
    await startRender()
    setWorkflowStep('done')
  }, [startRender])

  const handleAutoWorkflow = useCallback(async () => {
    if (!aiTheme.trim()) {
      setWorkflowError('テーマを入力してください。')
      return
    }

    setAutoWorkflowRunning(true)
    setWorkflowError('')
    setWorkflowMessage('AI自動生成を開始しました。')

    try {
      setWorkflowStep('story')
      setWorkflowMessage('14枚ストーリーを生成しています...')
      const storyOk = await handleAIGenerate()
      if (!storyOk) throw new Error('ストーリー生成に失敗しました。')

      setWorkflowStep('images')
      setWorkflowMessage('14枚AI画像を生成しています...')
      const imagesOk = await handleGenerateAllImages()
      if (!imagesOk) throw new Error('画像生成に失敗しました。')

      setWorkflowStep('save')
      setWorkflowMessage('スライドを保存しています...')
      const saveOk = await saveToServer()
      if (!saveOk) throw new Error('保存に失敗しました。')

      setWorkflowStep('render')
      setWorkflowMessage('動画生成を開始しています...')
      startRender()

      setWorkflowStep('done')
      setWorkflowMessage('AI動画生成フローを開始しました。')
    } catch (error) {
      setWorkflowError(
        error instanceof Error ? error.message : 'AI自動生成に失敗しました。'
      )
    } finally {
      setAutoWorkflowRunning(false)
    }
  }, [aiTheme, handleAIGenerate, handleGenerateAllImages, saveToServer, startRender])

  const downloadVideo = useCallback(() => {
    window.location.href = latestDownloadUrl ?? '/api/render/download'
  }, [latestDownloadUrl])

  const latestViewUrl = latestDownloadUrl
    ? latestDownloadUrl.replace('/api/render/download/', '/api/render/view/')
    : '/api/render/view'

  const copyRenderUrl = useCallback(async () => {
    const url = latestDownloadUrl ?? '/api/render/download'
    const fullUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch {
      // clipboard API 非対応環境では何もしない
    }
  }, [latestDownloadUrl])

  const scrollToHistory = useCallback(() => {
    historyAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const generateSnsCaption = useCallback(async () => {
    setIsGeneratingSnsCaption(true)
    setSnsCaptionError('')
    setSnsCaption(null)
    const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId) ?? null
    try {
      const res = await fetch('/api/sns-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides, title, selectedPresetKey, selectedCustomPreset }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? '不明なエラー')
      const caption = data.caption as SnsCaption
      setSnsCaption(caption)
      updateLatestHistory({ snsCaption: caption })
    } catch (err) {
      setSnsCaptionError(String(err instanceof Error ? err.message : err))
    } finally {
      setIsGeneratingSnsCaption(false)
    }
  }, [slides, title, selectedPresetKey, customPresets, selectedCustomPresetId, updateLatestHistory])

  const copySnsText = useCallback(async (field: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSnsField(field)
      setTimeout(() => setCopiedSnsField(null), 2000)
    } catch {
      // clipboard API 非対応環境では無視
    }
  }, [])

  const formatHistoryDate = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

  const downloadJSON = useCallback(() => {
    const data: SlidesData = { title, slides, cta: ctaConfig }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'slides.json'
    a.click()
    URL.revokeObjectURL(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }, [title, slides, ctaConfig])

  const recentTemplates = recentTemplateIds
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is TemplateInfo => t !== undefined)

  const filteredTemplates = templates
    .filter((t) => {
      const catMatch = selectedCategory === 'all' || (t.category ?? 'other') === selectedCategory
      const searchMatch = !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())
      return catMatch && searchMatch
    })
    .sort((a, b) => {
      switch (sortOrder) {
        case 'name':
          return a.name.localeCompare(b.name, 'ja')
        case 'favorite':
          if (a.favorite && !b.favorite) return -1
          if (!a.favorite && b.favorite) return 1
          return 0
        case 'category':
          return (a.category ?? 'other').localeCompare(b.category ?? 'other')
        default:
          return 0
      }
    })

  const categoryCounts: Record<string, number> = { all: templates.length }
  for (const t of templates) {
    const cat = t.category ?? 'other'
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1
  }

  const templateStats = {
    total: templates.length,
    favorites: templates.filter((t) => t.favorite).length,
    categoryCount: new Set(templates.map((t) => t.category ?? 'other')).size,
  }

  const popularTemplates = [...templates]
    .filter((t) => (usageMap[t.id] ?? 0) > 0)
    .sort((a, b) => (usageMap[b.id] ?? 0) - (usageMap[a.id] ?? 0))
    .slice(0, 3)

  const sortedCustomPresets = useMemo(() => {
    return [...customPresets].sort((a, b) => {
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
  }, [customPresets])

  const customPresetAnalytics = useMemo(() => {
    if (customPresets.length === 0) return null
    const now = Date.now()
    const todayStr = new Date().toISOString().slice(0, 10)
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

    const totalUse = customPresets.reduce((s, p) => s + (p.useCount ?? 0), 0)
    const favoriteCount = customPresets.filter((p) => p.isFavorite).length

    let last7Days = 0
    let todayCount = 0
    for (const p of customPresets) {
      for (const ts of p.usedAt ?? []) {
        const t = new Date(ts).getTime()
        if (t >= sevenDaysAgo) last7Days++
        if (ts.slice(0, 10) === todayStr) todayCount++
      }
    }

    const top3 = [...customPresets]
      .filter((p) => (p.useCount ?? 0) > 0)
      .sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0))
      .slice(0, 3)

    const recentlyUsed = [...customPresets]
      .filter((p) => p.lastUsedAt)
      .sort((a, b) => new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime())
      .slice(0, 5)

    const usageByDay: { date: string; label: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000)
      usageByDay.push({ date: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, count: 0 })
    }
    const ctaMap: Record<string, number> = {}
    const styleMap: Record<string, number> = {}
    for (const p of customPresets) {
      const cnt = p.useCount ?? 0
      if (p.ctaText) ctaMap[p.ctaText] = (ctaMap[p.ctaText] ?? 0) + cnt
      if (p.imageStyle) styleMap[p.imageStyle] = (styleMap[p.imageStyle] ?? 0) + cnt
      for (const ts of p.usedAt ?? []) {
        const day = usageByDay.find((d) => d.date === ts.slice(0, 10))
        if (day) day.count++
      }
    }
    const chartMax = Math.max(...usageByDay.map((d) => d.count), 1)
    const topCta = Object.entries(ctaMap).sort((a, b) => b[1] - a[1])[0]
    const topStyle = Object.entries(styleMap).sort((a, b) => b[1] - a[1])[0]
    return { totalUse, favoriteCount, top3, recentlyUsed, last7Days, todayCount, usageByDay, chartMax, topCta, topStyle }
  }, [customPresets])

  const suggestedTemplates = useMemo(() => {
    if (!selectedPresetKey) return null
    const categories = PRESET_TEMPLATE_CATEGORY_MAP[selectedPresetKey]
    const matched = templates.filter((t) => categories.includes(t.category ?? '')).slice(0, 3)
    if (matched.length > 0) return { items: matched, isFallback: false }
    const fallback = [...templates]
      .sort((a, b) => (usageMap[b.id] ?? 0) - (usageMap[a.id] ?? 0))
      .slice(0, 3)
    return { items: fallback, isFallback: true }
  }, [selectedPresetKey, templates, usageMap])

  const hasTheme = aiTheme.trim().length > 0
  const hasStory = slides.length > 0 && slides.every((slide) => slide.imagePrompt)
  const hasGeneratedImages = slides.length > 0 && slides.every((slide) => slide.image?.startsWith('generated/'))

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
  }, [slides, hasUnsavedChanges])

  const isRendering = isPreparingRender || renderStatus === 'running'

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

  const deleteTargetName = deleteConfirmId
    ? (templates.find((t) => t.id === deleteConfirmId)?.name ?? deleteConfirmId)
    : ''

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-dot" />
        読み込み中...
      </div>
    )
  }

  return (
    <div className="app">
      {/* ── テンプレート読み込み確認 ── */}
      {templateConfirmPending && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレートを読み込みますか？</p>
            <p className="modal-body">現在の編集内容は破棄されます。</p>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setTemplateConfirmPending(null)}>
                キャンセル
              </button>
              <button className="btn-modal-ok" onClick={() => loadTemplate(templateConfirmPending)}>
                読み込む
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── テンプレート保存モーダル ── */}
      {saveTemplateModal && (
        <div className="modal-overlay">
          <div className="modal modal--wide">
            <p className="modal-title">テンプレートとして保存</p>
            <input
              className="modal-input"
              type="text"
              placeholder="テンプレート名を入力"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveAsTemplate()}
              autoFocus
            />
            <select
              className="modal-select"
              value={saveTemplateCategory}
              onChange={(e) => setSaveTemplateCategory(e.target.value)}
            >
              {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <textarea
              className="modal-textarea"
              placeholder="説明文（任意）"
              value={saveTemplateDescription}
              onChange={(e) => setSaveTemplateDescription(e.target.value)}
              rows={3}
            />
            {saveTemplateStatus === 'error' && (
              <p className="save-error">保存に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={() => {
                  setSaveTemplateModal(false)
                  setSaveTemplateName('')
                  setSaveTemplateCategory('other')
                  setSaveTemplateDescription('')
                  setSaveTemplateStatus('idle')
                }}
                disabled={saveTemplateStatus === 'saving'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-ok"
                onClick={saveAsTemplate}
                disabled={!saveTemplateName.trim() || saveTemplateStatus === 'saving'}
              >
                {saveTemplateStatus === 'saving' ? '保存中...' : saveTemplateStatus === 'ok' ? '✓ 保存完了' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 名前変更モーダル ── */}
      {renameTemplateId && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレート名を変更</p>
            <input
              className="modal-input"
              type="text"
              placeholder="新しいテンプレート名"
              value={renameTemplateName}
              onChange={(e) => setRenameTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && renameTemplate()}
              autoFocus
            />
            {renameTemplateStatus === 'error' && (
              <p className="save-error">名前変更に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={() => { setRenameTemplateId(null); setRenameTemplateName(''); setRenameTemplateStatus('idle') }}
                disabled={renameTemplateStatus === 'saving'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-ok"
                onClick={renameTemplate}
                disabled={!renameTemplateName.trim() || renameTemplateStatus === 'saving'}
              >
                {renameTemplateStatus === 'saving' ? '保存中...' : renameTemplateStatus === 'ok' ? '✓ 完了' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 削除確認ダイアログ ── */}
      {deleteConfirmId && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレートを削除しますか？</p>
            <p className="modal-body">「{deleteTargetName}」を削除します。この操作は取り消せません。</p>
            {deleteStatus === 'error' && (
              <p className="save-error">削除に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={() => { setDeleteConfirmId(null); setDeleteStatus('idle') }}
                disabled={deleteStatus === 'deleting'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-delete"
                onClick={() => deleteTemplate(deleteConfirmId)}
                disabled={deleteStatus === 'deleting'}
              >
                {deleteStatus === 'deleting' ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 左パネル: スライド一覧 ── */}
      <div className="panel panel-left">
        <div className="panel-header">
          <div className="panel-header-left">
            <span className="panel-title">スライド一覧</span>
            {hasUnsavedChanges && <span className="unsaved-badge">未保存</span>}
          </div>
          <span className="panel-badge">{slides.length}枚</span>
        </div>

        {/* テンプレートセクション */}
        <div className="template-section">
          <div className="template-header-row">
            <p className="template-label">テンプレート</p>
            <input
              className="template-search"
              type="text"
              placeholder="検索..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
            />
            <div className="template-view-toggle">
              <button
                className={`template-view-btn${viewMode === 'grid' ? ' template-view-btn--active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="グリッド表示"
              >⊞</button>
              <button
                className={`template-view-btn${viewMode === 'list' ? ' template-view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
                title="リスト表示"
              >☰</button>
            </div>
          </div>
          {templates.length > 0 && (
            <div className="template-stats">
              <span>テンプレート数 <strong>{templateStats.total}</strong></span>
              <span>お気に入り <strong>{templateStats.favorites}</strong></span>
              <span>カテゴリ数 <strong>{templateStats.categoryCount}</strong></span>
            </div>
          )}
          {recentTemplates.length > 0 && (
            <div className="template-recent">
              <p className="template-recent-label">最近使った</p>
              <div className="template-recent-list">
                {recentTemplates.map((t) => (
                  <button
                    key={t.id}
                    className={`template-recent-btn${t.id === selectedTemplateId ? ' template-recent-btn--active' : ''}`}
                    onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                    disabled={isRendering}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {popularTemplates.length > 0 && (
            <div className="template-popular">
              <p className="template-popular-label">人気テンプレ</p>
              <div className="template-popular-list">
                {popularTemplates.map((t, i) => (
                  <button
                    key={t.id}
                    className="template-popular-item"
                    onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                    disabled={isRendering}
                  >
                    <span className="template-popular-rank">{i + 1}位</span>
                    <span className="template-popular-name">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="template-sort-row">
            <select
              className="template-sort-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            >
              <option value="newest">最新</option>
              <option value="name">名前順</option>
              <option value="favorite">お気に入り優先</option>
              <option value="category">カテゴリ順</option>
            </select>
          </div>
          <div className="template-category-filter">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`template-cat-btn${selectedCategory === cat.id ? ' template-cat-btn--active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.label}({categoryCounts[cat.id] ?? 0})
              </button>
            ))}
          </div>
          <div className={`template-list${viewMode === 'list' ? ' template-list--list' : ''}`}>
            {filteredTemplates.map((t) => {
              const isCustom = t.id.startsWith('custom-')
              const isLoaded = t.id === selectedTemplateId
              const hasMeta = !!(t.description || (t.variables && t.variables.length > 0))
              return (
                <div key={t.id} className={`template-card${isLoaded ? ' template-card--active' : ''}`}>
                  <button
                    className="template-card-thumb-btn"
                    onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                    disabled={isRendering}
                    title={`${t.name} を読み込む`}
                  >
                    {t.thumbnail ? (
                      <img src={t.thumbnail} alt={t.name} className="template-card-img" />
                    ) : (
                      <div className="template-card-no-img">No Image</div>
                    )}
                  </button>
                  <div className="template-card-body">
                    <div className="template-item-row">
                      <button
                        className={`template-fav-btn${t.favorite ? ' template-fav-btn--active' : ''}`}
                        onClick={() => toggleFavorite(t.id, !!t.favorite)}
                        disabled={isRendering}
                        title="お気に入り"
                      >
                        {t.favorite ? '★' : '☆'}
                      </button>
                      <button
                        className="template-name-btn"
                        onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                        disabled={isRendering}
                        title={t.name}
                      >
                        {t.name}
                      </button>
                      <button
                        className="template-action-btn"
                        onClick={() => duplicateTemplate(t.id)}
                        disabled={isRendering}
                        title="複製"
                      >
                        複製
                      </button>
                      {isCustom && (
                        <>
                          <button
                            className="template-action-btn"
                            onClick={() => {
                              setRenameTemplateId(t.id)
                              setRenameTemplateName(t.name)
                              setRenameTemplateStatus('idle')
                            }}
                            disabled={isRendering}
                            title="名前変更"
                          >
                            ✏
                          </button>
                          <button
                            className="template-action-btn template-action-btn--danger"
                            onClick={() => setDeleteConfirmId(t.id)}
                            disabled={isRendering}
                            title="削除"
                          >
                            削除
                          </button>
                        </>
                      )}
                    </div>
                    {hasMeta && (
                      <div className="template-card-meta">
                        {t.description && (
                          <p className="template-item-desc">{t.description}</p>
                        )}
                        {t.variables && t.variables.length > 0 && (
                          <p className="template-item-vars">変数: {t.variables.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {filteredTemplates.length === 0 && (
              <p className="template-empty">テンプレートが見つかりません</p>
            )}
          </div>
          {templateHints && (
            <div className="template-hints">
              <span>推奨</span>
              <span>画像{templateHints.imageCount}枚</span>
              <span>動画{templateHints.durationSec}秒</span>
              <span>{templateHints.ctaNote}</span>
            </div>
          )}
          {templateVariableKeys.length > 0 && (
            <div className="ai-generator">
              <p className="ai-generator-label">用途プリセット</p>
              <div className="ai-preset-list">
                {AI_PRESETS.map((preset) => {
                  const isActive = selectedPresetKey === preset.key
                  return (
                    <button
                      key={preset.key}
                      className={`ai-preset-btn${isActive ? ' ai-preset-btn--active' : ''}`}
                      onClick={() => setSelectedPresetKey(isActive ? '' : preset.key)}
                      disabled={isGenerating || autoWorkflowRunning || isRendering}
                      title={preset.description}
                    >
                      {isActive && <span className="ai-preset-badge">選択中</span>}
                      {preset.label}
                    </button>
                  )
                })}
              </div>
              <label className="ai-auto-apply-toggle">
                <input
                  type="checkbox"
                  checked={autoApplyRecommendedTemplate}
                  onChange={(e) => setAutoApplyRecommendedTemplate(e.target.checked)}
                  disabled={isGenerating || autoWorkflowRunning || isRendering}
                />
                おすすめテンプレートを自動で使う
              </label>
              {autoApplyRecommendedTemplate && (
                <p className="ai-auto-apply-desc">
                  プリセット選択時に、最適なテンプレートを自動で読み込みます。
                </p>
              )}
              {autoApplyTemplateNotice && (
                <p className={`ai-auto-apply-notice${autoApplyTemplateNotice.includes('見つかりません') ? ' ai-auto-apply-notice--warn' : ' ai-auto-apply-notice--ok'}`}>
                  {autoApplyTemplateNotice}
                </p>
              )}
              {selectedPresetKey && (
                <p className="ai-preset-desc">
                  {AI_PRESETS.find((p) => p.key === selectedPresetKey)?.description}
                </p>
              )}
              {suggestedTemplates && suggestedTemplates.items.length > 0 && (
                <div className="ai-recommended">
                  <p className="ai-recommended-label">
                    {suggestedTemplates.isFallback ? '人気テンプレート（該当なし時）' : 'おすすめテンプレート'}
                  </p>
                  {suggestedTemplates.items.map((t) => (
                    <div key={t.id} className="ai-recommended-card">
                      <div className="ai-recommended-card-header">
                        <span className="ai-recommended-card-name" title={t.name}>{t.name}</span>
                        {t.category && (
                          <span className="ai-recommended-card-cat">{t.category}</span>
                        )}
                      </div>
                      {t.description && (
                        <p className="ai-recommended-card-desc">{t.description}</p>
                      )}
                      <button
                        className="ai-recommended-use-btn"
                        onClick={() => !isRendering && confirmLoadTemplate(t.id)}
                        disabled={isRendering || autoWorkflowRunning}
                      >
                        このテンプレートを使う
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* カスタムプリセット (Phase12-P/Q) */}
              <div className="custom-preset-section">
                <div className="custom-preset-header-row" style={{ marginTop: 10 }}>
                  <p className="ai-generator-label" style={{ margin: 0 }}>カスタムプリセット</p>
                  <div className="custom-preset-header-actions">
                    <button
                      className="custom-preset-io-btn"
                      onClick={handleExportCustomPresets}
                      disabled={customPresets.length === 0}
                      title="カスタムプリセットをJSONでダウンロード"
                    >
                      エクスポート
                    </button>
                    <button
                      className="custom-preset-io-btn"
                      onClick={() => presetImportRef.current?.click()}
                      title="JSONファイルからインポート"
                    >
                      インポート
                    </button>
                    <input
                      ref={presetImportRef}
                      type="file"
                      accept=".json"
                      style={{ display: 'none' }}
                      onChange={handleImportCustomPresets}
                    />
                    <button
                      className="custom-preset-io-btn custom-preset-io-btn--danger"
                      onClick={handleClearCustomPresets}
                      disabled={customPresets.length === 0}
                      title="保存済みプリセットをすべて削除"
                    >
                      すべて削除
                    </button>
                  </div>
                </div>
                {customPresetAnalytics && (
                  <div className="cp-analytics-card">
                    <div className="cp-analytics-header">
                      <p className="cp-analytics-title">📊 CustomPreset Analytics</p>
                      <button
                        className="cp-analytics-expand-btn"
                        onClick={() => setIsAnalyticsExpanded((v) => !v)}
                      >
                        {isAnalyticsExpanded ? '閉じる' : '詳細を見る'}
                      </button>
                    </div>
                    <div className="cp-analytics-summary">
                      <span>総プリセット数：<strong>{customPresets.length}</strong></span>
                      <span>Favorite：<strong>{customPresetAnalytics.favoriteCount}</strong></span>
                      <span>総使用回数：<strong>{customPresetAnalytics.totalUse}</strong></span>
                      <span>今日：<strong>{customPresetAnalytics.todayCount}</strong></span>
                      <span>直近7日：<strong>{customPresetAnalytics.last7Days}</strong></span>
                    </div>
                    {isAnalyticsExpanded && (
                      <div className="cp-analytics-details">
                        <div className="cp-analytics-block">
                          <p className="cp-analytics-block-label">📈 直近7日間の使用推移</p>
                          <div className="cp-analytics-chart">
                            {customPresetAnalytics.usageByDay.map((day) => (
                              <div key={day.date} className="cp-analytics-bar">
                                <span className="cp-analytics-bar-count">{day.count > 0 ? day.count : ''}</span>
                                <div
                                  className="cp-analytics-bar-fill"
                                  style={{ '--bar-h': `${Math.round((day.count / customPresetAnalytics.chartMax) * 40)}px` } as React.CSSProperties}
                                />
                                <span className="cp-analytics-bar-label">{day.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {customPresetAnalytics.top3.length > 0 && (
                          <div className="cp-analytics-block">
                            <p className="cp-analytics-block-label">よく使うプリセット TOP3</p>
                            {customPresetAnalytics.top3.map((p, i) => (
                              <div key={p.id} className="cp-analytics-row">
                                <span className="cp-analytics-rank">{i + 1}.</span>
                                <span className="cp-analytics-name">{p.name}</span>
                                <span className="cp-analytics-count">{p.useCount}回</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {customPresetAnalytics.recentlyUsed.length > 0 && (
                          <div className="cp-analytics-block">
                            <p className="cp-analytics-block-label">最近使われたプリセット</p>
                            {customPresetAnalytics.recentlyUsed.map((p) => (
                              <div key={p.id} className="cp-analytics-row">
                                <span className="cp-analytics-name">{p.name}</span>
                                <span className="cp-analytics-last-used">{new Date(p.lastUsedAt!).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {customPresetAnalytics.topCta && customPresetAnalytics.topCta[1] > 0 && (
                          <div className="cp-analytics-block">
                            <p className="cp-analytics-block-label">人気CTA</p>
                            <div className="cp-analytics-row">
                              <span className="cp-analytics-name">{customPresetAnalytics.topCta[0]}</span>
                              <span className="cp-analytics-count">{customPresetAnalytics.topCta[1]}回</span>
                            </div>
                          </div>
                        )}
                        {customPresetAnalytics.topStyle && customPresetAnalytics.topStyle[1] > 0 && (
                          <div className="cp-analytics-block">
                            <p className="cp-analytics-block-label">人気画像スタイル</p>
                            <div className="cp-analytics-row">
                              <span className="cp-analytics-name">{customPresetAnalytics.topStyle[0]}</span>
                              <span className="cp-analytics-count">{customPresetAnalytics.topStyle[1]}回</span>
                            </div>
                          </div>
                        )}
                        <div className="cp-analytics-block">
                          <button
                            className="cp-analytics-csv-btn"
                            onClick={handleExportAnalyticsCsv}
                            disabled={customPresets.length === 0}
                            title="利用状況をCSVでダウンロード"
                          >
                            CSVエクスポート
                          </button>
                        </div>
                        <div className="cp-insight-trigger">
                          <button
                            className="cp-insight-btn"
                            onClick={handleGeneratePresetInsight}
                            disabled={isGeneratingPresetInsight || customPresets.length === 0}
                          >
                            {isGeneratingPresetInsight ? '分析中…' : '🤖 AI改善提案'}
                          </button>
                        </div>
                        {presetInsightError && (
                          <p className="cp-insight-error">{presetInsightError}</p>
                        )}
                        {presetInsight && (
                          <div className="cp-insight-panel">
                            <p className="cp-analytics-block-label">🤖 AI改善提案</p>
                            <p className="cp-insight-summary">{presetInsight.summary}</p>
                            {presetInsight.strongestPresets.length > 0 && (
                              <div className="cp-insight-section">
                                <p className="cp-insight-section-label">勝ちパターン</p>
                                <ul className="cp-insight-list">
                                  {presetInsight.strongestPresets.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            {presetInsight.improvementIdeas.length > 0 && (
                              <div className="cp-insight-section">
                                <p className="cp-insight-section-label">改善できるプリセット</p>
                                <ul className="cp-insight-list">
                                  {presetInsight.improvementIdeas.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            {presetInsight.recommendedCombinations.length > 0 && (
                              <div className="cp-insight-section">
                                <p className="cp-insight-section-label">おすすめ新プリセット案</p>
                                {presetInsight.recommendedCombinations.map((combo, i) => (
                                  <div key={i} className="cp-insight-combo-card">
                                    <div className="cp-insight-combo-header">
                                      <span className="cp-insight-combo-name">{combo.name || 'AI提案プリセット'}</span>
                                      <button
                                        className={`cp-insight-create-btn${createdInsightIndices.has(i) ? ' cp-insight-create-btn--done' : ''}`}
                                        onClick={() => handleSaveInsightPreset(combo, i)}
                                        disabled={createdInsightIndices.has(i) || customPresets.length >= 10}
                                        title={customPresets.length >= 10 ? 'プリセットは最大10件です' : undefined}
                                      >
                                        {createdInsightIndices.has(i) ? '作成済み ✓' : 'このプリセットを作成'}
                                      </button>
                                    </div>
                                    {combo.reason && <p className="cp-insight-combo-reason">{combo.reason}</p>}
                                    <div className="cp-insight-combo-tags">
                                      {combo.platform && <span className="cp-insight-combo-tag">{combo.platform}</span>}
                                      {combo.tone && <span className="cp-insight-combo-tag">{combo.tone}</span>}
                                      {combo.ctaText && <span className="cp-insight-combo-tag">CTA: {combo.ctaText}</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {presetImportNotice && (
                  <p className={`custom-preset-import-notice${presetImportNotice.includes('失敗') ? ' custom-preset-import-notice--error' : ' custom-preset-import-notice--ok'}`}>
                    {presetImportNotice}
                  </p>
                )}
                <div className="custom-preset-form">
                  <p className="custom-preset-form-label">カスタムプリセットを追加</p>
                  <input
                    className="custom-preset-input"
                    type="text"
                    placeholder="名前"
                    value={customPresetForm.name}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <select
                    className="custom-preset-select"
                    value={customPresetForm.presetKey}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, presetKey: e.target.value as AIPresetKey | '' }))}
                  >
                    <option value="">ベースプリセット（なし）</option>
                    {AI_PRESETS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    className="custom-preset-input"
                    type="text"
                    placeholder="トーン"
                    value={customPresetForm.tone}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, tone: e.target.value }))}
                  />
                  <input
                    className="custom-preset-input"
                    type="text"
                    placeholder="対象読者"
                    value={customPresetForm.targetAudience}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, targetAudience: e.target.value }))}
                  />
                  <input
                    className="custom-preset-input"
                    type="text"
                    placeholder="プラットフォーム"
                    value={customPresetForm.platform}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, platform: e.target.value }))}
                  />
                  <input
                    className="custom-preset-input"
                    type="text"
                    placeholder="画像スタイル"
                    value={customPresetForm.imageStyle}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, imageStyle: e.target.value }))}
                  />
                  <input
                    className="custom-preset-input"
                    type="text"
                    placeholder="CTA"
                    value={customPresetForm.ctaText}
                    onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, ctaText: e.target.value }))}
                  />
                  <button
                    className="custom-preset-save-btn"
                    onClick={handleSaveCustomPreset}
                    disabled={
                      !customPresetForm.name ||
                      !customPresetForm.tone ||
                      !customPresetForm.targetAudience ||
                      !customPresetForm.platform ||
                      !customPresetForm.imageStyle ||
                      !customPresetForm.ctaText
                    }
                  >
                    保存
                  </button>
                </div>
                {sortedCustomPresets.length > 0 && (
                  <div className="custom-preset-list">
                    {sortedCustomPresets.map((preset, sortedIdx) => {
                      const isSelected = selectedCustomPresetId === preset.id
                      const isEditing = editingCustomPresetId === preset.id
                      const canMoveUp = sortedIdx > 0 && !(!preset.isFavorite && sortedCustomPresets[sortedIdx - 1]?.isFavorite)
                      const canMoveDown = sortedIdx < sortedCustomPresets.length - 1 && !(preset.isFavorite && !sortedCustomPresets[sortedIdx + 1]?.isFavorite)
                      return (
                        <div key={preset.id} className={`custom-preset-card${isSelected ? ' custom-preset-card--active' : ''}`}>
                          {isEditing && editingCustomPresetForm ? (
                            <div className="custom-preset-edit-form">
                              <input
                                className="custom-preset-input"
                                type="text"
                                placeholder="名前"
                                value={editingCustomPresetForm.name}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, name: e.target.value }))}
                              />
                              <select
                                className="custom-preset-select"
                                value={editingCustomPresetForm.presetKey}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, presetKey: e.target.value as AIPresetKey | '' }))}
                              >
                                <option value="">ベースプリセット（なし）</option>
                                {AI_PRESETS.map((p) => (
                                  <option key={p.key} value={p.key}>{p.label}</option>
                                ))}
                              </select>
                              <input
                                className="custom-preset-input"
                                type="text"
                                placeholder="トーン"
                                value={editingCustomPresetForm.tone}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, tone: e.target.value }))}
                              />
                              <input
                                className="custom-preset-input"
                                type="text"
                                placeholder="対象読者"
                                value={editingCustomPresetForm.targetAudience}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, targetAudience: e.target.value }))}
                              />
                              <input
                                className="custom-preset-input"
                                type="text"
                                placeholder="プラットフォーム"
                                value={editingCustomPresetForm.platform}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, platform: e.target.value }))}
                              />
                              <input
                                className="custom-preset-input"
                                type="text"
                                placeholder="画像スタイル"
                                value={editingCustomPresetForm.imageStyle}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, imageStyle: e.target.value }))}
                              />
                              <input
                                className="custom-preset-input"
                                type="text"
                                placeholder="CTA"
                                value={editingCustomPresetForm.ctaText}
                                onChange={(e) => setEditingCustomPresetForm((prev) => prev && ({ ...prev, ctaText: e.target.value }))}
                              />
                              <div className="custom-preset-edit-actions">
                                <button
                                  className="custom-preset-edit-save-btn"
                                  onClick={handleSaveEditCustomPreset}
                                  disabled={
                                    !editingCustomPresetForm.name ||
                                    !editingCustomPresetForm.tone ||
                                    !editingCustomPresetForm.targetAudience ||
                                    !editingCustomPresetForm.platform ||
                                    !editingCustomPresetForm.imageStyle ||
                                    !editingCustomPresetForm.ctaText
                                  }
                                >
                                  保存
                                </button>
                                <button
                                  className="custom-preset-edit-cancel-btn"
                                  onClick={() => { setEditingCustomPresetId(''); setEditingCustomPresetForm(null) }}
                                >
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="custom-preset-card-header">
                                <button
                                  className={`custom-preset-fav-btn${preset.isFavorite ? ' custom-preset-fav-btn--active' : ''}`}
                                  onClick={() => handleToggleFavoriteCustomPreset(preset.id)}
                                  title="お気に入り"
                                >
                                  {preset.isFavorite ? '⭐' : '☆'}
                                </button>
                                <span className="custom-preset-card-name">{preset.name}</span>
                                {preset.presetKey && (
                                  <span className="custom-preset-card-base">
                                    {AI_PRESETS.find((p) => p.key === preset.presetKey)?.label ?? preset.presetKey}
                                  </span>
                                )}
                              </div>
                              <div className="custom-preset-use-count">
                                使用回数 {preset.useCount ?? 0}
                              </div>
                              <div className="custom-preset-card-body">
                                <span className="custom-preset-tag">トーン: {preset.tone}</span>
                                <span className="custom-preset-tag">対象: {preset.targetAudience}</span>
                                <span className="custom-preset-tag">PF: {preset.platform}</span>
                                <span className="custom-preset-tag">スタイル: {preset.imageStyle}</span>
                                <span className="custom-preset-tag">CTA: {preset.ctaText}</span>
                              </div>
                              <div className="custom-preset-card-actions">
                                <button
                                  className={`custom-preset-use-btn${isSelected ? ' custom-preset-use-btn--active' : ''}`}
                                  onClick={() => handleUseCustomPreset(preset)}
                                >
                                  {isSelected ? '適用中' : '使用'}
                                </button>
                                <button
                                  className="custom-preset-edit-btn"
                                  onClick={() => {
                                    setEditingCustomPresetId(preset.id)
                                    setEditingCustomPresetForm({
                                      name: preset.name,
                                      presetKey: preset.presetKey,
                                      tone: preset.tone,
                                      targetAudience: preset.targetAudience,
                                      platform: preset.platform,
                                      imageStyle: preset.imageStyle,
                                      ctaText: preset.ctaText,
                                    })
                                  }}
                                >
                                  編集
                                </button>
                                <button
                                  className="custom-preset-duplicate-btn"
                                  onClick={() => handleDuplicateCustomPreset(preset)}
                                >
                                  複製
                                </button>
                                <button
                                  className="custom-preset-delete-btn"
                                  onClick={() => handleDeleteCustomPreset(preset.id)}
                                >
                                  削除
                                </button>
                                <button
                                  className="custom-preset-move-btn"
                                  onClick={() => handleMoveCustomPreset(preset.id, 'up')}
                                  disabled={!canMoveUp}
                                  title="上に移動"
                                >↑</button>
                                <button
                                  className="custom-preset-move-btn"
                                  onClick={() => handleMoveCustomPreset(preset.id, 'down')}
                                  disabled={!canMoveDown}
                                  title="下に移動"
                                >↓</button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <p className="ai-generator-label" style={{ marginTop: 10 }}>テーマ入力</p>
              <div className="ai-generator-row">
                <input
                  className="ai-generator-input"
                  type="text"
                  placeholder="テーマを入力..."
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAIGenerate()}
                  disabled={isGenerating || autoWorkflowRunning}
                />
                <button
                  className={`ai-generator-btn${isGenerating ? ' ai-generator-btn--loading' : ''}`}
                  onClick={handleAIGenerate}
                  disabled={!aiTheme.trim() || isGenerating || autoWorkflowRunning}
                >
                  {isGenerating ? 'Generating...' : 'AI生成'}
                </button>
              </div>
              {generateError && (
                <p className="ai-generator-error">{generateError}</p>
              )}
              {generateSuccess && !generateError && (
                <p className="ai-generator-success">14枚のストーリーを生成しました</p>
              )}
            </div>
          )}
          {templateVariableKeys.length > 0 && (
            <div className="template-variables">
              <p className="template-variables-label">テンプレート変数</p>
              <div className="template-variables-list">
                {templateVariableKeys.map((key) => (
                  <div key={key} className="template-variable-row">
                    <label className="template-variable-key">{key}</label>
                    <input
                      className="template-variable-input"
                      type="text"
                      placeholder={`{{${key}}}`}
                      value={variableValues[key] ?? ''}
                      onChange={(e) => handleVariableChange(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {slides.some((slide) => slide.imagePrompt) && (
            <div className="bulk-image-section">
              <button
                className={`bulk-image-btn${bulkImageGenerating ? ' bulk-image-btn--loading' : ''}`}
                onClick={handleGenerateAllImages}
                disabled={bulkImageGenerating || autoWorkflowRunning}
              >
                {bulkImageGenerating
                  ? `${bulkImageProgress.current} / ${bulkImageProgress.total} 生成中...`
                  : '14枚AI画像生成'}
              </button>
              {bulkImageMessage && (
                <p className={`bulk-image-message${bulkImageMessage.includes('失敗') ? ' bulk-image-message--error' : ' bulk-image-message--ok'}`}>
                  {bulkImageMessage}
                </p>
              )}
            </div>
          )}

          {/* AIワークフロー (Phase12-H / Phase12-I) */}
          {templateVariableKeys.length > 0 && (
            <div className="ai-workflow">
              <p className="ai-workflow-title">AIワークフロー</p>
              <button
                className={`ai-auto-btn${autoWorkflowRunning ? ' ai-auto-btn--running' : ''}`}
                onClick={handleAutoWorkflow}
                disabled={!hasTheme || autoWorkflowRunning || isGenerating || bulkImageGenerating}
              >
                {autoWorkflowRunning ? (workflowMessage || '自動生成中...') : '自動でまとめて生成'}
              </button>
              <div className="ai-workflow-steps">
                {/* Step 1: テーマ入力 */}
                <div className={`ai-workflow-step${workflowStep === 'theme' ? ' ai-workflow-step--active' : ''}`}>
                  <span className="ai-workflow-step-icon">
                    {WORKFLOW_ORDER.indexOf(workflowStep) > 0 ? '✅' : workflowStep === 'theme' ? '🔵' : '⚪️'}
                  </span>
                  <div className="ai-workflow-step-body">
                    <span className="ai-workflow-step-name">Step 1 テーマ入力</span>
                    {workflowStep === 'theme' && (
                      <button
                        className="ai-workflow-step-btn"
                        disabled={!hasTheme || autoWorkflowRunning}
                        onClick={() => { setWorkflowError(''); setWorkflowStep('story') }}
                      >
                        次へ
                      </button>
                    )}
                  </div>
                </div>

                {/* Step 2: ストーリー生成 */}
                <div className={`ai-workflow-step${workflowStep === 'story' ? ' ai-workflow-step--active' : ''}`}>
                  <span className="ai-workflow-step-icon">
                    {['images','save','render','done'].includes(workflowStep) ? '✅' : workflowStep === 'story' ? '🔵' : '⚪️'}
                  </span>
                  <div className="ai-workflow-step-body">
                    <span className="ai-workflow-step-name">Step 2 14枚ストーリー生成</span>
                    {workflowStep === 'story' && (
                      <button
                        className="ai-workflow-step-btn"
                        disabled={isGenerating || autoWorkflowRunning}
                        onClick={handleWorkflowStory}
                      >
                        {isGenerating ? 'Generating...' : '14枚ストーリーを生成'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Step 3: 画像生成 */}
                <div className={`ai-workflow-step${workflowStep === 'images' ? ' ai-workflow-step--active' : ''}`}>
                  <span className="ai-workflow-step-icon">
                    {['save','render','done'].includes(workflowStep) ? '✅' : workflowStep === 'images' ? '🔵' : '⚪️'}
                  </span>
                  <div className="ai-workflow-step-body">
                    <span className="ai-workflow-step-name">Step 3 14枚画像生成</span>
                    {workflowStep === 'images' && (
                      <button
                        className="ai-workflow-step-btn"
                        disabled={bulkImageGenerating || autoWorkflowRunning}
                        onClick={handleWorkflowImages}
                      >
                        {bulkImageGenerating
                          ? `${bulkImageProgress.current}/${bulkImageProgress.total} 生成中...`
                          : '14枚画像を生成'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Step 4: 保存 */}
                <div className={`ai-workflow-step${workflowStep === 'save' ? ' ai-workflow-step--active' : ''}`}>
                  <span className="ai-workflow-step-icon">
                    {['render','done'].includes(workflowStep) ? '✅' : workflowStep === 'save' ? '🔵' : '⚪️'}
                  </span>
                  <div className="ai-workflow-step-body">
                    <span className="ai-workflow-step-name">Step 4 保存</span>
                    {workflowStep === 'save' && (
                      <button
                        className="ai-workflow-step-btn"
                        disabled={saveStatus === 'saving' || autoWorkflowRunning}
                        onClick={handleWorkflowSave}
                      >
                        {saveStatus === 'saving' ? '保存中...' : '保存する'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Step 5: 動画生成 */}
                <div className={`ai-workflow-step${workflowStep === 'render' ? ' ai-workflow-step--active' : ''}`}>
                  <span className="ai-workflow-step-icon">
                    {workflowStep === 'done' ? '✅' : workflowStep === 'render' ? '🔵' : '⚪️'}
                  </span>
                  <div className="ai-workflow-step-body">
                    <span className="ai-workflow-step-name">Step 5 動画生成</span>
                    {workflowStep === 'render' && (
                      <button
                        className="ai-workflow-step-btn"
                        disabled={isRendering || autoWorkflowRunning}
                        onClick={handleWorkflowRender}
                      >
                        動画生成する
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {workflowStep === 'done' && (
                <p className="ai-workflow-done">全ステップ完了！動画が生成されています。</p>
              )}
              {workflowError && (
                <p className="ai-workflow-error">{workflowError}</p>
              )}
              {workflowStep !== 'theme' && workflowStep !== 'done' && (
                <button
                  className="ai-workflow-reset-btn"
                  onClick={() => { setWorkflowStep('theme'); setWorkflowError('') }}
                  disabled={autoWorkflowRunning}
                >
                  最初からやり直す
                </button>
              )}
            </div>
          )}

          {/* AI生成履歴 (Phase12-N) */}
          {aiGenerationHistory.length > 0 && (
            <div className="ai-gen-history">
              <div className="ai-gen-history-header">
                <p className="ai-gen-history-title">AI生成履歴</p>
                <div className="ai-gen-history-header-actions">
                  <button
                    className="ai-gen-history-io-btn"
                    onClick={exportAIGenerationHistory}
                    title="履歴をJSONでダウンロード"
                  >
                    エクスポート
                  </button>
                  <button
                    className="ai-gen-history-io-btn"
                    onClick={() => importInputRef.current?.click()}
                    title="JSONファイルから履歴をインポート"
                  >
                    インポート
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={handleImport}
                  />
                  <button
                    className="ai-gen-history-clear-btn"
                    onClick={clearAIGenerationHistory}
                  >
                    全削除
                  </button>
                </div>
              </div>
              {importNotice && (
                <p className={`ai-gen-history-import-notice${importNotice.includes('失敗') ? ' ai-gen-history-import-notice--error' : ' ai-gen-history-import-notice--ok'}`}>
                  {importNotice}
                </p>
              )}
              <ul className="ai-gen-history-list">
                {aiGenerationHistory.map((h) => (
                  <li key={h.id} className="ai-gen-history-item">
                    <div className="ai-gen-history-item-main">
                      <span className="ai-gen-history-theme" title={h.theme}>{h.theme}</span>
                      {h.presetKey && (
                        <span className="ai-gen-history-preset">
                          {AI_PRESETS.find((p) => p.key === h.presetKey)?.label ?? h.presetKey}
                        </span>
                      )}
                    </div>
                    {h.templateName && (
                      <p className="ai-gen-history-template">{h.templateName}</p>
                    )}
                    <div className="ai-gen-history-meta">
                      <span>{formatHistoryDate(h.createdAt)}</span>
                      <span>スライド{h.slideCount}枚</span>
                      <span>画像{h.imageCount}枚</span>
                      <span className={`ai-gen-history-render-status ai-gen-history-render-status--${h.renderStatus}`}>
                        {h.renderStatus === 'none' ? '未レンダリング' : h.renderStatus === 'completed' ? '完了' : '失敗'}
                      </span>
                      {h.renderOutputPath && (
                        <a className="ai-gen-history-render-dl" href={h.renderOutputPath} download>
                          DL
                        </a>
                      )}
                      {h.snsCaption && (
                        <span className="ai-gen-history-sns-badge">SNS文あり</span>
                      )}
                    </div>
                    {h.renderErrorMessage && (
                      <p className="ai-gen-history-render-error">{h.renderErrorMessage}</p>
                    )}
                    <div className="ai-gen-history-actions">
                      <button
                        className="ai-gen-history-reuse-btn"
                        onClick={() => handleReuseHistory(h)}
                        disabled={autoWorkflowRunning || isGenerating}
                      >
                        このテーマで再生成
                      </button>
                      <button
                        className="ai-gen-history-delete-btn"
                        onClick={() => deleteAIGenerationHistoryItem(h.id)}
                      >
                        削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 生成済み素材 (Phase12-G) */}
          <div className="assets-section">
            <div className="assets-header-row">
              <p className="assets-label">生成済み素材</p>
              <div className="assets-header-actions">
                <button
                  className="assets-refresh-btn"
                  onClick={fetchGeneratedAssets}
                  disabled={assetsLoading}
                  title="更新"
                >
                  {assetsLoading ? '...' : '↻'}
                </button>
                <button
                  className="assets-bulk-delete-btn"
                  onClick={() => deleteUnusedAssets(usedGeneratedImages)}
                  disabled={assetsLoading || generatedAssets.length === 0}
                >
                  未使用画像を一括削除
                </button>
              </div>
            </div>
            {assetsMessage && (
              <p className={`assets-message${assetsMessage.includes('失敗') ? ' assets-message--error' : ' assets-message--ok'}`}>
                {assetsMessage}
              </p>
            )}
            {generatedAssets.length === 0 ? (
              <p className="assets-empty">生成済み画像はありません</p>
            ) : (
              <ul className="assets-list">
                {generatedAssets.map((asset) => {
                  const isUsed = usedGeneratedImages.has(asset.path)
                  return (
                    <li key={asset.filename} className="assets-item">
                      <div className="assets-item-info">
                        <span className="assets-item-name" title={asset.filename}>{asset.filename}</span>
                        <span className="assets-item-size">{(asset.size / 1024).toFixed(0)}KB</span>
                        {isUsed
                          ? <span className="assets-item-badge assets-item-badge--used">使用中</span>
                          : <span className="assets-item-badge assets-item-badge--unused">未使用</span>
                        }
                      </div>
                      <button
                        className="assets-delete-btn"
                        onClick={() => deleteGeneratedAsset(asset.filename)}
                        disabled={isUsed}
                        title={isUsed ? '使用中のため削除できません' : '削除'}
                      >
                        削除
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <SlideList
          slides={slides}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleVisible={toggleVisible}
          onMove={moveSlide}
          disabled={isRendering}
        />
        <div className="download-area">
          <button
            className={`btn-save ${saveStatus === 'ok' ? 'btn-save--ok' : saveStatus === 'error' ? 'btn-save--error' : hasUnsavedChanges && saveStatus === 'idle' ? 'btn-save--unsaved' : ''}`}
            onClick={saveToServer}
            disabled={saveStatus === 'saving' || isRendering}
          >
            {saveStatus === 'saving'
              ? '保存中...'
              : saveStatus === 'ok'
              ? '✓ 保存しました！'
              : saveStatus === 'error'
              ? '✗ 保存に失敗しました'
              : hasUnsavedChanges
              ? '⚠ 未保存の変更を保存する'
              : '💾 保存する'}
          </button>
          {saveStatus === 'error' && (
            <p className="save-error">{saveError}</p>
          )}

          <div className="render-area">
            <div className="render-precheck">
              {renderPrecheck.checks.map((c, i) => (
                <p key={i} className={`render-precheck-item${c.ok ? '' : ' render-precheck-item--warn'}`}>
                  {c.ok ? '✅' : '⚠️'} {c.label}
                </p>
              ))}
            </div>
            {renderStatusMsg && !isRendering && renderStatus !== 'completed' && (
              <p className={renderStatusClass}>{renderStatusMsg}</p>
            )}
            {(isRendering || renderStatus === 'completed') && renderStepInfo && (
              <div className="render-progress">
                <div className="render-progress-header">
                  <span className="render-progress-step">
                    Step {renderStepInfo.step} / {renderStepInfo.total}：{renderStepInfo.label}
                  </span>
                  <span className="render-progress-elapsed">経過 {elapsedSec} 秒</span>
                </div>
                <div className="render-progress-bar">
                  <div
                    className={`render-progress-fill${renderStatus === 'completed' ? ' render-progress-fill--done' : ''}`}
                    style={{ width: `${renderProgressPct}%` }}
                  />
                </div>
              </div>
            )}
            <button
              className={`btn-render ${isRendering ? 'btn-render--running' : renderStatus === 'completed' ? 'btn-render--ok' : renderStatus === 'failed' ? 'btn-render--error' : ''}`}
              onClick={startRender}
              disabled={isRendering || !renderPrecheck.canRender}
            >
              {renderBtnLabel}
            </button>
            {renderStatus === 'failed' && !isRendering && (
              <>
                {renderError && <p className="render-error">{renderError}</p>}
                <button className="btn-rerender" onClick={startRender}>
                  再レンダリング
                </button>
              </>
            )}
            {renderStatus === 'completed' && !isRendering && (
              <div className="render-complete-card">
                <div className="render-complete-card-header">
                  動画生成完了！
                </div>
                <ul className="render-complete-specs">
                  <li>1080 × 1920 縦型動画</li>
                  <li>YouTube Shorts / Instagram Reels 対応</li>
                  <li>{slides.length} 枚スライド構成</li>
                </ul>
                <div className="render-complete-actions">
                  <button className="btn-download-mp4" onClick={downloadVideo}>
                    ↓ 動画をダウンロード
                  </button>
                  <a
                    className="btn-open-video"
                    href={latestViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ↗ 動画を開く
                  </a>
                </div>
                <div className="render-complete-sub-actions">
                  <button className="btn-copy-url" onClick={copyRenderUrl}>
                    {copiedUrl ? '✓ コピー済み' : 'URLをコピー'}
                  </button>
                  <button className="btn-scroll-history" onClick={scrollToHistory}>
                    履歴を見る
                  </button>
                  <button className="btn-rerender btn-rerender--inline" onClick={startRender}>
                    再レンダリング
                  </button>
                </div>
                <button
                  className="btn-sns-caption"
                  onClick={generateSnsCaption}
                  disabled={isGeneratingSnsCaption}
                >
                  {isGeneratingSnsCaption ? '⏳ 生成中...' : 'SNS投稿文を作成'}
                </button>
                {snsCaptionError && (
                  <p className="sns-caption-error">{snsCaptionError}</p>
                )}
              </div>
            )}
            {snsCaption && renderStatus === 'completed' && (
              <div className="sns-caption-panel">
                <p className="sns-caption-panel-title">SNS投稿文</p>

                <div className="sns-caption-field">
                  <div className="sns-caption-field-header">
                    <span className="sns-caption-field-label">YouTube Shorts タイトル</span>
                    <button
                      className="btn-sns-copy"
                      onClick={() => copySnsText('ytTitle', snsCaption.youtubeTitle)}
                    >
                      {copiedSnsField === 'ytTitle' ? '✓ コピー済み' : 'コピー'}
                    </button>
                  </div>
                  <p className="sns-caption-text sns-caption-text--title">{snsCaption.youtubeTitle}</p>
                </div>

                <div className="sns-caption-field">
                  <div className="sns-caption-field-header">
                    <span className="sns-caption-field-label">YouTube 説明文</span>
                    <button
                      className="btn-sns-copy"
                      onClick={() => copySnsText('ytDesc', snsCaption.youtubeDescription)}
                    >
                      {copiedSnsField === 'ytDesc' ? '✓ コピー済み' : 'コピー'}
                    </button>
                  </div>
                  <p className="sns-caption-text">{snsCaption.youtubeDescription}</p>
                </div>

                <div className="sns-caption-field">
                  <div className="sns-caption-field-header">
                    <span className="sns-caption-field-label">Instagram 投稿文</span>
                    <button
                      className="btn-sns-copy"
                      onClick={() => copySnsText('ig', snsCaption.instagramCaption)}
                    >
                      {copiedSnsField === 'ig' ? '✓ コピー済み' : 'コピー'}
                    </button>
                  </div>
                  <p className="sns-caption-text">{snsCaption.instagramCaption}</p>
                </div>

                <div className="sns-caption-field">
                  <div className="sns-caption-field-header">
                    <span className="sns-caption-field-label">ハッシュタグ</span>
                    <button
                      className="btn-sns-copy"
                      onClick={() => copySnsText('tags', snsCaption.hashtags.map((t) => `#${t}`).join(' '))}
                    >
                      {copiedSnsField === 'tags' ? '✓ コピー済み' : 'コピー'}
                    </button>
                  </div>
                  <p className="sns-caption-text sns-caption-text--tags">
                    {snsCaption.hashtags.map((t) => `#${t}`).join('　')}
                  </p>
                </div>

                <button
                  className="btn-sns-caption btn-sns-caption--regen"
                  onClick={generateSnsCaption}
                  disabled={isGeneratingSnsCaption}
                >
                  {isGeneratingSnsCaption ? '⏳ 生成中...' : '再生成'}
                </button>
              </div>
            )}
          </div>

          {/* 生成履歴 */}
          <div className="history-area" ref={historyAreaRef}>
            <p className="history-title">生成履歴</p>
            {historyError ? (
              <p className="history-empty history-empty--error">生成履歴を取得できませんでした</p>
            ) : history.length === 0 ? (
              <p className="history-empty">生成履歴はまだありません</p>
            ) : (
              <ul className="history-list">
                {history.map((item, i) => (
                  <li key={item.filename} className="history-item">
                    {i === 0 && <span className="history-newest-badge">最新</span>}
                    <span className="history-date">{formatHistoryDate(item.createdAt)}</span>
                    <span className="history-size">{formatSize(item.size)}</span>
                    <a className="history-dl" href={item.downloadUrl} download={item.filename}>DL</a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            className="btn-save-template"
            onClick={() => {
              setSaveTemplateName('')
              setSaveTemplateCategory('other')
              setSaveTemplateDescription('')
              setSaveTemplateStatus('idle')
              setSaveTemplateModal(true)
            }}
            disabled={isRendering || slides.length === 0}
          >
            テンプレートとして保存
          </button>

          <button className={`btn-download ${saved ? 'btn-download--saved' : ''}`} onClick={downloadJSON}>
            {saved ? '✓ ダウンロード完了！' : '↓ slides.json をダウンロード'}
          </button>
          <p className="download-hint">
            ※ ダウンロードは保険用です
          </p>
        </div>
      </div>

      {/* ── 中央パネル: プレビュー ── */}
      <div className="panel panel-center">
        <div className="panel-header">
          <span className="panel-title">プレビュー</span>
          {selectedSlide && (
            <div className="preview-nav">
              <button
                className="nav-btn"
                disabled={selectedIdx <= 0}
                onClick={() => setSelectedId(slides[selectedIdx - 1].id)}
              >
                ←
              </button>
              <span className="nav-label">{selectedIdx + 1} / {slides.length}</span>
              <button
                className="nav-btn"
                disabled={selectedIdx >= slides.length - 1}
                onClick={() => setSelectedId(slides[selectedIdx + 1].id)}
              >
                →
              </button>
            </div>
          )}
        </div>
        <div className="preview-area">
          {selectedSlide ? (
            <SlidePreview slide={selectedSlide} ctaConfig={ctaConfig} />
          ) : (
            <div className="empty-state">スライドを選択してください</div>
          )}
        </div>
      </div>

      {/* ── 右パネル: 編集フォーム ── */}
      <div className="panel panel-right">
        <div className="panel-header">
          <span className="panel-title">
            {selectedSlide?.layout === 'cta' ? 'CTA スライド編集' : '編集フォーム'}
          </span>
          {selectedSlide && (
            <span className="panel-badge">#{selectedSlide.id}</span>
          )}
        </div>
        {selectedSlide ? (
          <>
            {isRendering && (
              <div className="render-lock-notice">
                ⏳ 動画生成中のため、編集はロックされています。完了までお待ちください。
              </div>
            )}
            <SlideForm
              slide={selectedSlide}
              onChange={(changes) => updateSlide(selectedSlide.id, changes)}
              ctaConfig={ctaConfig}
              onCtaChange={handleCtaChange}
              disabled={isRendering}
              onGenerateImage={selectedSlide.imagePrompt ? () => handleGenerateImage(selectedSlide.id, selectedSlide.imagePrompt!) : undefined}
              isGeneratingImage={imageGeneratingId === selectedSlide.id}
              generateImageError={imageGenerateErrors[selectedSlide.id]}
            />
          </>
        ) : (
          <div className="empty-state">スライドを選択してください</div>
        )}
      </div>
    </div>
  )
}
