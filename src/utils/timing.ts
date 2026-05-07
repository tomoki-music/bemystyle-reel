export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const TRANSITION_FRAMES = 8;

// Duration in seconds per slide: total = 45s
export const SLIDE_DURATIONS_S = [4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3, 4];

export const SLIDE_FRAMES = SLIDE_DURATIONS_S.map((d) => d * FPS);

// Cumulative start frame for each slide
export const SLIDE_STARTS: number[] = SLIDE_DURATIONS_S.reduce<number[]>(
  (acc, _, i) => {
    if (i === 0) return [0];
    return [...acc, acc[i - 1] + SLIDE_FRAMES[i - 1]];
  },
  []
);

export const TOTAL_FRAMES = SLIDE_FRAMES.reduce((a, b) => a + b, 0); // 1350
