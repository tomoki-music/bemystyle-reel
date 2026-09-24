// ローカルAIテロップ動画: ページ分割(cuts)の禁止境界・極端に短いページの修正と、切り替え頻度の穏やかな整理。
//
// splitTextIntoNaturalPages のDP結果（cuts = [[開始index, 終了index), ...]）を入力に、境界だけを動かす。
// 本文は一切変更しない（cutsの位置を動かす・隣接ページを統合するだけなので、連結すると常に正本に一致する）。
// 各ページの表示時刻は呼び出し側が「発話時刻」から組み直すため、ここでは時刻を直接いじらない。
//
// 修正の優先順位（禁止境界1件ごと）:
//   1. 前後の語境界へ切り位置を動かす（同じ発話区間内。読点・文節・実無音などコストの低い位置を優先）
//   2. その動かし方で前後のページへ短い語句が移る（動かした分だけ）
//   3. 制約内に収まる場合のみ隣接ページへ統合
//   4. どれも不可能なら unresolved に診断情報（ページ番号・理由）だけを残す（本文は残さない）
//
// 制約は ctx.pageOk が保証する（最大30文字・最大2行・句点をまたがない・0.6秒以上の無音をまたがない・発話時間の上限）。
// 純粋関数。AI/LLMは使わない。

const DEFAULTS = { window: 14, maxPasses: 8, shiftCost: 4, mergeCost: 150, shortPenalty: 120 }

/**
 * @typedef {Object} RepairContext
 * @property {(p: number) => string[]} reasonsAt 切り位置pの禁止理由（補正版）。空なら切ってよい
 * @property {(i: number, j: number) => boolean} pageOk ページ[i,j)が制約（文字数・行・文またぎ・無音・発話時間）を満たすか
 * @property {(i: number, j: number) => boolean} dangling ページ[i,j)の末尾が接続詞だけで孤立しているか
 * @property {(i: number, j: number) => boolean} isShort ページ[i,j)が極端に短い（0.5秒未満または3文字以下）うえ、単独で許容される短語でないか
 * @property {(p: number) => number} cutCost 切り位置pのコスト（実無音=0、句点=0、読点、文節…の順に高くなる）
 * @property {(i: number, j: number) => number} softCost ページ[i,j)の読みやすさコスト（発話時間・文字数の超過）
 */

/** ページ列の不具合（禁止境界・孤立接続詞）を持つ切り目のindex一覧。 */
function boundaryViolations(cuts, ctx) {
  const out = []
  for (let k = 0; k < cuts.length - 1; k++) {
    const [a, p] = cuts[k]
    const reasons = ctx.reasonsAt(p)
    const dangling = ctx.dangling(a, p)
    if (reasons.length > 0 || dangling) out.push({ k, reasons: dangling ? [...reasons, 'dangling-conjunction'] : reasons })
  }
  return out
}

/** 切り目k（cuts[k]とcuts[k+1]の間）を動かす/統合する最良案。無ければ null。 */
function bestFixForBoundary(cuts, k, ctx, o) {
  const [a, p] = cuts[k]
  const b = cuts[k + 1][1]
  let best = null
  const consider = (cand) => {
    if (!best || cand.cost < best.cost) best = cand
  }
  for (let q = Math.max(a + 1, p - o.window); q <= Math.min(b - 1, p + o.window); q++) {
    if (q === p) continue
    if (ctx.reasonsAt(q).length > 0) continue
    if (ctx.dangling(a, q) || !ctx.pageOk(a, q) || !ctx.pageOk(q, b)) continue
    let cost = ctx.cutCost(q) + o.shiftCost * Math.abs(q - p) + ctx.softCost(a, q) + ctx.softCost(q, b)
    if (ctx.isShort(a, q) || ctx.isShort(q, b)) cost += o.shortPenalty
    consider({ kind: 'move', q, cost, shift: q - p })
  }
  if (ctx.pageOk(a, b)) consider({ kind: 'merge', cost: o.mergeCost + ctx.softCost(a, b) })
  return best
}

