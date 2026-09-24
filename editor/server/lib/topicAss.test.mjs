import { describe, it, expect } from 'vitest'
import {
  fitTopicTitle,
  TOPIC_TITLE_BASE_PX,
  TOPIC_TITLE_MIN_PX,
  buildTopicEvents,
  buildTopicStyleLines,
  computeTopicGeometry,
  getTopicLayout,
  TOPIC_LAYER_BOX,
  TOPIC_LAYER_TEXT,
} from './topicAss.mjs'
import { buildAssContent, getCaptionStyleDefs, CAPTION_FONT_SCALE, resolveCaptionFontScale, buildDialogueText } from './captionStyles.mjs'

const W = 1920
const H = 1080
const ACCENT = '&H004AB3F0&'
const opts = { accent: ACCENT, displayWidth: W, displayHeight: H }
const sec = (id, title, startSec, endSec) => ({ id, title, startSec, endSec, source: 'manual' })
const cap = (startSec, endSec, text, lines, emphasisText = null) => ({ startSec, endSec, text, lines, emphasisText, captionType: 'normal', displayOrder: 0 })

const parseTime = (t) => {
  const [h, m, s] = t.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}
const dialogues = (ass) =>
  ass
    .split('\n')
    .filter((l) => l.startsWith('Dialogue:'))
    .map((l) => {
      const f = l.slice('Dialogue: '.length).split(',')
      return { layer: Number(f[0]), start: parseTime(f[1]), end: parseTime(f[2]), style: f[3], text: f.slice(9).join(',') }
    })
const styleFontsize = (ass, name) => Number(ass.split('\n').find((l) => l.startsWith(`Style: ${name},`)).split(',')[2])

