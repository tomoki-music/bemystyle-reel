import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { interpolate, spring } from "remotion";
import { SlideData } from "../data/slides";
import { ParticleField } from "./ParticleField";
import { AnimatedText } from "./AnimatedText";
import { SublineText } from "./SublineText";
import { CTAButton } from "./CTAButton";
import { RadarChart } from "./RadarChart";
import { GrowthGraph } from "./GrowthGraph";
import { kenBurns } from "../utils/animations";
import { TRANSITION_FRAMES } from "../utils/timing";
import { resolveImageAssetPath } from "../utils/imageUrl";

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

  // CTA専用アニメーション（スライド14のみ）
  const qrScale = spring({ frame: frame - 28, fps, config: { damping: 16, stiffness: 100, mass: 0.7 }, from: 0.72, to: 1 });
  const qrOpacity = interpolate(frame, [28, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ctaLabelOpacity = interpolate(frame, [52, 68], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ctaNoteOpacity = interpolate(frame, [72, 88], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

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
          src={staticFile(resolveImageAssetPath(slide.image))}
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
      {isCTA ? (
        /*
         * スライド14 CTA専用レイアウト
         * QR中心 y=960（画面センター）、下端 y=1120 < 1200
         * YouTube Shorts下部UIと被らない配置
         */
        <AbsoluteFill>
          {/* ヘッドライン — SafeArea top(250)より下の上部エリア */}
          <div style={{ position: "absolute", top: 340, left: 0, right: 0 }}>
            <AnimatedText
              text={slide.headline}
              frame={frame}
              emphasis={slide.emphasis}
              fontSize={76}
              align="center"
            />
          </div>

          {/* QRコードブロック — top=800 → 中心 y=960、下端 y=1120 */}
          <div
            style={{
              position: "absolute",
              top: 800,
              left: "50%",
              transform: `translateX(-50%) scale(${qrScale})`,
              opacity: qrOpacity,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            {/* QR枠 320×320 — public/assets/qr-singing.png を差し替えてください */}
            <div
              style={{
                width: 320,
                height: 320,
                background: "white",
                borderRadius: 20,
                padding: 12,
                boxSizing: "border-box",
                boxShadow: "0 0 40px rgba(192,132,252,0.4), 0 4px 20px rgba(0,0,0,0.5)",
              }}
            >
              <Img
                src={staticFile("/assets/qr-singing.png")}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            </div>

            {/* "QRを読み取る" ラベル */}
            <div
              style={{
                opacity: ctaLabelOpacity,
                fontSize: 44,
                fontWeight: 700,
                color: "#FFFFFF",
                letterSpacing: "0.06em",
                fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif',
                textShadow: "0 2px 10px rgba(0,0,0,0.6)",
                whiteSpace: "nowrap",
              }}
            >
              {slide.ctaLabel ?? "QRを読み取る"}
            </div>
          </div>

          {/* 補足テキスト — YouTube下部UIに被っても良い情報のみ */}
          <div
            style={{
              position: "absolute",
              top: 1240,
              left: 80,
              right: 80,
              opacity: ctaNoteOpacity,
              textAlign: "center",
            }}
          >
            {slide.ctaNote && (
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.75)",
                  letterSpacing: "0.05em",
                  fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif',
                  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                }}
              >
                {slide.ctaNote}
              </div>
            )}
          </div>
        </AbsoluteFill>
      ) : (
        /* スライド1〜13: 既存レイアウト維持 */
        <AbsoluteFill
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: isBottom ? "flex-end" : "center",
            paddingBottom: isBottom ? 160 : 0,
          }}
        >
          {slide.showRadar && <RadarChart frame={frame} size={360} />}
          {slide.showGraph && <GrowthGraph frame={frame} width={900} height={300} />}
          <AnimatedText
            text={slide.headline}
            frame={frame}
            emphasis={slide.emphasis}
            fontSize={slide.showRadar || slide.showGraph ? 60 : 76}
            align="center"
          />
          {slide.subline && (
            <SublineText
              text={slide.subline}
              frame={frame}
              emphasis={slide.emphasis}
              fontSize={44}
            />
          )}
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
      )}

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
