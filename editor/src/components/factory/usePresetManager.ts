import { useCallback, useState } from 'react'
import type React from 'react'
import type { CTAConfig, EditPreset, MmmEventPreset, Slide, Template } from '../../types'
import {
  applyTemplateVariables,
  extractTemplateVariables,
  type TemplateVariableValues,
} from '../../templateVariables'

export type { EditPreset, MmmEventPreset, TemplateVariableValues }

type MmmEventForm = {
  title: string
  date: string
  startTime: string
  endTime: string
  venue: string
  price: string
  url: string
  message: string
}

type UsePresetManagerParams = {
  slides: Slide[]
  title: string
  ctaConfig: CTAConfig
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  setTitle: React.Dispatch<React.SetStateAction<string>>
  setCtaConfig: React.Dispatch<React.SetStateAction<CTAConfig>>
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>
  markDirty: () => void
  visualStyleTags: string[]
  setVisualStyleTags: React.Dispatch<React.SetStateAction<string[]>>
  bgmFileName: string
  setBgmFileName: React.Dispatch<React.SetStateAction<string>>
  mmmEventForm: MmmEventForm
  setMmmEventForm: React.Dispatch<React.SetStateAction<MmmEventForm>>
}

const EDIT_PRESETS_KEY = 'bemystyle-reel-edit-presets'
const MMM_EVENT_PRESETS_KEY = 'bemystyle-reel-mmm-event-presets'

