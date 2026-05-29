/**
 * SceneHook — 0〜3s (90 frames)
 * 「高音、才能だと思ってない？」
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SingingBackground } from "./SingingBackground";
import { ShortsLayout } from "../ShortsLayout";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const PURPLE = "#C084FC";
const GOLD = "#F0BF6A";
const WHITE = "#FFFFFF";
const TRANS = 8;

const MicSVG: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size * 1.5} viewBox="0 0 60 90" fill="none" style={{ overflow: "visible" }}>
    <rect x="15" y="2" width="30" height="46" rx="15" fill="rgba(192,132,252,0.25)" stroke={PURPLE} strokeWidth="2.5" />
    <line x1="15" y1="22" x2="45" y2="22" stroke="rgba(192,132,252,0.4)" strokeWidth="1.5" />
    <line x1="15" y1="30" x2="45" y2="30" stroke="rgba(192,132,252,0.4)" strokeWidth="1.5" />
    <line x1="15" y1="38" x2="45" y2="38" stroke="rgba(192,132,252,0.4)" strokeWidth="1.5" />
    <path d="M8 42 Q8 68 30 68 Q52 68 52 42" stroke={PURPLE} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <line x1="30" y1="68" x2="30" y2="84" stroke={PURPLE} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="12" y1="84" x2="48" y2="84" stroke={PURPLE} strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const LightRays: React.FC<{ opacity: number }> = ({ opacity }) => (
  <svg width={500} height={500} viewBox="0 0 500 500" style={{ position: "absolute", opacity }}>
    {Array.from({ length: 10 }, (_, i) => {
      const angle = (i / 10) * Math.PI * 2;
      const x1 = 250 + Math.cos(angle) * 60;
      const y1 = 250 + Math.sin(angle) * 60;
      const x2 = 250 + Math.cos(angle) * 240;
      const y2 = 250 + Math.sin(angle) * 240;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(192,132,252,0.12)" strokeWidth={3} strokeLinecap="round" />;
    })}
  </svg>
);

export const SceneHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const micScale   = spring({ frame, fps, config: { damping: 13, stiffness: 70, mass: 1.1 }, from: 0.3, to: 1 });
  const micOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rayOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * (0.7 + Math.sin(frame * 0.15) * 0.3);
  const headScale  = interpolate(frame, [0, 22], [1.18, 1.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const headOpacity = interpolate(frame, [2, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY       = spring({ frame: frame - 18, fps, config: { damping: 18, stiffness: 100, mass: 0.65 }, from: 36, to: 0 });
  const subOpacity = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lineW      = interpolate(frame, [24, 48], [0, 280], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <ShortsLayout
      opacity={Math.min(fadeIn, fadeOut)}
      background={
        <>
          <SingingBackground variant="hook" />
          {/* Central glow behind content */}
          <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%, -50%)", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,47,190,0.18) 0%, transparent 65%)", pointerEvents: "none" }} />
        </>
      }
      brand="BeMyStyle"
      showBrand
      brandOpacity={interpolate(frame, [12, 28], [0, 0.65], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
    >
      {/* Light rays — position absolute relative to SafeArea outer div (full screen) */}
      <div style={{ position: "absolute", top: "23%", left: "50%", transform: "translate(-50%, -50%)" }}>
        <LightRays opacity={rayOpacity} />
      </div>

      {/* Mic icon */}
      <div style={{ transform: `scale(${micScale})`, opacity: micOpacity, marginBottom: 32, filter: "drop-shadow(0 0 24px rgba(192,132,252,0.7))" }}>
        <MicSVG size={80} />
      </div>

      {/* Headline */}
      <div style={{ transform: `scale(${headScale})`, opacity: headOpacity, textAlign: "center", padding: "0 64px" }}>
        <div style={{ fontSize: 84, fontWeight: 900, lineHeight: 1.25, letterSpacing: "0.02em", color: WHITE, fontFamily: FONT, textShadow: "0 0 40px rgba(123,47,190,0.9), 0 0 80px rgba(123,47,190,0.4), 0 3px 12px rgba(0,0,0,0.8)" }}>
          高音、<span style={{ color: GOLD }}>才能</span>だと<br />思ってない？
        </div>
      </div>

      {/* Gold accent line */}
      <div style={{ width: lineW, height: 2, background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, marginTop: 20, marginBottom: 20, borderRadius: 2 }} />

      {/* Sub text */}
      <div style={{ transform: `translateY(${subY}px)`, opacity: subOpacity, textAlign: "center", padding: "0 64px" }}>
        <div style={{ fontSize: 48, fontWeight: 500, lineHeight: 1.5, letterSpacing: "0.06em", color: "rgba(240,230,255,0.92)", fontFamily: FONT, textShadow: "0 2px 14px rgba(0,0,0,0.7)" }}>
          実は<span style={{ color: PURPLE, fontWeight: 700 }}>"出し方"</span>で変わります
        </div>
      </div>
    </ShortsLayout>
  );
};
