// ローカルAIテロップ動画: ASS (.ass) 字幕のスタイル定義とファイル生成。
//
// Phase 1 の UI は captionType = "normal" しか生成しないが、後続フェーズ
// （AIによる自動分類）でそのまま使えるよう、6種類のスタイルを今のうちに
// すべて定義しておく（要件どおり）。
//
// フォントは CAPTION_VIDEO_FONT_FAMILY 環境変数で差し替え可能（デフォルト
// "Noto Sans CJK JP"）。

import { escapeAssText } from './assText.mjs'

export const CAPTION_TYPES = ['normal', 'main', 'sub', 'emphasis', 'heading', 'annotation']

const DEFAULT_FONT_FAMILY = 'Noto Sans CJK JP'

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
function buildStyleDefs(displayWidth, displayHeight) {
  const shortSide = Math.min(displayWidth, displayHeight)
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
    outline: 3,
    shadow: 1,
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
      fontsize: Math.max(20, Math.round(shortSide * 0.058)),
      outline: 3.5,
    },
    sub: {
      ...base,
      name: 'Sub',
      // mainより明確に小さく、説明文として読みやすい控えめなデザイン。
      fontsize: Math.max(13, Math.round(shortSide * 0.038)),
      primaryColour: COLOR.paleGray,
      bold: 0,
      outline: 2,
      shadow: 0,
      marginV: Math.max(16, Math.round(safeMarginV * 0.6)),
    },
    emphasis: {
      ...base,
      name: 'Emphasis',
      // 文全体をアクセント色にしない（不自然になるため）。見た目はmain相当で、強調は部分オーバーライドで行う。
      fontsize: Math.max(20, Math.round(shortSide * 0.058)),
      outline: 3.5,
    },
    heading: {
      ...base,
      name: 'Heading',
      // 本当の話題転換だけに使う。上部の大きな黒帯は廃止し、縁取り文字のみ・やや大きめにする。
      fontsize: Math.max(22, Math.round(shortSide * 0.064)),
      outline: 3.5,
      alignment: ALIGNMENT.topCenter,
    },
    annotation: {
      ...base,
      name: 'Annotation',
      fontsize: Math.max(12, Math.round(shortSide * 0.03)),
      bold: 0,
      outline: 1.5,
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
 * @param {{ text: string, lines?: string[], emphasisText?: string | null }} caption
 * @param {string} highlightColour
 */
export function buildDialogueText(caption, highlightColour) {
  const text = typeof caption?.text === 'string' ? caption.text : ''
  const emphasisText = typeof caption?.emphasisText === 'string' ? caption.emphasisText : ''
  const useLines = Array.isArray(caption?.lines) && caption.lines.length > 1 && caption.lines.join('') === text
  const lines = useLines ? caption.lines : [text]

  const emStart = emphasisText && text.includes(emphasisText) ? text.indexOf(emphasisText) : -1
  const emEnd = emStart >= 0 ? emStart + emphasisText.length : -1
  const colourTag = `{\\c${highlightColour.replace(/^&H/, '').replace(/&$/, '')}&}`

  let offset = 0
  const renderedLines = lines.map((line) => {
    const lineStart = offset
    offset += line.length
    if (emStart < 0) return escapeAssText(line)
    const a = Math.max(emStart, lineStart) - lineStart
    const b = Math.min(emEnd, lineStart + line.length) - lineStart
    if (b <= a) return escapeAssText(line)
    return `${escapeAssText(line.slice(0, a))}${colourTag}${escapeAssText(line.slice(a, b))}{\\r}${escapeAssText(line.slice(b))}`
  })
  return renderedLines.join('\\N')
}

/**
 * ジョブと字幕配列から .ass ファイルの全文を生成する。
 *
 * @param {{ width: number, height: number, captions: Array<{ startSec: number, endSec: number, text: string, captionType?: string, emphasisText?: string | null }> }} job
 * @returns {string}
 */
export function buildAssContent(job) {
  const displayWidth = Math.max(1, Math.round(Number(job?.width) || 1080))
  const displayHeight = Math.max(1, Math.round(Number(job?.height) || 1920))
  const fontFamily = getFontFamily()
  const styleDefs = buildStyleDefs(displayWidth, displayHeight)

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
  const styles = stylesHeader.join('\n') + '\n'

  const events = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const captions = Array.isArray(job?.captions) ? job.captions : []
  const sorted = [...captions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  for (const caption of sorted) {
    const type = CAPTION_TYPES.includes(caption?.captionType) ? caption.captionType : 'normal'
    const def = styleDefs[type]
    const start = formatAssTime(caption.startSec)
    const end = formatAssTime(caption.endSec)
    const text = buildDialogueText(caption, def.highlightColour || COLOR.highlight)
    events.push(`Dialogue: 0,${start},${end},${def.name},,0,0,0,,${text}`)
  }

  return `${scriptInfo}\n${styles}\n${events.join('\n')}\n`
}
