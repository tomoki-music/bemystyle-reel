import React, { useCallback, useEffect, useState } from 'react'

// 5分比較用の「トークテーマ・部分強調」を確認・手動修正する最小のパネル。
// - AI候補(source:'ai')を個別に採用/却下でき、テーマ名・開始・終了・部分強調の追加/変更/削除ができる。
// - 修正した項目は「手動」になり、AI再生成で上書きされない（サーバー側で保証）。
// - 既存ジョブJSONには一切書き込まない。5分比較用データ(git管理外)だけを更新する。
// - 絶対パス・APIキーは扱わない。

const API_BASE = '/api/local-caption-videos'

type Source = 'ai' | 'manual'
type Decision = 'accepted' | 'rejected'
interface Topic { id: string; title: string; startCaptionId: string; endCaptionId: string; source: Source; decision: Decision; confidence?: number }
interface Emphasis { captionId: string; emphasisText: string; category?: string; source: Source; decision: Decision }
interface CaptionRow { id: string; startSec: number; endSec: number; text: string }
interface Payload { captions: CaptionRow[]; analysis: { topics: Topic[]; emphasis: Emphasis[] }; sections: Array<{ id: string }>; emphasisCount: number }

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  return `${m}:${String(Math.floor(sec - m * 60)).padStart(2, '0')}`
}

const sourceLabel = (s: Source) => (s === 'manual' ? '手動' : 'AI候補')

export function FiveMinuteAnalysisPanel({ jobId }: { jobId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [newCaptionId, setNewCaptionId] = useState('')
  const [newText, setNewText] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/${jobId}/five-minute`)
      if (res.status === 404 || res.status === 409) {
        setMissing(true)
        return
      }
      const json = await res.json()
      if (!json.ok) throw new Error(json.message || '読み込みに失敗しました')
      setData(json)
      setMissing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async (method: string, path: string, body?: unknown) => {
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/${jobId}/five-minute${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.message || '更新に失敗しました')
        return
      }
      await load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  if (missing) return null
  if (!data) return error ? <p role="alert">{error}</p> : null

  const cap = new Map(data.captions.map((c) => [c.id, c]))
  const options = data.captions.map((c) => (
    <option key={c.id} value={c.id}>
      {formatClock(c.startSec)} {c.id.replace('natural-', '#')}
    </option>
  ))
  const activeEmphasis = data.analysis.emphasis.filter((e) => e.decision !== 'rejected')

  return (
    <section className="lcv-panel" data-testid="five-minute-analysis-panel">
      <h2>5分比較: トークテーマ・部分強調</h2>
      <p className="lcv-muted">AIが出した候補です。修正した項目は「手動」になり、AIの再生成で上書きされません。ここでの変更は5分比較用データだけに保存され、既存の字幕データは変わりません。</p>
      {error && <p role="alert" className="lcv-error">{error}</p>}

      <h3>トークテーマ（{data.sections.length}件を表示）</h3>
      <ul className="lcv-list">
        {data.analysis.topics.map((t) => (
          <li key={t.id} data-testid={`topic-${t.id}`} style={{ opacity: t.decision === 'rejected' ? 0.5 : 1 }}>
            <span className={`lcv-badge lcv-badge--${t.source}`}>{sourceLabel(t.source)}</span>{' '}
            <input
              aria-label={`${t.id} テーマ名`}
              defaultValue={t.title}
              onBlur={(e) => {
                if (e.target.value.trim() !== t.title) void send('PATCH', `/topics/${t.id}`, { title: e.target.value })
              }}
            />{' '}
            <select aria-label={`${t.id} 開始`} value={t.startCaptionId} onChange={(e) => void send('PATCH', `/topics/${t.id}`, { startCaptionId: e.target.value })}>
              {options}
            </select>
            〜
            <select aria-label={`${t.id} 終了`} value={t.endCaptionId} onChange={(e) => void send('PATCH', `/topics/${t.id}`, { endCaptionId: e.target.value })}>
              {options}
            </select>{' '}
            {t.decision === 'rejected' ? (
              <button type="button" onClick={() => void send('POST', `/topics/${t.id}/decision`, { decision: 'accepted' })}>採用する</button>
            ) : (
              <button type="button" onClick={() => void send('POST', `/topics/${t.id}/decision`, { decision: 'rejected' })}>却下する</button>
            )}
          </li>
        ))}
      </ul>

      <h3>部分強調（{activeEmphasis.length}件）</h3>
      <ul className="lcv-list">
        {data.analysis.emphasis.map((e) => (
          <li key={e.captionId} data-testid={`emphasis-${e.captionId}`} style={{ opacity: e.decision === 'rejected' ? 0.5 : 1 }}>
            <span className={`lcv-badge lcv-badge--${e.source}`}>{sourceLabel(e.source)}</span> {formatClock(cap.get(e.captionId)?.startSec ?? 0)}{' '}
            <input
              aria-label={`${e.captionId} 強調語`}
              defaultValue={e.emphasisText}
              onBlur={(ev) => {
                if (ev.target.value !== e.emphasisText) void send('PUT', `/emphasis/${e.captionId}`, { emphasisText: ev.target.value })
              }}
            />{' '}
            {e.decision === 'rejected' ? (
              <button type="button" onClick={() => void send('POST', `/emphasis/${e.captionId}/decision`, { decision: 'accepted' })}>採用する</button>
            ) : (
              <button type="button" onClick={() => void send('DELETE', `/emphasis/${e.captionId}`)}>削除</button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <select aria-label="強調を追加するcaption" value={newCaptionId} onChange={(e) => setNewCaptionId(e.target.value)}>
          <option value="">captionを選択</option>
          {options}
        </select>{' '}
        <input aria-label="追加する強調語" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="本文の一部（2〜10文字）" />{' '}
        <button
          type="button"
          disabled={!newCaptionId || !newText}
          onClick={async () => {
            await send('PUT', `/emphasis/${newCaptionId}`, { emphasisText: newText })
            setNewText('')
          }}
        >
          強調を追加
        </button>
      </div>
    </section>
  )
}
