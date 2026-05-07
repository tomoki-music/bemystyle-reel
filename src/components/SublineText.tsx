import React from "react";
import { useVideoConfig, interpolate, spring } from "remotion";

interface Props {
  text: string;
  frame: number;
  emphasis?: string;
  delay?: number;
  fontSize?: number;
}

const PURPLE = "#C084FC";

const highlightText = (text: string, emphasis?: string): React.ReactNode => {
  if (!emphasis || !text.includes(emphasis)) return text;
  const parts = text.split(emphasis);
  return (
    <>
      {parts[0]}
      <span style={{ color: PURPLE, fontWeight: 700 }}>{emphasis}</span>
      {parts.slice(1).join(emphasis)}
    </>
  );
};

export const SublineText: React.FC<Props> = ({
  text,
  frame,
  emphasis,
  delay = 18,
  fontSize = 42,
}) => {
  const { fps } = useVideoConfig();
  const lines = text.split("\n");

  return (
    <div style={{ textAlign: "center", marginTop: 32, padding: "0 60px" }}>
      {lines.map((line, i) => {
        const f = frame - delay - i * 6;
        const translateY = spring({
          frame: f,
          fps,
          config: { damping: 20, stiffness: 120, mass: 0.5 },
          from: 30,
          to: 0,
        });
        const opacity = interpolate(f, [0, 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              transform: `translateY(${translateY}px)`,
              opacity,
              fontSize,
              fontWeight: 400,
              lineHeight: 1.5,
              letterSpacing: "0.06em",
              color: "rgba(240,230,255,0.9)",
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              fontFamily:
                '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif',
            }}
          >
            {highlightText(line, emphasis)}
          </div>
        );
      })}
    </div>
  );
};