/** 極端に短いページkの再配分案（前後どちらかとの統合、または隣の切り位置を動かして文字を分ける）。 */
function bestFixForShortPage(cuts, k, ctx, o) {
  const [a, b] = cuts[k]
  let best = null
  const consider = (cand) => {
    if (!best || cand.cost < best.cost) best = cand
  }
  if (k > 0 && ctx.pageOk(cuts[k - 1][0], b)) consider({ kind: 'merge-prev', cost: o.mergeCost + ctx.softCost(cuts[k - 1][0], b) })
  if (k < cuts.length - 1 && ctx.pageOk(a, cuts[k + 1][1])) consider({ kind: 'merge-next', cost: o.mergeCost + ctx.softCost(a, cuts[k + 1][1]) })
  // 左の切り位置（cuts[k-1][1] = a）を左へ動かして、前ページの語句をこのページへ移す
  if (k > 0) {
    const pa = cuts[k - 1][0]
    for (let q = Math.max(pa + 1, a - o.window); q < a; q++) {
      if (ctx.reasonsAt(q).length > 0 || ctx.dangling(pa, q) || !ctx.pageOk(pa, q) || !ctx.pageOk(q, b)) continue
      if (ctx.isShort(pa, q) || ctx.isShort(q, b)) continue
      consider({ kind: 'shift-left-cut', q, cost: ctx.cutCost(q) + o.shiftCost * (a - q) + ctx.softCost(pa, q) + ctx.softCost(q, b) })
    }
  }
  // 右の切り位置（cuts[k][1] = b）を右へ動かして、次ページの語句をこのページへ移す
  if (k < cuts.length - 1) {
    const nb = cuts[k + 1][1]
    for (let q = b + 1; q <= Math.min(nb - 1, b + o.window); q++) {
      if (ctx.reasonsAt(q).length > 0 || ctx.dangling(a, q) || !ctx.pageOk(a, q) || !ctx.pageOk(q, nb)) continue
      if (ctx.isShort(a, q) || ctx.isShort(q, nb)) continue
      consider({ kind: 'shift-right-cut', q, cost: ctx.cutCost(q) + o.shiftCost * (q - b) + ctx.softCost(a, q) + ctx.softCost(q, nb) })
    }
  }
  return best
}

/**
 * 禁止境界と極端に短いページを修正する。
 * @param {Array<[number, number]>} cuts0
 * @param {RepairContext} ctx
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{ cuts: Array<[number, number]>, actions: Array<{ kind: string, reasons: string[], shiftChars: number }>, unresolved: Array<{ cutIndex: number, reasons: string[], kind: string }> }}
 */
