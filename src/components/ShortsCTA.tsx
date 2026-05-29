import React from "react";
import { Img, staticFile } from "remotion";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const MONO = '"SF Mono", "Fira Code", monospace';
const WHITE = "#FFFFFF";
const PURPLE = "#C084FC";

interface ShortsCTAProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  // Slot for an animated CTA button (e.g. spring-scaled pill)
  ctaButton?: React.ReactNode;
  // QR code image path relative to public/ (e.g. "/assets/qr-singing.png")
  qrImage?: string;
  // Service / registration note displayed above the URL
  note?: React.ReactNode;
  // Short URL shown in monospace (e.g. "be-my-style.com")
  url?: string;
  style?: React.CSSProperties;
}

/**
 * Reusable CTA layout for YouTube Shorts end screens.
 * Place inside <ShortsLayout> — safe area is already guaranteed by the parent.
 *
 * Usage:
 *   <ShortsCTA
 *     title="AI歌唱診断で"
 *     subtitle="今の歌声をチェック"
 *     ctaButton={<AnimatedButton />}
 *     note="プロフィール・説明欄のリンクから"
 *     url="be-my-style.com"
 *   />
 *
 *   <ShortsCTA
 *     title="あなたの歌をもっと楽しもう"
 *     qrImage="/assets/qr-singing.png"
 *     url="be-my-style.com"
 *   />
 */
export const ShortsCTA: React.FC<ShortsCTAProps> = ({
  title,
  subtitle,
  ctaButton,
  qrImage,
  note,
  url,
  style,
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        gap: 0,
        ...style,
      }}
    >
      {/* Main copy */}
      <div
        style={{
          fontSize: 72,
          fontWeight: 900,
          color: WHITE,
          textAlign: "center",
          letterSpacing: "0.03em",
          fontFamily: FONT,
          lineHeight: 1.3,
          textShadow: "0 0 40px rgba(123,47,190,0.8), 0 3px 14px rgba(0,0,0,0.8)",
          marginBottom: subtitle ? 8 : 28,
        }}
      >
        {title}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: PURPLE,
            textAlign: "center",
            letterSpacing: "0.04em",
            fontFamily: FONT,
            textShadow: "0 0 36px rgba(240,191,106,0.6), 0 3px 14px rgba(0,0,0,0.8)",
            marginBottom: 28,
          }}
        >
          {subtitle}
        </div>
      )}

      {/* CTA button slot */}
      {ctaButton && <div style={{ marginBottom: 28 }}>{ctaButton}</div>}

      {/* QR code — min 260px, recommended 320px */}
      {qrImage && (
        <div
          style={{
            width: 320,
            height: 320,
            background: "white",
            borderRadius: 20,
            padding: 12,
            boxSizing: "border-box",
            marginBottom: 20,
            boxShadow: "0 0 32px rgba(192,132,252,0.4), 0 4px 20px rgba(0,0,0,0.5)",
            flexShrink: 0,
          }}
        >
          <Img
            src={staticFile(qrImage)}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </div>
      )}

      {/* Registration note */}
      {note && (
        <div
          style={{
            fontSize: 38,
            fontWeight: 500,
            color: "rgba(255,255,255,0.88)",
            letterSpacing: "0.06em",
            fontFamily: FONT,
            textAlign: "center",
            textShadow: "0 2px 10px rgba(0,0,0,0.6)",
            marginBottom: 14,
          }}
        >
          {note}
        </div>
      )}

      {/* URL */}
      {url && (
        <div
          style={{
            fontSize: 30,
            fontWeight: 400,
            color: "rgba(192,132,252,0.85)",
            letterSpacing: "0.05em",
            fontFamily: MONO,
            textShadow: "0 1px 8px rgba(0,0,0,0.7)",
          }}
        >
          {url}
        </div>
      )}
    </div>
  );
};
