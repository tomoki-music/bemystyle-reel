import React from "react";
import { Composition } from "remotion";
import { Reel } from "./compositions/Reel";
import { TOTAL_FRAMES, FPS, WIDTH, HEIGHT } from "./utils/timing";
import { HighToneSinging, SINGING_TOTAL_FRAMES } from "./compositions/singing/HighToneSinging";

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
    </>
  );
};
