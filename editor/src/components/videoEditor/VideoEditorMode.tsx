import React, { useState, useRef, useCallback, useEffect } from 'react'
import type { CaptionAnimation, CaptionCustomStyle, CaptionSegment, CaptionTemplate, TemplateExportFile, VideoEditorProject, VideoProject } from '../../types'

const PROJECT_STORAGE_KEY = 'video-editor-project'
const TEMPLATE_STORAGE_KEY = 'video-editor-caption-templates'
import './VideoEditorMode.css'

const SOUND_EFFECTS = ['none', 'pop', 'ding', 'whoosh', 'impact'] as const
type SoundEffectKey = typeof SOUND_EFFECTS[number]

const SOUND_EFFECT_LABELS: Record<SoundEffectKey, string> = {
  none: 'None',
  pop: 'Pop',
  ding: 'Ding',
  whoosh: 'Whoosh',
  impact: 'Impact',
}

function playSoundEffect(effect: string, volume = 0.7): void {
  if (!effect || effect === 'none') return
  const vol = Math.max(0, Math.min(1, volume))
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  const ctx = new AudioCtx()

  switch (effect) {
    case 'pop': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(800, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.12)
      gain.gain.setValueAtTime(0.3 * vol, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15)
      break
    }
    case 'ding': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(1047, ctx.currentTime)
      gain.gain.setValueAtTime(0.3 * vol, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5)
      break
    }
    case 'whoosh': {
      const sr = ctx.sampleRate
      const bufLen = Math.floor(sr * 0.3)
      const buf = ctx.createBuffer(1, bufLen, sr)
      const data = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen)
      const src = ctx.createBufferSource()
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(300, ctx.currentTime)
      filter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.3)
      src.buffer = buf
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.35 * vol, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      src.start(ctx.currentTime)
      break
    }
    case 'impact': {
      const sr = ctx.sampleRate
      const bufLen = Math.floor(sr * 0.12)
      const buf = ctx.createBuffer(1, bufLen, sr)
      const data = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.08))
      const src = ctx.createBufferSource()
      const gain = ctx.createGain()
      src.buffer = buf
      src.connect(gain); gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.5 * vol, ctx.currentTime)
      src.start(ctx.currentTime)
      break
    }
    default: break
  }

  setTimeout(() => { void ctx.close() }, 1200)
}

const CAPTION_TEMPLATES: CaptionTemplate[] = [
  {
    id: 'business',
    name: '💼 Business',
    animation: 'pop',
    position: 'bottom',
    customStyle: { fontSize: 42, color: '#ffffff', bgColor: '#000000', bold: true, shadow: false },
  },
  {
    id: 'tiktok',
    name: '🔥 TikTok',
    animation: 'slideUp',
    position: 'middle',
    customStyle: { fontSize: 48, color: '#ffff00', bgColor: '#000000', bold: true, shadow: true },
  },
  {
    id: 'interview',
    name: '🎤 Interview',
    animation: 'fade',
    position: 'bottom',
    customStyle: { fontSize: 36, color: '#ffffff', bold: false, shadow: false },
  },
]

const STEPS = [
  { num: 1, label: '動画' },
  { num: 2, label: 'コンセプト' },
  { num: 3, label: 'プロジェクト' },
]

const CONCEPT_EXAMPLES = [
  '歌が上手くなる方法・初心者向け・60秒',
  'ボイトレ体験談・感動系・45秒',
  'MMMイベント告知・バズ系・30秒',
]

interface VideoEditorModeProps {
  onClose?: () => void
}

