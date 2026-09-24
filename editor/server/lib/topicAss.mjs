// ローカルAIテロップ動画: 左上「現在のトークテーマ」のASS(スタイル + Dialogueイベント)生成。
//
// 通常字幕とは別スタイル・別レイヤー(Layer 10〜12)で、同時に表示できる。
//   - 左上固定（Alignment 7 + \pos）。左右・上端のセーフエリアを確保。
//   - 半透明の濃い背景(描画矩形) + 琥珀色の縦ライン + 小見出し "TALK THEME" + タイトル(最大2行)。
//   - 派手な動きは使わない。フェードは各テーマのイベントに閉じた \fad のみ（通常字幕へ影響しない）。
//   - タイトルは escapeAssText を通す（タグ注入不可）。
//   - 1テーマ=1組のイベント。テーマ同士のイベント時間は重複しない（隣接の場合も endSec === 次の startSec）。
//
// accentMode:
//   'label' … 小見出しと縦ラインだけ琥珀色、タイトル本文は白（既定）
//   'title' … タイトル全文も琥珀色
//
// 純粋関数のみ。

import { escapeAssText } from './assText.mjs'
import { breakTopicTitle, TOPIC_TITLE_LINE_HARD_MAX_CHARS } from './topicSections.mjs'
import { breakIntoLines } from './lineBreaker.mjs'

export const TOPIC_LAYER_BOX = 10
export const TOPIC_LAYER_BAR = 11
export const TOPIC_LAYER_TEXT = 12
export const TOPIC_FADE_MS = 200
export const TOPIC_LABEL_TEXT = 'TALK THEME'
export const TOPIC_STYLE_LABEL = 'TopicLabel'
export const TOPIC_STYLE_TITLE = 'TopicTitle'
export const TOPIC_STYLE_BOX = 'TopicBox'
export const TOPIC_ACCENT_MODES = ['label', 'title']

// Noto Sans CJK JP 太字の実測に基づく近似（全角1文字の送り幅 / ASSのFontsize）。
// libass は Fontsize を「ascent+descent の高さ」として扱うため、全角の送り幅は Fontsize より小さい。
export const CJK_ADVANCE_PER_FONTSIZE = 0.72
export const LATIN_ADVANCE_PER_FONTSIZE = 0.5
export const LINE_HEIGHT_PER_FONTSIZE = 1.0

const BOX_COLOUR = '&H000000&' // 描画矩形の色（黒）
const BOX_ALPHA = '&H50&' // 約69%不透明の黒 → 白壁の上でも読める
const WHITE = '&H00FFFFFF&'
const BLACK = '&H00000000&'

/** 1080p でのテーマタイトル既定サイズ(px)と、自動縮小の下限(px)。 */
export const TOPIC_TITLE_BASE_PX = 84
export const TOPIC_TITLE_MIN_PX = 72
/** 箱の右端の上限（画面幅に対する比率）。顔のある画面中央(50%)へ張り出さないための上限。 */
export const TOPIC_BOX_MAX_RIGHT_RATIO = 0.47
/** 1行のまま表示してよい箱の右端の上限（画面幅に対する比率）。超えるなら語境界で2行にして顔(頭)から離す。 */
export const TOPIC_BOX_SINGLE_LINE_RIGHT_RATIO = 0.41

/**
 * 表示解像度に対するテーマ表示のレイアウトを決める（すべて比率ベース。1080p で title=84 / label=40）。
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @param {number} [titleSizeOverride] 自動縮小後のタイトルサイズ(px)
 */
