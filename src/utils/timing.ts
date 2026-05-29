import { SLIDES } from "../data/slides";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const TRANSITION_FRAMES = 8;

export const SLIDE_DURATIONS_S = SLIDES.map((s) => s.durationSec ?? 3);

export const SLIDE_FRAMES = SLIDE_DURATIONS_S.map((d) => d * FPS);

export const SLIDE_STARTS: number[] = SLIDE_DURATIONS_S.reduce<number[]>(
  (acc, _, i) => {
    if (i === 0) return [0];
    return [...acc, acc[i - 1] + SLIDE_FRAMES[i - 1]];
  },
  []
);

export const TOTAL_FRAMES = SLIDE_FRAMES.reduce((a, b) => a + b, 0);
