import React, { useMemo, useRef, useState } from 'react'
import { useLocalCaptionVideo } from './useLocalCaptionVideo'
import { useOutputFileInfo } from './useOutputFileInfo'
import { SourceVideoPanel, PreviewVideoPanel, FinalVideoPanel } from './VideoPanels'
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
    classifying,
    classifyCaptions,
    previewRendering,
    renderPreview,
  } = useLocalCaptionVideo()

  const [manualPath, setManualPath] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [newStart, setNewStart] = useState('0')
  const [newEnd, setNewEnd] = useState('2')
  const [newText, setNewText] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ startSec: string; endSec: string; text: string; captionType: CaptionType } | null>(null)
  const [typeFilter, setTypeFilter] = useState<CaptionType | 'all'>('all')

  const sortedCaptions = useMemo(() => {
    if (!currentJob) return []
    return [...currentJob.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [currentJob])

  const typeCounts = useMemo(() => {
    const counts: Record<CaptionType, number> = { normal: 0, main: 0, sub: 0, emphasis: 0, heading: 0, annotation: 0 }
    for (const c of sortedCaptions) counts[c.captionType] = (counts[c.captionType] ?? 0) + 1
    return counts
  }, [sortedCaptions])

  const filteredCaptions = useMemo(() => {
    if (typeFilter === 'all') return sortedCaptions
    return sortedCaptions.filter((c) => c.captionType === typeFilter)
  }, [sortedCaptions, typeFilter])

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
    setEditDraft({ startSec: String(c.startSec), endSec: String(c.endSec), text: c.text, captionType: c.captionType })
  }

  const saveEdit = async (jobId: string, captionId: string) => {
    if (!editDraft) return
    const s = Number(editDraft.startSec)
    const e = Number(editDraft.endSec)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      setError('終了時刻は開始時刻より後にしてください')
      return
    }
    const ok = await updateCaption(jobId, captionId, {
      startSec: s,
      endSec: e,
      text: editDraft.text.trim(),
      captionType: editDraft.captionType,
    })
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

  const handleClassify = async () => {
    if (!currentJob) return
    const already = currentJob.captionClassification
    const confirmMessage = already
      ? `このジョブは既にAI分類済みです（モデル: ${already.model} / ${new Date(already.classifiedAt).toLocaleString()}）。\n再実行するとOpenAI APIに再度課金が発生し、既存の分類結果は上書きされます。続行しますか？`
      : `${sortedCaptions.length}件の字幕をAIでcaptionType（通常/メイン/サブ/強調/見出し/注釈）に自動分類します。OpenAI APIが呼び出されます。続行しますか？`
    if (!window.confirm(confirmMessage)) return

    const result = await classifyCaptions(currentJob.id, Boolean(already))
    if (result.ok) {
      window.alert(`AI分類が完了しました（${result.totalBatches}バッチ / ${result.requestCount}リクエスト）`)
    }
    // 失敗時はclassifyCaptions内でエラー表示済み。既存のcaptionTypeはサーバー側で変更されていない。
  }

  const handlePreviewRender = async () => {
    if (!currentJob) return
    const result = await renderPreview(currentJob.id)
    if (result.ok && result.previewWindow?.synthetic) {
      window.alert('main/sub/emphasisを含む30〜60秒の区間が実データから見つからなかったため、プレビュー専用のダミーデータでレンダリングしました。')
    }
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

  // 実ファイルの長さ・サイズ（完成動画/プレビューの区別表示用）
  const outputInfo = useOutputFileInfo(
    currentJob?.id ?? null,
    'output',
    Boolean(currentJob && currentJob.status === 'completed' && currentJob.outputPath),
    currentJob?.renderedAt,
  )
  const previewInfo = useOutputFileInfo(
    currentJob?.id ?? null,
    'preview',
    Boolean(currentJob?.previewOutputPath),
    currentJob?.previewRenderedAt,
  )

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

              <SourceVideoPanel jobId={currentJob.id} videoRef={videoRef} />

              {currentJob.status === 'completed' && currentJob.outputPath && (
                <FinalVideoPanel jobId={currentJob.id} outputInfo={outputInfo} />
              )}

              <section className="lcv-panel">
                <h2>字幕（{sortedCaptions.length}件）</h2>

                <div className="lcv-classify-row">
                  <button type="button" onClick={handleClassify} disabled={classifying || sortedCaptions.length === 0}>
                    {classifying ? 'AI分類中…' : 'AIで自動分類'}
                  </button>
                  <button type="button" onClick={() => resetCaptionTypes(currentJob.id)} disabled={sortedCaptions.length === 0}>
                    全てを「通常」に戻す
                  </button>
                  {currentJob.captionClassification && (
                    <span className="lcv-muted">
                      分類済み: {currentJob.captionClassification.model} / {new Date(currentJob.captionClassification.classifiedAt).toLocaleString()}
                      （{currentJob.captionClassification.batchCount}バッチ）
                    </span>
                  )}
                </div>

                <div className="lcv-caption-typecounts">
                  {(Object.keys(CAPTION_TYPE_LABELS) as CaptionType[]).map((type) => (
                    <span key={type} className="lcv-caption-typecount">
                      {CAPTION_TYPE_LABELS[type]}: {typeCounts[type]}
                    </span>
                  ))}
                </div>

                <label className="lcv-field lcv-field--inline">
                  種別で絞り込み
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as CaptionType | 'all')}>
                    <option value="all">すべて（{sortedCaptions.length}）</option>
                    {(Object.keys(CAPTION_TYPE_LABELS) as CaptionType[]).map((type) => (
                      <option key={type} value={type}>{CAPTION_TYPE_LABELS[type]}（{typeCounts[type]}）</option>
                    ))}
                  </select>
                </label>

                <ul className="lcv-caption-list">
                  {filteredCaptions.map((c) => {
                    const index = sortedCaptions.findIndex((sc) => sc.id === c.id)
                    return (
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
                          <select
                            value={editDraft.captionType}
                            onChange={(e) => setEditDraft({ ...editDraft, captionType: e.target.value as CaptionType })}
                          >
                            {(Object.keys(CAPTION_TYPE_LABELS) as CaptionType[]).map((type) => (
                              <option key={type} value={type}>{CAPTION_TYPE_LABELS[type]}</option>
                            ))}
                          </select>
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
                    )
                  })}
                  {filteredCaptions.length === 0 && <li className="lcv-muted">該当する字幕はありません</li>}
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

              <section className="lcv-panel lcv-panel--preview">
                <h2>
                  <span className="lcv-badge lcv-badge--preview">プレビュー</span>
                  短時間プレビュー（完成動画ではありません）
                </h2>
                <p className="lcv-muted">captionType別デザインの確認用に、main/sub/emphasisを含む30〜60秒だけを字幕焼き込みして確認します。動画全体ではなく、一部の区間だけです。</p>
                <button type="button" onClick={handlePreviewRender} disabled={previewRendering || sortedCaptions.length === 0}>
                  {previewRendering ? 'プレビュー生成中…' : '短時間プレビューを生成'}
                </button>
                {currentJob.previewOutputPath && currentJob.previewWindow && (
                  <PreviewVideoPanel jobId={currentJob.id} previewWindow={currentJob.previewWindow} previewInfo={previewInfo} />
                )}
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
