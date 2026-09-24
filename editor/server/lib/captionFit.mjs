// ローカルAIテロップ動画: 通常字幕の「基本サイズ + 動的縮小」。
//
// 方針:
// - 基本サイズ(例: normal=100px)で統一し、文字数が少ない字幕を横幅いっぱいにするために拡大しない。
// - 長い行だけを縮小する。必要なときだけ、基本サイズから段階的（6px刻み）に下げ、下限(82px @1080p)で止める。
//   段階的に丸めるのは、字幕ごとにサイズが頻繁に変わって見えないようにするため。
// - 文字幅は「全角1文字=1em」のような保守的な推定ではなく、実際のフォント(Noto Sans CJK JP Bold)を
//   libass で描画して測った値で校正した推定式を使う（assRenderMeasure.mjs で実描画と照合する）。
//
// 純粋関数のみ。

/** libass(Noto Sans CJK JP Bold)で実測した、Fontsizeに対する1文字の送り幅の比。 */
export const ADVANCE_EM = {
  cjk: 0.7225, // ひらがな・カタカナ・漢字・全角記号（「、」「。」も送り幅は全角）
  digit: 0.475,
  latin: 0.55,
  other: 0.4, // 半角記号・空白など
}
/** 文字幅の推定に加える定数(px)。実描画との差(0〜-4px)を吸収し、推定が実測を下回らないようにする。 */
export const WIDTH_CONSTANT_PX = 4

/** 使用可能幅（画面幅に対する比率）。左右の安全余白は各6%（=1-0.88の半分）。 */
export const CAPTION_USABLE_WIDTH_RATIO = 0.88
/** 自動縮小の下限（1080pのpx）。これ未満にはしない。 */
export const CAPTION_MIN_FONT_PX_1080 = 82
/** 縮小の段階（px）。 */
export const CAPTION_SHRINK_STEP_PX = 6

const isDigit = (c) => c >= 0x30 && c <= 0x39
const isLatin = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)

/** 1行の描画幅(px)の推定（縁取りを含む見た目の幅）。 */
export function estimateLineWidthPx(line, fontsize) {
  let em = 0
  for (const ch of Array.from(line ?? '')) {
    const c = ch.codePointAt(0)
    if (c < 0x80) em += isDigit(c) ? ADVANCE_EM.digit : isLatin(c) ? ADVANCE_EM.latin : ADVANCE_EM.other
    else em += ADVANCE_EM.cjk
  }
  return em * fontsize + WIDTH_CONSTANT_PX
}

/** 表示解像度から、使用可能幅(px)と下限フォントサイズ(px)を決める。 */
export function getCaptionFitLimits(displayWidth, displayHeight) {
  return {
    maxWidthPx: Math.floor(displayWidth * CAPTION_USABLE_WIDTH_RATIO),
    minSizePx: Math.round(CAPTION_MIN_FONT_PX_1080 * (Math.min(displayWidth, displayHeight) / 1080)),
  }
}

/**
 * 字幕1件のフォントサイズを決める。
 * 1. 基本サイズで最も長い行の幅を見積もる。
 * 2. 使用可能幅(88%)以内なら基本サイズのまま（短い字幕を縮小・拡大しない）。
 * 3. 超える場合だけ、基本サイズから STEP px ずつ下げ、最初に収まったサイズを採用する。
 * 4. 下限まで下げても収まらなければ下限を採用し fits=false（警告）。下限未満にはしない。
 *
 * @param {{ lines: string[], baseSize: number, minSize: number, maxWidthPx: number, stepPx?: number }} p
 * @returns {{ size: number, shrunk: boolean, fits: boolean, widthPx: number }}
 */
export function fitCaptionFontSize(p) {
  const step = p.stepPx ?? CAPTION_SHRINK_STEP_PX
  const floor = Math.min(p.minSize, p.baseSize)
  const widthAt = (size) => Math.max(0, ...p.lines.map((l) => estimateLineWidthPx(l, size)))
  const candidates = []
  for (let s = p.baseSize; s > floor; s -= step) candidates.push(s)
  candidates.push(floor)
  for (const size of candidates) {
    const w = widthAt(size)
    if (w <= p.maxWidthPx) return { size, shrunk: size < p.baseSize, fits: true, widthPx: w }
  }
  return { size: floor, shrunk: floor < p.baseSize, fits: false, widthPx: widthAt(floor) }
}
