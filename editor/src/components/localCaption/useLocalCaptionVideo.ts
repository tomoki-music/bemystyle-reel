import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiResult, BrowseEntry, CaptionType, LocalCaptionJob, RootInfo } from './types'

const API_BASE = '/api/local-caption-videos'
const POLL_INTERVAL_MS = 1500
const IN_PROGRESS_STATUSES = new Set(['probing', 'extracting_audio', 'transcribing', 'rendering'])

async function apiFetch<T = ApiResult<unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
  })
  const data = (await res.json().catch(() => ({ ok: false, message: 'サーバー応答の解析に失敗しました' }))) as T
  return data
}

export function useLocalCaptionVideo() {
  const [jobs, setJobs] = useState<LocalCaptionJob[]>([])
  const [currentJob, setCurrentJob] = useState<LocalCaptionJob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fontWarning, setFontWarning] = useState<string | null>(null)

  const [inputRoots, setInputRoots] = useState<RootInfo[]>([])
  const [outputRoot, setOutputRoot] = useState<RootInfo | null>(null)
  const [browsePath, setBrowsePath] = useState<string | null>(null)
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshJobs = useCallback(async () => {
    const data = await apiFetch<ApiResult<unknown>>('')
    if (data.ok && data.jobs) setJobs(data.jobs)
  }, [])

  const loadRoots = useCallback(async () => {
    const data = await apiFetch<ApiResult<unknown>>('/roots')
    if (data.ok) {
      setInputRoots(data.inputRoots ?? [])
      setOutputRoot(data.outputRoot ?? null)
    }
  }, [])

  const browse = useCallback(async (path?: string | null) => {
    setBrowseLoading(true)
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : ''
      const data = await apiFetch<ApiResult<unknown>>(`/browse${query}`)
      if (data.ok) {
        setBrowsePath((data.path as string | null) ?? null)
        setBrowseEntries(data.entries ?? [])
      } else {
        setError(data.message ?? 'フォルダの読み込みに失敗しました')
      }
    } finally {
      setBrowseLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRoots()
    refreshJobs()
    browse(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchJob = useCallback(async (jobId: string) => {
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}`)
    if (data.ok && data.job) setCurrentJob(data.job)
    return data.job ?? null
  }, [])

  // ── ポーリング: 処理中ステータスの間だけ定期的にジョブを再取得する ──
  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (currentJob && IN_PROGRESS_STATUSES.has(currentJob.status)) {
      pollTimerRef.current = setInterval(() => {
        fetchJob(currentJob.id)
      }, POLL_INTERVAL_MS)
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJob?.id, currentJob?.status])

  const createJob = useCallback(async (sourcePath: string, title?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<ApiResult<unknown>>('', {
        method: 'POST',
        body: JSON.stringify({ sourcePath, title }),
      })
      if (!data.ok) {
        setError(data.message ?? 'ジョブの作成に失敗しました')
        if (data.job) setCurrentJob(data.job) // 失敗ジョブでもプレビューできるようセットする
        return null
      }
      setCurrentJob(data.job ?? null)
      refreshJobs()
      return data.job ?? null
    } finally {
      setLoading(false)
    }
  }, [refreshJobs])

  const selectJob = useCallback(async (jobId: string) => {
    setError(null)
    await fetchJob(jobId)
  }, [fetchJob])

  const deleteJob = useCallback(async (jobId: string) => {
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}`, { method: 'DELETE' })
    if (!data.ok) {
      setError(data.message ?? '削除に失敗しました')
      return false
    }
    if (currentJob?.id === jobId) setCurrentJob(null)
    refreshJobs()
    return true
  }, [currentJob, refreshJobs])

  const startProcessing = useCallback(async (jobId: string) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/start-processing`, { method: 'POST' })
    if (!data.ok) {
      setError(data.message ?? '文字起こしの開始に失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    return true
  }, [])

  const reprobe = useCallback(async (jobId: string) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/reprobe`, { method: 'POST' })
    if (!data.ok) {
      setError(data.message ?? '動画情報の再取得に失敗しました')
    }
    if (data.job) setCurrentJob(data.job)
    return data.ok
  }, [])

  const addCaption = useCallback(async (jobId: string, startSec: number, endSec: number, text: string, captionType: CaptionType = 'normal') => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/captions`, {
      method: 'POST',
      body: JSON.stringify({ startSec, endSec, text, captionType }),
    })
    if (!data.ok) {
      setError(data.message ?? '字幕の追加に失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    return true
  }, [])

  const updateCaption = useCallback(async (jobId: string, captionId: string, patch: Partial<{ startSec: number; endSec: number; text: string; captionType: CaptionType }>) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/captions/${captionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!data.ok) {
      setError(data.message ?? '字幕の更新に失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    return true
  }, [])

  const deleteCaption = useCallback(async (jobId: string, captionId: string) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/captions/${captionId}`, { method: 'DELETE' })
    if (!data.ok) {
      setError(data.message ?? '字幕の削除に失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    return true
  }, [])

  const reorderCaptions = useCallback(async (jobId: string, orderedIds: string[]) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/captions/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    })
    if (!data.ok) {
      setError(data.message ?? '並び替えに失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    return true
  }, [])

  const resetCaptionTypes = useCallback(async (jobId: string) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/captions/reset-types`, { method: 'POST' })
    if (!data.ok) {
      setError(data.message ?? 'リセットに失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    return true
  }, [])

  const startRender = useCallback(async (jobId: string) => {
    setError(null)
    setFontWarning(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/render`, { method: 'POST' })
    if (!data.ok) {
      setError(data.message ?? 'レンダーの開始に失敗しました')
      return false
    }
    if (data.job) setCurrentJob(data.job)
    if (data.fontWarning) setFontWarning(String(data.fontWarning))
    return true
  }, [])

  const cancelRender = useCallback(async (jobId: string) => {
    setError(null)
    const data = await apiFetch<ApiResult<unknown>>(`/${jobId}/render/cancel`, { method: 'POST' })
    if (!data.ok) {
      setError(data.message ?? 'キャンセルに失敗しました')
      return false
    }
    return true
  }, [])

  return {
    jobs,
    currentJob,
    loading,
    error,
    setError,
    fontWarning,
    inputRoots,
    outputRoot,
    browsePath,
    browseEntries,
    browseLoading,
    browse,
    refreshJobs,
    createJob,
    selectJob,
    deleteJob,
    startProcessing,
    reprobe,
    addCaption,
    updateCaption,
    deleteCaption,
    reorderCaptions,
    resetCaptionTypes,
    startRender,
    cancelRender,
  }
}
