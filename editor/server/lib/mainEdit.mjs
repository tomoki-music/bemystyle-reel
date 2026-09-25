// ローカルAIテロップ動画: 編集後の本編（先頭無音カット・確認動画の区間）を、最終動画のタイムラインへ写す。純粋関数のみ。
//
// 元動画時刻の caption / 手動補完caption / トークテーマ を、editTimeMap（同じマップ1つ）で編集後の本編時刻へ、
// さらに本編オフセット（ダイジェストの長さ）を足して最終動画の時刻へ変換する。本文・順序・強調・種別・改行は変えない。

import { buildEditTimeMap, itemsFromCuts, mapCaptions, mapThemes, verifyThemeCoverage, verifyMappedCaptions } from './editTimeMap.mjs'

const r3 = (v) => Math.round(v * 1000) / 1000

/**
 * 先頭カット後の本編（元動画の [cutEndSec, 末尾)）を、映像・音声を同じフレーム数で切れる長さにそろえた編集項目にする。
 * 元動画は約29.9977fpsで30fps格子に載らない。区間の長さを 1/fps の倍数にすると、映像はフレーム数・音声はサンプル数で厳密に切れ、
 * 映像と音声の長さが一致する（端数を残すと映像だけ最大1フレーム長くなる）。末尾の端数（1フレーム未満）だけを切り落とす。
 * @returns {{ items: Array<{ kind: 'seg', srcStartSec: number, srcEndSec: number }>, trimmedTailSec: number }}
 */
export function introCutItems(durationSec, cutEndSec, fps = 30) {
  const startFrame = Math.round(cutEndSec * fps) // カット点は1/fpsの倍数。ミリ秒へ丸めない（映像はフレーム、音声は48kHzのサンプルで厳密に合わせる）
  const frames = Math.floor(durationSec * fps + 1e-6) - startFrame
  const start = startFrame / fps
  const end = (startFrame + frames) / fps
  return { items: [{ kind: 'seg', srcStartSec: start, srcEndSec: end }], trimmedTailSec: r3(durationSec - end) }
}

/** 先頭カット無し（従来どおり本編は元動画の全体）の編集項目。 */
export const fullItems = (durationSec) => itemsFromCuts(durationSec, [])

/**
 * 編集項目（タイムマップ）から、最終動画の時刻の本編caption・手動補完caption・テーマブロック・検証結果を作る。
 * @param {{ items: object[], captions: object[], recovered?: object[], themes: Array<{ id: string, title: string, startSec: number, endSec: number }>, mainOffsetSec: number, strict?: boolean }} p
 *   strict: 残す区間に収まらないcaptionがあればエラー（先頭カット・全編）。確認動画の抜き出しは false（収まらないcaptionを落とす）。
 */
export function mapMainToFinal(p) {
  const tm = buildEditTimeMap(p.items)
  const D = p.mainOffsetSec
  const shift = (c) => ({ ...c, startSec: r3(c.startSec + D), endSec: r3(c.endSec + D) })
  const mapped = mapCaptions(p.captions, tm, { strict: p.strict !== false })
  const recovered = mapCaptions(p.recovered ?? [], tm, { strict: p.strict !== false })
  const mainCaptions = [...recovered, ...mapped].sort((a, b) => a.startSec - b.startSec).map(shift)
  const themesMapped = mapThemes(p.themes, tm)
  // テーマブロック: 区切りカードで分かれる連続区間ごとに1ブロック（カードの間はテーマ箱を出さない）
  const runs = []
  for (const it of tm.items) {
    if (it.kind === 'card') continue
    const last = runs[runs.length - 1]
    if (last && Math.abs(last.endSec - it.editedStartSec) < 1e-3) last.endSec = it.editedEndSec
    else runs.push({ startSec: it.editedStartSec, endSec: it.editedEndSec })
  }
  const themeBlocks = runs.map((r) => ({
    startSec: r3(D + r.startSec),
    endSec: r3(D + r.endSec),
    sections: themesMapped.filter((t) => t.endSec > r.startSec + 1e-3 && t.startSec < r.endSec - 1e-3).map((t) => ({ id: t.id, title: t.title, startSec: r3(D + Math.max(t.startSec, r.startSec)), endSec: r3(D + Math.min(t.endSec, r.endSec)) })),
  }))
  return {
    tm,
    mainCaptions,
    themeBlocks,
    themesMapped,
    verification: {
      captions: p.strict !== false ? verifyMappedCaptions(p.captions, mapped) : null,
      themes: verifyThemeCoverage(themesMapped, tm),
    },
  }
}

/** 本編の中でBGM・LINEオーバーレイ・末尾案内を置く時刻（最終動画の時刻）。 */
export function mainAnchors(timeline) {
  const main = timeline.sections.find((s) => s.kind === 'main')
  const outro = timeline.sections.find((s) => s.kind === 'lineOutro')
  const overlay = (timeline.overlays ?? [])[0] ?? null
  return {
    mainStartSec: main.startSec,
    mainEndSec: main.endSec,
    overlayStartSec: overlay?.startSec ?? null,
    overlayEndSec: overlay?.endSec ?? null,
    outroStartSec: outro?.startSec ?? null,
    bgmStartSec: main.startSec, // 本編BGMは本編の開始から本編の終了まで
    bgmEndSec: main.endSec,
  }
}
