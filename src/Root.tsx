import React from "react";
import { Composition } from "remotion";
import { Reel } from "./compositions/Reel";
import { TOTAL_FRAMES, FPS, WIDTH, HEIGHT } from "./utils/timing";
import { HighToneSinging, SINGING_TOTAL_FRAMES } from "./compositions/singing/HighToneSinging";
import {
  RecapMovie,
  RecapMovieProps,
  RECAP_FPS,
  RECAP_WIDTH,
  RECAP_HEIGHT,
  RECAP_TOTAL_FRAMES,
} from "./compositions/RecapMovie";

const DEFAULT_RECAP_PROPS: RecapMovieProps = {
  recapMovieId: 1,
  customerId: 1,
  year: new Date().getFullYear(),
  theme: "default",
  userName: "Tomoki",
  diagnosisCount: 48,
  bestScore: 91,
  averageScore: 84,
  topGrowthMetric: "音程",
  voiceType: "パワフルボイス",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BeMyStyleReel"
        component={Reel}
        durationInFrames={TOTAL_FRAMES} // 1350 frames = 45s
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="HighToneSinging"
        component={HighToneSinging}
        durationInFrames={SINGING_TOTAL_FRAMES} // 1350 frames = 45s
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="RecapMovie"
        component={RecapMovie}
        durationInFrames={RECAP_TOTAL_FRAMES} // 450 frames = 15s
        fps={RECAP_FPS}
        width={RECAP_WIDTH}
        height={RECAP_HEIGHT}
        defaultProps={DEFAULT_RECAP_PROPS}
      />
    </>
  );
};
