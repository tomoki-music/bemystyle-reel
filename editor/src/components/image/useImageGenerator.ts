import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import type { Slide, SimpleTemplateType } from '../../types'

const IMAGE_CACHE_KEY = 'reel-image-cache-v1'
const IMAGE_CACHE_META_KEY = 'reel-image-cache-meta-v1'
const IMAGE_CONCURRENCY = 3

interface UseImageGeneratorParams {
  slides: Slide[]
  simpleTemplateType: SimpleTemplateType | null
  costMode: 'normal' | 'save'
  imageQualityMode: 'standard' | 'high'
  updateSlide: (id: number, changes: Partial<Slide>) => void
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  updateLatestHistory: (patch: { imageCount: number }) => void
  setQuotaError: React.Dispatch<React.SetStateAction<boolean>>
}

export function useImageGenerator({
  slides,
  simpleTemplateType,
  costMode,
  imageQualityMode,
  updateSlide,
  setSlides,
  updateLatestHistory,
  setQuotaError,
}: UseImageGeneratorParams) {
  // Phase12-E: AI 画像生成
  const [imageGeneratingId, setImageGeneratingId] = useState<number | null>(null)
  const [imageGenerateErrors, setImageGenerateErrors] = useState<Record<number, string>>({})

  // Phase12-F: AI 一括画像生成
  const [bulkImageGenerating, setBulkImageGenerating] = useState(false)
  const [bulkImageProgress, setBulkImageProgress] = useState({ current: 0, total: 0 })
  const [bulkImageMessage, setBulkImageMessage] = useState('')
  const [bulkImageSubMessage, setBulkImageSubMessage] = useState('')
  const [failedImageIds, setFailedImageIds] = useState<number[]>([])

  // Phase21-D/F: 画像再利用キャッシュ
  const [reuseImageMode, setReuseImageMode] = useState(false)
  const [cachedImagesForTemplate, setCachedImagesForTemplate] = useState<string[]>([])
  const [cachedImagesForTemplateSavedAt, setCachedImagesForTemplateSavedAt] = useState<string | null>(null)

  // Phase19-J: 節約モード計算
  const imageGenerateCount = costMode === 'save' ? Math.min(5, slides.length) : slides.length
  const effectiveQuality = costMode === 'save' ? 'standard' : imageQualityMode

  // Phase21-D: simpleTemplateType 変更時にキャッシュ読み込み
  useEffect(() => {
    setReuseImageMode(false)
    try {
      const raw = localStorage.getItem(IMAGE_CACHE_KEY)
      if (!raw || !simpleTemplateType) {
        setCachedImagesForTemplate([])
        setCachedImagesForTemplateSavedAt(null)
        return
      }
      const cache = JSON.parse(raw) as Record<string, string[]>
      setCachedImagesForTemplate(cache[simpleTemplateType] ?? [])
      try {
        const metaRaw = localStorage.getItem(IMAGE_CACHE_META_KEY)
        const meta = metaRaw ? JSON.parse(metaRaw) as Record<string, string> : {}
        setCachedImagesForTemplateSavedAt(meta[simpleTemplateType] ?? null)
      } catch {
        setCachedImagesForTemplateSavedAt(null)
      }
    } catch {
      setCachedImagesForTemplate([])
      setCachedImagesForTemplateSavedAt(null)
    }
  }, [simpleTemplateType])

  const handleGenerateImage = useCallback(async (slideId: number, imagePrompt: string) => {
    setImageGeneratingId(slideId)
    setImageGenerateErrors((prev) => { const next = { ...prev }; delete next[slideId]; return next })
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: imagePrompt, quality: costMode === 'save' ? 'standard' : imageQualityMode }),
      })
      const data = await res.json() as { ok?: boolean; image?: string; errorType?: string; message?: string }
      if (data.errorType === 'quota') { setQuotaError(true) }
      if (!data.ok) throw new Error(data.message ?? '画像生成に失敗しました')
      updateSlide(slideId, { image: data.image })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '画像生成に失敗しました'
      setImageGenerateErrors((prev) => ({ ...prev, [slideId]: msg }))
    } finally {
      setImageGeneratingId(null)
    }
  }, [updateSlide, imageQualityMode, costMode, setQuotaError])

  // Phase21-I: 3並列で画像生成（直列→バッチ化で大幅短縮）
  const handleGenerateAllImages = useCallback(async (): Promise<boolean> => {
    const allTargets = slides.filter((slide) => slide.imagePrompt).slice(0, 14)
    if (allTargets.length === 0) return false

    // Phase19-J: 節約モードでは生成枚数を制限
    const generateTargets = allTargets.slice(0, imageGenerateCount)
    setBulkImageGenerating(true)
    setBulkImageProgress({ current: 0, total: generateTargets.length })
    setBulkImageMessage('')
    setBulkImageSubMessage('')
    setFailedImageIds([])

    const totalBatches = Math.ceil(generateTargets.length / IMAGE_CONCURRENCY)

    try {
      let nextSlides = [...slides]
      const generatedImages: string[] = []
      const failedIds: number[] = []
      let completed = 0

      for (let i = 0; i < generateTargets.length; i += IMAGE_CONCURRENCY) {
        const batch = generateTargets.slice(i, i + IMAGE_CONCURRENCY)
        const batchNum = Math.floor(i / IMAGE_CONCURRENCY) + 1

        setBulkImageSubMessage(
          `${IMAGE_CONCURRENCY}枚ずつ並列生成中（バッチ ${batchNum} / ${totalBatches}）`
        )

        const results = await Promise.allSettled(
          batch.map((target) =>
            fetch('/api/generate-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: target.imagePrompt, quality: effectiveQuality }),
            }).then((res) =>
              res.json().then((d: { ok?: boolean; image?: string; errorType?: string; message?: string }) => {
                // Phase21-J: 1枚完了ごとに進捗を即時更新
                completed++
                setBulkImageProgress({ current: completed, total: generateTargets.length })
                return { target, resOk: res.ok, data: d }
              })
            )
          )
        )

        let quotaHit = false
        // results は batch と同順なので index で対応付け
        for (let j = 0; j < results.length; j++) {
          const result = results[j]
          const target = batch[j]

          if (result.status === 'rejected') {
            failedIds.push(target.id)
            continue
          }

          const { resOk, data } = result.value
          if (!resOk || !data.ok) {
            if (data.errorType === 'quota') {
              quotaHit = true
              setQuotaError(true)
              setBulkImageMessage('APIクレジット不足のため画像生成を停止しました。')
              break
            }
            failedIds.push(target.id)
            continue
          }

          if (data.image) {
            generatedImages.push(data.image)
            nextSlides = nextSlides.map((slide) =>
              slide.id === target.id ? { ...slide, image: data.image! } : slide
            )
          } else {
            failedIds.push(target.id)
          }
        }

        setSlides([...nextSlides])

        if (quotaHit) {
          setFailedImageIds(failedIds)
          return false
        }
      }

      setFailedImageIds(failedIds)

      // Phase19-J: 節約モードで残りスライドへループ割当
      if (costMode === 'save' && generatedImages.length > 0) {
        const remaining = allTargets.slice(generateTargets.length)
        remaining.forEach((target, idx) => {
          const loopImage = generatedImages[idx % generatedImages.length]
          nextSlides = nextSlides.map((slide) =>
            slide.id === target.id ? { ...slide, image: loopImage } : slide
          )
        })
        setSlides(nextSlides)
      }

      updateLatestHistory({
        imageCount: nextSlides.filter((s) => s.image?.startsWith('generated/')).length,
      })
      const generated = generatedImages.length
      const failedCount = failedIds.length
      setBulkImageMessage(
        costMode === 'save'
          ? `${generated}枚生成・${allTargets.length}スライドへループ割当完了${failedCount > 0 ? `（${failedCount}枚失敗）` : ''}`
          : failedCount > 0
            ? `${generated}枚生成完了・${failedCount}枚失敗`
            : `${generated}枚のAI画像生成が完了しました`
      )
      return generated > 0
    } catch (_) {
      setBulkImageMessage('一部の画像生成に失敗しました。生成済み画像は保持されています。')
      return false
    } finally {
      setBulkImageGenerating(false)
      setBulkImageSubMessage('')
    }
  }, [slides, updateLatestHistory, imageGenerateCount, effectiveQuality, costMode, setSlides, setQuotaError])

  // Phase21-K: 失敗した画像だけ再生成
  const handleRetryFailedImages = useCallback(async () => {
    if (failedImageIds.length === 0) return
    const retryTargets = slides.filter((s) => failedImageIds.includes(s.id) && s.imagePrompt)
    if (retryTargets.length === 0) return

    setBulkImageGenerating(true)
    setBulkImageProgress({ current: 0, total: retryTargets.length })
    setBulkImageMessage('')
    setBulkImageSubMessage('')

    const totalBatches = Math.ceil(retryTargets.length / IMAGE_CONCURRENCY)

    try {
      let nextSlides = [...slides]
      const stillFailedIds: number[] = []
      let completed = 0

      for (let i = 0; i < retryTargets.length; i += IMAGE_CONCURRENCY) {
        const batch = retryTargets.slice(i, i + IMAGE_CONCURRENCY)
        const batchNum = Math.floor(i / IMAGE_CONCURRENCY) + 1

        setBulkImageSubMessage(
          totalBatches > 1
            ? `再試行中（バッチ ${batchNum} / ${totalBatches}）`
            : '再試行中...'
        )

        const results = await Promise.allSettled(
          batch.map((target) =>
            fetch('/api/generate-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: target.imagePrompt, quality: effectiveQuality }),
            }).then((res) =>
              res.json().then((d: { ok?: boolean; image?: string; errorType?: string; message?: string }) => {
                completed++
                setBulkImageProgress({ current: completed, total: retryTargets.length })
                return { target, resOk: res.ok, data: d }
              })
            )
          )
        )

        let quotaHit = false
        for (let j = 0; j < results.length; j++) {
          const result = results[j]
          const target = batch[j]

          if (result.status === 'rejected') {
            stillFailedIds.push(target.id)
            continue
          }

          const { resOk, data } = result.value
          if (!resOk || !data.ok) {
            if (data.errorType === 'quota') {
              quotaHit = true
              setQuotaError(true)
              setBulkImageMessage('APIクレジット不足のため再試行を停止しました。')
              break
            }
            stillFailedIds.push(target.id)
            continue
          }

          if (data.image) {
            nextSlides = nextSlides.map((slide) =>
              slide.id === target.id ? { ...slide, image: data.image! } : slide
            )
          } else {
            stillFailedIds.push(target.id)
          }
        }

        setSlides([...nextSlides])

        if (quotaHit) {
          setFailedImageIds(stillFailedIds)
          return
        }
      }

      setFailedImageIds(stillFailedIds)
      updateLatestHistory({
        imageCount: nextSlides.filter((s) => s.image?.startsWith('generated/')).length,
      })
      const retried = retryTargets.length - stillFailedIds.length
      setBulkImageMessage(
        stillFailedIds.length > 0
          ? `${retried}枚再生成完了・${stillFailedIds.length}枚失敗`
          : `${retried}枚の再生成が完了しました`
      )
    } catch (_) {
      setBulkImageMessage('再生成中にエラーが発生しました。生成済み画像は保持されています。')
    } finally {
      setBulkImageGenerating(false)
      setBulkImageSubMessage('')
    }
  }, [failedImageIds, slides, effectiveQuality, updateLatestHistory, setSlides, setQuotaError])

  // Phase21-F: 画像キャッシュ削除
  const handleDeleteImageCache = useCallback(() => {
    if (!simpleTemplateType) return
    try {
      const raw = localStorage.getItem(IMAGE_CACHE_KEY)
      if (raw) {
        const cache = JSON.parse(raw) as Record<string, string[]>
        delete cache[simpleTemplateType]
        localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache))
      }
      const metaRaw = localStorage.getItem(IMAGE_CACHE_META_KEY)
      if (metaRaw) {
        const meta = JSON.parse(metaRaw) as Record<string, string>
        delete meta[simpleTemplateType]
        localStorage.setItem(IMAGE_CACHE_META_KEY, JSON.stringify(meta))
      }
    } catch {}
    setCachedImagesForTemplate([])
    setCachedImagesForTemplateSavedAt(null)
    setReuseImageMode(false)
  }, [simpleTemplateType])

  return {
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
    imageGenerateCount,
    handleGenerateImage,
    handleGenerateAllImages,
    handleRetryFailedImages,
    handleDeleteImageCache,
  }
}
