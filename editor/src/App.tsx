import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { WizardMode } from './components/wizard/WizardMode'
import { Slide, SlidesData, ReelAiConfig, SimpleTemplateType, FreeDiagnosisForm, NoteArticleForm, YoutubeVideoForm, MusicCommunityForm, ScriptHandoff } from './types'
import { useStoryGenerator, type AIGenerationHistory } from './components/story/useStoryGenerator'
import { SimpleTemplateSelector } from './components/simple/SimpleTemplateSelector'
import { SimpleTemplateForms } from './components/simple/SimpleTemplateForms'
import { useSimpleMode } from './components/simple/useSimpleMode'
import { SIMPLE_TEMPLATE_DEFAULTS } from './constants/simpleTemplateDefaults'
import { SlideList } from './components/SlideList'
import { generateStory, AIPresetKey, CustomPreset } from './storyGenerator'
import './App.css'
import { useFactoryPipeline, MAX_HISTORY_THEME_LENGTH, FACTORY_QUICK_TAGS } from './components/factory/useFactoryPipeline'
import { usePipelineRunner } from './components/factory/usePipelineRunner'
import { usePresetManager } from './components/factory/usePresetManager'
import { useRenderUI } from './components/factory/useRenderUI'
import { useAssetManager } from './components/factory/useAssetManager'
import { useEditorCore } from './components/factory/useEditorCore'
import { useInitialReelLoader } from './components/factory/useInitialReelLoader'
import { usePanelPropsBuilder } from './components/factory/usePanelPropsBuilder'
import { useSlideEditor } from './components/factory/useSlideEditor'
import { PreviewWorkspace } from './components/factory/PreviewWorkspace'
import { SlideEditPanel } from './components/factory/SlideEditPanel'
import { TemplateModals } from './components/factory/TemplateModals'
import { ReelHeaderPanel } from './components/factory/ReelHeaderPanel'
import { FactoryPanel } from './components/factory/FactoryPanel'
import { FactoryHistoryPanel } from './components/factory/FactoryHistoryPanel'
import { MassModePanel } from './components/factory/MassModePanel'
import { AdvancedControlsPanel } from './components/factory/AdvancedControlsPanel'
import { PostingChecklistPanel } from './components/factory/PostingChecklistPanel'
import { VariantLearningPanel } from './components/factory/VariantLearningPanel'
import { RenderQueueTopActions } from './components/factory/RenderQueueTopActions'
import { UserImageUploadPanel } from './components/factory/UserImageUploadPanel'
import { useMassMode } from './components/factory/useMassMode'
import { RenderQueuePanel } from './components/render/RenderQueuePanel'
import { RenderCompletePanel } from './components/render/RenderCompletePanel'
import { CompareDashboardPanel } from './components/compare/CompareDashboardPanel'
import { useCompareDashboard } from './components/compare/useCompareDashboard'
import { TemplateGalleryPanel } from './components/template/TemplateGalleryPanel'
import { CustomPresetPanel } from './components/preset/CustomPresetPanel'
import { useTemplateGallery } from './components/template/useTemplateGallery'
import { GenerationHistoryPanel } from './components/bottom/GenerationHistoryPanel'
import { useRenderQueue } from './components/renderQueue/useRenderQueue'
import { useRenderQueueRunner } from './components/renderQueue/useRenderQueueRunner'
import { useHistoryManager } from './components/history/useHistoryManager'
import { AiGenerationHistoryPanel } from './components/history/AiGenerationHistoryPanel'
import { AssetsPanel } from './components/assets/AssetsPanel'
import { useImageGenerator } from './components/image/useImageGenerator'
import { useVariantManager } from './components/factory/useVariantManager'
import {
  usePostingManager,
} from './components/posting/usePostingManager'
import { SnsCaptionPanel } from './components/posting/SnsCaptionPanel'
import { EventPostManagementPanel } from './components/posting/EventPostManagementPanel'
import { useEventPosting } from './components/factory/useEventPosting'
import { PostEditPanel } from './components/editor/PostEditPanel'
import { LocalCaptionVideoMode } from './components/localCaption/LocalCaptionVideoMode'
import { ScriptMode } from './components/script/ScriptMode'

type AIPreset = {
  key: AIPresetKey
  label: string
  description: string
  themeTemplate: string
}

type RenderStatus = "none" | "completed" | "failed"

const USE_WIZARD_MODE = true

// ローカルAIテロップ動画（β・追加機能）: ?mode=local-caption で既存UIをバイパスして表示する。
// 既存のwizard/factoryロジックには一切手を入れず、完全に独立した画面を差し込むだけ。
const LOCAL_CAPTION_VIDEO_MODE_PARAM = 'local-caption'
function isLocalCaptionVideoModeRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('mode') === LOCAL_CAPTION_VIDEO_MODE_PARAM
}

