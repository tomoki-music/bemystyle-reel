import { interpolate, spring } from "remotion";

export const fadeIn = (frame: number, duration = 10, start = 0) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const fadeOut = (frame: number, totalFrames: number, duration = 10) =>
  interpolate(frame, [totalFrames - duration, totalFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const slideUpSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 18, stiffness: 110, mass: 0.6 },
    from: 50,
    to: 0,
  });

export const opacitySpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 20, stiffness: 120, mass: 0.5 },
    from: 0,
    to: 1,
  });

// Ken Burns slow zoom on background
export const kenBurns = (frame: number, totalFrames: number, factor = 1.06) =>
  interpolate(frame, [0, totalFrames], [1, factor], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

// Pulsing scale for CTA
export const pulse = (frame: number, frequency = 0.05, amount = 0.03) =>
  1 + Math.sin(frame * frequency * Math.PI * 2) * amount;
