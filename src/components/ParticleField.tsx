import React from "react";
import { AbsoluteFill } from "remotion";

// 決定論的パーティクル（黄金角ベース）
const PARTICLES = Array.from({ length: 55 }, (_, i) => ({
  id: i,
  x: ((i * 137.508) % 100),
  y: ((i * 73.2 + 17) % 100),
  r: 1.2 + ((i * 3) % 3),
  speed: 0.15 + ((i % 6) * 0.06),
  phase: i * 0.41,
  opacity: 0.25 + ((i % 5) * 0.1),
}));

interface Props {
  frame: number;
  intensity?: number; // 0–1
}

export const ParticleField: React.FC<Props> = ({ frame, intensity = 1 }) => (
  <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
    {PARTICLES.map((p) => {
      const y = ((p.y - frame * p.speed * 0.08) % 100 + 100) % 100;
      const alpha =
        (Math.sin(frame * 0.04 + p.phase) * 0.3 + p.opacity) * intensity;
      const glow = p.r * 4;

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
            background: `radial-gradient(circle, rgba(192,132,252,${Math.max(0, alpha)}) 0%, transparent 70%)`,
            boxShadow: `0 0 ${glow}px rgba(192,132,252,${Math.max(0, alpha * 0.6)})`,
            transform: "translate(-50%, -50%)",
          }}
        />
      );
    })}
  </AbsoluteFill>
);
