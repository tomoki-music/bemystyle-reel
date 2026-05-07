/**
 * HighToneSinging — 高音テーマ 縦型ショート動画
 * 1080 x 1920 / 30fps / 45s (1350 frames)
 *
 * Scene timing:
 *   SceneHook           :  0 –  90 ( 3s)
 *   SceneProblem        : 90 – 240 ( 5s)
 *   SceneConclusion     :240 – 450 ( 7s)
 *   SceneAdvice         :450 – 720 ( 9s)
 *   ScenePractice       :720 – 960 ( 8s)
 *   SceneObjectiveCheck :960 –1170 ( 7s)
 *   SceneCTA            :1170–1350 ( 6s)
 */
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { SceneHook } from "../../components/singing/SceneHook";
import { SceneProblem } from "../../components/singing/SceneProblem";
import { SceneConclusion } from "../../components/singing/SceneConclusion";
import { SceneAdvice } from "../../components/singing/SceneAdvice";
import { ScenePractice } from "../../components/singing/ScenePractice";
import { SceneObjectiveCheck } from "../../components/singing/SceneObjectiveCheck";
import { SceneCTA } from "../../components/singing/SceneCTA";

export const SINGING_TOTAL_FRAMES = 1350; // 45s @ 30fps

const SCENES = [
  { name: "Hook",           from:    0, duration:  90, Component: SceneHook          },
  { name: "Problem",        from:   90, duration: 150, Component: SceneProblem       },
  { name: "Conclusion",     from:  240, duration: 210, Component: SceneConclusion    },
  { name: "Advice",         from:  450, duration: 270, Component: SceneAdvice        },
  { name: "Practice",       from:  720, duration: 240, Component: ScenePractice      },
  { name: "ObjectiveCheck", from:  960, duration: 210, Component: SceneObjectiveCheck},
  { name: "CTA",            from: 1170, duration: 180, Component: SceneCTA           },
] as const;

export const HighToneSinging: React.FC = () => {
  // frame is available here but we don't need it; each scene uses useCurrentFrame() internally
  useCurrentFrame(); // keep in scope so React doesn't warn on unused hook

  return (
    <AbsoluteFill style={{ background: "#060011" }}>
      {SCENES.map(({ name, from, duration, Component }) => (
        <Sequence key={name} from={from} durationInFrames={duration} name={name}>
          <Component />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
