import { useCallback, useState } from 'react'
import type { Slide, SlidesData } from '../../types'

const API_SERVER_ERROR = 'APIサーバーに接続できません。npm run editor で起動しているか確認してください。'

export type HistoryItem = {
  filename: string
  size: number
  createdAt: string
  downloadUrl: string
}

type SaveStatus = 'idle' | 'saving' | 'ok' | 'error'

type UseHistoryManagerOptions = {
  currentSnapshot: SlidesData
  onSaved: () => void
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    throw new Error(`${API_SERVER_ERROR}\n\n${text.slice(0, 120)}`)
  }
  return res.json()
}

export function useHistoryManager({
  currentSnapshot,
  onSaved,
}: UseHistoryManagerOptions) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState('')

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/render/history')
      const data = await res.json()
      if (data.ok) {
        setHistory(data.items as HistoryItem[])
        setHistoryError(false)
      } else {
        setHistoryError(true)
      }
    } catch (_) {
      setHistoryError(true)
    }
  }, [])

  const saveSnapshotToServer = useCallback(async (snapshotSlides: Slide[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentSnapshot.title,
          slides: snapshotSlides,
          cta: currentSnapshot.cta,
        }),
      })
      const body = await parseJsonResponse(res)
      return res.ok && (body as { ok: boolean }).ok
    } catch {
      return false
    }
  }, [currentSnapshot.title, currentSnapshot.cta])

  const saveToServer = useCallback(async (): Promise<boolean> => {
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentSnapshot),
      })
      const body = await parseJsonResponse(res)
      if (!res.ok) throw new Error((body.message as string) ?? `HTTP ${res.status}`)
      setSaveStatus('ok')
      onSaved()
      setTimeout(() => setSaveStatus('idle'), 2500)
      return true
    } catch (err) {
      setSaveError(String(err))
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
      return false
    }
  }, [currentSnapshot, onSaved])

  return {
    history,
    historyError,
    saveStatus,
    saveError,
    fetchHistory,
    saveSnapshotToServer,
    saveToServer,
  }
}
