import { useCallback, useRef, useState } from 'react'
import type { GeneratedScript, ScriptHandoff, ScriptSlide } from '../../types'
import { buildScriptHandoff } from './scriptHandoff'
import './ScriptMode.css'

// 台本作成モード: コンセプト → AIが3パターンの台本 → 選択・編集 → コピー / スライド単位へ分割。
// 失敗しても入力・生成済みの台本・編集内容は残す（成功したときだけ置き換える）。

export const CONCEPT_MAX_CHARS = 1000
export const SCRIPT_MAX_CHARS = 8000

interface ScriptModeProps {
  onClose?: () => void
  /** 「この台本で動画を作る」。編集後の最新の台本（と最新の分割結果）を渡す。渡さなければボタンは出さない。 */
  onCreateVideo?: (handoff: ScriptHandoff) => void
}

const CONCEPT_EXAMPLES = ['歌が上手くなる方法', 'ボイトレ初心者向け3つのコツ', '音程改善の秘訣', 'MMMイベント告知', '無料診断キャンペーン']
const PATTERN_ICONS: Record<string, string> = { '教育系': '📚', '共感系': '💬', '煽り系': '🔥' }

/** POST してJSONを読む。ネットワーク・非JSON・ok=false はすべてメッセージ付きの Error にする。 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('サーバーへ接続できませんでした。編集UIサーバーが起動しているか確認してください。')
  }
  let data: { ok?: boolean; message?: string } & Record<string, unknown>
  try {
    data = await res.json()
  } catch {
    throw new Error(`サーバーの応答を読み取れませんでした（HTTP ${res.status}）。`)
  }
  if (!res.ok || !data.ok) throw new Error(typeof data.message === 'string' ? data.message : 'リクエストに失敗しました。')
  return data as T
}

export function ScriptMode({ onClose, onCreateVideo }: ScriptModeProps) {
  const [concept, setConcept] = useState('')
  const [patterns, setPatterns] = useState<GeneratedScript[]>([])
  const [edited, setEdited] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [splitError, setSplitError] = useState<string | null>(null)
  const [slides, setSlides] = useState<{ source: string; items: ScriptSlide[] } | null>(null)
  const [copied, setCopied] = useState(false)
  const busy = useRef(false) // 多重送信防止（state更新前の連打も止める）
  const handedOff = useRef(false)
  const [handingOff, setHandingOff] = useState(false)

  const scriptOf = (i: number) => edited[i] ?? patterns[i]?.script ?? ''
  const currentScript = selected === null ? '' : scriptOf(selected)
  const hasEdits = Object.keys(edited).length > 0
  const trimmedConcept = concept.trim()
  const conceptTooLong = [...concept].length > CONCEPT_MAX_CHARS
  const scriptTooLong = [...currentScript].length > SCRIPT_MAX_CHARS

  const generate = useCallback(async () => {
    if (busy.current || !trimmedConcept || conceptTooLong) return
    if (hasEdits && !window.confirm('再生成すると、編集した台本は置き換わります。よろしいですか？')) return
    busy.current = true
    setGenerating(true)
    setGenerateError(null)
    try {
      const data = await postJson<{ patterns: GeneratedScript[] }>('/api/generate-script', { concept: trimmedConcept })
      setPatterns(data.patterns)
      setEdited({})
      setSelected(null)
      setSlides(null)
      setSplitError(null)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : '台本の生成に失敗しました。')
    } finally {
      busy.current = false
      setGenerating(false)
    }
  }, [trimmedConcept, conceptTooLong, hasEdits])

  const split = useCallback(async () => {
    const script = currentScript.trim()
    if (busy.current || !script || scriptTooLong) return
    busy.current = true
    setSplitting(true)
    setSplitError(null)
    try {
      const data = await postJson<{ slides: ScriptSlide[] }>('/api/split-script', { script })
      setSlides({ source: script, items: data.slides })
    } catch (e) {
      setSplitError(e instanceof Error ? e.message : '台本の分割に失敗しました。')
    } finally {
      busy.current = false
      setSplitting(false)
    }
  }, [currentScript, scriptTooLong])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(currentScript)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setGenerateError('クリップボードへコピーできませんでした。台本を選択して手動でコピーしてください。')
    }
  }

  // 外部APIは呼ばない。渡すのは画面上の最新の内容（編集後の台本・最新の分割結果）だけ。
  const createVideo = () => {
    if (handedOff.current || !onCreateVideo || selected === null) return
    const handoff = buildScriptHandoff({ concept, fallbackTitle: patterns[selected]?.title, script: currentScript, slides })
    if (!handoff) return
    handedOff.current = true
    setHandingOff(true)
    try {
      onCreateVideo(handoff)
    } catch {
      handedOff.current = false
      setHandingOff(false)
    }
  }

  const disabled = generating || splitting
  const slidesStale = slides !== null && slides.source !== currentScript.trim()

  return (
    <div className="sm-page" data-testid="script-mode">
      <header className="sm-header">
        <h1>📝 台本作成</h1>
        {onClose && <button type="button" className="sm-btn sm-btn--ghost" onClick={onClose}>← 戻る</button>}
      </header>

      <main className="sm-main">
        <section className="sm-card">
          <label htmlFor="sm-concept" className="sm-label">動画のコンセプト</label>
          <textarea
            id="sm-concept"
            className="sm-textarea"
            rows={4}
            value={concept}
            disabled={generating}
            placeholder={'例：\n歌が上手くなる方法\n初心者向け\n熱量高め'}
            onChange={(e) => setConcept(e.target.value)}
          />
          <div className="sm-meta"><span className={conceptTooLong ? 'sm-over' : ''}>{[...concept].length} / {CONCEPT_MAX_CHARS}</span></div>
          <div className="sm-chips">
            {CONCEPT_EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="sm-chip" disabled={generating} onClick={() => setConcept((c) => (c ? `${c}\n${ex}` : ex))}>{ex}</button>
            ))}
          </div>
          <button type="button" className="sm-btn sm-btn--primary" disabled={disabled || !trimmedConcept || conceptTooLong} onClick={() => { void generate() }}>
            {generating ? '生成中…（10〜20秒ほどかかります）' : patterns.length ? '🔄 再生成する' : '✨ AIで台本を生成する（3パターン）'}
          </button>
          {generateError && <div className="sm-error" role="alert">⚠️ {generateError}</div>}
        </section>

        {patterns.length > 0 && (
          <section className="sm-card" aria-label="台本パターン">
            <p className="sm-label">台本パターン（選ぶと下で編集できます）</p>
            <div className="sm-patterns" role="radiogroup" aria-label="台本パターン">
              {patterns.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selected === i}
                  className={`sm-pattern${selected === i ? ' sm-pattern--selected' : ''}`}
                  disabled={disabled}
                  onClick={() => { setSelected(i); setCopied(false) }}
                >
                  <span className="sm-pattern-title">{PATTERN_ICONS[p.title] ?? '📄'} {p.title}{edited[i] !== undefined ? '（編集済み）' : ''}</span>
                  <span className="sm-pattern-body">{scriptOf(i)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {selected !== null && (
          <section className="sm-card" aria-label="台本の編集">
            <label htmlFor="sm-script" className="sm-label">台本を編集（{patterns[selected]?.title}）</label>
            <textarea
              id="sm-script"
              className="sm-textarea sm-textarea--script"
              rows={12}
              value={currentScript}
              disabled={splitting}
              onChange={(e) => { const v = e.target.value; setEdited((prev) => ({ ...prev, [selected]: v })); setCopied(false) }}
            />
            <div className="sm-meta"><span className={scriptTooLong ? 'sm-over' : ''}>{[...currentScript].length} / {SCRIPT_MAX_CHARS}</span></div>
            <div className="sm-actions">
              <button type="button" className="sm-btn sm-btn--primary" disabled={disabled || !currentScript.trim() || scriptTooLong} onClick={() => { void split() }}>
                {splitting ? '分割中…' : '✂️ スライド単位に分割'}
              </button>
              <button type="button" className="sm-btn" disabled={!currentScript.trim()} onClick={() => { void copy() }}>{copied ? '✅ コピーしました' : '📋 台本をコピー'}</button>
              {onCreateVideo && (
                <button type="button" className="sm-btn sm-btn--success" disabled={disabled || handingOff || !currentScript.trim()} onClick={createVideo}>
                  {handingOff ? '移動中…' : '🎬 この台本で動画を作る'}
                </button>
              )}
              {edited[selected] !== undefined && (
                <button type="button" className="sm-btn sm-btn--ghost" disabled={disabled} onClick={() => setEdited((prev) => { const n = { ...prev }; delete n[selected]; return n })}>↩︎ 元の台本に戻す</button>
              )}
            </div>
            {onCreateVideo && (
              <p className="sm-hint">
                {slides && !slidesStale ? `分割済みの${slides.items.length}枚を、動画作成のシーンとして渡します。` : '分割していない台本は、文ごとに区切ってシーンにします（AIは使いません）。AIで分割する場合は先に「スライド単位に分割」を押してください。'}
              </p>
            )}
            {splitError && <div className="sm-error" role="alert">⚠️ {splitError}</div>}
          </section>
        )}

        {slides && (
          <section className="sm-card" aria-label="分割結果">
            <p className="sm-label">分割結果（{slides.items.length}枚）</p>
            {slidesStale && <div className="sm-note" role="status">台本が編集されています。最新の内容で分割し直してください。</div>}
            <ol className="sm-slides">
              {slides.items.map((s, i) => <li key={i} className="sm-slide">{s.text}</li>)}
            </ol>
          </section>
        )}
      </main>
    </div>
  )
}
