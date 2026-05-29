import React from "react";

export const SAFE_TOP = 250;
export const SAFE_BOTTOM = 350;
export const SAFE_LEFT = 80;
export const SAFE_RIGHT = 180;
const CTA_GUIDE_Y = 1100;

interface SafeAreaProps {
  children: React.ReactNode;
  // Applied to the inner flex container — does NOT override safe area padding
  innerStyle?: React.CSSProperties;
}

export const SafeArea: React.FC<SafeAreaProps> = ({ children, innerStyle }) => {
  const showDebug = process.env.REMOTION_SHOW_SAFE_AREA === "true";

  return (
    <>
      {/*
       * Outer div: full-screen position + safe-area padding only.
       * Inner div: flex layout + caller overrides.
       * Separated so caller's padding prop never clobbers the safe-area insets.
       */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: SAFE_TOP,
          paddingBottom: SAFE_BOTTOM,
          paddingLeft: SAFE_LEFT,
          paddingRight: SAFE_RIGHT,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            ...innerStyle,
          }}
        >
          {children}
        </div>
      </div>

      {showDebug && (
        <>
          {/* Safe area border */}
          <div
            style={{
              position: "absolute",
              top: SAFE_TOP,
              bottom: SAFE_BOTTOM,
              left: SAFE_LEFT,
              right: SAFE_RIGHT,
              border: "4px dashed #00ff88",
              pointerEvents: "none",
              zIndex: 9999,
              boxSizing: "border-box",
            }}
          />
          {/* Top danger zone */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: SAFE_TOP, background: "rgba(255,40,40,0.18)", pointerEvents: "none", zIndex: 9998 }} />
          <div style={{ position: "absolute", top: SAFE_TOP / 2, left: "50%", transform: "translate(-50%, -50%)", color: "rgba(255,80,80,0.95)", fontSize: 26, fontWeight: 800, zIndex: 9999, letterSpacing: "0.08em", textShadow: "0 1px 6px rgba(0,0,0,0.8)", fontFamily: "monospace" }}>
            ▲ TOP UI RISK  {SAFE_TOP}px
          </div>
          {/* Bottom danger zone */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: SAFE_BOTTOM, background: "rgba(255,40,40,0.18)", pointerEvents: "none", zIndex: 9998 }} />
          <div style={{ position: "absolute", bottom: SAFE_BOTTOM / 2, left: "50%", transform: "translate(-50%, 50%)", color: "rgba(255,80,80,0.95)", fontSize: 26, fontWeight: 800, zIndex: 9999, letterSpacing: "0.08em", textShadow: "0 1px 6px rgba(0,0,0,0.8)", fontFamily: "monospace" }}>
            ▼ BOTTOM CAPTION RISK  {SAFE_BOTTOM}px
          </div>
          {/* Right danger zone */}
          <div style={{ position: "absolute", top: SAFE_TOP, bottom: SAFE_BOTTOM, right: 0, width: SAFE_RIGHT, background: "rgba(255,140,0,0.14)", pointerEvents: "none", zIndex: 9998 }} />
          <div style={{ position: "absolute", top: "50%", right: SAFE_RIGHT / 2, transform: "translate(50%, -50%) rotate(90deg)", color: "rgba(255,140,0,0.95)", fontSize: 22, fontWeight: 700, zIndex: 9999, whiteSpace: "nowrap", textShadow: "0 1px 6px rgba(0,0,0,0.8)", fontFamily: "monospace" }}>
            RIGHT BUTTON AREA {SAFE_RIGHT}px
          </div>
          {/* Left zone (subtle) */}
          <div style={{ position: "absolute", top: SAFE_TOP, bottom: SAFE_BOTTOM, left: 0, width: SAFE_LEFT, background: "rgba(255,140,0,0.08)", pointerEvents: "none", zIndex: 9998 }} />
          {/* CTA safe position guideline */}
          <div style={{ position: "absolute", top: CTA_GUIDE_Y, left: SAFE_LEFT, right: SAFE_RIGHT, height: 2, background: "rgba(0,255,136,0.4)", pointerEvents: "none", zIndex: 9998 }} />
          <div style={{ position: "absolute", top: CTA_GUIDE_Y - 32, left: SAFE_LEFT + 8, color: "rgba(0,255,136,0.9)", fontSize: 22, fontWeight: 700, zIndex: 9999, letterSpacing: "0.06em", textShadow: "0 1px 6px rgba(0,0,0,0.8)", fontFamily: "monospace" }}>
            ── CTA SAFE POSITION  y={CTA_GUIDE_Y}
          </div>
        </>
      )}
    </>
  );
};