describe('通常字幕の拡大（採用サイズ・セーフエリア・二重適用なし）', () => {
  const normalOf = (scale) => getCaptionStyleDefs(W, H, scale).normal
  const marginH = Math.round(W * 0.06)
  const usable = W - marginH * 2

  it('採用サイズは 1080p で normal=82px（基準56px × CAPTION_FONT_SCALE）', () => {
    expect(CAPTION_FONT_SCALE).toBe(1.46)
    expect(getCaptionStyleDefs(W, H, 1).normal.fontsize).toBe(56)
    expect(normalOf().fontsize).toBe(82)
  })

  it('候補 78 / 82 / 84px は倍率だけで表現でき、倍率と固定pxが二重に掛からない（ASS出力の Fontsize は1回分）', () => {
    for (const [scale, px] of [[1.39, 78], [1.46, 82], [1.5, 84]]) {
      expect(normalOf(scale).fontsize).toBe(px)
      const ass = buildAssContent({ width: W, height: H, captions: [] }, { captionFontScale: scale })
      expect(styleFontsize(ass, 'Normal')).toBe(px)
    }
    const ass = buildAssContent({ width: W, height: H, captions: [cap(0, 2, 'あ', ['あ'])] })
    expect(dialogues(ass)[0].text).not.toMatch(/\\fs|\\fscx|\\fscy/) // Dialogue側で再度サイズ指定しない
    const scaled = getCaptionStyleDefs(W, H, 2 * 0.73).normal.fontsize // 倍率を2回掛けた値(≒1.46^2)とは一致しない
    expect(scaled).not.toBe(Math.round(82 * CAPTION_FONT_SCALE))
  })

  it('不正な倍率は既定へ戻す（極端な値で画面外へ出さない）', () => {
    for (const s of [NaN, 0, -1, 9, Infinity, undefined]) expect(resolveCaptionFontScale(s)).toBe(CAPTION_FONT_SCALE)
  })

  it('1行16文字（実データ最大）・1行20文字（ハード上限）・2行30文字が左右セーフエリア(各5%以上)に収まる（全角=1emの保守的見積り）', () => {
    const d = normalOf()
    expect(marginH).toBeGreaterThanOrEqual(W * 0.05)
    expect(16 * d.fontsize).toBeLessThanOrEqual(usable)
    expect(20 * d.fontsize).toBeLessThanOrEqual(usable)
    expect(Math.ceil(30 / 2) * d.fontsize).toBeLessThanOrEqual(usable)
    expect((W - 20 * d.fontsize) / 2).toBeGreaterThanOrEqual(W * 0.05)
  })

  it('候補のうち84pxは20文字の保守的見積りの余裕が10px以下で、82pxの方が余裕がある（82px採用の根拠）', () => {
    expect(usable - 20 * normalOf(1.46).fontsize).toBeGreaterThan(usable - 20 * normalOf(1.5).fontsize)
    expect(usable - 20 * normalOf(1.5).fontsize).toBeLessThanOrEqual(10)
  })

  it('2行ぶんが画面下部35%以内で、上下5%の安全余白を守り、顔の中央へ届かない', () => {
    const d = normalOf()
    const blockHeight = d.fontsize * 2 * 1.3 // 行送りを1.3として保守的に見積る
    const bottom = H - d.marginV
    const top = bottom - blockHeight
    expect(d.marginV).toBeGreaterThanOrEqual(H * 0.05)
    expect(top).toBeGreaterThanOrEqual(H * 0.65)
    expect(bottom).toBeLessThanOrEqual(H * 0.95)
  })

  it('mainはnormalの1.05〜1.10倍、subはnormalより小さいが極端に小さくない、emphasisはmainと同じ', () => {
    const s = getCaptionStyleDefs(W, H)
    expect(s.main.fontsize / s.normal.fontsize).toBeGreaterThanOrEqual(1.05)
    expect(s.main.fontsize / s.normal.fontsize).toBeLessThanOrEqual(1.1)
    expect(s.emphasis.fontsize).toBe(s.main.fontsize)
    expect(s.sub.fontsize / s.normal.fontsize).toBeGreaterThanOrEqual(0.75)
    expect(s.sub.fontsize).toBeLessThan(s.normal.fontsize)
    // 比は倍率を変えても一定
    const s1 = getCaptionStyleDefs(W, H, 1)
    expect(s.main.fontsize / s.normal.fontsize).toBeCloseTo(s1.main.fontsize / s1.normal.fontsize, 1)
  })

  it('縁取り・影も倍率に比例して強くなり、文字内部を潰さない太さ(fontsizeの3〜8%)に収まる', () => {
    const d1 = getCaptionStyleDefs(W, H, 1).normal
    const d = normalOf()
    expect(d.outline / d1.outline).toBeCloseTo(CAPTION_FONT_SCALE, 1)
    expect(d.shadow / d1.shadow).toBeCloseTo(CAPTION_FONT_SCALE, 1)
    expect(d.outline).toBeGreaterThan(d1.outline)
    expect(d.outline / d.fontsize).toBeGreaterThanOrEqual(0.03)
    expect(d.outline / d.fontsize).toBeLessThanOrEqual(0.08)
    const ass = buildAssContent({ width: W, height: H, captions: [] })
    const f = ass.split('\n').find((l) => l.startsWith('Style: Normal,')).split(',')
    expect(f[15]).toBe('1') // BorderStyle: 縁取り（不透明ボックスにしない）
    expect(Number(f[16])).toBe(d.outline)
  })

  it('位置・余白（下部中央・セーフマージン）は拡大しても変わらない（倍率は大きさだけ）', () => {
    const s1 = getCaptionStyleDefs(W, H, 1).normal
    const s = normalOf()
    expect([s.alignment, s.marginL, s.marginR, s.marginV]).toEqual([s1.alignment, s1.marginL, s1.marginR, s1.marginV])
  })

  it('部分強調は色のオーバーライドのみで、文字サイズ・太さを変えない（2行・強調を含む字幕でも）', () => {
    const text = buildDialogueText({ text: 'これはとても大事ですね', lines: ['これはとても', '大事ですね'], emphasisText: 'とても大事' }, ACCENT)
    expect(text).not.toMatch(/\\fs|\\fscx|\\fscy|\\b\d|\\fn|\\bord/)
    expect(text).toContain('{\\c004AB3F0&}とても{\\r}')
    const ass = buildAssContent({ width: W, height: H, captions: [cap(0, 2, 'これはとても大事ですね', ['これはとても', '大事ですね'], 'とても大事')] })
    expect(styleFontsize(ass, 'Normal')).toBe(82)
  })
})

