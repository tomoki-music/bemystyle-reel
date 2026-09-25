import React from 'react'
import { formatDuration, type OutputFileInfo } from './useOutputFileInfo'
import type { PreviewWindow } from './types'

// 元動画 / 短時間プレビュー / 完成動画 を、見出し・色・枠で明確に区別して表示する。
// ユーザーが30秒プレビューを完成動画と誤認しないための表示専用コンポーネント。
// 絶対パスやAPIキーは扱わない（APIのストリームURLのみ）。

const API_BASE = '/api/local-caption-videos'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '-'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function SourceVideoPanel({
  jobId,
  videoRef,
}: {
  jobId: string
  videoRef?: React.Ref<HTMLVideoElement>
}) {
  return (
    <section className="lcv-panel lcv-panel--source" data-testid="source-video-panel">
      <h2>
        <span className="lcv-badge lcv-badge--source">元動画</span>
        元動画（テロップ焼き込み前）
      </h2>
      <p className="lcv-muted">元の動画をそのまま再生しています。字幕は表示されません。</p>
      <video ref={videoRef} className="lcv-video" controls src={`${API_BASE}/${jobId}/source-stream`} />
    </section>
  )
}

export function PreviewVideoPanel({
  jobId,
  previewWindow,
  previewInfo,
}: {
  jobId: string
  previewWindow: PreviewWindow
  previewInfo: OutputFileInfo | null
}) {
  const shown = previewInfo ? previewInfo.durationSec : previewWindow.endSec - previewWindow.startSec
  return (
    <div className="lcv-output" data-testid="preview-video-block">
      <p>
        <strong>実際のプレビュー時間: {formatDuration(shown)}</strong>
        {' / '}
        元動画の区間: {formatClock(previewWindow.startSec)} - {formatClock(previewWindow.endSec)}
        {previewWindow.synthetic && '（該当区間が無かったためダミーデータを使用）'}
      </p>
      <video controls className="lcv-video lcv-video--preview" src={`${API_BASE}/${jobId}/preview-stream`} />
    </div>
  )
}

export function FinalVideoPanel({ jobId, outputInfo }: { jobId: string; outputInfo: OutputFileInfo | null }) {
  const src = `${API_BASE}/${jobId}/output-stream`
  return (
    <section className="lcv-panel lcv-panel--final" data-testid="final-video-panel">
      <h2>
        <span className="lcv-badge lcv-badge--final">完成</span>
        完成動画（フルバージョン）
      </h2>
      <dl className="lcv-meta">
        <dt>動画の長さ</dt>
        <dd>{outputInfo ? formatDuration(outputInfo.durationSec) : '取得中…'}</dd>
        <dt>ファイルサイズ</dt>
        <dd>{outputInfo ? formatBytes(outputInfo.sizeBytes) : '取得中…'}</dd>
      </dl>
      <video className="lcv-video lcv-video--final" controls preload="metadata" src={src} />
      <div className="lcv-output">
        <a className="lcv-download" href={src} download="caption-video.mp4">
          完成動画をダウンロード
        </a>
        <p className="lcv-muted">
          Finderで確認するには、設定した出力フォルダ（VIDEO_OUTPUT_ROOT）を開き、
          video_ から始まるMP4ファイルを探してください。
        </p>
      </div>
    </section>
  )
}
