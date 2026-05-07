import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";

interface Props {
  frame: number;
  label?: string;
  note?: string;
  url?: string;
  delay?: number;
}

export const CTAButton: React.FC<Props> = ({
  frame,
  label = "今すぐ無料で始める",
  note,
  url,
  delay = 25,
}) => {
  const { fps } = useVideoConfig();
  const f = frame - delay;

  const scale = spring({
    frame: f,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
    from: 0.6,
    to: 1,
  });
  const opacity = interpolate(f, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ゆっくりパルス（約2秒周期）
  const pulse = 1 + Math.sin(frame * 0.08 * Math.PI * 2) * 0.025;
  const glowAlpha = 0.5 + Math.sin(frame * 0.08 * Math.PI * 2) * 0.3;

  // note / url はボタンより少し遅れてフェードイン
  const noteOpacity = interpolate(f, [15, 32], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const font = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';

  return (
    <div
      style={{
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: 56,
      }}
    >
      {/* ── CTAボタン ── */}
      <div
        style={{
          transform: `scale(${scale * pulse})`,
          background:
            "linear-gradient(135deg, #6B21D6 0%, #9333EA 50%, #C084FC 100%)",
          borderRadius: 64,
          paddingTop: 30,
          paddingBottom: 30,
          paddingLeft: 68,
          paddingRight: 68,
          fontSize: 46,
          fontWeight: 700,
          color: "#FFFFFF",
          letterSpacing: "0.04em",
          fontFamily: font,
          boxShadow: `
            0 0 48px rgba(147,51,234,${glowAlpha}),
            0 0 96px rgba(147,51,234,${glowAlpha * 0.45}),
            0 8px 36px rgba(0,0,0,0.45)
          `,
          textShadow: "0 2px 10px rgba(0,0,0,0.5)",
          whiteSpace: "nowrap",
          border: "1.5px solid rgba(192,132,252,0.4)",
        }}
      >
        ▶ {label}
      </div>

      {/* ── 補足導線テキスト ── */}
      {note && (
        <div
          style={{
            opacity: noteOpacity,
            marginTop: 36,
            fontSize: 34,
            fontWeight: 500,
            color: "rgba(255,255,255,0.88)",
            letterSpacing: "0.06em",
            fontFamily: font,
            textShadow: "0 2px 10px rgba(0,0,0,0.6)",
            textAlign: "center",
          }}
        >
          {note}
        </div>
      )}

      {/* ── URL表示 ── */}
      {url && (
        <div
          style={{
            opacity: noteOpacity * 0.75,
            marginTop: 18,
            fontSize: 27,
            fontWeight: 400,
            color: "rgba(192,132,252,0.95)",
            letterSpacing: "0.05em",
            fontFamily: '"SF Mono", "Fira Code", "Noto Sans JP", monospace',
            textShadow: "0 1px 8px rgba(0,0,0,0.7)",
            textAlign: "center",
          }}
        >
          {url}
        </div>
      )}
    </div>
  );
};