describe('テーマ用ASSスタイル', () => {
  const ass = buildAssContent({ width: W, height: H, captions: [] }, { topicSections: [sec('t1', '活動との距離の取り方', 1, 9)] })
  const styleFields = (name) => ass.split('\n').find((l) => l.startsWith(`Style: ${name},`)).replace('Style: ', '').split(',')

  it('通常字幕とは別スタイル(TopicLabel/TopicTitle/TopicBox)で、通常字幕のスタイルを上書きしない', () => {
    for (const n of ['TopicLabel', 'TopicTitle', 'TopicBox', 'Normal', 'Main']) expect(ass).toContain(`Style: ${n},`)
    const plain = buildAssContent({ width: W, height: H, captions: [] })
    expect(styleFields('Normal')).toEqual(plain.split('\n').find((l) => l.startsWith('Style: Normal,')).replace('Style: ', '').split(','))
  })

  it('左上固定（Alignment 7）、日本語フォントを明示、左右・上端のセーフマージン付き', () => {
    for (const n of ['TopicLabel', 'TopicTitle']) {
      const f = styleFields(n)
      expect(f[1]).toBe('Noto Sans CJK JP')
      expect(f[18]).toBe('7')
      expect(Number(f[19])).toBeGreaterThanOrEqual(W * 0.04) // MarginL
      expect(Number(f[20])).toBeGreaterThanOrEqual(W * 0.04) // MarginR
      expect(Number(f[21])).toBeGreaterThanOrEqual(H * 0.05) // MarginV（上端）
    }
  })

  it('既定(label): 小見出しが琥珀色、タイトル本文は白。title指定でタイトルも琥珀色', () => {
    expect(styleFields('TopicLabel')[3]).toBe(ACCENT)
    expect(styleFields('TopicTitle')[3]).toBe('&H00FFFFFF&')
    const all = buildTopicStyleLines({ fontFamily: 'X', accent: ACCENT, displayWidth: W, displayHeight: H, accentMode: 'title' })
    expect(all.find((l) => l.startsWith('Style: TopicTitle,')).split(',')[3]).toBe(ACCENT)
  })

  it('テーマ用の全面バナー(不透明ボックス)は使わない（縁取りBorderStyle=1、背景は半透明の描画矩形）', () => {
    for (const n of ['TopicLabel', 'TopicTitle']) expect(styleFields(n)[15]).toBe('1')
    const ev = buildTopicEvents(sec('t1', '活動との距離の取り方', 1, 9), opts)
    const box = ev.find((l) => l.includes('\\p1') && l.startsWith(`Dialogue: ${TOPIC_LAYER_BOX},`))
    expect(box).toMatch(/\\1a&H[1-9A-F][0-9A-F]&/) // 半透明
    expect(styleFields('TopicTitle')[2]).not.toBe('0')
  })

  it('テーマ用スタイルはテーマが無いジョブには出力しない', () => {
    expect(buildAssContent({ width: W, height: H, captions: [] })).not.toContain('Topic')
  })
})

