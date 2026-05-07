/**
 * SceneObjectiveCheck — 32〜39s (210 frames)
 * 「自分の声を客観的に知ること」+ レーダーチャート / AI診断UI
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SingingBackground } from "./SingingBackground";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const PURPLE = "#C084FC";
const GOLD = "#F0BF6A";
const WHITE = "#FFFFFF";
const TRANS = 8;

// Radar chart for vocal analysis
const AXES = ["音程", "響き", "声量", "声帯", "ビブラート", "高音力"];
const VALUES = [0.72, 0.68, 0.80, 0.55, 0.65, 0.48]; // 高音力は低め → 改善余地

const polar = (cx: number, cy: number, r: number, angle: number) => ({
  x: cx + r * Math.cos(angle - Math.PI / 2),
  y: cy + r * Math.sin(angle - Math.PI / 2),
});

const VocalRadar: React.FC<{ progress: number; size: number }> = ({ progress, size }) => {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.36;
  const n = AXES.length;
  const angles = AXES.map((_, i) => ((Math.PI * 2) / n) * i);
  const grids = [0.33, 0.66, 1.0];

  const points = VALUES.map((v, i) => {
    const r = maxR * v * progress;
    return polar(cx, cy, r, angles[i]);
  });
  const polygonPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      width={size}
      height={size}
      style={{ filter: "drop-shadow(0 0 24px rgba(192,132,252,0.35))", overflow: "visible" }}
    >
      {/* Grid */}
      {grids.map((g, gi) => (
        <polygon
          key={gi}
          points={angles.map((a) => { const p = polar(cx, cy, maxR * g, a); return `${p.x},${p.y}`; }).join(" ")}
          fill="none"
          stroke="rgba(192,132,252,0.2)"
          strokeWidth={1}
        />
      ))}
      {/* Axis lines */}
      {angles.map((a, i) => {
        const end = polar(cx, cy, maxR, a);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(192,132,252,0.2)" strokeWidth={1} />;
      })}
      {/* Data polygon */}
      <polygon
        points={polygonPoints}
        fill="rgba(123,47,190,0.3)"
        stroke={PURPLE}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* Vertex dots */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r={i === 5 ? 7 : 5}
          fill={i === 5 ? GOLD : PURPLE}
          style={{ filter: `drop-shadow(0 0 6px ${i === 5 ? GOLD : PURPLE})` }}
        />
      ))}
      {/* Labels */}
      {angles.map((a, i) => {
        const p = polar(cx, cy, maxR + 30, a);
        const isWeak = i === 5;
        return (
          <text
            key={i}
            x={p.x} y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={isWeak ? GOLD : "rgba(240,230,255,0.8)"}
            fontSize={isWeak ? 21 : 19}
            fontWeight={isWeak ? 700 : 500}
            fontFamily={FONT}
          >
            {AXES[i]}
          </text>
        );
      })}
    </svg>
  );
};

// Score pill component
const ScorePill: React.FC<{ label: string; score: number; frame: number; delay: number; fps: number }> = ({ label, score, frame, delay, fps }) => {
  const f = frame - delay;
  const op = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const displayScore = Math.round(interpolate(f, [4, 40], [0, score], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  return (
    <div
      style={{
        opacity: op,
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(192,132,252,0.3)",
        borderRadius: 40,
        padding: "10px 28px",
      }}
    >
      <span style={{ fontSize: 28, fontWeight: 500, color: "rgba(240,230,255,0.7)", letterSpacing: "0.08em", fontFamily: FONT }}>
        {label}
      </span>
      <span style={{ fontSize: 40, fontWeight: 900, color: PURPLE, letterSpacing: "0.04em", fontFamily: FONT, textShadow: `0 0 16px ${PURPLE}` }}>
        {displayScore}
      </span>
    </div>
  );
};

export const SceneObjectiveCheck: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  // Teaser line
  const teaserY = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 90, mass: 0.7 }, from: 44, to: 0 });
  const teaserOpacity = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Main headline
  const mainY = spring({ frame: frame - 28, fps, config: { damping: 16, stiffness: 95, mass: 0.7 }, from: 44, to: 0 });
  const mainOpacity = interpolate(frame, [28, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Radar
  const radarProgress = interpolate(frame, [55, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const radarOpacity = interpolate(frame, [50, 68], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Sub text
  const subOpacity = interpolate(frame, [130, 152], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY = spring({ frame: frame - 130, fps, config: { damping: 18, stiffness: 90, mass: 0.7 }, from: 28, to: 0 });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <SingingBackground variant="objective" />

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
        {/* Teaser */}
        <div
          style={{
            transform: `translateY(${teaserY}px)`,
            opacity: teaserOpacity,
            textAlign: "center",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 52,
              fontWeight: 600,
              color: "rgba(240,230,255,0.85)",
              letterSpacing: "0.06em",
              fontFamily: FONT,
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
            }}
          >
            でも一番大事なのは…
          </div>
        </div>

        {/* Main headline */}
        <div
          style={{
            transform: `translateY(${mainY}px)`,
            opacity: mainOpacity,
            textAlign: "center",
            marginBottom: 32,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              lineHeight: 1.3,
              letterSpacing: "0.03em",
              color: WHITE,
              fontFamily: FONT,
              textShadow: `
                0 0 40px rgba(123,47,190,0.8),
                0 3px 14px rgba(0,0,0,0.8)
              `,
            }}
          >
            自分の声を
            <br />
            <span style={{ color: GOLD }}>客観的に</span>
            知ること
          </div>
        </div>

        {/* Radar chart */}
        <div style={{ opacity: radarOpacity }}>
          <VocalRadar progress={radarProgress} size={380} />
        </div>

        {/* Score pills */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 20,
            marginTop: 24,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <ScorePill label="総合" score={68} frame={frame} delay={95} fps={fps} />
          <ScorePill label="高音力" score={48} frame={frame} delay={110} fps={fps} />
        </div>

        {/* Sub text */}
        <div
          style={{
            transform: `translateY(${subY}px)`,
            opacity: subOpacity,
            textAlign: "center",
            marginTop: 32,
            padding: "18px 28px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: 18,
            border: "1px solid rgba(192,132,252,0.25)",
          }}
        >
          <div
            style={{
              fontSize: 38,
              fontWeight: 400,
              color: "rgba(240,230,255,0.85)",
              letterSpacing: "0.06em",
              fontFamily: FONT,
              lineHeight: 1.6,
              textShadow: "0 2px 8px rgba(0,0,0,0.5)",
            }}
          >
            今の課題が分かると、
            <br />
            <span style={{ color: PURPLE, fontWeight: 700 }}>練習は一気に変わる</span>
          </div>
        </div>
      </AbsoluteFill>

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