export function repairCuts(cuts0, ctx, options = {}) {
  const o = { ...DEFAULTS, ...options }
  let cuts = cuts0.map((c) => [c[0], c[1]])
  const actions = []
  const failed = new Set() // 今回は直せなかった切り位置（無限ループ防止。位置pで識別）

  for (let pass = 0; pass < o.maxPasses; pass++) {
    let progress = false
    // ── 禁止境界 ──
    for (let k = 0; k < cuts.length - 1; k++) {
      const p = cuts[k][1]
      const reasons = ctx.reasonsAt(p)
      const dangling = ctx.dangling(cuts[k][0], p)
      if (reasons.length === 0 && !dangling) continue
      if (failed.has(p)) continue
      const fix = bestFixForBoundary(cuts, k, ctx, o)
      if (!fix) {
        failed.add(p)
        continue
      }
      const why = dangling ? [...reasons, 'dangling-conjunction'] : reasons
      if (fix.kind === 'move') {
        cuts[k] = [cuts[k][0], fix.q]
        cuts[k + 1] = [fix.q, cuts[k + 1][1]]
        actions.push({ kind: 'move-cut', reasons: why, shiftChars: fix.shift })
      } else {
        cuts.splice(k, 2, [cuts[k][0], cuts[k + 1][1]])
        actions.push({ kind: 'merge', reasons: why, shiftChars: 0 })
        k -= 1
      }
      progress = true
    }
    // ── 極端に短いページの再配分 ──
    for (let k = 0; k < cuts.length; k++) {
      if (!ctx.isShort(cuts[k][0], cuts[k][1])) continue
      const fix = bestFixForShortPage(cuts, k, ctx, o)
      if (!fix) continue
      if (fix.kind === 'merge-prev') {
        cuts.splice(k - 1, 2, [cuts[k - 1][0], cuts[k][1]])
        k -= 1
      } else if (fix.kind === 'merge-next') {
        cuts.splice(k, 2, [cuts[k][0], cuts[k + 1][1]])
      } else if (fix.kind === 'shift-left-cut') {
        cuts[k - 1] = [cuts[k - 1][0], fix.q]
        cuts[k] = [fix.q, cuts[k][1]]
      } else {
        cuts[k] = [cuts[k][0], fix.q]
        cuts[k + 1] = [fix.q, cuts[k + 1][1]]
      }
      actions.push({ kind: `short-${fix.kind}`, reasons: ['short-page'], shiftChars: 0 })
      progress = true
    }
    if (!progress) break
  }

  const unresolved = boundaryViolations(cuts, ctx).map((v) => ({ cutIndex: v.k, reasons: v.reasons, kind: 'boundary' }))
  cuts.forEach(([i, j], k) => {
    if (ctx.isShort(i, j)) unresolved.push({ cutIndex: k, reasons: ['short-page'], kind: 'short' })
  })
  return { cuts, actions, unresolved }
}

/**
 * 切り替え頻度を、不自然にならない範囲でだけ下げる（隣接する短いページ同士の統合）。
 * 統合は「同じ文の中で、実無音のない、弱い切れ目（語境界・文節・読点）」に限る。
 * 目標件数に届かなくても、無理に統合しない。
 *
 * @param {Array<[number, number]>} cuts0
 * @param {RepairContext & { gapAt: (p: number) => number, endsSentence: (i: number, j: number) => boolean, speechDur: (i: number, j: number) => number, len: (i: number, j: number) => number }} ctx
 * @param {{ targetCount: number, maxLen?: number, maxSpeechSec?: number, shortSpeechSec?: number, maxCommaGapSec?: number }} p
 */
export function consolidateCuts(cuts0, ctx, p) {
  const maxLen = p.maxLen ?? 20
  const maxSpeechSec = p.maxSpeechSec ?? 2.4
  const shortSpeechSec = p.shortSpeechSec ?? 1.4
  const cuts = cuts0.map((c) => [c[0], c[1]])
  let merged = 0
  while (cuts.length > p.targetCount) {
    let best = null
    for (let k = 0; k < cuts.length - 1; k++) {
      const [a, m] = cuts[k]
      const b = cuts[k + 1][1]
      if (ctx.endsSentence(a, m)) continue // 文の切れ目はまたがない
      if (ctx.gapAt(m) >= 0.15) continue // 発話の間（息継ぎ・無音）の位置は残す
      if (ctx.len(a, b) > maxLen) continue
      if (!ctx.pageOk(a, b)) continue
      const durA = ctx.speechDur(a, m)
      const durB = ctx.speechDur(m, b)
      if (durA >= shortSpeechSec && durB >= shortSpeechSec) continue // 両方が十分な長さなら統合しない
      const dur = ctx.speechDur(a, b)
      if (dur > maxSpeechSec) continue
      const cost = dur + (ctx.reasonsAt(m).length > 0 ? -1 : 0)
      if (!best || cost < best.cost) best = { k, cost }
    }
    if (!best) break
    cuts.splice(best.k, 2, [cuts[best.k][0], cuts[best.k + 1][1]])
    merged += 1
  }
  return { cuts, merged }
}
