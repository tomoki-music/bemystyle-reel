import React from 'react'
import type { SimpleTemplateType } from '../../types'

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

const TEMPLATE_CARDS: { type: SimpleTemplateType; emoji: string; label: string; forWhom: string; guide: string; rank?: number }[] = [
  { type: 'mmm-event', emoji: '🎵', label: 'MMMイベント告知', forWhom: 'イベント集客したい', guide: '日時・会場・参加費が分かる時', rank: 1 },
  { type: 'note-article', emoji: '📝', label: 'Note記事紹介', forWhom: '記事アクセスを増やしたい', guide: '記事タイトルと読んでほしい人がある時', rank: 2 },
  { type: 'free-diagnosis', emoji: '🎤', label: '無料歌唱診断', forWhom: '申込みを増やしたい', guide: 'LINEや申込URLへ案内したい時', rank: 3 },
  { type: 'youtube-video', emoji: '🎬', label: 'YouTube動画紹介', forWhom: '動画再生数を増やしたい', guide: '動画の見どころを短く伝えたい時' },
  { type: 'music-community', emoji: '🎸', label: '音楽コミュニティ紹介', forWhom: '仲間募集したい', guide: '活動内容や対象者を伝えたい時' },
  { type: 'custom', emoji: '✏️', label: '自由入力', forWhom: 'テーマが決まっている', guide: 'テンプレートにない動画を作る時' },
]

interface Props {
  selected: SimpleTemplateType | null
  onSelect: (type: SimpleTemplateType) => void
}

export const SimpleTemplateSelector: React.FC<Props> = ({ selected, onSelect }) => {
  return (
    <div className="simple-type-selector">
      <p className="simple-type-selector-label">何を作りますか？</p>

      <div className="simple-first-try-banner">
        <span className="simple-first-try-label">初めてならこちら</span>
        <span className="simple-first-try-picks">🥇 MMMイベント &nbsp;または&nbsp; 🥈 Note記事</span>
      </div>

      <div className="simple-type-cards">
        {TEMPLATE_CARDS.map(({ type, emoji, label, forWhom, guide, rank }) => (
          <button
            key={type}
            className={`simple-type-card${selected === type ? ' simple-type-card--active' : ''}${rank ? ' simple-type-card--ranked' : ''}`}
            onClick={() => onSelect(type)}
            type="button"
          >
            {rank && <span className="simple-type-card-rank">{RANK_MEDALS[rank]}</span>}
            <span className="simple-type-card-emoji">{emoji}</span>
            <span className="simple-type-card-label">{label}</span>
            <span className="simple-type-card-desc">{forWhom}</span>
            <span className="simple-type-card-guide">{guide}</span>
          </button>
        ))}
      </div>

      <div className="simple-type-footer">
        <p className="simple-type-time-hint">⏱ 平均3〜5分で1本作れます</p>
        <p className="simple-type-safe-hint">投稿前にいつでも確認・修正できます</p>
      </div>
    </div>
  )
}
