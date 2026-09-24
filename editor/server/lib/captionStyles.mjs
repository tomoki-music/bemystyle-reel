// ローカルAIテロップ動画: ASS (.ass) 字幕のスタイル定義とファイル生成。
//
// Phase 1 の UI は captionType = "normal" しか生成しないが、後続フェーズ
// （AIによる自動分類）でそのまま使えるよう、6種類のスタイルを今のうちに
// すべて定義しておく（要件どおり）。
//
// フォントは CAPTION_VIDEO_FONT_FAMILY 環境変数で差し替え可能（デフォルト
// "Noto Sans CJK JP"）。

import { escapeAssText } from './assText.mjs'
import { buildTopicStyleLines, buildTopicEvents } from './topicAss.mjs'
import { fitCaptionFontSize, getCaptionFitLimits } from './captionFit.mjs'

export const CAPTION_TYPES = ['normal', 'main', 'sub', 'emphasis', 'heading', 'annotation']

const DEFAULT_FONT_FAMILY = 'Noto Sans CJK JP'

/**
 * 字幕サイズの倍率。フォントサイズ・縁取り・影の「大きさ」だけに、ここで一度だけ掛ける
 * （位置・余白・行数は掛けない。固定pxとの二重適用をしない）。基準は 1080p で normal=56px（1.00）。
 *
 * 2.066 → normal 116px（基本サイズ）。実描画の測定で、1行16文字が画面幅の約70%、20文字が約87%になる大きさ。
 * 長い行だけが captionFit.mjs の動的縮小（116→108→100→94→88→82、下限82px）で小さくなる。
 * サイズの比は倍率によらず一定: main は normal の約1.05倍（122px）、sub は約0.94倍（109px）、emphasis は normal と同じ。
 * （履歴: 56px(1.00) → 67px(1.20) → 82px(1.46) → 100px(1.78) → 116px(2.066)）
 */
export const CAPTION_FONT_SCALE = 2.066
export const CAPTION_FONT_SCALE_MAX = 2.5

/** 倍率を検証する。不正値は既定倍率へ戻す（極端な値で画面外へ出さない）。 */
export function resolveCaptionFontScale(scale) {
  return Number.isFinite(scale) && scale >= 0.5 && scale <= CAPTION_FONT_SCALE_MAX ? scale : CAPTION_FONT_SCALE
}

export function getFontFamily() {
  const v = process.env.CAPTION_VIDEO_FONT_FAMILY
  return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_FONT_FAMILY
}

// ASS カラーは &HAABBGGRR& 形式（アルファ, 青, 緑, 赤）。
const COLOR = {
  white: '&H00FFFFFF&',
  paleGray: '&H00D9D9D9&', // sub用の白〜淡いグレー
  black: '&H00000000&',
  yellow: '&H0000FFFF&', // R255 G255 B0
  // 動画全体で共通の強調色（1色のみ）。落ち着いたトーク動画(白壁・黒服・木目のギター)に馴染む
  // 琥珀色 #F0B34A。強い純オレンジ/紫は使わない。部分強調にだけ使い、通常字幕の色は変えない。
  highlight: '&H004AB3F0&',
  softShadow: '&H80000000&',
}

/**
 * ASS の Alignment はテンキー配置 (1=左下,2=中央下,3=右下,7=左上,8=中央上,9=右上)。
 */
const ALIGNMENT = {
  bottomCenter: 2,
  topCenter: 8,
  bottomRight: 3,
}

/**
 * 動画の表示解像度 (rotation 補正済み) に対する比率でスタイルを定義する。
 * これにより縦動画(9:16)・横動画のどちらでも破綻しないサイズ/位置になる。
 */
