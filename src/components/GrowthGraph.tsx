import React from "react";
import { interpolate } from "remotion";

interface Props {
  frame: number;
  width?: number;
  height?: number;
}

const DATA = [
  { label: "1月", value: 58 },
  { label: "2月", value: 67 },
  { label: "3月", value: 76 },
  { label: "4月", value: 82 },
];
const PURPLE = "#C084FC";
const MAX_VAL = 100;

export const GrowthGraph: React.FC<Props> = ({
  frame,
  width = 820,
  height = 280,
}) => {
  const progress = interpolate(frame, [0, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const padL = 60;
  const padR = 40;
  const padT = 30;
  const padB = 60;
  const graphW = width - padL - padR;
  const graphH = height - padT - padB;

  const points = DATA.map((d, i) => ({
    x: padL + (i / (DATA.length - 1)) * graphW,
    y: padT + graphH - (d.value / MAX_VAL) * graphH,
    ...d,
  }));

  // 進捗に応じて描画するポイント数
  const visibleLen = progress * (DATA.length - 1);

  const pathD = points
    .map((p, i) => {
      if (i > visibleLen) return "";
      const x =
        i < Math.floor(visibleLen)
          ? p.x
          : points[i - 1]
          ? points[i - 1].x + (p.x - points[i - 1].x) * (visibleLen - i + 1)
          : p.x;
      const y =
        i < Math.floor(visibleLen)
          ? p.y
          : points[i - 1]
          ? points[i - 1].y + (p.y - points[i - 1].y) * (visibleLen - i + 1)
          : p.y;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
      <svg
        width={width}
        height={height}
        style={{
          filter: "drop-shadow(0 0 20px rgba(192,132,252,0.4))",
          overflow: "visible",
        }}
      >
        {/* グリッド横線 */}
        {[25, 50, 75, 100].map((v) => {
          const y = padT + graphH - (v / MAX_VAL) * graphH;
          return (
            <g key={v}>
              <line
                x1={padL}
                y1={y}
                x2={padL + graphW}
                y2={y}
                stroke="rgba(192,132,252,0.15)"
                strokeWidth={1}
                strokeDasharray="4,4"
              />
              <text
                x={padL - 10}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgba(192,132,252,0.5)"
                fontSize={18}
                fontFamily="sans-serif"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* X軸 */}
        <line
          x1={padL}
          y1={padT + graphH}
          x2={padL + graphW}
          y2={padT + graphH}
          stroke="rgba(192,132,252,0.3)"
          strokeWidth={1.5}
        />

        {/* ライン */}
        <path
          d={pathD}
          fill="none"
          stroke={PURPLE}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* グラデーション塗り */}
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(192,132,252,0.3)" />
            <stop offset="100%" stopColor="rgba(192,132,252,0)" />
          </linearGradient>
        </defs>
        <path
          d={`${pathD} L${points[Math.min(Math.floor(visibleLen), DATA.length - 1)].x},${padT + graphH} L${padL},${padT + graphH} Z`}
          fill="url(#areaGrad)"
        />

        {/* ドットとラベル */}
        {points.map((p, i) => {
          if (i > visibleLen + 0.1) return null;
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={7}
                fill={PURPLE}
                style={{ filter: "drop-shadow(0 0 8px #C084FC)" }}
              />
              <text
                x={p.x}
                y={p.y - 20}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={22}
                fontWeight={700}
                fontFamily='"Noto Sans JP", sans-serif'
              >
                {p.value}点
              </text>
              <text
                x={p.x}
                y={padT + graphH + 30}
                textAnchor="middle"
                fill="rgba(240,230,255,0.7)"
                fontSize={20}
                fontFamily='"Noto Sans JP", sans-serif'
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
