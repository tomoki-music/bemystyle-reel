/**
 * SceneHook — 0〜3s (90 frames)
 * 「高音、才能だと思ってない？」
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SingingBackground } from "./SingingBackground";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const PURPLE = "#C084FC";
const GOLD = "#F0BF6A";
const WHITE = "#FFFFFF";
const TRANS = 8; // transition frames

// SVG microphone icon
const MicSVG: React.FC<{ size: number }> = ({ size }) => (
  <svg
    width={size}
    height={size * 1.5}
    viewBox="0 0 60 90"
    fill="none"
    style={{ overflow: "visible" }}
  >
    {/* Mic capsule */}
    <rect
      x="15" y="2" width="30" height="46" rx="15"
      fill="rgba(192,132,252,0.25)"
      stroke={PURPLE}
      strokeWidth="2.5"
    />
    {/* Inner grill lines */}
    <line x1="15" y1="22" x2="45" y2="22" stroke="rgba(192,132,252,0.4)" strokeWidth="1.5" />
    <line x1="15" y1="30" x2="45" y2="30" stroke="rgba(192,132,252,0.4)" strokeWidth="1.5" />
    <line x1="15" y1="38" x2="45" y2="38" stroke="rgba(192,132,252,0.4)" strokeWidth="1.5" />
    {/* Mic stand curve */}
    <path
      d="M8 42 Q8 68 30 68 Q52 68 52 42"
      stroke={PURPLE}
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
    />
    {/* Vertical stand */}
    <line x1="30" y1="68" x2="30" y2="84" stroke={PURPLE} strokeWidth="2.5" strokeLinecap="round" />
    {/* Base */}
    <line x1="12" y1="84" x2="48" y2="84" stroke={PURPLE} strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

// Radial light rays behind mic
const LightRays: React.FC<{ opacity: number }> = ({ opacity }) => (
  <svg
    width={500}
    height={500}
    viewBox="0 0 500 500"
    style={{ position: "absolute", opacity }}
  >
    {Array.from({ length: 10 }, (_, i) => {
      const angle = (i / 10) * Math.PI * 2;
      const x1 = 250 + Math.cos(angle) * 60;
      const y1 = 250 + Math.sin(angle) * 60;
      const x2 = 250 + Math.cos(angle) * 240;
      const y2 = 250 + Math.sin(angle) * 240;
      return (
        <line
          key={i}
          x1={x1} y1={y1}
          x2={x2} y2={y2}
          stroke="rgba(192,132,252,0.12)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      );
    })}
  </svg>
);

export const SceneHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  // Mic: spring scale + opacity
  const micScale = spring({ frame, fps, config: { damping: 13, stiffness: 70, mass: 1.1 }, from: 0.3, to: 1 });
  const micOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Ray pulse
  const rayOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
    (0.7 + Math.sin(frame * 0.15) * 0.3);

  // Headline: zoom in (1.18 → 1.0) + fade
  const headScale = interpolate(frame, [0, 22], [1.18, 1.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const headOpacity = interpolate(frame, [2, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Emphasis "才能" gold
  const subY = spring({ frame: frame - 18, fps, config: { damping: 18, stiffness: 100, mass: 0.65 }, from: 36, to: 0 });
  const subOpacity = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Gold accent line
  const lineW = interpolate(frame, [24, 48], [0, 280], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <SingingBackground variant="hook" />

      {/* Central glow beneath content */}
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123,47,190,0.18) 0%, transparent 65%)",
          pointerEvents: "none",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
        }}
      >
        {/* Light rays */}
        <div
          style={{
            position: "absolute",
            top: "23%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <LightRays opacity={rayOpacity} />
        </div>

        {/* Mic icon */}
        <div
          style={{
            transform: `scale(${micScale})`,
            opacity: micOpacity,
            marginBottom: 32,
            filter: `drop-shadow(0 0 24px rgba(192,132,252,0.7))`,
          }}
        >
          <MicSVG size={80} />
        </div>

        {/* Headline */}
        <div
          style={{
            transform: `scale(${headScale})`,
            opacity: headOpacity,
            textAlign: "center",
            padding: "0 64px",
          }}
        >
          <div
            style={{
              fontSize: 84,
              fontWeight: 900,
              lineHeight: 1.25,
              letterSpacing: "0.02em",
              color: WHITE,
              fontFamily: FONT,
              textShadow: `
                0 0 40px rgba(123,47,190,0.9),
                0 0 80px rgba(123,47,190,0.4),
                0 3px 12px rgba(0,0,0,0.8)
              `,
            }}
          >
            高音、
            <span style={{ color: GOLD }}>才能</span>
            だと
            <br />
            思ってない？
          </div>
        </div>

        {/* Gold accent line */}
        <div
          style={{
            width: lineW,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            marginTop: 20,
            marginBottom: 20,
            borderRadius: 2,
          }}
        />

        {/* Sub text */}
        <div
          style={{
            transform: `translateY(${subY}px)`,
            opacity: subOpacity,
            textAlign: "center",
            padding: "0 64px",
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 500,
              lineHeight: 1.5,
              letterSpacing: "0.06em",
              color: "rgba(240,230,255,0.92)",
              fontFamily: FONT,
              textShadow: "0 2px 14px rgba(0,0,0,0.7)",
            }}
          >
            実は
            <span style={{ color: PURPLE, fontWeight: 700 }}>
              "出し方"
            </span>
            で変わります
          </div>
        </div>
      </AbsoluteFill>

      {/* Brand watermark */}
      <div
        style={{
          position: "absolute",
          bottom: 64,
          right: 60,
          opacity: interpolate(frame, [12, 28], [0, 0.65], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          fontSize: 28,
          fontWeight: 700,
          color: "rgba(192,132,252,0.8)",
          letterSpacing: "0.1em",
          fontFamily: FONT,
          textShadow: "0 0 12px rgba(192,132,252,0.5)",
        }}
      >
        BeMyStyle
      </div>
    </AbsoluteFill>
  );
};
