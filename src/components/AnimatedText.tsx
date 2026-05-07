import React from "react";
import { useVideoConfig, interpolate, spring } from "remotion";

interface Props {
  text: string;       // \n で改行
  frame: number;
  emphasis?: string;  // この文字列だけ薄紫で強調
  fontSize?: number;
  stagger?: number;   // 行ごとの遅延フレーム
  align?: "center" | "left";
}

const PURPLE = "#C084FC";
const WHITE = "#FFFFFF";

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

export const AnimatedText: React.FC<Props> = ({
  text,
  frame,
  emphasis,
  fontSize = 72,
  stagger = 7,
  align = "center",
}) => {
  const { fps } = useVideoConfig();
  const lines = text.split("\n");

  return (
    <div
      style={{
        textAlign: align,
        width: "100%",
        padding: "0 60px",
      }}
    >
      {lines.map((line, i) => {
        const f = frame - i * stagger;
        const translateY = spring({
          frame: f,
          fps,
          config: { damping: 18, stiffness: 100, mass: 0.65 },
          from: 55,
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
              fontWeight: 700,
              lineHeight: 1.35,
              letterSpacing: "0.04em",
              color: WHITE,
              // テキストシャドウで光彩
              textShadow: `
                0 0 30px rgba(123,47,190,0.9),
                0 0 60px rgba(123,47,190,0.5),
                0 2px 8px rgba(0,0,0,0.8)
              `,
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