export function getTopicLayout(displayWidth, displayHeight, titleSizeOverride) {
  const shortSide = Math.min(displayWidth, displayHeight)
  const marginX = Math.max(24, Math.round(displayWidth * 0.05)) // 左のセーフマージン
  const marginTop = Math.max(24, Math.round(displayHeight * 0.06)) // 上のセーフマージン
  const titleBase = Math.max(22, Math.round(shortSide * (TOPIC_TITLE_BASE_PX / 1080)))
  const titleSize = titleSizeOverride ?? titleBase
  const labelSize = Math.max(14, Math.round(shortSide * (40 / 1080)))
  const pad = Math.max(10, Math.round(shortSide * (28 / 1080)))
  const barWidth = Math.max(4, Math.round(shortSide * (12 / 1080)))
  const gap = Math.max(6, Math.round(shortSide * (13 / 1080))) // ラベルとタイトルの間
  const titleMin = Math.max(20, Math.round(shortSide * (TOPIC_TITLE_MIN_PX / 1080)))
  return { marginX, marginTop, titleBase, titleMin, titleSize, labelSize, pad, barWidth, gap, maxRight: Math.round(displayWidth * TOPIC_BOX_MAX_RIGHT_RATIO) }
}

/** 文字列の描画幅(px)の近似。全角=CJK送り幅、それ以外=半角送り幅。 */
export function estimateTextWidthPx(text, fontsize) {
  let w = 0
  for (const ch of Array.from(text ?? '')) {
    w += (ch.charCodeAt(0) < 0x2000 ? LATIN_ADVANCE_PER_FONTSIZE : CJK_ADVANCE_PER_FONTSIZE) * fontsize
  }
  return w
}

/**
 * テーマ1件分の描画ジオメトリ（背景矩形・縦ライン・テキスト位置）。テストでも使う。
 * @param {string[]} lines タイトル行（1〜2）
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @param {number} [titleSize] タイトルサイズ(px)。省略時は既定サイズ
 */
export function computeTopicGeometry(lines, displayWidth, displayHeight, titleSize) {
  const L = getTopicLayout(displayWidth, displayHeight, titleSize)
  const labelW = estimateTextWidthPx(TOPIC_LABEL_TEXT, L.labelSize) + TOPIC_LABEL_TEXT.length * 1 // 字間1px
  const titleW = Math.max(0, ...lines.map((l) => estimateTextWidthPx(l, L.titleSize)))
  const labelH = L.labelSize * LINE_HEIGHT_PER_FONTSIZE
  const titleH = lines.length * L.titleSize * LINE_HEIGHT_PER_FONTSIZE
  const innerW = Math.max(labelW, titleW)
  const boxX = L.marginX
  const boxY = L.marginTop
  const boxW = L.barWidth + L.pad + innerW + L.pad
  const boxH = L.pad + labelH + L.gap + titleH + L.pad
  return {
    layout: L,
    box: { x: boxX, y: boxY, w: Math.round(boxW), h: Math.round(boxH) },
    bar: { x: boxX, y: boxY, w: L.barWidth, h: Math.round(boxH) },
    label: { x: boxX + L.barWidth + L.pad, y: boxY + L.pad },
    title: { x: boxX + L.barWidth + L.pad, y: boxY + L.pad + Math.round(labelH + L.gap) },
    innerW: Math.round(innerW),
  }
}

/**
 * タイトルの行分割・サイズを決める。顔(画面中央の頭部)へ張り出さないよう、次の順で試す。
 * 1. 1行のまま（14文字以内、かつ箱の右端が画面幅の41%以内）。短いタイトルは既定サイズの1行。
 * 2. 自然な語境界で、行の長さがなるべく揃うよう2行にする（箱の右端が47%以内なら既定サイズのまま）。
 * 3. それでも収まらないときだけ、既定サイズから下限(72px)まで1px単位で縮小する。
 *
 * @param {string} title
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @param {{ preferTwoLines?: boolean }} [options] preferTwoLines: 6文字以上は1行にせず2行にする（常時表示で背景箱の幅を狭く保ち、顔・髪から離すため）
 * @returns {{ lines: string[], titleSize: number, shrunk: boolean, fits: boolean }}
 */