export function getCaptionStyleDefs(displayWidth, displayHeight, fontScale = CAPTION_FONT_SCALE) {
  // 大きさ（フォントサイズ・縁取り・影）だけに倍率を掛ける。余白・位置は元の解像度基準のまま。
  // 倍率はこの関数の入口で一度だけ適用する（下の fontsize は shortSide に掛け済みの値から計算するので、
  // 個別に倍率を掛け直さない）。縁取り・影は px 指定なので、同じ倍率を o() で一度だけ掛ける。
  const scale = resolveCaptionFontScale(fontScale)
  const shortSide = Math.min(displayWidth, displayHeight) * scale
  const o = (px) => Math.round(px * scale * 10) / 10
  const safeMarginH = Math.max(20, Math.round(displayWidth * 0.06))
  const safeMarginV = Math.max(24, Math.round(displayHeight * 0.06))

  // 通常字幕は captionType によらず「白文字・黒縁・画面下部中央」で統一する（頻繁に色を変えない）。
  // 不透明の全面バナー・点滅・拡大などの強い演出は使わない。強調はcaption全体ではなく、
  // Dialogue側の部分カラーオーバーライド(emphasisText)でのみ行う。
  const base = {
    primaryColour: COLOR.white,
    outlineColour: COLOR.black,
    backColour: COLOR.softShadow,
    bold: 1,
    borderStyle: 1,
    outline: o(3),
    shadow: o(1),
    alignment: ALIGNMENT.bottomCenter,
    marginL: safeMarginH,
    marginR: safeMarginH,
    marginV: safeMarginV,
    highlightColour: COLOR.highlight,
  }

  return {
    normal: {
      ...base,
      name: 'Normal',
      fontsize: Math.max(18, Math.round(shortSide * 0.052)),
    },
    main: {
      ...base,
      name: 'Main',
      // 全面バナーにせず、normalより少し大きくする程度に留める。
      fontsize: Math.max(20, Math.round(shortSide * 0.0545)), // normalの約1.05倍（極端に大きくしない）
      outline: o(3.2),
    },
    sub: {
      ...base,
      name: 'Sub',
      // 「サブだから小さくする」ことはしない（スマホで読めるサイズ）。淡いグレー・標準の太さで控えめに見せる。
      fontsize: Math.max(13, Math.round(shortSide * 0.049)), // normalの約0.94倍。小さくせず、色(淡いグレー)・太さで役割を表す
      primaryColour: COLOR.paleGray,
      bold: 0,
      outline: o(2),
      shadow: 0,
    },
    emphasis: {
      ...base,
      name: 'Emphasis',
      // 文全体をアクセント色にしない（不自然になるため）。サイズはnormalと同じで、強調は部分オーバーライドと
      // やや太い縁取りで行う（サイズは変えない）。
      fontsize: Math.max(20, Math.round(shortSide * 0.052)),
      outline: o(3.4),
    },
    heading: {
      ...base,
      name: 'Heading',
      // 本当の話題転換だけに使う。上部の大きな黒帯は廃止し、縁取り文字のみ・やや大きめにする。
      fontsize: Math.max(22, Math.round(shortSide * 0.064)),
      outline: o(3.5),
      alignment: ALIGNMENT.topCenter,
    },
    annotation: {
      ...base,
      name: 'Annotation',
      fontsize: Math.max(12, Math.round(shortSide * 0.03)),
      bold: 0,
      outline: o(1.5),
      shadow: 0,
      alignment: ALIGNMENT.bottomRight,
      marginL: Math.max(16, Math.round(safeMarginH * 0.5)),
      marginR: Math.max(16, Math.round(safeMarginH * 0.5)),
      marginV: Math.max(16, Math.round(safeMarginV * 0.5)),
    },
  }
}

function styleLine(def, fontFamily) {
  // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  //         Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,
  //         Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  return [
    'Style:',
    [
      def.name,
      fontFamily,
      def.fontsize,
      def.primaryColour,
      COLOR.black, // SecondaryColour（カラオケ用、未使用）
      def.outlineColour,
      def.backColour,
      def.bold,
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      def.borderStyle,
      def.outline,
      def.shadow,
      def.alignment,
      def.marginL,
      def.marginR,
      def.marginV,
      1,
    ].join(','),
  ].join(' ')
}

function formatAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const totalCentis = Math.round(s * 100)
  const centis = totalCentis % 100
  const totalSeconds = Math.floor(totalCentis / 100)
  const secs = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const mins = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${hours}:${pad2(mins)}:${pad2(secs)}.${pad2(centis)}`
}

/**
 * 1キャプション分の Dialogue: 行テキスト（エスケープ・強調オーバーライド込み）を組み立てる。
 *
 * - 改行: lines が本文と完全一致するときだけ、行境界へ明示的な ASS 改行 \\N を挿入する
 *   （本文(text)自体には \\N を保存しない。レンダー時に変換する）。
 * - 強調: emphasisText が text の部分文字列として実在する場合のみ、その範囲にだけ
 *   カラーオーバーライドを付与し、直後の {\\r} で必ず通常スタイルへ戻す。
 *   強調範囲が改行をまたぐ場合は、行ごとに開始・終了(\\r)を入れ直して行末で色を持ち越さない。
 * - ユーザー入力は必ず escapeAssText を通す（タグ注入不可）。
 *
 * - サイズ: fontSize を渡したとき（動的縮小した字幕）だけ、先頭に \\fsN を付ける。強調後の {\\r} はスタイルへ戻して
 *   サイズも基本サイズへ戻ってしまうので、{\\r\\fsN} にして字幕内でサイズが変わらないようにする。
 *
 * @param {{ text: string, lines?: string[], emphasisText?: string | null }} caption
 * @param {string} highlightColour
 * @param {number} [fontSize] 縮小後のフォントサイズ(px)。省略時はスタイルのサイズのまま
 */
export function buildDialogueText(caption, highlightColour, fontSize) {
  const text = typeof caption?.text === 'string' ? caption.text : ''
  const emphasisText = typeof caption?.emphasisText === 'string' ? caption.emphasisText : ''
  const useLines = Array.isArray(caption?.lines) && caption.lines.length > 1 && caption.lines.join('') === text
  const lines = useLines ? caption.lines : [text]

  const emStart = emphasisText && text.includes(emphasisText) ? text.indexOf(emphasisText) : -1
  const emEnd = emStart >= 0 ? emStart + emphasisText.length : -1
  const colourTag = `{\\c${highlightColour.replace(/^&H/, '').replace(/&$/, '')}&}`
  const sizeTag = Number.isFinite(fontSize) ? `\\fs${fontSize}` : ''
  const resetTag = `{\\r${sizeTag}}`

  let offset = 0
  const renderedLines = lines.map((line) => {
    const lineStart = offset
    offset += line.length
    if (emStart < 0) return escapeAssText(line)
    const a = Math.max(emStart, lineStart) - lineStart
    const b = Math.min(emEnd, lineStart + line.length) - lineStart
    if (b <= a) return escapeAssText(line)
    return `${escapeAssText(line.slice(0, a))}${colourTag}${escapeAssText(line.slice(a, b))}${resetTag}${escapeAssText(line.slice(b))}`
  })
  const body = renderedLines.join('\\N')
  return sizeTag ? `{${sizeTag}}${body}` : body
}

/**
 * 字幕ごとのフォントサイズを決める（基本サイズ → 長い行だけ段階的に縮小、下限82px@1080p）。
 * 表示側(buildAssContent)と検証側(ランナー/テスト)で同じ結果を使うために公開する。
 *
 * @param {Array<{ text: string, lines?: string[], captionType?: string }>} captions
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @param {number} [fontScale]
 * @returns {Array<{ type: string, baseSize: number, size: number, shrunk: boolean, fits: boolean, widthPx: number }>}
 */
export function planCaptionFits(captions, displayWidth, displayHeight, fontScale = CAPTION_FONT_SCALE) {
  const defs = getCaptionStyleDefs(displayWidth, displayHeight, fontScale)
  const limits = getCaptionFitLimits(displayWidth, displayHeight)
  return (captions ?? []).map((c) => {
    const type = CAPTION_TYPES.includes(c?.captionType) ? c.captionType : 'normal'
    const text = typeof c?.text === 'string' ? c.text : ''
    const lines = Array.isArray(c?.lines) && c.lines.length > 1 && c.lines.join('') === text ? c.lines : [text]
    const baseSize = defs[type].fontsize
    const fit = fitCaptionFontSize({ lines, baseSize, minSize: limits.minSizePx, maxWidthPx: limits.maxWidthPx, ladderPx: limits.ladderPx })
    return { type, baseSize, ...fit }
  })
}

/**
 * ジョブと字幕配列から .ass ファイルの全文を生成する。
 *
 * @param {{ width: number, height: number, captions: Array<{ startSec: number, endSec: number, text: string, captionType?: string, emphasisText?: string | null }> }} job
 * @param {{ captionFontScale?: number, topicSections?: Array<{ id: string, title: string, startSec: number, endSec: number }>, topicAccentMode?: 'label' | 'title' }} [options]
 *   topicSections: 左上「現在のトークテーマ」（別スタイル・別レイヤー。ジョブ本体には保存しない）
 * @returns {string}
 */
export function buildAssContent(job, options = {}) {
  const displayWidth = Math.max(1, Math.round(Number(job?.width) || 1080))
  const displayHeight = Math.max(1, Math.round(Number(job?.height) || 1920))
  const fontFamily = getFontFamily()
  const styleDefs = getCaptionStyleDefs(displayWidth, displayHeight, options.captionFontScale)
  const topicSections = Array.isArray(options.topicSections) ? options.topicSections : []

  const scriptInfo = [
    '[Script Info]',
    'Title: BeMyStyle Local Caption Video',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${displayWidth}`,
    `PlayResY: ${displayHeight}`,
    '',
  ].join('\n')

  const stylesHeader = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ]
  for (const type of CAPTION_TYPES) {
    stylesHeader.push(styleLine(styleDefs[type], fontFamily))
  }
  if (topicSections.length > 0) {
    stylesHeader.push(...buildTopicStyleLines({ fontFamily, accent: COLOR.highlight, displayWidth, displayHeight, accentMode: options.topicAccentMode }))
  }
  const styles = stylesHeader.join('\n') + '\n'

  const events = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const captions = Array.isArray(job?.captions) ? job.captions : []
  const sorted = [...captions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  const fits = planCaptionFits(sorted, displayWidth, displayHeight, options.captionFontScale)
  for (const [i, caption] of sorted.entries()) {
    const type = CAPTION_TYPES.includes(caption?.captionType) ? caption.captionType : 'normal'
    const def = styleDefs[type]
    const start = formatAssTime(caption.startSec)
    const end = formatAssTime(caption.endSec)
    // 縮小が必要な字幕だけサイズを指定する（短い字幕は基本サイズのまま）。
    const text = buildDialogueText(caption, def.highlightColour || COLOR.highlight, fits[i].shrunk ? fits[i].size : undefined)
    events.push(`Dialogue: 0,${start},${end},${def.name},,0,0,0,,${text}`)
  }

  // トークテーマは通常字幕と別レイヤー(10〜12)。時刻順に出力し、同時に表示されても字幕と競合しない。
  const orderedTopics = [...topicSections].sort((a, b) => a.startSec - b.startSec)
  for (const section of orderedTopics) {
    events.push(...buildTopicEvents(section, { accent: COLOR.highlight, displayWidth, displayHeight, accentMode: options.topicAccentMode }))
  }

  return `${scriptInfo}\n${styles}\n${events.join('\n')}\n`
}
