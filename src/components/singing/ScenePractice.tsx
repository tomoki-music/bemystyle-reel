/**
 * ScenePractice — 24〜32s (240 frames)
 * 「泣き真似で歌う」練習アドバイス + 音波アニメーション
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

const WaveRings: React.FC<{ frame: number; opacity: number }> = ({ frame, opacity }) => {
  const rings = [0, 18, 36, 54];
  return (
    <div style={{ position: "absolute", opacity }}>
      <svg width={400} height={200} viewBox="0 0 400 200" fill="none">
        {rings.map((offset, i) => {
          const phase = ((frame + offset) % 72) / 72;
          const r = 20 + phase * 180;
          const alpha = (1 - phase) * 0.5 * (1 - i * 0.15);
          return (
            <ellipse key={i} cx={200} cy={100} rx={r} ry={r * 0.38}
              stroke={PURPLE} strokeWidth={Math.max(0.5, 2.5 - phase * 2)} fill="none" opacity={Math.max(0, alpha)}
            />
          );
        })}
        <circle cx={200} cy={100} r={8} fill={PURPLE} style={{ filter: "drop-shadow(0 0 10px #C084FC)" }} />
      </svg>
    </div>
  );
};

const AscendingWave: React.FC<{ frame: number; opacity: number }> = ({ frame, opacity }) => {
  const progress = interpolate(frame, [60, 160], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pts: string[] = [];
  const totalX = 900;
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const x = t * totalX;
    const baseY = 80 - progress * t * 60;
    const y = baseY + Math.sin(t * Math.PI * 5 + frame * 0.15) * (18 - t * 12);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const path = `M ${pts.join(" L ")}`;
  const visibleLen = progress * totalX;

  return (
    <div style={{ opacity }}>
      <svg width={900} height={160} viewBox="0 0 900 160" overflow="visible">
        <defs>
          <clipPath id="waveClip">
            <rect x="0" y="-100" width={visibleLen} height="300" />
          </clipPath>
        </defs>
        <path d={path} fill="none" stroke={PURPLE} strokeWidth={3} strokeLinecap="round" clipPath="url(#waveClip)" style={{ filter: "drop-shadow(0 0 8px rgba(192,132,252,0.6))" }} />
        <path d={path} fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinecap="round" opacity={0.4} clipPath="url(#waveClip)" />
      </svg>
    </div>
  );
};

interface TipItemProps { text: string; frame: number; delay: number; fps: number; }

const TipItem: React.FC<TipItemProps> = ({ text, frame, delay, fps }) => {
  const f  = frame - delay;
  const y  = spring({ frame: f, fps, config: { damping: 18, stiffness: 100, mass: 0.6 }, from: 24, to: 0 });
  const op = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div style={{ transform: `translateY(${y}px)`, opacity: op, display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: PURPLE, flexShrink: 0, boxShadow: `0 0 8px ${PURPLE}` }} />
      <div style={{ fontSize: 42, fontWeight: 500, color: "rgba(240,230,255,0.88)", letterSpacing: "0.06em", fontFamily: FONT, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{text}</div>
    </div>
  );
};

const TIPS = [
  { text: "喉を開く",                   delay: 80  },
  { text: "声帯を閉じる",               delay: 105 },
  { text: "高音のテンションを引き出す", delay: 130 },
];

export const ScenePractice: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const lblOpacity  = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const mainScale   = interpolate(frame, [18, 38], [1.12, 1.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const mainOpacity = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const waveOpacity = interpolate(frame, [44, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ascOpacity  = interpolate(frame, [55, 75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sumOpacity  = interpolate(frame, [170, 192], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sumY        = spring({ frame: frame - 170, fps, config: { damping: 18, stiffness: 90, mass: 0.7 }, from: 28, to: 0 });

  return (
    <ShortsLayout
      opacity={Math.min(fadeIn, fadeOut)}
      background={<SingingBackground variant="default" />}
      brand="BeMyStyle"
      showBrand
      brandOpacity={interpolate(frame, [12, 28], [0, 0.65], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      contentStyle={{ padding: "0 72px" }}
    >
      {/* Section label */}
      <div style={{ opacity: lblOpacity, fontSize: 36, fontWeight: 500, color: "rgba(192,132,252,0.85)", letterSpacing: "0.14em", fontFamily: FONT, textShadow: "0 0 20px rgba(192,132,252,0.5)", marginBottom: 20, textAlign: "center" }}>
        ─── おすすめ練習 ───
      </div>

      {/* Main practice text */}
      <div style={{ transform: `scale(${mainScale})`, opacity: mainOpacity, textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 100, fontWeight: 900, lineHeight: 1.1, letterSpacing: "0.04em", color: WHITE, fontFamily: FONT, textShadow: "0 0 50px rgba(123,47,190,0.8), 0 0 100px rgba(123,47,190,0.3), 0 4px 16px rgba(0,0,0,0.8)" }}>
          泣き真似<br />
          <span style={{ fontSize: 72, color: GOLD }}>で歌う</span>
        </div>
      </div>

      {/* Wave rings */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
        <WaveRings frame={frame} opacity={waveOpacity} />
      </div>

      {/* Ascending wave */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <AscendingWave frame={frame} opacity={ascOpacity} />
      </div>

      {/* Tips list */}
      <div style={{ width: "100%", marginBottom: 20 }}>
        {TIPS.map((t) => (
          <TipItem key={t.text} text={t.text} frame={frame} delay={t.delay} fps={fps} />
        ))}
      </div>

      {/* Summary */}
      <div style={{ transform: `translateY(${sumY}px)`, opacity: sumOpacity, textAlign: "center", padding: "20px 28px", background: "rgba(255,255,255,0.05)", borderRadius: 18, border: "1px solid rgba(192,132,252,0.3)" }}>
        <div style={{ fontSize: 38, fontWeight: 500, color: "rgba(240,230,255,0.88)", letterSpacing: "0.05em", fontFamily: FONT, lineHeight: 1.6, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
          この感覚を<span style={{ color: PURPLE, fontWeight: 700 }}>まとめて</span>掴みやすい
        </div>
      </div>
    </ShortsLayout>
  );
};
