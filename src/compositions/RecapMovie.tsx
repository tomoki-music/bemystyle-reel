/**
 * RecapMovie — 年間 Recap 縦型ショート動画
 * 1080 x 1920 / 30fps / 15s (450 frames)
 *
 * Scene timing:
 *   Opening :  0 – 119 ( 4s) "Your Singing Recap"
 *   Year    :120 – 299 ( 6s) "2026"
 *   Ending  :300 – 449 ( 5s) "Keep Singing. Keep Growing."
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type RecapMovieProps = {
  recapMovieId: number;
  customerId: number;
  year: number;
  theme?: string;
};

export const RECAP_FPS = 30;
export const RECAP_WIDTH = 1080;
export const RECAP_HEIGHT = 1920;
export const RECAP_TOTAL_FRAMES = 450; // 15s @ 30fps

// ── Shared gradient background ────────────────────────────────────────────────
const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(160deg, #0a0015 0%, #12003a 30%, #1a0050 60%, #0d0028 100%)",
    }}
  />
);

// Subtle noise overlay for texture
const NoiseOverlay: React.FC<{ opacity: number }> = ({ opacity }) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E\")",
      backgroundSize: "200px 200px",
    }}
  />
);

// Glow circle decoration
const GlowCircle: React.FC<{ cx: string; cy: string; color: string; size: number; opacity: number }> = ({
  cx, cy, color, size, opacity,
}) => (
  <div
    style={{
      position: "absolute",
      left: cx,
      top: cy,
      transform: "translate(-50%, -50%)",
      width: size,
      height: size,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      opacity,
      pointerEvents: "none",
    }}
  />
);

// ── Scene: Opening ─────────────────────────────────────────────────────────────
const SceneOpening: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeInOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOutOpacity = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeInOpacity, fadeOutOpacity);

  const slideY = interpolate(frame, [0, 25], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const eyebrowOpacity = interpolate(frame, [12, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eyebrowY = interpolate(frame, [12, 30], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      <Background />
      <NoiseOverlay opacity={0.04} />
      <GlowCircle cx="20%" cy="18%" color="rgba(140, 60, 255, 0.55)" size={700} opacity={0.7} />
      <GlowCircle cx="85%" cy="78%" color="rgba(80, 120, 255, 0.45)" size={600} opacity={0.6} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity,
          transform: `translateY(${slideY}px)`,
        }}
      >
        {/* Eyebrow label */}
        <div
          style={{
            opacity: eyebrowOpacity,
            transform: `translateY(${eyebrowY}px)`,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "10px 28px",
              border: "1px solid rgba(200, 160, 255, 0.35)",
              borderRadius: 999,
              background: "rgba(140, 60, 255, 0.18)",
              color: "rgba(220, 190, 255, 0.92)",
              fontSize: 30,
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            BeMyStyle
          </div>
        </div>

        {/* Main title */}
        <h1
          style={{
            margin: 0,
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 96,
            fontWeight: 900,
            lineHeight: 1.1,
            color: "#ffffff",
            textAlign: "center",
            letterSpacing: "-0.01em",
          }}
        >
          Your Singing
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #60a5fa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Recap
          </span>
        </h1>

        {/* Decorative line */}
        <div
          style={{
            marginTop: 40,
            width: interpolate(frame, [20, 60], [0, 180], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            height: 3,
            borderRadius: 999,
            background: "linear-gradient(90deg, #c084fc, #60a5fa)",
            opacity: 0.8,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene: Year ────────────────────────────────────────────────────────────────
const SceneYear: React.FC<{ year: number }> = ({ year }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeInOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOutOpacity = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeInOpacity, fadeOutOpacity);

  const yearScale = interpolate(frame, [0, 30], [0.88, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const yearSlideY = interpolate(frame, [0, 30], [50, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [25, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bgScale = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
      <Background />
      <NoiseOverlay opacity={0.04} />
      <GlowCircle cx="50%" cy="42%" color="rgba(192, 100, 255, 0.6)" size={900} opacity={0.55} />
      <GlowCircle cx="50%" cy="42%" color="rgba(100, 150, 255, 0.4)" size={500} opacity={0.45} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity,
        }}
      >
        <div
          style={{
            marginBottom: 20,
            opacity: subtitleOpacity,
            color: "rgba(200, 160, 255, 0.8)",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          Year in Review
        </div>

        {/* Year number */}
        <div
          style={{
            transform: `translateY(${yearSlideY}px) scale(${yearScale})`,
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 240,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            background: "linear-gradient(160deg, #ffffff 20%, #c084fc 60%, #818cf8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {year}
        </div>

        {/* Accent dots */}
        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 48,
            opacity: subtitleOpacity,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: i === 1 ? 28 : 10,
                height: 10,
                borderRadius: 999,
                background:
                  i === 1
                    ? "linear-gradient(90deg, #c084fc, #60a5fa)"
                    : "rgba(200, 160, 255, 0.4)",
              }}
            />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene: Ending ──────────────────────────────────────────────────────────────
const SceneEnding: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeInOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOutOpacity = interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeInOpacity, fadeOutOpacity);

  const slideY = interpolate(frame, [0, 28], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [30, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [30, 55], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bgScale = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
      <Background />
      <NoiseOverlay opacity={0.04} />
      <GlowCircle cx="75%" cy="25%" color="rgba(120, 80, 255, 0.5)" size={700} opacity={0.65} />
      <GlowCircle cx="25%" cy="72%" color="rgba(80, 140, 255, 0.45)" size={600} opacity={0.6} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 80px",
          opacity,
          transform: `translateY(${slideY}px)`,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 88,
            fontWeight: 900,
            lineHeight: 1.15,
            color: "#ffffff",
            textAlign: "center",
            letterSpacing: "-0.01em",
          }}
        >
          Keep Singing.
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #60a5fa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Keep Growing.
          </span>
        </h2>

        {/* Tagline */}
        <p
          style={{
            marginTop: 48,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 34,
            fontWeight: 500,
            color: "rgba(200, 180, 240, 0.82)",
            textAlign: "center",
            letterSpacing: "0.04em",
            lineHeight: 1.5,
          }}
        >
          be-my-style.com
        </p>

        {/* Bottom bar */}
        <div
          style={{
            marginTop: 64,
            width: interpolate(frame, [25, 80], [0, 240], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            height: 3,
            borderRadius: 999,
            background: "linear-gradient(90deg, #c084fc, #60a5fa)",
            opacity: 0.75,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Main Composition ───────────────────────────────────────────────────────────
export const RecapMovie: React.FC<RecapMovieProps> = ({ year }) => {
  return (
    <AbsoluteFill style={{ background: "#0a0015" }}>
      {/* Opening: 0–119 (4s) */}
      <Sequence from={0} durationInFrames={120} name="Opening">
        <SceneOpening />
      </Sequence>

      {/* Year: 120–299 (6s) */}
      <Sequence from={120} durationInFrames={180} name="Year">
        <SceneYear year={year} />
      </Sequence>

      {/* Ending: 300–449 (5s) */}
      <Sequence from={300} durationInFrames={150} name="Ending">
        <SceneEnding />
      </Sequence>
    </AbsoluteFill>
  );
};
