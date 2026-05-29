export type SlideLayout = "center" | "bottom" | "cta";

export interface Slide {
  id: number;
  durationSec: number;
  visible: boolean;
  headline: string;
  subline: string;
  emphasis: string;
  image: string;
  layout: SlideLayout;
  showParticles: boolean;
  showCTA?: boolean;
  ctaLabel?: string;
  ctaNote?: string;
  ctaUrl?: string;
}

export interface CTAConfig {
  qrImage: string;
}

export interface SlidesData {
  title: string;
  slides: Slide[];
  cta: CTAConfig;
}
