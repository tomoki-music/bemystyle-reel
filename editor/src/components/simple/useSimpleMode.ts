import { useCallback, useEffect, useState } from 'react'
import type { SimpleTemplateType } from '../../types'

const SIMPLE_MODE_STORAGE_KEY = 'reel-simple-mode'
const SIMPLE_TEMPLATE_TYPE_KEY = 'bemystyle-reel-simple-template-type'
const REUSE_HINT_DISMISSED_KEY = 'bemystyle-reel-reuse-hint-dismissed'
const VALID_SIMPLE_TEMPLATE_TYPES: SimpleTemplateType[] = ['mmm-event', 'free-diagnosis', 'note-article', 'youtube-video', 'music-community', 'custom']

export type SimpleStep = 1 | 2 | 3
export type SimpleTab = 'create' | 'edit' | 'post' | 'manage'

export function useSimpleMode() {
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    try { return localStorage.getItem(SIMPLE_MODE_STORAGE_KEY) !== 'false' } catch { return true }
  })
  const [simpleStep, setSimpleStep] = useState<SimpleStep>(1)
  const [activeSimpleTab, setActiveSimpleTab] = useState<SimpleTab>('create')
  const [showDetailedFeatures, setShowDetailedFeatures] = useState<boolean>(false)
  const [reuseHintDismissedTemplates, setReuseHintDismissedTemplates] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(REUSE_HINT_DISMISSED_KEY) ?? '[]') } catch { return [] }
  })
  const [simpleTemplateId, setSimpleTemplateId] = useState('')
  const [simpleTemplateType, setSimpleTemplateType] = useState<SimpleTemplateType | null>(() => {
    try {
      const saved = localStorage.getItem(SIMPLE_TEMPLATE_TYPE_KEY)
      if (saved && VALID_SIMPLE_TEMPLATE_TYPES.includes(saved as SimpleTemplateType)) return saved as SimpleTemplateType
      return null
    } catch { return null }
  })

  useEffect(() => {
    try { localStorage.setItem(SIMPLE_MODE_STORAGE_KEY, String(simpleMode)) } catch {}
  }, [simpleMode])

  useEffect(() => {
    try { if (simpleTemplateType) localStorage.setItem(SIMPLE_TEMPLATE_TYPE_KEY, simpleTemplateType) } catch {}
  }, [simpleTemplateType])

  const startSimpleMode = useCallback(() => setSimpleMode(true), [])
  const exitSimpleMode = useCallback(() => setSimpleMode(false), [])
  const goToSimpleStep = useCallback((step: SimpleStep) => setSimpleStep(step), [])
  const selectSimpleTab = useCallback((tab: SimpleTab) => setActiveSimpleTab(tab), [])

  const selectSimpleTemplateType = useCallback((type: SimpleTemplateType) => {
    setSimpleTemplateType(type)
    setSimpleTemplateId(type === 'mmm-event' ? 'mmm-event' : '')
  }, [])

  const resetCompletedView = useCallback(() => {
    setActiveSimpleTab('create')
    setShowDetailedFeatures(false)
  }, [])
  const showDetails = useCallback(() => setShowDetailedFeatures(true), [])

  const showInTab = useCallback((tab: SimpleTab, isRenderCompleted: boolean) => {
    if (!simpleMode || simpleStep !== 3) return true
    if (isRenderCompleted && !showDetailedFeatures) return false
    return activeSimpleTab === tab
  }, [activeSimpleTab, showDetailedFeatures, simpleMode, simpleStep])

  const dismissReuseHint = useCallback(() => {
    if (!simpleTemplateType) return
    setReuseHintDismissedTemplates(prev => {
      if (prev.includes(simpleTemplateType)) return prev
      const next = [...prev, simpleTemplateType]
      try { localStorage.setItem(REUSE_HINT_DISMISSED_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [simpleTemplateType])

  return {
    simpleMode,
    setSimpleMode,
    startSimpleMode,
    exitSimpleMode,
    simpleStep,
    setSimpleStep,
    goToSimpleStep,
    activeSimpleTab,
    setActiveSimpleTab,
    selectSimpleTab,
    showDetailedFeatures,
    setShowDetailedFeatures,
    showDetails,
    resetCompletedView,
    reuseHintDismissedTemplates,
    simpleTemplateId,
    setSimpleTemplateId,
    simpleTemplateType,
    setSimpleTemplateType,
    selectSimpleTemplateType,
    showInTab,
    dismissReuseHint,
  }
}
