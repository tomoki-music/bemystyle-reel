import React from 'react'
import { Slide, CTAConfig, SlideLayout } from '../types'

interface Props {
  slide: Slide
  onChange: (changes: Partial<Slide>) => void
  ctaConfig: CTAConfig
  onCtaChange: (config: CTAConfig) => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#fff',
  fontSize: 13,
  fontFamily: '"Noto Sans JP", -apple-system, sans-serif',
  outline: 'none',
  lineHeight: 1.6,
  transition: 'border-color 0.15s',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical' as const,
  minHeight: 76,
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          marginBottom: hint ? 4 : 6,
        }}
      >
        {label}
      </label>
      {hint && (
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginBottom: 6, lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#c084fc',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: '1px solid rgba(192,132,252,0.18)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

const LAYOUTS: [SlideLayout, string][] = [
  ['center', '中央配置'],
  ['bottom', '下配置'],
  ['cta', 'CTA'],
]

export const SlideForm: React.FC<Props> = ({ slide, onChange, ctaConfig, onCtaChange }) => {
  const isCTA = slide.layout === 'cta'

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
      <Section title="コンテンツ">
        <Field label="見出し" hint="改行は Enter で入力できます">
          <textarea
            value={slide.headline}
            onChange={(e) => onChange({ headline: e.target.value })}
            style={textareaStyle}
            placeholder="見出しテキスト"
          />
        </Field>

        {!isCTA && (
          <>
            <Field label="サブテキスト" hint="見出しの下に表示される補足テキスト">
              <textarea
                value={slide.subline}
                onChange={(e) => onChange({ subline: e.target.value })}
                style={textareaStyle}
                placeholder="サブテキスト"
              />
            </Field>

            <Field label="強調ワード" hint="見出し内のこの単語を紫色で表示します">
              <input
                type="text"
                value={slide.emphasis}
                onChange={(e) => onChange({ emphasis: e.target.value })}
                style={inputStyle}
                placeholder="強調したい単語"
              />
            </Field>
          </>
        )}
      </Section>

      <Section title="背景・演出">
        <Field label="背景画像ファイル名" hint="例: slide01.jpg（public/assets/slides/ に配置）">
          <input
            type="text"
            value={slide.image}
            onChange={(e) => onChange({ image: e.target.value })}
            style={inputStyle}
            placeholder="slide01.jpg"
          />
        </Field>

        <Field label="文字の位置">
          <div style={{ display: 'flex', gap: 6 }}>
            {LAYOUTS.map(([val, label]) => (
              <button
                key={val}
                onClick={() => onChange({ layout: val })}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: 8,
                  border: `1px solid ${
                    slide.layout === val ? '#c084fc' : 'rgba(255,255,255,0.1)'
                  }`,
                  background:
                    slide.layout === val ? 'rgba(192,132,252,0.12)' : 'rgba(255,255,255,0.04)',
                  color: slide.layout === val ? '#c084fc' : 'rgba(255,255,255,0.4)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: '"Noto Sans JP", -apple-system, sans-serif',
                  transition: 'all 0.12s',
                  letterSpacing: '0.02em',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="演出">
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <input
              type="checkbox"
              checked={slide.showParticles}
              onChange={(e) => onChange({ showParticles: e.target.checked })}
              style={{ width: 15, height: 15, accentColor: '#c084fc', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
              パーティクルを表示する
            </span>
          </label>
        </Field>
      </Section>

      <Section title="タイミング">
        <Field label="表示時間">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input
              type="range"
              min={2}
              max={8}
              step={1}
              value={slide.durationSec}
              onChange={(e) => onChange({ durationSec: Number(e.target.value) })}
              style={{ flex: 1, accentColor: '#c084fc', cursor: 'pointer' }}
            />
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#c084fc',
                minWidth: 44,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {slide.durationSec}秒
            </span>
          </div>
        </Field>
      </Section>

      {isCTA && (
        <Section title="CTA設定">
          <Field label="ラベル" hint="QRコードの下に表示されるテキスト">
            <input
              type="text"
              value={slide.ctaLabel ?? ''}
              onChange={(e) => onChange({ ctaLabel: e.target.value })}
              style={inputStyle}
              placeholder="QRを読み取る"
            />
          </Field>

          <Field label="補足テキスト" hint="ラベルの下に表示される小さいテキスト">
            <input
              type="text"
              value={slide.ctaNote ?? ''}
              onChange={(e) => onChange({ ctaNote: e.target.value })}
              style={inputStyle}
              placeholder="無料歌唱診断はこちら"
            />
          </Field>

          <Field label="遷移URL">
            <input
              type="url"
              value={slide.ctaUrl ?? ''}
              onChange={(e) => onChange({ ctaUrl: e.target.value })}
              style={inputStyle}
              placeholder="https://be-my-style.com/..."
            />
          </Field>

          <Field label="QRコード画像ファイル名" hint="public/assets/ に配置したファイル名">
            <input
              type="text"
              value={ctaConfig.qrImage}
              onChange={(e) => onCtaChange({ ...ctaConfig, qrImage: e.target.value })}
              style={inputStyle}
              placeholder="qr-singing.png"
            />
          </Field>
        </Section>
      )}
    </div>
  )
}
