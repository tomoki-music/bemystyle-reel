export type SlideLayout = "center" | "bottom" | "cta";

export interface SlideData {
  id: number;
  headline: string;
  subline?: string;
  emphasis?: string;
  image: string;
  layout: SlideLayout;
  showParticles: boolean;
  showCTA?: boolean;
  showRadar?: boolean;
  showGraph?: boolean;
  // CTA slide用
  ctaLabel?: string;
  ctaNote?: string;
  ctaUrl?: string;
}

export const SLIDES: SlideData[] = [
  {
    id: 1,
    headline: "練習してるのに、\n変わらない。",
    subline: "その理由、わかる？",
    emphasis: "変わらない。",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 2,
    headline: "才能じゃない。",
    subline: "\"見えていない\"\nだけだ。",
    emphasis: "\"見えていない\"",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 3,
    headline: "一人練習には\n鏡がない。",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 4,
    headline: "AIが、\nあなたの鏡になる。",
    emphasis: "AIが、",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 5,
    headline: "音声をアップするだけ。",
    subline: "音程・リズム・表現力…\n6軸で分析。",
    image: "slide05.jpg",
    layout: "center",
    showParticles: true,
    showRadar: true,
  },
  {
    id: 6,
    headline: "見えた瞬間、\n動きたくなる。",
    emphasis: "見えた瞬間、",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 7,
    headline: "AIが毎回、\nあなたの演奏を聴いてくれる。",
    emphasis: "AIが毎回、",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 8,
    headline: "先月の自分より、\n今日の自分へ。",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
    showGraph: true,
  },
  {
    id: 9,
    headline: "ライバルは、\n昨日の自分。",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 10,
    headline: "一人じゃない。",
    subline: "同じ夢の仲間が、いる。",
    emphasis: "一人じゃない。",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 11,
    headline: "「上手い」は\nいらない。",
    subline: "「好き」だけで来て。",
    emphasis: "「好き」だけで来て。",
    image: "slide11.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 12,
    headline: "1年後の自分が、\nステージに立っている。",
    subline: "その未来は、今日始まる。",
    emphasis: "その未来は、今日始まる。",
    image: "slide12.jpg",
    layout: "bottom",
    showParticles: true,
  },
  {
    id: 13,
    headline: "まず、無料で。",
    subline: "登録30秒簡単登録。",
    image: "slide13.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 14,
    headline: "音楽で、\n人生を前に進めよう。",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "今すぐ無料で始める",
    ctaNote: "プロフィールリンクから無料診断へ",
    ctaUrl: "be-my-style.com/singing/sign_up",
  },
];