describe('テーマ用イベント（配置・行数・エスケープ・フェード）', () => {
  it('左上に配置され、左右・上端のセーフエリア内で、顔のある画面中央に届かない', () => {
    for (const title of ['活動との距離の取り方', 'サークルとバンドを両立する考え方', 'あ'.repeat(24)]) {
      const lines = title.length > 12 ? [title.slice(0, 12), title.slice(12)] : [title]
      const g = computeTopicGeometry(lines, W, H)
      const L = getTopicLayout(W, H)
      expect(g.box.x).toBeGreaterThanOrEqual(W * 0.04)
      expect(g.box.y).toBeGreaterThanOrEqual(H * 0.05)
      expect(g.box.x + g.box.w).toBeLessThan(W * 0.5) // 左半分に収まる
      expect(g.box.y + g.box.h).toBeLessThan(H * 0.33) // 顔(中央)へ届かない
      expect(g.title.x).toBeGreaterThan(g.bar.x + L.barWidth) // 左揃え（縦ラインの右に本文）
    }
  })

  it('全イベントが \\an7 + \\pos の左上固定で、位置は画面の左上1/3内', () => {
    const ev = buildTopicEvents(sec('t1', '活動との距離の取り方', 1, 9), opts)
    expect(ev).toHaveLength(4)
    for (const l of ev) {
      expect(l).toContain('\\an7')
      const m = l.match(/\\pos\((\d+),(\d+)\)/)
      expect(Number(m[1])).toBeLessThan(W / 3)
      expect(Number(m[2])).toBeLessThan(H / 3)
    }
  })

  it('タイトルは最大2行で、2行を超えるタイトルは1テーマのイベントに\\Nを2つ以上入れない', () => {
    for (const title of ['活動との距離の取り方', 'サークルとバンドを両立する考え方', 'あ'.repeat(24)]) {
      const text = buildTopicEvents(sec('t1', title, 1, 9), opts).find((l) => l.includes(',TopicTitle,'))
      const body = text.slice(text.indexOf('}') + 1)
      expect((body.match(/\\N/g) ?? []).length).toBeLessThanOrEqual(1)
      expect(body.replace(/\\N/g, '')).toBe(title)
    }
  })

  it('ASS特殊文字（{ } \\ 改行）を安全にエスケープする（タグ注入不可）', () => {
    const ev = buildTopicEvents(sec('t1', '{\\an5}危険\\Nな{\\fs200}題', 1, 9), opts)
    const titleLine = ev.find((l) => l.includes(',TopicTitle,'))
    const body = titleLine.slice(titleLine.indexOf('}') + 1)
    expect(body).not.toMatch(/[{}]/) // 生の override タグが無い
    expect(body).toContain('｛')
    expect(body).toContain('\\\\an5') // バックスラッシュは二重化されて無効化
    expect(titleLine.match(/\{[^}]*\}/g)).toHaveLength(1) // override ブロックは自前の1つだけ（注入されたタグ無し）
  })

  it('フェードは各テーマのイベントに閉じ、150〜300msで、通常字幕のDialogueへは付かない', () => {
    const ass = buildAssContent(
      { width: W, height: H, captions: [cap(1.4, 3, 'こんにちは', ['こんにちは'])] },
      { topicSections: [sec('t1', '活動との距離の取り方', 1.38, 9)] },
    )
    const ds = dialogues(ass)
    const captionLine = ds.find((d) => d.style === 'Normal')
    expect(captionLine.text).not.toContain('\\fad')
    const topicLines = ds.filter((d) => d.layer >= TOPIC_LAYER_BOX)
    expect(topicLines).toHaveLength(4)
    for (const l of topicLines) {
      const m = l.text.match(/\\fad\((\d+),(\d+)\)/)
      expect(Number(m[1])).toBeGreaterThanOrEqual(150)
      expect(Number(m[1])).toBeLessThanOrEqual(300)
      expect(Number(m[2])).toBe(Number(m[1]))
    }
  })

  it('短いテーマではフェードを区間の1/4までに丸める（表示が消えっぱなしにならない）', () => {
    const ev = buildTopicEvents(sec('t1', '活動との距離の取り方', 1, 1.4), opts)
    expect(ev[0]).toContain('\\fad(100,100)')
  })
})

