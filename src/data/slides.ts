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
    headline: "いきなり\n100点を目指してない？",
    subline: "憧れほど、\n自分を追い込みやすい。",
    emphasis: "100点",
    image: "slide01.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 2,
    headline: "理想の歌声は、\n遠くていい。",
    subline: "でも今の自分を、\n置き去りにしない。",
    emphasis: "遠くていい",
    image: "slide02.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 3,
    headline: "できない日があっても、\n終わりじゃない。",
    subline: "喉も心も、\n波があって当たり前。",
    emphasis: "終わりじゃない",
    image: "slide03.jpg",
    layout: "center",
    showParticles: false,
  },

  {
    id: 4,
    headline: "大事なのは、\n“今の自分の声”。",
    subline: "まずは気持ちよく\n響く場所を探そう。",
    emphasis: "今の自分",
    image: "slide04.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 5,
    headline: "まずは、\n楽に歌える高さから。",
    subline: "無理のない声が、\n未来を育てる。",
    emphasis: "楽に歌える",
    image: "slide05.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 6,
    headline: "理想は高く。\nステップは低く。",
    subline: "小さく進む人ほど、\n最後まで歩ける。",
    emphasis: "ステップは低く",
    image: "slide06.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 7,
    headline: "今日は、\n一歩下がってもいい。",
    subline: "それも前に進むための\n選択だから。",
    emphasis: "一歩下がる",
    image: "slide07.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 8,
    headline: "力を抜くと、\n歌が戻ってくる。",
    subline: "言葉も感情も、\nちゃんと届き始める。",
    emphasis: "歌が戻る",
    image: "slide08.jpg",
    layout: "center",
    showParticles: false,
  },

  {
    id: 9,
    headline: "気持ちよく歌えた。\nそれで十分すごい。",
    subline: "完璧より先に、\n“楽しい”を忘れない。",
    emphasis: "十分すごい",
    image: "slide09.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 10,
    headline: "少しずつ、\n近づけばいい。",
    subline: "今日の一歩が、\n未来の歌になる。",
    emphasis: "少しずつ",
    image: "slide10.jpg",
    layout: "center",
    showParticles: true,
  },

  {
    id: 11,
    headline: "練習は、\n小さな成功の積み重ね。",
    subline: "“昨日より少し良い”\nそれだけでいい。",
    emphasis: "小さな成功",
    image: "slide11.jpg",
    layout: "center",
    showParticles: false,
  },

  {
    id: 12,
    headline: "今日できたことを、\nちゃんと覚えておこう。",
    subline: "ブレスでも、ピッチでも。\nそれは確かな成長。",
    emphasis: "確かな成長",
    image: "slide12.jpg",
    layout: "bottom",
    showParticles: true,
  },

  {
    id: 13,
    headline: "歌は、\n自分のペースで育つ。",
    subline: "焦らなくていい。\n比べなくていい。",
    emphasis: "自分のペース",
    image: "slide13.jpg",
    layout: "center",
    showParticles: false,
  },

  {
    id: 14,
    headline: "理想は遠く。\nでも、一歩ずつ。",
    subline: "あなたの歌は、\n今日の声から始まる。",
    emphasis: "今日の声",
    image: "slide14.jpg",
    layout: "cta",
    showParticles: true,
    showCTA: true,
    ctaLabel: "歌を育てるヒントをフォロー",
    ctaNote: "無理なく上手くなる歌の話を発信中",
    ctaUrl: "",
  },
];