/**
 * RecapMovie — 年間 Recap 縦型ショート動画
 * 1080 x 1920 / 30fps / 15s (450 frames)
 *
 * Scene timing:
 *   Opening :  0 –  89 ( 3s) "Your Singing Recap" + userName
 *   Stats   : 90 – 239 ( 5s) diagnosisCount / bestScore / averageScore / voiceType / topGrowthMetric
 *   Year    :240 – 359 ( 4s) year number
 *   Ending  :360 – 449 ( 3s) "Keep Singing. Keep Growing."
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type RecapMovieProps = {
  recapMovieId: number;
  customerId: number;
  year: number;
  theme?: string;
  // Dynamic user data (all optional — safe fallbacks applied)
  userName?: string | null;
  diagnosisCount?: number | null;
  bestScore?: number | null;
  averageScore?: number | null;
  topGrowthMetric?: string | null;
  voiceType?: string | null;
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

const GlowCircle: React.FC<{
  cx: string;
  cy: string;
  color: string;
  size: number;
  opacity: number;
}> = ({ cx, cy, color, size, opacity }) => (
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

const fontStack = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// ── Scene: Opening ─────────────────────────────────────────────────────────────
const SceneOpening: React.FC<{ userName?: string | null }> = ({ userName }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const slideY = interpolate(frame, [0, 25], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const eyebrowOpacity = interpolate(frame, [10, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const nameOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const nameY = interpolate(frame, [30, 50], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const displayName = userName && userName.trim().length > 0 ? userName : null;

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      <Background />
      <NoiseOverlay opacity={0.04} />
      <GlowCircle
        cx="20%"
        cy="18%"
        color="rgba(140, 60, 255, 0.55)"
        size={700}
        opacity={0.7}
      />
      <GlowCircle
        cx="85%"
        cy="78%"
        color="rgba(80, 120, 255, 0.45)"
        size={600}
        opacity={0.6}
      />

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
            marginBottom: 24,
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
              fontFamily: fontStack,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase" as const,
            }}
          >
            BeMyStyle
          </div>
        </div>

        {/* Main title */}
        <h1
          style={{
            margin: 0,
            fontFamily: fontStack,
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
              background:
                "linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #60a5fa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Recap
          </span>
        </h1>

        {/* User name */}
        {displayName && (
          <div
            style={{
              marginTop: 28,
              opacity: nameOpacity,
              transform: `translateY(${nameY}px)`,
              color: "rgba(210, 190, 255, 0.85)",
              fontFamily: fontStack,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            {displayName}
          </div>
        )}

        {/* Decorative line */}
        <div
          style={{
            marginTop: 36,
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

// ── Scene: Stats ───────────────────────────────────────────────────────────────
const SceneStats: React.FC<{
  year: number;
  diagnosisCount?: number | null;
  bestScore?: number | null;
  averageScore?: number | null;
  voiceType?: string | null;
  topGrowthMetric?: string | null;
}> = ({ year, diagnosisCount, bestScore, averageScore, voiceType, topGrowthMetric }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const bgScale = interpolate(frame, [0, durationInFrames], [1.0, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Count number roll-up animation (0 → diagnosisCount over first 50 frames)
  const count = diagnosisCount ?? 0;
  const countProgress = interpolate(frame, [10, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const animatedCount = Math.round(count * countProgress);

  // Staggered card entrance
  const makeEntrance = (start: number) => ({
    opacity: interpolate(frame, [start, start + 20], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    translateY: interpolate(frame, [start, start + 20], [28, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  });

  const headerEnt = makeEntrance(5);
  const countEnt = makeEntrance(8);
  const scoresEnt = makeEntrance(30);
  const voiceEnt = makeEntrance(52);
  const growthEnt = makeEntrance(70);

  const hasScores = bestScore != null || averageScore != null;

  return (
    <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
      <Background />
      <NoiseOverlay opacity={0.04} />
      <GlowCircle
        cx="80%"
        cy="20%"
        color="rgba(160, 80, 255, 0.5)"
        size={800}
        opacity={0.5}
      />
      <GlowCircle
        cx="15%"
        cy="75%"
        color="rgba(60, 100, 255, 0.45)"
        size={600}
        opacity={0.55}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 72px",
          gap: 0,
          opacity,
        }}
      >
        {/* Year header */}
        <div
          style={{
            opacity: headerEnt.opacity,
            transform: `translateY(${headerEnt.translateY}px)`,
            marginBottom: 20,
            color: "rgba(200, 160, 255, 0.75)",
            fontFamily: fontStack,
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase" as const,
          }}
        >
          {year} Wrapped
        </div>

        {/* Diagnosis count — hero stat */}
        <div
          style={{
            opacity: countEnt.opacity,
            transform: `translateY(${countEnt.translateY}px)`,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontFamily: fontStack,
              fontSize: 160,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              background:
                "linear-gradient(160deg, #ffffff 10%, #c084fc 55%, #818cf8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {animatedCount}
          </div>
        </div>
        <div
          style={{
            opacity: countEnt.opacity,
            transform: `translateY(${countEnt.translateY}px)`,
            marginBottom: 44,
            color: "rgba(200, 180, 255, 0.8)",
            fontFamily: fontStack,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "0.1em",
          }}
        >
          回診断しました
        </div>

        {/* Score cards */}
        {hasScores && (
          <div
            style={{
              opacity: scoresEnt.opacity,
              transform: `translateY(${scoresEnt.translateY}px)`,
              display: "flex",
              gap: 20,
              marginBottom: 28,
              width: "100%",
            }}
          >
            {bestScore != null && (
              <StatCard label="最高スコア" value={bestScore} accent="#c084fc" />
            )}
            {averageScore != null && (
              <StatCard label="平均スコア" value={averageScore} accent="#818cf8" />
            )}
          </div>
        )}

        {/* Voice type badge */}
        {voiceType && (
          <div
            style={{
              opacity: voiceEnt.opacity,
              transform: `translateY(${voiceEnt.translateY}px)`,
              marginBottom: 24,
              padding: "14px 32px",
              border: "1px solid rgba(192, 132, 252, 0.35)",
              borderRadius: 999,
              background: "rgba(140, 60, 255, 0.2)",
              color: "rgba(220, 190, 255, 0.95)",
              fontFamily: fontStack,
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: "0.06em",
            }}
          >
            {voiceType}
          </div>
        )}

        {/* Top growth metric */}
        {topGrowthMetric && (
          <div
            style={{
              opacity: growthEnt.opacity,
              transform: `translateY(${growthEnt.translateY}px)`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "rgba(167, 243, 208, 0.9)",
              fontFamily: fontStack,
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            <span style={{ fontSize: 26 }}>↑</span>
            <span>{topGrowthMetric} が最も伸びた</span>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  accent: string;
}> = ({ label, value, accent }) => (
  <div
    style={{
      flex: 1,
      padding: "22px 20px",
      border: `1px solid ${accent}44`,
      borderRadius: 20,
      background: "rgba(255, 255, 255, 0.06)",
      textAlign: "center",
    }}
  >
    <div
      style={{
        fontFamily: fontStack,
        fontSize: 72,
        fontWeight: 900,
        lineHeight: 1,
        color: accent,
        marginBottom: 8,
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontFamily: fontStack,
        fontSize: 24,
        fontWeight: 600,
        color: "rgba(200, 180, 255, 0.75)",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </div>
  </div>
);

// ── Scene: Year ────────────────────────────────────────────────────────────────
const SceneYear: React.FC<{ year: number }> = ({ year }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const yearScale = interpolate(frame, [0, 30], [0.88, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const yearSlideY = interpolate(frame, [0, 30], [50, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [22, 48], [0, 1], {
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
      <GlowCircle
        cx="50%"
        cy="42%"
        color="rgba(192, 100, 255, 0.6)"
        size={900}
        opacity={0.55}
      />
      <GlowCircle
        cx="50%"
        cy="42%"
        color="rgba(100, 150, 255, 0.4)"
        size={500}
        opacity={0.45}
      />

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
            fontFamily: fontStack,
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase" as const,
          }}
        >
          Year in Review
        </div>

        <div
          style={{
            transform: `translateY(${yearSlideY}px) scale(${yearScale})`,
            fontFamily: fontStack,
            fontSize: 240,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            background:
              "linear-gradient(160deg, #ffffff 20%, #c084fc 60%, #818cf8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {year}
        </div>

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

  const fadeIn = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const slideY = interpolate(frame, [0, 28], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [28, 52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [28, 52], [22, 0], {
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
      <GlowCircle
        cx="75%"
        cy="25%"
        color="rgba(120, 80, 255, 0.5)"
        size={700}
        opacity={0.65}
      />
      <GlowCircle
        cx="25%"
        cy="72%"
        color="rgba(80, 140, 255, 0.45)"
        size={600}
        opacity={0.6}
      />

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
            fontFamily: fontStack,
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
              background:
                "linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #60a5fa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Keep Growing.
          </span>
        </h2>

        <p
          style={{
            marginTop: 48,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            fontFamily: fontStack,
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
export const RecapMovie: React.FC<RecapMovieProps> = ({
  year,
  userName,
  diagnosisCount,
  bestScore,
  averageScore,
  topGrowthMetric,
  voiceType,
}) => {
  return (
    <AbsoluteFill style={{ background: "#0a0015" }}>
      {/* Opening: 0–89 (3s) */}
      <Sequence from={0} durationInFrames={90} name="Opening">
        <SceneOpening userName={userName} />
      </Sequence>

      {/* Stats: 90–239 (5s) */}
      <Sequence from={90} durationInFrames={150} name="Stats">
        <SceneStats
          year={year}
          diagnosisCount={diagnosisCount}
          bestScore={bestScore}
          averageScore={averageScore}
          voiceType={voiceType}
          topGrowthMetric={topGrowthMetric}
        />
      </Sequence>

      {/* Year: 240–359 (4s) */}
      <Sequence from={240} durationInFrames={120} name="Year">
        <SceneYear year={year} />
      </Sequence>

      {/* Ending: 360–449 (3s) */}
      <Sequence from={360} durationInFrames={90} name="Ending">
        <SceneEnding />
      </Sequence>
    </AbsoluteFill>
  );
};
