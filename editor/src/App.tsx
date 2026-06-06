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
import { FactoryPanel } from './components/factory/FactoryPanel'
import { RenderQueuePanel } from './components/render/RenderQueuePanel'
import { CompareDashboardPanel } from './components/compare/CompareDashboardPanel'
import { TemplateGalleryPanel } from './components/template/TemplateGalleryPanel'

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

type RenderQueueItem = {
  id: string
  variantName: string
  status: 'pending' | 'rendering' | 'completed' | 'failed'
  outputPath?: string
  renderedAt?: string
  slidesSnapshot?: Slide[]
  snapshotCreatedAt?: string
}

type LastPipeline = {
  completedCount: number
  failedCount: number
  finishedAt: string
}

type LastSmartPipeline = {
  generatedCount: number
  recommendedCount: number
  renderedCount: number
  failedCount: number
  finishedAt: string
}

type LastSmartRewritePipeline = {
  selectedVariantName: string
  selectedAngle: string
  recommendation: number
  renderedCount: number
  failedCount: number
  finishedAt: string
}

type LastMultiRewriteQueue = {
  rewrittenCount: number
  queuedCount: number
  renderedCount: number
  failedCount: number
  selectedVariants: string[]
  finishedAt: string
}

type BestVariantAnalysis = {
  strengths: string[]
  weaknesses: string[]
  bestFor: string[]
  nextActions: string[]
  summary: string
}

// ==============================
// AI Reel Factory — Types
// ==============================
type FactorySummary = {
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

type FactoryHistoryItem = FactorySummary & {
  id: string
  theme: string
  favorite?: boolean
  tags?: string[]
}

type FactoryHistoryFilter = 'all' | 'favorites' | 'highScore'

type GeneratedVariant = {
  name: string
  description: string
  angle: string
}

type RewrittenSlide = {
  headline: string
  subline?: string
  emphasis?: string
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
  renderVariantName?: string
  renderedAt?: string
  snsCaption?: SnsCaption
}

type RewriteExplainResult = {
  summary: string
  reasons: string[]
  improvedPoints: string[]
  risks: string[]
  nextSuggestions: string[]
}

function renderInlineDiff(
  before: string,
  after: string
): { beforeNode: React.ReactNode; afterNode: React.ReactNode } {
  if (!before) return { beforeNode: <span className="inline-diff-unchanged">(empty)</span>, afterNode: <span className="inline-diff-added">{after}</span> }
  if (!after) return { beforeNode: <span className="inline-diff-removed">{before}</span>, afterNode: <span className="inline-diff-unchanged">(empty)</span> }

  const minLen = Math.min(before.length, after.length)
  let prefixLen = 0
  while (prefixLen < minLen && before[prefixLen] === after[prefixLen]) prefixLen++

  let suffixLen = 0
  while (suffixLen < minLen - prefixLen && before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]) suffixLen++

  const prefix = before.slice(0, prefixLen)
  const suffix = suffixLen > 0 ? before.slice(before.length - suffixLen) : ''
  const beforeMid = before.slice(prefixLen, before.length - suffixLen)
  const afterMid = after.slice(prefixLen, after.length - suffixLen)

  return {
    beforeNode: (
      <>
        {prefix && <span className="inline-diff-unchanged">{prefix}</span>}
        {beforeMid && <span className="inline-diff-removed">{beforeMid}</span>}
        {suffix && <span className="inline-diff-unchanged">{suffix}</span>}
      </>
    ),
    afterNode: (
      <>
        {prefix && <span className="inline-diff-unchanged">{prefix}</span>}
        {afterMid && <span className="inline-diff-added">{afterMid}</span>}
        {suffix && <span className="inline-diff-unchanged">{suffix}</span>}
      </>
    ),
  }
}

