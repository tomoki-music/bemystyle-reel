// ローカルAIテロップ動画: 編集（無音カット・区間の抜き出し・区切りカード）後の本編の「元動画時刻 → 編集後時刻」タイムマップ。純粋関数のみ。
//
// 本編は「項目」の並び:
//   { kind: 'seg', srcStartSec, srcEndSec }   元動画の [start, end) をそのまま残す
//   { kind: 'card', durationSec, label }       確認動画用の短い区切り（元動画の時刻を持たない）
// 映像・音声・caption・トークテーマ・強調・LINEオーバーレイ・本編終了・末尾案内は、すべてこのマップ1つで変換する（別々に計算しない）。
// 時刻はすべて 1/1000 秒に丸める（フレーム境界のカット点は 1/30 秒の倍数なので丸めで壊れない）。

const r3 = (v) => Math.round(v * 1000) / 1000
const EPS = 1e-6

/**
 * @param {Array<{ kind: 'seg', srcStartSec: number, srcEndSec: number } | { kind: 'card', durationSec: number, label?: string }>} items
 * @returns {{ items: object[], segments: object[], totalSec: number, keptSec: number, mapPoint: (t: number) => number | null, mapStart: (t: number) => number | null, mapEnd: (t: number) => number | null, mapCaption: (c: { startSec: number, endSec: number }) => { startSec: number, endSec: number } | null }}
 */
export function buildEditTimeMap(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('編集項目が空です')
  let at = 0
  let prevSrcEnd = -Infinity
  const out = []
  for (const it of items) {
    if (it.kind === 'card') {
      if (!(it.durationSec > 0)) throw new Error('区切りカードの長さが不正です')
      out.push({ ...it, editedStartSec: r3(at), editedEndSec: r3(at + it.durationSec) })
      at += it.durationSec
    } else if (it.kind === 'seg') {
      if (!(it.srcEndSec > it.srcStartSec)) throw new Error('区間の終了は開始より後にしてください')
      if (it.srcStartSec < prevSrcEnd - EPS) throw new Error('区間は元動画の時系列順で、重ならない必要があります')
      out.push({ ...it, editedStartSec: r3(at), editedEndSec: r3(at + (it.srcEndSec - it.srcStartSec)) })
      at += it.srcEndSec - it.srcStartSec
      prevSrcEnd = it.srcEndSec
    } else throw new Error('未知の編集項目です')
  }
  const segments = out.filter((i) => i.kind === 'seg')
  const totalSec = r3(at)
  const keptSec = r3(segments.reduce((a, s) => a + (s.srcEndSec - s.srcStartSec), 0))
  const inSeg = (t) => segments.find((s) => t >= s.srcStartSec - EPS && t <= s.srcEndSec + EPS)
  const edited = (s, t) => r3(s.editedStartSec + (Math.min(Math.max(t, s.srcStartSec), s.srcEndSec) - s.srcStartSec))

  /** 残る時刻ならその編集後時刻。カットされた時刻は null。 */
  const mapPoint = (t) => {
    const s = inSeg(t)
    return s ? edited(s, t) : null
  }
  /** t 以降で最初に残る時刻の編集後時刻（区間の開始を写す）。 */
  const mapStart = (t) => {
    const s = segments.find((x) => t <= x.srcEndSec + EPS)
    return s ? edited(s, Math.max(t, s.srcStartSec)) : null
  }
  /** t 以前で最後に残る時刻の編集後時刻（区間の終了を写す）。 */
  const mapEnd = (t) => {
    for (let i = segments.length - 1; i >= 0; i--) if (t >= segments[i].srcStartSec - EPS) return edited(segments[i], Math.min(t, segments[i].srcEndSec))
    return null
  }
  /** 1つの残る区間に完全に収まるcaptionだけ変換する。またぐ・カット内・残らない場合は null。 */
  const mapCaption = (c) => {
    const s = segments.find((x) => c.startSec >= x.srcStartSec - EPS && c.endSec <= x.srcEndSec + EPS)
    return s ? { startSec: edited(s, c.startSec), endSec: edited(s, c.endSec) } : null
  }
  return { items: out, segments, totalSec, keptSec, mapPoint, mapStart, mapEnd, mapCaption }
}

/** 元動画の [0, durationSec) から、カット（元動画時刻の削除範囲）を除いた残る区間の項目列を作る。 */
export function itemsFromCuts(durationSec, cuts) {
  const sorted = [...cuts].sort((a, b) => a.cutStartSec - b.cutStartSec)
  const items = []
  let at = 0
  for (const c of sorted) {
    if (c.cutStartSec < at - EPS) throw new Error('カットが重なっています')
    if (c.cutEndSec <= c.cutStartSec) throw new Error('カットの終了は開始より後にしてください')
    if (c.cutStartSec > at + EPS) items.push({ kind: 'seg', srcStartSec: r3(at), srcEndSec: r3(c.cutStartSec) })
    at = c.cutEndSec
  }
  if (at < durationSec - EPS) items.push({ kind: 'seg', srcStartSec: r3(at), srcEndSec: r3(durationSec) })
  return items
}