describe('テーマの切り替えと通常字幕との同時表示', () => {
  const sections = [sec('t1', '最初のテーマの題名です', 1.38, 20), sec('t2', '次のテーマの題名です', 20, 40)]
  const captions = [cap(1.4, 5, '一つ目の字幕です', ['一つ目の字幕です']), cap(19, 22, '境界をまたぐ字幕', ['境界をまたぐ字幕']), cap(30, 35, '後半の字幕です', ['後半の字幕です'])]
  const ass = buildAssContent({ width: W, height: H, captions }, { topicSections: sections })
  const ds = dialogues(ass)

  it('前後のテーマが時間的に重複しない（隣接は end === 次の start）', () => {
    const t1 = ds.filter((d) => d.layer >= TOPIC_LAYER_BOX && d.text.includes('最初のテーマ') || (d.layer >= TOPIC_LAYER_BOX && d.end === 20))
    const t2 = ds.filter((d) => d.layer >= TOPIC_LAYER_BOX && d.start === 20)
    expect(t1.length).toBeGreaterThan(0)
    for (const a of t1) for (const b of t2) expect(a.end).toBeLessThanOrEqual(b.start)
    // どの時刻でも表示中のテーマタイトルは1つだけ
    for (const t of [1.38, 5, 19.99, 20, 20.01, 39.99]) {
      const shown = ds.filter((d) => d.style === 'TopicTitle' && t >= d.start && t < d.end)
      expect(shown).toHaveLength(1)
    }
    expect(ds.filter((d) => d.style === 'TopicTitle' && 40 >= d.start && 40 < d.end)).toHaveLength(0) // テーマ未設定区間
  })

  it('テーマ(Layer10〜12)は通常字幕(Layer 0)と別レイヤーで、同時に表示される', () => {
    const cLine = ds.find((d) => d.style === 'Normal' && d.text.includes('境界をまたぐ'))
    const topicAtSame = ds.filter((d) => d.layer >= TOPIC_LAYER_BOX && cLine.start >= d.start && cLine.start < d.end)
    expect(cLine.layer).toBe(0)
    expect(topicAtSame.length).toBeGreaterThan(0)
    expect(Math.min(...ds.filter((d) => d.layer >= TOPIC_LAYER_BOX).map((d) => d.layer))).toBe(TOPIC_LAYER_BOX)
    expect(TOPIC_LAYER_TEXT).toBeGreaterThan(0)
  })

  it('通常字幕のDialogue行はテーマの有無で一切変わらない（字幕・強調・改行・時刻を保持）', () => {
    const withTopic = ds.filter((d) => d.layer === 0)
    const without = dialogues(buildAssContent({ width: W, height: H, captions })).filter((d) => d.layer === 0)
    expect(withTopic).toEqual(without)
  })

  it('テーマ未設定（空配列）でもASSが壊れない', () => {
    const plain = buildAssContent({ width: W, height: H, captions }, { topicSections: [] })
    expect(dialogues(plain).every((d) => d.layer === 0)).toBe(true)
  })
})

describe('入力の不変性（canonical text・caption・TopicSection）', () => {
  const deepFreeze = (o) => {
    Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v))
    return Object.freeze(o)
  }
  it('ASS生成は入力のcaption本文・lines・強調・テーマを変更しない（凍結オブジェクトでも例外なし）', () => {
    const captions = deepFreeze([cap(1.4, 3, 'これは大事な話です', ['これは大事な', '話です'], '大事')])
    const topics = deepFreeze([sec('t1', '活動との距離の取り方', 1.38, 9)])
    const before = JSON.stringify({ captions, topics })
    const ass = buildAssContent({ width: W, height: H, captions }, { topicSections: topics })
    expect(JSON.stringify({ captions, topics })).toBe(before)
    // 本文は正本のまま、改行はレンダー時のみ \N として挿入される
    expect(captions[0].lines.join('')).toBe(captions[0].text)
    expect(ass).toContain('これは{\\c004AB3F0&}大事{\\r}な\\N話です')
  })
})

