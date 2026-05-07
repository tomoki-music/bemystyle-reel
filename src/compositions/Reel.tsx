import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { SLIDES } from "../data/slides";
import { SLIDE_FRAMES, SLIDE_STARTS } from "../utils/timing";
import { SlideContainer } from "../components/SlideContainer";

export const Reel: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: "#0D0D0D" }}>
      {/* ── BGM ──
          public/assets/audio/bgm.mp3 を差し替えてください
          volumeは 0〜1 で調整可能 */}
      <Audio
        src={staticFile("assets/audio/bgm.mp3")}
        volume={0.75}
        startFrom={0}
      />

      {/* ── スライド シーケンス ── */}
      {SLIDES.map((slide, i) => {
        const start = SLIDE_STARTS[i];
        const duration = SLIDE_FRAMES[i];

        return (
          <Sequence
            key={slide.id}
            from={start}
            durationInFrames={duration}
            name={`Slide ${slide.id}`}
          >
            <SlideContainer
              slide={slide}
              frame={frame - start}
              durationInFrames={duration}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