function renderDiffPanel(currentSlides: Slide[], snapshotSlides: Slide[]) {
  type DiffEntry = { field: string; before: string; after: string }
  const diffItems = currentSlides
    .map((slide, i) => {
      const snap = snapshotSlides[i]
      if (!snap) return null
      const diffs: DiffEntry[] = []
      if (slide.headline !== snap.headline) diffs.push({ field: 'Headline', before: slide.headline, after: snap.headline })
      if (slide.subline !== snap.subline) diffs.push({ field: 'Subline', before: slide.subline, after: snap.subline })
      if (slide.emphasis !== snap.emphasis) diffs.push({ field: 'Emphasis', before: slide.emphasis, after: snap.emphasis })
      return diffs.length > 0 ? { idx: i, diffs } : null
    })
    .filter((x): x is { idx: number; diffs: DiffEntry[] } => x !== null)

  return (
    <div className="snapshot-diff-panel">
      {diffItems.length === 0 ? (
        <p className="snapshot-diff-empty">No content changes detected</p>
      ) : (
        diffItems.map(item => (
          <div key={item.idx} className="snapshot-diff-slide">
            <p className="snapshot-preview-label">Slide {item.idx + 1}</p>
            {item.diffs.map(d => {
              const { beforeNode, afterNode } = renderInlineDiff(d.before, d.after)
              return (
                <div key={d.field} className="snapshot-diff-row">
                  <p className="snapshot-diff-field">{d.field}</p>
                  <div className="snapshot-diff-before">
                    <span className="snapshot-diff-label">Before</span>
                    <span className="snapshot-diff-text">{beforeNode}</span>
                  </div>
                  <div className="snapshot-diff-after">
                    <span className="snapshot-diff-label">After</span>
                    <span className="snapshot-diff-text">{afterNode}</span>
                  </div>
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
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

const USAGE_KEY = 'bemystyle-reel:template-usage'
const AI_GENERATION_HISTORY_KEY = 'bemystyle-reel-ai-generation-history'
const RENDER_QUEUE_KEY = 'bemystyle-reel-render-queue'
const BEST_VARIANT_KEY = 'bemystyle-reel-best-variant'
const LAST_PIPELINE_KEY = 'bemystyle-reel-last-pipeline'
const GENERATED_VARIANTS_KEY = 'bemystyle-reel-generated-variants'
const REWRITTEN_STORIES_KEY = 'bemystyle-reel-rewritten-stories'
const VARIANT_LEARNING_EVENTS_KEY = 'bemystyle-reel-variant-learning-events'
const VARIANT_SCORES_KEY = 'bemystyle-reel-variant-scores'
const LAST_SMART_PIPELINE_KEY = 'bemystyle-reel-last-smart-pipeline'
const LAST_SMART_REWRITE_PIPELINE_KEY = 'bemystyle-reel-last-smart-rewrite-pipeline'
const LAST_MULTI_REWRITE_QUEUE_KEY = 'bemystyle-reel-last-multi-rewrite-queue'
const BEST_VARIANT_ANALYSIS_KEY = 'bemystyle-reel-best-variant-analysis'
const REWRITE_EXPLAIN_CACHE_KEY = 'bemystyle-reel-rewrite-explain-cache'

// ==============================
// AI Reel Factory — Constants & Utilities
// ==============================
const FACTORY_SUMMARY_CACHE_KEY = 'bemystyle-reel-factory-summary-cache'
const FACTORY_HISTORY_KEY = 'bemystyle-reel-factory-history'
const MAX_HISTORY_THEME_LENGTH = 80
const FACTORY_QUICK_TAGS = ['音楽', '成長', '習慣', 'AI', 'コミュニティ', '歌唱診断']

const FACTORY_TAG_RULES: { tag: string; keywords: string[] }[] = [
  { tag: '音楽',     keywords: ['音楽', '歌', '演奏', 'バンド', 'ライブ', 'セッション'] },
  { tag: '成長',     keywords: ['成長', '挑戦', '努力', '練習', '上達', 'レベルアップ'] },
  { tag: '習慣',     keywords: ['習慣', '継続', '毎日', '積み重ね', 'ルーティン'] },
  { tag: 'AI',       keywords: ['ai', 'AI', '人工知能', '自動化'] },
  { tag: 'コミュニティ', keywords: ['コミュニティ', '仲間', '居場所', 'サークル', 'つながり'] },
  { tag: '歌唱診断', keywords: ['歌唱診断', 'ボーカル', 'ミックスボイス', '発声', '歌声'] },
]

const inferFactoryTags = (theme: string): string[] => {
  const text = theme.toLowerCase()
  return FACTORY_TAG_RULES
    .filter(rule => rule.keywords.some(kw => text.includes(kw.toLowerCase())))
    .map(rule => rule.tag)
    .slice(0, 8)
}

const escapeCsvValue = (value: unknown): string => {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

const isFactoryHistoryItem = (value: unknown): value is FactoryHistoryItem => {
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

const AUTO_ANALYZE_ON_BEST_SELECT = false

const AUTO_VARIANT_TEMPLATES = [
  'Default',
  'CTA強め版',
  '感情訴求版',
  '教育版',
  'ストーリー版',
  'YouTube版',
  'Instagram版',
]

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

  // Render Variant / Queue / Compare / AutoGen (Phase13-G/H/I/K)
  const [renderVariantName, setRenderVariantName] = useState("")
  const [renderQueue, setRenderQueue] = useState<RenderQueueItem[]>([])
  const [isBatchRendering, setIsBatchRendering] = useState(false)
  const [bestVariantId, setBestVariantId] = useState("")
  const [autoGenerateNotice, setAutoGenerateNotice] = useState("")
  const importInputRef = useRef<HTMLInputElement>(null)

  // AI Variant Generator (Phase14-D)
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([])
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false)
  const [variantGenerateError, setVariantGenerateError] = useState('')

  // AI Story Rewriter (Phase14-E)
  const [rewrittenStories, setRewrittenStories] = useState<Record<string, Slide[]>>({})
  const [isRewritingStory, setIsRewritingStory] = useState<Record<string, boolean>>({})
  const [rewriteStoryError, setRewriteStoryError] = useState<Record<string, string>>({})

  // Best Variant Learning (Phase14-F)
  const [variantLearningEvents, setVariantLearningEvents] = useState<VariantLearningEvent[]>([])

  // AI Variant Scoring (Phase14-G)
  const [variantScores, setVariantScores] = useState<VariantScore[]>([])
  const [isScoringVariants, setIsScoringVariants] = useState(false)
  const [variantScoreError, setVariantScoreError] = useState('')

  // Smart Queue (Phase14-H)
  const [smartQueueMessage, setSmartQueueMessage] = useState('')

  // Auto Render Pipeline (Phase14-C)
  const [isAutoPipelineRunning, setIsAutoPipelineRunning] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState('')
  const [lastPipeline, setLastPipeline] = useState<LastPipeline | null>(null)
  const compareDashboardRef = useRef<HTMLDivElement | null>(null)
  const batchRenderRef = useRef<() => Promise<void>>(async () => {})
  const renderQueueRef = useRef<RenderQueueItem[]>([])

  // Best Variant Analyzer (Phase14-J)
  const [bestVariantAnalysis, setBestVariantAnalysis] = useState<BestVariantAnalysis | null>(null)
  const [isAnalyzingBestVariant, setIsAnalyzingBestVariant] = useState(false)
  const [bestVariantAnalysisError, setBestVariantAnalysisError] = useState('')

  // Smart Pipeline (Phase14-I)
  const [isSmartPipelineRunning, setIsSmartPipelineRunning] = useState(false)
  const [smartPipelineStatus, setSmartPipelineStatus] = useState('')
  const [smartPipelineError, setSmartPipelineError] = useState('')
  const [lastSmartPipeline, setLastSmartPipeline] = useState<LastSmartPipeline | null>(null)
  const generatedVariantsRef = useRef<GeneratedVariant[]>([])
  const variantScoresRef = useRef<VariantScore[]>([])

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

  // AI Reel Factory (Phase15-A / Phase15-B)
  const [factoryRunning, setFactoryRunning] = useState(false)
  const [factoryStep, setFactoryStep] = useState('')
  const [factoryError, setFactoryError] = useState('')
  const [factoryLog, setFactoryLog] = useState<string[]>([])
  const [factorySummary, setFactorySummary] = useState<FactorySummary | null>(null)
  const [factoryHistory, setFactoryHistory] = useState<FactoryHistoryItem[]>([])
  const [factoryNotice, setFactoryNotice] = useState('')

  // Snapshot Preview (Phase14-N)
  const [expandedSnapshotIds, setExpandedSnapshotIds] = useState<string[]>([])

  // Snapshot Diff View (Phase14-O)
  const [expandedDiffIds, setExpandedDiffIds] = useState<string[]>([])

  // AI Rewrite Explain (Phase14-R)
  const [rewriteExplainResults, setRewriteExplainResults] = useState<Record<string, RewriteExplainResult>>({})
  const [rewriteExplainLoadingIds, setRewriteExplainLoadingIds] = useState<string[]>([])
  const [rewriteExplainErrors, setRewriteExplainErrors] = useState<Record<string, string>>({})

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
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>(() => loadRecentIds())

  // テンプレートギャラリー強化 (Phase11.5-F)
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
    const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const data = await res.json()
    if (!data.ok) throw new Error(data.message)
    if (selectedTemplateId === id) setSelectedTemplateId('')
    await fetchTemplates()
  }, [fetchTemplates, selectedTemplateId])

  const renameTemplate = useCallback(async (id: string, name: string) => {
    const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.message)
    await fetchTemplates()
  }, [fetchTemplates])

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
    setRenderVariantName(h.renderVariantName ?? "")
    if (h.templateId && templates.some((t) => t.id === h.templateId)) {
      confirmLoadTemplate(h.templateId)
      setWorkflowMessage('履歴からテーマとテンプレートを復元しました。')
    } else if (h.templateId) {
      setWorkflowMessage('テンプレートが見つからないため、テーマのみ復元しました。')
    } else {
      setWorkflowMessage('履歴からテーマを復元しました。')
    }
  }, [templates, confirmLoadTemplate])

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

  const handleExplainRewrite = useCallback(async (item: RenderQueueItem, opts?: { force?: boolean }) => {
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
        setRewriteExplainErrors(prev => ({ ...prev, [item.id]: data.message ?? 'Failed to analyze rewrite.' }))
        return
      }
      setRewriteExplainResults(prev => {
        const next = { ...prev, [item.id]: data.result }
        try { localStorage.setItem(REWRITE_EXPLAIN_CACHE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    } catch {
      setRewriteExplainErrors(prev => ({ ...prev, [item.id]: 'Failed to analyze rewrite.' }))
    } finally {
      setRewriteExplainLoadingIds(prev => prev.filter(x => x !== item.id))
    }
  }, [slides, variantScores, rewriteExplainLoadingIds, rewriteExplainResults])

  const selectBestVariant = useCallback((id: string) => {
    setBestVariantId(id)
    try { localStorage.setItem(BEST_VARIANT_KEY, id) } catch {}
    const item = renderQueue.find((q) => q.id === id)
    if (item) {
      const angle = generatedVariants.find((v) => v.name === item.variantName)?.angle ?? 'unknown'
      recordLearningEvent({ theme: aiTheme, variantName: item.variantName, angle, action: 'selected_best' })
      if (item.slidesSnapshot && item.slidesSnapshot.length > 0) {
        setExpandedDiffIds(prev => prev.includes(id) ? prev : [...prev, id])
        handleExplainRewrite(item)
      }
    }
  }, [renderQueue, generatedVariants, aiTheme, recordLearningEvent, handleExplainRewrite])

  const autoGenerateVariants = useCallback(() => {
    let added = 0
    let skipped = 0
    setRenderQueue((prev) => {
      const existingNames = new Set(prev.map((q) => q.variantName))
      const newItems: RenderQueueItem[] = []
      for (const variantName of AUTO_VARIANT_TEMPLATES) {
        if (existingNames.has(variantName)) {
          skipped++
        } else {
          newItems.push({ id: crypto.randomUUID(), variantName, status: 'pending' })
          added++
        }
      }
      const next = [...prev, ...newItems]
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setTimeout(() => {
      setAutoGenerateNotice(
        skipped > 0
          ? `${added}件追加しました（${skipped}件は既に存在します）`
          : `${added}件追加しました`
      )
      setTimeout(() => setAutoGenerateNotice(''), 4000)
    }, 0)
  }, [])

  const addToQueue = useCallback(() => {
    const item: RenderQueueItem = {
      id: crypto.randomUUID(),
      variantName: renderVariantName.trim() || 'Default',
      status: 'pending',
    }
    setRenderQueue((prev) => {
      const next = [...prev, item]
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [renderVariantName])

  const removeFromQueue = useCallback((id: string) => {
    setRenderQueue((prev) => {
      const next = prev.filter((q) => q.id !== id)
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const clearQueue = useCallback(() => {
    setRenderQueue((prev) => {
      const rendering = prev.filter((q) => q.status === 'rendering')
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(rendering)) } catch {}
      return rendering
    })
  }, [])

  const toggleSnapshotPreview = useCallback((id: string) => {
    setExpandedSnapshotIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const toggleDiffView = useCallback((id: string) => {
    setExpandedDiffIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

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
        setRewriteStoryError((prev) => ({ ...prev, [angle]: data.message ?? 'Failed to rewrite story' }))
        return
      }
      const rewritten: RewrittenSlide[] = data.slides
      const merged: Slide[] = slides.map((s, i) => ({
        ...s,
        headline: rewritten[i]?.headline ?? s.headline,
        subline:  rewritten[i]?.subline  ?? s.subline,
        emphasis: rewritten[i]?.emphasis ?? s.emphasis,
      }))
      setRewrittenStories((prev) => {
        const next = { ...prev, [angle]: merged }
        try { localStorage.setItem(REWRITTEN_STORIES_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    } catch {
      setRewriteStoryError((prev) => ({ ...prev, [angle]: 'Failed to rewrite story' }))
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
  }, [rewrittenStories, slides, generatedVariants, aiTheme, recordLearningEvent])

  const addVariantToQueue = useCallback((variantName: string) => {
    setRenderQueue((prev) => {
      if (prev.some((q) => q.variantName === variantName)) return prev
      const next = [...prev, { id: crypto.randomUUID(), variantName, status: 'pending' as const }]
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const addAllVariantsToQueue = useCallback(() => {
    setRenderQueue((prev) => {
      const existingNames = new Set(prev.map((q) => q.variantName))
      const newItems = generatedVariants
        .filter((v) => !existingNames.has(v.name))
        .map((v) => ({ id: crypto.randomUUID(), variantName: v.name, status: 'pending' as const }))
      if (newItems.length === 0) return prev
      const next = [...prev, ...newItems]
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [generatedVariants])

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
    const existingNames = new Set(renderQueue.map((q) => q.variantName))
    const toAdd = targets.filter((v) => !existingNames.has(v.name))
    const addedCount = toAdd.length
    const skippedCount = targets.length - addedCount
    if (addedCount > 0) {
      setRenderQueue((prev) => {
        const prevNames = new Set(prev.map((q) => q.variantName))
        const newItems = toAdd
          .filter((v) => !prevNames.has(v.name))
          .map((v) => ({ id: crypto.randomUUID(), variantName: v.name, status: 'pending' as const }))
        if (newItems.length === 0) return prev
        const next = [...prev, ...newItems]
        try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    }
    if (addedCount === 0) {
      setSmartQueueMessage(`全${targets.length}件は既にQueueにあります`)
    } else if (skippedCount > 0) {
      setSmartQueueMessage(`${addedCount}件追加しました / ${skippedCount}件は既にQueueにあります`)
    } else {
      setSmartQueueMessage(`${addedCount}件をSmart Queueに追加しました`)
    }
  }, [variantScores, generatedVariants, renderQueue])

  const updateQueueItem = useCallback((id: string, patch: Partial<RenderQueueItem>) => {
    setRenderQueue((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, ...patch } : q)
      try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RENDER_QUEUE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) setRenderQueue(parsed)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BEST_VARIANT_KEY)
      if (raw) setBestVariantId(raw)
    } catch {}
  }, [])

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
        setRewrittenStories(parsed as Record<string, Slide[]>)
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BEST_VARIANT_ANALYSIS_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setBestVariantAnalysis(parsed as BestVariantAnalysis)
      }
    } catch {}
  }, [])

  // Rewrite Explain Cache 復元 (Phase14-S)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REWRITE_EXPLAIN_CACHE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setRewriteExplainResults(parsed as Record<string, RewriteExplainResult>)
      }
    } catch {
      console.warn('[Phase14-S] rewrite explain cache parse failed')
    }
  }, [])

  // Factory Summary Cache 復元 (Phase15-C)
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

  // Factory History 復元 (Phase15-E)
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

  const handleNewProject = useCallback(() => {
    if (hasUnsavedChanges && !window.confirm('未保存の変更があります。新規作成すると現在の内容が失われます。続けますか？')) return
    const blankSlides: Slide[] = Array.from({ length: 14 }, (_, i) => ({
      id: i + 1,
      durationSec: i === 13 ? 5 : 3,
      visible: true,
      headline: '',
      subline: '',
      emphasis: '',
      image: '',
      layout: i === 13 ? 'cta' as const : 'bottom' as const,
      showParticles: false,
    }))
    setSlides(blankSlides)
    setSelectedId(1)
    setHasUnsavedChanges(true)
    setAiTheme('')
  }, [hasUnsavedChanges])

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
    const targets = slides.filter((slide) => slide.imagePrompt).slice(0, 14)
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

  const saveSnapshotToServer = useCallback(async (snapshotSlides: Slide[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slides: snapshotSlides, cta: ctaConfig }),
      })
      const body = await parseJsonResponse(res)
      return res.ok && (body as { ok: boolean }).ok
    } catch {
      return false
    }
  }, [title, ctaConfig])

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

  const batchRender = useCallback(async () => {
    const pending = renderQueue.filter((q) => q.status === 'pending')
    if (pending.length === 0 || isBatchRendering) return

    setIsBatchRendering(true)

    // For non-snapshot items, save current slides once upfront if needed
    const hasNonSnapshot = pending.some((q) => !q.slidesSnapshot)
    if (hasNonSnapshot && hasUnsavedChanges) {
      setIsPreparingRender(true)
      const ok = await saveToServer()
      setIsPreparingRender(false)
      if (!ok) {
        setIsBatchRendering(false)
        return
      }
    }

    let snapshotWasUsed = false

    for (const item of pending) {
      // Save snapshot or restore current slides as needed
      if (item.slidesSnapshot) {
        setIsPreparingRender(true)
        const ok = await saveSnapshotToServer(item.slidesSnapshot)
        setIsPreparingRender(false)
        if (!ok) {
          updateQueueItem(item.id, { status: 'failed' })
          updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: 'Snapshot save failed' })
          continue
        }
        snapshotWasUsed = true
      } else if (snapshotWasUsed) {
        // Restore current editor slides before rendering a non-snapshot item
        setIsPreparingRender(true)
        const ok = await saveToServer()
        setIsPreparingRender(false)
        if (!ok) {
          updateQueueItem(item.id, { status: 'failed' })
          updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: 'Slide save failed' })
          continue
        }
        snapshotWasUsed = false
      }

      updateQueueItem(item.id, { status: 'rendering' })
      setRenderVariantName(item.variantName)
      setRenderError('')
      setRenderStatus('idle')
      setRenderStartedAt(Date.now())
      setElapsedSec(0)

      try {
        const res = await fetch('/api/render', { method: 'POST' })
        const data = await parseJsonResponse(res)
        if (!res.ok) throw new Error((data.message as string) ?? `HTTP ${res.status}`)
        setRenderStatus('running')

        const result = await new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
          const intId = setInterval(async () => {
            try {
              const sr = await fetch('/api/render/status')
              const sd = await parseJsonResponse(sr)
              const st = sd.status as string
              setRenderStatus(st as 'idle' | 'running' | 'completed' | 'failed')
              if (st === 'completed') {
                clearInterval(intId)
                resolve({ success: true, url: sd.downloadUrl as string })
              } else if (st === 'failed') {
                clearInterval(intId)
                resolve({ success: false, error: (sd.error as string) ?? '不明なエラー' })
              }
            } catch (err) {
              clearInterval(intId)
              resolve({ success: false, error: String(err) })
            }
          }, 2000)
        })

        if (result.success) {
          if (result.url) setLatestDownloadUrl(result.url)
          fetchHistory()
          updateQueueItem(item.id, {
            status: 'completed',
            outputPath: result.url,
            renderedAt: new Date().toISOString(),
          })
          updateLatestHistory({
            renderStatus: 'completed',
            renderOutputPath: result.url,
            renderVariantName: item.variantName,
            renderedAt: new Date().toISOString(),
          })
        } else {
          const errMsg = result.error ?? '不明なエラー'
          setRenderError(errMsg)
          updateQueueItem(item.id, { status: 'failed' })
          updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
        }
      } catch (err) {
        const errMsg = String(err)
        setRenderError(errMsg)
        setRenderStatus('failed')
        updateQueueItem(item.id, { status: 'failed' })
        updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
      }
    }

    // Restore current editor slides to server if snapshots dirtied it
    if (snapshotWasUsed) {
      await saveToServer()
    }

    setIsBatchRendering(false)
  }, [renderQueue, isBatchRendering, hasUnsavedChanges, saveToServer, saveSnapshotToServer, updateQueueItem, updateLatestHistory, fetchHistory])

  // Keep refs updated so pipelines always read the latest state
  batchRenderRef.current = batchRender
  renderQueueRef.current = renderQueue
  generatedVariantsRef.current = generatedVariants
  variantScoresRef.current = variantScores

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
  }, [isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, autoGenerateVariants])

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
      setRenderQueue((prev) => {
        const existingNames = new Set(prev.map((q) => q.variantName))
        const newItems = targets
          .filter((v) => !existingNames.has(v.name))
          .map((v) => ({ id: crypto.randomUUID(), variantName: v.name, status: 'pending' as const }))
        if (newItems.length === 0) return prev
        const next = [...prev, ...newItems]
        try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
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
  }, [isSmartPipelineRunning, isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, aiTheme, variantLearningEvents])

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
      if (!rewriteData.ok) throw new Error(rewriteData.message ?? 'Failed to rewrite story')
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
      setRenderQueue((prev) => {
        if (prev.some((q) => q.variantName === rewriteVariantName)) return prev
        const next = [...prev, {
          id: crypto.randomUUID(),
          variantName: rewriteVariantName,
          status: 'pending' as const,
          slidesSnapshot: mergedSlides,
          snapshotCreatedAt: new Date().toISOString(),
        }]
        try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
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
  }, [isSmartRewritePipelineRunning, isSmartPipelineRunning, isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, aiTheme, variantLearningEvents, slides])

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
      setRenderQueue((prev) => {
        const existingNames = new Set(prev.map((q) => q.variantName))
        const newItems = rewriteQueueItems
          .filter(({ variantName }) => !existingNames.has(variantName))
          .map(({ variantName, snapshotSlides }) => ({
            id: crypto.randomUUID(),
            variantName,
            status: 'pending' as const,
            slidesSnapshot: snapshotSlides,
            snapshotCreatedAt: new Date().toISOString(),
          }))
        if (newItems.length === 0) return prev
        const next = [...prev, ...newItems]
        try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
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
  }, [isMultiRewriteQueueRunning, isSmartRewritePipelineRunning, isSmartPipelineRunning, isAutoPipelineRunning, isBatchRendering, isPreparingRender, renderStatus, aiTheme, variantLearningEvents, slides])

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
    setExpandedSnapshotIds((prev) =>
      prev.includes(item.id) ? prev : [...prev, item.id]
    )
    requestAnimationFrame(() => {
      document
        .getElementById(`render-queue-item-${item.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [findFactoryQueueItem])

  // ==============================
  // AI Reel Factory
  // ==============================
  const handleRunReelFactory = useCallback(async (overrideTheme?: string) => {
    const themeForRun = (overrideTheme ?? aiTheme).trim()
    if (factoryRunning || !themeForRun) {
      if (!themeForRun) setFactoryError('テーマを入力してください')
      return
    }
    setFactoryRunning(true)
    setFactoryError('')
    setFactoryLog([])

    const addLog = (msg: string) => setFactoryLog((prev) => [...prev, msg])

    try {
      // Step 1: Story Generate
      setFactoryStep('Step 1/7: ストーリー生成中...')
      addLog('[1/7] Story Generate 開始')
      const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId)
      const story = await generateStory(
        themeForRun,
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

      // Step 2: AI Image Generate
      setFactoryStep('Step 2/7: AI画像生成中...')
      addLog('[2/7] AI画像生成 開始')
      let slidesWithImages = [...storySlides]
      const imageTargets = storySlides.filter((s) => s.imagePrompt).slice(0, 14)
      addLog(`[2/7] 画像生成対象: ${imageTargets.length}枚`)
      for (let ii = 0; ii < imageTargets.length; ii++) {
        const target = imageTargets[ii]
        addLog(`  画像 ${ii + 1}/${imageTargets.length}: ${target.imagePrompt?.slice(0, 40)}...`)
        try {
          const imgRes = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: target.imagePrompt }),
          })
          const imgData = await imgRes.json()
          if (imgData.ok && imgData.image) {
            slidesWithImages = slidesWithImages.map((s) =>
              s.id === target.id ? { ...s, image: imgData.image } : s
            )
            setSlides([...slidesWithImages])
          } else {
            addLog(`  ⚠️ 画像生成スキップ (ID ${target.id}): ${imgData.message ?? 'APIエラー'}`)
          }
        } catch (imgErr) {
          addLog(`  ⚠️ 画像生成スキップ (ID ${target.id}): ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`)
        }
      }
      addLog(`[2/7] AI画像生成完了`)

      // Step 3: Variant Generate
      setFactoryStep('Step 3/7: バリアント生成中...')
      addLog('[3/7] Variant Generate 開始')
      const genRes = await fetch('/api/variant-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: themeForRun }),
      })
      const genData = await genRes.json()
      if (!genData.ok) throw new Error(genData.message ?? 'Failed to generate variants')
      const variants: GeneratedVariant[] = genData.variants
      setGeneratedVariants(variants)
      generatedVariantsRef.current = variants
      try { localStorage.setItem(GENERATED_VARIANTS_KEY, JSON.stringify(variants)) } catch {}
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
      const scores: VariantScore[] = scoreData.scores
      setVariantScores(scores)
      variantScoresRef.current = scores
      try { localStorage.setItem(VARIANT_SCORES_KEY, JSON.stringify(scores)) } catch {}
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
      let actualQueueAdded = 0
      setRenderQueue((prev) => {
        const existingNames = new Set(prev.map((q) => q.variantName))
        const newItems = queueItems.filter((item) => !existingNames.has(item.variantName))
        actualQueueAdded = newItems.length
        if (newItems.length === 0) return prev
        const next = [...prev, ...newItems]
        try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
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

      // Factory History 追加 (Phase15-E)
      const autoTags = inferFactoryTags(themeForRun)
      const historyItem: FactoryHistoryItem = {
        ...summary,
        id: crypto.randomUUID(),
        theme: themeForRun,
        tags: autoTags.length > 0 ? autoTags : undefined,
      }
      if (autoTags.length > 0) {
        addLog(`Auto tags: ${autoTags.join(', ')}`)
      }
      setFactoryHistory((prev) => {
        const next = [historyItem, ...prev].slice(0, 20)
        try { localStorage.setItem(FACTORY_HISTORY_KEY, JSON.stringify(next)) } catch {}
        return next
      })

      setFactoryStep('Factory complete')
      addLog('Factory Run 完了！Render Queueを確認してください。')
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      compareDashboardRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Factory Run failed'
      setFactoryError(msg)
      setFactoryStep('Factory failed')
      addLog(`ERROR: ${msg}`)
    } finally {
      setFactoryRunning(false)
    }
  }, [factoryRunning, aiTheme, customPresets, selectedCustomPresetId, selectedPresetKey, slides, variantLearningEvents])

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
  }, [showFactoryNotice])

  const handleDuplicateFactoryTheme = useCallback((theme: string) => {
    setAiTheme(`${theme} `)
    showFactoryNotice('テーマを編集してから Factory Run してください')
    requestAnimationFrame(() => {
      const el = document.getElementById('ai-theme-input') as HTMLInputElement | null
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }, [showFactoryNotice])

  const handleRerunFactoryTheme = useCallback(async (theme: string) => {
    setAiTheme(theme)
    showFactoryNotice('過去テーマで Factory を再実行します')
    requestAnimationFrame(() => {
      document
        .getElementById('ai-theme-input')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    await handleRunReelFactory(theme)
  }, [handleRunReelFactory, showFactoryNotice])

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
      if (!data.ok) throw new Error(data.message ?? 'Failed to analyze best variant')
      const analysis: BestVariantAnalysis = data.analysis
      setBestVariantAnalysis(analysis)
      try { localStorage.setItem(BEST_VARIANT_ANALYSIS_KEY, JSON.stringify(analysis)) } catch {}
    } catch (err) {
      setBestVariantAnalysisError(err instanceof Error ? err.message : 'Failed to analyze best variant')
    } finally {
      setIsAnalyzingBestVariant(false)
    }
  }, [bestVariantId, isAnalyzingBestVariant, renderQueue, generatedVariants, variantScores, aiTheme, variantLearningEvents])

  // AUTO_ANALYZE_ON_BEST_SELECT hook (MVP: OFF)
  useEffect(() => {
    if (!AUTO_ANALYZE_ON_BEST_SELECT) return
    if (bestVariantId) analyzeBestVariant()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestVariantId])

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
            updateLatestHistory({
              renderStatus: 'completed',
              renderOutputPath: url ?? undefined,
              renderVariantName: renderVariantName.trim() || 'Default',
              renderedAt: new Date().toISOString(),
            })
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
  }, [stopPolling, fetchHistory, updateLatestHistory, renderVariantName])

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

  const variantLearningSummary = useMemo(() => {
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

  const isRendering = isPreparingRender || renderStatus === 'running'

  const completedVariants = useMemo(
    () =>
      [...renderQueue]
        .filter((q) => q.status === 'completed')
        .sort((a, b) => {
          const ta = a.renderedAt ? new Date(a.renderedAt).getTime() : 0
          const tb = b.renderedAt ? new Date(b.renderedAt).getTime() : 0
          return tb - ta
        }),
    [renderQueue]
  )


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

  const factoryStepNum =
    factoryStep === 'Step 1/7: ストーリー生成中...' ? 1 :
    factoryStep === 'Step 2/7: AI画像生成中...' ? 2 :
    factoryStep === 'Step 3/7: バリアント生成中...' ? 3 :
    factoryStep === 'Step 4/7: バリアントスコアリング中...' ? 4 :
    factoryStep === 'Step 5/7: トップバリアントを選定中...' ? 5 :
    factoryStep === 'Step 6/7: バリアントをリライト中...' ? 6 :
    factoryStep === 'Step 7/7: キューに投入中...' ? 7 :
    factoryStep === 'Factory complete' ? 8 : 0

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

      {/* ── 左パネル: スライド一覧 ── */}
      <div className="panel panel-left">
        <div className="panel-header">
          <div className="panel-header-left">
            <span className="panel-title">スライド一覧</span>
            {hasUnsavedChanges && <span className="unsaved-badge">未保存</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn-new-project" onClick={handleNewProject} title="14枚の空白スライドで新規作成">
              ＋ 新規
            </button>
            <span className="panel-badge">{slides.length}枚</span>
          </div>
        </div>

        <div className="panel-left-body">

        {/* テンプレートセクション */}
        <div className="template-section">
          <TemplateGalleryPanel
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            isRendering={isRendering}
            recentTemplateIds={recentTemplateIds}
            usageMap={usageMap}
            onConfirmLoadTemplate={confirmLoadTemplate}
            onDuplicateTemplate={duplicateTemplate}
            onToggleFavorite={toggleFavorite}
            onDeleteTemplate={deleteTemplate}
            onRenameTemplate={renameTemplate}
          />
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
                    {(h.renderVariantName || h.renderedAt) && (
                      <div className="ai-gen-history-variant">
                        <span>Variant: {h.renderVariantName ?? 'Default'}</span>
                        {h.renderedAt && (
                          <span>Rendered: {new Date(h.renderedAt).toLocaleString()}</span>
                        )}
                      </div>
                    )}
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
            <div className="render-variant-row">
              <label className="render-variant-label" htmlFor="render-variant-input">Variant Name</label>
              <input
                id="render-variant-input"
                className="render-variant-input"
                type="text"
                placeholder="例：CTA強め版 / Instagram版 / YouTube版"
                value={renderVariantName}
                onChange={(e) => setRenderVariantName(e.target.value)}
                disabled={isRendering}
              />
            </div>
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
              disabled={isRendering || isBatchRendering || !renderPrecheck.canRender}
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

            {/* テーマ入力 */}
            <div className="ai-generator" style={{ marginBottom: 12 }}>
              <p className="ai-generator-label">テーマ入力</p>
              <div className="ai-generator-row">
                <input
                  id="ai-theme-input"
                  className="ai-generator-input"
                  type="text"
                  placeholder="テーマを入力..."
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAIGenerate()}
                  disabled={isGenerating}
                />
                <button
                  className={`ai-generator-btn${isGenerating ? ' ai-generator-btn--loading' : ''}`}
                  onClick={handleAIGenerate}
                  disabled={!aiTheme.trim() || isGenerating}
                >
                  {isGenerating ? '生成中...' : 'ストーリー生成'}
                </button>
              </div>
              {generateError && (
                <p className="ai-generator-error">{generateError}</p>
              )}
              {generateSuccess && !generateError && (
                <p className="ai-generator-success">14枚のストーリーを生成しました</p>
              )}
            </div>

            {/* 🏭 AI Reel Factory (Phase16-L) */}
            <FactoryPanel
              factoryRunning={factoryRunning}
              factoryStep={factoryStep}
              factoryStepNum={factoryStepNum}
              factoryError={factoryError}
              factoryLog={factoryLog}
              factoryNotice={factoryNotice}
              isPipelineDisabled={isPipelineDisabled || !aiTheme.trim()}
              hasTheme={aiTheme.trim().length > 0}
              generatedSlides={slides
                .filter((s): s is typeof s & { image: string } => !!s.image?.startsWith('generated/'))
                .map((s) => ({ id: s.id, headline: s.headline, image: s.image }))}
              onRunFactory={() => handleRunReelFactory()}
              factorySummary={factorySummary}
              findFactoryQueueItem={findFactoryQueueItem}
              onClearSummary={() => {
                setFactorySummary(null)
                localStorage.removeItem(FACTORY_SUMMARY_CACHE_KEY)
              }}
              onJumpToQueueItem={handleJumpToQueueItem}
              factoryHistory={factoryHistory}
              maxThemeLength={MAX_HISTORY_THEME_LENGTH}
              quickTags={FACTORY_QUICK_TAGS}
              onHistoryUpdate={handleFactoryHistoryUpdate}
              onToggleFavorite={toggleFactoryHistoryFavorite}
              onReuseTheme={handleReuseFactoryTheme}
              onDuplicateTheme={handleDuplicateFactoryTheme}
              onRerunFactory={handleRerunFactoryTheme}
              onDelete={handleDeleteFactoryHistoryItem}
              onExportJson={handleExportFactoryHistory}
              onExportCsv={handleExportFactoryHistoryCsv}
              onImportFile={handleImportFactoryHistory}
              onClearHistory={handleClearFactoryHistory}
            />

            {/* Render Queue (Phase13-H/K / Phase14-C) */}
            <div className="render-queue-section">
              {/* 🚀 Auto Render Pipeline (Phase14-C) */}
              <button
                className="btn-auto-pipeline"
                onClick={handleAutoRenderPipeline}
                disabled={isPipelineDisabled || !aiTheme.trim()}
              >
                {isAutoPipelineRunning ? '🚀 パイプライン実行中...' : '🚀 自動レンダーパイプライン'}
              </button>

              {/* 🧠⚡ Smart Pipeline (Phase14-I) */}
              <button
                className="btn-smart-pipeline"
                onClick={handleSmartPipeline}
                disabled={isPipelineDisabled || !aiTheme.trim()}
              >
                {isSmartPipelineRunning ? '🧠⚡ スマートパイプライン実行中...' : '🧠⚡ スマートパイプライン'}
              </button>

              {/* Smart Pipeline Progress Card */}
              {isSmartPipelineRunning && (
                <div className="smart-pipeline-card smart-pipeline-card--running">
                  <p className="smart-pipeline-card-title">🧠⚡ スマートパイプライン実行中</p>
                  <div className="smart-pipeline-steps">
                    {[
                      { num: 1, label: 'AI生成' },
                      { num: 2, label: 'スコアリング' },
                      { num: 3, label: 'キュー投入' },
                      { num: 4, label: 'レンダリング' },
                      { num: 5, label: '比較' },
                    ].map(({ num, label }) => (
                      <div key={num} className={`smart-pipeline-step${smartPipelineStep >= num ? ' smart-pipeline-step--active' : ''}`}>
                        <span className="smart-pipeline-step-num">Step {num}/5</span>
                        <span className="smart-pipeline-step-label">{label}</span>
                        {smartPipelineStep === num && <span className="smart-pipeline-step-spinner">⏳</span>}
                        {smartPipelineStep > num && <span className="smart-pipeline-step-done">✅</span>}
                      </div>
                    ))}
                  </div>
                  <p className="smart-pipeline-status-text">{smartPipelineStatus}</p>
                </div>
              )}

              {/* Smart Pipeline Complete Card */}
              {!isSmartPipelineRunning && smartPipelineStatus === '比較ダッシュボード準備完了' && lastSmartPipeline && (
                <div className="smart-pipeline-card smart-pipeline-card--complete">
                  <p className="smart-pipeline-card-title">✅ スマートパイプライン完了</p>
                  <div className="smart-pipeline-stats">
                    <span>生成: <strong>{lastSmartPipeline.generatedCount}</strong></span>
                    <span>推奨: <strong>{lastSmartPipeline.recommendedCount}</strong></span>
                    <span>レンダリング: <strong>{lastSmartPipeline.renderedCount}</strong></span>
                    {lastSmartPipeline.failedCount > 0 && (
                      <span className="smart-pipeline-stat--fail">失敗: <strong>{lastSmartPipeline.failedCount}</strong></span>
                    )}
                  </div>
                  {smartPipelineError && <p className="smart-pipeline-notice">{smartPipelineError}</p>}
                </div>
              )}

              {/* Smart Pipeline Failed Card */}
              {!isSmartPipelineRunning && smartPipelineStatus === 'スマートパイプライン失敗' && (
                <div className="smart-pipeline-card smart-pipeline-card--failed">
                  <p className="smart-pipeline-card-title">❌ スマートパイプライン失敗</p>
                  <p className="smart-pipeline-error-text">{smartPipelineError}</p>
                </div>
              )}

              {/* 🪄⚡ Smart Rewrite Pipeline (Phase14-K) */}
              <button
                className="btn-smart-pipeline"
                onClick={handleSmartRewritePipeline}
                disabled={isPipelineDisabled || !aiTheme.trim()}
              >
                {isSmartRewritePipelineRunning ? '🪄⚡ スマートリライト実行中...' : '🪄⚡ スマートリライト'}
              </button>

              {/* Smart Rewrite Pipeline Progress Card */}
              {isSmartRewritePipelineRunning && (
                <div className="smart-pipeline-card smart-pipeline-card--running">
                  <p className="smart-pipeline-card-title">🪄⚡ スマートリライト実行中</p>
                  <div className="smart-pipeline-steps">
                    {[
                      { num: 1, label: 'AI生成' },
                      { num: 2, label: 'スコアリング' },
                      { num: 3, label: 'トップ選定' },
                      { num: 4, label: 'ストーリーリライト' },
                      { num: 5, label: 'ストーリー適用' },
                      { num: 6, label: 'キュー投入' },
                      { num: 7, label: 'レンダリング' },
                      { num: 8, label: '比較' },
                    ].map(({ num, label }) => (
                      <div key={num} className={`smart-pipeline-step${smartRewritePipelineStep >= num ? ' smart-pipeline-step--active' : ''}`}>
                        <span className="smart-pipeline-step-num">Step {num}/8</span>
                        <span className="smart-pipeline-step-label">{label}</span>
                        {smartRewritePipelineStep === num && <span className="smart-pipeline-step-spinner">⏳</span>}
                        {smartRewritePipelineStep > num && <span className="smart-pipeline-step-done">✅</span>}
                      </div>
                    ))}
                  </div>
                  <p className="smart-pipeline-status-text">{smartRewritePipelineStatus}</p>
                </div>
              )}

              {/* Smart Rewrite Pipeline Complete Card */}
              {!isSmartRewritePipelineRunning && smartRewritePipelineStatus === 'スマートリライト完了' && lastSmartRewritePipeline && (
                <div className="smart-pipeline-card smart-pipeline-card--complete">
                  <p className="smart-pipeline-card-title">✅ スマートリライト完了</p>
                  <div className="smart-pipeline-stats">
                    {lastSmartRewritePipeline.selectedVariantName ? (
                      <>
                        <span>選定: <strong>{lastSmartRewritePipeline.selectedVariantName}</strong></span>
                        <span>推奨度: <strong>{lastSmartRewritePipeline.recommendation}/5</strong></span>
                        <span>レンダリング: <strong>{lastSmartRewritePipeline.renderedCount}</strong></span>
                        {lastSmartRewritePipeline.failedCount > 0 && (
                          <span className="smart-pipeline-stat--fail">失敗: <strong>{lastSmartRewritePipeline.failedCount}</strong></span>
                        )}
                      </>
                    ) : (
                      <span className="smart-pipeline-notice">{smartRewritePipelineError}</span>
                    )}
                  </div>
                  {smartRewritePipelineError && lastSmartRewritePipeline.selectedVariantName && (
                    <p className="smart-pipeline-notice">{smartRewritePipelineError}</p>
                  )}
                </div>
              )}

              {/* Smart Rewrite Pipeline Failed Card */}
              {!isSmartRewritePipelineRunning && smartRewritePipelineStatus === 'スマートリライト失敗' && (
                <div className="smart-pipeline-card smart-pipeline-card--failed">
                  <p className="smart-pipeline-card-title">❌ スマートリライト失敗</p>
                  <p className="smart-pipeline-error-text">{smartRewritePipelineError}</p>
                </div>
              )}

              {/* 🪄🧩 Multi Rewrite Queue (Phase14-L) */}
              <button
                className="btn-smart-pipeline"
                onClick={handleMultiRewriteQueue}
                disabled={isPipelineDisabled || !aiTheme.trim()}
              >
                {isMultiRewriteQueueRunning ? '🪄🧩 マルチリライトキュー実行中...' : '🪄🧩 マルチリライトキュー'}
              </button>

              {/* Multi Rewrite Queue Progress Card */}
              {isMultiRewriteQueueRunning && (
                <div className="smart-pipeline-card smart-pipeline-card--running">
                  <p className="smart-pipeline-card-title">🪄🧩 マルチリライトキュー実行中</p>
                  <div className="smart-pipeline-steps">
                    {[
                      { num: 1, label: 'AI生成' },
                      { num: 2, label: 'スコアリング' },
                      { num: 3, label: 'トップ3選定' },
                      { num: 4, label: 'バリアントリライト' },
                      { num: 5, label: '最初のリライト適用' },
                      { num: 6, label: 'リライトキュー投入' },
                      { num: 7, label: 'レンダリング' },
                      { num: 8, label: '比較' },
                    ].map(({ num, label }) => (
                      <div key={num} className={`smart-pipeline-step${multiRewriteQueueStep >= num ? ' smart-pipeline-step--active' : ''}`}>
                        <span className="smart-pipeline-step-num">Step {num}/8</span>
                        <span className="smart-pipeline-step-label">{label}</span>
                        {multiRewriteQueueStep === num && <span className="smart-pipeline-step-spinner">⏳</span>}
                        {multiRewriteQueueStep > num && <span className="smart-pipeline-step-done">✅</span>}
                      </div>
                    ))}
                  </div>
                  <p className="smart-pipeline-status-text">{multiRewriteQueueStatus}</p>
                </div>
              )}

              {/* Multi Rewrite Queue Complete Card */}
              {!isMultiRewriteQueueRunning && multiRewriteQueueStatus === 'マルチリライトキュー完了' && lastMultiRewriteQueue && (
                <div className="smart-pipeline-card smart-pipeline-card--complete">
                  <p className="smart-pipeline-card-title">✅ マルチリライトキュー完了</p>
                  <div className="smart-pipeline-stats">
                    {lastMultiRewriteQueue.selectedVariants.length > 0 ? (
                      <>
                        <span>リライト: <strong>{lastMultiRewriteQueue.rewrittenCount}</strong></span>
                        <span>キュー投入: <strong>{lastMultiRewriteQueue.queuedCount}</strong></span>
                        <span>レンダリング: <strong>{lastMultiRewriteQueue.renderedCount}</strong></span>
                        {lastMultiRewriteQueue.failedCount > 0 && (
                          <span className="smart-pipeline-stat--fail">失敗: <strong>{lastMultiRewriteQueue.failedCount}</strong></span>
                        )}
                      </>
                    ) : (
                      <span className="smart-pipeline-notice">{multiRewriteQueueError}</span>
                    )}
                  </div>
                  {lastMultiRewriteQueue.selectedVariants.length > 0 && (
                    <div className="smart-pipeline-selected-variants">
                      <p className="smart-pipeline-selected-label">選定:</p>
                      {lastMultiRewriteQueue.selectedVariants.map((name) => (
                        <span key={name} className="smart-pipeline-variant-tag">{name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Multi Rewrite Queue Failed Card */}
              {!isMultiRewriteQueueRunning && multiRewriteQueueStatus === 'マルチリライトキュー失敗' && (
                <div className="smart-pipeline-card smart-pipeline-card--failed">
                  <p className="smart-pipeline-card-title">❌ マルチリライトキュー失敗</p>
                  <p className="smart-pipeline-error-text">{multiRewriteQueueError}</p>
                </div>
              )}

              {/* Pipeline Progress Card */}
              {isAutoPipelineRunning && (
                <div className="pipeline-progress-card">
                  <p className="pipeline-progress-title">🚀 自動パイプライン実行中</p>
                  <div className="pipeline-steps">
                    <div className={`pipeline-step${pipelineStep >= 1 ? ' pipeline-step--active' : ''}`}>
                      <span className="pipeline-step-num">Step 1/3</span>
                      <span className="pipeline-step-label">バリアント生成</span>
                      {pipelineStep === 1 && <span className="pipeline-step-spinner">⏳</span>}
                      {pipelineStep > 1 && <span className="pipeline-step-done">✅</span>}
                    </div>
                    <div className={`pipeline-step${pipelineStep >= 2 ? ' pipeline-step--active' : ''}`}>
                      <span className="pipeline-step-num">Step 2/3</span>
                      <span className="pipeline-step-label">レンダリング</span>
                      {pipelineStep === 2 && <span className="pipeline-step-spinner">⏳</span>}
                      {pipelineStep > 2 && <span className="pipeline-step-done">✅</span>}
                    </div>
                    <div className={`pipeline-step${pipelineStep >= 3 ? ' pipeline-step--active' : ''}`}>
                      <span className="pipeline-step-num">Step 3/3</span>
                      <span className="pipeline-step-label">比較ダッシュボード準備</span>
                      {pipelineStep === 3 && <span className="pipeline-step-spinner">⏳</span>}
                    </div>
                  </div>
                  <p className="pipeline-status-text">{pipelineStatus}</p>
                </div>
              )}

              {/* Pipeline Complete Card */}
              {!isAutoPipelineRunning && pipelineStatus === '比較ダッシュボード準備完了' && lastPipeline && (
                <div className="pipeline-complete-card">
                  <p className="pipeline-complete-title">✅ パイプライン完了</p>
                  <p className="pipeline-complete-stat">{lastPipeline.completedCount} バリアントをレンダリング</p>
                  <p className="pipeline-complete-sub">比較できます</p>
                </div>
              )}

              {/* Pipeline Failed Card */}
              {!isAutoPipelineRunning && pipelineStatus === 'パイプライン失敗' && (
                <div className="pipeline-failed-card">
                  <p className="pipeline-failed-title">❌ パイプライン失敗</p>
                  <p className="pipeline-failed-sub">レンダーログを確認してください</p>
                </div>
              )}

              {/* 🧠 AI Variant Generator (Phase14-D) */}
              <div className="ai-variant-generator">
                <button
                  className="btn-ai-generate-variants"
                  onClick={generateAIVariants}
                  disabled={isPipelineDisabled || isGeneratingVariants || !aiTheme.trim()}
                >
                  {isGeneratingVariants ? '🧠 生成中...' : '🧠 AIバリアント生成'}
                </button>
                {variantGenerateError && (
                  <p className="variant-generate-error">{variantGenerateError}</p>
                )}
                {generatedVariants.length > 0 && (
                  <div className="generated-variants-panel">
                    <div className="generated-variants-header">
                      <p className="generated-variants-title">生成済みバリアント</p>
                      <div className="generated-variants-header-actions">
                        <button
                          className="btn-score-variants"
                          onClick={scoreVariants}
                          disabled={isPipelineDisabled || isScoringVariants || !aiTheme.trim()}
                        >
                          {isScoringVariants ? '📊 スコアリング中...' : '📊 スコアリング'}
                        </button>
                        <button
                          className="btn-add-all-variants"
                          onClick={addAllVariantsToQueue}
                          disabled={isPipelineDisabled}
                        >
                          ＋ 全てキューに追加
                        </button>
                        <button
                          className="btn-smart-queue"
                          onClick={addSmartQueue}
                          disabled={isPipelineDisabled || variantScores.length === 0}
                        >
                          ⚡ スマートキュー
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const candidateCount = variantScores.filter((s) => s.recommendation >= 4).length
                      return variantScores.length > 0 ? (
                        <div className="smart-queue-summary">
                          <span>スマートキュー候補: <strong>{candidateCount}</strong></span>
                          <span className="smart-queue-threshold">基準: 推奨度4以上</span>
                        </div>
                      ) : null
                    })()}
                    {smartQueueMessage && (
                      <p className="smart-queue-message">{smartQueueMessage}</p>
                    )}
                    {variantScoreError && (
                      <p className="variant-score-error">{variantScoreError}</p>
                    )}
                    <ul className="generated-variants-list">
                      {generatedVariants.map((v, i) => {
                        const sc = variantScores.find((s) => s.variantName === v.name || s.angle === v.angle)
                        const isRecommended = sc ? sc.recommendation >= 4 : false
                        return (
                        <li key={i} className={`generated-variant-card${isRecommended ? ' generated-variant-card--recommended' : ''}`}>
                          <div className="generated-variant-info">
                            <span className="generated-variant-name">🧠 {v.name}</span>
                            {isRecommended && <span className="variant-recommended-badge">⚡ 推奨</span>}
                            <span className="generated-variant-desc">{v.description}</span>
                          </div>
                          {sc && (
                              <div className="variant-score-panel">
                                <p className="variant-score-title">AIスコア</p>
                                <div className="variant-score-grid">
                                  <span className="vs-label">推奨度</span><span className="vs-value">{sc.recommendation}/5</span>
                                  <span className="vs-label">再生数</span><span className="vs-value">{sc.predictedViews}/5</span>
                                  <span className="vs-label">保存率</span><span className="vs-value">{sc.savePotential}/5</span>
                                  <span className="vs-label">CTA</span><span className="vs-value">{sc.ctaStrength}/5</span>
                                </div>
                                <p className="vs-reason">{sc.reason}</p>
                              </div>
                          )}
                          <div className="generated-variant-actions">
                            <button
                              className="btn-add-variant-queue"
                              onClick={() => addVariantToQueue(v.name)}
                              disabled={isPipelineDisabled || renderQueue.some((q) => q.variantName === v.name)}
                            >
                              {renderQueue.some((q) => q.variantName === v.name) ? '✓' : '＋ キューに追加'}
                            </button>
                            {rewrittenStories[v.angle] ? (
                              <button
                                className="btn-rewrite-story btn-rewrite-story--regen"
                                onClick={() => rewriteStory(v.angle)}
                                disabled={isRewritingStory[v.angle] || isPipelineDisabled}
                              >
                                {isRewritingStory[v.angle] ? '🪄 リライト中...' : '🔄 再生成'}
                              </button>
                            ) : (
                              <button
                                className="btn-rewrite-story"
                                onClick={() => rewriteStory(v.angle)}
                                disabled={isRewritingStory[v.angle] || isPipelineDisabled || slides.length === 0}
                              >
                                {isRewritingStory[v.angle] ? '🪄 リライト中...' : '🪄 ストーリーリライト'}
                              </button>
                            )}
                          </div>
                          {rewriteStoryError[v.angle] && (
                            <p className="rewrite-story-error">{rewriteStoryError[v.angle]}</p>
                          )}
                          {rewrittenStories[v.angle] && (
                            <div className="story-preview">
                              <div className="story-preview-header">
                                <span className="story-preview-title">ストーリープレビュー</span>
                                <button
                                  className="btn-apply-story"
                                  onClick={() => applyRewrittenStory(v.angle)}
                                >
                                  スライドに適用
                                </button>
                              </div>
                              {rewrittenStories[v.angle].slice(0, 3).map((s, si) => (
                                <div key={si} className="story-preview-slide">
                                  {s.headline && <p className="sps-headline">{s.headline}</p>}
                                  {s.subline   && <p className="sps-subline">{s.subline}</p>}
                                  {s.emphasis  && <p className="sps-emphasis">{s.emphasis}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>

              <div className="render-queue-top-actions">
                <button
                  className="btn-auto-generate"
                  onClick={autoGenerateVariants}
                  disabled={isPipelineDisabled}
                >
                  ✨ 自動生成
                </button>
                <button
                  className="btn-add-queue"
                  onClick={addToQueue}
                  disabled={isPipelineDisabled}
                >
                  ＋ 追加
                </button>
              </div>
              {autoGenerateNotice && (
                <p className="auto-generate-notice">{autoGenerateNotice}</p>
              )}

              <RenderQueuePanel
                renderQueue={renderQueue}
                expandedSnapshotIds={expandedSnapshotIds}
                expandedDiffIds={expandedDiffIds}
                rewriteExplainResults={rewriteExplainResults}
                rewriteExplainLoadingIds={rewriteExplainLoadingIds}
                rewriteExplainErrors={rewriteExplainErrors}
                isBatchRendering={isBatchRendering}
                isAutoPipelineRunning={isAutoPipelineRunning}
                isPipelineDisabled={isPipelineDisabled}
                canRender={renderPrecheck.canRender}
                slides={slides}
                onToggleSnapshotPreview={toggleSnapshotPreview}
                onToggleDiffView={toggleDiffView}
                onExplainRewrite={(item) => handleExplainRewrite(item, rewriteExplainResults[item.id] ? { force: true } : undefined)}
                onRemoveFromQueue={removeFromQueue}
                onBatchRender={batchRender}
                onClearQueue={clearQueue}
                renderDiffPanel={renderDiffPanel}
              />
            </div>
          </div>

          {/* Render Compare Dashboard (Phase13-I / Phase14-C) */}
          <div className="compare-dashboard" ref={compareDashboardRef}>
            <CompareDashboardPanel
              completedVariants={completedVariants}
              lastPipeline={lastPipeline}
              bestVariantId={bestVariantId}
              bestVariantAnalysis={bestVariantAnalysis}
              bestVariantAnalysisLoading={isAnalyzingBestVariant}
              bestVariantAnalysisError={bestVariantAnalysisError}
              expandedSnapshotIds={expandedSnapshotIds}
              expandedDiffIds={expandedDiffIds}
              rewriteExplainResults={rewriteExplainResults}
              rewriteExplainLoadingIds={rewriteExplainLoadingIds}
              rewriteExplainErrors={rewriteExplainErrors}
              slides={slides}
              onSelectBestVariant={selectBestVariant}
              onAnalyzeBestVariant={analyzeBestVariant}
              onToggleSnapshotPreview={toggleSnapshotPreview}
              onToggleDiffView={toggleDiffView}
              onExplainRewrite={(item) => handleExplainRewrite(item, rewriteExplainResults[item.id] ? { force: true } : undefined)}
              renderDiffPanel={renderDiffPanel}
            />
          </div>

          {/* Variant Learning (Phase14-F) */}
          <div className="variant-learning-section">
            <div className="variant-learning-header">
              <p className="variant-learning-title">Variant Learning</p>
              {variantLearningSummary.totalEvents > 0 && (
                <button className="btn-clear-learning" onClick={clearLearningData}>
                  Clear Learning Data
                </button>
              )}
            </div>
            {variantLearningSummary.totalEvents === 0 ? (
              <p className="variant-learning-empty">
                Apply To Slides または Select Best を行うと学習データが蓄積されます。
              </p>
            ) : (
              <>
                <div className="vl-stats">
                  <span className="vl-stat">Total Events: {variantLearningSummary.totalEvents}</span>
                  <span className="vl-stat">Applied: {variantLearningSummary.appliedCount}</span>
                  <span className="vl-stat">Selected Best: {variantLearningSummary.selectedBestCount}</span>
                </div>
                {variantLearningSummary.topAngles.length > 0 && (
                  <div className="vl-top-angles">
                    <p className="vl-subsection-title">Top Angles</p>
                    <ol className="vl-rank-list">
                      {variantLearningSummary.topAngles.map((a, i) => (
                        <li key={a.angle} className="vl-rank-item">
                          <span className="vl-rank-num">{i + 1}.</span>
                          <span className="vl-rank-label">{a.angle}</span>
                          <span className="vl-rank-count">{a.count}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {variantLearningSummary.recentEvents.length > 0 && (
                  <div className="vl-recent">
                    <p className="vl-subsection-title">Recent Learning</p>
                    <ul className="vl-recent-list">
                      {variantLearningSummary.recentEvents.map((e) => (
                        <li key={e.id} className="vl-recent-item">
                          <span className="vl-recent-date">
                            {new Date(e.createdAt).toLocaleDateString('ja-JP')}
                          </span>
                          <span className="vl-recent-angle">{e.angle}</span>
                          <span className="vl-recent-action">{e.action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
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

        </div>{/* panel-left-body */}
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
