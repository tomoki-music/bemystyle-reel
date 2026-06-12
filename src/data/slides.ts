import slidesJson from "../../public/data/slides.json";

export type SlideLayout = "top" | "center" | "bottom" | "cta";

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

const _ctaRaw = (slidesJson as { cta?: { qrImage?: string } }).cta;
export const CTA_CONFIG: { qrImage: string } = { qrImage: _ctaRaw?.qrImage ?? 'qr-singing.png' };
