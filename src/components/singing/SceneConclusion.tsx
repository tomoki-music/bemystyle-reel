/**
 * SceneConclusion — 8〜15s (210 frames)
 * 「高音は"喉の力"じゃない」→ 3要素カード
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SingingBackground } from "./SingingBackground";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const PURPLE = "#C084FC";
const GOLD = "#F0BF6A";
const WHITE = "#FFFFFF";
const TRANS = 8;

// ─── Concept icons ────────────────────────────────────────────────

// 開く: expanding arcs
const IconOpen: React.FC = () => (
  <svg width={56} height={56} viewBox="0 0 56 56" fill="none">
    <circle cx={28} cy={28} r={6} fill={PURPLE} />
    <circle cx={28} cy={28} r={14} stroke={PURPLE} strokeWidth={2} opacity={0.6} />
    <circle cx={28} cy={28} r={22} stroke={PURPLE} strokeWidth={1.5} opacity={0.35} />
    {/* Outward arrows */}
    <path d="M28 2 L28 8 M28 48 L28 54 M2 28 L8 28 M48 28 L54 28"
      stroke={GOLD} strokeWidth={2} strokeLinecap="round" opacity={0.7}
    />
  </svg>
);

// 閉じる: converging lines to center point
const IconClose: React.FC = () => (
  <svg width={56} height={56} viewBox="0 0 56 56" fill="none">
    <circle cx={28} cy={28} r={8} fill={PURPLE} opacity={0.9} />
    <path d="M4 4 L22 22 M52 4 L34 22 M4 52 L22 34 M52 52 L34 34"
      stroke={PURPLE} strokeWidth={2} strokeLinecap="round" opacity={0.7}
    />
    <circle cx={28} cy={28} r={3} fill={WHITE} />
  </svg>
);

// 張る: upward arrow with tension lines
const IconStretch: React.FC = () => (
  <svg width={56} height={56} viewBox="0 0 56 56" fill="none">
    {/* Arrow up */}
    <path d="M28 48 L28 12" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" />
    <path d="M16 24 L28 12 L40 24" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    {/* Tension waves */}
    <path d="M8 36 Q14 32 20 36 Q26 40 32 36 Q38 32 44 36 Q48 38 52 36"
      stroke={PURPLE} strokeWidth={1.5} fill="none" opacity={0.6}
    />
    <path d="M8 44 Q14 40 20 44 Q26 48 32 44 Q38 40 44 44 Q48 46 52 44"
      stroke={PURPLE} strokeWidth={1} fill="none" opacity={0.4}
    />
  </svg>
);

interface ConceptCardProps {
  icon: React.ReactNode;
  label: string;
  sub: string;
  color: string;
  frame: number;
  delay: number;
  fps: number;
}

const ConceptCard: React.FC<ConceptCardProps> = ({ icon, label, sub, color, frame, delay, fps }) => {
  const f = frame - delay;
  const scale = spring({ frame: f, fps, config: { damping: 15, stiffness: 100, mass: 0.7 }, from: 0.5, to: 1 });
  const opacity = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        background: "rgba(255,255,255,0.06)",
        border: `1.5px solid ${color}40`,
        borderRadius: 24,
        padding: "28px 20px",
        flex: 1,
        backdropFilter: "blur(6px)",
        boxShadow: `0 0 24px ${color}20`,
      }}
    >
      <div style={{ filter: `drop-shadow(0 0 10px ${color})` }}>{icon}</div>
      <div
        style={{
          fontSize: 52,
          fontWeight: 900,
          color: WHITE,
          letterSpacing: "0.06em",
          fontFamily: FONT,
          textShadow: `0 0 20px ${color}`,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 400,
          color: `${color}CC`,
          letterSpacing: "0.08em",
          fontFamily: FONT,
          textAlign: "center",
          lineHeight: 1.4,
        }}
      >
        {sub}
      </div>
    </div>
  );
};

const CARDS = [
  { icon: <IconOpen />,    label: "開く",   sub: "空間をつくる",   color: PURPLE, delay: 60  },
  { icon: <IconClose />,   label: "閉じる", sub: "声の芯をつくる", color: "#818CF8", delay: 85  },
  { icon: <IconStretch />, label: "張る",   sub: "音の高さを出す", color: GOLD,   delay: 110 },
];

export const SceneConclusion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, TRANS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - TRANS, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  // Headline
  const headY = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 95, mass: 0.7 }, from: 50, to: 0 });
  const headOpacity = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Sub headline
  const subOpacity = interpolate(frame, [22, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY = spring({ frame: frame - 22, fps, config: { damping: 18, stiffness: 100, mass: 0.6 }, from: 30, to: 0 });

  // Balance label
  const balOpacity = interpolate(frame, [130, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <SingingBackground variant="default" />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 60px",
          gap: 0,
        }}
      >
        {/* Headline */}
        <div
          style={{
            transform: `translateY(${headY}px)`,
            opacity: headOpacity,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 80,
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
            高音は
            <br />
            <span style={{ color: PURPLE }}>
              "喉の力"
            </span>
            じゃない
          </div>
        </div>

        {/* Sub: 3要素 */}
        <div
          style={{
            transform: `translateY(${subY}px)`,
            opacity: subOpacity,
            textAlign: "center",
            marginBottom: 52,
          }}
        >
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: GOLD,
              fontFamily: FONT,
              textShadow: `0 0 24px rgba(240,191,106,0.6), 0 2px 8px rgba(0,0,0,0.6)`,
            }}
          >
            開く × 閉じる × 張る
          </div>
        </div>

        {/* Concept cards row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 20,
            width: "100%",
          }}
        >
          {CARDS.map((c) => (
            <ConceptCard
              key={c.label}
              icon={c.icon}
              label={c.label}
              sub={c.sub}
              color={c.color}
              frame={frame}
              delay={c.delay}
              fps={fps}
            />
          ))}
        </div>

        {/* Balance label */}
        <div
          style={{
            opacity: balOpacity,
            marginTop: 36,
            fontSize: 38,
            fontWeight: 400,
            color: "rgba(240,230,255,0.75)",
            letterSpacing: "0.1em",
            fontFamily: FONT,
            textAlign: "center",
            textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          この3つのバランスが大事
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
