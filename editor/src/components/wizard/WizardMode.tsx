import React, { useState, useRef, useCallback, useEffect } from 'react'
import { generateStory, type AIPresetKey, type GeneratedSlideContent } from '../../storyGenerator'
import type { ScriptHandoff } from '../../types'
import { handoffToCardTexts } from '../script/scriptHandoff'
import './WizardMode.css'

// ── ダミーデータ ──────────────────────────────────────────

const INITIAL_STORY_CARDS = [
  { id: 1, role: 'オープニング', text: '歌が上手くなるには、まず正しい呼吸法を身につけることが重要です。' },
  { id: 2, role: '問題提起', text: '多くの人が「音程が外れる」「声が出ない」という悩みを抱えています。' },
  { id: 3, role: '共感', text: 'カラオケで自信を持って歌えたら、もっと楽しいですよね？' },
  { id: 4, role: 'ポイント①', text: 'まず大切なのは「腹式呼吸」。お腹を使って深く息を吸います。' },
  { id: 5, role: '解説', text: '腹式呼吸をマスターすると、声量が上がり、音程が安定します。' },
  { id: 6, role: 'ポイント②', text: '次は「発声練習」。毎日5分のトレーニングで驚くほど変わります。' },
  { id: 7, role: '実践例', text: '「ア〜」「エ〜」「イ〜」「オ〜」「ウ〜」を順番に練習しましょう。' },
  { id: 8, role: 'ポイント③', text: '音程を外さない秘訣は、音を「追いかける」のではなく「先読み」すること。' },
  { id: 9, role: '深掘り', text: '歌詞を覚えると、音程に集中できます。まず歌詞を暗記しましょう。' },
  { id: 10, role: 'Before/After', text: '1ヶ月実践した人から「声量が2倍になった」という声が続出！' },
  { id: 11, role: '背中を押す', text: '今日から始めれば、1ヶ月後には全然違う自分になれます。' },
  { id: 12, role: 'まとめ', text: '①腹式呼吸 ②毎日の発声練習 ③先読みの3つを実践しましょう！' },
  { id: 13, role: 'CTA', text: '詳しいトレーニング方法はプロフィールのリンクをチェック！' },
  { id: 14, role: 'エンディング', text: '「いいね」「保存」「フォロー」で応援お願いします！' },
]

const TEMPLATE_CHIPS = [
  { key: 'vocal', label: '歌唱診断', icon: '🎤' },
  { key: 'event', label: 'イベント告知', icon: '📣' },
  { key: 'note', label: 'Note紹介', icon: '📝' },
  { key: 'profile', label: '自己紹介', icon: '👋' },
  { key: 'product', label: '商品PR', icon: '✨' },
]

const EXAMPLE_THEMES = [
  '歌が上手くなる方法',
  'MMMイベント告知',
  'AI活用術',
  'ギター初心者向け',
]

const WIZARD_PRESET_MAP: { [key: string]: AIPresetKey } = {
  vocal:   'singing_pr',
  event:   'mmm_event',
  note:    'note',
  profile: 'instagram_reels',
  product: 'instagram_reels',
}

const STORY_ROLES = INITIAL_STORY_CARDS.map(c => c.role)

function normalizeToStoryCards(slides: GeneratedSlideContent[]): StoryCard[] {
  const capped = slides.slice(0, 14)
  return Array.from({ length: 14 }, (_, i) => {
    const slide = capped[i]
    const role = STORY_ROLES[i] ?? `シーン${i + 1}`
    if (slide) {
      const text = slide.subline
        ? `${slide.headline}\n${slide.subline}`
        : slide.headline
      return { id: i + 1, role, text }
    }
    return { ...INITIAL_STORY_CARDS[i] }
  })
}

const SNS_CAPTIONS: Record<string, string> = {
  Instagram: `🎵 歌が上手くなる3つのコツ

音程で悩んでいる人、必見です！

✅ 腹式呼吸をマスターする
✅ 毎日5分の発声練習
✅ 先読みで音程をとる

これを1ヶ月続けるだけで声が変わります🔥

詳しくはプロフのリンクから👇

#歌が上手くなりたい #ボイトレ #歌声 #カラオケ #歌い方`,

  TikTok: `歌が劇的に上手くなる方法教えます🎤✨

#歌ウマ #ボイトレ #歌い方 #カラオケ上達 #歌手志望`,

  X: `「音程が外れる」悩みを解決する3つの方法

①腹式呼吸
②毎日5分の発声練習
③音の先読み

これだけで1ヶ月後に激変します。詳しくは動画で👇`,

  YouTube: `【完全解説】歌が上手くなる3つの方法｜初心者でも1ヶ月で変わる練習法

▼ 動画の内容
00:00 オープニング
00:15 よくある悩み
00:30 腹式呼吸のやり方
01:00 発声練習の方法
01:30 先読みテクニック
02:00 まとめ

▼ 関連リンク
ボイトレ無料診断：https://example.com

#歌い方 #ボイトレ #歌上手くなる方法`,
}

const SNS_PLATFORMS = ['Instagram', 'TikTok', 'X', 'YouTube'] as const
type SnsPlatform = (typeof SNS_PLATFORMS)[number]

const STEPS = [
  { num: 1, label: '入力' },
  { num: 2, label: 'ストーリー作成' },
  { num: 3, label: '素材アップロード' },
  { num: 4, label: '編集' },
  { num: 5, label: '完成' },
]

const POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10分でタイムアウト

// ── 型 ───────────────────────────────────────────────────

interface StoryCard {
  id: number
  role: string
  text: string
}

interface WizardState {
  theme: string
  selectedTemplate: string
  storyCards: StoryCard[]
  images: (string | null)[]
  imageUploading: boolean[]
  imageErrors: (string | null)[]
  bgmFile: string | null
  bgmUrl: string | null
  bgmUploading: boolean
  bgmError: string | null
  videoRequested: boolean
  renderStatus: 'idle' | 'preparing' | 'rendering' | 'completed' | 'failed'
  renderError: string | null
  videoDownloadUrl: string | null
  videoFilename: string | null
  selectedScene: number
  snsPlatform: SnsPlatform
  copiedSns: boolean
  editingCardId: number | null
  editingText: string
  textAlign: 'left' | 'center' | 'right'
  textVerticalAlign: 'top' | 'center' | 'bottom'
  fontSize: number
  fontFamily: string
  advancedOpen: boolean
  isGenerating: boolean
  generationError: string | null
  storyGenerated: boolean
  // ScriptMode から受け取った台本で作ったカードか（null＝通常起動・AI生成）。theme はそのときのタイトル。
  scriptCards: { theme: string; filled: number } | null
  // CTA mode (slide 14)
  ctaMode: boolean
  ctaHeadline: string
  ctaNote: string
  ctaQrImage: string | null
  ctaQrUploading: boolean
  ctaQrError: string | null
}

// ── Props ────────────────────────────────────────────────

interface WizardModeProps {
  onClose?: () => void
  /** ScriptMode から渡された台本。最初のマウント時だけ使い、以降の再renderでは上書きしない。 */
  initialScript?: ScriptHandoff | null
  /** 初期値をstateへ取り込んだ後に一度だけ呼ぶ（親が受け渡しデータを破棄する合図）。 */
  onInitialScriptConsumed?: () => void
}