// 台本作成モード: ?mode=script で表示する（local-caption と同じ独立画面。既存のwizard/factoryには触れない）。
function isScriptModeRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('mode') === 'script'
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
            <p className="snapshot-preview-label">スライド {item.idx + 1}</p>
            {item.diffs.map(d => {
              const { beforeNode, afterNode } = renderInlineDiff(d.before, d.after)
              return (
                <div key={d.field} className="snapshot-diff-row">
                  <p className="snapshot-diff-field">{d.field}</p>
                  <div className="snapshot-diff-before">
                    <span className="snapshot-diff-label">変更前</span>
                    <span className="snapshot-diff-text">{beforeNode}</span>
                  </div>
                  <div className="snapshot-diff-after">
                    <span className="snapshot-diff-label">変更後</span>
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
  {
    key: 'mmm_event',
    label: 'MMMイベント告知',
    description: 'MMMイベントの告知動画を30秒で作成',
    themeTemplate: 'MMMイベント告知。初心者歓迎・演奏参加・聴くだけ参加OKの音楽イベント告知ショートにしてください。テーマ：',
  },
]

const SIMPLE_TEMPLATE_LABELS: Record<SimpleTemplateType, string> = {
  'mmm-event': 'MMMイベント告知',
  'free-diagnosis': '無料歌唱診断',
  'note-article': 'Note記事',
  'youtube-video': 'YouTube動画',
  'music-community': '音楽コミュニティ',
  custom: 'カスタム',
}

function formatCacheSavedAt(iso: string): string {
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}/${m}/${day} ${h}:${min}`
  } catch { return iso }
}

// Phase18-F: かんたんモード テーマサジェスト
const SIMPLE_THEME_SUGGESTIONS = [
  '無料歌唱診断キャンペーンを紹介するショート動画',
  '音楽コミュニティの参加者募集動画',
  '今月のセッションイベント告知動画',
  'Note記事の内容を紹介するショート動画',
  'YouTube動画の見どころを紹介するショート動画',
]

const buildMmmTheme = (form: {
  title: string; date: string; startTime: string; endTime: string
  venue: string; price: string; url: string; message: string
}): string => {
  const parts: string[] = []
  if (form.title) parts.push(`イベント名「${form.title}」`)
  if (form.date) {
    const time = [form.startTime, form.endTime].filter(Boolean).join('〜')
    parts.push(`開催日時：${form.date}${time ? ` ${time}` : ''}`)
  }
  if (form.venue) parts.push(`会場：${form.venue}`)
  if (form.price) parts.push(`参加費：${form.price}`)
  if (form.url) parts.push(`イベントURL：${form.url}`)
  if (form.message) parts.push(form.message)
  parts.push('初心者歓迎。演奏参加・聴くだけ参加OK。')
  return `MMMイベント告知。${parts.join('。')}。参加したくなるショート動画にしてください。`
}

const SIMPLE_TEMPLATE_THEME_SUGGESTIONS: Record<string, string[]> = {
  'free-diagnosis-campaign': [
    '無料歌唱診断キャンペーンを紹介するショート動画',
    '100名限定の無料歌唱診断を案内する動画',
    '歌唱診断の申し込み方法を紹介する動画',
  ],
  'music-community': [
    '音楽コミュニティの参加者募集動画',
    '初心者歓迎のセッション会を紹介する動画',
    '音楽仲間と繋がれるコミュニティ紹介動画',
  ],
  'event-announcement': [
    '今月のセッションイベント告知動画',
    'ライブハウスイベントの参加募集動画',
    '6月開催の音楽イベントを告知するショート動画',
  ],
  'note-article': [
    'Note記事の内容を紹介するショート動画',
    '最新Noteの見どころを伝えるショート動画',
    'Noteに書いた音楽体験を紹介する動画',
  ],
  'youtube-video': [
    'YouTube動画の見どころを紹介するショート動画',
    '最新YouTube動画へ誘導するショート動画',
    'チャンネル登録を促すショート動画',
  ],
  'singing-diagnosis': [
    '歌唱診断サービスの魅力を伝えるショート動画',
    '歌唱力診断の申し込みを促す動画',
    '無料歌唱診断を受けた体験を紹介する動画',
  ],
  'mmm-event': [
    'MMMイベント告知動画（フォームに入力して自動生成）',
    '音楽イベントの参加者を増やすショート動画',
    '初心者も参加しやすいセッションイベントの告知動画',
  ],
}

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

const VISUAL_STYLE_TAG_OPTIONS = [
  'アニメ調', '実写風', '音楽', '演奏', 'かっこいい', 'かわいい',
  '上品', 'アーティスト', 'ダイナミック', 'ポップ', 'ミステリアス', '青春', 'ライブ感',
]

export default function App() {
  // Phase23-K state map:
  // Core editor/save, SNS/posting history, SimpleMode/templates, story/image generation,
  // Render/Compare pipelines, Factory, and asset/template management are still co-located here.
  // Next extraction candidates: useSimpleMode, useTemplateGallery, useHistoryManager, useCompareDashboard.
  // ScriptMode → Wizard の一時的な受け渡し（メモリ上だけ。URL・ストレージには保存しない）。
  // handoff: Wizard が取り込むまで保持。scriptModeLeft: ScriptMode から離れた後は ?mode=script でも再表示しない。
  const [scriptHandoff, setScriptHandoff] = useState<ScriptHandoff | null>(null)
  const [scriptModeLeft, setScriptModeLeft] = useState(false)
  // Core editor / save state
  const newProjectSideEffectsRef = useRef<() => void>(() => {})
  const editorCore = useEditorCore({
    initialTitle: 'BeMyStyle Reel',
    onNewProject: () => newProjectSideEffectsRef.current(),
  })
  const {
    slides,
    setSlides,
    title,
    setTitle,
    selectedId,
    setSelectedId,
    ctaConfig,
    setCtaConfig,
    saved,
    setSaved,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    loading,
    setLoading,
    currentSnapshot,
    markDirty,
    updateSlide,
    toggleVisible,
    moveSlide,
    handleSlideTextChange,
    handleCtaChange,
    handleNewProject,
    handleSnapshotSaved,
  } = editorCore
  const historyManager = useHistoryManager({
    currentSnapshot,
    onSaved: handleSnapshotSaved,
  })
  const {
    history,
    historyError,
    saveStatus,
    saveError,
    fetchHistory,
    saveSnapshotToServer,
    saveToServer,
  } = historyManager

  // Render preview / video download state
  const [videoPreviewLoading, setVideoPreviewLoading] = useState(false)
  const [videoPreviewError, setVideoPreviewError] = useState('')
  const videoPreviewRetryCount = useRef(0)
  const videoPreviewRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // History, render URL copy state
  const [copiedUrl, setCopiedUrl] = useState(false)



  // SimpleMode state / callbacks (Phase23-L)
  const simpleModeController = useSimpleMode()
  const {
    simpleMode,
    startSimpleMode,
    exitSimpleMode,
    simpleStep,
    goToSimpleStep,
    activeSimpleTab,
    selectSimpleTab,
    showDetailedFeatures,
    showDetails,
    resetCompletedView,
    reuseHintDismissedTemplates,
    simpleTemplateId,
    simpleTemplateType,
    selectSimpleTemplateType,
    showInTab: showInSimpleTab,
    dismissReuseHint,
  } = simpleModeController
  // Phase19-S: テンプレート別フォーム
  const [freeDiagnosisForm, setFreeDiagnosisForm] = useState<FreeDiagnosisForm>({ campaignName: '', targetAudience: '', diagnosisMethod: '', lineUrl: '', message: '' })
  const [noteArticleForm, setNoteArticleForm] = useState<NoteArticleForm>({ articleTitle: '', articleTheme: '', targetReader: '', articleUrl: '', message: '' })
  const [youtubeVideoForm, setYoutubeVideoForm] = useState<YoutubeVideoForm>({ videoTitle: '', videoTheme: '', highlights: '', youtubeUrl: '', message: '' })
  const [musicCommunityForm, setMusicCommunityForm] = useState<MusicCommunityForm>({ communityName: '', activities: '', targetAudience: '', joinUrl: '', message: '' })
  const [reelAiConfig, setReelAiConfig] = useState<ReelAiConfig>({ aiMode: 'real', dryRun: false, testImageLimit: null })
  // Phase29-B: テストモード（画像生成スキップ）
  const [testMode, setTestMode] = useState(() => localStorage.getItem('bemystyle-reel-test-mode') === 'true')
  // Phase19-D: MMMイベント告知フォーム
  const [mmmEventForm, setMmmEventForm] = useState({
    title: '',
    date: '',
    startTime: '',
    endTime: '',
    venue: '',
    price: '',
    url: '',
    message: '',
  })
  const [mmmError, setMmmError] = useState('')
  const [isSimpleAdvancedSettingsOpen, setIsSimpleAdvancedSettingsOpen] = useState(false)
  const [isMmmDetailsOpen, setIsMmmDetailsOpen] = useState(false)
  const [imageCreationMode, setImageCreationMode] = useState<'save' | 'reuse' | 'full' | 'upload'>('upload')

  // Phase19-E: 世界観タグ
  const [visualStyleTags, setVisualStyleTags] = useState<string[]>([
    'アニメ調', '音楽', '演奏', '上品', 'アーティスト',
  ])

  const { slideEditorOpen, setSlideEditorOpen, selectedSlide, selectedSlideIndex, slideCount, closeSlideEditor } = useSlideEditor({ slides, selectedId, setSelectedId })

  const historyAreaRef = useRef<HTMLDivElement | null>(null)

  // Phase23-Z: Asset / Image state and callbacks
  const assetManager = useAssetManager({
    slides,
    ctaConfig,
    setSlides,
    setCtaConfig,
    markDirty,
  })
  const {
    userUploadedImages,
    userUploadedImagesRef,
    imageSourceMode,
    setImageSourceMode,
    bgmFileName,
    setBgmFileName,
    bgmUploading,
    bgmUploadError,
    setBgmUploadError,
    qrFileName,
    qrUploading,
    qrUploadError,
    imageQualityMode,
    setImageQualityMode,
    costMode,
    setCostMode,
    quotaError,
    setQuotaError,
    recommendedCtaLabel,
    setRecommendedCtaLabel,
    slideImageReplacing,
    slideImageReplaceError,
    handleUserImageUpload,
    removeUserUploadedImage,
    reorderUserUploadedImage,
    handleUserImageDropFiles,
    handleBgmUpload,
    handleQrUpload,
    handleSlideImageReplace,
  } = assetManager

  // Phase23-X: Preset state / callbacks / template variables
  const presetManager = usePresetManager({
    slides,
    title,
    ctaConfig,
    setSlides,
    setTitle,
    setCtaConfig,
    setSelectedId,
    markDirty,
    visualStyleTags,
    setVisualStyleTags,
    bgmFileName,
    setBgmFileName,
    mmmEventForm,
    setMmmEventForm,
  })
  const {
    editPresets,
    editPresetName,
    selectedEditPresetId,
    setEditPresets,
    setEditPresetName,
    setSelectedEditPresetId,
    mmmEventPresets,
    mmmEventPresetName,
    selectedMmmEventPresetId,
    mmmEventPresetNotice,
    setMmmEventPresets,
    setMmmEventPresetName,
    setSelectedMmmEventPresetId,
    setMmmEventPresetNotice,
    rawTemplateSlides,
    templateVariableKeys,
    variableValues,
    setVariableValues,
    applyLoadedTemplate,
    handleVariableChange,
    saveEditPreset,
    applyEditPreset,
    deleteEditPreset,
    saveMmmEventPreset,
    applyMmmEventPreset,
    deleteMmmEventPreset,
    isDefaultEditPreset,
    isDefaultMmmEventPreset,
  } = presetManager

  const templateGallery = useTemplateGallery({
    title,
    slides,
    ctaConfig,
    rawTemplateSlides,
    onTemplateLoaded: applyLoadedTemplate,
  })
  const {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    templateConfirmPending,
    templateHints,
    saveTemplateModal,
    saveTemplateName,
    setSaveTemplateName,
    saveTemplateCategory,
    setSaveTemplateCategory,
    saveTemplateDescription,
    setSaveTemplateDescription,
    saveTemplateStatus,
    generatedAssets,
    assetsLoading,
    assetsMessage,
    recentTemplateIds,
    usageMap,
    fetchTemplates,
    fetchGeneratedAssets,
    confirmLoadTemplate,
    cancelLoadTemplate,
    openSaveTemplateModal,
    cancelSaveTemplateModal,
    loadTemplate,
    saveAsTemplate,
    duplicateTemplate,
    deleteTemplate,
    renameTemplate,
    toggleFavorite,
    deleteGeneratedAsset,
    deleteUnusedAssets,
  } = templateGallery

  // Phase23-R: Story生成 state / callbacks を useStoryGenerator に分離
  const storyGenerator = useStoryGenerator({
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
  })
  const {
    aiTheme, setAiTheme,
    selectedPresetKey, setSelectedPresetKey,
    isGenerating,
    autoApplyRecommendedTemplate, setAutoApplyRecommendedTemplate,
    autoApplyTemplateNotice,
    aiGenerationHistory,
    importNotice, importInputRef,
    customPresets, customPresetForm, setCustomPresetForm,
    selectedCustomPresetId, setSelectedCustomPresetId,
    presetImportNotice, presetImportRef,
    editingCustomPresetId, setEditingCustomPresetId,
    editingCustomPresetForm, setEditingCustomPresetForm,
    presetInsight, isGeneratingPresetInsight, presetInsightError,
    createdInsightIndices, isAnalyticsExpanded, setIsAnalyticsExpanded,
    updateLatestHistory,
    deleteAIGenerationHistoryItem, clearAIGenerationHistory,
    exportAIGenerationHistory, handleImport,
    handleSaveCustomPreset, handleDeleteCustomPreset,
    handleUseCustomPreset, handleExportCustomPresets,
    handleImportCustomPresets, handleSaveEditCustomPreset,
    handleDuplicateCustomPreset, handleClearCustomPresets,
    handleExportAnalyticsCsv, handleGeneratePresetInsight,
    handleSaveInsightPreset, handleToggleFavoriteCustomPreset,
    handleMoveCustomPreset,
  } = storyGenerator

  // Render Variant / Queue / Compare / AutoGen (Phase13-G/H/I/K)
  const { items: renderQueue, itemsRef: renderQueueRef, addToRenderQueue, addVariantName: addVariantNameToQueue, addVariantNames: addVariantNamesToQueue, addSnapshotItem: addSnapshotItemToQueue, addQueueItems, updateQueueItem: updateQueueItemFromHook, removeFromQueue, clearQueue } = useRenderQueue()
  const massMode = useMassMode({ addToRenderQueue })

  // Auto Render Pipeline (Phase14-C)
  const compareDashboardRef = useRef<HTMLDivElement | null>(null)
  const batchRenderRef = useRef<(itemIds?: string[]) => Promise<void>>(async () => {})

  const fetchReelAiConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/reel-ai-config')
      const data = await res.json()
      if (!data.ok) return
      const parsedImageLimit = Math.max(0, Number(data.testImageLimit ?? data.imageLimit ?? 0) || 0)
      setReelAiConfig({
        aiMode: data.aiMode === 'mock' || data.mode === 'mock' ? 'mock' : 'real',
        dryRun: data.dryRun === true,
        testImageLimit: parsedImageLimit > 0 ? parsedImageLimit : null,
      })
    } catch (_) {}
  }, [])

  const postingManager = usePostingManager({
    slides,
    title,
    selectedPresetKey,
    customPresets,
    selectedCustomPresetId,
    selectedTemplateId,
    simpleTemplateId,
    aiTheme,
    templates,
    updateLatestHistory,
  })
  const {
    snsCaption,
    setSnsCaption,
    isGeneratingSnsCaption,
    snsCaptionError,
    copiedSnsField,
    copiedAllCaption,
    copiedCaptionLabel,
    editingCaptionKey,
    editingCaptionText,
    setEditingCaptionText,
    regeneratingCaptionKey,
    postChecklist,
    isPostChecklistComplete,
    postedRecords,
    postedForm,
    setPostedForm,
    postedRecordsImportMessage,
    postedRecordsImportError,
    postedReport,
    generateSnsCaption,
    regenerateCaptionPart,
    copySnsText,
    copyAllCaptions,
    copyCaptionText,
    startCaptionEdit,
    cancelCaptionEdit,
    saveCaptionEdit,
    togglePostChecklist,
    resetPostChecklist,
    resetPostedRecords,
    addPostedRecord,
    deletePostedRecord,
    exportPostedRecordsCsv,
    exportPostedRecordsJson,
    handleImportPostedRecordsJson,
  } = postingManager
  newProjectSideEffectsRef.current = () => {
    setAiTheme('')
    setIsSimpleAdvancedSettingsOpen(false)
    resetPostChecklist()
    resetPostedRecords()
  }

  const eventPosting = useEventPosting({
    qrFileName,
    bgmFileName,
    mmmEventForm,
    snsCaption,
    selectedMmmEventPresetId,
    aiTheme,
    editPresets,
    mmmEventPresets,
    setMmmEventPresets,
    setEditPresets,
  })
  const {
    eventPostChecklist,
    eventPostDate,
    eventPostRecords,
    eventPostRecordForm,
    eventPostFilter,
    setEventPostChecklist,
    setEventPostDate,
    setEventPostRecordForm,
    setEventPostFilter,
    toggleEventPostChecklist,
    saveEventPostRecord,
    deleteEventPostRecord,
    exportEventPostRecordsCsv,
    exportReelBackupJson,
    handleImportReelBackupJson,
    eventPostChecklistCount,
    isEventPostChecklistComplete,
    eventPostReport,
    eventDashboardStats,
    filteredEventPostRecords,
    isEventPostFilterActive,
    backupImportMessage,
    backupImportError,
  } = eventPosting

  const handleReuseHistory = useCallback((h: AIGenerationHistory) => {
    setAiTheme(h.theme)
    setSelectedPresetKey(h.presetKey)
    setSnsCaption(h.snsCaption ?? null)
    setRenderVariantName(h.renderVariantName ?? "")
    if (h.templateId && templates.some((t) => t.id === h.templateId)) {
      confirmLoadTemplate(h.templateId)
    }
  }, [templates, confirmLoadTemplate])

  // Phase23-U: Variant state / callbacks を useVariantManager に分離
  const variantManager = useVariantManager({
    aiTheme,
    slides,
    setSlides,
    addVariantNameToQueue,
    addVariantNamesToQueue,
  })
  const {
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
    setGeneratedVariants,
    setVariantScores,
    generatedVariantsRef,
    variantScoresRef,
  } = variantManager

  const compareDashboard = useCompareDashboard({
    renderQueue,
    generatedVariants,
    variantScores,
    variantLearningEvents,
    aiTheme,
    slides,
    recordLearningEvent,
  })
  const { ensureSnapshotExpanded } = compareDashboard

  const updateQueueItem = updateQueueItemFromHook

  const renderRunner = useRenderQueueRunner({
    renderQueue,
    slideCount,
    hasUnsavedChanges,
    updateQueueItem,
    saveToServer,
    saveSnapshotToServer,
    updateLatestHistory,
    fetchHistory,
  })
  const {
    batchRender,
    startRender,
    isBatchRendering,
    isPreparingRender,
    renderVariantName,
    setRenderVariantName,
    renderError,
    renderStatus,
    elapsedSec,
    latestDownloadUrl,
  } = renderRunner

  const addToQueue = useCallback(() => {
    addVariantNameToQueue(renderVariantName.trim() || 'Default')
  }, [renderVariantName, addVariantNameToQueue])

  // Keep ref updated so pipelines always read the latest state
  batchRenderRef.current = batchRender

  useInitialReelLoader({
    setSlides,
    setCtaConfig,
    setTitle,
    setSelectedId,
    setLoading,
    loadHistory: fetchHistory,
    loadTemplates: fetchTemplates,
    loadGeneratedImages: fetchGeneratedAssets,
    fetchReelAiConfig,
  })

  const usedGeneratedImages = new Set(
    slides.map((s) => s.image).filter((img): img is string => !!img?.startsWith('generated/'))
  )

  // Phase19-P: タブ表示ヘルパー（simpleMode step3以外は常時表示）
  // Phase21-C: 完成後 + 詳細非表示時はすべてのタブコンテンツを隠す
  const showInTab = (tab: 'create' | 'edit' | 'post' | 'manage') =>
    showInSimpleTab(tab, renderStatus === 'completed')

  // Phase19-P: 動画生成完了 → 作成タブへ自動遷移
  // Phase21-C: 完成時に詳細機能を隠してファースト画面へリセット
  useEffect(() => {
    if (renderStatus === 'completed' && simpleMode && simpleStep === 3) {
      resetCompletedView()
    }
  }, [renderStatus, resetCompletedView, simpleMode, simpleStep])

  // Phase23-Q: 画像生成 state / callbacks を分離
  const {
    imageGeneratingId,
    imageGenerateErrors,
    bulkImageGenerating,
    bulkImageProgress,
    bulkImageMessage,
    bulkImageSubMessage,
    failedImageIds,
    reuseImageMode,
    setReuseImageMode,
    cachedImagesForTemplate,
    setCachedImagesForTemplate,
    cachedImagesForTemplateSavedAt,
    setCachedImagesForTemplateSavedAt,
    effectiveQuality,
    handleGenerateImage,
    handleGenerateAllImages,
    handleRetryFailedImages,
    handleDeleteImageCache,
  } = useImageGenerator({
    slides,
    simpleTemplateType,
    costMode,
    imageQualityMode,
    updateSlide,
    setSlides,
    updateLatestHistory,
    setQuotaError,
  })

  const handleImageCreationModeChange = useCallback((mode: 'save' | 'reuse' | 'full' | 'upload') => {
    setImageCreationMode(mode)
    if (mode === 'save') {
      setImageSourceMode('ai')
      setReuseImageMode(false)
      setCostMode('save')
    } else if (mode === 'reuse') {
      setImageSourceMode('ai')
      setReuseImageMode(true)
    } else if (mode === 'full') {
      setImageSourceMode('ai')
      setReuseImageMode(false)
      setCostMode('normal')
    } else {
      setImageSourceMode('upload')
      setReuseImageMode(false)
    }
  }, [setImageSourceMode, setReuseImageMode, setCostMode])

  const handleToggleTestMode = useCallback(() => {
    setTestMode((prev) => {
      const next = !prev
      localStorage.setItem('bemystyle-reel-test-mode', next ? 'true' : 'false')
      return next
    })
  }, [])

  // Phase23-S: Factory / Auto Pipeline state & callbacks
  const factoryPipeline = useFactoryPipeline({
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
  })
  const {
    isAutoPipelineRunning,
    pipelineStatus,
    lastPipeline,
    handleAutoRenderPipeline,
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
    handleRunReelFactory,
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
  } = factoryPipeline

  // Phase23-W: Smart Pipeline 3本を usePipelineRunner に分離
  const pipelineRunner = usePipelineRunner({
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
  })
  const {
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
  } = pipelineRunner

  // Phase19-E: 世界観タグ トグル
  const toggleVisualStyleTag = useCallback((tag: string) => {
    setVisualStyleTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  // Phase19-S: テンプレートタイプ選択ハンドラー
  const handleSimpleTemplateTypeSelect = useCallback((type: SimpleTemplateType) => {
    selectSimpleTemplateType(type)
    if (type !== 'mmm-event') {
      setSelectedTemplateId('')
    }

    if (type === 'custom') return

    // Phase29-D: 非customテンプレートはuploadを基本にする
    handleImageCreationModeChange('upload')

    const defaults = SIMPLE_TEMPLATE_DEFAULTS[type]

    if (defaults.visualStyleTags.length > 0) {
      setVisualStyleTags(defaults.visualStyleTags)
    }

    if (defaults.bgmFileName) {
      setBgmFileName(defaults.bgmFileName)
      setBgmUploadError('')
    }

    if (defaults.ctaLabel) {
      setRecommendedCtaLabel(defaults.ctaLabel)
      setSlides((prev) =>
        prev.map((slide) =>
          slide.layout === 'cta' ? { ...slide, ctaLabel: defaults.ctaLabel } : slide
        )
      )
      setHasUnsavedChanges(true)
    }
  }, [handleImageCreationModeChange])

  // Phase19-S: テンプレート別テーマ自動生成
  const buildSimpleThemeFromTemplate = useCallback((): string => {
    switch (simpleTemplateType) {
      case 'mmm-event':
        return buildMmmTheme(mmmEventForm)
      case 'free-diagnosis': {
        const parts: string[] = []
        if (freeDiagnosisForm.campaignName) parts.push(`無料歌唱診断キャンペーン「${freeDiagnosisForm.campaignName}」`)
        if (freeDiagnosisForm.targetAudience) parts.push(`対象：${freeDiagnosisForm.targetAudience}`)
        if (freeDiagnosisForm.diagnosisMethod) parts.push(`診断方法：${freeDiagnosisForm.diagnosisMethod}`)
        if (freeDiagnosisForm.lineUrl) parts.push(`申し込み：${freeDiagnosisForm.lineUrl}`)
        if (freeDiagnosisForm.message) parts.push(freeDiagnosisForm.message)
        return `${parts.join('。')}。申し込みを増やすためのSNSショート動画にしてください。`
      }
      case 'note-article': {
        const parts: string[] = [`記事「${noteArticleForm.articleTitle}」`]
        if (noteArticleForm.articleTheme) parts.push(`テーマ：${noteArticleForm.articleTheme}`)
        if (noteArticleForm.targetReader) parts.push(`読者：${noteArticleForm.targetReader}`)
        if (noteArticleForm.articleUrl) parts.push(`URL：${noteArticleForm.articleUrl}`)
        if (noteArticleForm.message) parts.push(noteArticleForm.message)
        return `${parts.join('。')}。記事への流入を増やすSNSショート動画にしてください。`
      }
      case 'youtube-video': {
        const parts: string[] = [`YouTube動画「${youtubeVideoForm.videoTitle}」`]
        if (youtubeVideoForm.videoTheme) parts.push(`テーマ：${youtubeVideoForm.videoTheme}`)
        if (youtubeVideoForm.highlights) parts.push(`見どころ：${youtubeVideoForm.highlights}`)
        if (youtubeVideoForm.youtubeUrl) parts.push(`URL：${youtubeVideoForm.youtubeUrl}`)
        if (youtubeVideoForm.message) parts.push(youtubeVideoForm.message)
        return `${parts.join('。')}。チャンネル登録を促すSNSショート動画にしてください。`
      }
      case 'music-community': {
        const parts: string[] = [`音楽コミュニティ「${musicCommunityForm.communityName}」`]
        if (musicCommunityForm.activities) parts.push(`活動内容：${musicCommunityForm.activities}`)
        if (musicCommunityForm.targetAudience) parts.push(`対象：${musicCommunityForm.targetAudience}`)
        if (musicCommunityForm.joinUrl) parts.push(`参加：${musicCommunityForm.joinUrl}`)
        if (musicCommunityForm.message) parts.push(musicCommunityForm.message)
        return `${parts.join('。')}。参加者募集のSNSショート動画にしてください。`
      }
      default:
        return aiTheme
    }
  }, [simpleTemplateType, mmmEventForm, freeDiagnosisForm, noteArticleForm, youtubeVideoForm, musicCommunityForm, aiTheme])

  const downloadVideo = useCallback(() => {
    window.location.href = latestDownloadUrl ?? '/api/render/download'
    if (simpleTemplateId === 'mmm-event') {
      setEventPostChecklist((prev) => ({ ...prev, downloaded: true }))
    }
  }, [latestDownloadUrl, simpleTemplateId])

  const MAX_VIDEO_RETRY = 5
  const VIDEO_RETRY_INTERVAL_MS = 3000

  const checkVideoReady = useCallback((viewUrl: string) => {
    if (videoPreviewRetryTimer.current) clearTimeout(videoPreviewRetryTimer.current)
    videoPreviewRetryCount.current = 0
    setVideoPreviewLoading(true)
    setVideoPreviewError('')

    const attempt = () => {
      fetch(viewUrl, { method: 'HEAD' })
        .then((res) => {
          if (res.ok) {
            setVideoPreviewLoading(false)
          } else {
            retry()
          }
        })
        .catch(() => retry())
    }

    const retry = () => {
      videoPreviewRetryCount.current += 1
      if (videoPreviewRetryCount.current >= MAX_VIDEO_RETRY) {
        setVideoPreviewLoading(false)
        setVideoPreviewError('プレビューの準備に時間がかかっています。再取得ボタンをお試しください。')
        return
      }
      videoPreviewRetryTimer.current = setTimeout(attempt, VIDEO_RETRY_INTERVAL_MS)
    }

    attempt()
  }, [])

  useEffect(() => {
    if (!latestDownloadUrl) return
    const viewUrl = latestDownloadUrl.replace('/api/render/download/', '/api/render/view/')
    checkVideoReady(viewUrl)
    return () => {
      if (videoPreviewRetryTimer.current) clearTimeout(videoPreviewRetryTimer.current)
    }
  }, [latestDownloadUrl, checkVideoReady])

  const latestViewUrl = latestDownloadUrl
    ? latestDownloadUrl.replace('/api/render/download/', '/api/render/view/')
    : '/api/render/view'
  const renderPreviewUrl = latestDownloadUrl
    ? latestDownloadUrl.replace('/api/render/download/', '/api/render/view/')
    : ''

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

  const simpleTemplateDerived = useMemo(() => {
    const selectedSimpleTemplateDefaults =
      !simpleTemplateType || simpleTemplateType === 'custom'
        ? null
        : SIMPLE_TEMPLATE_DEFAULTS[simpleTemplateType]

    // Phase19-S: 未入力チェック
    const missingTemplateInputs: string[] = (() => {
      switch (simpleTemplateType) {
      case 'mmm-event':
        return [
          !mmmEventForm.title.trim() && 'イベント名を入力してください',
          !mmmEventForm.date.trim() && '開催日を入力してください',
          !mmmEventForm.venue.trim() && '会場を入力してください',
        ].filter(Boolean) as string[]
      case 'free-diagnosis':
        return [!freeDiagnosisForm.campaignName.trim() && 'キャンペーン名を入力してください'].filter(Boolean) as string[]
      case 'note-article':
        return [
          !noteArticleForm.articleTitle.trim() && '記事タイトルを入力してください',
          !noteArticleForm.articleTheme.trim() && '記事テーマを入力してください',
        ].filter(Boolean) as string[]
      case 'youtube-video':
        return [!youtubeVideoForm.videoTitle.trim() && '動画タイトルを入力してください'].filter(Boolean) as string[]
      case 'music-community':
        return [!musicCommunityForm.communityName.trim() && 'コミュニティ名を入力してください'].filter(Boolean) as string[]
      case 'custom':
        return !aiTheme.trim() ? ['テーマを入力してください'] : []
      default:
        return ['テンプレートを選んでください']
      }
    })()
    return { selectedSimpleTemplateDefaults, missingTemplateInputs }
  }, [simpleTemplateType, mmmEventForm, freeDiagnosisForm, noteArticleForm, youtubeVideoForm, musicCommunityForm, aiTheme])
  const { selectedSimpleTemplateDefaults, missingTemplateInputs } = simpleTemplateDerived

  const renderUI = useRenderUI({
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
  })
  const {
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
    isRendering,
  } = renderUI
  const { completedVariants } = renderUI.renderQueueDerived

  const panelProps = usePanelPropsBuilder({
    slides,
    simpleMode,
    aiTheme,
    reelAiConfig,
    reuseImageMode,
    quotaError,
    renderQueue,
    renderUI,
    renderRunner,
    factoryPipeline,
    compareDashboard,
    storyGenerator,
    renderQueueActions: { removeFromQueue, clearQueue },
    handlers: {
      setQuotaError,
      renderDiffPanel,
    },
  })

  const postEditPanel = (
    <PostEditPanel
      slides={{
        items: slides,
        imageReplacingId: slideImageReplacing,
        imageReplaceErrors: slideImageReplaceError,
        onChangeText: handleSlideTextChange,
        onReplaceImage: handleSlideImageReplace,
      }}
      media={{
        bgmUploading,
        bgmFileName,
        bgmUploadError,
        qrUploading,
        qrFileName,
        qrUploadError,
        onBgmUpload: handleBgmUpload,
        onQrUpload: handleQrUpload,
      }}
      render={{
        isRendering,
        isPreparingRender,
        onRerenderAfterEdit: async () => {
          closeSlideEditor()
          await saveToServer()
          startRender()
        },
      }}
      actions={{
        isOpen: slideEditorOpen,
        onToggleOpen: () => setSlideEditorOpen((v) => !v),
      }}
    />
  )

  const visualStyleTagsPanel = (
    <div className="visual-style-tags">
      <p className="visual-style-tags-label">動画の雰囲気</p>
      <p className="visual-style-tags-hint">迷ったら変更しなくてOKです。動画の印象を少し寄せたい時だけ選びます。</p>
      <div className="visual-style-tags-chips">
        {VISUAL_STYLE_TAG_OPTIONS.map((tag) => (
          <button
            key={tag}
            className={`visual-style-tag-chip${visualStyleTags.includes(tag) ? ' visual-style-tag-chip--active' : ''}`}
            onClick={() => toggleVisualStyleTag(tag)}
            type="button"
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  )

  const editPresetPanel = (
    <div className="edit-preset-panel">
      <div className="edit-preset-apply">
        <p className="edit-preset-section-title">保存した設定</p>
        <div className="edit-preset-apply-row">
          <select
            className="edit-preset-select"
            value={selectedEditPresetId}
            onChange={(e) => setSelectedEditPresetId(e.target.value)}
          >
            <option value="">プリセットを選択...</option>
            {editPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            className="btn-edit-preset-apply"
            onClick={() => applyEditPreset(selectedEditPresetId)}
            disabled={!selectedEditPresetId}
            type="button"
          >
            適用
          </button>
          <button
            className="btn-edit-preset-delete"
            onClick={() => deleteEditPreset(selectedEditPresetId)}
            disabled={!selectedEditPresetId || isDefaultEditPreset(selectedEditPresetId)}
            type="button"
          >
            削除
          </button>
        </div>
        {selectedEditPresetId && (() => {
          const p = editPresets.find((ep) => ep.id === selectedEditPresetId)
          return p ? (
            <p className="edit-preset-preview">
              雰囲気：{p.visualStyleTags.join(' / ')}
              {p.bgmFileName ? ` ／ BGM：${p.bgmFileName}` : ''}
              {p.ctaLabel ? ` ／ CTA：${p.ctaLabel}` : ''}
            </p>
          ) : null
        })()}
      </div>
      <div className="edit-preset-save">
        <p className="edit-preset-section-title">よく使う設定として保存</p>
        <div className="edit-preset-save-row">
          <input
            className="edit-preset-name-input"
            type="text"
            placeholder="プリセット名"
            value={editPresetName}
            onChange={(e) => setEditPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveEditPreset() }}
          />
          <button
            className="btn-edit-preset-save"
            onClick={saveEditPreset}
            disabled={!editPresetName.trim()}
            type="button"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )

  // ローカルAIテロップ動画モード（追加機能）。既存の読み込み状態より優先して表示する。
  if (isLocalCaptionVideoModeRequested()) {
    return <LocalCaptionVideoMode />
  }

  if (isScriptModeRequested() && !scriptModeLeft) {
    return (
      <ScriptMode
        onClose={() => { window.location.assign(window.location.pathname) }}
        onCreateVideo={(handoff) => {
          setScriptHandoff(handoff)
          setScriptModeLeft(true)
          // 台本本文はURLへ入れない。?mode=script だけを外して通常のWizardのURLにする
          window.history.replaceState(null, '', window.location.pathname)
        }}
      />
    )
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-dot" />
        読み込み中...
      </div>
    )
  }

  // Phase-W: USE_WIZARD_MODE = false に変更すると既存UIに戻る
  if (USE_WIZARD_MODE) {
    return <WizardMode initialScript={scriptHandoff} onInitialScriptConsumed={() => setScriptHandoff(null)} />
  }

  return (
    <div className={`app${simpleMode ? ' app--simple' : ''}`}>
      {/* ── 本番安全警告バナー ── */}
      <ReelHeaderPanel section="safety-banner" reelAiConfig={reelAiConfig} />
      <TemplateModals
        templateConfirmPending={templateConfirmPending}
        saveTemplateModal={saveTemplateModal}
        saveTemplateName={saveTemplateName}
        saveTemplateCategory={saveTemplateCategory}
        saveTemplateDescription={saveTemplateDescription}
        saveTemplateStatus={saveTemplateStatus}
        categories={CATEGORIES}
        onCancelLoadTemplate={cancelLoadTemplate}
        onLoadTemplate={loadTemplate}
        onCancelSaveTemplateModal={cancelSaveTemplateModal}
        onSaveTemplate={saveAsTemplate}
        onChangeSaveTemplateName={setSaveTemplateName}
        onChangeSaveTemplateCategory={setSaveTemplateCategory}
        onChangeSaveTemplateDescription={setSaveTemplateDescription}
      />

      {/* ── 左パネル: スライド一覧 ── */}
      <div className="panel panel-left">
        <ReelHeaderPanel
          section="panel-header"
          simpleMode={simpleMode}
          simpleStep={simpleStep}
          hasUnsavedChanges={hasUnsavedChanges}
          saveStatus={saveStatus}
          isRendering={isRendering}
          slideCount={slideCount}
          onNewProject={handleNewProject}
          onSimpleNewProject={() => { goToSimpleStep(1); setAiTheme(''); clearFactoryMessages(); resetPostChecklist(); resetPostedRecords() }}
          onSave={saveToServer}
        />

        <div className="panel-left-body">

        {/* ── モード切替 (Phase17-G / Phase18-D) ── */}
        <ReelHeaderPanel
          section="mode-toggle"
          simpleMode={simpleMode}
          onStartSimpleMode={startSimpleMode}
          onExitSimpleMode={exitSimpleMode}
        />

        {!simpleMode && (<>
        {/* テンプレートセクション */}
        <div className="template-section">
          <TemplateGalleryPanel
            gallery={{ templates, selectedTemplateId, isRendering, recentTemplateIds, usageMap }}
            actions={{ confirmLoadTemplate, duplicateTemplate, toggleFavorite, deleteTemplate, renameTemplate }}
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
            <CustomPresetPanel
              aiPresets={AI_PRESETS}
              selectedPresetKey={selectedPresetKey}
              onSelectPresetKey={setSelectedPresetKey}
              isGenerating={isGenerating}
              isRendering={isRendering}
              autoApplyRecommendedTemplate={autoApplyRecommendedTemplate}
              onChangeAutoApplyRecommendedTemplate={setAutoApplyRecommendedTemplate}
              autoApplyTemplateNotice={autoApplyTemplateNotice}
              templates={templates}
              usageMap={usageMap}
              onConfirmLoadTemplate={confirmLoadTemplate}
              customPresets={customPresets}
              customPresetForm={customPresetForm}
              onChangeCustomPresetForm={setCustomPresetForm}
              selectedCustomPresetId={selectedCustomPresetId}
              presetImportNotice={presetImportNotice}
              presetImportRef={presetImportRef}
              editingCustomPresetId={editingCustomPresetId}
              onChangeEditingCustomPresetId={setEditingCustomPresetId}
              editingCustomPresetForm={editingCustomPresetForm}
              onChangeEditingCustomPresetForm={setEditingCustomPresetForm}
              presetInsight={presetInsight}
              isGeneratingPresetInsight={isGeneratingPresetInsight}
              presetInsightError={presetInsightError}
              createdInsightIndices={createdInsightIndices}
              isAnalyticsExpanded={isAnalyticsExpanded}
              onToggleAnalyticsExpanded={() => setIsAnalyticsExpanded((v) => !v)}
              onSaveCustomPreset={handleSaveCustomPreset}
              onDeleteCustomPreset={handleDeleteCustomPreset}
              onUseCustomPreset={handleUseCustomPreset}
              onExportCustomPresets={handleExportCustomPresets}
              onImportCustomPresets={handleImportCustomPresets}
              onSaveEditCustomPreset={handleSaveEditCustomPreset}
              onDuplicateCustomPreset={handleDuplicateCustomPreset}
              onClearCustomPresets={handleClearCustomPresets}
              onExportAnalyticsCsv={handleExportAnalyticsCsv}
              onGeneratePresetInsight={handleGeneratePresetInsight}
              onSaveInsightPreset={handleSaveInsightPreset}
              onToggleFavoriteCustomPreset={handleToggleFavoriteCustomPreset}
              onMoveCustomPreset={handleMoveCustomPreset}
            />
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
                disabled={bulkImageGenerating}
              >
                {bulkImageGenerating
                  ? `画像生成中：${bulkImageProgress.current} / ${bulkImageProgress.total}枚 完了`
                  : '14枚AI画像生成'}
              </button>
              {bulkImageGenerating && bulkImageSubMessage && (
                <p className="bulk-image-sub-message">{bulkImageSubMessage}</p>
              )}
              {bulkImageMessage && (
                <p className={`bulk-image-message${bulkImageMessage.includes('失敗') ? ' bulk-image-message--error' : ' bulk-image-message--ok'}`}>
                  {bulkImageMessage}
                </p>
              )}
              {failedImageIds.length > 0 && !bulkImageGenerating && !quotaError && (
                <button
                  className="bulk-image-retry-btn"
                  onClick={handleRetryFailedImages}
                >
                  失敗画像を再生成（{failedImageIds.length}枚）
                </button>
              )}
            </div>
          )}


          {/* AI生成履歴 (Phase12-N) */}
          <AiGenerationHistoryPanel
            aiGenerationHistory={aiGenerationHistory}
            aiPresets={AI_PRESETS}
            importNotice={importNotice}
            importInputRef={importInputRef}
            isGenerating={isGenerating}
            formatHistoryDate={formatHistoryDate}
            onExportAIGenerationHistory={exportAIGenerationHistory}
            onImportAIGenerationHistory={handleImport}
            onClearAIGenerationHistory={clearAIGenerationHistory}
            onReuseHistory={handleReuseHistory}
            onDeleteAIGenerationHistoryItem={deleteAIGenerationHistoryItem}
          />

          {/* 生成済み素材 (Phase12-G) */}
          <AssetsPanel
            assets={generatedAssets}
            assetsLoading={assetsLoading}
            assetsMessage={assetsMessage}
            usedGeneratedImages={usedGeneratedImages}
            onRefreshAssets={fetchGeneratedAssets}
            onDeleteAsset={deleteGeneratedAsset}
            onDeleteUnusedAssets={deleteUnusedAssets}
          />
        </div>
        </>)}

        {!simpleMode && (
        <SlideList
          slides={slides}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleVisible={toggleVisible}
          onMove={moveSlide}
          disabled={isRendering}
        />
        )}
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

          <div className={`render-area${simpleMode && simpleStep === 3 ? ' render-area--step3' : ''}`}>
            {/* Phase18-B: かんたんモード 3ステップウィザード */}
            {simpleMode && (
              <div className="simple-wizard">
                <div className="simple-step-indicator">
                  {([1, 2, 3] as const).map((n) => (
                    <span
                      key={n}
                      className={`simple-step-pill${simpleStep === n ? ' active' : simpleStep > n ? ' done' : ''}`}
                    >
                      {n === 1 ? 'テーマ' : n === 2 ? '確認' : '作成'}
                    </span>
                  ))}
                </div>

                {simpleStep === 1 && !massMode.isMassMode && (
                  <div className="simple-step-card">
                    <div className="simple-step-guide">
                      <p className="simple-step-guide-title">Step1：テンプレートを選んで必須項目を入力してください</p>
                    </div>
                    {/* Phase19-S: テンプレートタイプ選択カード */}
                    <SimpleTemplateSelector
                      selected={simpleTemplateType}
                      onSelect={handleSimpleTemplateTypeSelect}
                    />

                    {!simpleTemplateType && (
                      <p className="simple-type-hint">上から動画の種類を選んでください</p>
                    )}

                    {selectedSimpleTemplateDefaults && (
                      <div className="simple-template-default-notice">
                        <p className="simple-template-default-title">おすすめ設定を自動セットしました</p>
                        <div className="simple-template-default-list">
                          <p>世界観：{selectedSimpleTemplateDefaults.visualStyleTags.join(' / ')}</p>
                          <p>BGM：{selectedSimpleTemplateDefaults.bgmFileName}</p>
                          <p>CTA：{selectedSimpleTemplateDefaults.ctaLabel}</p>
                        </div>
                        <p className="simple-template-default-note">あとから編集タブで変更できます。</p>
                      </div>
                    )}

                    {simpleTemplateType === 'mmm-event' ? (
                      /* ── Phase19-D: MMMイベント告知専用フォーム (Phase30-B: 必須3項目優先表示) ── */
                      <div className="mmm-event-form">
                        {/* 必須フィールドのみ先頭表示 */}
                        <div className="mmm-event-form-grid">
                          <label className="mmm-field">
                            <span className="mmm-field-label">イベント名 <span className="mmm-required">必須</span></span>
                            <input
                              className="mmm-field-input"
                              type="text"
                              placeholder="例：MMM大演奏会"
                              value={mmmEventForm.title}
                              onChange={(e) => setMmmEventForm((prev) => ({ ...prev, title: e.target.value }))}
                            />
                          </label>
                          <label className="mmm-field">
                            <span className="mmm-field-label">開催日 <span className="mmm-required">必須</span></span>
                            <input
                              className="mmm-field-input"
                              type="text"
                              placeholder="例：6/27（土）"
                              value={mmmEventForm.date}
                              onChange={(e) => setMmmEventForm((prev) => ({ ...prev, date: e.target.value }))}
                            />
                          </label>
                          <label className="mmm-field">
                            <span className="mmm-field-label">会場 <span className="mmm-required">必須</span></span>
                            <input
                              className="mmm-field-input"
                              type="text"
                              placeholder="例：レンタルスペース Rhythm Neko"
                              value={mmmEventForm.venue}
                              onChange={(e) => setMmmEventForm((prev) => ({ ...prev, venue: e.target.value }))}
                            />
                          </label>
                        </div>
                        {mmmError && <p className="mmm-error">{mmmError}</p>}
                        <button
                          className="btn-simple-next"
                          onClick={() => {
                            setMmmError('')
                            if (!mmmEventForm.title.trim() || !mmmEventForm.date.trim() || !mmmEventForm.venue.trim()) {
                              setMmmError('イベント名・開催日・会場を入力してください。')
                              return
                            }
                            setAiTheme(buildMmmTheme(mmmEventForm))
                            goToSimpleStep(2)
                          }}
                        >
                          Storyを作る
                        </button>
                        {/* 詳細・任意項目（折りたたみ） */}
                        <div className="mmm-details-toggle-wrapper">
                          <button
                            className="mmm-details-toggle"
                            onClick={() => setIsMmmDetailsOpen((v) => !v)}
                            type="button"
                          >
                            {isMmmDetailsOpen ? '▼ 詳細を閉じる' : '▶ 詳細を追加（時間・参加費・URL・保存済みプリセット）'}
                          </button>
                          {isMmmDetailsOpen && (
                            <div className="mmm-details-body">
                              {/* Phase19-H: イベント情報プリセット 呼び出しUI */}
                              <div className="mmm-event-preset-panel">
                                <p className="mmm-event-preset-title">保存したイベント情報</p>
                                <div className="mmm-event-preset-row">
                                  <select
                                    className="mmm-event-preset-select"
                                    value={selectedMmmEventPresetId}
                                    onChange={(e) => setSelectedMmmEventPresetId(e.target.value)}
                                  >
                                    <option value="">プリセットを選択...</option>
                                    {mmmEventPresets.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    className="btn-mmm-event-preset-apply"
                                    onClick={() => applyMmmEventPreset(selectedMmmEventPresetId)}
                                    disabled={!selectedMmmEventPresetId}
                                    type="button"
                                  >
                                    呼び出す
                                  </button>
                                  <button
                                    className="btn-mmm-event-preset-delete"
                                    onClick={() => deleteMmmEventPreset(selectedMmmEventPresetId)}
                                    disabled={!selectedMmmEventPresetId || isDefaultMmmEventPreset(selectedMmmEventPresetId)}
                                    type="button"
                                  >
                                    削除
                                  </button>
                                </div>
                                {mmmEventPresetNotice && (
                                  <p className="mmm-event-preset-notice">{mmmEventPresetNotice}</p>
                                )}
                              </div>
                              {/* 任意フィールド */}
                              <div className="mmm-event-form-grid">
                                <label className="mmm-field mmm-field--half">
                                  <span className="mmm-field-label">開始時間</span>
                                  <input
                                    className="mmm-field-input"
                                    type="text"
                                    placeholder="例：17:30"
                                    value={mmmEventForm.startTime}
                                    onChange={(e) => setMmmEventForm((prev) => ({ ...prev, startTime: e.target.value }))}
                                  />
                                </label>
                                <label className="mmm-field mmm-field--half">
                                  <span className="mmm-field-label">終了時間</span>
                                  <input
                                    className="mmm-field-input"
                                    type="text"
                                    placeholder="例：22:30"
                                    value={mmmEventForm.endTime}
                                    onChange={(e) => setMmmEventForm((prev) => ({ ...prev, endTime: e.target.value }))}
                                  />
                                </label>
                                <label className="mmm-field">
                                  <span className="mmm-field-label">参加費</span>
                                  <input
                                    className="mmm-field-input"
                                    type="text"
                                    placeholder="例：演奏3,500円・聴くだけ1,000円"
                                    value={mmmEventForm.price}
                                    onChange={(e) => setMmmEventForm((prev) => ({ ...prev, price: e.target.value }))}
                                  />
                                </label>
                                <label className="mmm-field">
                                  <span className="mmm-field-label">イベントURL（CTA用）</span>
                                  <input
                                    className="mmm-field-input"
                                    type="url"
                                    placeholder="例：https://..."
                                    value={mmmEventForm.url}
                                    onChange={(e) => setMmmEventForm((prev) => ({ ...prev, url: e.target.value }))}
                                  />
                                </label>
                                <label className="mmm-field">
                                  <span className="mmm-field-label">一言メッセージ（任意）</span>
                                  <input
                                    className="mmm-field-input"
                                    type="text"
                                    placeholder="例：飲食OK。音楽仲間を作りたい方大歓迎。"
                                    value={mmmEventForm.message}
                                    onChange={(e) => setMmmEventForm((prev) => ({ ...prev, message: e.target.value }))}
                                  />
                                </label>
                              </div>
                              {/* Phase19-H: イベント情報プリセット 保存UI */}
                              <div className="mmm-event-preset-save">
                                <p className="mmm-event-preset-title">イベント情報を保存</p>
                                <div className="mmm-event-preset-save-row">
                                  <input
                                    className="mmm-event-preset-name-input"
                                    type="text"
                                    placeholder="プリセット名（例：春の演奏会）"
                                    value={mmmEventPresetName}
                                    onChange={(e) => setMmmEventPresetName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') saveMmmEventPreset() }}
                                  />
                                  <button
                                    className="btn-mmm-event-preset-save"
                                    onClick={saveMmmEventPreset}
                                    type="button"
                                  >
                                    保存
                                  </button>
                                </div>
                              </div>
                              <div className="mmm-hints">
                                <span className="mmm-hint-chip">初心者歓迎</span>
                                <span className="mmm-hint-chip">見学だけでもOK</span>
                                <span className="mmm-hint-chip">演奏参加・聴くだけ参加OK</span>
                                <span className="mmm-hint-chip">音楽仲間を作りたい方に</span>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Phase29-D: 画像アップロード（ボタン後に配置） */}
                        <div className="simple-upload-section">
                          <p className="simple-upload-label">画像をアップロード（任意・最大14枚）</p>
                          <p className="simple-upload-hint">14枚あると全スライドを自分の画像で作れます。足りない分は補完されます。</p>
                          <UserImageUploadPanel
                            userUploadedImages={userUploadedImages}
                            onUpload={handleUserImageUpload}
                            onDropFiles={handleUserImageDropFiles}
                            onRemove={removeUserUploadedImage}
                            onReorder={reorderUserUploadedImage}
                          />
                        </div>
                      </div>
                    ) : simpleTemplateType && simpleTemplateType !== 'custom' ? (
                      /* Phase19-S: テンプレート別フォーム */
                      <>
                        <SimpleTemplateForms
                          templateType={simpleTemplateType}
                          freeDiagnosisForm={freeDiagnosisForm}
                          setFreeDiagnosisForm={setFreeDiagnosisForm}
                          noteArticleForm={noteArticleForm}
                          setNoteArticleForm={setNoteArticleForm}
                          youtubeVideoForm={youtubeVideoForm}
                          setYoutubeVideoForm={setYoutubeVideoForm}
                          musicCommunityForm={musicCommunityForm}
                          setMusicCommunityForm={setMusicCommunityForm}
                        />
                        {missingTemplateInputs.length > 0 && (
                          <div className="simple-missing-guide">
                            <p className="simple-missing-guide-title">あと少しです：</p>
                            <ul className="simple-missing-guide-list">
                              {missingTemplateInputs.map((m) => <li key={m}>・{m}</li>)}
                            </ul>
                          </div>
                        )}
                        <button
                          className="btn-simple-next"
                          disabled={missingTemplateInputs.length > 0}
                          onClick={() => {
                            const theme = buildSimpleThemeFromTemplate()
                            setAiTheme(theme)
                            goToSimpleStep(2)
                          }}
                        >
                          Storyを作る
                        </button>
                        {/* Phase29-D: 画像アップロード（Phase30-B: ボタン後に移動） */}
                        <div className="simple-upload-section">
                          <p className="simple-upload-label">画像をアップロード（任意・最大14枚）</p>
                          <p className="simple-upload-hint">14枚あると全スライドを自分の画像で作れます。足りない分は補完されます。</p>
                          <UserImageUploadPanel
                            userUploadedImages={userUploadedImages}
                            onUpload={handleUserImageUpload}
                            onDropFiles={handleUserImageDropFiles}
                            onRemove={removeUserUploadedImage}
                            onReorder={reorderUserUploadedImage}
                          />
                        </div>
                      </>
                    ) : simpleTemplateType === 'custom' ? (
                      /* 自由入力：既存テーマ入力フロー */
                      <>
                        <input
                          className="ai-generator-input simple-step-input"
                          type="text"
                          placeholder="例：6月のMMMセッション会を紹介 / Note記事の見どころを紹介"
                          value={aiTheme}
                          onChange={(e) => setAiTheme(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && aiTheme.trim()) goToSimpleStep(2) }}
                        />
                        <p className="simple-custom-input-hint">
                          自由入力では「誰に向けて、何を伝えたいか」を1文で入れると作りやすくなります。
                        </p>
                        {/* Phase18-F: テーマサジェスト */}
                        <div className="simple-suggestions">
                          <p className="simple-suggestion-title">おすすめテーマ</p>
                          <div className="simple-suggestion-chips">
                            {SIMPLE_THEME_SUGGESTIONS.map((suggestion) => (
                              <button
                                key={suggestion}
                                className={`simple-suggestion-chip${aiTheme === suggestion ? ' active' : ''}`}
                                onClick={() => setAiTheme(suggestion)}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                        {missingTemplateInputs.length > 0 && (
                          <div className="simple-missing-guide">
                            <p className="simple-missing-guide-title">あと少しです：</p>
                            <ul className="simple-missing-guide-list">
                              {missingTemplateInputs.map((m) => <li key={m}>・{m}</li>)}
                            </ul>
                          </div>
                        )}
                        <button
                          className="btn-simple-next"
                          onClick={() => goToSimpleStep(2)}
                          disabled={!aiTheme.trim()}
                        >
                          Storyを作る
                        </button>
                        {/* Phase29-D: 画像の作り方を選ぶ（Phase30-B: ボタン後に移動） */}
                        <div className="image-creation-selector">
                          <p className="image-creation-label">画像の作り方を選ぶ</p>
                          <p className="image-creation-group-label">おすすめ：自分の画像を使う</p>
                          <label className={`image-creation-option${imageCreationMode === 'upload' ? ' image-creation-option--active' : ''}`}>
                            <input
                              type="radio"
                              name="imageCreationMode"
                              value="upload"
                              checked={imageCreationMode === 'upload'}
                              onChange={() => handleImageCreationModeChange('upload')}
                            />
                            <span className="image-creation-option-body">
                              <span className="image-creation-option-header">
                                <span className="image-creation-option-title">画像をアップロード</span>
                                <span className="image-creation-badge image-creation-badge--recommended">おすすめ</span>
                              </span>
                              <span className="image-creation-option-desc">自分で用意した画像を使います。ChatGPTなどで作った画像でもOK。AI画像生成コストは発生しません。最大14枚。</span>
                            </span>
                          </label>
                          {imageCreationMode === 'upload' && (
                            <UserImageUploadPanel
                              userUploadedImages={userUploadedImages}
                              onUpload={handleUserImageUpload}
                              onDropFiles={handleUserImageDropFiles}
                              onRemove={removeUserUploadedImage}
                              onReorder={reorderUserUploadedImage}
                            />
                          )}
                          {cachedImagesForTemplate.length > 0 && (
                            <label className={`image-creation-option${imageCreationMode === 'reuse' ? ' image-creation-option--active' : ''}`}>
                              <input
                                type="radio"
                                name="imageCreationMode"
                                value="reuse"
                                checked={imageCreationMode === 'reuse'}
                                onChange={() => handleImageCreationModeChange('reuse')}
                              />
                              <span className="image-creation-option-body">
                                <span className="image-creation-option-header">
                                  <span className="image-creation-option-title">前回のAI画像を再利用</span>
                                </span>
                                <span className="image-creation-option-desc">
                                  前回作ったAI画像を使って、すばやく安く動画を作ります。
                                </span>
                              </span>
                            </label>
                          )}
                          {imageCreationMode === 'reuse' && cachedImagesForTemplate.length > 0 && (
                            <div className="reuse-image-cache-info reuse-image-cache-info--inline">
                              <div className="reuse-image-cache-info-row">
                                <span className="reuse-image-cache-info-icon">📦</span>
                                <span className="reuse-image-cache-info-label">保存済み画像</span>
                                <span className="reuse-image-cache-info-value">{cachedImagesForTemplate.length}枚</span>
                              </div>
                              {cachedImagesForTemplateSavedAt && (
                                <div className="reuse-image-cache-info-row">
                                  <span className="reuse-image-cache-info-icon">🕐</span>
                                  <span className="reuse-image-cache-info-label">最終保存</span>
                                  <span className="reuse-image-cache-info-value">{formatCacheSavedAt(cachedImagesForTemplateSavedAt)}</span>
                                </div>
                              )}
                              <div className="reuse-image-cache-thumbs">
                                {cachedImagesForTemplate.slice(0, 5).map((img, i) => (
                                  <img key={i} className="reuse-image-cache-thumb" src={`/assets/${img}`} alt={`キャッシュ画像 ${i + 1}`} />
                                ))}
                                {cachedImagesForTemplate.length > 5 && (
                                  <span className="reuse-image-cache-thumb-more">+{cachedImagesForTemplate.length - 5}枚</span>
                                )}
                              </div>
                              <button className="btn-cache-delete" onClick={handleDeleteImageCache}>🗑 キャッシュを削除</button>
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}

                    {simpleTemplateType && (
                      <div className="simple-advanced-settings">
                        <button
                          className="simple-advanced-settings-toggle"
                          onClick={() => setIsSimpleAdvancedSettingsOpen((v) => !v)}
                          type="button"
                          aria-expanded={isSimpleAdvancedSettingsOpen}
                        >
                          {isSimpleAdvancedSettingsOpen ? '▼ 上級設定を閉じる' : '▶ 上級設定を表示'}
                        </button>
                        {isSimpleAdvancedSettingsOpen && (
                          <div className="simple-advanced-settings-body">
                            <div className="simple-advanced-settings-section">
                              <p className="simple-advanced-settings-title">世界観タグ</p>
                              {visualStyleTagsPanel}
                            </div>
                            <div className="simple-advanced-settings-section">
                              <p className="simple-advanced-settings-title">編集プリセット</p>
                              {editPresetPanel}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Phase29-B: テストモードトグル */}
                    <div className="test-mode-toggle">
                      <button
                        className={`btn-test-mode${testMode ? ' btn-test-mode--on' : ''}`}
                        onClick={handleToggleTestMode}
                        type="button"
                      >
                        🧪 テストモード：{testMode ? 'ON' : 'OFF'}
                      </button>
                      {testMode && (
                        <p className="test-mode-hint">
                          AI画像生成をスキップします（コストを消費しません）
                        </p>
                      )}
                    </div>

                    {/* Phase22-A: 量産モード入口 */}
                    <button
                      className="btn-enter-mass-mode"
                      onClick={massMode.enterMassMode}
                      type="button"
                    >
                      🏭 量産モード（複数テーマをまとめて入力）
                    </button>
                  </div>
                )}

                {/* Phase22-A/C: 量産モードパネル */}
                {simpleStep === 1 && massMode.isMassMode && (
                  <MassModePanel
                    massThemes={massMode.massThemes}
                    massQueueRunning={massMode.massQueueRunning}
                    massQueueSummary={massMode.massQueueSummary}
                    massPipelineMode={massMode.massPipelineMode}
                    massRegeneratingId={massMode.massRegeneratingId}
                    massImageGeneratingId={massMode.massImageGeneratingId}
                    massInputType={massMode.massInputType}
                    massInputTheme={massMode.massInputTheme}
                    massStoryPreviewId={massMode.massStoryPreviewId}
                    massCopiedId={massMode.massCopiedId}
                    massCollapseDone={massMode.massCollapseDone}
                    onExitMassMode={massMode.onExitMassMode}
                    onAddTheme={massMode.onAddTheme}
                    onDeleteTheme={massMode.onDeleteTheme}
                    onClearThemes={massMode.onClearThemes}
                    onClearCompletedThemes={massMode.onClearCompletedThemes}
                    onStartQueue={massMode.onStartQueue}
                    onStopQueue={massMode.onStopQueue}
                    onReGenerateItem={massMode.onReGenerateItem}
                    onGenerateImages={massMode.onGenerateImages}
                    onAddItemToQueue={massMode.onAddItemToQueue}
                    onTogglePostChecklist={massMode.onTogglePostChecklist}
                    onUpdatePostCaption={massMode.onUpdatePostCaption}
                    onGenerateCaptionForItem={massMode.onGenerateCaptionForItem}
                    onCopyCaption={massMode.onCopyCaption}
                    onInputTypeChange={massMode.onInputTypeChange}
                    onInputValueChange={massMode.onInputValueChange}
                    onStoryPreviewToggle={massMode.onStoryPreviewToggle}
                    onCollapseDoneToggle={massMode.onCollapseDoneToggle}
                    onPipelineModeChange={massMode.onPipelineModeChange}
                  />
                )}

                {simpleStep === 2 && (
                  <div className="simple-step-card">
                    <p className="simple-step-title">この内容で動画を作成します</p>
                    <p className="simple-step-theme">
                      テンプレート：{simpleTemplateId
                        ? (templates.find((t) => t.id === simpleTemplateId)?.name ?? simpleTemplateId)
                        : '指定なし'}
                    </p>
                    <p className="simple-step-theme">テーマ：{aiTheme}</p>
                    {testMode && (
                      <div className="test-mode-step2-badge">🧪 テストモードON — AI画像生成をスキップ</div>
                    )}
                    <ul className="simple-step-content-list">
                      {testMode && imageSourceMode === 'ai' ? (
                        <li className="test-mode-list-item">
                          {userUploadedImages.length > 0
                            ? `アップロード画像 ${userUploadedImages.length}枚を使用（AI生成スキップ）`
                            : cachedImagesForTemplate.length > 0
                              ? `キャッシュ画像 ${cachedImagesForTemplate.length}枚を再利用（AI生成スキップ）`
                              : 'プレースホルダー画像を使用（AI生成スキップ）'}
                        </li>
                      ) : reuseImageMode ? (
                        <li className="reuse-image-list-item">前回のAI画像を再利用（画像生成スキップ）</li>
                      ) : imageSourceMode === 'ai' ? (
                        <li className="ai-image-list-item">AI画像を生成（高コスト）</li>
                      ) : (
                        <li>アップロード画像 {userUploadedImages.length}枚を動画素材として使用</li>
                      )}
                      <li>AIでStoryを自動生成</li>
                      <li>ショート動画を自動生成</li>
                    </ul>
                    {imageSourceMode === 'upload' && userUploadedImages.length === 0 && (
                      <div className="step2-upload-reminder">
                        <p className="step2-upload-reminder-title">画像がアップロードされていません</p>
                        <p className="step2-upload-reminder-desc">戻って画像をアップロードすると、自分の画像で動画を作れます。14枚あると全スライドを使えます。足りない分は補完されます。</p>
                      </div>
                    )}
                    {reuseImageMode && (
                      <p className="reuse-image-step2-note">画像生成をスキップするため早く完成します</p>
                    )}
                    <div className="simple-step-actions">
                      <button className="btn-simple-back" onClick={() => goToSimpleStep(1)}>戻る</button>
                      <button
                        className="btn-simple-start"
                        onClick={() => { goToSimpleStep(3); handleRunReelFactory() }}
                        disabled={factoryRunning}
                      >
                        動画を作る
                      </button>
                    </div>
                  </div>
                )}

                {simpleStep === 3 && (
                  <div className="simple-step-card simple-step-card--status">
                    {factoryRunning ? (
                      <div className="simple-factory-progress">
                        {factoryStepNum === 2 && factoryStep.includes('キャッシュ') ? (
                          <>
                            <p className="simple-factory-status-emoji">🚀</p>
                            <p className="simple-factory-status-title">画像生成をスキップ中</p>
                            <p className="simple-factory-status-sub">前回の画像を再利用しています</p>
                          </>
                        ) : factoryStepNum === 2 && !factoryStep.includes('アップロード') && factoryCurrentImageIndex != null && factoryTotalImageCount != null ? (
                          <>
                            <p className="simple-factory-status-emoji">🎨</p>
                            <p className="simple-factory-status-title">AI画像生成中</p>
                            <p className="simple-factory-image-count">
                              {factoryCurrentImageIndex} / {factoryTotalImageCount} 枚目
                            </p>
                            {Math.ceil((factoryTotalImageCount - factoryCurrentImageIndex) * 50 / 60) > 0 && (
                              <p className="simple-factory-remaining">
                                残り約 {Math.ceil((factoryTotalImageCount - factoryCurrentImageIndex) * 50 / 60)} 分
                              </p>
                            )}
                          </>
                        ) : factoryStep.includes('アップロード') ? (
                          <>
                            <p className="simple-factory-status-emoji">⚡</p>
                            <p className="simple-factory-status-title">アップロード画像を反映中</p>
                            <p className="simple-factory-status-sub">AI画像生成をスキップしています</p>
                          </>
                        ) : (
                          <>
                            <p className="simple-factory-status-emoji">
                              {factoryStepNum === 1 ? '📝' : factoryStepNum === 3 ? '🧠' : factoryStepNum === 4 ? '⭐' : factoryStepNum === 5 ? '🎯' : factoryStepNum === 6 ? '✍️' : factoryStepNum === 7 ? '🎬' : '🏭'}
                            </p>
                            <p className="simple-factory-status-title">AI自動作成中</p>
                            <p className="simple-factory-status-sub">{factoryStep.replace(/^Step \d\/7: /, '')}</p>
                          </>
                        )}
                        <div className="simple-factory-bar-wrap">
                          <div className="simple-factory-bar-fill" style={{ width: `${factoryProgress}%` }} />
                        </div>
                        <p className="simple-factory-bar-pct">{factoryProgress}%</p>
                      </div>
                    ) : renderStatus === 'completed' ? (
                      <RenderCompletePanel
                        variant="priority"
                        preview={{
                          renderPreviewUrl,
                          latestViewUrl,
                          videoPreviewLoading,
                          videoPreviewError,
                          onRetryVideoPreview: checkVideoReady,
                          onVideoPreviewReady: () => setVideoPreviewLoading(false),
                          onVideoPreviewError: () => setVideoPreviewError('動画の読み込みに失敗しました。再取得をお試しください。'),
                        }}
                        actions={{
                          onDownloadVideo: downloadVideo,
                        }}
                        reuse={{
                          reuseImageMode,
                          cachedImagesCount: cachedImagesForTemplate.length,
                          showReuseDiscoveryBanner: !reuseImageMode && cachedImagesForTemplate.length > 0 && !!simpleTemplateType && !reuseHintDismissedTemplates.includes(simpleTemplateType),
                          onDismissReuseHint: dismissReuseHint,
                        }}
                        display={{
                          showDetailedFeatures,
                          onShowDetails: showDetails,
                          detailsChildren: postEditPanel,
                        }}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Phase19-G: PCレイアウト右カラムラッパー (simpleMode step3) */}
            <div className={simpleMode && simpleStep === 3 ? 'simple-pc-right' : undefined}>

            {/* Phase19-P: タブナビゲーション (Phase21-C: 詳細表示時のみ) */}
            {simpleMode && simpleStep === 3 && showDetailedFeatures && (
              <nav className="simple-tab-nav">
                {(
                  [
                    { key: 'create', label: '作成' },
                    { key: 'edit',   label: '編集' },
                    { key: 'post',   label: '投稿' },
                    { key: 'manage', label: '管理' },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    className={`simple-tab-btn${activeSimpleTab === key ? ' simple-tab-btn--active' : ''}`}
                    onClick={() => selectSimpleTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}

            {/* 🏭 AI Reel Factory (Phase16-L / Phase18-B / Phase22-M) */}
            {(!simpleMode || simpleStep === 3) && showInTab('create') && (
            <FactoryPanel {...panelProps.factoryPanelProps} />
            )}

            {!simpleMode && (
            <>
            <div className="render-variant-row">
              <label className="render-variant-label" htmlFor="render-variant-input">バリアント名</label>
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
            {isRendering && (
              <p className="render-generating-hint">
                画像・テキストをもとにショート動画を作成しています。完了すると、このエリアに動画が表示されます。
              </p>
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
                <p className="render-failed-hint">時間をおいて再実行するか、キューから再生成してください。</p>
                <button className="btn-rerender" onClick={startRender}>
                  再生成
                </button>
              </>
            )}
            </>
            )}
            {!simpleMode && renderStatus === 'idle' && !isRendering && !isBatchRendering && completedVariants.length === 0 && (
              <div className="render-output-empty">
                <p className="render-output-empty-title">まだ完成動画はありません</p>
                <p className="render-output-empty-hint">テーマを入力して「AI自動作成」を押すと、ここに完成動画が表示されます。</p>
              </div>
            )}
            {(!simpleMode || (simpleStep === 3 && activeSimpleTab !== 'edit')) && renderStatus === 'completed' && !isRendering && (
              <div className="render-complete-card">
                <RenderCompletePanel
                  variant="standard"
                  preview={{
                    renderPreviewUrl,
                    latestViewUrl,
                    videoPreviewLoading,
                    videoPreviewError,
                    onRetryVideoPreview: checkVideoReady,
                    onVideoPreviewReady: () => setVideoPreviewLoading(false),
                    onVideoPreviewError: () => setVideoPreviewError('動画の読み込みに失敗しました。再取得をお試しください。'),
                  }}
                  actions={{
                    onDownloadVideo: downloadVideo,
                    onCopyRenderUrl: copyRenderUrl,
                    onScrollToHistory: scrollToHistory,
                    onRerender: startRender,
                  }}
                  posting={{
                    isGeneratingSnsCaption,
                    snsCaptionError,
                    copiedAllCaption,
                    hasSnsCaption: !!snsCaption,
                    onGenerateSnsCaption: generateSnsCaption,
                    onCopyPostCaption: () => snsCaption && copyAllCaptions(snsCaption),
                    onGoToManageTab: simpleMode && simpleStep === 3 ? () => selectSimpleTab('manage') : undefined,
                    postChecklistContent: (
                      <PostingChecklistPanel
                        simpleTemplateId={simpleTemplateId}
                        postChecklist={postChecklist}
                        isPostChecklistComplete={isPostChecklistComplete}
                        onTogglePostChecklist={togglePostChecklist}
                        eventPostChecklist={eventPostChecklist}
                        eventPostDate={eventPostDate}
                        eventPostChecklistCount={eventPostChecklistCount}
                        isEventPostChecklistComplete={isEventPostChecklistComplete}
                        onToggleEventPostChecklist={toggleEventPostChecklist}
                        onChangeEventPostDate={setEventPostDate}
                      />
                    ),
                  }}
                  display={{
                    showCreateTab: showInTab('create'),
                    showPostTab: showInTab('post'),
                    slideCount,
                    copiedUrl,
                  }}
                />
                {/* Phase19-P: 管理タブ — ダッシュボード・記録・バックアップ */}
                <EventPostManagementPanel
                  eventPosting={{
                    isVisible: showInTab('manage'),
                    simpleTemplateId,
                    aiTheme,
                    mmmEventForm,
                    eventPostRecords,
                    eventPostRecordForm,
                    eventPostFilter,
                    eventPostReport,
                    eventDashboardStats,
                    filteredEventPostRecords,
                    isEventPostFilterActive,
                  }}
                  postingRecords={{
                    records: postedRecords,
                    form: postedForm,
                    importMessage: postedRecordsImportMessage,
                    importError: postedRecordsImportError,
                    report: postedReport,
                  }}
                  backup={{
                    importMessage: backupImportMessage,
                    importError: backupImportError,
                    onExportJson: exportReelBackupJson,
                    onImportJson: handleImportReelBackupJson,
                  }}
                  actions={{
                    onChangeEventPostRecordForm: setEventPostRecordForm,
                    onChangeEventPostFilter: setEventPostFilter,
                    onSaveEventPostRecord: saveEventPostRecord,
                    onDeleteEventPostRecord: deleteEventPostRecord,
                    onExportEventPostRecordsCsv: exportEventPostRecordsCsv,
                    onChangePostedForm: setPostedForm,
                    onAddPostedRecord: addPostedRecord,
                    onDeletePostedRecord: deletePostedRecord,
                    onExportPostedRecordsCsv: exportPostedRecordsCsv,
                    onExportPostedRecordsJson: exportPostedRecordsJson,
                    onImportPostedRecordsJson: handleImportPostedRecordsJson,
                  }}
                />
              </div>
            )}
            {/* Phase19-P: 編集タブパネル */}
            {simpleMode && simpleStep === 3 && activeSimpleTab === 'edit' && (
              renderStatus === 'completed' ? (
                <div className="simple-edit-tab-panel">
                  {postEditPanel}
                </div>
              ) : (
                <p className="simple-tab-empty">まず動画を作成すると、この機能が使えます。</p>
              )
            )}

            {/* Phase19-P: 投稿・管理タブ 未生成時ヒント */}
            {simpleMode && simpleStep === 3 && (activeSimpleTab === 'post' || activeSimpleTab === 'manage') && renderStatus !== 'completed' && (
              <p className="simple-tab-empty">まず動画を作成すると、この機能が使えます。</p>
            )}

            {(!simpleMode || simpleStep === 3) && snsCaption && renderStatus === 'completed' && showInTab('post') && (
              <SnsCaptionPanel
                snsCaption={snsCaption}
                selectedTemplateId={selectedTemplateId}
                simpleTemplateId={simpleTemplateId}
                templates={templates}
                copiedAllCaption={copiedAllCaption}
                copiedCaptionLabel={copiedCaptionLabel}
                snsCaptionError={snsCaptionError}
                copiedSnsField={copiedSnsField}
                editingCaptionKey={editingCaptionKey}
                editingCaptionText={editingCaptionText}
                regeneratingCaptionKey={regeneratingCaptionKey}
                isGeneratingSnsCaption={isGeneratingSnsCaption}
                onCopyAllCaptions={copyAllCaptions}
                onCopyCaptionText={copyCaptionText}
                onCopySnsText={copySnsText}
                onStartCaptionEdit={startCaptionEdit}
                onChangeEditingCaptionText={setEditingCaptionText}
                onCancelCaptionEdit={cancelCaptionEdit}
                onSaveCaptionEdit={saveCaptionEdit}
                onRegenerateCaptionPart={regenerateCaptionPart}
                onGenerateSnsCaption={generateSnsCaption}
                onGoToManageTab={simpleMode && simpleStep === 3 ? () => selectSimpleTab('manage') : undefined}
              />
            )}

            {/* 📚 AI自動作成履歴 (かんたんモード Step3 のみ・完成動画の後に表示) */}
            {simpleMode && simpleStep === 3 && activeSimpleTab === 'manage' && (
              <div className="simple-history-section">
                <FactoryHistoryPanel
                  factoryHistory={factoryHistory}
                  factoryRunning={factoryRunning}
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
              </div>
            )}
            {simpleMode && simpleStep === 3 && !factoryRunning && activeSimpleTab === 'create' && (
              <button
                className="btn-simple-new"
                onClick={() => { goToSimpleStep(1); clearFactoryMessages(); resetPostChecklist(); resetPostedRecords() }}
              >
                新しく作る
              </button>
            )}

            {!simpleMode && (<>
            {/* Render Queue (Phase13-H/K / Phase14-C) */}
            <div className="render-queue-section">
              <AdvancedControlsPanel
                aiTheme={aiTheme}
                isPipelineDisabled={isPipelineDisabled}
                autoPipeline={{
                  isRunning: isAutoPipelineRunning,
                  step: pipelineStep,
                  status: pipelineStatus,
                  warning: factoryWarning,
                  error: factoryError,
                  lastPipeline,
                  onRun: handleAutoRenderPipeline,
                }}
                smartPipeline={{
                  aiTheme,
                  isPipelineDisabled,
                  isSmartPipelineRunning,
                  smartPipelineStep,
                  smartPipelineStatus,
                  smartPipelineError,
                  lastSmartPipeline,
                  onRunSmartPipeline: handleSmartPipeline,
                  isSmartRewritePipelineRunning,
                  smartRewritePipelineStep,
                  smartRewritePipelineStatus,
                  smartRewritePipelineError,
                  lastSmartRewritePipeline,
                  onRunSmartRewritePipeline: handleSmartRewritePipeline,
                  isMultiRewriteQueueRunning,
                  multiRewriteQueueStep,
                  multiRewriteQueueStatus,
                  multiRewriteQueueError,
                  lastMultiRewriteQueue,
                  onRunMultiRewriteQueue: handleMultiRewriteQueue,
                }}
                variantGenerator={{
                  aiTheme,
                  slideCount,
                  isPipelineDisabled,
                  generatedVariants,
                  isGeneratingVariants,
                  variantGenerateError,
                  variantScores,
                  isScoringVariants,
                  variantScoreError,
                  smartQueueMessage,
                  renderQueue,
                  rewrittenStories,
                  isRewritingStory,
                  rewriteStoryError,
                  onGenerateVariants: generateAIVariants,
                  onScoreVariants: scoreVariants,
                  onAddAllVariantsToQueue: addAllVariantsToQueue,
                  onAddSmartQueue: addSmartQueue,
                  onAddVariantToQueue: addVariantToQueue,
                  onRewriteStory: rewriteStory,
                  onApplyRewrittenStory: applyRewrittenStory,
                }}
              />

              <RenderQueueTopActions
                aiTheme={aiTheme}
                renderQueueLength={renderQueue.length}
                isPipelineDisabled={isPipelineDisabled}
                autoGenerateNotice={autoGenerateNotice}
                onAutoGenerateVariants={autoGenerateVariants}
                onAddToQueue={addToQueue}
              />

              <RenderQueuePanel
                {...panelProps.renderQueuePanelProps}
              />
            </div>
            </>)}
          </div>

          {!simpleMode && (
          <div className="compare-dashboard" ref={compareDashboardRef}>
            <CompareDashboardPanel {...panelProps.comparePanelProps} />
          </div>
          )}

          {!simpleMode && (
          <details className="advanced-panel">
            <summary className="advanced-panel-summary">📚 バリアント学習</summary>
            <div className="advanced-panel-body">
              <VariantLearningPanel
                variantLearningSummary={variantLearningSummary}
                onClearLearningData={clearLearningData}
              />
            </div>{/* advanced-panel-body */}
          </details>
          )}

          <GenerationHistoryPanel
            ref={historyAreaRef}
            history={history}
            historyError={historyError}
            formatHistoryDate={formatHistoryDate}
            formatSize={formatSize}
          />

          {!simpleMode && (
          <>
          <button
            className="btn-save-template"
            onClick={openSaveTemplateModal}
            disabled={isRendering || slideCount === 0}
          >
            テンプレートとして保存
          </button>

          <button className={`btn-download ${saved ? 'btn-download--saved' : ''}`} onClick={downloadJSON}>
            {saved ? '✓ ダウンロード完了！' : '↓ slides.json をダウンロード'}
          </button>
          <p className="download-hint">
            ※ ダウンロードは保険用です
          </p>
          </>
          )}

            </div>{/* simple-pc-right wrapper */}
        </div>

        </div>{/* panel-left-body */}
      </div>

      {/* ── 中央パネル: プレビュー ── */}
      <PreviewWorkspace
        selectedSlide={selectedSlide}
        selectedSlideIndex={selectedSlideIndex}
        slideCount={slideCount}
        ctaConfig={ctaConfig}
        slides={slides}
        onSelectSlide={setSelectedId}
      />

      {/* ── 右パネル: 編集フォーム ── */}
      <SlideEditPanel
        selectedSlide={selectedSlide}
        ctaConfig={ctaConfig}
        isRendering={isRendering}
        imageGeneratingId={imageGeneratingId}
        imageGenerateErrors={imageGenerateErrors}
        onUpdateSlide={updateSlide}
        onCtaChange={handleCtaChange}
        onGenerateImage={handleGenerateImage}
      />
    </div>
  )
}
