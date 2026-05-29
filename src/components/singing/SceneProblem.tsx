/**
 * SceneProblem — 3〜8s (150 frames)
 * 3つの悩みをテンポよく表示
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SingingBackground } from "./SingingBackground";
import { ShortsLayout } from "../ShortsLayout";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const TRANS = 8;

interface ProblemItemProps {
  text: string;
  frame: number;
  delay: number;
  fps: number;
  accent: string;
}

const ProblemItem: React.FC<ProblemItemProps> = ({ text, frame, delay, fps, accent }) => {
  const f      = frame - delay;
  const slideX = spring({ frame: f, fps, config: { damping: 16, stiffness: 90, mass: 0.7 }, from: -80, to: 0 });
  const opacity = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        transform: `translateX(${slideX}px)`,
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 24,
        marginBottom: 32,
        padding: "20px 40px",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 20,
        borderLeft: `4px solid ${accent}`,
        backdropFilter: "blur(4px)",
        width: "100%",
      }}
    >
      <div style={{ width: 14, height: 14, borderRadius: "50%", background: accent, flexShrink: 0, boxShadow: `0 0 12px ${accent}` }} />
      <div style={{ fontSize: 64, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.03em", fontFamily: FONT, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
        {text}
      </div>
    </div>
  );
};

const PROBLEMS = [
  { text: "サビで苦しい",       delay: 8,   accent: "#E879F9" },
  { text: "喉が締まる",         delay: 55,  accent: "#C084FC" },
  { text: "声がひっくり返る",   delay: 100, accent: "#818CF8" },
];

export const SceneProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const titleY      = spring({ frame: frame - 2, fps, config: { damping: 18, stiffness: 100, mass: 0.6 }, from: 40, to: 0 });
  const titleOpacity = interpolate(frame, [2, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <ShortsLayout
      opacity={Math.min(fadeIn, fadeOut)}
      background={
        <>
          <SingingBackground variant="problem" />
          {/* Readability vignette */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 15%, rgba(8,0,18,0.4) 45%, rgba(8,0,18,0.4) 75%, transparent 100%)", pointerEvents: "none" }} />
        </>
      }
      brand="BeMyStyle"
      showBrand
      brandOpacity={interpolate(frame, [12, 28], [0, 0.65], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      contentStyle={{ padding: "0 72px" }}
    >
      {/* Section label */}
      <div style={{ transform: `translateY(${titleY}px)`, opacity: titleOpacity, fontSize: 34, fontWeight: 500, color: "rgba(192,132,252,0.85)", letterSpacing: "0.16em", fontFamily: FONT, textShadow: "0 0 20px rgba(192,132,252,0.5)", marginBottom: 48, textAlign: "center" }}>
        こんな悩み、ありませんか？
      </div>

      {/* Problem cards */}
      <div style={{ width: "100%" }}>
        {PROBLEMS.map((p) => (
          <ProblemItem key={p.text} text={p.text} frame={frame} delay={p.delay} fps={fps} accent={p.accent} />
        ))}
      </div>
    </ShortsLayout>
  );
};
