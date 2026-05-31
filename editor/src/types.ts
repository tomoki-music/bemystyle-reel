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
  imagePrompt?: string;
}

export interface CTAConfig {
  qrImage: string;
}

export interface SlidesData {
  title: string;
  slides: Slide[];
  cta: CTAConfig;
}

export interface TemplateHints {
  imageCount: number;
  durationSec: number;
  ctaNote: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  hints: TemplateHints | null;
  favorite?: boolean;
  category?: string;
  description?: string;
  variables?: string[];
  thumbnail?: string;
  usageCount?: number;
}

export interface Template extends SlidesData {
  id: string;
  name: string;
  hints: TemplateHints | null;
  favorite?: boolean;
  category?: string;
  description?: string;
  variables?: string[];
  thumbnail?: string;
}