/**
 * captionを編集後の時刻へ変換する。strict: 残る区間に収まらないcaption（カット点をまたぐ・カット内）があればエラー。
 * strict でない場合（確認動画で一部の区間だけ抜き出すとき）は、収まらないcaptionを落とす。本文・順序・強調・種別・改行は変えない。
 */
export function mapCaptions(captions, tm, { strict = false } = {}) {
  const out = []
  for (const c of captions) {
    const m = tm.mapCaption(c)
    if (!m) {
      if (strict) throw new Error('カット点をまたぐ、またはカット内のcaptionがあります')
      continue
    }
    out.push({ ...c, startSec: m.startSec, endSec: m.endSec })
  }
  return out
}

/**
 * トークテーマを編集後の時刻へ変換し、残る区間ごとに区切る。隣り合う同じテーマは1つに結合する（カットで箱を消さない・重複しない）。
 * 区切りカードの区間にはテーマを置かない（隙間はカードの長さだけ）。テーマの順序は変えない。
 * @param {Array<{ id: string, title: string, startSec: number, endSec: number }>} themes 元動画時刻（隙間なし・重複なし）
 */
export function mapThemes(themes, tm) {
  const sorted = [...themes].sort((a, b) => a.startSec - b.startSec)
  const pieces = []
  for (const seg of tm.segments) {
    for (const t of sorted) {
      const a = Math.max(t.startSec, seg.srcStartSec)
      const b = Math.min(t.endSec, seg.srcEndSec)
      if (b - a <= EPS) continue
      pieces.push({ id: t.id, title: t.title, startSec: r3(seg.editedStartSec + (a - seg.srcStartSec)), endSec: r3(seg.editedStartSec + (b - seg.srcStartSec)) })
    }
  }
  const merged = []
  for (const p of pieces) {
    const last = merged[merged.length - 1]
    if (last && last.id === p.id && Math.abs(last.endSec - p.startSec) < 1e-3) last.endSec = p.endSec
    else merged.push({ ...p })
  }
  return merged
}

/** 検証: テーマが編集後の本編を隙間・重複なく覆う（区切りカードの区間を除く）。 */
export function verifyThemeCoverage(mappedThemes, tm) {
  const spans = tm.items.filter((i) => i.kind === 'seg').map((i) => [i.editedStartSec, i.editedEndSec])
  let gapSec = 0
  let overlapSec = 0
  for (const [a, b] of spans) {
    const inside = mappedThemes.filter((t) => t.endSec > a + EPS && t.startSec < b - EPS).sort((x, y) => x.startSec - y.startSec)
    let cur = a
    for (const t of inside) {
      const ts = Math.max(t.startSec, a) // 複数の残る区間にまたがる（結合済みの）テーマは、この区間の範囲で数える
      if (ts > cur + 1e-3) gapSec += ts - cur
      if (ts < cur - 1e-3) overlapSec += cur - ts
      cur = Math.max(cur, Math.min(t.endSec, b))
    }
    if (b > cur + 1e-3) gapSec += b - cur
  }
  const spanSec = spans.reduce((a, [x, y]) => a + (y - x), 0)
  return { coverage: spanSec > 0 ? r3(1 - gapSec / spanSec) : 1, gapSec: r3(gapSec), overlapSec: r3(overlapSec) }
}

/** 検証: 変換後のcaptionが元と同じ本文・順序・強調・種別で、欠落・重複がなく、時刻が単調で重ならない。 */
export function verifyMappedCaptions(original, mapped) {
  const problems = []
  if (original.length !== mapped.length) problems.push(`caption件数が変わりました (${original.length} → ${mapped.length})`)
  const n = Math.min(original.length, mapped.length)
  for (let i = 0; i < n; i++) {
    const a = original[i]
    const b = mapped[i]
    if (a.text !== b.text) problems.push(`本文が変わりました (#${i})`)
    if ((a.emphasisText ?? null) !== (b.emphasisText ?? null)) problems.push(`強調が変わりました (#${i})`)
    if ((a.captionType ?? null) !== (b.captionType ?? null)) problems.push(`種別が変わりました (#${i})`)
    if (JSON.stringify(a.lines ?? null) !== JSON.stringify(b.lines ?? null)) problems.push(`改行が変わりました (#${i})`)
    if (b.endSec < b.startSec) problems.push(`終了が開始より前です (#${i})`)
    if (i > 0 && b.startSec < mapped[i - 1].endSec - 1e-3) problems.push(`captionが重なっています (#${i})`)
  }
  const ids = new Set(mapped.map((c) => c.id))
  if (ids.size !== mapped.length) problems.push('captionのidが重複しています')
  if (original.map((c) => c.text).join('') !== mapped.map((c) => c.text).join('')) problems.push('正本文字の連結が一致しません')
  return { ok: problems.length === 0, problems }
}
