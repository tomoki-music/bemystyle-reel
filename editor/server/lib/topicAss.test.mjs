import { describe, it, expect } from 'vitest'
import {
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

describe('通常字幕の拡大（セーフエリア）', () => {
  it('既定倍率は 1.15〜1.20 の範囲で、現在サイズ(1.0)より大きい', () => {
    expect(CAPTION_FONT_SCALE).toBeGreaterThanOrEqual(1.15)
    expect(CAPTION_FONT_SCALE).toBeLessThanOrEqual(1.2)
    const base = getCaptionStyleDefs(W, H, 1).normal.fontsize
    const now = getCaptionStyleDefs(W, H).normal.fontsize
    expect(now / base).toBeGreaterThanOrEqual(1.15 - 0.02)
    expect(now / base).toBeLessThanOrEqual(1.2 + 0.02)
  })

  it('不正な倍率は既定へ戻す（極端な値で画面外へ出さない）', () => {
    for (const s of [NaN, 0, -1, 9, Infinity, undefined]) expect(resolveCaptionFontScale(s)).toBe(CAPTION_FONT_SCALE)
  })

  it('1行(16文字)・2行(16+14文字)・最大文字数(30文字/行20文字ハード上限)が左右セーフエリアに収まる（全角=1emの保守的見積り）', () => {
    const d = getCaptionStyleDefs(W, H).normal
    const usable = W - d.marginL - d.marginR
    for (const chars of [16, 20]) expect(chars * d.fontsize).toBeLessThanOrEqual(usable)
    expect(30 * d.fontsize / 2).toBeLessThanOrEqual(usable) // 30文字を2行に割った1行
  })

  it('2行ぶんの高さが下端を越えず、画面中央(顔)まで届かない', () => {
    const d = getCaptionStyleDefs(W, H).normal
    const blockHeight = d.fontsize * 2 * 1.3
    const top = H - d.marginV - blockHeight
    expect(H - d.marginV).toBeLessThan(H) // 下端に近づきすぎない
    expect(d.marginV).toBeGreaterThanOrEqual(H * 0.05)
    expect(top).toBeGreaterThan(H * 0.65) // 画面下部に収まり、顔の中央を覆わない
  })

  it('normal / main / sub の比を保ち、mainだけ極端に大きくならない', () => {
    const s1 = getCaptionStyleDefs(W, H, 1)
    const s = getCaptionStyleDefs(W, H)
    expect(s.main.fontsize / s.normal.fontsize).toBeCloseTo(s1.main.fontsize / s1.normal.fontsize, 1)
    expect(s.main.fontsize / s.normal.fontsize).toBeLessThan(1.2)
    expect(s.sub.fontsize).toBeLessThan(s.normal.fontsize)
  })

  it('位置・余白（下部中央・セーフマージン）は拡大しても変わらない', () => {
    const s1 = getCaptionStyleDefs(W, H, 1).normal
    const s = getCaptionStyleDefs(W, H).normal
    expect([s.alignment, s.marginL, s.marginR, s.marginV]).toEqual([s1.alignment, s1.marginL, s1.marginR, s1.marginV])
  })

  it('部分強調は色のオーバーライドのみで、文字サイズ・太さを変えない', () => {
    const text = buildDialogueText({ text: 'これはとても大事ですね', emphasisText: 'とても大事' }, ACCENT)
    expect(text).not.toMatch(/\\fs|\\fscx|\\fscy|\\b\d|\\fn/)
    expect(text).toContain('{\\c004AB3F0&}とても大事{\\r}')
    const ass = buildAssContent({ width: W, height: H, captions: [cap(0, 2, 'これはとても大事ですね', ['これはとても大事ですね'], 'とても大事')] })
    expect(styleFontsize(ass, 'Normal')).toBe(getCaptionStyleDefs(W, H).normal.fontsize)
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
