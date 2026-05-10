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
    headline: "初めての\nベース練習会。",
    subline: "そこから、すべてが始まった。",
    emphasis: "初めての",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 2,
    headline: "メンバー全員、\nほぼ初心者。",
    subline: "でも熱量だけは、\n負けなかった。",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 3,
    headline: "最初は音も、\nまともに出なかった。",
    subline: "フレットを押さえる指が、\nじんじんする。",
    emphasis: "まともに出なかった",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 4,
    headline: "それでも、\nやめなかった。",
    subline: "諦めない空気が、\n部屋に充満してた。",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 5,
    headline: "３時間、\nみっちり。",
    subline: "休憩もそこそこに、\nひたすら弾いた。",
    emphasis: "３時間",
    image: "slide05.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 6,
    headline: "合わせる、止まる、\nまたやり直す。",
    subline: "その繰り返しで、\n確実に上手くなってた。",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 7,
    headline: "全員の音が、\nひとつになった瞬間。",
    subline: "あの感覚、\nなんとも言えなかった。",
    emphasis: "ひとつになった",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 8,
    headline: "そして、\nついに—",
    subline: "最初から最後まで、\n止まらずに。",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 9,
    headline: "１曲、\n通した。",
    subline: "みんなで声をあげた、\nあの瞬間。",
    emphasis: "１曲通した",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 10,
    headline: "翌日、\n体じゅうが筋肉痛。",
    subline: "指先もヒリヒリ。\nでも不思議と、笑顔だった。",
    emphasis: "筋肉痛",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 11,
    headline: "やり切った。",
    subline: "その充実感は、\nやった人にしかわからない。",
    image: "slide11.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 12,
    headline: "初めてだから、\n下手でよかった。",
    subline: "だからこそ、\n感動も大きかった。",
    emphasis: "感動も大きかった",
    image: "slide12.jpg",
    layout: "bottom",
    showParticles: true,
  },
  {
    id: 13,
    headline: "これが、\n私たちの第一歩。",
    subline: "また集まって、\n一緒に弾こう。",
    image: "slide13.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 14,
    headline: "次回の練習も、\n見逃さないで。",
    subline: "成長の記録を、\nここで発信します。",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "フォローして応援する",
    ctaNote: "次の練習会をお見逃しなく",
    ctaUrl: "",
  },
];