import { Dispatch, SetStateAction, useEffect } from 'react'
import { CTAConfig, Slide, SlidesData } from '../../types'

type UseInitialReelLoaderOptions = {
  setSlides: Dispatch<SetStateAction<Slide[]>>
  setCtaConfig: Dispatch<SetStateAction<CTAConfig>>
  setTitle: Dispatch<SetStateAction<string>>
  setSelectedId: Dispatch<SetStateAction<number | null>>
  setLoading: Dispatch<SetStateAction<boolean>>
  loadHistory: () => void | Promise<void>
  loadTemplates: () => void | Promise<void>
  loadGeneratedImages: () => void | Promise<void>
  fetchReelAiConfig: () => void | Promise<void>
}

export function useInitialReelLoader({
  setSlides,
  setCtaConfig,
  setTitle,
  setSelectedId,
  setLoading,
  loadHistory,
  loadTemplates,
  loadGeneratedImages,
  fetchReelAiConfig,
}: UseInitialReelLoaderOptions) {
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
    loadHistory()
    loadTemplates()
    loadGeneratedImages()
    fetchReelAiConfig()
  }, [
    setSlides,
    setCtaConfig,
    setTitle,
    setSelectedId,
    setLoading,
    loadHistory,
    loadTemplates,
    loadGeneratedImages,
    fetchReelAiConfig,
  ])
}