describe('テーマの拡大サイズ（採用: タイトル84px / TALK THEME 40px）', () => {
  const L = getTopicLayout(W, H)

  it('1080pでタイトル84px・小見出し40px。前回(65/32px)より大きく、余白・縦ラインも太くなる', () => {
    expect(TOPIC_TITLE_BASE_PX).toBe(84)
    expect(L.titleBase).toBe(84)
    expect(L.titleSize).toBe(84)
    expect(L.labelSize).toBe(40)
    expect(L.pad).toBeGreaterThan(19) // 前回の内側余白
    expect(L.barWidth).toBeGreaterThan(8) // 前回の縦ライン
    expect(L.titleSize).toBeGreaterThanOrEqual(80)
    expect(L.titleSize).toBeLessThanOrEqual(86)
    expect(L.labelSize).toBeGreaterThanOrEqual(38)
    expect(L.labelSize).toBeLessThanOrEqual(42)
  })

  it('ASSのスタイルにもその値が入り、Dialogue側で二重にサイズ指定されない（短いタイトルは \\fs なし）', () => {
    const ass = buildAssContent({ width: W, height: H, captions: [] }, { topicSections: [sec('t1', '活動との距離の取り方', 1, 9)] })
    expect(styleFontsize(ass, 'TopicTitle')).toBe(84)
    expect(styleFontsize(ass, 'TopicLabel')).toBe(40)
    const title = dialogues(ass).find((d) => d.style === 'TopicTitle')
    expect(title.text).not.toContain('\\fs')
  })

  it('小見出しと縦ラインだけ琥珀色、タイトルは白、背景は半透明の黒（配色は維持）', () => {
    const ass = buildAssContent({ width: W, height: H, captions: [] }, { topicSections: [sec('t1', '活動との距離の取り方', 1, 9)] })
    const f = (n) => ass.split('\n').find((l) => l.startsWith(`Style: ${n},`)).split(',')
    expect(f('TopicLabel')[3]).toBe(ACCENT)
    expect(f('TopicTitle')[3]).toBe('&H00FFFFFF&')
    expect(ass).toContain('\\1c&H4AB3F0&\\1a&H00&') // 縦ライン
    expect(ass).toMatch(/\\1c&H000000&\\1a&H50&/) // 半透明の黒
  })

  it('箱はタイトルの行数・文字幅に合わせて広がる（1行より2行が高く、長い文ほど広い）', () => {
    const one = computeTopicGeometry(['活動との距離の取り方'], W, H)
    const two = computeTopicGeometry(['サークルとバンドを', '両立する考え方'], W, H)
    const wide = computeTopicGeometry(['活動との距離の取り方です'], W, H)
    expect(two.box.h).toBeGreaterThan(one.box.h)
    expect(wide.box.w).toBeGreaterThan(one.box.w)
  })
})

describe('テーマタイトルの自動フィット（語境界 → 幅の上限 → 下限72pxまで縮小）', () => {
  const titles = {
    short10: '活動との距離の取り方',
    t18: '自分のスタンスを大切に活動する', // 15
    t18b: 'サークルとバンドの両立と距離感の話', // 17
    t24: 'サークルとバンドを両立させるための考え方', // 20
    t24max: 'サークル運営とバンド活動を無理なく両立させる方法', // 24
  }

  it('短いタイトルは既定サイズのまま（一律に縮小しない）', () => {
    const r = fitTopicTitle(titles.short10, W, H)
    expect(r).toMatchObject({ titleSize: 84, shrunk: false, fits: true })
    expect(r.lines).toHaveLength(1)
  })

  it('18文字前後・24文字のタイトルは最大2行で、箱が画面中央(47%)へ張り出さず、下限72px未満にならない', () => {
    for (const t of Object.values(titles)) {
      const r = fitTopicTitle(t, W, H)
      expect(r.lines.length).toBeLessThanOrEqual(2)
      expect(r.lines.join('')).toBe(t) // 本文は変えない
      expect(r.titleSize).toBeGreaterThanOrEqual(TOPIC_TITLE_MIN_PX)
      expect(r.titleSize).toBeLessThanOrEqual(TOPIC_TITLE_BASE_PX)
      expect(r.fits).toBe(true)
      const g = computeTopicGeometry(r.lines, W, H, r.titleSize)
      expect(g.box.x + g.box.w).toBeLessThanOrEqual(W * 0.47)
      expect(g.box.x).toBeGreaterThanOrEqual(W * 0.05) // 左のセーフエリア
      expect(g.box.y).toBeGreaterThanOrEqual(H * 0.05) // 上のセーフエリア
      expect(g.box.y + g.box.h).toBeLessThanOrEqual(H * 0.33) // 顔(中央)へ届かない
    }
  })

  it('縮小するのは必要なときだけで、縮小した場合はそのイベントだけに \\fs が入る（下限以上）', () => {
    const shrinkingTitle = Object.values(titles).map((t) => fitTopicTitle(t, W, H)).find((r) => r.shrunk)
    const wide = 'あ'.repeat(24)
    const r = fitTopicTitle(wide, W, H)
    if (r.shrunk) {
      const ev = buildTopicEvents(sec('t1', wide, 1, 9), opts).find((l) => l.includes(',TopicTitle,'))
      const fs = Number(ev.match(/\\fs(\d+)/)[1])
      expect(fs).toBe(r.titleSize)
      expect(fs).toBeGreaterThanOrEqual(TOPIC_TITLE_MIN_PX)
    }
    expect(shrinkingTitle === undefined || shrinkingTitle.titleSize >= TOPIC_TITLE_MIN_PX).toBe(true)
  })

  it('自動縮小の下限は72px: 検証を通らない極端に長い文字列でも72pxを下回らない（fits=false で通知）', () => {
    const r = fitTopicTitle('あ'.repeat(40), W, H)
    expect(r.titleSize).toBe(TOPIC_TITLE_MIN_PX)
    expect(r.fits).toBe(false)
    const rr = fitTopicTitle('あ'.repeat(24), W, H)
    expect(rr.titleSize).toBeGreaterThanOrEqual(72)
  })

  it('解像度が違っても比率で決まる（1280x720では84×2/3=56px、下限48px）', () => {
    const r = fitTopicTitle('活動との距離の取り方', 1280, 720)
    expect(r.titleSize).toBe(56)
    expect(getTopicLayout(1280, 720).titleMin).toBe(48)
  })
})

