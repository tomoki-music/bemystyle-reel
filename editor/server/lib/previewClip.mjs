// ローカルAIテロップ動画: captionType別デザイン確認用の短時間(30〜60秒)プレビュー。
//
// 分類済みcaptionから、main/sub/emphasisを最低1件ずつ含む区間を機械的に選ぶ。
// 該当する区間が無ければ、プレビュー専用のダミーcaption(実際の字幕本文ではない)
// を使う。ここで生成するcaption配列は、レンダリング(ASS生成)にのみ使う一時的な
// ビューであり、ジョブ本体のcaptions/rawSegmentsは一切変更しない。

export const PREVIEW_MIN_SEC = 30
export const PREVIEW_MAX_SEC = 60
const CANDIDATE_LENGTHS_SEC = [30, 35, 40, 45, 50, 55, 60]
const REQUIRED_TYPES = ['main', 'sub', 'emphasis']
const BONUS_TYPES = ['heading', 'annotation']

/**
 * captionType別デザインを確認できる30〜60秒の区間を、分類済みcaptionから
 * 機械的に選ぶ。main/sub/emphasisを最低1件ずつ含む区間の中で、
 * (1) heading/annotationも含む数が多いものを優先、(2) 同点ならより短い区間を優先。
 * 該当区間が無ければ null を返す（呼び出し側でsynthetic captionにフォールバックする）。
 *
 * @param {Array<{ id: string, startSec: number, endSec: number, captionType: string }>} captions
 * @param {{ minSec?: number, maxSec?: number, candidateLengths?: number[], totalDurationSec?: number }} [options]
 *   totalDurationSec: 実際の動画の長さ（秒）。省略時は最後のcaptionの終了時刻を使う
 *   （動画自体は最後のcaptionより後も続くのが普通なので、可能なら渡すことを推奨）。
 * @returns {{ startSec: number, endSec: number, captions: Array<object> } | null}
 */
export function selectPreviewWindow(captions, options = {}) {
  const minSec = options.minSec ?? PREVIEW_MIN_SEC
  const maxSec = options.maxSec ?? PREVIEW_MAX_SEC
  const lengths = (options.candidateLengths ?? CANDIDATE_LENGTHS_SEC).filter((l) => l >= minSec && l <= maxSec)

  const sorted = [...(captions ?? [])]
    .filter((c) => Number.isFinite(c.startSec) && Number.isFinite(c.endSec) && c.endSec > c.startSec)
    .sort((a, b) => a.startSec - b.startSec)
  if (sorted.length === 0) return null

  const lastCaptionEnd = sorted[sorted.length - 1].endSec
  const totalEnd = Number.isFinite(options.totalDurationSec) ? Math.max(options.totalDurationSec, lastCaptionEnd) : lastCaptionEnd

  let best = null
  let bestScore = -Infinity
  for (const winLen of lengths) {
    let foundAtThisLength = false
    for (const c of sorted) {
      const winStart = c.startSec
      const winEnd = winStart + winLen
      if (winEnd > totalEnd + 1e-9) continue

      const inWindow = sorted.filter((cc) => cc.startSec >= winStart - 1e-9 && cc.endSec <= winEnd + 1e-9)
      if (inWindow.length === 0) continue

      const types = new Set(inWindow.map((cc) => cc.captionType))
      const hasAllRequired = REQUIRED_TYPES.every((t) => types.has(t))
      if (!hasAllRequired) continue

      foundAtThisLength = true
      const bonus = BONUS_TYPES.reduce((acc, t) => acc + (types.has(t) ? 1 : 0), 0)
      const score = bonus * 1000 - winLen // ボーナス種別を多く含む方を優先、同点ならより短い区間
      if (score > bestScore) {
        bestScore = score
        best = { startSec: winStart, endSec: winEnd, captions: inWindow }
      }
    }
    // この長さで要件を満たす区間が見つかったら、それより長い候補は試さない
    // (最小限の長さで代表的なcaptionTypeを見せる区間を優先する)。
    if (foundAtThisLength) break
  }

  return best
}

/**
 * 該当する短い区間が実データに無い場合のフォールバック。
 * 実際の字幕本文ではなく、プレビュー専用のダミーテキストを使う。
 * 6種類全captionTypeを含み、合計30秒になるよう構成する。
 *
 * @returns {{ startSec: number, endSec: number, captions: Array<object> }}
 */
export function buildSyntheticPreviewWindow() {
  const items = [
    { captionType: 'heading', text: '【プレビュー】見出しサンプル' },
    { captionType: 'main', text: '【プレビュー】メインメッセージのサンプルです' },
    { captionType: 'sub', text: '【プレビュー】補足説明のサンプルテキストです' },
    { captionType: 'emphasis', text: '【プレビュー】強調ワードのサンプル' },
    { captionType: 'annotation', text: '【プレビュー】補足情報の注釈サンプルです' },
    { captionType: 'normal', text: '【プレビュー】通常会話のサンプルテキストです' },
  ]
  const perItemSec = PREVIEW_MIN_SEC / items.length
  const captions = items.map((item, i) => ({
    id: `preview-synthetic-${i}`,
    startSec: i * perItemSec,
    endSec: (i + 1) * perItemSec,
    text: item.text,
    captionType: item.captionType,
    emphasisText: null,
    displayOrder: i,
  }))
  return { startSec: 0, endSec: PREVIEW_MIN_SEC, captions, synthetic: true }
}

/**
 * 選ばれた区間のcaptionを、区間開始を0秒とする相対時刻へ時間シフトした
 * 「レンダリング専用ビュー」を作る。ジョブ本体のcaptions配列は一切変更しない。
 *
 * @param {{ width: number, height: number }} job
 * @param {{ startSec: number, endSec: number, captions: Array<object> }} window
 * @returns {{ width: number, height: number, captions: Array<object> }}
 */
export function buildPreviewAssView(job, window) {
  const shifted = window.captions.map((c) => ({
    ...c,
    startSec: Math.max(0, c.startSec - window.startSec),
    endSec: Math.max(0, c.endSec - window.startSec),
  }))
  return { width: job.width, height: job.height, captions: shifted }
}
