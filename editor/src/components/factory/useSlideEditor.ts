import { Dispatch, SetStateAction, useCallback, useMemo, useState } from 'react'
import { Slide } from '../../types'

type UseSlideEditorOptions = {
  slides: Slide[]
  selectedId: number | null
  setSelectedId: Dispatch<SetStateAction<number | null>>
}

export function useSlideEditor({ slides, selectedId, setSelectedId }: UseSlideEditorOptions) {
  const [slideEditorOpen, setSlideEditorOpen] = useState(false)

  const selectedSlideIndex = useMemo(
    () => slides.findIndex((slide) => slide.id === selectedId),
    [slides, selectedId]
  )
  const selectedSlide = selectedSlideIndex >= 0 ? slides[selectedSlideIndex] : null
  const visibleSlides = useMemo(
    () => slides.filter((slide) => slide.visible),
    [slides]
  )
  const hiddenSlides = useMemo(
    () => slides.filter((slide) => !slide.visible),
    [slides]
  )
  const slideCount = slides.length
  const visibleSlideCount = visibleSlides.length

  const openSlideEditor = useCallback(() => {
    setSlideEditorOpen(true)
  }, [])

  const closeSlideEditor = useCallback(() => {
    setSlideEditorOpen(false)
  }, [])

  const selectSlideAndOpenEditor = useCallback((slideId: number) => {
    setSelectedId(slideId)
    setSlideEditorOpen(true)
  }, [setSelectedId])

  return {
    slideEditorOpen,
    setSlideEditorOpen,
    selectedSlide,
    selectedSlideIndex,
    visibleSlides,
    hiddenSlides,
    slideCount,
    visibleSlideCount,
    openSlideEditor,
    closeSlideEditor,
    selectSlideAndOpenEditor,
  }
}
