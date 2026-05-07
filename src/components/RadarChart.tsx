import React from "react";
import { interpolate } from "remotion";

interface Props {
  frame: number;
  size?: number;
}

const AXES = ["音程", "リズム", "声量", "音色", "ビブラート", "表現力"];
const VALUES = [0.88, 0.65, 0.78, 0.55, 0.72, 0.92];
const PURPLE = "#C084FC";
const GLOW = "rgba(192,132,252,0.6)";

const polar = (cx: number, cy: number, r: number, angle: number) => ({
  x: cx + r * Math.cos(angle - Math.PI / 2),
  y: cy + r * Math.sin(angle - Math.PI / 2),
});

export const RadarChart: React.FC<Props> = ({ frame, size = 320 }) => {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38;
  const n = AXES.length;

  // フレームに応じてアニメーション（最初の15フレームで描画）
  const progress = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const angles = AXES.map((_, i) => ((Math.PI * 2) / n) * i);

  // レーダーの頂点
  const points = VALUES.map((v, i) => {
    const r = maxR * v * progress;
    return polar(cx, cy, r, angles[i]);
  });

  const polygonPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // グリッド
  const grids = [0.33, 0.66, 1.0];

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
      <svg
        width={size}
        height={size}
        style={{
          filter: `drop-shadow(0 0 20px ${GLOW})`,
          overflow: "visible",
        }}
      >
        {/* グリッド円 */}
        {grids.map((g, gi) => (
          <polygon
            key={gi}
            points={angles
              .map((a) => {
                const p = polar(cx, cy, maxR * g, a);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgba(192,132,252,0.2)"
            strokeWidth={1}
          />
        ))}

        {/* 軸ライン */}
        {angles.map((a, i) => {
          const end = polar(cx, cy, maxR, a);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="rgba(192,132,252,0.25)"
              strokeWidth={1}
            />
          );
        })}

        {/* データポリゴン */}
        <polygon
          points={polygonPoints}
          fill="rgba(123,47,190,0.35)"
          stroke={PURPLE}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />

        {/* 頂点ドット */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill={PURPLE}
            style={{ filter: `drop-shadow(0 0 6px ${PURPLE})` }}
          />
        ))}

        {/* ラベル */}
        {angles.map((a, i) => {
          const p = polar(cx, cy, maxR + 28, a);
          return (
            <text
              key={i}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="rgba(240,230,255,0.85)"
              fontSize={20}
              fontWeight={600}
              fontFamily='"Noto Sans JP", sans-serif'
            >
              {AXES[i]}
            </text>
          );
        })}
      </svg>
    </div>
  );
};