describe('境界条件（合成データ）: 通常字幕とテーマの領域・非重複', () => {
  const usable = W - Math.round(W * 0.06) * 2
  const d = getCaptionStyleDefs(W, H).normal
  const synth = [
    { name: '1行16文字', lines: ['あ'.repeat(16)] },
    { name: '1行20文字', lines: ['あ'.repeat(20)] },
    { name: '2行合計30文字', lines: ['い'.repeat(15), 'う'.repeat(15)] },
    { name: '部分強調を含む2行', lines: ['これはとても大事な', '話になりますね'], emphasisText: 'とても大事' },
  ]

  it.each(synth)('$name: 左右セーフエリア内・下部35%以内・行数2以下・強調でサイズ不変', (c) => {
    const text = c.lines.join('')
    const ass = buildAssContent({ width: W, height: H, captions: [cap(1, 3, text, c.lines, c.emphasisText ?? null)] })
    const line = dialogues(ass)[0]
    expect((line.text.match(/\\N/g) ?? []).length).toBeLessThanOrEqual(1)
    expect(line.text).not.toMatch(/\\fs/)
    for (const l of c.lines) expect(Array.from(l).length * d.fontsize).toBeLessThanOrEqual(usable)
    const top = H - d.marginV - d.fontsize * c.lines.length * 1.3
    expect(top).toBeGreaterThanOrEqual(H * 0.65)
    expect(d.marginL).toBeGreaterThanOrEqual(W * 0.05)
  })

  it('最悪ケースのテーマ(2行24文字)の下端は、通常字幕2行の上端より十分上で、水平・垂直とも重ならない', () => {
    const r = fitTopicTitle('サークル運営とバンド活動を無理なく両立させる方法', W, H)
    const g = computeTopicGeometry(r.lines, W, H, r.titleSize)
    const themeBottom = g.box.y + g.box.h
    const captionTop = H - d.marginV - d.fontsize * 2 * 1.3
    expect(themeBottom).toBeLessThan(captionTop)
    expect(captionTop - themeBottom).toBeGreaterThan(H * 0.3)
  })

  it('テーマ2行時も箱の右端は画面の左半分・下端は上から1/3以内（顔の中央へ届かない）', () => {
    for (const t of ['サークルとバンドを両立する考え方', 'サークル運営とバンド活動を無理なく両立させる方法']) {
      const r = fitTopicTitle(t, W, H)
      const g = computeTopicGeometry(r.lines, W, H, r.titleSize)
      expect(g.box.x + g.box.w).toBeLessThan(W * 0.5)
      expect(g.box.y + g.box.h).toBeLessThan(H / 3)
    }
  })
})
