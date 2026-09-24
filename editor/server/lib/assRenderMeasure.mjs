// ローカルAIテロップ動画: ASS字幕を実際に描画(ffmpeg/libass + 実フォント)して、表示幅・行の位置を測る。
//
// 目的: 「全角1文字=1em」のような保守的な推定ではなく、実際のフォント・ASSレンダー結果を基準に
// 文字幅を検証する（captionFit.mjs の推定式の校正と、実データ/合成データの検証に使う）。
//
// 方法: 灰色(128)の背景に字幕を1フレーム描画し、背景から十分に離れた画素(白文字・黒縁・琥珀色)を「インク」として
// 行ごとの外接矩形を求める。縁取りを含む見た目上の幅なので、画面のはみ出し判定に使える。
// 外部AIは使わない。一時ファイルは呼び出し側が渡す一時ディレクトリに置く。

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { buildAssContent } from './captionStyles.mjs'

const execFileAsync = promisify(execFile)
const BG = 128
const THRESHOLD = 24

/**
 * グレースケールの生フレームから、インク(背景との差が閾値以上)の行ごとの外接矩形を求める。純粋関数。
 * 行は「インクのある連続した画素行」のまとまりで数え、gapRows 未満の隙間は同じ行とみなす。
 *
 * @param {Uint8Array} gray width*height
 * @param {number} width
 * @param {number} height
 * @param {{ bg?: number, threshold?: number, gapRows?: number }} [options]
 * @returns {{ lines: Array<{ top: number, bottom: number, left: number, right: number }>, left: number, right: number, top: number, bottom: number } | null}
 */
export function inkLines(gray, width, height, options = {}) {
  const bg = options.bg ?? BG
  const threshold = options.threshold ?? THRESHOLD
  const gapRows = options.gapRows ?? 6
  const rows = []
  for (let y = 0; y < height; y++) {
    let left = -1
    let right = -1
    const off = y * width
    for (let x = 0; x < width; x++) {
      if (Math.abs(gray[off + x] - bg) > threshold) {
        if (left < 0) left = x
        right = x
      }
    }
    rows.push(left < 0 ? null : { left, right })
  }
  const lines = []
  let cur = null
  let blank = 0
  for (let y = 0; y < height; y++) {
    const r = rows[y]
    if (r) {
      if (!cur) cur = { top: y, bottom: y, left: r.left, right: r.right }
      else {
        cur.bottom = y
        cur.left = Math.min(cur.left, r.left)
        cur.right = Math.max(cur.right, r.right)
      }
      blank = 0
    } else if (cur) {
      blank += 1
      if (blank >= gapRows) {
        lines.push(cur)
        cur = null
      }
    }
  }
  if (cur) lines.push(cur)
  if (lines.length === 0) return null
  return {
    lines,
    left: Math.min(...lines.map((l) => l.left)),
    right: Math.max(...lines.map((l) => l.right)),
    top: lines[0].top,
    bottom: lines[lines.length - 1].bottom,
  }
}

/**
 * 1件の字幕(単独)を実際にレンダーして測定する。
 *
 * @param {{ caption: object, width?: number, height?: number, tmpDir: string, ffmpegBin: string, captionFontScale?: number, name?: string }} p
 * @returns {Promise<{ measuredWidthPx: number, usageRatio: number, leftMarginPx: number, rightMarginPx: number, topPx: number, bottomPx: number, bottomMarginPx: number, lineCount: number, lineHeightsPx: number[], linePitchPx: number | null, overflow: boolean } | null>}
 */
export async function measureCaptionRender(p) {
  const width = p.width ?? 1920
  const height = p.height ?? 1080
  const cap = { startSec: 0, endSec: 1, captionType: 'normal', displayOrder: 0, ...p.caption }
  const assPath = join(p.tmpDir, `measure_${p.name ?? 'c'}.ass`)
  writeFileSync(assPath, buildAssContent({ width, height, captions: [cap] }, { captionFontScale: p.captionFontScale }), 'utf-8')
  const escaped = assPath.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
  const { stdout } = await execFileAsync(
    p.ffmpegBin,
    ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x808080:s=${width}x${height}:d=1:r=1`, '-vf', `ass=${escaped}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: width * height * 2 },
  )
  const ink = inkLines(new Uint8Array(stdout), width, height)
  if (!ink) return null
  const measuredWidthPx = ink.right - ink.left + 1
  const pitch = ink.lines.length >= 2 ? ink.lines[1].top - ink.lines[0].top : null
  return {
    measuredWidthPx,
    usageRatio: measuredWidthPx / width,
    leftMarginPx: ink.left,
    rightMarginPx: width - 1 - ink.right,
    topPx: ink.top,
    bottomPx: ink.bottom,
    bottomMarginPx: height - 1 - ink.bottom,
    lineCount: ink.lines.length,
    lineHeightsPx: ink.lines.map((l) => l.bottom - l.top + 1),
    linePitchPx: pitch,
    overflow: ink.left < 0 || ink.right > width - 1 || ink.lines.length > 2,
  }
}
