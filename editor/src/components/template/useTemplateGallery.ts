import { useCallback, useState } from 'react'
import type { CTAConfig, Slide, Template, TemplateInfo } from '../../types'
import { extractTemplateVariables } from '../../templateVariables'

const RECENT_KEY = 'bemystyle-reel:recent-templates'
const RECENT_MAX = 5
const USAGE_KEY = 'bemystyle-reel:template-usage'

type GeneratedAsset = {
  filename: string
  path: string
  size: number
  createdAt: string
}

type UseTemplateGalleryOptions = {
  title: string
  slides: Slide[]
  ctaConfig: CTAConfig
  rawTemplateSlides: Slide[] | null
  onTemplateLoaded: (template: Template, templateId: string) => void
}

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

export function useTemplateGallery({
  title,
  slides,
  ctaConfig,
  rawTemplateSlides,
  onTemplateLoaded,
}: UseTemplateGalleryOptions) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [templateConfirmPending, setTemplateConfirmPending] = useState<string | null>(null)
  const [templateHints, setTemplateHints] = useState<Template['hints'] | null>(null)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateCategory, setSaveTemplateCategory] = useState<string>('other')
  const [saveTemplateDescription, setSaveTemplateDescription] = useState('')
  const [saveTemplateStatus, setSaveTemplateStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsMessage, setAssetsMessage] = useState('')
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>(() => loadRecentIds())
  const [usageMap, setUsageMap] = useState<Record<string, number>>(() => loadUsage())

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/templates')
      const data = await res.json()
      if (data.ok) setTemplates(data.templates as TemplateInfo[])
    } catch (_) {}
  }, [])

  const fetchGeneratedAssets = useCallback(async () => {
    setAssetsLoading(true)
    try {
      const res = await fetch('/api/assets/generated')
      const data = await res.json()
      if (data.ok) setGeneratedAssets(data.assets)
    } catch (_) {}
    finally { setAssetsLoading(false) }
  }, [])

  const confirmLoadTemplate = useCallback((id: string) => {
    setTemplateConfirmPending(id)
  }, [])

  const cancelLoadTemplate = useCallback(() => {
    setTemplateConfirmPending(null)
  }, [])

  const openSaveTemplateModal = useCallback(() => {
    setSaveTemplateName('')
    setSaveTemplateCategory('other')
    setSaveTemplateDescription('')
    setSaveTemplateStatus('idle')
    setSaveTemplateModal(true)
  }, [])

  const cancelSaveTemplateModal = useCallback(() => {
    setSaveTemplateModal(false)
    setSaveTemplateName('')
    setSaveTemplateCategory('other')
    setSaveTemplateDescription('')
    setSaveTemplateStatus('idle')
  }, [])

  const loadTemplate = useCallback(async (id: string) => {
    setTemplateConfirmPending(null)
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!data.ok || !data.template) return
      const tpl = data.template as Template
      onTemplateLoaded(tpl, id)
      setTemplateHints(tpl.hints ?? null)
      setSelectedTemplateId(id)
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
  }, [onTemplateLoaded])

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
    setSelectedTemplateId((current) => current === id ? '' : current)
    await fetchTemplates()
  }, [fetchTemplates])

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
    if (unused.length === 0) {
      setAssetsMessage('未使用画像はありません')
      setTimeout(() => setAssetsMessage(''), 3000)
      return
    }
    for (const asset of unused) {
      try {
        await fetch(`/api/assets/generated/${encodeURIComponent(asset.filename)}`, { method: 'DELETE' })
      } catch (_) {}
    }
    setGeneratedAssets((prev) => prev.filter((a) => usedSet.has(a.path)))
    setAssetsMessage(`${unused.length}枚の未使用画像を削除しました`)
    setTimeout(() => setAssetsMessage(''), 3000)
  }, [generatedAssets])

  return {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    templateConfirmPending,
    templateHints,
    saveTemplateModal,
    setSaveTemplateModal,
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
  }
}
