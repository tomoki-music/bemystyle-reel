// ローカルAIテロップ動画: 5分検証用の連続300秒区間を機械的に選ぶ。
//
// 既存ジョブ(caption・rawSegments・分類結果)を読み取り専用で点数化するだけ。外部AIは使わない。
// 候補はrawSegmentの開始位置（区間単位のアラインメントの切れ目と揃えるため）。
//
// 必須条件（満たさない候補は選ばない）:
// - 話題転換候補が2件以上（既存heading + 1秒以上の間を挟むrawSegment境界）
// - main / sub / emphasis の候補が各1件以上
// - 発話密度が動画全体の中央値の0.6倍以上（極端に低くない）
// 加点: 話題転換数（headingを重く・間だけの候補は軽く）・長文(25文字以上のcaption)の数・発話密度・既存の60秒検証区間との重なり・（任意）映像の変化量。

export const WINDOW_DEFAULTS = {
  windowSec: 300,
  minTransitions: 2,
  minDensityRatio: 0.6,
  longCaptionChars: 25,
  pauseTransitionSec: 1.0,
  weights: { transition: 100, pause: 60, longCaption: 2, longCaptionCap: 40, density: 30, overlapPerSec: 1, visual: 30 },
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0
}

/**
 * @param {{
 *   captions: Array<{ startSec: number, endSec: number, text: string, captionType: string }>,
 *   rawSegments: Array<{ startSec: number, endSec: number, text: string }>,
 *   durationSec: number,
 * }} job
 * @param {{ referenceWindow?: { startSec: number, endSec: number }, options?: object }} [p]
 * @returns {{ candidates: Array<object>, best: object | null, globalCharsPerSec: number }}
 *   candidates: 点数の高い順。eligible=false の候補も理由付きで含む。
 */
export function selectFiveMinuteWindow(job, p = {}) {
  const o = { ...WINDOW_DEFAULTS, ...(p.options ?? {}), weights: { ...WINDOW_DEFAULTS.weights, ...(p.options?.weights ?? {}) } }
  const ref = p.referenceWindow ?? null
  const totalChars = job.rawSegments.reduce((a, s) => a + s.text.length, 0)
  const globalDensity = totalChars / Math.max(1, job.durationSec)
  const segDensities = job.rawSegments.map((s) => s.text.length / Math.max(0.1, s.endSec - s.startSec))
  const medianDensity = median(segDensities)

  const candidates = []
  for (const seg of job.rawSegments) {
    const start = seg.startSec
    const end = start + o.windowSec
    if (end > job.durationSec + 1e-6) continue
    const caps = job.captions.filter((c) => c.startSec >= start - 1e-6 && c.endSec <= end + 1e-6)
    const segs = job.rawSegments.filter((s) => s.startSec >= start - 1e-6 && s.endSec <= end + 1e-6)
    if (caps.length === 0) continue
    const headings = caps.filter((c) => c.captionType === 'heading').length
    let pauses = 0
    for (let i = 1; i < segs.length; i++) if (segs[i].startSec - segs[i - 1].endSec >= o.pauseTransitionSec) pauses += 1
    const transitions = headings + pauses
    const types = { main: 0, sub: 0, emphasis: 0 }
    for (const c of caps) if (c.captionType in types) types[c.captionType] += 1
    const chars = caps.reduce((a, c) => a + c.text.length, 0)
    const density = chars / o.windowSec
    const densityRatio = medianDensity > 0 ? density / medianDensity : 0
    const longCaptions = caps.filter((c) => c.text.length >= o.longCaptionChars).length
    const overlapSec = ref ? Math.max(0, Math.min(end, ref.endSec) - Math.max(start, ref.startSec)) : 0
    const reasons = []
    if (transitions < o.minTransitions) reasons.push('話題転換候補が2件未満')
    if (types.main < 1 || types.sub < 1 || types.emphasis < 1) reasons.push('main/sub/emphasis候補が揃わない')
    if (densityRatio < o.minDensityRatio) reasons.push('発話密度が低い')
    const w = o.weights
    // 既存headingは確度の高い話題転換なので、間(pause)だけの候補より重く数える
    const score = headings * w.transition + pauses * w.pause + Math.min(longCaptions, w.longCaptionCap) * w.longCaption + Math.min(densityRatio, 1.5) * w.density + overlapSec * w.overlapPerSec
    candidates.push({
      startSec: start,
      endSec: end,
      eligible: reasons.length === 0,
      ineligibleReasons: reasons,
      score,
      metrics: { captions: caps.length, rawSegments: segs.length, headings, pauseTransitions: pauses, transitions, types, chars, densityRatio: Math.round(densityRatio * 100) / 100, longCaptions, overlapWithReferenceSec: Math.round(overlapSec * 10) / 10 },
    })
  }
  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.startSec - b.startSec)
  return { candidates, best: candidates.find((c) => c.eligible) ?? null, globalCharsPerSec: globalDensity }
}

/**
 * 映像の変化量(顔の位置・姿勢の変化の代理指標。0〜1)を加点して並べ直す。visual: startSec → 0〜1。
 */
export function rerankWithVisual(candidates, visual, weight = WINDOW_DEFAULTS.weights.visual) {
  return candidates
    .map((c) => ({ ...c, visualScore: visual[c.startSec] ?? 0, score: c.score + (visual[c.startSec] ?? 0) * weight }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.startSec - b.startSec)
}

/**
 * 灰色の小さいフレーム列から、暗い領域(髪・服)の重心の動きの大きさ(標準偏差の平均を0〜1に正規化)を返す。
 * 顔の位置・姿勢の変化の代理指標。純粋関数。
 *
 * @param {Array<Uint8Array>} frames 各フレームは width*height の8bitグレー
 * @param {number} width
 * @param {number} height
 * @param {number} [darkThreshold]
 */
export function darkMassMotion(frames, width, height, darkThreshold = 70) {
  const cs = []
  for (const f of frames) {
    let sx = 0
    let sy = 0
    let n = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (f[y * width + x] < darkThreshold) { sx += x; sy += y; n++ }
    if (n > 0) cs.push([sx / n / width, sy / n / height])
  }
  if (cs.length < 2) return 0
  const sd = (i) => {
    const m = cs.reduce((a, c) => a + c[i], 0) / cs.length
    return Math.sqrt(cs.reduce((a, c) => a + (c[i] - m) ** 2, 0) / cs.length)
  }
  return Math.min(1, (sd(0) + sd(1)) / 0.1)
}
