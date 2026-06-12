import { useCallback, useMemo, useState } from 'react'
import { CTAConfig, Slide, SlidesData } from '../../types'

type UseEditorCoreOptions = {
  initialTitle: string
  onNewProject?: () => void
}

export function useEditorCore({ initialTitle, onNewProject }: UseEditorCoreOptions) {
  const [slides, setSlides] = useState<Slide[]>([])
  const [ctaConfig, setCtaConfig] = useState<CTAConfig>({ qrImage: 'qr-singing.png' })
  const [title, setTitle] = useState(initialTitle)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const currentSnapshot = useMemo<SlidesData>(() => ({
    title,
    slides,
    cta: ctaConfig,
  }), [title, slides, ctaConfig])

  const markDirty = useCallback(() => {
    setHasUnsavedChanges(true)
  }, [])

  const updateSlide = useCallback((id: number, changes: Partial<Slide>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)))
    setHasUnsavedChanges(true)
  }, [])

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

  const handleSlideTextChange = useCallback((slideId: number, field: 'headline' | 'subline' | 'emphasis', value: string) => {
    updateSlide(slideId, { [field]: value })
  }, [updateSlide])

  const handleCtaChange = useCallback((config: CTAConfig) => {
    setCtaConfig(config)
    setHasUnsavedChanges(true)
  }, [])

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
    onNewProject?.()
  }, [hasUnsavedChanges, onNewProject])

  const handleSnapshotSaved = useCallback(() => {
    setHasUnsavedChanges(false)
  }, [])

  return {
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
  }
}
