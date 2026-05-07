import React from "react";
import { Composition } from "remotion";
import { Reel } from "./compositions/Reel";
import { TOTAL_FRAMES, FPS, WIDTH, HEIGHT } from "./utils/timing";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BeMyStyleReel"
      component={Reel}
      durationInFrames={TOTAL_FRAMES} // 1350 frames = 45s
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
