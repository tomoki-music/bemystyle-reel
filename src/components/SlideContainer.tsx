import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { interpolate } from "remotion";
import { SlideData } from "../data/slides";
import { ParticleField } from "./ParticleField";
import { AnimatedText } from "./AnimatedText";
import { SublineText } from "./SublineText";
import { CTAButton } from "./CTAButton";
import { RadarChart } from "./RadarChart";
import { GrowthGraph } from "./GrowthGraph";
import { kenBurns } from "../utils/animations";
import { TRANSITION_FRAMES } from "../utils/timing";

interface Props {
  slide: SlideData;
  frame: number;          // Sequence-local frame
  durationInFrames: number;
}

export const SlideContainer: React.FC<Props> = ({
  slide,
  frame,
  durationInFrames,
}) => {
  const { fps } = useVideoConfig();

  // --- フェード イン / アウト ---
  const fadeIn = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - TRANSITION_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  // Ken Burns（背景ゆっくりズーム）
  const bgScale = kenBurns(frame, durationInFrames, 1.07);

  // レイアウト別の縦位置
  const isBottom = slide.layout === "bottom";
  const isCTA = slide.layout === "cta";

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* ── 背景画像 ── */}
      <AbsoluteFill
        style={{
          transform: `scale(${bgScale})`,
          overflow: "hidden",
        }}
      >
        <Img
          src={staticFile(`assets/slides/${slide.image}`)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* ── オーバーレイ（グラデーション） ── */}
      <AbsoluteFill
        style={{
          background: isCTA
            ? "linear-gradient(to bottom, rgba(13,5,30,0.45) 0%, rgba(13,5,30,0.55) 38%, rgba(13,5,30,0.86) 72%, rgba(13,5,30,0.96) 100%)"
            : isBottom
            ? "linear-gradient(to bottom, rgba(13,13,13,0.1) 0%, rgba(13,13,13,0.85) 100%)"
            : "linear-gradient(to bottom, rgba(13,13,13,0.35) 0%, rgba(13,13,13,0.75) 60%, rgba(13,13,13,0.92) 100%)",
        }}
      />

      {/* ── 紫グロー光源（上部） ── */}
      <div
        style={{
          position: "absolute",
          top: -200,
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(123,47,190,0.35) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* ── パーティクル ── */}
      {slide.showParticles && <ParticleField frame={frame} />}

      {/* ── コンテンツ ── */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isBottom || isCTA ? "flex-end" : "center",
          paddingBottom: isBottom || isCTA ? 160 : 0,
        }}
      >
        {/* レーダーチャート（Slide 5） */}
        {slide.showRadar && <RadarChart frame={frame} size={360} />}

        {/* 成長グラフ（Slide 8） */}
        {slide.showGraph && <GrowthGraph frame={frame} width={900} height={300} />}

        {/* メインテキスト */}
        <AnimatedText
          text={slide.headline}
          frame={frame}
          emphasis={slide.emphasis}
          fontSize={slide.showRadar || slide.showGraph ? 60 : 76}
          align="center"
        />

        {/* サブテキスト */}
        {slide.subline && (
          <SublineText
            text={slide.subline}
            frame={frame}
            emphasis={slide.emphasis}
            fontSize={44}
          />
        )}

        {/* CTA ボタン */}
        {slide.showCTA && (
          <CTAButton
            frame={frame}
            label={slide.ctaLabel ?? "今すぐ無料で始める"}
            note={slide.ctaNote}
            url={slide.ctaUrl}
            delay={22}
          />
        )}
      </AbsoluteFill>

      {/* ── ロゴ（右下） ── */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          right: 60,
          opacity: interpolate(frame, [10, 24], [0, 0.7], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontSize: 28,
          fontWeight: 700,
          color: "rgba(192,132,252,0.8)",
          letterSpacing: "0.1em",
          fontFamily:
            '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif',
          textShadow: "0 0 12px rgba(192,132,252,0.6)",
          display: slide.showCTA ? "none" : "block",
        }}
      >
        BeMyStyle
      </div>
    </AbsoluteFill>
  );
};
