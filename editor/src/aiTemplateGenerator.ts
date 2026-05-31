export interface GeneratedTemplateVariables {
  title: string
  subtitle: string
  cta: string
}

const CTA_OPTIONS = [
  '続きはプロフィールへ',
  '詳細は概要欄へ',
  'プロフィールリンクをチェック',
]

// [keywords, subtitles]
const KEYWORD_SUBTITLES: [string[], string[]][] = [
  [
    ['夢中', '好き', '楽しい', '面白い'],
    ['没頭できる人は強い', '情熱は最高の武器', '好きなことが力になる'],
  ],
  [
    ['歳', '年齢', '老い', '若い', '取らない'],
    ['今この瞬間が一番若い', '年齢は関係ない', '心が若ければ何でもできる'],
  ],
  [
    ['本気', '熱量', '情熱', '真剣', '巻き込む'],
    ['熱量は人を動かす', '本気の行動が道を開く', '覚悟が現実を変える'],
  ],
  [
    ['居場所', '所属', 'コミュニティ', '作る'],
    ['小さな一歩が人生を変える', '自分の居場所は自分で作る', '仲間がいれば怖くない'],
  ],
  [
    ['挑戦', '行動', '一歩', '踏み出す', '続ける'],
    ['行動した人だけが変わる', '一歩が全てを変える', 'やってみた人だけが知っている'],
  ],
  [
    ['成長', '進化', '変わる', '変化'],
    ['昨日の自分を超え続ける', '変化こそが成長の証', '止まらなければ必ず成長できる'],
  ],
  [
    ['人', '仲間', '繋がり', '周囲'],
    ['人との繋がりが未来を作る', '共に歩む人が力になる', '本物の仲間は財産だ'],
  ],
  [
    ['夢', '目標', '可能性'],
    ['夢は見るものではなく叶えるもの', '目標があれば道は開ける', '可能性は無限大だ'],
  ],
]

const FALLBACK_SUBTITLES = [
  '一歩一歩が未来を作る',
  '信じた道を歩き続けよう',
  '今日の選択が明日を変える',
  '本物の力は努力から生まれる',
  '諦めない人が最後に笑う',
  '自分を信じる力が全てを変える',
  '小さな積み重ねが大きな結果を生む',
  '迷ったときは前へ進もう',
]

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

export function generateTemplateVariables(theme: string): GeneratedTemplateVariables {
  const trimmed = theme.trim()
  const hash = simpleHash(trimmed)

  let subtitlePool: string[] = []
  for (const [keywords, subtitles] of KEYWORD_SUBTITLES) {
    if (keywords.some((k) => trimmed.includes(k))) {
      subtitlePool = [...subtitlePool, ...subtitles]
    }
  }
  if (subtitlePool.length === 0) {
    subtitlePool = FALLBACK_SUBTITLES
  }

  return {
    title: trimmed,
    subtitle: subtitlePool[hash % subtitlePool.length],
    cta: CTA_OPTIONS[hash % CTA_OPTIONS.length],
  }
}
