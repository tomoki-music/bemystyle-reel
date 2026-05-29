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
    headline: "歌が\n好きだった。",
    subline: "ずっと心の中に、\n音楽があった。",
    emphasis: "歌が好き",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 2,
    headline: "でも。",
    subline: "一人で歌う時間が、\n少し寂しかった。",
    emphasis: "でも",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 3,
    headline: "仲間が\nいなかった。",
    subline: "同じ気持ちを\n話せる人が欲しかった。",
    emphasis: "仲間",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 4,
    headline: "音楽仲間が\n欲しかった。",
    subline: "歌も、演奏も、\n一緒に楽しめる場所へ。",
    emphasis: "音楽仲間",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 5,
    headline: "最初の一歩が\n怖かった。",
    subline: "上手い人ばかりに\n見えてしまうから。",
    emphasis: "最初の一歩",
    image: "slide05.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 6,
    headline: "でも\n大丈夫。",
    subline: "ここは、挑戦する人を\n笑わない場所。",
    emphasis: "大丈夫",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 7,
    headline: "初心者歓迎",
    subline: "久しぶりでも。\n自信がなくても。",
    emphasis: "初心者歓迎",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 8,
    headline: "うまくいかない日も、\nある。",
    subline: "だからこそ、\n一緒に続けられる。",
    emphasis: "一緒に続ける",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 9,
    headline: "音楽は、\nやっぱり最高だ。",
    subline: "そう思える瞬間を、\nもう一度。",
    emphasis: "最高",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 10,
    headline: "この景色を、\n忘れない。",
    subline: "一人では見られない\n景色がある。",
    emphasis: "この景色",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 11,
    headline: "今日の景色を、\n宝物にする。",
    subline: "歌も、演奏も、\n出会いも。",
    emphasis: "宝物",
    image: "slide11.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 12,
    headline: "これからも、\n一緒に奏でよう。",
    subline: "あなたの“好き”が、\nここから広がる。",
    emphasis: "一緒に奏でる",
    image: "slide12.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 13,
    headline: "この先も、\nずっと忘れない。",
    subline: "音楽で繋がる場所が、\nここにある。",
    emphasis: "音楽で繋がる",
    image: "slide13.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 14,
    headline: "",
    subline: "",
    emphasis: "",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "QRを読み取る",
    ctaNote: "無料歌唱診断はこちら",
    ctaUrl: "https://be-my-style.com/singing/sign_up",
  },
];