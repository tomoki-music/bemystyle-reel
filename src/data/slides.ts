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
    headline: "高音、才能だと\n思ってない？",
    subline: "実は“出し方”で変わる。",
    emphasis: "才能だと",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 2,
    headline: "こんな悩み、\nない？",
    subline: "サビで苦しい\n喉が締まる\n声がひっくり返る",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 3,
    headline: "高音は、\n喉の力じゃない。",
    subline: "開く × 閉じる × 張る",
    emphasis: "喉の力じゃない",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 4,
    headline: "まずは脱力。",
    subline: "力の配分がすべて。",
    emphasis: "脱力",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 5,
    headline: "下半身で支えると、\n声は安定する。",
    subline: "喉：0 / お腹：2〜3 / 下半身：6〜7",
    image: "slide05.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 6,
    headline: "おすすめ練習",
    subline: "泣き真似で歌う。",
    emphasis: "泣き真似",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 7,
    headline: "泣き声は、\n全部を整える。",
    subline: "喉・声帯・テンション\n一気に揃う。",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 8,
    headline: "でも一番大事なのは…",
    subline: "自分の声を客観的に知ること",
    emphasis: "客観的に知る",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 9,
    headline: "AI歌唱診断で\n分かること",
    subline: "音程 / リズム / 表現力\nあなたの強みと課題",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
    showRadar: true,
  },
  {
    id: 10,
    headline: "成長が見えると、\n続けられる。",
    subline: "小さな積み重ねが\n大きな自信に。",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
    showGraph: true,
  },
  {
    id: 11,
    headline: "プロ視点で\nフィードバック",
    subline: "改善ポイントが\n一発で分かる。",
    image: "slide11.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 12,
    headline: "あなたの声は、\nもっと伸びる。",
    subline: "今の一歩が\n未来のステージへ",
    emphasis: "もっと伸びる",
    image: "slide12.jpg",
    layout: "bottom",
    showParticles: true,
  },
  {
    id: 13,
    headline: "AI歌唱診断で\n今すぐチェック",
    subline: "あなたの声の可能性を\nデータで可視化",
    image: "slide13.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 14,
    headline: "無料で始める。",
    subline: "あなたの歌、\n変えてみない？",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "今すぐチェックする♪",
    ctaNote: "プロフィールリンクから無料診断",
    ctaUrl: "be-my-style.com/singing/sign_up",
  },
];