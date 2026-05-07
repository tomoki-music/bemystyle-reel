import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

export type BgVariant = "default" | "hook" | "problem" | "objective" | "cta";

interface Props {
  variant?: BgVariant;
}

// Deterministic particles (golden-angle spread)
const PARTICLES = Array.from({ length: 42 }, (_, i) => ({
  id: i,
  x: (i * 137.508) % 100,
  y: (i * 73.2 + 17) % 100,
  r: 0.9 + (i % 3) * 0.7,
  speed: 0.08 + (i % 6) * 0.05,
  phase: i * 0.41,
  opacity: 0.12 + (i % 5) * 0.07,
}));

const BG_CONFIGS: Record<BgVariant, { top: string; mid: string; bot: string; glowAlpha: number }> = {
  default:   { top: "#060011", mid: "#0A0520", bot: "#080318", glowAlpha: 0.22 },
  hook:      { top: "#060011", mid: "#0C0228", bot: "#0A0320", glowAlpha: 0.30 },
  problem:   { top: "#08000F", mid: "#0A0018", bot: "#060010", glowAlpha: 0.14 },
  objective: { top: "#04000E", mid: "#080320", bot: "#060018", glowAlpha: 0.26 },
  cta:       { top: "#050010", mid: "#0D0528", bot: "#0A0320", glowAlpha: 0.35 },
};

// Generate an SVG sine wave path across the 1080px width
const makeSinePath = (
  frame: number,
  amp: number,
  freq: number,
  phase: number,
  yBase: number,
  speed: number,
): string => {
  const pts: string[] = [];
  for (let x = 0; x <= 1080; x += 10) {
    const y = yBase + amp * Math.sin(freq * x * 0.0028 + phase + frame * speed);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
};

export const SingingBackground: React.FC<Props> = ({ variant = "default" }) => {
  const frame = useCurrentFrame();
  const cfg = BG_CONFIGS[variant];

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* ── Base gradient ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(165deg, ${cfg.top} 0%, ${cfg.mid} 55%, ${cfg.bot} 100%)`,
        }}
      />

      {/* ── Top purple glow orb ── */}
      <div
        style={{
          position: "absolute",
          top: -320,
          left: "50%",
          transform: "translateX(-50%)",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(123,47,190,${cfg.glowAlpha}) 0%, transparent 65%)`,
          pointerEvents: "none",
        }}
      />

      {/* ── Bottom glow ── */}
      <div
        style={{
          position: "absolute",
          bottom: -200,
          left: "50%",
          transform: "translateX(-50%)",
          width: 800,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(80,20,160,${cfg.glowAlpha * 0.6}) 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* ── Animated sound waves ── */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <svg
          width="1080"
          height="1920"
          viewBox="0 0 1080 1920"
          style={{ position: "absolute", inset: 0 }}
        >
          {/* Mid area waves */}
          <path
            d={makeSinePath(frame, 30, 1.2, 0, 880, 0.018)}
            fill="none"
            stroke="rgba(192,132,252,0.13)"
            strokeWidth={2}
          />
          <path
            d={makeSinePath(frame, 18, 1.9, Math.PI * 0.6, 920, 0.025)}
            fill="none"
            stroke="rgba(192,132,252,0.08)"
            strokeWidth={1.5}
          />
          <path
            d={makeSinePath(frame, 38, 0.85, Math.PI * 1.2, 1040, 0.014)}
            fill="none"
            stroke="rgba(192,132,252,0.06)"
            strokeWidth={1.5}
          />
          {/* Lower waves */}
          <path
            d={makeSinePath(frame, 24, 2.1, Math.PI * 0.3, 1600, 0.022)}
            fill="none"
            stroke="rgba(192,132,252,0.10)"
            strokeWidth={1.5}
          />
          <path
            d={makeSinePath(frame, 32, 1.5, Math.PI * 1.8, 1680, 0.016)}
            fill="none"
            stroke="rgba(192,132,252,0.07)"
            strokeWidth={1}
          />
          {/* Thin upper accent */}
          <path
            d={makeSinePath(frame, 14, 2.4, Math.PI * 0.9, 300, 0.03)}
            fill="none"
            stroke="rgba(240,191,106,0.05)"
            strokeWidth={1}
          />
        </svg>
      </AbsoluteFill>

      {/* ── Floating particles ── */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {PARTICLES.map((p) => {
          const y = ((p.y - frame * p.speed * 0.07) % 100 + 100) % 100;
          const alpha = Math.max(0, Math.sin(frame * 0.03 + p.phase) * 0.2 + p.opacity);
          return (
            <div
              key={p.id}
              style={{
                position: "absolute",
                left: `${p.x}%`,
                top: `${y}%`,
                width: p.r * 2,
                height: p.r * 2,
                borderRadius: "50%",
                background: `rgba(192,132,252,${alpha})`,
                transform: "translate(-50%, -50%)",
              }}
            />
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
