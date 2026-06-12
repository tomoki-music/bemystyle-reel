import { useCallback, useEffect, useRef, useState } from 'react'
import type { RenderQueueItem } from './useRenderQueue'
import type { Slide } from '../../types'

const API_SERVER_ERROR = 'APIサーバーに接続できません。npm run editor で起動しているか確認してください。'

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    throw new Error(`${API_SERVER_ERROR}\n\n${text.slice(0, 120)}`)
  }
  return res.json()
}

type RenderUiStatus = 'idle' | 'running' | 'completed' | 'failed'

type HistoryRenderPatch = {
  renderStatus?: 'none' | 'completed' | 'failed'
  renderOutputPath?: string
  renderErrorMessage?: string
  renderVariantName?: string
  renderedAt?: string
}

type UseRenderQueueRunnerOptions = {
  renderQueue: RenderQueueItem[]
  slideCount: number
  hasUnsavedChanges: boolean
  updateQueueItem: (id: string, patch: Partial<RenderQueueItem>) => void
  saveToServer: () => Promise<boolean>
  saveSnapshotToServer: (slides: Slide[]) => Promise<boolean>
  updateLatestHistory: (patch: HistoryRenderPatch) => void
  fetchHistory: () => void
}

export function useRenderQueueRunner({
  renderQueue,
  slideCount,
  hasUnsavedChanges,
  updateQueueItem,
  saveToServer,
  saveSnapshotToServer,
  updateLatestHistory,
  fetchHistory,
}: UseRenderQueueRunnerOptions) {
  const [renderStatus, setRenderStatus] = useState<RenderUiStatus>('idle')
  const [renderError, setRenderError] = useState('')
  const [isPreparingRender, setIsPreparingRender] = useState(false)
  const [renderStartedAt, setRenderStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [latestDownloadUrl, setLatestDownloadUrl] = useState<string | null>(null)
  const [renderVariantName, setRenderVariantName] = useState('')
  const [isBatchRendering, setIsBatchRendering] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/render/status')
        const data = await parseJsonResponse(res)
        const status = data.status as string
        setRenderStatus(status as RenderUiStatus)
        if (status === 'completed' || status === 'failed') {
          stopPolling()
          if (status === 'failed') {
            const errMsg = (data.error as string) ?? '不明なエラー'
            setRenderError(errMsg)
            updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
          }
          if (status === 'completed') {
            fetchHistory()
            const url = data.downloadUrl as string
            if (url) setLatestDownloadUrl(url)
            updateLatestHistory({
              renderStatus: 'completed',
              renderOutputPath: url ?? undefined,
              renderVariantName: renderVariantName.trim() || 'Default',
              renderedAt: new Date().toISOString(),
            })
          }
        }
      } catch (err) {
        stopPolling()
        const errMsg = String(err)
        setRenderStatus('failed')
        setRenderError(errMsg)
        updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
      }
    }, 2000)
  }, [stopPolling, fetchHistory, updateLatestHistory, renderVariantName])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  useEffect(() => {
    const active = isPreparingRender || renderStatus === 'running'
    if (!active || renderStartedAt === null) return
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - renderStartedAt) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [isPreparingRender, renderStatus, renderStartedAt])

  const startRender = useCallback(async () => {
    setRenderError('')
    setRenderStatus('idle')
    setRenderStartedAt(Date.now())
    setElapsedSec(0)

    if (slideCount === 0) {
      setRenderStatus('failed')
      setRenderError('スライドがありません。先にストーリーを生成してください。')
      return
    }

    if (hasUnsavedChanges) {
      setIsPreparingRender(true)
      const ok = await saveToServer()
      setIsPreparingRender(false)
      if (!ok) return
    }

    try {
      const res = await fetch('/api/render', { method: 'POST' })
      const data = await parseJsonResponse(res)
      if (!res.ok) {
        setRenderStatus('failed')
        setRenderError((data.message as string) ?? `HTTP ${res.status}`)
        return
      }
      setRenderStatus('running')
      startPolling()
    } catch (err) {
      setRenderStatus('failed')
      setRenderError(String(err))
    }
  }, [startPolling, hasUnsavedChanges, saveToServer, slideCount])

  const batchRender = useCallback(async (itemIds?: string[]) => {
    const targetIds = itemIds ? new Set(itemIds) : null
    const pending = renderQueue.filter((q) => q.status === 'pending' && (!targetIds || targetIds.has(q.id)))
    if (pending.length === 0 || isBatchRendering) return

    setIsBatchRendering(true)

    // For non-snapshot items, save current slides once upfront if needed
    const hasNonSnapshot = pending.some((q) => !q.slidesSnapshot)
    if (hasNonSnapshot && hasUnsavedChanges) {
      setIsPreparingRender(true)
      const ok = await saveToServer()
      setIsPreparingRender(false)
      if (!ok) {
        setIsBatchRendering(false)
        return
      }
    }

    let snapshotWasUsed = false

    for (const item of pending) {
      // Save snapshot or restore current slides as needed
      if (item.slidesSnapshot) {
        console.log('[Render] snapshot images:', item.slidesSnapshot.map(s => s.image))
        setIsPreparingRender(true)
        const ok = await saveSnapshotToServer(item.slidesSnapshot)
        setIsPreparingRender(false)
        if (!ok) {
          console.error('[Render] saveSnapshotToServer failed for', item.variantName)
          updateQueueItem(item.id, { status: 'failed' })
          updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: 'スナップショットの保存に失敗しました' })
          continue
        }
        snapshotWasUsed = true
      } else if (snapshotWasUsed) {
        // Restore current editor slides before rendering a non-snapshot item
        setIsPreparingRender(true)
        const ok = await saveToServer()
        setIsPreparingRender(false)
        if (!ok) {
          updateQueueItem(item.id, { status: 'failed' })
          updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: 'Slide save failed' })
          continue
        }
        snapshotWasUsed = false
      }

      updateQueueItem(item.id, { status: 'rendering' })
      setRenderVariantName(item.variantName)
      setRenderError('')
      setRenderStatus('idle')
      setRenderStartedAt(Date.now())
      setElapsedSec(0)

      try {
        const res = await fetch('/api/render', { method: 'POST' })
        const data = await parseJsonResponse(res)
        if (!res.ok) throw new Error((data.message as string) ?? `HTTP ${res.status}`)
        setRenderStatus('running')

        const result = await new Promise<{ success: boolean; url?: string; error?: string }>((resolve) => {
          const intId = setInterval(async () => {
            try {
              const sr = await fetch('/api/render/status')
              const sd = await parseJsonResponse(sr)
              const st = sd.status as string
              setRenderStatus(st as RenderUiStatus)
              if (st === 'completed') {
                clearInterval(intId)
                resolve({ success: true, url: sd.downloadUrl as string })
              } else if (st === 'failed') {
                clearInterval(intId)
                resolve({ success: false, error: (sd.error as string) ?? '不明なエラー' })
              }
            } catch (err) {
              clearInterval(intId)
              resolve({ success: false, error: String(err) })
            }
          }, 2000)
        })

        if (result.success) {
          if (result.url) setLatestDownloadUrl(result.url)
          fetchHistory()
          updateQueueItem(item.id, {
            status: 'completed',
            outputPath: result.url,
            renderedAt: new Date().toISOString(),
          })
          updateLatestHistory({
            renderStatus: 'completed',
            renderOutputPath: result.url,
            renderVariantName: item.variantName,
            renderedAt: new Date().toISOString(),
          })
        } else {
          const errMsg = result.error ?? '不明なエラー'
          setRenderError(errMsg)
          updateQueueItem(item.id, { status: 'failed' })
          updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
        }
      } catch (err) {
        const errMsg = String(err)
        setRenderError(errMsg)
        setRenderStatus('failed')
        updateQueueItem(item.id, { status: 'failed' })
        updateLatestHistory({ renderStatus: 'failed', renderErrorMessage: errMsg })
      }
    }

    // Restore current editor slides to server if snapshots dirtied it
    if (snapshotWasUsed) {
      await saveToServer()
    }

    setIsBatchRendering(false)
  }, [renderQueue, isBatchRendering, hasUnsavedChanges, saveToServer, saveSnapshotToServer, updateQueueItem, updateLatestHistory, fetchHistory])

  return {
    batchRender,
    startRender,
    isBatchRendering,
    isPreparingRender,
    renderVariantName,
    setRenderVariantName,
    renderError,
    renderStatus,
    renderStartedAt,
    elapsedSec,
    latestDownloadUrl,
  }
}
