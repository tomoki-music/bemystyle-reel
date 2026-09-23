import { useEffect, useState } from 'react'

export interface OutputFileInfo {
  durationSec: number
  sizeBytes: number
}

const API_BASE = '/api/local-caption-videos'

/**
 * 完成動画/プレビュー動画の実際の長さ・サイズをサーバー(ffprobe/stat)から取得する。
 * kind: 'output' = 完成動画, 'preview' = 短時間プレビュー。
 * 絶対パスは扱わない（durationSec / sizeBytes のみ）。
 * enabled=false、または dependencyKey が変わるたびに再取得する。
 */
export function useOutputFileInfo(
  jobId: string | null,
  kind: 'output' | 'preview',
  enabled: boolean,
  dependencyKey: string | null | undefined,
): OutputFileInfo | null {
  const [info, setInfo] = useState<OutputFileInfo | null>(null)

  useEffect(() => {
    setInfo(null)
    if (!jobId || !enabled) return
    let canceled = false
    fetch(`${API_BASE}/${jobId}/${kind}-info`)
      .then((r) => r.json())
      .then((data) => {
        if (canceled || !data?.ok) return
        setInfo({ durationSec: data.durationSec, sizeBytes: data.sizeBytes })
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [jobId, kind, enabled, dependencyKey])

  return info
}

export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) return '-'
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.round(totalSec - h * 3600 - m * 60)
  const carry = s === 60 ? 1 : 0
  const secs = carry ? 0 : s
  const mins = m + carry
  return h > 0
    ? `${h}時間${mins}分${secs}秒`
    : mins > 0
      ? `${mins}分${String(secs).padStart(2, '0')}秒`
      : `${secs}秒`
}
