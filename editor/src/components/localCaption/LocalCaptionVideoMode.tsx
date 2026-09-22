import React, { useMemo, useRef, useState } from 'react'
import { useLocalCaptionVideo } from './useLocalCaptionVideo'
import type { Caption, CaptionType, LocalCaptionJob } from './types'
import './LocalCaptionVideoMode.css'

const CAPTION_TYPE_LABELS: Record<CaptionType, string> = {
  normal: '通常',
  main: 'メイン',
  sub: 'サブ',
  emphasis: '強調',
  heading: '見出し',
  annotation: '注釈',
}

const STATUS_LABELS: Record<LocalCaptionJob['status'], string> = {
  uploaded: '登録済み',
  probing: '動画情報を取得中…',
  extracting_audio: '音声を抽出中…',
  transcribing: '文字起こし中…',
  ready_for_edit: '編集可能',
  rendering: 'レンダー中…',
  completed: '完了',
  failed: '失敗',
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '-'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  return `${mb.toFixed(1)} MB`
}

export function LocalCaptionVideoMode() {
  const {
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
  } = useLocalCaptionVideo()

  const [manualPath, setManualPath] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [newStart, setNewStart] = useState('0')
  const [newEnd, setNewEnd] = useState('2')
  const [newText, setNewText] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ startSec: string; endSec: string; text: string } | null>(null)

  const sortedCaptions = useMemo(() => {
    if (!currentJob) return []
    return [...currentJob.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [currentJob])

  const handleCreateJob = async () => {
    const path = manualPath.trim()
    if (!path) {
      setError('動画ファイルの絶対パスを入力してください')
      return
    }
    await createJob(path, titleInput.trim() || undefined)
  }

  const handlePickBrowseEntry = (path: string, isDirectory: boolean) => {
    if (isDirectory) {
      browse(path)
    } else {
      setManualPath(path)
    }
  }

  const seekTo = (sec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = sec
      videoRef.current.play().catch(() => {})
    }
  }

  const handleAddCaption = async () => {
    if (!currentJob) return
    const s = Number(newStart)
    const e = Number(newEnd)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      setError('終了時刻は開始時刻より後にしてください')
      return
    }
    if (!newText.trim()) {
      setError('テキストを入力してください')
      return
    }
    const ok = await addCaption(currentJob.id, s, e, newText.trim())
    if (ok) {
      setNewText('')
      setNewStart(String(e))
      setNewEnd(String(e + 2))
    }
  }

  const startEdit = (c: Caption) => {
    setEditingId(c.id)
    setEditDraft({ startSec: String(c.startSec), endSec: String(c.endSec), text: c.text })
  }

  const saveEdit = async (jobId: string, captionId: string) => {
    if (!editDraft) return
    const s = Number(editDraft.startSec)
    const e = Number(editDraft.endSec)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      setError('終了時刻は開始時刻より後にしてください')
      return
    }
    const ok = await updateCaption(jobId, captionId, { startSec: s, endSec: e, text: editDraft.text.trim() })
    if (ok) {
      setEditingId(null)
      setEditDraft(null)
    }
  }

  const moveCaption = async (jobId: string, index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= sortedCaptions.length) return
    const ids = sortedCaptions.map((c) => c.id)
    const next = [...ids]
    ;[next[index], next[target]] = [next[target], next[index]]
    await reorderCaptions(jobId, next)
  }

  const renderDisabledReason = (): string | null => {
    if (!currentJob) return 'ジョブが選択されていません'
    if (currentJob.captions.length === 0) return '字幕が1件もありません'
    if (currentJob.status === 'rendering') return 'レンダー中です'
    if (currentJob.status === 'extracting_audio' || currentJob.status === 'transcribing' || currentJob.status === 'probing') {
      return '処理中はレンダーできません'
    }
    return null
  }

  const renderDisabled = renderDisabledReason()

  return (
    <div className="lcv-page">
      <header className="lcv-header">
        <h1>ローカルAIテロップ動画（β）</h1>
        <p className="lcv-subtitle">
          ローカルの動画ファイルを指定して、AI文字起こし字幕を焼き込んだMP4を出力します。動画本体はアップロードされません。
        </p>
      </header>

      {error && (
        <div className="lcv-banner lcv-banner--error">
          {error}
          <button type="button" onClick={() => setError(null)}>×</button>
        </div>
      )}
      {fontWarning && (
        <div className="lcv-banner lcv-banner--warn">
          フォント警告: {fontWarning}
        </div>
      )}

      <div className="lcv-layout">
        <aside className="lcv-sidebar">
          <section className="lcv-panel">
            <h2>動画ソースを選択</h2>
            <div className="lcv-roots">
              <strong>許可フォルダ:</strong>
              {inputRoots.length === 0 && <p className="lcv-muted">VIDEO_INPUT_ROOTS が未設定です</p>}
              <ul>
                {inputRoots.map((r) => (
                  <li key={r.path} className={r.available ? '' : 'lcv-muted'}>
                    {r.path} {!r.available && '(未検出)'}
                  </li>
                ))}
              </ul>
              <strong>出力フォルダ:</strong>{' '}
              {outputRoot ? (outputRoot.available ? outputRoot.path : `${outputRoot.path} (未検出)`) : '未設定'}
            </div>

            <div className="lcv-browser">
              <div className="lcv-browser__path">
                {browsePath ? browsePath : '許可フォルダ一覧'}
                {browsePath && (
                  <button type="button" onClick={() => browse(null)}>ルートへ戻る</button>
                )}
              </div>
              {browseLoading ? (
                <p className="lcv-muted">読み込み中…</p>
              ) : (
                <ul className="lcv-browser__list">
                  {browseEntries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={entry.isDirectory ? 'lcv-entry lcv-entry--dir' : 'lcv-entry lcv-entry--file'}
                        onClick={() => handlePickBrowseEntry(entry.path, entry.isDirectory)}
                      >
                        {entry.isDirectory ? '📁' : '🎬'} {entry.name}
                        {!entry.isDirectory && entry.size != null && (
                          <span className="lcv-muted"> ({formatBytes(entry.size)})</span>
                        )}
                      </button>
                    </li>
                  ))}
                  {browseEntries.length === 0 && <li className="lcv-muted">項目がありません</li>}
                </ul>
              )}
            </div>

            <label className="lcv-field">
              動画ファイルの絶対パス
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/Users/you/Movies/sample.mp4"
              />
            </label>
            <label className="lcv-field">
              タイトル（任意）
              <input type="text" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} />
            </label>
            <button type="button" disabled={loading} onClick={handleCreateJob}>
              {loading ? '作成中…' : 'この動画でジョブを作成'}
            </button>
          </section>

          <section className="lcv-panel">
            <h2>ジョブ一覧</h2>
            <ul className="lcv-job-list">
              {jobs.map((j) => (
                <li key={j.id} className={currentJob?.id === j.id ? 'lcv-job-list__item lcv-job-list__item--active' : 'lcv-job-list__item'}>
                  <button type="button" onClick={() => selectJob(j.id)}>
                    <div className="lcv-job-list__title">{j.title}</div>
                    <div className="lcv-muted">{STATUS_LABELS[j.status]}</div>
                  </button>
                  <button type="button" className="lcv-danger" onClick={() => deleteJob(j.id)}>削除</button>
                </li>
              ))}
              {jobs.length === 0 && <li className="lcv-muted">ジョブはまだありません</li>}
            </ul>
          </section>
        </aside>

        <main className="lcv-main">
          {!currentJob ? (
            <p className="lcv-muted">左のフォームから動画を選び、ジョブを作成してください。</p>
          ) : (
            <>
              <section className="lcv-panel">
                <h2>{currentJob.title}</h2>
                <div className="lcv-status-row">
                  <span className={`lcv-status lcv-status--${currentJob.status}`}>{STATUS_LABELS[currentJob.status]}</span>
                  {typeof currentJob.renderProgress === 'number' && currentJob.status === 'rendering' && (
                    <span> {currentJob.renderProgress}%</span>
                  )}
                </div>
                {currentJob.errorMessage && <p className="lcv-error-text">{currentJob.errorMessage}</p>}
                {currentJob.transcriptionNote && <p className="lcv-warn-text">{currentJob.transcriptionNote}</p>}

                {currentJob.status === 'failed' && currentJob.durationSec === null && (
                  <button type="button" onClick={() => reprobe(currentJob.id)}>動画情報を再取得</button>
                )}

                {currentJob.durationSec !== null && (
                  <dl className="lcv-meta">
                    <dt>長さ</dt><dd>{formatTime(currentJob.durationSec)}</dd>
                    <dt>解像度</dt><dd>{currentJob.width}×{currentJob.height}（回転補正後 / rotation={currentJob.rotation}°）</dd>
                    <dt>コーデック</dt><dd>video={currentJob.videoCodec} / audio={currentJob.audioCodec ?? 'なし'}</dd>
                    <dt>コンテナ</dt><dd>{currentJob.container}</dd>
                    <dt>音声</dt><dd>{currentJob.hasAudio ? 'あり' : 'なし'}</dd>
                    <dt>サイズ</dt><dd>{formatBytes(currentJob.sourceSize)}</dd>
                  </dl>
                )}

                {currentJob.hasAudio === true && (currentJob.status === 'ready_for_edit' || currentJob.status === 'failed') && (
                  <button type="button" onClick={() => startProcessing(currentJob.id)}>
                    文字起こしを開始（音声抽出 + Whisper）
                  </button>
                )}
              </section>

              <section className="lcv-panel">
                <h2>プレビュー</h2>
                <video
                  ref={videoRef}
                  className="lcv-video"
                  controls
                  src={`/api/local-caption-videos/${currentJob.id}/source-stream`}
                />
                {currentJob.status === 'completed' && currentJob.outputPath && (
                  <div className="lcv-output">
                    <p>出力先: {currentJob.outputPath}</p>
                    <a
                      href={`/api/local-caption-videos/${currentJob.id}/output-stream`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      レンダー結果を再生/ダウンロード
                    </a>
                  </div>
                )}
              </section>

              <section className="lcv-panel">
                <h2>字幕（{sortedCaptions.length}件）</h2>
                <button type="button" onClick={() => resetCaptionTypes(currentJob.id)} disabled={sortedCaptions.length === 0}>
                  全てを「通常」に戻す
                </button>

                <ul className="lcv-caption-list">
                  {sortedCaptions.map((c, index) => (
                    <li key={c.id} className="lcv-caption-item">
                      {editingId === c.id && editDraft ? (
                        <div className="lcv-caption-edit">
                          <input
                            type="number"
                            step="0.1"
                            value={editDraft.startSec}
                            onChange={(e) => setEditDraft({ ...editDraft, startSec: e.target.value })}
                          />
                          <input
                            type="number"
                            step="0.1"
                            value={editDraft.endSec}
                            onChange={(e) => setEditDraft({ ...editDraft, endSec: e.target.value })}
                          />
                          <textarea
                            value={editDraft.text}
                            onChange={(e) => setEditDraft({ ...editDraft, text: e.target.value })}
                          />
                          <button type="button" onClick={() => saveEdit(currentJob.id, c.id)}>保存</button>
                          <button type="button" onClick={() => { setEditingId(null); setEditDraft(null) }}>キャンセル</button>
                        </div>
                      ) : (
                        <>
                          <button type="button" className="lcv-caption-time" onClick={() => seekTo(c.startSec)}>
                            {formatTime(c.startSec)} - {formatTime(c.endSec)}
                          </button>
                          <span className="lcv-caption-type">{CAPTION_TYPE_LABELS[c.captionType]}</span>
                          <span className="lcv-caption-text">{c.text}</span>
                          <div className="lcv-caption-actions">
                            <button type="button" onClick={() => moveCaption(currentJob.id, index, -1)} disabled={index === 0}>↑</button>
                            <button type="button" onClick={() => moveCaption(currentJob.id, index, 1)} disabled={index === sortedCaptions.length - 1}>↓</button>
                            <button type="button" onClick={() => startEdit(c)}>編集</button>
                            <button type="button" className="lcv-danger" onClick={() => deleteCaption(currentJob.id, c.id)}>削除</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                  {sortedCaptions.length === 0 && <li className="lcv-muted">字幕はまだありません</li>}
                </ul>

                <div className="lcv-caption-add">
                  <h3>字幕を追加</h3>
                  <div className="lcv-caption-add__row">
                    <label>
                      開始(秒)
                      <input type="number" step="0.1" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
                    </label>
                    <label>
                      終了(秒)
                      <input type="number" step="0.1" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
                    </label>
                  </div>
                  <textarea
                    placeholder="字幕テキスト"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                  />
                  <button type="button" onClick={handleAddCaption}>追加</button>
                </div>
              </section>

              <section className="lcv-panel">
                <h2>動画を生成</h2>
                {currentJob.status === 'rendering' ? (
                  <button type="button" className="lcv-danger" onClick={() => cancelRender(currentJob.id)}>
                    レンダーをキャンセル
                  </button>
                ) : (
                  <button type="button" disabled={Boolean(renderDisabled)} onClick={() => startRender(currentJob.id)}>
                    字幕を焼き込んで動画を生成
                  </button>
                )}
                {renderDisabled && currentJob.status !== 'rendering' && (
                  <p className="lcv-muted">理由: {renderDisabled}</p>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
