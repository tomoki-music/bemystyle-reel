import React from "react";
import { AbsoluteFill } from "remotion";
import { SafeArea } from "./SafeArea";

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
const BRAND_COLOR = "#C084FC";
const BRAND_BOTTOM = 360;
const BRAND_RIGHT = 200;

const JUSTIFY_MAP = {
  top: "flex-start",
  center: "center",
  bottom: "flex-end",
} as const;

const BG_VARIANTS = {
  dark: "#060011",
  purple: "#1a0035",
  blue: "#001840",
  light: "#f0e8ff",
} as const;

type ContentAlign = keyof typeof JUSTIFY_MAP;
type BackgroundVariant = keyof typeof BG_VARIANTS;

interface ShortsLayoutProps {
  children: React.ReactNode;
  // Scene fade opacity (applied to the root AbsoluteFill)
  opacity?: number;
  // Background layer rendered behind SafeArea
  background?: React.ReactNode;
  backgroundVariant?: BackgroundVariant;
  // Brand watermark
  brand?: string;
  brandSubtitle?: string;
  showBrand?: boolean;
  brandOpacity?: number;
  brandAlign?: "center" | "right";
  brandFontSize?: number;
  brandSubtitleFontSize?: number;
  // Content layout inside SafeArea
  contentAlign?: ContentAlign;
  contentStyle?: React.CSSProperties;
}

/**
 * Standard wrapper for all YouTube Shorts vertical videos.
 *
 * Layer order:
 *   1. background (SingingBackground, gradients, decorative glows)
 *   2. SafeArea  (all text / interactive content)
 *   3. brand watermark (safe-area position, animated via brandOpacity)
 *
 * Safe area constants live in SafeArea.tsx and are enforced here automatically.
 * Pass REMOTION_SHOW_SAFE_AREA=true to see debug overlays.
 */
export const ShortsLayout: React.FC<ShortsLayoutProps> = ({
  children,
  opacity = 1,
  background,
  backgroundVariant,
  brand,
  brandSubtitle,
  showBrand = false,
  brandOpacity = 0.65,
  brandAlign = "right",
  brandFontSize = 28,
  brandSubtitleFontSize = 22,
  contentAlign = "center",
  contentStyle,
}) => {
  const rootStyle = backgroundVariant
    ? { opacity, background: BG_VARIANTS[backgroundVariant] }
    : { opacity };

  return (
    <AbsoluteFill style={rootStyle}>
      {background}

      <SafeArea innerStyle={{ justifyContent: JUSTIFY_MAP[contentAlign], ...contentStyle }}>
        {children}
      </SafeArea>

      {showBrand && brand && (
        <div
          style={{
            position: "absolute",
            bottom: BRAND_BOTTOM,
            ...(brandAlign === "center"
              ? { left: "50%", transform: "translateX(-50%)", textAlign: "center" }
              : { right: BRAND_RIGHT }),
            opacity: brandOpacity,
          }}
        >
          <div
            style={{
              fontSize: brandFontSize,
              fontWeight: 700,
              color: BRAND_COLOR,
              letterSpacing: "0.1em",
              fontFamily: FONT,
              textShadow: "0 0 12px rgba(192,132,252,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            {brand}
          </div>
          {brandSubtitle && (
            <div
              style={{
                fontSize: brandSubtitleFontSize,
                fontWeight: 400,
                color: "rgba(192,132,252,0.55)",
                letterSpacing: "0.1em",
                fontFamily: FONT,
                marginTop: 4,
                whiteSpace: "nowrap",
              }}
            >
              {brandSubtitle}
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};