export function fitTopicTitle(title, displayWidth, displayHeight, options = {}) {
  const t = typeof title === 'string' ? title.trim() : ''
  const L = getTopicLayout(displayWidth, displayHeight)
  const rightOf = (lines, size) => {
    const g = computeTopicGeometry(lines, displayWidth, displayHeight, size)
    return g.box.x + g.box.w
  }
  const n = Array.from(t).length
  if (n === 0) return { lines: [], titleSize: L.titleBase, shrunk: false, fits: true }

  // 1. 1行
  const singleLimit = Math.round(displayWidth * TOPIC_BOX_SINGLE_LINE_RIGHT_RATIO)
  if (!(options.preferTwoLines && n >= 6) && n <= TOPIC_TITLE_LINE_HARD_MAX_CHARS && rightOf([t], L.titleBase) <= singleLimit) {
    return { lines: [t], titleSize: L.titleBase, shrunk: false, fits: true }
  }

  // 2. 2行（行の長さを揃える。語の途中・助詞の直前では折らない）
  let lines = n > 1 ? breakIntoLines(t, { maxLineChars: Math.ceil(n / 2), hardMaxLineChars: TOPIC_TITLE_LINE_HARD_MAX_CHARS }) : [t]
  if (lines.length > 2) lines = breakTopicTitle(t)
  if (lines.length === 1 && n > TOPIC_TITLE_LINE_HARD_MAX_CHARS) lines = breakTopicTitle(t)

  // 3. 収まらないときだけ縮小
  for (let size = L.titleBase; size >= L.titleMin; size -= 1) {
    if (rightOf(lines, size) <= L.maxRight) return { lines, titleSize: size, shrunk: size < L.titleBase, fits: true }
  }
  return { lines, titleSize: L.titleMin, shrunk: L.titleMin < L.titleBase, fits: rightOf(lines, L.titleMin) <= L.maxRight }
}

/**
 * [V4+ Styles] に追加するテーマ用スタイル行3つ。
 * Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,
 *         ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
 *
 * @param {{ fontFamily: string, accent: string, displayWidth: number, displayHeight: number, accentMode?: 'label' | 'title' }} p
 * @returns {string[]}
 */
export function buildTopicStyleLines(p) {
  const L = getTopicLayout(p.displayWidth, p.displayHeight)
  const accentMode = p.accentMode === 'title' ? 'title' : 'label'
  const row = (name, size, primary, bold, outline, shadow, spacing) =>
    `Style: ${[name, p.fontFamily, size, primary, BLACK, BLACK, '&H80000000&', bold, 0, 0, 0, 100, 100, spacing, 0, 1, outline, shadow, 7, L.marginX, L.marginX, L.marginTop, 1].join(',')}`
  return [
    row(TOPIC_STYLE_LABEL, L.labelSize, p.accent, 1, 0, 0, 1),
    row(TOPIC_STYLE_TITLE, L.titleSize, accentMode === 'title' ? p.accent : WHITE, 1, 3, 0, 0),
    row(TOPIC_STYLE_BOX, 20, WHITE, 0, 0, 0, 0),
  ]
}

function formatAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const totalCentis = Math.round(s * 100)
  const centis = totalCentis % 100
  const totalSeconds = Math.floor(totalCentis / 100)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${Math.floor(totalSeconds / 3600)}:${pad2(Math.floor(totalSeconds / 60) % 60)}:${pad2(totalSeconds % 60)}.${pad2(centis)}`
}

const fadeTag = (ms) => `\\fad(${ms},${ms})`

/**
 * 1セクション分のDialogue行（背景・縦ライン・小見出し・タイトル）。
 * フェードは短いセクションでも破綻しないよう区間の 1/4 までに丸める。
 *
 * @param {{ id: string, title: string, startSec: number, endSec: number }} section
 * @param {{ accent: string, displayWidth: number, displayHeight: number, accentMode?: 'label' | 'title', fadeMs?: number }} p
 * @returns {string[]}
 */
export function buildTopicEvents(section, p) {
  const fit = fitTopicTitle(section.title, p.displayWidth, p.displayHeight)
  const lines = fit.lines
  if (lines.length === 0) return []
  const g = computeTopicGeometry(lines, p.displayWidth, p.displayHeight, fit.titleSize)
  const start = formatAssTime(section.startSec)
  const end = formatAssTime(section.endSec)
  const durMs = Math.max(0, (section.endSec - section.startSec) * 1000)
  const fade = fadeTag(Math.round(Math.min(p.fadeMs ?? TOPIC_FADE_MS, durMs / 4)))
  const accentMode = p.accentMode === 'title' ? 'title' : 'label'

  const rect = (r) => `m 0 0 l ${r.w} 0 ${r.w} ${r.h} 0 ${r.h}`
  const draw = (layer, r, colour, alpha) =>
    `Dialogue: ${layer},${start},${end},${TOPIC_STYLE_BOX},,0,0,0,,{\\an7\\pos(${r.x},${r.y})\\p1\\bord0\\shad0\\1c${colour}\\1a${alpha}${fade}}${rect(r)}{\\p0}`
  const accentBgr = p.accent.replace(/&H\d{2}/, '&H') // &H00BBGGRR& → &HBBGGRR&
  const title = lines.map((l) => escapeAssText(l)).join('\\N')
  const titleColourTag = (accentMode === 'title' ? `\\1c${accentBgr}` : '') + (fit.shrunk ? `\\fs${fit.titleSize}` : '') // 縮小したときだけ、このイベントに限ってサイズを指定

  return [
    draw(TOPIC_LAYER_BOX, g.box, BOX_COLOUR, BOX_ALPHA),
    draw(TOPIC_LAYER_BAR, g.bar, accentBgr, '&H00&'),
    `Dialogue: ${TOPIC_LAYER_TEXT},${start},${end},${TOPIC_STYLE_LABEL},,0,0,0,,{\\an7\\pos(${g.label.x},${g.label.y})${fade}}${escapeAssText(TOPIC_LABEL_TEXT)}`,
    `Dialogue: ${TOPIC_LAYER_TEXT},${start},${end},${TOPIC_STYLE_TITLE},,0,0,0,,{\\an7\\pos(${g.title.x},${g.title.y})${titleColourTag}${fade}}${title}`,
  ]
}

/**
 * 常時表示版のDialogue行。背景・縦ライン・`TALK THEME` は区間全体で1組だけ出し（消さない・フェードしない）、
 * タイトルだけをテーマごとに同じ位置で差し替える。切り替えで空白フレームが生じないよう、タイトルは隙間・重複なしに並べる。
 * 背景は全テーマのタイトルが収まる共通サイズ（最大幅・最大高さ）にする。
 *
 * @param {Array<{ id: string, title: string, startSec: number, endSec: number }>} sections 隙間・重複なし（normalizeTopicSectionsContinuous の結果）
 * @param {{ accent: string, displayWidth: number, displayHeight: number, accentMode?: 'label' | 'title', startSec: number, endSec: number }} p
 * @returns {{ events: string[], geometry: { box: object, bar: object, label: object, title: object, titleSizes: number[] } | null }}
 */
export function buildContinuousTopicEvents(sections, p) {
  const fits = sections.map((s) => fitTopicTitle(s.title, p.displayWidth, p.displayHeight, { preferTwoLines: true }))
  if (sections.length === 0 || fits.some((f) => f.lines.length === 0)) return { events: [], geometry: null }
  const gs = fits.map((f) => computeTopicGeometry(f.lines, p.displayWidth, p.displayHeight, f.titleSize))
  const box = { x: gs[0].box.x, y: gs[0].box.y, w: Math.max(...gs.map((g) => g.box.w)), h: Math.max(...gs.map((g) => g.box.h)) }
  const bar = { ...gs[0].bar, h: box.h }
  const label = gs[0].label
  const title = gs[0].title
  const accentMode = p.accentMode === 'title' ? 'title' : 'label'
  const accentBgr = p.accent.replace(/&H\d{2}/, '&H')
  const start = formatAssTime(p.startSec)
  const end = formatAssTime(p.endSec)
  const rect = (r) => `m 0 0 l ${r.w} 0 ${r.w} ${r.h} 0 ${r.h}`
  const draw = (layer, r, colour, alpha) =>
    `Dialogue: ${layer},${start},${end},${TOPIC_STYLE_BOX},,0,0,0,,{\\an7\\pos(${r.x},${r.y})\\p1\\bord0\\shad0\\1c${colour}\\1a${alpha}}${rect(r)}{\\p0}`
  const events = [
    draw(TOPIC_LAYER_BOX, box, BOX_COLOUR, BOX_ALPHA),
    draw(TOPIC_LAYER_BAR, bar, accentBgr, '&H00&'),
    `Dialogue: ${TOPIC_LAYER_TEXT},${start},${end},${TOPIC_STYLE_LABEL},,0,0,0,,{\\an7\\pos(${label.x},${label.y})}${escapeAssText(TOPIC_LABEL_TEXT)}`,
  ]
  sections.forEach((s, i) => {
    const f = fits[i]
    const text = f.lines.map((l) => escapeAssText(l)).join('\\N')
    const tag = (accentMode === 'title' ? `\\1c${accentBgr}` : '') + (f.shrunk ? `\\fs${f.titleSize}` : '')
    events.push(`Dialogue: ${TOPIC_LAYER_TEXT},${formatAssTime(s.startSec)},${formatAssTime(s.endSec)},${TOPIC_STYLE_TITLE},,0,0,0,,{\\an7\\pos(${title.x},${title.y})${tag}}${text}`)
  })
  return { events, geometry: { box, bar, label, title, titleSizes: fits.map((f) => f.titleSize) } }
}

const parseAssTime = (t) => {
  const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(t)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100 : NaN
}

/**
 * 生成済みASS本文から、テーマ表示の被覆を実際のDialogueイベントで検証する（JSONの時刻ではなくASSを読む）。
 * @param {string} assText
 * @param {{ startSec: number, endSec: number }} range
 */
export function analyzeTopicAssEvents(assText, range) {
  const ev = { box: [], label: [], title: [] }
  for (const line of assText.split('\n')) {
    const m = /^Dialogue: (\d+),([^,]+),([^,]+),([^,]*),/.exec(line)
    if (!m) continue
    const [, , st, en, style] = m
    const iv = [parseAssTime(st), parseAssTime(en)]
    if (style === TOPIC_STYLE_BOX) ev.box.push({ layer: Number(m[1]), iv })
    else if (style === TOPIC_STYLE_LABEL) ev.label.push({ iv })
    else if (style === TOPIC_STYLE_TITLE) ev.title.push({ iv })
  }
  const covered = (ivs) => {
    const sorted = ivs.map((x) => x.iv).sort((a, b) => a[0] - b[0])
    let cur = range.startSec
    let gap = 0
    let overlap = 0
    for (const [a, b] of sorted) {
      if (a > cur + 1e-6) gap += a - cur
      if (a < cur - 1e-6) overlap += cur - a
      cur = Math.max(cur, b)
    }
    if (cur < range.endSec) gap += range.endSec - cur
    return { coveredSec: sorted.reduce((s, [a, b]) => s + (b - a), 0), gapSec: Math.round(gap * 1000) / 1000, overlapSec: Math.round(overlap * 1000) / 1000, count: sorted.length, firstStart: sorted[0]?.[0] ?? null, lastEnd: sorted[sorted.length - 1]?.[1] ?? null }
  }
  const boxes = ev.box
  const titles = ev.title.map((x) => x.iv).sort((a, b) => a[0] - b[0])
  return {
    background: covered(boxes.filter((b) => b.layer === TOPIC_LAYER_BOX)),
    accentBar: covered(boxes.filter((b) => b.layer === TOPIC_LAYER_BAR)),
    label: covered(ev.label),
    title: covered(ev.title),
    boundaries: titles.slice(1).map((iv, i) => ({ atSec: iv[0], previousEnd: titles[i][1], exact: Math.abs(iv[0] - titles[i][1]) < 1e-6 })),
  }
}
