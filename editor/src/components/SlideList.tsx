import React, { useRef } from 'react'
import { Slide } from '../types'

interface Props {
  slides: Slide[]
  selectedId: number | null
  onSelect: (id: number) => void
  onToggleVisible: (id: number) => void
  onMove: (fromIdx: number, toIdx: number) => void
}

export const SlideList: React.FC<Props> = ({
  slides,
  selectedId,
  onSelect,
  onToggleVisible,
  onMove,
}) => {
  const dragIdx = useRef<number | null>(null)
  const overIdx = useRef<number | null>(null)

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    overIdx.current = idx
  }

  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault()
    if (dragIdx.current !== null && dragIdx.current !== toIdx) {
      onMove(dragIdx.current, toIdx)
    }
    dragIdx.current = null
    overIdx.current = null
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
      {slides.map((slide, idx) => {
        const isSelected = selectedId === slide.id
        const isCTA = slide.layout === 'cta'

        return (
          <div
            key={slide.id}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onClick={() => onSelect(slide.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 14px',
              cursor: 'pointer',
              borderLeft: `3px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
              background: isSelected ? 'var(--accent-dim)' : 'transparent',
              opacity: slide.visible ? 1 : 0.38,
              transition: 'background 0.12s, opacity 0.12s',
              userSelect: 'none',
            } as React.CSSProperties}
          >
            {/* Drag handle */}
            <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 15, cursor: 'grab', flexShrink: 0 }}>
              ⠿
            </span>

            {/* Slide number badge */}
            <span
              style={{
                minWidth: 22,
                height: 22,
                borderRadius: 5,
                background: isCTA ? 'var(--accent-dark)' : 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: isCTA ? '#fff' : 'rgba(255,255,255,0.6)',
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: isSelected ? '#fff' : 'rgba(255,255,255,0.85)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.4,
                }}
              >
                {isCTA ? 'CTA スライド' : slide.headline.replace(/\n/g, ' ') || '（テキストなし）'}
              </div>
              {!isCTA && slide.subline && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.35)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}
                >
                  {slide.subline.replace(/\n/g, ' ')}
                </div>
              )}
            </div>

            {/* Visible toggle */}
            <button
              title={slide.visible ? '非表示にする' : '表示する'}
              onClick={(e) => {
                e.stopPropagation()
                onToggleVisible(slide.id)
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: slide.visible ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)',
                fontSize: 13,
                padding: 0,
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              {slide.visible ? '👁' : '–'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