export function VideoEditorMode({ onClose }: VideoEditorModeProps) {
  const [step, setStep] = useState(1)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [concept, setConcept] = useState('')
  const [project, setProject] = useState<VideoProject | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleVideoChange = useCallback(async (file: File | null) => {
    if (!file) return
    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('video', file)
      const res = await fetch('/api/upload-video', { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; url?: string; message?: string }
      if (!data.ok || !data.url) throw new Error(data.message ?? 'アップロードに失敗しました')
      setVideoUrl(data.url)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : '動画のアップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }, [])

  const handleCreateProject = useCallback(() => {
    if (!videoUrl) return
    const newProject: VideoProject = {
      id: `vp-${Date.now()}`,
      videoUrl,
      concept: concept.trim() || undefined,
    }
    setProject(newProject)
    setStep(3)
  }, [videoUrl, concept])

  const handleCaptionsUpdate = useCallback((captions: CaptionSegment[]) => {
    setProject(prev => prev ? { ...prev, captions } : prev)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('video/')) void handleVideoChange(file)
  }, [handleVideoChange])

  return (
    <div className="ve-overlay">
      <header className="ve-header">
        <div className="ve-header-inner">
          <div className="ve-logo">
            <div className="ve-logo-icon">✂</div>
            <span className="ve-logo-name">動画エディター</span>
          </div>

          <nav className="ve-progress" aria-label="作成ステップ">
            {STEPS.map((s, i) => {
              const state_ = step > s.num ? 'done' : step === s.num ? 'active' : 'future'
              return (
                <React.Fragment key={s.num}>
                  {i > 0 && (
                    <div className={`ve-progress-connector${step > s.num ? ' ve-progress-connector--done' : ''}`} />
                  )}
                  <div className={`ve-progress-step ve-progress-step--${state_}`}>
                    <div className="ve-progress-circle">
                      {state_ === 'done' ? '✓' : s.num}
                    </div>
                    <span className="ve-progress-label">{s.label}</span>
                  </div>
                </React.Fragment>
              )
            })}
          </nav>

          <div className="ve-header-right">
            {onClose && (
              <button className="ve-exit-btn" onClick={onClose}>
                ← ウィザードに戻る
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="ve-main">
        <div className="ve-content">
          {step === 1 && (
            <VeStep1
              videoUrl={videoUrl}
              uploading={uploading}
              uploadError={uploadError}
              fileInputRef={fileInputRef}
              onFileChange={(f) => { void handleVideoChange(f) }}
              onDrop={handleDrop}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <VeStep2
              concept={concept}
              onConceptChange={setConcept}
              onBack={() => setStep(1)}
              onNext={handleCreateProject}
            />
          )}
          {step === 3 && project && (
            <VeStep3
              project={project}
              onClose={onClose}
              onBack={() => setStep(2)}
              onCaptionsUpdate={handleCaptionsUpdate}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ── Step 1: 動画アップロード ──────────────────────────────

function VeStep1({
  videoUrl,
  uploading,
  uploadError,
  fileInputRef,
  onFileChange,
  onDrop,
  onNext,
}: {
  videoUrl: string | null
  uploading: boolean
  uploadError: string | null
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>
  onFileChange: (f: File | null) => void
  onDrop: (e: React.DragEvent) => void
  onNext: () => void
}) {
  return (
    <div className="ve-step">
      <div className="ve-step-heading">
        <h1>動画をアップロードしましょう</h1>
        <p>編集したい撮影済み動画を選んでください。</p>
      </div>

      <div
        className={`ve-upload-zone${videoUrl ? ' ve-upload-zone--filled' : ''}${uploading ? ' ve-upload-zone--uploading' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => {
          if (!videoUrl && !uploading) {
            const el = fileInputRef.current
            if (el) { el.value = ''; el.click() }
          }
        }}
      >
        {uploading ? (
          <div className="ve-upload-spinner-wrap">
            <div className="ve-spinner" />
            <p className="ve-upload-status">アップロード中...</p>
          </div>
        ) : videoUrl ? (
          <div className="ve-video-preview-wrap">
            <video
              className="ve-video-preview"
              src={videoUrl}
              controls
              onClick={e => e.stopPropagation()}
            />
            <button
              className="ve-video-remove"
              onClick={e => {
                e.stopPropagation()
                onFileChange(null)
              }}
            >
              ✕ 別の動画を選ぶ
            </button>
          </div>
        ) : (
          <div className="ve-upload-placeholder">
            <div className="ve-upload-icon">🎬</div>
            <p className="ve-upload-label">クリックまたはドラッグで動画を追加</p>
            <p className="ve-upload-sub">MP4・MOV・WebM など対応</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={e => onFileChange(e.target.files?.[0] ?? null)}
        />
      </div>

      {uploadError && (
        <div className="ve-error-box">{uploadError}</div>
      )}

      <div className="ve-step-footer">
        <button
          className="ve-btn ve-btn--primary"
          disabled={!videoUrl || uploading}
          onClick={onNext}
        >
          次へ →
        </button>
      </div>
    </div>
  )
}

// ── Step 2: コンセプト入力 ────────────────────────────────

function VeStep2({
  concept,
  onConceptChange,
  onBack,
  onNext,
}: {
  concept: string
  onConceptChange: (v: string) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="ve-step">
      <div className="ve-step-heading">
        <h1>動画のコンセプトを入力しましょう</h1>
        <p>どんな内容の動画か、ターゲットや長さも含めて書いてください。</p>
      </div>

      <div className="ve-input-card">
        <textarea
          className="ve-concept-input"
          placeholder={`例：${CONCEPT_EXAMPLES[0]}`}
          value={concept}
          onChange={e => onConceptChange(e.target.value)}
          rows={4}
          maxLength={300}
        />
        <div className="ve-examples">
          <span className="ve-examples-label">入力例</span>
          {CONCEPT_EXAMPLES.map(ex => (
            <button
              key={ex}
              className="ve-example-chip"
              onClick={() => onConceptChange(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="ve-info-box">
        <span>💡</span>
        <span>コンセプトは後で変更できます。スキップしてもプロジェクトを作成できます。</span>
      </div>

      <div className="ve-step-footer">
        <button className="ve-btn ve-btn--secondary" onClick={onBack}>
          ← 戻る
        </button>
        <button className="ve-btn ve-btn--primary" onClick={onNext}>
          プロジェクトを作成する
        </button>
      </div>
    </div>
  )
}

// ── Step 3: プロジェクト生成完了 ─────────────────────────

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const STYLE_BADGE_LABEL: Record<string, string> = {
  viral: '🔥 viral',
  emotional: '💫 emotional',
  business: '💼 business',
  education: '📚 education',
}

const ANIMATION_BADGE_LABEL: Record<string, string> = {
  fade: 'FADE',
  pop: 'POP',
  slideUp: 'SLIDE UP',
}

function renderEmphasizedText(text: string, emphasis: string[] = []) {
  const lines = text.split('\n')

  if (!emphasis.length) {
    return (
      <>
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {line}
          </React.Fragment>
        ))}
      </>
    )
  }

  const escaped = emphasis.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g')

  return (
    <>
      {lines.map((line, lineIdx) => {
        const parts = line.split(pattern)
        return (
          <React.Fragment key={lineIdx}>
            {lineIdx > 0 && <br />}
            {parts.map((part, partIdx) =>
              emphasis.includes(part) ? (
                <mark key={partIdx} className="ve-telop-mark">{part}</mark>
              ) : (
                <React.Fragment key={partIdx}>{part}</React.Fragment>
              )
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'education', label: '📚 education' },
  { value: 'emotional', label: '💫 emotional' },
  { value: 'viral',     label: '🔥 viral' },
  { value: 'business',  label: '💼 business' },
]

const ANIMATION_OPTIONS: { value: string; label: string }[] = [
  { value: 'fade',    label: 'FADE' },
  { value: 'pop',     label: 'POP' },
  { value: 'slideUp', label: 'SLIDE UP' },
]

const POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'top',    label: '↑ top' },
  { value: 'middle', label: '↔ middle' },
  { value: 'bottom', label: '↓ bottom' },
]

function TelopPreviewCard({
  cap,
  index,
  isActive,
  isSearchMatch,
  onUpdate,
  onSplit,
  onMerge,
  canMerge,
  isSelected,
  onSelect,
}: {
  cap: CaptionSegment
  index: number
  isActive?: boolean
  isSearchMatch?: boolean
  onUpdate: (updated: CaptionSegment) => void
  onSplit?: () => void
  onMerge?: () => void
  canMerge?: boolean
  isSelected?: boolean
  onSelect?: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [animPreviewKey, setAnimPreviewKey] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPosition, setDragPosition] = useState<CaptionSegment['position'] | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSelected) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isSelected])

  const posClass = `ve-telop-screen--${cap.position ?? 'middle'}`
  const styleClass = cap.style ? `ve-telop-text--${cap.style}` : ''
  const animClass = cap.animation ? `ve-telop-text--anim-${cap.animation}` : ''

  const update = (patch: Partial<CaptionSegment>) => onUpdate({ ...cap, ...patch })
  const updateCustomStyle = (patch: Partial<CaptionCustomStyle>) =>
    update({ customStyle: { ...cap.customStyle, ...patch } })

  const cs = cap.customStyle
  const customTextStyle: React.CSSProperties = {
    ...(cs?.fontSize !== undefined ? { fontSize: cs.fontSize } : {}),
    ...(cs?.color ? { color: cs.color } : {}),
    ...(cs?.bold !== undefined ? { fontWeight: cs.bold ? 900 : 400 } : {}),
    ...(cs?.shadow === false ? { textShadow: 'none' } : cs?.shadow ? { textShadow: '2px 2px 8px rgba(0,0,0,0.9)' } : {}),
  }
  const customBgStyle: React.CSSProperties = cs?.bgColor
    ? { background: cs.bgColor, borderRadius: 8, padding: '4px 12px' }
    : {}

  const getPosFromRatio = (yRatio: number): CaptionSegment['position'] => {
    if (yRatio < 0.33) return 'top'
    if (yRatio < 0.67) return 'middle'
    return 'bottom'
  }

  const handleScreenMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const rect = screenRef.current?.getBoundingClientRect()

    const onMove = (ev: MouseEvent) => {
      if (!rect) return
      const yRatio = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
      setDragPosition(getPosFromRatio(yRatio))
    }

    const onUp = (ev: MouseEvent) => {
      if (rect) {
        const yRatio = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
        update({ position: getPosFromRatio(yRatio) })
      }
      setIsDragging(false)
      setDragPosition(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleStartSec = (raw: number) => {
    if (isNaN(raw) || raw < 0) { setTimeError('0未満は不可'); return }
    if (raw >= cap.endSec) { setTimeError('終了時間は開始時間より後にしてください'); return }
    setTimeError(null)
    update({ startSec: raw })
  }

  const handleEndSec = (raw: number) => {
    if (isNaN(raw) || raw < 0) { setTimeError('0未満は不可'); return }
    if (raw <= cap.startSec) { setTimeError('終了時間は開始時間より後にしてください'); return }
    setTimeError(null)
    update({ endSec: raw })
  }

  const duration = (cap.endSec - cap.startSec).toFixed(1)

  return (
    <div ref={cardRef} className={`ve-telop-card${isEditing ? ' ve-telop-card--editing' : ''}${isActive ? ' ve-telop-card--active' : ''}${isSearchMatch ? ' ve-telop-card--search-match' : ''}${isSelected ? ' ve-telop-card--selected' : ''}`} onClick={onSelect}>
      <div className="ve-telop-card-header">
        <span className="ve-telop-card-index">#{index + 1}</span>
        <span className="ve-telop-card-time">
          {formatSec(cap.startSec)} - {formatSec(cap.endSec)}
        </span>
        {isActive && (
          <span className="ve-telop-active-badge">▶ 現在再生中</span>
        )}
        {cap.style && (
          <span className={`ve-telop-style-badge ve-telop-style-badge--${cap.style}`}>
            {STYLE_BADGE_LABEL[cap.style] ?? cap.style}
          </span>
        )}
        {cap.animation && (
          <span
            className={`ve-telop-style-badge ve-telop-animation-badge ve-telop-animation-badge--${cap.animation} ve-telop-animation-badge--clickable`}
            onClick={() => setAnimPreviewKey(prev => prev + 1)}
            title="クリックでアニメーションをプレビュー"
          >
            ▶ {ANIMATION_BADGE_LABEL[cap.animation] ?? cap.animation}
          </span>
        )}
        {isSearchMatch && (
          <button
            className="ve-telop-jump-btn"
            onClick={() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            title="この字幕へジャンプ"
          >
            ↓ ジャンプ
          </button>
        )}
        {onSplit && (
          <button
            className="ve-telop-split-btn"
            onClick={onSplit}
            title="テキストと時間を中央で分割"
          >
            ✂ 分割
          </button>
        )}
        {onMerge && canMerge && (
          <button
            className="ve-telop-merge-btn"
            onClick={onMerge}
            title="次の字幕と結合"
          >
            🔗 次と結合
          </button>
        )}
        <button
          className={`ve-telop-edit-btn${isEditing ? ' ve-telop-edit-btn--active' : ''}`}
          onClick={() => setIsEditing(prev => !prev)}
        >
          {isEditing ? '✕ 閉じる' : '✏ 編集'}
        </button>
      </div>

      <div
        ref={screenRef}
        className={`ve-telop-screen ${posClass}${isDragging ? ' ve-telop-screen--dragging' : ''}`}
        onMouseDown={handleScreenMouseDown}
      >
        {isDragging && (
          <div className="ve-telop-drag-overlay">
            {(['top', 'middle', 'bottom'] as const).map(z => (
              <div
                key={z}
                className={`ve-telop-drag-zone${dragPosition === z ? ' ve-telop-drag-zone--active' : ''}`}
              >
                {dragPosition === z ? `📍 ${z}` : z}
              </div>
            ))}
          </div>
        )}
        <div
          key={`${index}-${animPreviewKey}`}
          className={`ve-telop-text ${styleClass} ${animClass}`}
          style={{
            ...(isDragging ? { opacity: 0.8 } : {}),
            ...customTextStyle,
            ...customBgStyle,
          }}
        >
          {renderEmphasizedText(cap.text, cap.emphasis)}
        </div>
      </div>

      {isEditing && (
        <div className="ve-telop-edit-panel">
          <div className="ve-telop-edit-row">
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">開始（秒）</label>
              <input
                type="number"
                className="ve-telop-edit-number"
                defaultValue={cap.startSec}
                key={`start-${cap.startSec}`}
                min={0}
                step={0.1}
                onBlur={e => handleStartSec(e.target.valueAsNumber)}
                onChange={e => handleStartSec(e.target.valueAsNumber)}
              />
            </div>
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">終了（秒）</label>
              <input
                type="number"
                className="ve-telop-edit-number"
                defaultValue={cap.endSec}
                key={`end-${cap.endSec}`}
                min={0}
                step={0.1}
                onBlur={e => handleEndSec(e.target.valueAsNumber)}
                onChange={e => handleEndSec(e.target.valueAsNumber)}
              />
            </div>
            <div className="ve-telop-edit-field ve-telop-edit-field--duration">
              <label className="ve-telop-edit-label">表示時間</label>
              <span className="ve-telop-duration">{duration}秒</span>
            </div>
          </div>
          {timeError && (
            <div className="ve-error-box ve-error-box--sm">{timeError}</div>
          )}
          <div className="ve-telop-edit-field">
            <label className="ve-telop-edit-label">テキスト</label>
            <textarea
              className="ve-telop-edit-textarea"
              value={cap.text}
              rows={3}
              onChange={e => update({ text: e.target.value })}
            />
          </div>
          <div className="ve-telop-edit-row">
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">スタイル</label>
              <select
                className="ve-telop-edit-select"
                value={cap.style ?? ''}
                onChange={e => update({ style: (e.target.value as CaptionSegment['style']) || undefined })}
              >
                <option value="">— なし —</option>
                {STYLE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">ポジション</label>
              <select
                className="ve-telop-edit-select"
                value={cap.position ?? ''}
                onChange={e => update({ position: (e.target.value as CaptionSegment['position']) || undefined })}
              >
                <option value="">— なし —</option>
                {POSITION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">アニメーション</label>
              <select
                className="ve-telop-edit-select"
                value={cap.animation ?? ''}
                onChange={e => update({ animation: (e.target.value as CaptionSegment['animation']) || undefined })}
              >
                <option value="">— なし —</option>
                {ANIMATION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">Sound Effect</label>
              <div className="ve-se-select-row">
                <select
                  className="ve-telop-edit-select"
                  value={cap.soundEffect ?? 'none'}
                  onChange={e => {
                    const v = e.target.value
                    update({ soundEffect: v === 'none' ? undefined : v })
                  }}
                >
                  {SOUND_EFFECTS.map(se => (
                    <option key={se} value={se}>{SOUND_EFFECT_LABELS[se]}</option>
                  ))}
                </select>
                <button
                  className="ve-se-preview-btn"
                  onClick={() => playSoundEffect(cap.soundEffect ?? 'none', cap.soundEffectVolume ?? 0.7)}
                  disabled={!cap.soundEffect || cap.soundEffect === 'none'}
                  title="選択中のSEを再生"
                >
                  ▶ Preview
                </button>
              </div>
            </div>
            <div className="ve-telop-edit-field ve-telop-edit-field--se-volume">
              <label className="ve-telop-edit-label">
                Volume <span className="ve-custom-style-value">{Math.round((cap.soundEffectVolume ?? 0.7) * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cap.soundEffectVolume ?? 0.7}
                onChange={e => update({ soundEffectVolume: Number(e.target.value) })}
                className="ve-custom-style-range"
                disabled={!cap.soundEffect || cap.soundEffect === 'none'}
              />
            </div>
          </div>

          <div className="ve-telop-edit-divider">
            <span className="ve-telop-edit-divider-label">字幕デザイン</span>
          </div>
          <div className="ve-telop-edit-field ve-telop-edit-field--stretch">
            <label className="ve-telop-edit-label">
              フォントサイズ　<span className="ve-custom-style-value">{cs?.fontSize ?? 40}px</span>
            </label>
            <input
              type="range"
              min={20}
              max={80}
              value={cs?.fontSize ?? 40}
              onChange={e => updateCustomStyle({ fontSize: Number(e.target.value) })}
              className="ve-custom-style-range"
            />
          </div>
          <div className="ve-telop-edit-row">
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">文字色</label>
              <input
                type="color"
                value={cs?.color ?? '#ffffff'}
                onChange={e => updateCustomStyle({ color: e.target.value })}
                className="ve-custom-style-color"
              />
            </div>
            <div className="ve-telop-edit-field">
              <label className="ve-telop-edit-label">背景色</label>
              <input
                type="color"
                value={cs?.bgColor ?? '#000000'}
                onChange={e => updateCustomStyle({ bgColor: e.target.value })}
                className="ve-custom-style-color"
              />
            </div>
            <div className="ve-telop-edit-field ve-telop-edit-field--check">
              <label className="ve-telop-edit-label">太字</label>
              <input
                type="checkbox"
                checked={cs?.bold ?? false}
                onChange={e => updateCustomStyle({ bold: e.target.checked })}
                className="ve-custom-style-check"
              />
            </div>
            <div className="ve-telop-edit-field ve-telop-edit-field--check">
              <label className="ve-telop-edit-label">シャドウ</label>
              <input
                type="checkbox"
                checked={cs?.shadow ?? false}
                onChange={e => updateCustomStyle({ shadow: e.target.checked })}
                className="ve-custom-style-check"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VeStep3({
  project,
  onClose,
  onBack,
  onCaptionsUpdate,
}: {
  project: VideoProject
  onClose?: () => void
  onBack: () => void
  onCaptionsUpdate: (captions: CaptionSegment[]) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) { video.pause() } else { void video.play() }
  }, [isPlaying])

  const handleRewind = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    setCurrentTime(0)
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const t = Number(e.target.value)
    video.currentTime = t
    setCurrentTime(t)
  }, [])

  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const [formatting, setFormatting] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [classifyingStyles, setClassifyingStyles] = useState(false)
  const [classifyingStylesError, setClassifyingStylesError] = useState<string | null>(null)
  const [classifyingAnimations, setClassifyingAnimations] = useState(false)
  const [classifyingAnimationsError, setClassifyingAnimationsError] = useState<string | null>(null)
  const [renderingCaptionVideo, setRenderingCaptionVideo] = useState(false)
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null)
  const [renderCaptionError, setRenderCaptionError] = useState<string | null>(null)
  const [bgmUrl, setBgmUrl] = useState<string | null>(null)
  const [bgmFileName, setBgmFileName] = useState<string | null>(null)
  const [bgmVolume, setBgmVolume] = useState(50)
  const [bgmFadeInSec, setBgmFadeInSec] = useState(1)
  const [bgmFadeOutSec, setBgmFadeOutSec] = useState(1)
  const [bgmUploading, setBgmUploading] = useState(false)
  const [bgmUploadError, setBgmUploadError] = useState<string | null>(null)
  const bgmInputRef = useRef<HTMLInputElement | null>(null)

  const [undoStack, setUndoStack] = useState<CaptionSegment[][]>([])
  const [redoStack, setRedoStack] = useState<CaptionSegment[][]>([])

  const [bulkAnimation, setBulkAnimation] = useState<CaptionAnimation | ''>('')
  const [bulkPosition, setBulkPosition] = useState<CaptionSegment['position'] | ''>('')
  const [bulkFontSize, setBulkFontSize] = useState(32)
  const [bulkBold, setBulkBold] = useState(false)
  const [bulkShadow, setBulkShadow] = useState(false)

  const [searchText, setSearchText] = useState('')
  const [selectedCaptionIndex, setSelectedCaptionIndex] = useState<number | null>(null)

  const [customTemplates, setCustomTemplates] = useState<CaptionTemplate[]>([])

  const captions = project.captions ?? []

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
      if (raw) setCustomTemplates(JSON.parse(raw) as CaptionTemplate[])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as VideoEditorProject
      onCaptionsUpdate(saved.captions ?? [])
      if (saved.bgmUrl) setBgmUrl(saved.bgmUrl)
      setBgmVolume(saved.bgmVolume ?? 50)
      setBgmFadeInSec(saved.bgmFadeInSec ?? 1)
      setBgmFadeOutSec(saved.bgmFadeOutSec ?? 1)
    } catch {
      console.error('Failed to restore video editor project from localStorage')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const data: VideoEditorProject = {
      version: 1,
      captions,
      bgmUrl: bgmUrl ?? undefined,
      bgmVolume,
      bgmFadeInSec,
      bgmFadeOutSec,
    }
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(data))
  }, [captions, bgmUrl, bgmVolume, bgmFadeInSec, bgmFadeOutSec])

  const handleTranscribe = async () => {
    setTranscribing(true)
    setTranscribeError(null)
    try {
      const res = await fetch('/api/transcribe-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: project.videoUrl }),
      })
      const data = await res.json() as { ok: boolean; captions?: CaptionSegment[]; message?: string }
      if (!data.ok || !data.captions) throw new Error(data.message ?? '字幕生成に失敗しました')
      pushHistory(project.captions ?? [])
      onCaptionsUpdate(data.captions)
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : '字幕生成に失敗しました')
    } finally {
      setTranscribing(false)
    }
  }

  const handleFormatCaptions = async () => {
    setFormatting(true)
    setFormatError(null)
    try {
      const res = await fetch('/api/format-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captions: project.captions, concept: project.concept }),
      })
      const data = await res.json() as { ok: boolean; captions?: CaptionSegment[]; message?: string }
      if (!data.ok || !data.captions) throw new Error(data.message ?? 'テロップ化に失敗しました')
      pushHistory(project.captions ?? [])
      onCaptionsUpdate(data.captions)
    } catch (e) {
      setFormatError(e instanceof Error ? e.message : 'テロップ化に失敗しました')
    } finally {
      setFormatting(false)
    }
  }

  const handleClassifyStyles = async () => {
    setClassifyingStyles(true)
    setClassifyingStylesError(null)
    try {
      const res = await fetch('/api/classify-caption-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captions: project.captions, concept: project.concept }),
      })
      const data = await res.json() as { ok: boolean; captions?: CaptionSegment[]; message?: string }
      if (!data.ok || !data.captions) throw new Error(data.message ?? 'スタイル判定に失敗しました')
      pushHistory(project.captions ?? [])
      onCaptionsUpdate(data.captions)
    } catch (e) {
      setClassifyingStylesError(e instanceof Error ? e.message : 'スタイル判定に失敗しました')
    } finally {
      setClassifyingStyles(false)
    }
  }

  const handleClassifyAnimations = async () => {
    setClassifyingAnimations(true)
    setClassifyingAnimationsError(null)
    try {
      const res = await fetch('/api/classify-caption-animations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captions: project.captions, concept: project.concept }),
      })
      const data = await res.json() as { ok: boolean; captions?: CaptionSegment[]; message?: string }
      if (!data.ok || !data.captions) throw new Error(data.message ?? 'アニメーション判定に失敗しました')
      pushHistory(project.captions ?? [])
      onCaptionsUpdate(data.captions)
    } catch (e) {
      setClassifyingAnimationsError(e instanceof Error ? e.message : 'アニメーション判定に失敗しました')
    } finally {
      setClassifyingAnimations(false)
    }
  }

  const handleBgmUpload = async (file: File) => {
    setBgmUploading(true)
    setBgmUploadError(null)
    try {
      const formData = new FormData()
      formData.append('bgm', file)
      const res = await fetch('/api/upload-bgm', { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; url?: string; fileName?: string; message?: string }
      if (!data.ok || !data.url) throw new Error(data.message ?? 'アップロードに失敗しました')
      setBgmUrl(data.url)
      setBgmFileName(data.fileName ?? file.name)
    } catch (e) {
      setBgmUploadError(e instanceof Error ? e.message : 'BGMのアップロードに失敗しました')
    } finally {
      setBgmUploading(false)
    }
  }

  const projectImportRef = useRef<HTMLInputElement | null>(null)

  const handleExportProject = () => {
    const project: VideoEditorProject = {
      version: 1,
      captions,
      bgmUrl: bgmUrl ?? undefined,
      bgmVolume,
      bgmFadeInSec,
      bgmFadeOutSec,
    }
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'project.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportProject = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string) as unknown
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          (parsed as VideoEditorProject).version !== 1
        ) {
          alert('対応していないプロジェクトファイルです')
          return
        }
        const data = parsed as VideoEditorProject
        onCaptionsUpdate(data.captions ?? [])
        setBgmUrl(data.bgmUrl ?? null)
        setBgmVolume(data.bgmVolume ?? 50)
        setBgmFadeInSec(data.bgmFadeInSec ?? 1)
        setBgmFadeOutSec(data.bgmFadeOutSec ?? 1)
      } catch {
        alert('プロジェクトの読み込みに失敗しました')
      }
    }
    reader.readAsText(file)
  }

  const handleRenderCaptionVideo = async () => {
    setRenderingCaptionVideo(true)
    setRenderCaptionError(null)
    try {
      const res = await fetch('/api/render-caption-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: project.videoUrl,
          captions: project.captions,
          ...(bgmUrl ? { bgmUrl, bgmVolume, bgmFadeInSec, bgmFadeOutSec } : {}),
        }),
      })
      const data = await res.json() as { ok: boolean; videoUrl?: string; message?: string }
      if (!data.ok || !data.videoUrl) throw new Error(data.message ?? '動画生成に失敗しました')
      setRenderedVideoUrl(data.videoUrl)
    } catch (e) {
      setRenderCaptionError(e instanceof Error ? e.message : '動画生成に失敗しました')
    } finally {
      setRenderingCaptionVideo(false)
    }
  }

  const hasEmphasis = captions.some(c => c.emphasis && c.emphasis.length > 0)
  const activeCaptionIndex = captions.findIndex(
    c => currentTime >= c.startSec && currentTime < c.endSec
  )

  const prevActiveCaptionIndexRef = useRef(-1)
  useEffect(() => {
    const prev = prevActiveCaptionIndexRef.current
    prevActiveCaptionIndexRef.current = activeCaptionIndex
    if (activeCaptionIndex === -1 || activeCaptionIndex === prev) return
    const cap = captions[activeCaptionIndex]
    if (cap?.soundEffect) playSoundEffect(cap.soundEffect, cap.soundEffectVolume ?? 0.7)
  }, [activeCaptionIndex, captions])

  const isSearching = searchText.trim() !== ''
  const displayCaptions = captions
    .map((cap, i) => ({ cap, i }))
    .filter(({ cap }) =>
      !isSearching || cap.text.toLowerCase().includes(searchText.toLowerCase())
    )

  const pushHistory = useCallback((snapshot: CaptionSegment[]) => {
    setUndoStack(prev => [...prev, structuredClone(snapshot)].slice(-50))
    setRedoStack([])
  }, [])

  const handleCaptionDelete = useCallback((index: number) => {
    pushHistory(captions)
    const next = [...captions]
    next.splice(index, 1)
    setSelectedCaptionIndex(prev => {
      if (prev === null) return null
      if (next.length === 0) return null
      return Math.min(prev, next.length - 1)
    })
    onCaptionsUpdate(next)
  }, [captions, pushHistory, onCaptionsUpdate])

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    setRedoStack(prev => [...prev, structuredClone(captions)].slice(-50))
    setUndoStack(prev => prev.slice(0, -1))
    onCaptionsUpdate(previous)
  }, [undoStack, captions, onCaptionsUpdate])

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack(prev => [...prev, structuredClone(captions)].slice(-50))
    setRedoStack(prev => prev.slice(0, -1))
    onCaptionsUpdate(next)
  }, [redoStack, captions, onCaptionsUpdate])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          handleUndo()
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault()
          handleRedo()
        }
        return
      }
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '[') {
        e.preventDefault()
        setSelectedCaptionIndex(prev =>
          prev === null ? 0 : Math.max(0, prev - 1)
        )
      } else if (e.key === ']') {
        e.preventDefault()
        setSelectedCaptionIndex(prev =>
          prev === null ? 0 : Math.min(captions.length - 1, prev + 1)
        )
      } else if (e.key === 'Delete') {
        if (selectedCaptionIndex !== null) {
          e.preventDefault()
          handleCaptionDelete(selectedCaptionIndex)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo, captions.length, selectedCaptionIndex, handleCaptionDelete])

  const handleCaptionUpdate = useCallback((index: number, updated: CaptionSegment) => {
    const next = [...captions]
    next[index] = updated
    pushHistory(captions)
    onCaptionsUpdate(next)
  }, [captions, pushHistory, onCaptionsUpdate])

  const handleCaptionSplit = useCallback((index: number) => {
    const cap = captions[index]
    if (!cap) return
    const middle = Math.floor(cap.text.length / 2)
    const firstText = cap.text.slice(0, middle)
    const secondText = cap.text.slice(middle)
    const middleSec = (cap.startSec + cap.endSec) / 2
    const inherited = {
      animation: cap.animation,
      position: cap.position,
      style: cap.style,
      customStyle: cap.customStyle,
      soundEffect: cap.soundEffect,
      soundEffectVolume: cap.soundEffectVolume,
    }
    const first: CaptionSegment = { ...inherited, text: firstText, startSec: cap.startSec, endSec: middleSec }
    const second: CaptionSegment = { ...inherited, text: secondText, startSec: middleSec, endSec: cap.endSec }
    pushHistory(captions)
    const next = [...captions]
    next.splice(index, 1, first, second)
    onCaptionsUpdate(next)
  }, [captions, pushHistory, onCaptionsUpdate])

  const handleCaptionMerge = useCallback((index: number) => {
    const current = captions[index]
    const next = captions[index + 1]
    if (!current || !next) return
    const merged: CaptionSegment = {
      text: `${current.text} ${next.text}`,
      startSec: current.startSec,
      endSec: next.endSec,
      animation: current.animation,
      position: current.position,
      style: current.style,
      customStyle: current.customStyle,
      soundEffect: current.soundEffect,
      soundEffectVolume: current.soundEffectVolume,
    }
    pushHistory(captions)
    const updated = [...captions]
    updated.splice(index, 2, merged)
    onCaptionsUpdate(updated)
  }, [captions, pushHistory, onCaptionsUpdate])

  const handleBulkApply = useCallback(() => {
    pushHistory(captions)
    const updated = captions.map(cap => ({
      ...cap,
      ...(bulkAnimation !== '' ? { animation: bulkAnimation as CaptionAnimation } : {}),
      ...(bulkPosition !== '' ? { position: bulkPosition as CaptionSegment['position'] } : {}),
      customStyle: {
        ...cap.customStyle,
        fontSize: bulkFontSize,
        bold: bulkBold,
        shadow: bulkShadow,
      },
    }))
    onCaptionsUpdate(updated)
  }, [captions, pushHistory, bulkAnimation, bulkPosition, bulkFontSize, bulkBold, bulkShadow, onCaptionsUpdate])

  const handleApplyCaptionTemplate = useCallback((template: CaptionTemplate) => {
    pushHistory(captions)
    const updated = captions.map(cap => ({
      ...cap,
      ...(template.animation !== undefined ? { animation: template.animation } : {}),
      ...(template.position !== undefined ? { position: template.position } : {}),
      customStyle: {
        ...cap.customStyle,
        ...template.customStyle,
      },
    }))
    onCaptionsUpdate(updated)
  }, [captions, pushHistory, onCaptionsUpdate])

  const handleSaveCustomTemplate = useCallback(() => {
    const name = prompt('テンプレート名')
    if (!name) return
    const newTemplate: CaptionTemplate = {
      id: crypto.randomUUID(),
      name: `⭐ ${name}`,
      ...(bulkAnimation !== '' ? { animation: bulkAnimation as CaptionAnimation } : {}),
      ...(bulkPosition !== '' ? { position: bulkPosition as CaptionSegment['position'] } : {}),
      customStyle: { fontSize: bulkFontSize, bold: bulkBold, shadow: bulkShadow },
    }
    const updated = [...customTemplates, newTemplate]
    setCustomTemplates(updated)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated))
  }, [bulkAnimation, bulkPosition, bulkFontSize, bulkBold, bulkShadow, customTemplates])

  const handleDeleteCustomTemplate = useCallback((id: string) => {
    const updated = customTemplates.filter(t => t.id !== id)
    setCustomTemplates(updated)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated))
  }, [customTemplates])

  const handleRenameTemplate = useCallback((id: string) => {
    const current = customTemplates.find(t => t.id === id)
    if (!current) return
    const raw = current.name.replace(/^⭐ /, '')
    const next = prompt('新しい名前', raw)
    if (!next || !next.trim()) return
    const updated = customTemplates.map(t =>
      t.id === id ? { ...t, name: `⭐ ${next.trim()}` } : t
    )
    setCustomTemplates(updated)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated))
  }, [customTemplates])

  const handleDuplicateTemplate = useCallback((template: CaptionTemplate) => {
    const baseName = template.name.replace(/ Copy$/, '')
    const copy: CaptionTemplate = { ...template, id: crypto.randomUUID(), name: `${baseName} Copy` }
    const updated = [...customTemplates, copy]
    setCustomTemplates(updated)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated))
  }, [customTemplates])

  const handleMoveTemplate = useCallback((id: string, direction: 'up' | 'down') => {
    const idx = customTemplates.findIndex(t => t.id === id)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= customTemplates.length) return
    const updated = [...customTemplates]
    ;[updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]]
    setCustomTemplates(updated)
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated))
  }, [customTemplates])

  const importFileRef = useRef<HTMLInputElement>(null)

  const handleExportTemplate = useCallback((template: CaptionTemplate) => {
    const payload: TemplateExportFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      template,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `template-${template.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImportTemplate = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as TemplateExportFile
        if (
          typeof parsed.version !== 'number' ||
          !parsed.template ||
          typeof parsed.template.name !== 'string' ||
          (parsed.template.animation !== undefined && typeof parsed.template.animation !== 'string') ||
          (parsed.template.position !== undefined && typeof parsed.template.position !== 'string') ||
          (parsed.template.customStyle !== undefined && typeof parsed.template.customStyle !== 'object')
        ) {
          alert('テンプレート形式が不正です')
          return
        }
        const incoming = parsed.template
        const existingNames = new Set(customTemplates.map(t => t.name))
        const baseName = incoming.name.replace(/ \(Imported\)$/, '')
        const finalName = existingNames.has(baseName) ? `${baseName} (Imported)` : baseName
        const newTemplate: CaptionTemplate = { ...incoming, id: crypto.randomUUID(), name: finalName }
        const updated = [...customTemplates, newTemplate]
        setCustomTemplates(updated)
        localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated))
      } catch {
        alert('テンプレート形式が不正です')
      }
    }
    reader.readAsText(file)
  }, [customTemplates])

  return (
    <div className="ve-step">
      <div className="ve-step-heading">
        <h1>プロジェクトが作成されました</h1>
        <p>動画のアップロードとプロジェクト設定が完了しました。</p>
      </div>

      <div className="ve-project-card">
        <div className="ve-project-row">
          <span className="ve-project-label">プロジェクト ID</span>
          <span className="ve-project-value ve-project-value--mono">{project.id}</span>
        </div>
        <div className="ve-project-row">
          <span className="ve-project-label">動画 URL</span>
          <span className="ve-project-value ve-project-value--mono">{project.videoUrl}</span>
        </div>
        {project.concept && (
          <div className="ve-project-row">
            <span className="ve-project-label">コンセプト</span>
            <span className="ve-project-value">{project.concept}</span>
          </div>
        )}
      </div>

      <div className="ve-project-preview">
        <video
          ref={videoRef}
          className="ve-project-video"
          src={project.videoUrl}
          onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={e => setDuration(e.currentTarget.duration)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
        <div className="ve-player-controls">
          <button className="ve-player-btn" onClick={handleRewind} title="先頭へ">⏪</button>
          <button className="ve-player-btn ve-player-btn--play" onClick={handlePlayPause}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <div className="ve-player-seekbar-wrap">
            <input
              type="range"
              className="ve-player-seekbar"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
            />
          </div>
          <span className="ve-player-time">
            {formatSec(currentTime)} / {formatSec(duration)}
          </span>
        </div>
      </div>

      {captions.length > 0 && (
        <div className="ve-telop-preview-section">
          <div className="ve-telop-preview-header">
            <span className="ve-caption-section-title">📺 テロッププレビュー</span>
            <span className="ve-caption-badge">{captions.length} セグメント</span>
          </div>
          <div className="ve-caption-actions">
            <button
              className="ve-btn ve-btn--secondary ve-transcribe-btn"
              onClick={() => { void handleClassifyStyles() }}
              disabled={classifyingStyles || classifyingAnimations || transcribing || formatting}
            >
              {classifyingStyles ? (
                <>
                  <span className="ve-spinner ve-spinner--sm" />
                  判定中...
                </>
              ) : (
                '🎨 スタイルを自動判定する'
              )}
            </button>
            <button
              className="ve-btn ve-btn--secondary ve-transcribe-btn"
              onClick={() => { void handleClassifyAnimations() }}
              disabled={classifyingAnimations || classifyingStyles || transcribing || formatting}
            >
              {classifyingAnimations ? (
                <>
                  <span className="ve-spinner ve-spinner--sm" />
                  判定中...
                </>
              ) : (
                '✨ アニメーションを自動判定する'
              )}
            </button>
          </div>
          {classifyingStylesError && (
            <div className="ve-error-box ve-error-box--sm">{classifyingStylesError}</div>
          )}
          {classifyingAnimationsError && (
            <div className="ve-error-box ve-error-box--sm">{classifyingAnimationsError}</div>
          )}
          <div className="ve-telop-list">
            {displayCaptions.map(({ cap, i }) => (
              <TelopPreviewCard
                key={i}
                cap={cap}
                index={i}
                isActive={activeCaptionIndex === i}
                isSearchMatch={isSearching}
                isSelected={selectedCaptionIndex === i}
                onSelect={() => setSelectedCaptionIndex(i)}
                onUpdate={updated => handleCaptionUpdate(i, updated)}
                onSplit={() => handleCaptionSplit(i)}
                onMerge={() => handleCaptionMerge(i)}
                canMerge={i < captions.length - 1}
              />
            ))}
          </div>
          <div className="ve-bgm-section">
            <div className="ve-telop-preview-header">
              <span className="ve-caption-section-title">🎵 BGM</span>
            </div>
            <div className="ve-bgm-upload-row">
              <button
                className="ve-btn ve-btn--secondary ve-transcribe-btn"
                onClick={() => bgmInputRef.current?.click()}
                disabled={bgmUploading}
              >
                {bgmUploading ? (
                  <>
                    <span className="ve-spinner ve-spinner--sm" />
                    アップロード中...
                  </>
                ) : (
                  '音楽ファイルを選ぶ'
                )}
              </button>
              <input
                ref={bgmInputRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleBgmUpload(file)
                  e.target.value = ''
                }}
              />
              {bgmFileName && (
                <div className="ve-bgm-filename">
                  <span>選択中: {bgmFileName}</span>
                  <button
                    className="ve-bgm-remove"
                    onClick={() => { setBgmUrl(null); setBgmFileName(null) }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            {bgmUploadError && (
              <div className="ve-error-box ve-error-box--sm">{bgmUploadError}</div>
            )}
            {bgmUrl && (
              <>
                <div className="ve-bgm-volume-row">
                  <label className="ve-bgm-volume-label">音量</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={bgmVolume}
                    onChange={e => setBgmVolume(Number(e.target.value))}
                    className="ve-bgm-volume-slider"
                  />
                  <span className="ve-bgm-volume-value">{bgmVolume}</span>
                </div>
                <div className="ve-bgm-fade-row">
                  <div className="ve-bgm-fade-field">
                    <label className="ve-bgm-volume-label">フェードイン（秒）</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="0.5"
                      value={bgmFadeInSec}
                      onChange={e => setBgmFadeInSec(Math.min(10, Math.max(0, Number(e.target.value))))}
                      className="ve-bgm-fade-input"
                    />
                  </div>
                  <div className="ve-bgm-fade-field">
                    <label className="ve-bgm-volume-label">フェードアウト（秒）</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="0.5"
                      value={bgmFadeOutSec}
                      onChange={e => setBgmFadeOutSec(Math.min(10, Math.max(0, Number(e.target.value))))}
                      className="ve-bgm-fade-input"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="ve-project-io-row">
              <button
                className="ve-btn ve-btn--secondary ve-transcribe-btn"
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                title="元に戻す (Ctrl+Z)"
              >
                ↩ Undo
              </button>
              <button
                className="ve-btn ve-btn--secondary ve-transcribe-btn"
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                title="やり直す (Ctrl+Y)"
              >
                ↪ Redo
              </button>
              <button
                className="ve-btn ve-btn--secondary ve-transcribe-btn"
                onClick={handleExportProject}
                title="プロジェクトをJSONファイルに保存"
              >
                📤 プロジェクト保存
              </button>
              <button
                className="ve-btn ve-btn--secondary ve-transcribe-btn"
                onClick={() => projectImportRef.current?.click()}
                title="JSONファイルからプロジェクトを読み込む"
              >
                📥 プロジェクト読込
              </button>
              <input
                ref={projectImportRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleImportProject(file)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="ve-bulk-edit-section">
              <div className="ve-telop-preview-header">
                <span className="ve-caption-section-title">🎨 一括編集</span>
              </div>
              <div className="ve-bulk-edit-row">
                <div className="ve-bulk-edit-field">
                  <label className="ve-bgm-volume-label">アニメーション</label>
                  <select
                    className="ve-telop-edit-select"
                    value={bulkAnimation}
                    onChange={e => setBulkAnimation(e.target.value as CaptionAnimation | '')}
                  >
                    <option value="">— 変更しない —</option>
                    <option value="fade">フェード</option>
                    <option value="pop">ポップ</option>
                    <option value="slideUp">スライドアップ</option>
                  </select>
                </div>
                <div className="ve-bulk-edit-field">
                  <label className="ve-bgm-volume-label">位置</label>
                  <select
                    className="ve-telop-edit-select"
                    value={bulkPosition}
                    onChange={e => setBulkPosition(e.target.value as CaptionSegment['position'] | '')}
                  >
                    <option value="">— 変更しない —</option>
                    <option value="top">上</option>
                    <option value="middle">中央</option>
                    <option value="bottom">下</option>
                  </select>
                </div>
                <div className="ve-bulk-edit-field">
                  <label className="ve-bgm-volume-label">フォントサイズ</label>
                  <input
                    type="number"
                    className="ve-bgm-fade-input ve-bulk-fontsize-input"
                    min={12}
                    max={120}
                    step={2}
                    value={bulkFontSize}
                    onChange={e => setBulkFontSize(Number(e.target.value))}
                  />
                </div>
                <div className="ve-bulk-edit-field ve-bulk-edit-field--check">
                  <label className="ve-bgm-volume-label">太字</label>
                  <input
                    type="checkbox"
                    className="ve-custom-style-check"
                    checked={bulkBold}
                    onChange={e => setBulkBold(e.target.checked)}
                  />
                </div>
                <div className="ve-bulk-edit-field ve-bulk-edit-field--check">
                  <label className="ve-bgm-volume-label">影</label>
                  <input
                    type="checkbox"
                    className="ve-custom-style-check"
                    checked={bulkShadow}
                    onChange={e => setBulkShadow(e.target.checked)}
                  />
                </div>
              </div>
              <button
                className="ve-btn ve-btn--primary ve-transcribe-btn"
                onClick={handleBulkApply}
                disabled={captions.length === 0}
              >
                全字幕に適用
              </button>
            </div>
            <div className="ve-caption-template-section">
              <div className="ve-telop-preview-header">
                <span className="ve-caption-section-title">🎭 テンプレート</span>
                <button
                  className="ve-import-template-btn"
                  onClick={() => importFileRef.current?.click()}
                  title="JSONファイルからテンプレートをインポート"
                >
                  Import Template
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={handleImportTemplate}
                />
              </div>
              <div className="ve-caption-template-list">
                {CAPTION_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    className="ve-caption-template-btn"
                    onClick={() => handleApplyCaptionTemplate(template)}
                    disabled={captions.length === 0}
                    title={`${template.name} を全字幕に適用`}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
              <button
                className="ve-btn ve-btn--secondary ve-save-template-btn"
                onClick={handleSaveCustomTemplate}
                title="現在の一括設定をテンプレートとして保存"
              >
                💾 現在設定を保存
              </button>
              {customTemplates.length > 0 && (
                <>
                  <div className="ve-template-divider" />
                  <div className="ve-custom-template-list">
                    {customTemplates.map((template, idx) => (
                      <div key={template.id} className="ve-custom-template-row">
                        <button
                          className="ve-caption-template-btn ve-caption-template-btn--custom"
                          onClick={() => handleApplyCaptionTemplate(template)}
                          disabled={captions.length === 0}
                          title={`${template.name} を全字幕に適用`}
                        >
                          {template.name}
                        </button>
                        <div className="ve-template-actions">
                          <button
                            className="ve-template-action-btn"
                            onClick={() => handleRenameTemplate(template.id)}
                            title="名前を変更"
                          >
                            Rename
                          </button>
                          <button
                            className="ve-template-action-btn"
                            onClick={() => handleDuplicateTemplate(template)}
                            title="複製"
                          >
                            Dup
                          </button>
                          <button
                            className="ve-export-template-btn"
                            onClick={() => handleExportTemplate(template)}
                            title="JSONでエクスポート"
                          >
                            Export
                          </button>
                          <button
                            className="ve-delete-template-btn"
                            onClick={() => handleDeleteCustomTemplate(template.id)}
                            title="削除"
                          >
                            🗑
                          </button>
                          <button
                            className="ve-move-template-btn"
                            onClick={() => handleMoveTemplate(template.id, 'up')}
                            disabled={idx === 0}
                            title="上へ"
                          >
                            ↑
                          </button>
                          <button
                            className="ve-move-template-btn"
                            onClick={() => handleMoveTemplate(template.id, 'down')}
                            disabled={idx === customTemplates.length - 1}
                            title="下へ"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="ve-search-section">
              <div className="ve-telop-preview-header">
                <span className="ve-caption-section-title">🔍 字幕検索</span>
                {isSearching && (
                  <span className="ve-caption-badge">検索結果: {displayCaptions.length}件</span>
                )}
              </div>
              <div className="ve-search-input-row">
                <input
                  type="text"
                  className="ve-search-input"
                  placeholder="キーワード検索"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                />
                {isSearching && (
                  <button
                    className="ve-search-clear-btn"
                    onClick={() => setSearchText('')}
                    title="検索クリア"
                  >
                    ✕ クリア
                  </button>
                )}
              </div>
            </div>
            <div className="ve-shortcut-section">
              <div className="ve-telop-preview-header">
                <span className="ve-caption-section-title">⌨ ショートカット</span>
              </div>
              <div className="ve-shortcut-list">
                <span className="ve-shortcut-item"><kbd>[</kbd> 前字幕</span>
                <span className="ve-shortcut-item"><kbd>]</kbd> 次字幕</span>
                <span className="ve-shortcut-item"><kbd>Delete</kbd> 削除</span>
                <span className="ve-shortcut-item"><kbd>Ctrl+Z</kbd> Undo</span>
                <span className="ve-shortcut-item"><kbd>Ctrl+Y</kbd> Redo</span>
              </div>
            </div>
          </div>

          <div className="ve-caption-actions">
            <button
              className="ve-btn ve-btn--primary ve-transcribe-btn"
              onClick={() => { void handleRenderCaptionVideo() }}
              disabled={renderingCaptionVideo || classifyingStyles || transcribing || formatting}
            >
              {renderingCaptionVideo ? (
                <>
                  <span className="ve-spinner ve-spinner--sm" />
                  動画生成中...
                </>
              ) : (
                '🎬 テロップ付き動画を生成する'
              )}
            </button>
          </div>
          {renderCaptionError && (
            <div className="ve-error-box ve-error-box--sm">{renderCaptionError}</div>
          )}
          {renderedVideoUrl && (
            <div className="ve-compare-section">
              <div className="ve-compare-grid">
                <div className="ve-compare-item">
                  <div className="ve-compare-label">元動画</div>
                  <video className="ve-compare-video" src={project.videoUrl} controls />
                </div>
                <div className="ve-compare-item">
                  <div className="ve-compare-label">テロップ付き動画</div>
                  <video className="ve-compare-video" src={renderedVideoUrl} controls />
                </div>
              </div>
              <div className="ve-caption-actions">
                <a
                  className="ve-btn ve-btn--primary ve-transcribe-btn"
                  href={renderedVideoUrl}
                  download
                >
                  ⬇ ダウンロード
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ve-caption-section">
        <div className="ve-caption-section-header">
          <span className="ve-caption-section-title">字幕</span>
          {captions.length > 0 && (
            <span className="ve-caption-badge">{captions.length} セグメント</span>
          )}
          {hasEmphasis && (
            <span className="ve-caption-badge ve-caption-badge--telop">テロップ済</span>
          )}
        </div>

        {captions.length === 0 ? (
          <div className="ve-caption-empty">
            <button
              className="ve-btn ve-btn--primary ve-transcribe-btn"
              onClick={() => { void handleTranscribe() }}
              disabled={transcribing}
            >
              {transcribing ? (
                <>
                  <span className="ve-spinner ve-spinner--sm" />
                  字幕を生成中...
                </>
              ) : (
                '🎙 字幕を生成する'
              )}
            </button>
            {transcribeError && (
              <div className="ve-error-box ve-error-box--sm">{transcribeError}</div>
            )}
          </div>
        ) : (
          <>
            <ul className="ve-caption-list">
              {captions.map((cap, i) => (
                <li key={i} className="ve-caption-item">
                  <span className="ve-caption-time">
                    {formatSec(cap.startSec)} - {formatSec(cap.endSec)}
                  </span>
                  <span className="ve-caption-text">{cap.text}</span>
                  {(cap.emphasis && cap.emphasis.length > 0 || cap.position) && (
                    <div className="ve-caption-meta">
                      {cap.emphasis && cap.emphasis.length > 0 && (
                        <div className="ve-caption-emphasis">
                          <span className="ve-caption-meta-label">強調:</span>
                          {cap.emphasis.map(w => (
                            <span key={w} className="ve-caption-emphasis-tag">{w}</span>
                          ))}
                        </div>
                      )}
                      {cap.position && (
                        <span className={`ve-caption-position ve-caption-position--${cap.position}`}>
                          {cap.position}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="ve-caption-actions">
              <button
                className="ve-btn ve-btn--primary ve-transcribe-btn"
                onClick={() => { void handleFormatCaptions() }}
                disabled={formatting || transcribing}
              >
                {formatting ? (
                  <>
                    <span className="ve-spinner ve-spinner--sm" />
                    テロップ化中...
                  </>
                ) : (
                  '✨ AIでテロップ化する'
                )}
              </button>
              <button
                className="ve-btn ve-btn--secondary ve-transcribe-btn"
                onClick={() => { void handleTranscribe() }}
                disabled={transcribing || formatting}
              >
                {transcribing ? (
                  <>
                    <span className="ve-spinner ve-spinner--sm" />
                    再生成中...
                  </>
                ) : (
                  '🎙 再生成する'
                )}
              </button>
            </div>
            {formatError && (
              <div className="ve-error-box ve-error-box--sm">{formatError}</div>
            )}
            {transcribeError && (
              <div className="ve-error-box ve-error-box--sm">{transcribeError}</div>
            )}
          </>
        )}
      </div>

      <div className="ve-step-footer">
        <button className="ve-btn ve-btn--secondary" onClick={onBack}>
          ← 戻る
        </button>
        {onClose && (
          <button className="ve-btn ve-btn--ghost" onClick={onClose}>
            ウィザードに戻る
          </button>
        )}
      </div>
    </div>
  )
}
