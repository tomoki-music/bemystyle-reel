import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { CTAConfig, Slide } from '../../types'

export type UserUploadedImage = {
  id: string
  name: string
  url: string
}

export type ImageSourceMode = 'ai' | 'upload'
export type ImageQualityMode = 'standard' | 'high'
export type CostMode = 'normal' | 'save'

type UseAssetManagerParams = {
  slides: Slide[]
  ctaConfig: CTAConfig
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>
  setCtaConfig: React.Dispatch<React.SetStateAction<CTAConfig>>
  markDirty: () => void
}

export function useAssetManager({
  slides: _slides,
  ctaConfig: _ctaConfig,
  setSlides,
  setCtaConfig,
  markDirty,
}: UseAssetManagerParams) {
  // User media and image reuse state
  const [userUploadedImages, setUserUploadedImages] = useState<UserUploadedImage[]>([])
  const [imageSourceMode, setImageSourceMode] = useState<ImageSourceMode>('upload')

  // Phase19-E: BGM差し替え
  const [bgmFileName, setBgmFileName] = useState('')
  const [bgmUploading, setBgmUploading] = useState(false)
  const [bgmUploadError, setBgmUploadError] = useState('')
  const [recommendedCtaLabel, setRecommendedCtaLabel] = useState('')

  // Phase19-G: 画像品質モード
  const [imageQualityMode, setImageQualityMode] = useState<ImageQualityMode>('high')
  // Phase19-J: 節約モード
  const [costMode, setCostMode] = useState<CostMode>('save')
  const [quotaError, setQuotaError] = useState(false)

  // Phase19-G: QRコード差し替え
  const [qrUploading, setQrUploading] = useState(false)
  const [qrUploadError, setQrUploadError] = useState('')
  const [qrFileName, setQrFileName] = useState('')

  // Phase19-E: スライド画像差し替え中スライドID
  const [slideImageReplacing, setSlideImageReplacing] = useState<number | null>(null)
  const [slideImageReplaceError, setSlideImageReplaceError] = useState<Record<number, string>>({})

  const userUploadedImagesRef = useRef<UserUploadedImage[]>([])

  useEffect(() => {
    userUploadedImagesRef.current = userUploadedImages
  }, [userUploadedImages])

  useEffect(() => {
    return () => {
      userUploadedImagesRef.current.forEach((image) => URL.revokeObjectURL(image.url))
    }
  }, [])

  const handleUserImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    const images = files.map((file) => ({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }))
    setUserUploadedImages((prev) => {
      const combined = [...prev, ...images]
      return combined.slice(0, 14)
    })
  }, [])

  const removeUserUploadedImage = useCallback((id: string) => {
    setUserUploadedImages((prev) => {
      const target = prev.find((image) => image.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((image) => image.id !== id)
    })
  }, [])

  const reorderUserUploadedImage = useCallback((id: string, direction: 'up' | 'down') => {
    setUserUploadedImages((prev) => {
      const idx = prev.findIndex((img) => img.id === id)
      if (idx < 0) return prev
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
      return next
    })
  }, [])

  const handleUserImageDropFiles = useCallback((files: File[]) => {
    const images = files.map((file) => ({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }))
    setUserUploadedImages((prev) => {
      const combined = [...prev, ...images]
      return combined.slice(0, 14)
    })
  }, [])

  // Phase19-E: BGMアップロード
  const handleBgmUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBgmUploading(true)
    setBgmUploadError('')
    try {
      const formData = new FormData()
      formData.append('audio', file)
      const res = await fetch('/api/upload-audio', { method: 'POST', body: formData })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? 'BGMアップロードに失敗しました')
      setBgmFileName(file.name)
    } catch (err) {
      setBgmUploadError(err instanceof Error ? err.message : 'BGMアップロードに失敗しました')
    } finally {
      setBgmUploading(false)
    }
  }, [])

  const handleQrUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setQrUploading(true)
    setQrUploadError('')
    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? 'アップロードに失敗しました')
      const relativePath = (data.url as string).replace('/assets/', '')
      setCtaConfig({ qrImage: relativePath })
      setQrFileName(file.name)
      markDirty()
    } catch (err) {
      setQrUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setQrUploading(false)
    }
  }, [markDirty, setCtaConfig])

  // Phase19-E: スライド画像差し替え
  const handleSlideImageReplace = useCallback(async (slideId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setSlideImageReplacing(slideId)
    setSlideImageReplaceError((prev) => { const next = { ...prev }; delete next[slideId]; return next })
    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? '画像アップロードに失敗しました')
      setSlides((prev) => prev.map((s) => (s.id === slideId ? { ...s, image: data.filename } : s)))
      markDirty()
    } catch (err) {
      setSlideImageReplaceError((prev) => ({ ...prev, [slideId]: err instanceof Error ? err.message : '画像差し替えに失敗しました' }))
    } finally {
      setSlideImageReplacing(null)
    }
  }, [markDirty, setSlides])

  return {
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
  }
}
