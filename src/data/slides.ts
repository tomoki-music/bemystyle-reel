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
    headline: "Cosmo Dots...",
    subline: "小さな点の積み重ねが、\n未来をつくる。",
    emphasis: "Cosmo Dots",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 2,
    headline: "フリーランスで、\n生きてます。",
    subline: "自由と責任、どっちもある毎日。",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 3,
    headline: "派手じゃなくていい。",
    subline: "日々コツコツ、それが一番強い。",
    emphasis: "コツコツ",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 4,
    headline: "気づけば今日も、\n作業してる。",
    subline: "好きだから続く。\nでも簡単じゃない。",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 5,
    headline: "大自然に囲まれて、\n仕事する日もある。",
    subline: "風の音、鳥の声。\nちょっと贅沢な作業環境。",
    emphasis: "大自然",
    image: "slide05.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 6,
    headline: "静かな場所ほど、\nアイデアは生まれる。",
    subline: "考える時間が、\n価値をつくる。",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 7,
    headline: "頼られると、\nつい頑張っちゃう。",
    subline: "期待に応えたいって、\n思っちゃうから。",
    emphasis: "頼られる",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 8,
    headline: "でも、やりすぎる時もある。",
    subline: "気づいたら、余裕ゼロ。",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 9,
    headline: "だから大事なのは、\n“ガス抜き”。",
    subline: "休むのも、仕事のうち。",
    emphasis: "ガス抜き",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 10,
    headline: "うまく抜いて、\nまた走る。",
    subline: "長く続けるための、\n自分なりのリズム。",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 11,
    headline: "一つ一つは小さくても、",
    subline: "点は、やがて線になる。",
    image: "slide11.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 12,
    headline: "その線が、未来になる。",
    subline: "だから今日も、積み重ねる。",
    emphasis: "未来になる",
    image: "slide12.jpg",
    layout: "bottom",
    showParticles: true,
  },
  {
    id: 13,
    headline: "Cosmo Dotsは、\n生き方そのもの。",
    subline: "あなたの“点”も、\nちゃんと意味がある。",
    image: "slide13.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 14,
    headline: "一歩ずつでいい。",
    subline: "今日も、自分のペースで。",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "一緒に積み上げよう",
    ctaNote: "フォローして日常をチェック",
    ctaUrl: "",
  },
];