const DEFAULT_EDIT_PRESETS: EditPreset[] = [
  {
    id: 'default-mmm-artist',
    name: 'MMM 上品アーティスト',
    visualStyleTags: ['アニメ調', '音楽', '演奏', '上品', 'アーティスト'],
    ctaLabel: 'イベントページへ',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'default-mmm-pop',
    name: 'MMM かわいいポップ',
    visualStyleTags: ['かわいい', 'ポップ', '音楽', '青春'],
    ctaLabel: 'お申し込みはこちら',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'default-mmm-live',
    name: 'MMM ライブ感強め',
    visualStyleTags: ['ライブ感', 'ダイナミック', 'かっこいい', '演奏'],
    ctaLabel: '詳細はこちら',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

const DEFAULT_MMM_EVENT_PRESETS: MmmEventPreset[] = [
  {
    id: 'default-mmm-rhythm-neko',
    name: 'Rhythm Neko 大演奏会',
    title: 'MMM大演奏会',
    date: '',
    startTime: '17:30',
    endTime: '22:30',
    venue: 'レンタルスペース Rhythm Neko',
    price: '演奏3,500円・聴くだけ1,000円',
    url: '',
    message: '飲食OK。初心者歓迎。演奏参加・聴くだけ参加OK。',
    createdAt: 'default',
  },
]

function loadEditPresets(): EditPreset[] {
  try {
    const raw = localStorage.getItem(EDIT_PRESETS_KEY)
    if (!raw) return DEFAULT_EDIT_PRESETS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_EDIT_PRESETS
    return parsed as EditPreset[]
  } catch {
    return DEFAULT_EDIT_PRESETS
  }
}

function loadMmmEventPresets(): MmmEventPreset[] {
  try {
    const raw = localStorage.getItem(MMM_EVENT_PRESETS_KEY)
    if (!raw) return DEFAULT_MMM_EVENT_PRESETS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MMM_EVENT_PRESETS
    return parsed as MmmEventPreset[]
  } catch {
    return DEFAULT_MMM_EVENT_PRESETS
  }
}

export function usePresetManager({
  slides: _slides,
  title: _title,
  ctaConfig: _ctaConfig,
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
}: UsePresetManagerParams) {
  // Phase19-H: MMMイベント情報プリセット
  const [mmmEventPresets, setMmmEventPresets] = useState<MmmEventPreset[]>(() => loadMmmEventPresets())
  const [mmmEventPresetName, setMmmEventPresetName] = useState('')
  const [selectedMmmEventPresetId, setSelectedMmmEventPresetId] = useState('')
  const [mmmEventPresetNotice, setMmmEventPresetNotice] = useState('')

  // Phase19-F: 編集プリセット
  const [editPresets, setEditPresets] = useState<EditPreset[]>(() => loadEditPresets())
  const [editPresetName, setEditPresetName] = useState('')
  const [selectedEditPresetId, setSelectedEditPresetId] = useState('')

  // テンプレート変数 (Phase11.5-C)
  const [rawTemplateSlides, setRawTemplateSlides] = useState<Slide[] | null>(null)
  const [templateVariableKeys, setTemplateVariableKeys] = useState<string[]>([])
  const [variableValues, setVariableValues] = useState<TemplateVariableValues>({})

  const applyLoadedTemplate = useCallback((tpl: Template, templateId: string) => {
    void templateId
    const keys = extractTemplateVariables(tpl.slides)
    setRawTemplateSlides(tpl.slides)
    setTemplateVariableKeys(keys)
    setVariableValues({})
    setSlides(tpl.slides)
    setCtaConfig(tpl.cta)
    setTitle(tpl.title ?? tpl.name)
    if (tpl.slides.length > 0) setSelectedId(tpl.slides[0].id)
    markDirty()
  }, [markDirty, setCtaConfig, setSelectedId, setSlides, setTitle])

  const handleVariableChange = useCallback((key: string, value: string) => {
    setVariableValues((prev) => {
      const next = { ...prev, [key]: value }
      if (rawTemplateSlides) {
        setSlides(applyTemplateVariables(rawTemplateSlides, next))
        markDirty()
      }
      return next
    })
  }, [markDirty, rawTemplateSlides, setSlides])

  // Phase19-F: 編集プリセット 保存
  const saveEditPreset = useCallback(() => {
    const name = editPresetName.trim()
    if (!name) return
    const preset: EditPreset = {
      id: `ep-${Date.now()}`,
      name,
      visualStyleTags: [...visualStyleTags],
      bgmFileName: bgmFileName || undefined,
      createdAt: new Date().toISOString(),
    }
    setEditPresets((prev) => {
      const next = [...prev, preset]
      localStorage.setItem(EDIT_PRESETS_KEY, JSON.stringify(next))
      return next
    })
    setEditPresetName('')
  }, [bgmFileName, editPresetName, visualStyleTags])

  // Phase19-F: 編集プリセット 適用
  const applyEditPreset = useCallback((presetId: string) => {
    const preset = editPresets.find((p) => p.id === presetId)
    if (!preset) return
    setVisualStyleTags(preset.visualStyleTags)
    if (preset.bgmFileName) setBgmFileName(preset.bgmFileName)
    setSelectedEditPresetId(presetId)
  }, [editPresets, setBgmFileName, setVisualStyleTags])

  // Phase19-F: 編集プリセット 削除
  const deleteEditPreset = useCallback((presetId: string) => {
    setEditPresets((prev) => {
      const next = prev.filter((p) => p.id !== presetId)
      localStorage.setItem(EDIT_PRESETS_KEY, JSON.stringify(next))
      return next
    })
    if (selectedEditPresetId === presetId) setSelectedEditPresetId('')
  }, [selectedEditPresetId])

  // Phase19-H: MMMイベントプリセット 保存
  const saveMmmEventPreset = useCallback(() => {
    const name = mmmEventPresetName.trim()
    if (!name) {
      setMmmEventPresetNotice('保存するプリセット名を入力してください。')
      return
    }
    if (!mmmEventForm.title.trim() || !mmmEventForm.venue.trim()) {
      setMmmEventPresetNotice('イベント名と会場を入力してから保存してください。')
      return
    }
    const preset: MmmEventPreset = {
      id: `mep-${Date.now()}`,
      name,
      ...mmmEventForm,
      createdAt: new Date().toISOString(),
    }
    setMmmEventPresets((prev) => {
      const next = [...prev, preset]
      localStorage.setItem(MMM_EVENT_PRESETS_KEY, JSON.stringify(next))
      return next
    })
    setMmmEventPresetName('')
    setMmmEventPresetNotice('イベント情報を保存しました。')
    setTimeout(() => setMmmEventPresetNotice(''), 3000)
  }, [mmmEventForm, mmmEventPresetName])

  // Phase19-H: MMMイベントプリセット 呼び出し
  const applyMmmEventPreset = useCallback((presetId: string) => {
    const preset = mmmEventPresets.find((p) => p.id === presetId)
    if (!preset) return
    setMmmEventForm({
      title: preset.title,
      date: preset.date,
      startTime: preset.startTime,
      endTime: preset.endTime,
      venue: preset.venue,
      price: preset.price,
      url: preset.url,
      message: preset.message,
    })
    setMmmEventPresetNotice(`「${preset.name}」を呼び出しました。`)
    setTimeout(() => setMmmEventPresetNotice(''), 3000)
  }, [mmmEventPresets, setMmmEventForm])

  // Phase19-H: MMMイベントプリセット 削除
  const deleteMmmEventPreset = useCallback((presetId: string) => {
    setMmmEventPresets((prev) => {
      const next = prev.filter((p) => p.id !== presetId)
      localStorage.setItem(MMM_EVENT_PRESETS_KEY, JSON.stringify(next))
      return next
    })
    if (selectedMmmEventPresetId === presetId) setSelectedMmmEventPresetId('')
  }, [selectedMmmEventPresetId])

  const isDefaultEditPreset = useCallback((presetId: string) => {
    return DEFAULT_EDIT_PRESETS.some((p) => p.id === presetId)
  }, [])

  const isDefaultMmmEventPreset = useCallback((presetId: string) => {
    return DEFAULT_MMM_EVENT_PRESETS.some((p) => p.id === presetId)
  }, [])

  return {
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
  }
}
