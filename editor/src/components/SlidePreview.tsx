import React from 'react'
import { Slide, CTAConfig } from '../types'

interface Props {
  slide: Slide
  ctaConfig: CTAConfig
}

// Render at actual pixel dimensions, then scale down
const W = 1080
const H = 1920

function getScale(containerW: number, containerH: number) {
  return Math.min(containerW / W, containerH / H)
}

const SCALE = getScale(280, 520)

const fontBase: React.CSSProperties = {
  fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif',
  fontWeight: 700,
}

function HeadlineText({ text, emphasis }: { text: string; emphasis: string }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div style={{ textAlign: 'center', padding: '0 80px' }}>
      {lines.map((line, li) => {
        if (!emphasis || !line.includes(emphasis)) {
          return (
            <div
              key={li}
              style={{
                ...fontBase,
                fontSize: 76,
                color: '#fff',
                lineHeight: 1.4,
                letterSpacing: '0.04em',
                textShadow: '0 2px 20px rgba(0,0,0,0.7)',
              }}
            >
              {line}
            </div>
          )
        }
        const parts = line.split(emphasis)
        return (
          <div
            key={li}
            style={{
              ...fontBase,
              fontSize: 76,
              color: '#fff',
              lineHeight: 1.4,
              letterSpacing: '0.04em',
              textShadow: '0 2px 20px rgba(0,0,0,0.7)',
            }}
          >
            {parts.map((part, pi) => (
              <React.Fragment key={pi}>
                {part}
                {pi < parts.length - 1 && (
                  <span style={{ color: '#c084fc' }}>{emphasis}</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function SublineText({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div style={{ textAlign: 'center', marginTop: 40, padding: '0 100px' }}>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            ...fontBase,
            fontWeight: 400,
            fontSize: 44,
            color: 'rgba(255,255,255,0.82)',
            lineHeight: 1.7,
            letterSpacing: '0.04em',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  )
}

export const SlidePreview: React.FC<Props> = ({ slide, ctaConfig }) => {
  const isCTA = slide.layout === 'cta'
  const isBottom = slide.layout === 'bottom'

  return (
    <div
      style={{
        width: W * SCALE,
        height: H * SCALE,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        boxShadow: '0 16px 48px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.08)',
      }}
    >
      {/* Inner canvas at full resolution, scaled */}
      <div
        style={{
          width: W,
          height: H,
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {/* Background image */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: slide.image
              ? `url(${slide.image.startsWith('uploads/') ? `/assets/${slide.image}` : `/assets/slides/${slide.image}`})`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: '#1a1a2e',
          }}
        />

        {/* Gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: isCTA
              ? 'linear-gradient(to bottom, rgba(13,5,30,0.45) 0%, rgba(13,5,30,0.55) 38%, rgba(13,5,30,0.86) 72%, rgba(13,5,30,0.96) 100%)'
              : isBottom
              ? 'linear-gradient(to bottom, rgba(13,13,13,0.1) 0%, rgba(13,13,13,0.85) 100%)'
              : 'linear-gradient(to bottom, rgba(13,13,13,0.35) 0%, rgba(13,13,13,0.75) 60%, rgba(13,13,13,0.92) 100%)',
          }}
        />

        {/* Purple glow */}
        <div
          style={{
            position: 'absolute',
            top: -200,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(123,47,190,0.35) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Content */}
        {isCTA ? (
          <div style={{ position: 'absolute', inset: 0 }}>
            {slide.headline && (
              <div style={{ position: 'absolute', top: 340, left: 0, right: 0 }}>
                <HeadlineText text={slide.headline} emphasis={slide.emphasis} />
              </div>
            )}

            {/* QR block */}
            <div
              style={{
                position: 'absolute',
                top: 800,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 24,
              }}
            >
              <div
                style={{
                  width: 320,
                  height: 320,
                  background: 'white',
                  borderRadius: 20,
                  padding: 12,
                  boxSizing: 'border-box',
                  boxShadow: '0 0 40px rgba(192,132,252,0.4), 0 4px 20px rgba(0,0,0,0.5)',
                }}
              >
                <img
                  src={`/assets/${ctaConfig.qrImage}`}
                  alt="QR"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              </div>

              {slide.ctaLabel && (
                <div
                  style={{
                    ...fontBase,
                    fontSize: 44,
                    color: '#fff',
                    letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {slide.ctaLabel}
                </div>
              )}
            </div>

            {slide.ctaNote && (
              <div
                style={{
                  position: 'absolute',
                  top: 1240,
                  left: 80,
                  right: 80,
                  textAlign: 'center',
                  ...fontBase,
                  fontWeight: 500,
                  fontSize: 36,
                  color: 'rgba(255,255,255,0.75)',
                  letterSpacing: '0.05em',
                }}
              >
                {slide.ctaNote}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: isBottom ? 'flex-end' : 'center',
              paddingBottom: isBottom ? 160 : 0,
            }}
          >
            <HeadlineText text={slide.headline} emphasis={slide.emphasis} />
            <SublineText text={slide.subline} />
          </div>
        )}

        {/* BeMyStyle logo */}
        {!isCTA && (
          <div
            style={{
              position: 'absolute',
              bottom: 60,
              right: 60,
              ...fontBase,
              fontSize: 28,
              color: 'rgba(192,132,252,0.8)',
              letterSpacing: '0.1em',
            }}
          >
            BeMyStyle
          </div>
        )}
      </div>
    </div>
  )
}
