/**
 * SceneCTA — 39〜45s (180 frames)
 * AI歌唱診断への自然なCTA
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SingingBackground } from "./SingingBackground";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const PURPLE = "#C084FC";
const DEEP_PURPLE = "#7B2FBE";
const GOLD = "#F0BF6A";
const WHITE = "#FFFFFF";
const TRANS = 8;

// Floating mini wave bars (visualizer style)
const WaveBars: React.FC<{ frame: number; opacity: number }> = ({ frame, opacity }) => {
  const bars = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 60, opacity }}>
      {bars.map((i) => {
        const h = 10 + Math.abs(Math.sin(frame * 0.12 + i * 0.55)) * 50;
        return (
          <div
            key={i}
            style={{
              width: 6,
              height: h,
              borderRadius: 3,
              background: `rgba(192,132,252,${0.3 + Math.abs(Math.sin(frame * 0.12 + i * 0.55)) * 0.6})`,
              transition: "height 0.1s",
            }}
          />
        );
      })}
    </div>
  );
};

// Growth curve mini-graph
const MiniGrowthCurve: React.FC<{ frame: number; opacity: number }> = ({ frame, opacity }) => {
  const progress = interpolate(frame, [40, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * progress;
    const x = 20 + t * 360;
    const y = 80 - Math.pow(t, 0.6) * 60;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const d = `M ${pts.join(" L ")}`;

  return (
    <div style={{ opacity }}>
      <svg width={400} height={100} viewBox="0 0 400 100" overflow="visible">
        <path d={d} fill="none" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(240,191,106,0.5))" }}
        />
        {progress >= 1 && (
          <circle
            cx={380} cy={20} r={5}
            fill={GOLD}
            style={{ filter: "drop-shadow(0 0 8px #F0BF6A)" }}
          />
        )}
      </svg>
    </div>
  );
};

export const SceneCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  // Headline
  const headY = spring({ frame: frame - 6, fps, config: { damping: 16, stiffness: 90, mass: 0.7 }, from: 50, to: 0 });
  const headOpacity = interpolate(frame, [6, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Sub headline
  const subY = spring({ frame: frame - 22, fps, config: { damping: 18, stiffness: 100, mass: 0.65 }, from: 36, to: 0 });
  const subOpacity = interpolate(frame, [22, 38], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Wave bars
  const waveOpacity = interpolate(frame, [18, 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // CTA button
  const btnF = frame - 44;
  const btnScale = spring({ frame: btnF, fps, config: { damping: 13, stiffness: 110, mass: 0.8 }, from: 0.55, to: 1 });
  const btnOpacity = interpolate(btnF, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const btnPulse = 1 + Math.sin(frame * 0.08 * Math.PI * 2) * 0.022;
  const glowAlpha = 0.55 + Math.sin(frame * 0.08 * Math.PI * 2) * 0.28;

  // Note + URL
  const noteOpacity = interpolate(frame, [65, 82], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Growth curve
  const curveOpacity = interpolate(frame, [30, 48], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Brand
  const brandOpacity = interpolate(frame, [12, 28], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <SingingBackground variant="cta" />

      {/* Extra center premium glow */}
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123,47,190,0.18) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 64px",
          gap: 0,
        }}
      >
        {/* Wave visualizer */}
        <div style={{ marginBottom: 20 }}>
          <WaveBars frame={frame} opacity={waveOpacity} />
        </div>

        {/* Headline */}
        <div
          style={{
            transform: `translateY(${headY}px)`,
            opacity: headOpacity,
            textAlign: "center",
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              lineHeight: 1.25,
              letterSpacing: "0.04em",
              color: WHITE,
              fontFamily: FONT,
              textShadow: `
                0 0 44px rgba(123,47,190,0.9),
                0 0 88px rgba(123,47,190,0.4),
                0 3px 14px rgba(0,0,0,0.8)
              `,
            }}
          >
            AI歌唱診断で
          </div>
        </div>

        {/* Sub headline */}
        <div
          style={{
            transform: `translateY(${subY}px)`,
            opacity: subOpacity,
            textAlign: "center",
            marginBottom: 28,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              lineHeight: 1.25,
              letterSpacing: "0.04em",
              color: GOLD,
              fontFamily: FONT,
              textShadow: `0 0 36px rgba(240,191,106,0.6), 0 3px 14px rgba(0,0,0,0.8)`,
            }}
          >
            今の歌声をチェック
          </div>
        </div>

        {/* Mini growth curve */}
        <div style={{ marginBottom: 20 }}>
          <MiniGrowthCurve frame={frame} opacity={curveOpacity} />
        </div>

        {/* CTA Button */}
        <div
          style={{
            transform: `scale(${btnScale * btnPulse})`,
            opacity: btnOpacity,
            background: `linear-gradient(135deg, ${DEEP_PURPLE} 0%, #9333EA 50%, ${PURPLE} 100%)`,
            borderRadius: 72,
            paddingTop: 34,
            paddingBottom: 34,
            paddingLeft: 72,
            paddingRight: 72,
            fontSize: 52,
            fontWeight: 700,
            color: WHITE,
            letterSpacing: "0.04em",
            fontFamily: FONT,
            boxShadow: `
              0 0 56px rgba(147,51,234,${glowAlpha}),
              0 0 112px rgba(147,51,234,${glowAlpha * 0.4}),
              0 8px 40px rgba(0,0,0,0.5)
            `,
            textShadow: "0 2px 12px rgba(0,0,0,0.5)",
            whiteSpace: "nowrap",
            border: "1.5px solid rgba(192,132,252,0.45)",
            textAlign: "center",
          }}
        >
          ▶ 無料登録はこちら
        </div>

        {/* Note */}
        <div
          style={{
            opacity: noteOpacity,
            marginTop: 32,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 38,
              fontWeight: 500,
              color: "rgba(255,255,255,0.88)",
              letterSpacing: "0.06em",
              fontFamily: FONT,
              textShadow: "0 2px 10px rgba(0,0,0,0.6)",
              marginBottom: 14,
            }}
          >
            プロフィール・説明欄のリンクから
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 400,
              color: "rgba(192,132,252,0.85)",
              letterSpacing: "0.05em",
              fontFamily: '"SF Mono", "Fira Code", monospace',
              textShadow: "0 1px 8px rgba(0,0,0,0.7)",
            }}
          >
            be-my-style.com
          </div>
        </div>

        {/* Tiny URL */}
        <div
          style={{
            opacity: noteOpacity * 0.6,
            marginTop: 10,
            fontSize: 24,
            fontWeight: 400,
            color: "rgba(192,132,252,0.65)",
            letterSpacing: "0.04em",
            fontFamily: '"SF Mono", "Fira Code", monospace',
            textShadow: "0 1px 6px rgba(0,0,0,0.7)",
          }}
        >
          https://be-my-style.com/singing/sign_up
        </div>
      </AbsoluteFill>

      {/* Brand bottom center */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: "50%",
          transform: "translateX(-50%)",
          opacity: brandOpacity,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: PURPLE,
            letterSpacing: "0.18em",
            fontFamily: FONT,
            textShadow: `0 0 20px rgba(192,132,252,0.6)`,
          }}
        >
          BeMyStyle
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 400,
            color: "rgba(192,132,252,0.55)",
            letterSpacing: "0.12em",
            fontFamily: FONT,
            marginTop: 4,
          }}
        >
          AI 歌唱診断
        </div>
      </div>
    </AbsoluteFill>
  );
};
