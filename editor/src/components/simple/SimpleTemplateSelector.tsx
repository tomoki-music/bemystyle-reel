import React from 'react'
import type { SimpleTemplateType } from '../../types'

const TEMPLATE_CARDS: { type: SimpleTemplateType; emoji: string; label: string; desc: string }[] = [
  { type: 'mmm-event', emoji: '🎵', label: 'MMMイベント告知', desc: '音楽イベントの参加者を増やす' },
  { type: 'free-diagnosis', emoji: '🎤', label: '無料歌唱診断', desc: '歌や演奏の診断キャンペーンを告知' },
  { type: 'note-article', emoji: '📝', label: 'Note記事紹介', desc: '記事の内容を短い動画で紹介' },
  { type: 'youtube-video', emoji: '🎬', label: 'YouTube動画紹介', desc: '動画の見どころをSNS用に紹介' },
  { type: 'music-community', emoji: '🎸', label: '音楽コミュニティ紹介', desc: '仲間と繋がるコミュニティを紹介' },
  { type: 'custom', emoji: '✏️', label: '自由入力', desc: 'テーマを自分で書く' },
]

interface Props {
  selected: SimpleTemplateType | null
  onSelect: (type: SimpleTemplateType) => void
}

export const SimpleTemplateSelector: React.FC<Props> = ({ selected, onSelect }) => {
  return (
    <div className="simple-type-selector">
      <p className="simple-type-selector-label">何を作りますか？</p>
      <div className="simple-type-cards">
        {TEMPLATE_CARDS.map(({ type, emoji, label, desc }) => (
          <button
            key={type}
            className={`simple-type-card${selected === type ? ' simple-type-card--active' : ''}`}
            onClick={() => onSelect(type)}
            type="button"
          >
            <span className="simple-type-card-emoji">{emoji}</span>
            <span className="simple-type-card-label">{label}</span>
            <span className="simple-type-card-desc">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
