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
import { breakTopicTitle } from './topicSections.mjs'

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
 * タイトルが箱からはみ出さない（右端が maxRight 以内）ように行とサイズを決める。
 * 1. 自然な語境界で最大2行にする（breakTopicTitle）。
 * 2. 箱は本文幅に合わせて広がるが、右端は画面中央へ張り出さない上限(maxRight)まで。
 * 3. それでも収まらないときだけ、既定サイズから下限まで縮小する。短いタイトルは既定サイズのまま。
 *
 * @param {string} title
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @returns {{ lines: string[], titleSize: number, shrunk: boolean, fits: boolean }}
 */
export function fitTopicTitle(title, displayWidth, displayHeight) {
  const lines = breakTopicTitle(title)
  const L = getTopicLayout(displayWidth, displayHeight)
  const rightAt = (size) => {
    const g = computeTopicGeometry(lines, displayWidth, displayHeight, size)
    return g.box.x + g.box.w
  }
  for (let size = L.titleBase; size >= L.titleMin; size -= 1) {
    if (rightAt(size) <= L.maxRight) return { lines, titleSize: size, shrunk: size < L.titleBase, fits: true }
  }
  return { lines, titleSize: L.titleMin, shrunk: L.titleMin < L.titleBase, fits: rightAt(L.titleMin) <= L.maxRight }
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
