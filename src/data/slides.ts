import slidesJson from "../../public/data/slides.json";

export type SlideLayout = "center" | "bottom" | "cta";

export interface SlideData {
  id: number;
  durationSec: number;
  visible: boolean;
  headline: string;
  subline?: string;
  emphasis?: string;
  image: string;
  layout: SlideLayout;
  showParticles: boolean;
  showCTA?: boolean;
  showRadar?: boolean;
  showGraph?: boolean;
  ctaLabel?: string;
  ctaNote?: string;
  ctaUrl?: string;
}

export const SLIDES: SlideData[] = slidesJson.slides as SlideData[];

export const CTA_CONFIG: { qrImage: string } = (slidesJson as { cta?: { qrImage?: string } }).cta as { qrImage: string } ?? { qrImage: 'qr-singing.png' };
