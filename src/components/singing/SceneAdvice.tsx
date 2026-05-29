/**
 * SceneAdvice — 15〜24s (270 frames)
 * まずは脱力。喉0割・お腹2〜3割・下半身6〜7割
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

interface BarRowProps {
  label: string;
  unit: string;
  barPct: number;
  barColor: string;
  frame: number;
  delay: number;
  fps: number;
  disabled?: boolean;
}

const BarRow: React.FC<BarRowProps> = ({ label, unit, barPct, barColor, frame, delay, fps, disabled }) => {
  const f = frame - delay;
  const rowY   = spring({ frame: f, fps, config: { damping: 18, stiffness: 100, mass: 0.65 }, from: 40, to: 0 });
  const rowOp  = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const barW   = interpolate(f, [8, 40], [0, barPct], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div style={{ transform: `translateY(${rowY}px)`, opacity: rowOp * (disabled ? 0.45 : 1), marginBottom: 36, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 10 }}>
        <span style={{ fontSize: 52, fontWeight: 700, color: WHITE, letterSpacing: "0.04em", fontFamily: FONT, textShadow: "0 2px 10px rgba(0,0,0,0.6)" }}>{label}</span>
        <span style={{ fontSize: 44, fontWeight: 900, color: disabled ? "rgba(200,200,220,0.5)" : barColor, letterSpacing: "0.04em", fontFamily: FONT, textShadow: disabled ? "none" : `0 0 20px ${barColor}` }}>{unit}</span>
      </div>
      <div style={{ width: "100%", height: 12, background: "rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ width: `${barW}%`, height: "100%", background: disabled ? "rgba(200,200,220,0.2)" : `linear-gradient(90deg, ${barColor}88, ${barColor})`, borderRadius: 8, boxShadow: disabled ? "none" : `0 0 12px ${barColor}80` }} />
      </div>
    </div>
  );
};

const ROWS = [
  { label: "喉",     unit: "0割",    barPct: 2,  barColor: "#FF6B6B", delay: 20,  disabled: true  },
  { label: "お腹",   unit: "2〜3割", barPct: 25, barColor: PURPLE,    delay: 65,  disabled: false },
  { label: "下半身", unit: "6〜7割", barPct: 68, barColor: GOLD,      delay: 110, disabled: false },
];

export const SceneAdvice: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const titleY      = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 95, mass: 0.7 }, from: 50, to: 0 });
  const titleOpacity = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const figOpacity   = interpolate(frame, [12, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const weightY      = interpolate(frame, [30, 80], [0, 60], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const warnOpacity  = interpolate(frame, [160, 185], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const warnY        = spring({ frame: frame - 160, fps, config: { damping: 18, stiffness: 90, mass: 0.7 }, from: 30, to: 0 });

  return (
    <ShortsLayout
      opacity={Math.min(fadeIn, fadeOut)}
      background={<SingingBackground variant="default" />}
      brand="BeMyStyle"
      showBrand
      brandOpacity={interpolate(frame, [12, 28], [0, 0.65], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      contentStyle={{ padding: "0 72px" }}
    >
      {/* Title */}
      <div style={{ transform: `translateY(${titleY}px)`, opacity: titleOpacity, textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 40, fontWeight: 500, color: "rgba(192,132,252,0.85)", letterSpacing: "0.14em", fontFamily: FONT, textShadow: "0 0 20px rgba(192,132,252,0.5)" }}>
          ─── 正しい力の配分 ───
        </div>
      </div>

      {/* Hero text */}
      <div style={{ opacity: titleOpacity, textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1.1, letterSpacing: "0.04em", color: WHITE, fontFamily: FONT, textShadow: "0 0 50px rgba(123,47,190,0.8), 0 3px 16px rgba(0,0,0,0.8)" }}>
          まずは<span style={{ color: GOLD }}>脱力</span>
        </div>
      </div>

      {/* Body figure */}
      <div style={{ opacity: figOpacity, marginBottom: 40, position: "relative" }}>
        <svg width={120} height={180} viewBox="0 0 120 180" fill="none">
          <circle cx={60} cy={22} r={16} fill="rgba(192,132,252,0.3)" stroke={PURPLE} strokeWidth={2} />
          <path d="M38 42 Q38 90 42 100 L60 110 L78 100 Q82 90 82 42 Z" fill="rgba(192,132,252,0.15)" stroke={PURPLE} strokeWidth={1.5} />
          <path d="M38 55 Q20 65 18 85" stroke="rgba(192,132,252,0.5)" strokeWidth={2} strokeLinecap="round" />
          <path d="M82 55 Q100 65 102 85" stroke="rgba(192,132,252,0.5)" strokeWidth={2} strokeLinecap="round" />
          <path d="M50 108 Q46 140 44 165" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" />
          <path d="M70 108 Q74 140 76 165" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={60} cy={60 + weightY} r={6} fill={GOLD} style={{ filter: "drop-shadow(0 0 8px #F0BF6A)" }} />
          <path d={`M60 ${40 + weightY} L60 ${80 + weightY}`} stroke={GOLD} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6} />
        </svg>
        <div style={{ position: "absolute", right: -140, top: "60%", transform: "translateY(-50%)", opacity: interpolate(frame, [80, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), fontSize: 28, fontWeight: 600, color: GOLD, fontFamily: FONT, letterSpacing: "0.06em", whiteSpace: "nowrap", textShadow: "0 0 14px rgba(240,191,106,0.5)" }}>
          重心を下に
        </div>
      </div>

      {/* Bar rows */}
      <div style={{ width: "100%" }}>
        {ROWS.map((r) => (
          <BarRow key={r.label} label={r.label} unit={r.unit} barPct={r.barPct} barColor={r.barColor} frame={frame} delay={r.delay} fps={fps} disabled={r.disabled} />
        ))}
      </div>

      {/* Warning text */}
      <div style={{ transform: `translateY(${warnY}px)`, opacity: warnOpacity, textAlign: "center", marginTop: 16, padding: "18px 32px", background: "rgba(255,255,255,0.04)", borderRadius: 16, border: "1px solid rgba(192,132,252,0.25)" }}>
        <div style={{ fontSize: 38, fontWeight: 500, color: "rgba(240,230,255,0.85)", letterSpacing: "0.04em", fontFamily: FONT, textShadow: "0 2px 8px rgba(0,0,0,0.5)", lineHeight: 1.55 }}>
          喉で頑張るほど、<br />
          <span style={{ color: PURPLE, fontWeight: 700 }}>高音は遠ざかる</span>
        </div>
      </div>
    </ShortsLayout>
  );
};
