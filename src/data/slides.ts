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
    headline: "いきなり\n原曲キー、目指してない？",
    subline: "憧れの曲ほど、\nつい背伸びしたくなる。",
    emphasis: "原曲キー",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 2,
    headline: "理想のアーティストは、\n遠くていい。",
    subline: "でも今の自分を、\n置き去りにしない。",
    emphasis: "遠くていい",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 3,
    headline: "高すぎるキーは、\n心も喉も苦しくなる。",
    subline: "届かない自分を、\n責めなくていい。",
    emphasis: "苦しくなる",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 4,
    headline: "大事なのは、\n“今の自分のキー”。",
    subline: "比べるより先に、\n気持ちよく歌える場所を探そう。",
    emphasis: "自分のキー",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 5,
    headline: "まずは、\n楽に歌える高さから。",
    subline: "声が伸びる感覚を、\nちゃんと味わう。",
    emphasis: "楽に歌える",
    image: "slide05.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 6,
    headline: "理想は高く。\nステップは低く。",
    subline: "小さく進む人ほど、\n遠くまで行ける。",
    emphasis: "ステップは低く",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 7,
    headline: "無理して上げるより、\n一度下げてみる。",
    subline: "それは逃げじゃない。\n歌を育てる選択。",
    emphasis: "一度下げる",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 8,
    headline: "キーを下げると、\n表現が戻ってくる。",
    subline: "言葉、息、感情。\n歌に余白が生まれる。",
    emphasis: "表現が戻る",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 9,
    headline: "気持ちよく歌えた。\nそれが最初の成功。",
    subline: "完璧じゃなくていい。\nまずは一曲、心で歌う。",
    emphasis: "最初の成功",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 10,
    headline: "少しずつ、\n原曲キーへ近づけばいい。",
    subline: "今日の一歩が、\n未来の高音を作る。",
    emphasis: "少しずつ",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
  },
  {
    id: 11,
    headline: "練習は、\n小さな達成感の積み重ね。",
    subline: "できた感覚が、\n次の挑戦を連れてくる。",
    image: "slide11.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 12,
    headline: "今日できたことを、\nちゃんと褒めよう。",
    subline: "ブレス、ピッチ、表現。\n一つ整えば、それは成長。",
    emphasis: "それは成長",
    image: "slide12.jpg",
    layout: "bottom",
    showParticles: true,
  },
  {
    id: 13,
    headline: "歌は、\n自分のペースで上手くなる。",
    subline: "焦らず、比べず、\n昨日より少し前へ。",
    emphasis: "自分のペース",
    image: "slide13.jpg",
    layout: "center",
    showParticles: false,
  },
  {
    id: 14,
    headline: "理想は遠く、\nステップは低く。",
    subline: "あなたの歌は、\nあなたのキーから始まる。",
    emphasis: "あなたのキー",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "歌を育てるヒントをフォロー",
    ctaNote: "無理なく上手くなる歌の話を発信中",
    ctaUrl: "",
  },
];