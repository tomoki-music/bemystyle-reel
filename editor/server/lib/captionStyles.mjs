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
  highlight: '&H0000A5FF&', // オレンジ (R255 G165 B0) - emphasisのアクセント色
  transparentBlack60: '&H60000000&',
  brand: '&H00FC84C0&', // エディタUIのアクセント色 #c084fc を流用 (main用ブランドカラー)
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

  return {
    normal: {
      name: 'Normal',
      fontsize: Math.max(18, Math.round(shortSide * 0.052)),
      primaryColour: COLOR.white,
      outlineColour: COLOR.black,
      backColour: COLOR.black,
      bold: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 0,
      alignment: ALIGNMENT.bottomCenter,
      marginL: safeMarginH,
      marginR: safeMarginH,
      marginV: safeMarginV,
    },
    main: {
      name: 'Main',
      // normalより少し大きい程度に留め、画面を覆いすぎないようにする。
      fontsize: Math.max(22, Math.round(shortSide * 0.062)),
      primaryColour: COLOR.white,
      outlineColour: COLOR.brand,
      backColour: COLOR.brand,
      bold: 1,
      borderStyle: 3, // ブランドカラーの不透明ボックス（中心メッセージとして目立たせる）
      outline: 4,
      shadow: 0,
      alignment: ALIGNMENT.bottomCenter,
      marginL: safeMarginH,
      marginR: safeMarginH,
      marginV: safeMarginV,
    },
    sub: {
      name: 'Sub',
      // mainより明確に小さく、説明文として読みやすい控えめなデザイン。
      fontsize: Math.max(13, Math.round(shortSide * 0.036)),
      primaryColour: COLOR.paleGray,
      outlineColour: COLOR.black,
      backColour: COLOR.black,
      bold: 0,
      borderStyle: 1,
      outline: 1,
      shadow: 0,
      alignment: ALIGNMENT.bottomCenter,
      marginL: safeMarginH,
      marginR: safeMarginH,
      marginV: Math.max(16, Math.round(safeMarginV * 0.6)),
    },
    emphasis: {
      name: 'Emphasis',
      fontsize: Math.max(20, Math.round(shortSide * 0.058)),
      // emphasisType全体をアクセント色・太字・強めの縁取りにし、一目で強調と分かるようにする。
      primaryColour: COLOR.highlight,
      outlineColour: COLOR.black,
      backColour: COLOR.black,
      bold: 1,
      borderStyle: 1,
      outline: 4,
      shadow: 0,
      alignment: ALIGNMENT.bottomCenter,
      marginL: safeMarginH,
      marginR: safeMarginH,
      marginV: safeMarginV,
      // emphasisType以外のcaptionでも、部分文字列だけをこの色で強調したい場合に
      // Dialogue側で \c カラーオーバーライドタグを差し込む（emphasisText参照）。
      highlightColour: COLOR.highlight,
    },
    heading: {
      name: 'Heading',
      fontsize: Math.max(26, Math.round(shortSide * 0.08)),
      primaryColour: COLOR.white,
      outlineColour: COLOR.black,
      backColour: COLOR.transparentBlack60,
      bold: 1,
      borderStyle: 3, // 不透明ボックス（バナー風）
      outline: 6,
      shadow: 0,
      alignment: ALIGNMENT.topCenter,
      marginL: safeMarginH,
      marginR: safeMarginH,
      marginV: safeMarginV,
    },
    annotation: {
      name: 'Annotation',
      fontsize: Math.max(12, Math.round(shortSide * 0.03)),
      primaryColour: COLOR.white,
      outlineColour: COLOR.black,
      backColour: COLOR.black,
      bold: 0,
      borderStyle: 1,
      outline: 1,
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
 * emphasisText が text の部分文字列として実在する場合のみ、その部分にカラーオーバーライドを付与する。
 *
 * @param {{ text: string, emphasisText?: string | null }} caption
 * @param {string} highlightColour
 */
export function buildDialogueText(caption, highlightColour) {
  const text = typeof caption?.text === 'string' ? caption.text : ''
  const emphasisText = typeof caption?.emphasisText === 'string' ? caption.emphasisText : ''

  if (!emphasisText || !text.includes(emphasisText)) {
    return escapeAssText(text)
  }

  const idx = text.indexOf(emphasisText)
  const before = text.slice(0, idx)
  const mid = text.slice(idx, idx + emphasisText.length)
  const after = text.slice(idx + emphasisText.length)

  // {\c...} / {\r} はこちら側で組み立てたリテラルタグであり、ユーザー入力は
  // 必ず escapeAssText を通してから前後に連結するため、ユーザー入力からの
  // オーバーライドタグ注入は起こらない。
  return `${escapeAssText(before)}{\\c${highlightColour.replace(/^&H/, '').replace(/&$/, '')}&}${escapeAssText(mid)}{\\r}${escapeAssText(after)}`
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