/** 台本の受け渡しから、Wizardの初期state用のテーマとカード（14枚固定）を作る。AIは使わない。 */
function seedFromScript(h: ScriptHandoff) {
  const { texts, filled } = handoffToCardTexts(h, 14)
  const cards: StoryCard[] = texts.map((text, i) => ({ id: i + 1, role: STORY_ROLES[i] ?? `シーン${i + 1}`, text }))
  return { theme: h.title, cards, filled }
}

// ── Component ────────────────────────────────────────────

export function WizardMode({ onClose, initialScript, onInitialScriptConsumed }: WizardModeProps) {
  const [seed] = useState(() => (initialScript ? seedFromScript(initialScript) : null))
  const [step, setStep] = useState(seed ? 2 : 1)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [state, setState] = useState<WizardState>({
    theme: seed?.theme ?? '',
    selectedTemplate: '',
    storyCards: seed?.cards ?? INITIAL_STORY_CARDS,
    images: Array(14).fill(null),
    imageUploading: Array(14).fill(false),
    imageErrors: Array(14).fill(null),
    bgmFile: null,
    bgmUrl: null,
    bgmUploading: false,
    bgmError: null,
    videoRequested: false,
    renderStatus: 'idle',
    renderError: null,
    videoDownloadUrl: null,
    videoFilename: null,
    selectedScene: 0,
    snsPlatform: 'Instagram',
    copiedSns: false,
    editingCardId: null,
    editingText: '',
    textAlign: 'center',
    textVerticalAlign: 'bottom',
    fontSize: 18,
    fontFamily: 'Noto Sans JP',
    advancedOpen: false,
    isGenerating: false,
    generationError: null,
    storyGenerated: Boolean(seed),
    scriptCards: seed ? { theme: seed.theme, filled: seed.filled } : null,
    ctaMode: false,
    ctaHeadline: '',
    ctaNote: '',
    ctaQrImage: null,
    ctaQrUploading: false,
    ctaQrError: null,
  })

  const imageInputRefs = useRef<(HTMLInputElement | null)[]>(Array(14).fill(null))
  const bgmInputRef = useRef<HTMLInputElement | null>(null)
  const ctaQrInputRef = useRef<HTMLInputElement | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollStartTimeRef = useRef<number | null>(null)

  // 受け渡しデータを取り込んだ（stateへ反映済み）ことを親へ知らせる。マウント時に一度だけ。
  useEffect(() => {
    if (initialScript) onInitialScriptConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current)
    }
  }, [])

  // ── 完了率計算 ───────────────────────────────────────
  const completionPct = Math.round(((step - 1) / (STEPS.length - 1)) * 100)

  // ── ユーティリティ ───────────────────────────────────
  const update = useCallback((patch: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...patch }))
  }, [])

  const filledImages = state.images.filter(Boolean).length
  const allImagesUploaded = filledImages === 14
  const hasBgm = !!state.bgmFile && !!state.bgmUrl && !state.bgmUploading
  const anyUploading = state.imageUploading.some(Boolean) || state.bgmUploading
  const step3Complete = allImagesUploaded && hasBgm && !anyUploading

  const isRendering = state.renderStatus === 'rendering' || state.renderStatus === 'preparing'
  const isCompleted = state.renderStatus === 'completed'

  // ── AIストーリー生成 ──────────────────────────────────
  const generateStoryCards = useCallback(async (theme: string, templateKey: string) => {
    update({ isGenerating: true, generationError: null })
    try {
      const presetKey = templateKey ? WIZARD_PRESET_MAP[templateKey] : undefined
      const result = await generateStory(theme, presetKey)
      const cards = normalizeToStoryCards(result.slides)
      update({ storyCards: cards, isGenerating: false, storyGenerated: true, scriptCards: null })
    } catch {
      update({
        isGenerating: false,
        generationError:
          'ストーリーの作成に失敗しました。インターネット接続を確認して、もう一度お試しください。',
      })
    }
  }, [update])

  // ── ナビゲーション ────────────────────────────────────
  const canNext: boolean[] = [
    state.theme.trim().length > 0,
    !state.isGenerating && !state.generationError && state.storyGenerated && state.storyCards.every(c => c.text.trim().length > 0),
    step3Complete,
    true,
    true,
  ]

  const goNext = () => {
    if (step === 1) {
      // 台本から作ったカードは、テーマを変えていない限りAIで作り直さない（「もう一度作り直す」で明示的に置き換える）
      if (state.scriptCards && state.theme === state.scriptCards.theme) { setStep(2); return }
      setStep(2)
      void generateStoryCards(state.theme, state.selectedTemplate)
      return
    }
    if (step < 5) setStep(s => s + 1)
  }

  // レンダー中はステップ移動をブロック
  const goBack = () => {
    if (isRendering) return
    if (step > 1) setStep(s => s - 1)
  }

  // ── 画像アップロード ──────────────────────────────────
  const handleImageChange = async (index: number, file: File | null) => {
    if (!file) return

    setState(prev => {
      const uploading = [...prev.imageUploading]
      uploading[index] = true
      const errors = [...prev.imageErrors]
      errors[index] = null
      return { ...prev, imageUploading: uploading, imageErrors: errors }
    })

    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; url?: string; message?: string }
      if (!data.ok || !data.url) throw new Error(data.message ?? 'アップロードに失敗しました')

      setState(prev => {
        const images = [...prev.images]
        images[index] = data.url!
        const uploading = [...prev.imageUploading]
        uploading[index] = false
        return { ...prev, images, imageUploading: uploading }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '画像のアップロードに失敗しました。もう一度お試しください。'
      setState(prev => {
        const uploading = [...prev.imageUploading]
        uploading[index] = false
        const errors = [...prev.imageErrors]
        errors[index] = msg
        return { ...prev, imageUploading: uploading, imageErrors: errors }
      })
    }
  }

  const removeImage = (index: number) => {
    setState(prev => {
      const images = [...prev.images]
      images[index] = null
      const errors = [...prev.imageErrors]
      errors[index] = null
      return { ...prev, images, imageErrors: errors }
    })
  }

  // ── BGMアップロード ───────────────────────────────────
  const handleBgmChange = async (file: File | null) => {
    if (!file) return

    update({ bgmUploading: true, bgmError: null, bgmFile: file.name, bgmUrl: null })

    try {
      const formData = new FormData()
      formData.append('audio', file)
      const res = await fetch('/api/upload-audio', { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; message?: string }
      if (!data.ok) throw new Error(data.message ?? 'BGMのアップロードに失敗しました')

      update({ bgmUploading: false, bgmUrl: '/assets/audio/bgm.mp3' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'BGMのアップロードに失敗しました。もう一度お試しください。'
      update({ bgmUploading: false, bgmError: msg, bgmFile: null, bgmUrl: null })
    }
  }

  // ── QRコードアップロード ──────────────────────────────
  const handleCtaQrChange = async (file: File | null) => {
    if (!file) return

    update({ ctaQrUploading: true, ctaQrError: null })

    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; url?: string; message?: string }
      if (!data.ok || !data.url) throw new Error(data.message ?? 'アップロードに失敗しました')

      update({ ctaQrUploading: false, ctaQrImage: data.url })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'QRコードのアップロードに失敗しました。'
      update({ ctaQrUploading: false, ctaQrError: msg })
    }
  }

  // ── /api/render/status ポーリング（タイムアウト付き） ─
  const pollRenderStatus = useCallback(() => {
    pollStartTimeRef.current = Date.now()

    const tick = async () => {
      // タイムアウトチェック
      if (
        pollStartTimeRef.current !== null &&
        Date.now() - pollStartTimeRef.current > POLL_TIMEOUT_MS
      ) {
        update({
          renderStatus: 'failed',
          renderError:
            '動画の生成に時間がかかりすぎています。しばらく時間をおいてから、もう一度お試しください。',
        })
        return
      }

      try {
        const res = await fetch('/api/render/status')
        const data = await res.json() as {
          ok: boolean
          status: string
          outputFile?: string | null
          downloadUrl?: string | null
          error?: string | null
        }
        if (data.status === 'completed' && data.downloadUrl && data.outputFile) {
          update({
            renderStatus: 'completed',
            videoDownloadUrl: data.downloadUrl,
            videoFilename: data.outputFile,
          })
        } else if (data.status === 'failed') {
          update({
            renderStatus: 'failed',
            renderError: data.error ?? '動画の生成に失敗しました。もう一度お試しください。',
          })
        } else {
          pollTimerRef.current = setTimeout(() => { void tick() }, 4000)
        }
      } catch {
        update({
          renderStatus: 'failed',
          renderError: '動画生成の状態を確認できませんでした。ネットワーク接続を確認してください。',
        })
      }
    }
    void tick()
  }, [update])

  // ── 動画作成（slides保存 → render起動 → ポーリング） ────
  const handleCreateVideo = useCallback(async () => {
    const missingImages = state.images.filter(img => !img).length
    if (missingImages > 0 || !state.bgmUrl) return

    update({
      renderStatus: 'preparing',
      renderError: null,
      videoDownloadUrl: null,
      videoFilename: null,
      videoRequested: true,
    })

    // テキスト縦位置 → layout に変換（通常スライド）
    const layoutFromVertical = (v: 'top' | 'center' | 'bottom'): 'top' | 'center' | 'bottom' => v

    const slidesPayload = {
      title: state.theme,
      slides: state.storyCards.map((card, i) => {
        const [headline, subline = ''] = card.text.split('\n')
        const isLastSlide = i === 13
        if (isLastSlide && state.ctaMode) {
          // 14枚目 CTAモード
          return {
            id: card.id,
            headline: state.ctaHeadline || headline,
            subline: state.ctaNote || subline,
            image: state.images[i] ?? '',
            durationSec: 4,
            visible: true,
            layout: 'cta' as const,
            showParticles: false,
            emphasis: '',
            imagePrompt: '',
            ctaLabel: state.ctaHeadline || headline,
            ctaNote: state.ctaNote || '',
          }
        }
        return {
          id: card.id,
          headline,
          subline,
          image: state.images[i] ?? '',
          durationSec: 3,
          visible: true,
          layout: layoutFromVertical(state.textVerticalAlign),
          showParticles: false,
          emphasis: '',
          imagePrompt: '',
        }
      }),
      // CTAモードONでQRコードあれば保存。ファイル名のみを渡す（/assets/ 以下のパス）
      cta: state.ctaMode && state.ctaQrImage
        ? { qrImage: state.ctaQrImage.replace(/^\/assets\//, '') }
        : {},
    }

    try {
      const slidesRes = await fetch('/api/slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slidesPayload),
      })
      const slidesData = await slidesRes.json() as { ok: boolean; message?: string }
      if (!slidesData.ok) throw new Error(slidesData.message ?? 'スライドデータの保存に失敗しました')

      update({ renderStatus: 'rendering' })
      const renderRes = await fetch('/api/render', { method: 'POST' })
      const renderData = await renderRes.json() as { ok: boolean; message?: string }
      if (!renderData.ok) throw new Error(renderData.message ?? '動画生成の開始に失敗しました')

      pollRenderStatus()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '動画の作成に失敗しました。もう一度お試しください。'
      update({ renderStatus: 'failed', renderError: msg })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, update, pollRenderStatus])

  // ── 動画作成ボタン → 確認モーダルを表示 ──────────────
  const handleRequestVideo = () => setShowConfirmModal(true)

  // ── 「もう一度編集する」— レンダー状態をリセットして STEP4 へ ──
  const handleEditAgain = () => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollStartTimeRef.current = null
    update({
      renderStatus: 'idle',
      renderError: null,
      videoDownloadUrl: null,
      videoFilename: null,
    })
    setStep(4)
  }

  // ── SNSコピー ─────────────────────────────────────────
  const copySnsCaption = () => {
    const text = SNS_CAPTIONS[state.snsPlatform] ?? ''
    void navigator.clipboard.writeText(text)
    update({ copiedSns: true })
    setTimeout(() => update({ copiedSns: false }), 2000)
  }

  // ── ストーリー編集 ────────────────────────────────────
  const startEdit = (card: StoryCard) => {
    update({ editingCardId: card.id, editingText: card.text })
  }
  const saveEdit = () => {
    setState(prev => ({
      ...prev,
      storyCards: prev.storyCards.map(c =>
        c.id === prev.editingCardId ? { ...c, text: prev.editingText } : c
      ),
      editingCardId: null,
      editingText: '',
    }))
  }
  const cancelEdit = () => update({ editingCardId: null, editingText: '' })

  // ── Render ────────────────────────────────────────────
  return (
    <>
      <div className="wz-overlay">
        {/* ── ヘッダー ── */}
        <header className="wz-header">
          <div className="wz-header-inner">
            <div className="wz-logo">
              <div className="wz-logo-icon">▶</div>
              <span className="wz-logo-name">BeMyStyle Reel</span>
            </div>

            <nav className="wz-progress" aria-label="作成ステップ">
              {STEPS.map((s, i) => {
                const state_ = step > s.num ? 'done' : step === s.num ? 'active' : 'future'
                return (
                  <React.Fragment key={s.num}>
                    {i > 0 && (
                      <div className={`wz-progress-connector${step > s.num ? ' wz-progress-connector--done' : ''}`} />
                    )}
                    <div className={`wz-progress-step wz-progress-step--${state_}`}>
                      <div className="wz-progress-step-inner">
                        <div className="wz-progress-circle">
                          {state_ === 'done' ? '✓' : s.num}
                        </div>
                        <span className="wz-progress-label">{s.label}</span>
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </nav>

            <div className="wz-header-right">
              <div className="wz-autosave">
                <div className="wz-autosave-dot" />
                自動保存済み
              </div>
              {onClose && (
                <button className="wz-exit-btn" onClick={onClose} disabled={isRendering}>
                  ← 通常モードへ
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── 完了率バー ── */}
        <div className="wz-completion-bar-wrap">
          <div className="wz-completion-bar-inner">
            <span className="wz-completion-label">完成度</span>
            <div className="wz-completion-track">
              <div className="wz-completion-fill" style={{ width: `${completionPct}%` }} />
            </div>
            <span className="wz-completion-pct">{completionPct}%</span>
          </div>
        </div>

        {/* ── メインコンテンツ ── */}
        <main className="wz-main">
          <div className="wz-content">
            {step === 1 && (
              <Step1
                state={state}
                update={update}
                onGoNext={goNext}
              />
            )}
            {step === 2 && (
              <Step2
                state={state}
                update={update}
                onRegenerate={() => { void generateStoryCards(state.theme, state.selectedTemplate) }}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={cancelEdit}
              />
            )}
            {step === 3 && (
              <Step3
                state={state}
                isRendering={isRendering}
                imageInputRefs={imageInputRefs}
                bgmInputRef={bgmInputRef}
                onImageChange={(i, f) => { void handleImageChange(i, f) }}
                onRemoveImage={removeImage}
                onBgmChange={(f) => { void handleBgmChange(f) }}
              />
            )}
            {step === 4 && (
              <Step4
                state={state}
                isRendering={isRendering}
                update={update}
                ctaQrInputRef={ctaQrInputRef}
                onCtaQrChange={(f) => { void handleCtaQrChange(f) }}
              />
            )}
            {step === 5 && (
              <Step5
                state={state}
                update={update}
                onCopy={copySnsCaption}
                onEditAgain={handleEditAgain}
                onCreateVideo={handleRequestVideo}
              />
            )}
          </div>
        </main>

        {/* ── フッターナビ ── */}
        <footer className="wz-footer">
          <div className="wz-footer-inner">
            <p className="wz-footer-hint">
              {step === 1 && 'テーマを入力して、ストーリーを作りましょう'}
              {step === 2 && '14枚のシーンを確認・編集できます'}
              {step === 3 && `画像 ${filledImages}/14${hasBgm ? '・BGM 1/1' : '・BGM 未設定'}`}
              {step === 4 && 'シーンを選んで内容を調整しましょう'}
              {step === 5 && isRendering && '動画を生成中です。完了まで他のステップには戻れません。'}
              {step === 5 && !isRendering && '動画が完成しました！ダウンロードしてSNSに投稿しましょう'}
            </p>
            <div className="wz-footer-nav">
              {step > 1 && step < 5 && (
                <button
                  className="wz-btn wz-btn--secondary"
                  onClick={goBack}
                  disabled={isRendering}
                >
                  ← 戻る
                </button>
              )}
              {step < 5 && (
                <button
                  className="wz-btn wz-btn--primary"
                  onClick={goNext}
                  disabled={!canNext[step - 1]}
                >
                  {step === 2 ? 'この内容で次へ →' :
                   step === 3 ? '動画を作りに進む →' :
                   step === 4 ? '動画を仕上げる →' :
                   '次へ →'}
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>

      {/* ── 動画作成 確認モーダル ── */}
      {showConfirmModal && (
        <div className="wz-modal-backdrop">
          <div className="wz-modal">
            <h2 className="wz-modal-title">🎬 動画を作成しますか？</h2>
            <p className="wz-modal-desc">以下の内容で動画を生成します。</p>
            <ul className="wz-modal-specs">
              <li>🖼️ 画像 14枚</li>
              <li>🎵 BGM 1曲</li>
              <li>⏱️ 動画の長さ：約 45 秒</li>
              <li>⏳ 生成に 2〜5 分ほどかかります</li>
            </ul>
            {isCompleted && (
              <div className="wz-modal-overwrite">
                ⚠️ 前回の動画は上書きされます
              </div>
            )}
            <div className="wz-modal-btns">
              <button
                className="wz-btn wz-btn--secondary"
                onClick={() => setShowConfirmModal(false)}
              >
                キャンセル
              </button>
              <button
                className="wz-btn wz-btn--cta"
                onClick={() => {
                  setShowConfirmModal(false)
                  void handleCreateVideo()
                }}
              >
                作成する
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════
// STEP 1 — 入力
// ══════════════════════════════════════════════════════════

function Step1({
  state,
  update,
  onGoNext,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  onGoNext: () => void
}) {
  return (
    <div>
      <div className="wz-step-heading">
        <h1>どんな動画を作りますか？</h1>
        <p>テーマを入力するだけで、14枚構成のストーリーを自動で作ります。</p>
      </div>

      <div className="wz-input-card">
        <p className="wz-input-card-title">テンプレートから選ぶ</p>
        <div className="wz-template-chips">
          {TEMPLATE_CHIPS.map(t => (
            <button
              key={t.key}
              className={`wz-template-chip${state.selectedTemplate === t.key ? ' wz-template-chip--active' : ''}`}
              onClick={() => {
                update({ selectedTemplate: t.key })
                if (!state.theme) update({ theme: t.label })
              }}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wz-input-card">
        <p className="wz-input-card-title">テーマを入力する</p>
        <input
          className="wz-theme-input"
          type="text"
          placeholder="例：歌が上手くなる方法"
          value={state.theme}
          onChange={e => update({ theme: e.target.value })}
          maxLength={100}
        />
        <div className="wz-examples">
          <span className="wz-examples-label">入力例</span>
          {EXAMPLE_THEMES.map(ex => (
            <button
              key={ex}
              className="wz-example-chip"
              onClick={() => update({ theme: ex })}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="wz-info-box">
        <span>💡</span>
        <span>
          AIはテキストのストーリーのみ作成します。
          画像とBGMは次のステップでアップロードしていただきます。
        </span>
      </div>

      <div className="wz-step1-cta" style={{ marginTop: 24 }}>
        <button
          className="wz-btn wz-btn--cta wz-btn--lg"
          disabled={!state.theme.trim()}
          onClick={onGoNext}
        >
          ✨ AIでストーリーを作る
        </button>
      </div>

      {!state.theme.trim() && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--wz-text-3)', marginTop: 8 }}>
          テーマを入力すると「次へ」が押せます
        </p>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// STEP 2 — ストーリー作成
// ══════════════════════════════════════════════════════════

function Step2({
  state,
  update,
  onRegenerate,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  onRegenerate: () => void
  onStartEdit: (c: StoryCard) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}) {
  const totalChars = state.storyCards.reduce((s, c) => s + c.text.length, 0)
  const avgChars = Math.round(totalChars / 14)
  const emptyCards = state.storyCards.filter(c => !c.text.trim()).length

  if (state.isGenerating) {
    return (
      <div>
        <div className="wz-step-heading">
          <h1>ストーリーを作成中…</h1>
          <p>テーマ「{state.theme}」の14枚のシーンを生成しています</p>
        </div>
        <div className="wz-step2-loading">
          <div className="wz-loading-spinner" />
          <p className="wz-loading-message">AIがストーリーを作成中です...</p>
          <p className="wz-loading-sub">10〜20秒ほどかかります。そのままお待ちください。</p>
        </div>
      </div>
    )
  }

  if (state.generationError) {
    return (
      <div>
        <div className="wz-step-heading">
          <h1>ストーリーの作成に失敗しました</h1>
          <p>下のボタンからもう一度試してみてください。</p>
        </div>
        <div className="wz-step2-error">
          <span className="wz-step2-error-icon">😢</span>
          <p className="wz-step2-error-msg">{state.generationError}</p>
          <button className="wz-btn wz-btn--cta wz-btn--lg" onClick={onRegenerate}>
            🔄 もう一度試す
          </button>
          <p style={{ fontSize: 12, color: 'var(--wz-text-3)', marginTop: 8 }}>
            ストーリーが作成されるまで次のステップには進めません
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="wz-step-heading">
        <h1>「{state.theme}」のストーリー</h1>
        <p>14枚のシーンを確認しましょう。気に入らない箇所は編集できます。</p>
      </div>

      {state.scriptCards && (
        <div className="wz-info-box" style={{ marginBottom: 12 }}>
          <span>📝</span>
          <span style={{ fontSize: 13 }}>
            台本から{state.scriptCards.filled}枚のシーンを作成しました（AIは使っていません）。
            {emptyCards > 0 && ` 空のシーンが${emptyCards}枚あります。「編集」で入力すると次へ進めます。`}
            {' '}「もう一度作り直す」を押すと、AIが同じテーマで作り直し、この台本の内容は置き換わります。
          </span>
        </div>
      )}

      <div className="wz-step2-layout">
        <div className="wz-story-cards">
          {state.storyCards.map(card => (
            <div key={card.id} className="wz-story-card">
              <div className="wz-story-num">{card.id}</div>
              <div className="wz-story-body">
                <div className="wz-story-role">{card.role}</div>
                {state.editingCardId === card.id ? (
                  <textarea
                    className="wz-story-text-input"
                    value={state.editingText}
                    onChange={e => update({ editingText: e.target.value })}
                    autoFocus
                  />
                ) : (
                  <div className="wz-story-text">{card.text}</div>
                )}
              </div>
              <div className="wz-story-actions">
                {state.editingCardId === card.id ? (
                  <>
                    <button className="wz-btn wz-btn--primary wz-btn--sm" onClick={onSaveEdit}>保存</button>
                    <button className="wz-btn wz-btn--ghost wz-btn--sm" onClick={onCancelEdit}>取消</button>
                  </>
                ) : (
                  <button
                    className="wz-btn wz-btn--secondary wz-btn--sm"
                    onClick={() => onStartEdit(card)}
                  >
                    編集
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="wz-summary-sticky">
          <div className="wz-summary-card">
            <p className="wz-summary-card-title">ストーリー概要</p>
            <div className="wz-summary-row">
              <span className="wz-summary-row-label">シーン数</span>
              <span className="wz-summary-row-value">14枚</span>
            </div>
            <div className="wz-summary-row">
              <span className="wz-summary-row-label">想定時間</span>
              <span className="wz-summary-row-value">約 45〜60 秒</span>
            </div>
            <div className="wz-summary-row">
              <span className="wz-summary-row-label">1枚あたり</span>
              <span className="wz-summary-row-value">平均 {avgChars} 文字</span>
            </div>
            <div className="wz-summary-row">
              <span className="wz-summary-row-label">SNS向き</span>
              <span>
                <span className="wz-badge wz-badge--green">Instagram ◎</span>
              </span>
            </div>
            <div className="wz-summary-row">
              <span className="wz-summary-row-label"> </span>
              <span>
                <span className="wz-badge wz-badge--purple">TikTok ◎</span>
              </span>
            </div>
            <div className="wz-summary-row">
              <span className="wz-summary-row-label">文字量</span>
              <span>
                <span className={`wz-badge ${avgChars <= 30 ? 'wz-badge--green' : 'wz-badge--yellow'}`}>
                  {avgChars <= 30 ? '読みやすい' : '少し多め'}
                </span>
              </span>
            </div>
          </div>

          <div className="wz-step2-ctas">
            <button className="wz-btn wz-btn--secondary" style={{ width: '100%' }} onClick={onRegenerate}>
              🔄 もう一度作り直す
            </button>
          </div>

          <div className="wz-info-box" style={{ marginTop: 12 }}>
            <span>💡</span>
            <span style={{ fontSize: 12 }}>各シーンの「編集」ボタンでテキストを自由に変更できます</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// STEP 3 — 素材アップロード
// ══════════════════════════════════════════════════════════

function Step3({
  state,
  isRendering,
  imageInputRefs,
  bgmInputRef,
  onImageChange,
  onRemoveImage,
  onBgmChange,
}: {
  state: WizardState
  isRendering: boolean
  imageInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>
  bgmInputRef: React.MutableRefObject<HTMLInputElement | null>
  onImageChange: (i: number, f: File | null) => void
  onRemoveImage: (i: number) => void
  onBgmChange: (f: File | null) => void
}) {
  const filledImages = state.images.filter(Boolean).length
  const bgmReady = !!state.bgmFile && !!state.bgmUrl && !state.bgmUploading
  const anyUploading = state.imageUploading.some(Boolean) || state.bgmUploading
  const allDone = filledImages === 14 && bgmReady && !anyUploading

  const handleDrop = (index: number, e: React.DragEvent) => {
    e.preventDefault()
    if (isRendering) return
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) onImageChange(index, file)
  }

  return (
    <div className="wz-step3-layout">
      <div className="wz-step-heading">
        <h1>素材をアップロードしましょう</h1>
        <p>14枚の画像とBGMを準備してください。縦長（9:16）の画像が最適です。</p>
      </div>

      {/* レンダー中ロック通知 */}
      {isRendering && (
        <div className="wz-render-lock-notice">
          🔒 動画を生成中のため、素材の変更はできません。完了後に編集できます。
        </div>
      )}

      <div className={`wz-upload-hint${allDone ? ' wz-upload-hint--complete' : ''}`}>
        <span>{anyUploading ? '⏳' : allDone ? '✅' : '⚠️'}</span>
        {anyUploading
          ? 'アップロード中です。完了するまでお待ちください…'
          : allDone
          ? 'すべての素材がそろいました！「次へ」を押して動画を作りましょう。'
          : `まだ素材が足りません。画像 ${filledImages}/14${bgmReady ? '・BGM 準備OK' : '・BGM 未設定'}`}
      </div>

      {/* 画像アップロード */}
      <div className={`wz-upload-section${isRendering ? ' wz-upload-section--locked' : ''}`}>
        <div className="wz-upload-section-header">
          <span className="wz-upload-section-title">
            🖼️ 画像をアップロード
          </span>
          <span className={`wz-upload-count${filledImages === 14 ? ' wz-upload-count--complete' : ''}`}>
            {filledImages} / 14
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--wz-text-3)', marginBottom: 16, lineHeight: 1.6 }}>
          各シーンに対応する画像を選んでください。クリックまたはドラッグ＆ドロップで追加できます。縦長（9:16）推奨。
        </p>
        <div className="wz-image-grid">
          {state.images.map((img, i) => {
            const isUploading = state.imageUploading[i]
            const error = state.imageErrors[i]
            return (
              <div
                key={i}
                className={`wz-image-slot${img ? ' wz-image-slot--filled' : ''}${isUploading ? ' wz-image-slot--uploading' : ''}${error ? ' wz-image-slot--error' : ''}${isRendering ? ' wz-image-slot--locked' : ''}`}
                onClick={() => {
                  if (!img && !isUploading && !isRendering) {
                    const input = imageInputRefs.current[i]
                    if (input) { input.value = ''; input.click() }
                  }
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { if (!isUploading) handleDrop(i, e) }}
              >
                <span className="wz-image-slot-num">{i + 1}</span>
                {isUploading ? (
                  <div className="wz-slot-uploading">
                    <div className="wz-slot-spinner" />
                    <span className="wz-slot-uploading-text">保存中…</span>
                  </div>
                ) : img ? (
                  <>
                    <img src={img} alt={`scene ${i + 1}`} className="wz-image-slot-preview" />
                    {!isRendering && (
                      <button
                        className="wz-image-slot-remove"
                        onClick={e => { e.stopPropagation(); onRemoveImage(i) }}
                      >
                        ✕
                      </button>
                    )}
                  </>
                ) : error ? (
                  <div className="wz-slot-error">
                    <span className="wz-slot-error-icon">⚠️</span>
                    <span className="wz-slot-error-text">失敗</span>
                    <span className="wz-slot-error-retry">タップして再試行</span>
                  </div>
                ) : (
                  <>
                    <span className="wz-image-slot-icon">＋</span>
                    <span className="wz-image-slot-label">シーン{i + 1}</span>
                  </>
                )}
                <input
                  ref={el => { imageInputRefs.current[i] = el }}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={isRendering}
                  onChange={e => onImageChange(i, e.target.files?.[0] ?? null)}
                />
              </div>
            )
          })}
        </div>

        {state.imageErrors.some(Boolean) && (
          <div className="wz-upload-errors">
            {state.imageErrors.map((err, i) => err && (
              <div key={i} className="wz-upload-error-row">
                <span>シーン{i + 1}：{err}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BGMアップロード */}
      <div className={`wz-upload-section${isRendering ? ' wz-upload-section--locked' : ''}`}>
        <div className="wz-upload-section-header">
          <span className="wz-upload-section-title">
            🎵 BGMをアップロード
          </span>
          <span className={`wz-upload-count${bgmReady ? ' wz-upload-count--complete' : ''}`}>
            {bgmReady ? '1 / 1' : '0 / 1'}
          </span>
        </div>

        {state.bgmUploading ? (
          <div className="wz-bgm-uploading">
            <div className="wz-slot-spinner" />
            <span>BGMを保存中です…</span>
          </div>
        ) : state.bgmError ? (
          <div className="wz-bgm-error-row">
            <span className="wz-bgm-error-icon">⚠️</span>
            <span className="wz-bgm-error-text">{state.bgmError}</span>
            <button
              className="wz-btn wz-btn--secondary wz-btn--sm"
              disabled={isRendering}
              onClick={() => {
                const input = bgmInputRef.current
                if (input) { input.value = ''; input.click() }
              }}
            >
              再試行
            </button>
          </div>
        ) : (
          <div
            className={`wz-bgm-upload${bgmReady ? ' wz-bgm-upload--filled' : ''}${isRendering ? ' wz-bgm-upload--locked' : ''}`}
            onClick={() => !isRendering && bgmInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              if (isRendering) return
              const file = e.dataTransfer.files[0]
              if (file && file.type.startsWith('audio/')) onBgmChange(file)
            }}
          >
            <span className="wz-bgm-upload-icon">{bgmReady ? '✅' : '🎵'}</span>
            {bgmReady ? (
              <span className="wz-bgm-filename">✓ {state.bgmFile} （保存済み）</span>
            ) : (
              <>
                <span className="wz-bgm-upload-text">クリックまたはドラッグ＆ドロップ</span>
                <span className="wz-bgm-upload-sub">MP3、WAV、M4A 対応 ／ 最大 50MB</span>
              </>
            )}
          </div>
        )}

        <input
          ref={bgmInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          disabled={isRendering}
          onChange={e => onBgmChange(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// STEP 4 — 編集
// ══════════════════════════════════════════════════════════

function Step4({
  state,
  isRendering,
  update,
  ctaQrInputRef,
  onCtaQrChange,
}: {
  state: WizardState
  isRendering: boolean
  update: (p: Partial<WizardState>) => void
  ctaQrInputRef: React.MutableRefObject<HTMLInputElement | null>
  onCtaQrChange: (f: File | null) => void
}) {
  const totalScenes = state.storyCards.length
  const safeScene = Math.min(Math.max(state.selectedScene, 0), totalScenes - 1)
  const card = state.storyCards[safeScene]
  const img = state.images[safeScene] ?? null

  // プレビューの縦位置スタイル
  const verticalAlignStyle: React.CSSProperties = {
    justifyContent:
      state.textVerticalAlign === 'top' ? 'flex-start' :
      state.textVerticalAlign === 'bottom' ? 'flex-end' : 'center',
    paddingTop: state.textVerticalAlign === 'top' ? 24 : 0,
    paddingBottom: state.textVerticalAlign === 'bottom' ? 24 : 0,
  }

  return (
    <div>
      <div className="wz-step-heading">
        <h1>動画を仕上げましょう</h1>
        <p>各シーンのテキストや見た目を調整できます。左のサムネイルでシーンを切り替えてください。</p>
      </div>

      {/* レンダー中ロック通知 */}
      {isRendering && (
        <div className="wz-render-lock-notice">
          🔒 動画を生成中のため、テキスト編集はできません。完了後に「もう一度編集する」から戻れます。
        </div>
      )}

      <div className="wz-step4-bgm-row">
        {state.bgmFile ? (
          <div className="wz-step4-bgm-badge wz-step4-bgm-badge--set">
            <span>🎵</span>
            <span className="wz-step4-bgm-name">{state.bgmFile}</span>
            <span className="wz-step4-bgm-chip">BGM 設定済み</span>
          </div>
        ) : (
          <div className="wz-step4-bgm-badge wz-step4-bgm-badge--unset">
            <span>🎵</span>
            <span>BGM 未設定 — STEP3 で追加できます</span>
          </div>
        )}
      </div>

      <div className="wz-step4-layout">
        {/* シーン一覧 */}
        <div className="wz-scene-list">
          {state.storyCards.map((c, i) => (
            <div
              key={c.id}
              className={`wz-scene-thumb${safeScene === i ? ' wz-scene-thumb--active' : ''}${i === 13 && state.ctaMode ? ' wz-scene-thumb--cta' : ''}`}
              onClick={() => update({ selectedScene: i })}
            >
              {state.images[i] ? (
                <img src={state.images[i]!} alt="" className="wz-scene-thumb-img" />
              ) : (
                <div className="wz-scene-empty">
                  <span className="wz-scene-empty-num">{i + 1}</span>
                  <span className="wz-scene-empty-icon">🖼️</span>
                  <span className="wz-scene-empty-text">未設定</span>
                </div>
              )}
              <div className="wz-scene-thumb-label">
                {c.id}. {c.role}
                {i === 13 && state.ctaMode && <span className="wz-scene-cta-badge">CTA</span>}
              </div>
            </div>
          ))}
        </div>

        {/* プレビュー */}
        <div className="wz-preview-area">
          <div className="wz-preview-phone">
            {img && (
              <img src={img} alt="" className="wz-preview-image" />
            )}
            <div className="wz-preview-text-overlay" style={verticalAlignStyle}>
              <p
                className="wz-preview-text-content"
                style={{
                  textAlign: state.textAlign,
                  fontSize: state.fontSize,
                }}
              >
                {card?.text}
              </p>
            </div>
            {!img && (
              <div className="wz-preview-placeholder">
                <span className="wz-preview-placeholder-icon">🖼️</span>
                <span className="wz-preview-placeholder-scene">シーン {safeScene + 1}</span>
                <span>画像が未設定です</span>
                <span className="wz-preview-placeholder-hint">STEP3 で画像を追加できます</span>
              </div>
            )}
          </div>
          <div className="wz-preview-controls">
            <button
              className="wz-preview-ctrl-btn"
              onClick={() => update({ selectedScene: Math.max(0, safeScene - 1) })}
              disabled={safeScene === 0}
            >
              ◀
            </button>
            <span style={{ fontSize: 13, color: 'var(--wz-text-2)', minWidth: 50, textAlign: 'center' }}>
              {safeScene + 1} / {totalScenes}
            </span>
            <button
              className="wz-preview-ctrl-btn"
              onClick={() => update({ selectedScene: Math.min(totalScenes - 1, safeScene + 1) })}
              disabled={safeScene === totalScenes - 1}
            >
              ▶
            </button>
          </div>
        </div>

        {/* 編集パネル */}
        <div className="wz-edit-panel">
          <div className="wz-edit-panel-header">
            シーン {safeScene + 1}：{card?.role} を編集
          </div>
          <div className="wz-edit-panel-body">

            <div className="wz-edit-field">
              <label className="wz-edit-label">テキスト</label>
              <textarea
                className="wz-edit-input wz-edit-textarea"
                value={card?.text ?? ''}
                disabled={isRendering}
                onChange={e => {
                  if (isRendering) return
                  const updated = state.storyCards.map((c, i) =>
                    i === safeScene ? { ...c, text: e.target.value } : c
                  )
                  update({ storyCards: updated })
                }}
              />
            </div>

            <div className="wz-edit-field">
              <label className="wz-edit-label">文字の横位置</label>
              <div className="wz-align-btns">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button
                    key={a}
                    className={`wz-align-btn${state.textAlign === a ? ' wz-align-btn--active' : ''}`}
                    disabled={isRendering}
                    onClick={() => update({ textAlign: a })}
                  >
                    {a === 'left' ? '≡ 左' : a === 'center' ? '≡ 中央' : '≡ 右'}
                  </button>
                ))}
              </div>
            </div>

            <div className="wz-edit-field">
              <label className="wz-edit-label">文字の縦位置</label>
              <div className="wz-align-btns">
                {(['top', 'center', 'bottom'] as const).map(v => (
                  <button
                    key={v}
                    className={`wz-align-btn${state.textVerticalAlign === v ? ' wz-align-btn--active' : ''}`}
                    disabled={isRendering}
                    onClick={() => update({ textVerticalAlign: v })}
                  >
                    {v === 'top' ? '↑ 上' : v === 'center' ? '⬛ 中央' : '↓ 下'}
                  </button>
                ))}
              </div>
              <p className="wz-edit-hint">
                ※ セーフエリアを考慮しています。全スライドに共通で適用されます。
              </p>
            </div>

            <div className="wz-edit-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="wz-edit-label">文字サイズ</label>
                <span style={{ fontSize: 12, color: 'var(--wz-text-2)', fontWeight: 600 }}>{state.fontSize}px</span>
              </div>
              <input
                type="range"
                className="wz-slider"
                min={12}
                max={32}
                value={state.fontSize}
                disabled={isRendering}
                onChange={e => update({ fontSize: Number(e.target.value) })}
              />
            </div>

            <div className="wz-edit-field">
              <label className="wz-edit-label">フォント</label>
              <select
                className="wz-edit-input wz-edit-select"
                value={state.fontFamily}
                disabled={isRendering}
                onChange={e => update({ fontFamily: e.target.value })}
              >
                <option value="Noto Sans JP">Noto Sans JP（推奨）</option>
                <option value="serif">明朝体</option>
                <option value="Hiragino Kaku Gothic Pro">ヒラギノ角ゴ</option>
              </select>
            </div>

            <div>
              <div
                className="wz-collapse-toggle"
                onClick={() => update({ advancedOpen: !state.advancedOpen })}
              >
                <span>詳細設定</span>
                <span className={`wz-collapse-arrow${state.advancedOpen ? ' wz-collapse-arrow--open' : ''}`}>▼</span>
              </div>
              {state.advancedOpen && (
                <div className="wz-collapse-content">
                  <div className="wz-edit-field">
                    <label className="wz-edit-label">アニメーション</label>
                    <select className="wz-edit-input wz-edit-select" disabled={isRendering}>
                      <option>フェードイン</option>
                      <option>スライドアップ</option>
                      <option>ズームイン</option>
                      <option>なし</option>
                    </select>
                  </div>
                  <div className="wz-edit-field">
                    <label className="wz-edit-label">表示時間（秒）</label>
                    <input type="number" className="wz-edit-input" min={1} max={10} defaultValue={3} disabled={isRendering} />
                  </div>
                  <div className="wz-edit-field">
                    <label className="wz-edit-label">画像の配置</label>
                    <select className="wz-edit-input wz-edit-select" disabled={isRendering}>
                      <option>中央に合わせる</option>
                      <option>上に合わせる</option>
                      <option>引き伸ばす</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 14枚目 CTAモード設定 ── */}
      <div className="wz-cta-mode-section">
        <div className="wz-cta-mode-header">
          <div className="wz-cta-mode-title-row">
            <span className="wz-cta-mode-icon">🎯</span>
            <span className="wz-cta-mode-title">14枚目をCTAカードにする</span>
            <label className="wz-toggle">
              <input
                type="checkbox"
                checked={state.ctaMode}
                disabled={isRendering}
                onChange={e => update({ ctaMode: e.target.checked })}
              />
              <span className="wz-toggle-slider" />
            </label>
          </div>
          <p className="wz-cta-mode-desc">
            ONにすると14枚目がQRコード＋見出しのCTAカードになります。
          </p>
        </div>

        {state.ctaMode && (
          <div className="wz-cta-mode-body">
            <div className="wz-edit-field">
              <label className="wz-edit-label">CTA 見出し</label>
              <input
                type="text"
                className="wz-edit-input"
                placeholder="例：詳しくはプロフのリンクから"
                value={state.ctaHeadline}
                disabled={isRendering}
                onChange={e => update({ ctaHeadline: e.target.value })}
                maxLength={40}
              />
            </div>

            <div className="wz-edit-field">
              <label className="wz-edit-label">CTA 補足文</label>
              <input
                type="text"
                className="wz-edit-input"
                placeholder="例：無料診断はこちら"
                value={state.ctaNote}
                disabled={isRendering}
                onChange={e => update({ ctaNote: e.target.value })}
                maxLength={40}
              />
            </div>

            <div className="wz-edit-field">
              <label className="wz-edit-label">QRコード画像</label>
              {state.ctaQrUploading ? (
                <div className="wz-qr-uploading">
                  <div className="wz-slot-spinner" />
                  <span>アップロード中…</span>
                </div>
              ) : state.ctaQrImage ? (
                <div className="wz-qr-preview-row">
                  <img src={state.ctaQrImage} alt="QRコード" className="wz-qr-preview-img" />
                  <div className="wz-qr-preview-info">
                    <span className="wz-qr-preview-ok">✓ QRコード設定済み</span>
                    <button
                      className="wz-btn wz-btn--ghost wz-btn--sm"
                      disabled={isRendering}
                      onClick={() => {
                        update({ ctaQrImage: null })
                        if (ctaQrInputRef.current) ctaQrInputRef.current.value = ''
                      }}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`wz-qr-upload-area${isRendering ? ' wz-qr-upload-area--locked' : ''}`}
                  onClick={() => !isRendering && ctaQrInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    if (isRendering) return
                    const file = e.dataTransfer.files[0]
                    if (file && file.type.startsWith('image/')) onCtaQrChange(file)
                  }}
                >
                  <span className="wz-qr-upload-icon">📷</span>
                  <span className="wz-qr-upload-text">クリックまたはドロップでQR画像をアップロード</span>
                  <span className="wz-qr-upload-sub">PNG / JPG 推奨 ／ 最大 10MB</span>
                </div>
              )}
              {state.ctaQrError && (
                <p className="wz-edit-error">{state.ctaQrError}</p>
              )}
              <input
                ref={ctaQrInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={isRendering}
                onChange={e => onCtaQrChange(e.target.files?.[0] ?? null)}
              />
              <p className="wz-edit-hint">
                未設定の場合、14枚目は通常スライドとしてレンダーされます。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// STEP 5 — 完成
// ══════════════════════════════════════════════════════════

function Step5({
  state,
  update,
  onCopy,
  onEditAgain,
  onCreateVideo,
}: {
  state: WizardState
  update: (p: Partial<WizardState>) => void
  onCopy: () => void
  onEditAgain: () => void
  onCreateVideo: () => void
}) {
  const missingImageCount = state.images.filter(img => !img).length
  const hasBgm = !!state.bgmFile && !!state.bgmUrl
  const hasMissingAssets = missingImageCount > 0 || !hasBgm
  const isCompleted = state.renderStatus === 'completed'
  const isRendering = state.renderStatus === 'rendering' || state.renderStatus === 'preparing'
  const isFailed = state.renderStatus === 'failed'
  const canCreate = !isRendering && missingImageCount === 0 && hasBgm

  const videoViewUrl = state.videoFilename
    ? `/api/render/view/${state.videoFilename}`
    : null

  return (
    <div>
      <div className="wz-complete-hero">
        <span className="wz-complete-icon">{isCompleted ? '🎉' : '🎬'}</span>
        <h1 className="wz-complete-title">
          {isCompleted ? '動画が完成しました！' : '素材の準備ができました！'}
        </h1>
        <p className="wz-complete-sub">
          {isCompleted
            ? 'ダウンロードしてSNSに投稿しましょう。'
            : `「${state.theme}」の動画を作成しましょう。`}
        </p>
      </div>

      {hasMissingAssets && !isRendering && !isCompleted && (
        <div className="wz-step5-warnings">
          {missingImageCount > 0 && (
            <div className="wz-step5-warning">
              <span className="wz-step5-warning-icon">🖼️</span>
              <span>
                画像が <strong>{missingImageCount} 枚</strong> 未設定です。
                STEP3 に戻って追加してから動画を作成してください。
              </span>
            </div>
          )}
          {!hasBgm && (
            <div className="wz-step5-warning">
              <span className="wz-step5-warning-icon">🎵</span>
              <span>
                BGM が未設定です。
                STEP3 に戻って追加してから動画を作成してください。
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── レンダー状態別のアクションエリア ── */}
      <div className="wz-step5-create-section">
        {isRendering && (
          <div className="wz-render-progress">
            <div className="wz-render-spinner" />
            <div className="wz-render-progress-text">
              <strong>
                {state.renderStatus === 'preparing' ? 'データを準備中…' : '動画を生成中…'}
              </strong>
              <span>
                {state.renderStatus === 'preparing'
                  ? 'スライドデータを保存しています。'
                  : '動画の生成には 2〜5 分ほどかかります。このまましばらくお待ちください。'}
              </span>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="wz-render-failed">
            <span className="wz-render-failed-icon">😢</span>
            <div className="wz-render-failed-body">
              <strong>動画の生成に失敗しました</strong>
              <span>{state.renderError}</span>
            </div>
            <button
              className="wz-btn wz-btn--secondary"
              onClick={onCreateVideo}
            >
              🔄 もう一度作成する
            </button>
          </div>
        )}

        {!isRendering && !isFailed && !isCompleted && (
          <button
            className="wz-btn wz-btn--cta wz-btn--lg"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={!canCreate}
            onClick={onCreateVideo}
          >
            🎬 動画を作成する
          </button>
        )}

        {!isRendering && !isCompleted && (
          <p className="wz-step5-create-note">
            {!canCreate
              ? '※ 画像14枚・BGMをすべてアップロードしてから作成できます'
              : '※ 開始後は 2〜5 分ほどかかります'}
          </p>
        )}
      </div>

      <div className="wz-step5-layout">
        {/* 動画プレビュー */}
        <div>
          <div className="wz-final-preview">
            <div className="wz-final-preview-inner">
              {isCompleted && videoViewUrl ? (
                <video
                  src={videoViewUrl}
                  controls
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14 }}
                />
              ) : isRendering ? (
                <div className="wz-final-preview-loading">
                  <div className="wz-render-spinner" />
                  <span style={{ fontSize: 12, marginTop: 8 }}>生成中…</span>
                </div>
              ) : state.images[0] ? (
                <img
                  src={state.images[0]}
                  alt="preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14 }}
                />
              ) : (
                <>
                  <span className="wz-final-preview-icon">▶</span>
                  <span>動画プレビュー</span>
                  <span style={{ fontSize: 11 }}>（動画作成後に確認できます）</span>
                </>
              )}
            </div>
          </div>

          {/* 「もう一度編集する」：完了後またはfailed後に表示 */}
          {(isCompleted || isFailed) && (
            <button
              className="wz-btn wz-btn--ghost"
              style={{ width: '100%', marginTop: 12, justifyContent: 'center' }}
              onClick={onEditAgain}
            >
              ← もう一度編集する
            </button>
          )}
        </div>

        {/* ダウンロード＋投稿文 */}
        <div>
          <div className="wz-download-section">
            <p className="wz-download-title">ダウンロード</p>
            {!isCompleted && (
              <div className="wz-step5-download-note">
                {isRendering ? '動画の生成が完了するとダウンロードできます。' : '動画を作成すると、ここからダウンロードできます。'}
              </div>
            )}

            {/* メインダウンロードボタン（1本化） */}
            <div className="wz-download-btns">
              {isCompleted && state.videoDownloadUrl ? (
                <a
                  className="wz-download-btn wz-download-btn--primary"
                  href={state.videoDownloadUrl}
                  download={state.videoFilename ?? 'reel.mp4'}
                >
                  <span className="wz-download-btn-icon">⬇️</span>
                  <span>
                    動画をダウンロード
                    <span className="wz-download-btn-sub">縦型 9:16 MP4</span>
                  </span>
                </a>
              ) : (
                <button className="wz-download-btn wz-download-btn--disabled" disabled>
                  <span className="wz-download-btn-icon">⬇️</span>
                  <span>
                    動画をダウンロード
                    <span className="wz-download-btn-sub">動画作成後に使えます</span>
                  </span>
                </button>
              )}
            </div>

            {/* SNS対応説明 */}
            <div className="wz-download-sns-note">
              <span className="wz-download-sns-icon">📱</span>
              <span>Instagram / TikTok / YouTube Shorts に使えます</span>
            </div>

            {/*
              TODO: 将来的なSNS別出力について
              - Instagram: 1080×1920 / H.264 / 最大 60秒
              - TikTok: 1080×1920 / H.264 / 最大 3分
              - YouTube Shorts: 1080×1920 / H.264 / 最大 60秒
              現在はすべて同一のファイルを出力しているが、
              将来的にはSNS別に解像度・ビットレート・長さを最適化できる。
            */}
          </div>

          <div className="wz-sns-section">
            <p className="wz-sns-title">SNS 投稿文</p>
            <div className="wz-sns-tabs">
              {SNS_PLATFORMS.map(p => (
                <button
                  key={p}
                  className={`wz-sns-tab${state.snsPlatform === p ? ' wz-sns-tab--active' : ''}`}
                  onClick={() => update({ snsPlatform: p, copiedSns: false })}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="wz-sns-caption-box">
              <textarea
                className="wz-sns-caption-text"
                value={SNS_CAPTIONS[state.snsPlatform] ?? ''}
                readOnly
                rows={7}
              />
              <button
                className={`wz-sns-copy-btn${state.copiedSns ? ' wz-sns-copy-btn--copied' : ''}`}
                onClick={onCopy}
              >
                {state.copiedSns ? '✓ コピーしました！' : '📋 コピーする'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
