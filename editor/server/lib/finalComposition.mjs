// ローカルAIテロップ動画: 完成動画の構成（冒頭ダイジェスト → LINE案内 → 本編 → 末尾LINE案内）。
//
// 完成動画レンダー時だけ既定でON。短時間プレビューでは追加区間を入れない（resolveCompositionConfig の mode）。
// 純粋関数のみ（ファイル・ffmpegには触れない）。素材の実在確認・レンダーは compositionRender.mjs が担当する。
//
// 時刻の約束:
// - このモジュールの入力（captions / themes）は「元動画の秒」。本編区間は [mainStartSec, mainEndSec)。
// - 最終動画の時刻 = 区間の開始オフセット + (元動画の秒 - 区間の元開始秒)。本編全体は「ダイジェスト+冒頭LINE案内」の長さだけ後ろへずれるが、
//   本編内部のcaption間隔・テーマ切り替え・強調は変えない（同じ秒数だけ移動する）。
// - 元動画・素材は変更しない。トークテーマ/字幕/強調の本文・改行は変更しない。外部AIは呼ばない。

import { STRONG_PUNCT } from './japaneseText.mjs'
import { buildAssContent, getFontFamily, getCaptionStyleDefs, buildDialogueText } from './captionStyles.mjs'
import { getCaptionFitLimits, fitCaptionFontSize } from './captionFit.mjs'
import { escapePathForFfmpegFilter, escapeAssText } from './assText.mjs'
import { estimateTextWidthPx } from './topicAss.mjs'

export const BGM_CREDIT_DEFAULT = Object.freeze({ title: 'The maze of aqua', composer: '蒲鉾さちこ（Kamaboko Sachiko）' })
export const LINE_TEXT_DEFAULT = Object.freeze({
  headline: 'LINEお友だち登録受付中',
  offer: 'お一人様1回\\N無料歌唱診断🎵',
  bonus: 'その他、お得な情報も\\Nお届けします＾＾',
})

/** 既定の構成設定。動画ごとのハードコードにせず、ここを上書きして使う。素材のパスは既定では空（環境設定・UIで指定する）。 */
export const COMPOSITION_DEFAULTS = Object.freeze({
  digest: Object.freeze({
    enabled: true,
    durationSec: 26, // 目安（20〜30秒）
    minSec: 20,
    maxSec: 30,
    clipCount: Object.freeze({ min: 3, max: 5 }),
    clipSec: Object.freeze({ min: 4.5, max: 9 }),
    grayscale: true, // 映像だけ白黒（音声・字幕・テーマ・強調はそのまま）
    bgm: Object.freeze({
      path: '',
      // 線形（1.0=原音）。元のトーク音声が小さい（平均 約-33dB）ため、BGMは声より十分低くする。実測（5分区間の声とduckingしたBGM）:
      // 声が出ている間の 声-BGM の平均 約16dB・最小 約5dB。無音の間はBGMがそのまま聞こえる。
      volume: 0.05,
      duck: true,
      duckThreshold: 0.012,
      duckRatio: 14,
      fadeInSec: 1.2,
      fadeOutSec: 2.0,
      credit: BGM_CREDIT_DEFAULT,
    }),
  }),
  // QR表示は冒頭・末尾ともに既定ON。qr.enabled は全体スイッチ、showQr は区間ごとのスイッチ（どちらかがOFFなら、その区間ではQRを出さない）。
  qr: Object.freeze({ enabled: true }),
  // 冒頭のLINE案内は本編の最初のdurationSec秒へ重ねる（overlay: 動画の長さを増やさず、本編は止めない）。standalone は独立した全画面カード（長さが増える）。
  lineIntro: Object.freeze({ enabled: true, mode: 'overlay', durationSec: 30, showQr: true, startWithMain: true }),
  // 末尾のLINE案内は独立した全画面カード（本編終了後に追加）。
  lineOutro: Object.freeze({ enabled: true, mode: 'standalone', durationSec: 12, showQr: true }),
  line: Object.freeze({ qrPath: '', text: LINE_TEXT_DEFAULT, backgroundColor: '0x161c19' }),
  // プレビュー（短時間の確認動画）では、追加区間を既定で入れない。プレビューでも入れたい機能だけ true にする。
  preview: Object.freeze({ digest: false, lineIntro: false, lineOutro: false }),
  fps: 30,
  sampleRate: 48000,
})

const clone = (o) => JSON.parse(JSON.stringify(o))
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
function deepMerge(base, over) {
  const out = clone(base)
  if (!isObj(over)) return out
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * 構成設定を解決する。mode:'full'（完成動画）は設定どおり、mode:'preview' は preview.* が true の機能だけ有効。
 * @param {object} [overrides]
 * @param {{ mode?: 'full' | 'preview' }} [opts]
 */
export function resolveCompositionConfig(overrides = {}, opts = {}) {
  const cfg = deepMerge(COMPOSITION_DEFAULTS, overrides)
  if ((opts.mode ?? 'full') === 'preview') {
    cfg.digest.enabled = Boolean(cfg.digest.enabled && cfg.preview.digest)
    cfg.lineIntro.enabled = Boolean(cfg.lineIntro.enabled && cfg.preview.lineIntro)
    cfg.lineOutro.enabled = Boolean(cfg.lineOutro.enabled && cfg.preview.lineOutro)
  }
  return cfg
}

/** 設定の妥当性。@returns {{ ok: boolean, errors: string[] }} */
export function validateCompositionConfig(cfg) {
  const errors = []
  const num = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) errors.push(`${name}は${lo}〜${hi}の範囲で指定してください`)
  }
  num(cfg.digest.minSec, 5, 60, 'ダイジェスト最短秒数')
  num(cfg.digest.maxSec, cfg.digest.minSec, 90, 'ダイジェスト最長秒数')
  num(cfg.digest.durationSec, cfg.digest.minSec, cfg.digest.maxSec, 'ダイジェスト秒数')
  num(cfg.digest.bgm.volume, 0, 1, 'BGM音量')
  num(cfg.digest.bgm.fadeInSec, 0, 10, 'BGMフェードイン')
  num(cfg.digest.bgm.fadeOutSec, 0, 10, 'BGMフェードアウト')
  num(cfg.lineIntro.durationSec, 3, 90, '冒頭LINE案内秒数')
  num(cfg.lineOutro.durationSec, 3, 60, '末尾LINE案内秒数')
  if (!['overlay', 'standalone'].includes(cfg.lineIntro.mode)) errors.push('冒頭LINE案内の表示方式は overlay か standalone を指定してください')
  if (cfg.lineOutro.mode !== 'standalone') errors.push('末尾LINE案内の表示方式は standalone のみ対応しています')
  if (cfg.lineIntro.mode === 'overlay' && cfg.lineIntro.startWithMain !== true) errors.push('冒頭LINE案内(overlay)は本編開始と同時に始めてください')
  return { ok: errors.length === 0, errors }
}

export const QR_MISSING_MESSAGE = 'LINE QR画像が見つかりません。QR画像の設定を確認してください。'

/**
 * QRを表示するLINE案内区間（最終動画の時刻）。qr.enabled・区間のenabled・区間のshowQr がすべてtrueの区間だけ。
 * 冒頭(overlay)は timeline.overlays、末尾(standalone)は timeline.sections から取る。表示時間はLINE案内の開始〜終了と同一（途中で消さない）。
 * @returns {Array<{ kind: 'lineIntro' | 'lineOutro', mode: 'overlay' | 'standalone', startSec: number, endSec: number }>}
 */
export function planQrWindows(cfg, timeline) {
  if (!cfg.qr?.enabled) return []
  const wins = [
    ...timeline.sections.filter((s) => s.kind === 'lineIntro' || s.kind === 'lineOutro').map((s) => ({ kind: s.kind, mode: 'standalone', startSec: s.startSec, endSec: s.endSec })),
    ...(timeline.overlays ?? []).map((o) => ({ kind: o.kind, mode: 'overlay', startSec: o.startSec, endSec: o.endSec })),
  ]
  return wins.filter((w) => cfg[w.kind].enabled && cfg[w.kind].showQr).sort((a, b) => a.startSec - b.startSec)
}

/** 区間（enabled）にQRを出す設定か（素材の要否の判定用。タイムライン不要）。 */
export const sectionShowsQr = (cfg, kind) => Boolean(cfg.qr?.enabled && cfg[kind].enabled && cfg[kind].showQr)

// ────────────────────────────────────────────────────────────────
// ダイジェストの見どころ選定（ローカルの決定的なルール。AIは使わない）
// ────────────────────────────────────────────────────────────────

const CUE_RE = /ポイント|大事|重要|絶対|一番|結論|コツ|ヒント|違い|決断|スタンス|距離/
const OPENER_RE = /^(で、|ということで|それで|なので|あと|それから)/
const isSentenceEnd = (t) => STRONG_PUNCT.has(t[t.length - 1])

/**
 * 本編から見どころを3〜5か所選ぶ。
 * - 開始は文の頭、終了は文の終わり（語・文の途中から始めない/終わらない）。0.6秒以上の無音をまたがない。
 * - 1クリップは clipSec.min〜max 秒。同じ箇所（重なり・近接）を重複使用しない。
 * - 部分強調・結論を示す語を含む箇所を高く評価し、まずテーマごとに1つ、その後に不足分を追加する。
 * - 合計が minSec〜maxSec に収まるようにし、時系列順に並べる。
 *
 * @param {{ captions: Array<{ startSec: number, endSec: number, text: string, emphasisText?: string | null }>,
 *           themes?: Array<{ id: string, startSec: number, endSec: number }>, config: typeof COMPOSITION_DEFAULTS['digest'],
 *           rangeStartSec?: number, rangeEndSec?: number }} p
 * @returns {{ clips: Array<{ firstIndex: number, lastIndex: number, srcStartSec: number, srcEndSec: number, durationSec: number, themeId: string | null, score: number }>, totalSec: number, reasons: string[] }}
 */
export function selectDigestClips(p) {
  const { captions, config } = p
  const themes = p.themes ?? []
  const lo = p.rangeStartSec ?? -Infinity
  const hi = p.rangeEndSec ?? Infinity
  const reasons = []
  const cands = []
  for (let i = 0; i < captions.length; i++) {
    if (captions[i].startSec < lo) continue
    if (!(i === 0 || isSentenceEnd(captions[i - 1].text))) continue
    for (let j = i; j < captions.length; j++) {
      if (captions[j].endSec > hi) break
      if (j > i && captions[j].startSec - captions[j - 1].endSec > 0.6) break // 0.6秒以上の無音をまたがない
      const dur = captions[j].endSec - captions[i].startSec + 0.25 // 前後の余白（開始-0.1秒・終了+0.15秒）を含む長さ
      if (dur > config.clipSec.max) break
      if (!isSentenceEnd(captions[j].text) || dur < config.clipSec.min) continue
      const slice = captions.slice(i, j + 1)
      const emph = slice.filter((c) => c.emphasisText).length
      const cues = slice.filter((c) => CUE_RE.test(c.text)).length
      let score = emph * 3 + cues * 1.5
      if (OPENER_RE.test(captions[i].text)) score -= 2
      score += Math.min(1, dur / config.clipSec.max) * 0.5
      const themeId = themes.find((t) => captions[i].startSec >= t.startSec && captions[i].startSec < t.endSec)?.id ?? null
      cands.push({ firstIndex: i, lastIndex: j, dur, score, themeId })
    }
  }
  cands.sort((a, b) => b.score - a.score || a.firstIndex - b.firstIndex)
  const chosen = []
  const conflicts = (c) => chosen.some((x) => !(c.lastIndex + 1 < x.firstIndex - 2 || x.lastIndex + 1 < c.firstIndex - 2) || Math.abs(captions[c.firstIndex].startSec - captions[x.firstIndex].startSec) < config.clipSec.max + 3)
  const total = () => chosen.reduce((a, c) => a + c.dur, 0)
  const tryAdd = (c) => {
    if (chosen.length >= config.clipCount.max || conflicts(c) || total() + c.dur > config.maxSec) return false
    chosen.push(c)
    return true
  }
  // 1) テーマごとに最良の1件（テーマを偏らせない）
  const seenThemes = new Set()
  for (const c of cands) {
    if (chosen.length >= config.clipCount.max || total() >= config.durationSec) break
    if (seenThemes.has(c.themeId)) continue
    if (tryAdd(c)) seenThemes.add(c.themeId)
  }
  // 2) 不足分（クリップ数・秒数）を評価順に追加
  for (const c of cands) {
    if (chosen.length >= config.clipCount.min && total() >= config.durationSec) break
    tryAdd(c)
  }
  if (chosen.length < config.clipCount.min) reasons.push('見どころの候補が不足しています')
  if (total() < config.minSec) reasons.push('ダイジェストの合計秒数が下限に届きません')
  chosen.sort((a, b) => a.firstIndex - b.firstIndex)
  const clips = chosen.map((c) => {
    const first = captions[c.firstIndex]
    const last = captions[c.lastIndex]
    const prevEnd = c.firstIndex > 0 ? captions[c.firstIndex - 1].endSec : -Infinity
    const nextStart = c.lastIndex + 1 < captions.length ? captions[c.lastIndex + 1].startSec : Infinity
    const srcStartSec = Math.max(prevEnd, first.startSec - 0.1)
    const srcEndSec = Math.min(nextStart, last.endSec + 0.15)
    return { firstIndex: c.firstIndex, lastIndex: c.lastIndex, srcStartSec, srcEndSec, durationSec: srcEndSec - srcStartSec, themeId: c.themeId, score: Math.round(c.score * 10) / 10 }
  })
  return { clips, totalSec: clips.reduce((a, c) => a + c.durationSec, 0), reasons }
}

// ────────────────────────────────────────────────────────────────
// タイムライン（区間の順序と、本編のオフセット）
// ────────────────────────────────────────────────────────────────

/**
 * 区間構成: digest → (standaloneの冒頭LINE案内) → main → lineOutro（有効なものだけ）。
 * 冒頭LINE案内が overlay のときは独立した区間を作らず、本編の最初のdurationSec秒（本編長まで）へ重ねる overlays に入れる。
 * 本編のオフセット = ダイジェスト長（standaloneのときだけ、さらに冒頭案内の長さ）。全体の長さに overlay の秒数は加算しない。
 * @param {ReturnType<typeof resolveCompositionConfig>} cfg
 * @param {{ mainStartSec: number, mainEndSec: number, digestClips?: Array<{ durationSec: number }> }} p
 * @returns {{ sections: Array<{ kind: 'digest' | 'lineIntro' | 'main' | 'lineOutro', startSec: number, endSec: number }>, overlays: Array<{ kind: 'lineIntro', startSec: number, endSec: number }>, mainOffsetSec: number, totalSec: number, digestSec: number }}
 */
export function planTimeline(cfg, p) {
  const sections = []
  const overlays = []
  let t = 0
  const digestSec = cfg.digest.enabled ? (p.digestClips ?? []).reduce((a, c) => a + c.durationSec, 0) : 0
  const push = (kind, len) => {
    sections.push({ kind, startSec: round3(t), endSec: round3(t + len) })
    t += len
  }
  if (cfg.digest.enabled && digestSec > 0) push('digest', digestSec)
  if (cfg.lineIntro.enabled && cfg.lineIntro.mode === 'standalone') push('lineIntro', cfg.lineIntro.durationSec)
  const mainOffsetSec = t
  const mainSec = p.mainEndSec - p.mainStartSec
  push('main', mainSec)
  if (cfg.lineIntro.enabled && cfg.lineIntro.mode !== 'standalone') {
    overlays.push({ kind: 'lineIntro', startSec: round3(mainOffsetSec), endSec: round3(mainOffsetSec + Math.min(cfg.lineIntro.durationSec, mainSec)) })
  }
  if (cfg.lineOutro.enabled) push('lineOutro', cfg.lineOutro.durationSec)
  return { sections, overlays, mainOffsetSec: round3(mainOffsetSec), totalSec: round3(t), digestSec: round3(digestSec) }
}
const round3 = (v) => Math.round(v * 1000) / 1000

/** 元動画の秒 → 最終動画の秒（本編）。 */
export const mainToFinal = (srcSec, mainStartSec, mainOffsetSec) => srcSec - mainStartSec + mainOffsetSec

/** 本編に含まれるcaptionだけを、最終動画の時刻へ同じ秒数だけ移動する（本文・改行・強調・相対時刻は変えない）。 */
export function shiftMainCaptions(captions, mainStartSec, mainEndSec, mainOffsetSec) {
  return captions
    .filter((c) => c.startSec >= mainStartSec - 1e-6 && c.endSec <= mainEndSec + 1e-6)
    .map((c) => ({ ...c, startSec: round3(mainToFinal(c.startSec, mainStartSec, mainOffsetSec)), endSec: round3(mainToFinal(c.endSec, mainStartSec, mainOffsetSec)) }))
}

/** ダイジェストのcaption（クリップごとに、クリップ先頭を基準に配置。クリップ内の相対時刻は変えない）。 */
export function digestCaptions(captions, clips) {
  const out = []
  let offset = 0
  for (const clip of clips) {
    for (let i = clip.firstIndex; i <= clip.lastIndex; i++) {
      const c = captions[i]
      out.push({ ...c, startSec: round3(offset + (c.startSec - clip.srcStartSec)), endSec: round3(offset + (c.endSec - clip.srcStartSec)) })
    }
    offset += clip.durationSec
  }
  return out
}

/**
 * 本編のテーマを、最終動画の時刻の「区間ブロック」にする。本編範囲を隙間なく被覆する（テーマ間で箱を消さない）。
 * テーマが無い範囲は含めない（根拠のない名称を作らない）。
 */
export function mainThemeBlock(themes, mainStartSec, mainEndSec, mainOffsetSec) {
  const sections = themes
    .filter((t) => t.endSec > mainStartSec && t.startSec < mainEndSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((t, i, arr) => ({
      id: t.id,
      title: t.title,
      startSec: round3(mainToFinal(i === 0 ? mainStartSec : Math.max(t.startSec, mainStartSec), mainStartSec, mainOffsetSec)),
      endSec: round3(mainToFinal(i === arr.length - 1 ? mainEndSec : Math.min(arr[i + 1].startSec, mainEndSec), mainStartSec, mainOffsetSec)),
    }))
  return { startSec: round3(mainOffsetSec), endSec: round3(mainOffsetSec + (mainEndSec - mainStartSec)), sections }
}

/**
 * ダイジェスト区間のテーマブロック。各クリップに対応するテーマ名へ差し替える（常時表示）。テーマが無いクリップは含めず、
 * 連続してテーマがあるクリップごとにブロックを分ける。@returns {{ blocks: object[], clipsWithoutTheme: number }}
 */
export function digestThemeBlocks(themes, clips, captions) {
  const blocks = []
  let offset = 0
  let cur = null
  let missing = 0
  for (const clip of clips) {
    const t = themes.find((x) => captions[clip.firstIndex].startSec >= x.startSec && captions[clip.firstIndex].startSec < x.endSec)
    const a = round3(offset)
    const b = round3(offset + clip.durationSec)
    if (!t) {
      missing++
      cur = null
    } else if (cur) {
      const last = cur.sections[cur.sections.length - 1]
      cur.endSec = b
      if (last.id === t.id) last.endSec = b
      else cur.sections.push({ id: `${t.id}#${clip.firstIndex}`, title: t.title, startSec: a, endSec: b })
    } else {
      cur = { startSec: a, endSec: b, sections: [{ id: `${t.id}#${clip.firstIndex}`, title: t.title, startSec: a, endSec: b }] }
      blocks.push(cur)
    }
    offset += clip.durationSec
  }
  return { blocks, clipsWithoutTheme: missing }
}

// ────────────────────────────────────────────────────────────────
// LINE案内（レイアウト・ASS）
// ────────────────────────────────────────────────────────────────

const QR_FRAME_PX = 3 // QRカードの外側に付ける薄い枠（quiet zoneの外側。QR本体には触れない）

/**
 * QRの表示レイアウト（すべて画面内・テキストと重ならない）。
 * 元画像の縦横比を維持したまま、一辺が height*0.52 の正方形の枠に収める（引き伸ばさない）。
 * 周囲に白いquiet zone（長辺の8%）を付け、その外側に薄い枠を付ける。imgWidth/imgHeight が無いときは枠いっぱい（最大占有領域）。
 * @returns {{ innerW: number, innerH: number, inner: number, quiet: number, frame: number, totalW: number, totalH: number, total: number, x: number, y: number, marginX: number }}
 */
export function qrLayout(width, height, imgWidth, imgHeight, opts = {}) {
  const box = opts.box ?? Math.round(height * 0.52)
  const a = imgWidth > 0 && imgHeight > 0 ? imgWidth / imgHeight : 1
  const innerW = a >= 1 ? box : Math.round(box * a)
  const innerH = a >= 1 ? Math.round(box / a) : box
  const quiet = Math.round(box * 0.08) // 白いquiet zone
  const frame = QR_FRAME_PX
  const totalW = innerW + (quiet + frame) * 2
  const totalH = innerH + (quiet + frame) * 2
  const marginX = Math.round(width * 0.05)
  const x = width - marginX - totalW
  const y = Math.round((height - totalH) / 2)
  return { innerW, innerH, inner: box, quiet, frame, totalW, totalH, total: Math.max(totalW, totalH), x, y, marginX }
}

const ASS_WHITE = '&H00FFFFFF&'
const ASS_BLACK = '&H00000000&'
const ASS_AMBER = '&H004AB3F0&'
/** libass はカラー絵文字を描画できない（豆腐になる）ため、描画時だけ、同じ意味の文字グリフへ置き換える。設定上の文言は変えない。 */
export const RENDER_GLYPH_SUBSTITUTIONS = Object.freeze({ '🎵': '♫' })
const forRender = (t) => Object.entries(RENDER_GLYPH_SUBSTITUTIONS).reduce((a, [k, v]) => a.split(k).join(v), t)
export const LINE_STYLE_HEAD = 'LineHead'
export const LINE_STYLE_BODY = 'LineBody'

export function buildLineStyleLines(width, height) {
  const fontFamily = getFontFamily()
  const short = Math.min(width, height)
  const head = Math.round(short * (84 / 1080))
  const body = Math.round(short * (80 / 1080))
  const row = (name, size, colour) => `Style: ${[name, fontFamily, size, colour, ASS_BLACK, ASS_BLACK, '&H80000000&', 1, 0, 0, 0, 100, 100, 1, 0, 1, 4, 0, 7, 0, 0, 0, 1].join(',')}`
  return { lines: [row(LINE_STYLE_HEAD, head, ASS_WHITE), row(LINE_STYLE_BODY, body, ASS_WHITE)], headSize: head, bodySize: body }
}

const assTime = (sec) => {
  const total = Math.round(Math.max(0, sec) * 100)
  const cs = total % 100
  const s = Math.floor(total / 100)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}.${p2(cs)}`
}

/**
 * LINE案内のテキストの位置と大きさ（推定）。QRがあるときは左側の領域だけを使い、QRと重ならない。
 * @returns {{ items: Array<{ key: string, text: string, x: number, y: number, size: number, style: string, widthPx: number, heightPx: number }>, textRight: number }}
 */
export function lineTextLayout(width, height, text, withQr) {
  const { headSize, bodySize } = buildLineStyleLines(width, height)
  const q = qrLayout(width, height)
  const marginX = q.marginX
  const linesOf = (s) => s.split('\\N')
  const measure = (s, size) => Math.max(...linesOf(s).map((l) => estimateTextWidthPx(l, size)))
  const blocks = [
    { key: 'headline', text: text.headline, size: headSize, style: LINE_STYLE_HEAD },
    { key: 'offer', text: text.offer, size: bodySize, style: LINE_STYLE_BODY },
    { key: 'bonus', text: text.bonus, size: bodySize, style: LINE_STYLE_BODY },
  ]
  const gap = Math.round(height * 0.05)
  const heights = blocks.map((b) => linesOf(b.text).length * b.size * 1.05)
  const totalH = heights.reduce((a, b) => a + b, 0) + gap * (blocks.length - 1)
  let y = Math.round((height - totalH) / 2)
  const items = blocks.map((b, i) => {
    const widthPx = Math.round(measure(forRender(b.text), b.size))
    const x = withQr ? marginX : Math.round(width / 2) // QRなしは中央揃え（\an8 + 中心x）
    const item = { ...b, x, y, widthPx, heightPx: Math.round(heights[i]) }
    y += heights[i] + gap
    return item
  })
  return { items, textRight: Math.max(...items.map((i) => i.x + i.widthPx)) }
}

// ────────────────────────────────────────────────────────────────
// 冒頭LINE案内（overlay）: 本編の上へ重ねるコンパクトなパネル。本編の顔・左上のテーマ・下部の字幕と重ならない右側の領域に置く。
// ────────────────────────────────────────────────────────────────

/** 本編の被写体・既存の字幕/テーマを避けるための予約領域（画面に対する比率）。パネルはこの外に置く。 */
export const OVERLAY_SAFE = Object.freeze({
  faceRightRatio: 0.7, // 人物（髪・顔）は画面中央〜これより左。パネルの左端はこの右側
  captionTopRatio: 0.66, // 下部の字幕（最大2行）はこれより下。パネルの下端はこの上
  themeRightRatio: 0.47, // 左上のトークテーマの最大右端（TOPIC_BOX_MAX_RIGHT_RATIO）
})
const LINE_GREEN = '&H55C706&' // LINEの緑 #06C755（ASSのBGR）
const PANEL_ALPHA = '&H50&' // 約69%不透明の黒（既存のテーマ箱と同じ。本編が透けて見える）
export const LINE_OVERLAY_STAGES_SEC = Object.freeze([0, 5, 10]) // 見出し（最初のフレームから）→ 特典 → その他。QRは段階に関係なく常時表示

/**
 * オーバーレイパネルのレイアウト（1080p基準の値を高さ比でスケール）。パネル内は 見出し → QR → 特典 → その他 の縦並び。
 * @returns {{ panel: {x,y,w,h}, accent: {x,y,w,h}, items: Array<{key,text,cx,y,size,style,widthPx,heightPx}>, qr: null | ReturnType<typeof qrLayout>, innerW: number }}
 */
export function overlayPanelLayout(width, height, text, withQr, imgWidth, imgHeight) {
  const k = height / 1080
  const r = (v) => Math.round(v * k)
  const panelW = r(500)
  const pad = r(22)
  const headSize = r(48)
  const bodySize = r(42)
  const lineH = (size, n) => Math.round(size * 1.1 * n)
  const panelX = width - Math.round(width * 0.02) - panelW
  const panelY = r(20)
  const q = withQr ? qrLayout(width, height, imgWidth, imgHeight, { box: r(330) }) : null
  const linesOf = (t) => t.split('\\N')
  const measure = (t, size) => Math.round(Math.max(...linesOf(forRender(t)).map((l) => estimateTextWidthPx(l, size))))
  const cx = panelX + Math.round(panelW / 2)
  let y = panelY + pad
  const items = []
  const addText = (key, t, size, style) => {
    const h = lineH(size, linesOf(t).length)
    items.push({ key, text: t, cx, y, size, style, widthPx: measure(t, size), heightPx: h })
    y += h
  }
  addText('headline', text.headline, headSize, LINE_STYLE_HEAD)
  let qr = null
  if (q) {
    y += r(12)
    qr = { ...q, x: panelX + Math.round((panelW - q.totalW) / 2), y }
    y += q.totalH + r(14)
  } else y += r(10)
  addText('offer', text.offer, bodySize, LINE_STYLE_BODY)
  y += r(8)
  addText('bonus', text.bonus, bodySize, LINE_STYLE_BODY)
  const panelH = y + pad - panelY
  return { panel: { x: panelX, y: panelY, w: panelW, h: panelH }, accent: { x: panelX, y: panelY, w: r(8), h: panelH }, items, qr, innerW: panelW - pad * 2 }
}

/** 冒頭LINE案内（overlay）のDialogue。パネル・緑のアクセントは開始フレームから終了まで。見出しも開始フレームから。特典・その他は段階的にフェードイン（QRはASSではなくffmpegで常時表示）。 */
export function buildLineOverlayEvents(width, height, text, overlay, withQr, imgWidth, imgHeight) {
  const L = overlayPanelLayout(width, height, text, withQr, imgWidth, imgHeight)
  const start = assTime(overlay.startSec)
  const end = assTime(overlay.endSec)
  const dur = overlay.endSec - overlay.startSec
  const amberBgr = ASS_AMBER.replace(/&H\d{2}/, '&H')
  const rect = (r) => `m 0 0 l ${r.w} 0 ${r.w} ${r.h} 0 ${r.h}`
  const draw = (layer, r, colour, alpha) => `Dialogue: ${layer},${start},${end},${LINE_STYLE_BODY},,0,0,0,,{\\an7\\pos(${r.x},${r.y})\\p1\\bord0\\shad0\\1c${colour}\\1a${alpha}}${rect(r)}{\\p0}`
  const events = [draw(19, L.panel, '&H000000&', PANEL_ALPHA), draw(19, L.accent, LINE_GREEN, '&H00&')]
  L.items.forEach((it, i) => {
    const at = overlay.startSec + Math.min(LINE_OVERLAY_STAGES_SEC[i] ?? 0, Math.max(0, dur - 1))
    const body = forRender(it.text)
      .split('\\N')
      .map((l) => escapeAssText(l).replace('無料歌唱診断', `{\\1c${amberBgr}}無料歌唱診断{\\1c&HFFFFFF&}`))
      .join('\\N')
    const fade = i === 0 ? '' : '\\fad(400,0)' // 見出しは開始フレームから（フェードなし）
    events.push(`Dialogue: 20,${assTime(at)},${end},${it.style},,0,0,0,,{\\an8\\pos(${it.cx},${it.y})\\fs${it.size}\\bord2${fade}}${body}`)
  })
  return events
}

/** LINE案内区間のDialogue。段階表示（見出し → 特典 → その他）で、派手な動きは使わずフェードインだけ。 */
export function buildLineEvents(width, height, text, section, withQr, stages) {
  const layout = lineTextLayout(width, height, text, withQr)
  const dur = section.endSec - section.startSec
  const amberBgr = ASS_AMBER.replace(/&H\d{2}/, '&H') // &HBBGGRR&
  return layout.items.map((it, i) => {
    const at = section.startSec + stages[i] * dur
    // 特典行の「無料歌唱診断」だけ琥珀色（強調色）。他は白文字＋黒縁
    const body = forRender(it.text)
      .split('\\N')
      .map((l) => escapeAssText(l).replace('無料歌唱診断', `{\\1c${amberBgr}}無料歌唱診断{\\1c&HFFFFFF&}`))
      .join('\\N')
    return `Dialogue: 20,${assTime(at)},${assTime(section.endSec)},${it.style},,0,0,0,,{\\${withQr ? 'an7' : 'an8'}\\pos(${it.x},${it.y})\\fad(500,0)}${body}`
  })
}

/** ダイジェスト内の字幕は、本編の通常字幕より少し大きくする（約9%）。白文字・黒縁・下部中央の基本デザインは同じ。 */
export const DIGEST_CAPTION_SIZE_RATIO = 1.09

/**
 * ダイジェスト用の字幕サイズ（px）。基本は本編の通常字幕の約1.09倍。長い行で幅に収まらない場合だけ段階的に下げるが、本編の通常字幕未満にはしない。
 * @returns {Array<{ size: number, baseSize: number, mainSize: number, fits: boolean }>}
 */
export function planDigestCaptionSizes(width, height, caps) {
  const normal = getCaptionStyleDefs(width, height).normal.fontsize
  const limits = getCaptionFitLimits(width, height)
  const base = Math.round(normal * DIGEST_CAPTION_SIZE_RATIO)
  return caps.map((c) => {
    const lines = Array.isArray(c.lines) && c.lines.length > 1 && c.lines.join('') === c.text ? c.lines : [c.text]
    const fit = fitCaptionFontSize({ lines, baseSize: base, minSize: normal, maxWidthPx: limits.maxWidthPx, ladderPx: [Math.round(normal * 1.06), Math.round(normal * 1.03), normal] })
    return { size: fit.size, baseSize: base, mainSize: normal, fits: fit.fits }
  })
}

/** ダイジェスト字幕のDialogue（強調はcaptionのemphasisText＝1クリップ最大1か所を琥珀色で部分強調）。 */
export function buildDigestCaptionEvents(width, height, caps) {
  const defs = getCaptionStyleDefs(width, height).normal
  const sizes = planDigestCaptionSizes(width, height, caps)
  return caps.map((c, i) => `Dialogue: 0,${assTime(c.startSec)},${assTime(c.endSec)},${defs.name},,0,0,0,,${buildDialogueText(c, defs.highlightColour, sizes[i].size)}`)
}

/**
 * 最終動画全体のASS。字幕・テーマ・強調は最終動画の時刻へ配置済みのものを渡す。LINE案内区間にはテーマも本編字幕も重ねない。
 * digestStyle: 'strong' のとき、ダイジェストの字幕は本編より少し大きく（部分強調つき）描画する。extraEvents: 区切りカードの文字など。
 */
export function buildFinalAss({ width, height, cfg, timeline, mainCaptions, digestCaps, themeBlocks, qrSize, digestStyle, extraEvents: more }) {
  const line = buildLineStyleLines(width, height)
  const extraEvents = []
  for (const s of timeline.sections) {
    if (s.kind === 'lineIntro') extraEvents.push(...buildLineEvents(width, height, cfg.line.text, s, sectionShowsQr(cfg, 'lineIntro'), [0, 0.33, 0.66]))
    if (s.kind === 'lineOutro') extraEvents.push(...buildLineEvents(width, height, cfg.line.text, s, sectionShowsQr(cfg, 'lineOutro'), [0, 0.1, 0.2]))
  }
  for (const o of timeline.overlays ?? []) {
    if (o.kind === 'lineIntro') extraEvents.push(...buildLineOverlayEvents(width, height, cfg.line.text, o, sectionShowsQr(cfg, 'lineIntro'), qrSize?.width, qrSize?.height))
  }
  if (digestStyle === 'strong') extraEvents.push(...buildDigestCaptionEvents(width, height, digestCaps))
  if (Array.isArray(more)) extraEvents.push(...more)
  return buildAssContent({ width, height, captions: digestStyle === 'strong' ? [...mainCaptions] : [...digestCaps, ...mainCaptions] }, { topicBlocks: themeBlocks, topicAccentMode: 'label', extraStyleLines: line.lines, extraEvents })
}

// ────────────────────────────────────────────────────────────────
// ffmpeg（spawn argv配列。shell展開しない）
// ────────────────────────────────────────────────────────────────

/** QR1区間の配置。overlay はパネル内、standalone は全画面カードの右側。 */
export function planQrPlacement(win, width, height, qrSize, cfg) {
  if (win.mode === 'overlay') return overlayPanelLayout(width, height, cfg.line.text, true, qrSize?.width, qrSize?.height).qr
  return qrLayout(width, height, qrSize?.width, qrSize?.height)
}

/**
 * 構成動画1本を書き出すffmpeg引数。ダイジェストの映像だけを白黒（クリップごとのフィルタチェーンに閉じ込め、他区間へ漏らさない）にし、
 * その後で字幕・テーマ（カラー）を焼き込み、最後にQRを重ねる（QRには白黒・字幕を適用しない）。
 *
 * @param {{
 *   cfg: ReturnType<typeof resolveCompositionConfig>, timeline: ReturnType<typeof planTimeline>, width: number, height: number,
 *   sourcePath: string, mainStartSec: number, mainEndSec: number, digestClips: Array<{ srcStartSec: number, durationSec: number }>,
 *   bgmPath?: string, qrPath?: string, qrSize?: { width: number, height: number }, assPath: string, outputPath: string,
 * }} p
 * @returns {{ args: string[], filterComplex: string }}
 */
export function buildCompositionArgs(p) {
  const { cfg, timeline, width, height } = p
  const F = cfg.fps
  const SR = cfg.sampleRate
  const args = ['-y', '-hide_banner', '-nostats']
  let idx = 0
  const digestOn = timeline.sections.some((s) => s.kind === 'digest')
  const intro = timeline.sections.find((s) => s.kind === 'lineIntro')
  const outro = timeline.sections.find((s) => s.kind === 'lineOutro')
  const chain = []
  const concatIn = []
  const fmtV = `scale=${width}:${height}:flags=bicubic,setsar=1,fps=${F},format=yuv420p`
  const fmtA = `aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo`
  // 元動画の音声トラックが映像より遅れて始まる場合（例: 音声の開始が映像より0.067秒後）、PTS-STARTPTS で先頭を詰めると音声だけが
  // 早く聞こえる。映像と同じ起点（0秒）に合わせるため、先頭を無音で埋める（first_pts=0）。ダイジェストのクリップ・本編の音声に使う。
  const fmtAV = `aresample=${SR}:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo`
  // 区間の長さが 1/fps の倍数（フレーム境界）のときは、フレーム数・サンプル数で厳密に切る（ミリ秒への丸めで1フレーム増減しない）。
  const frameExact = (d) => {
    const n = Math.round(d * F)
    return Math.abs(n / F - d) < 0.0015 ? n : null
  }
  const vTrim = (d) => (frameExact(d) !== null ? `trim=end_frame=${frameExact(d)}` : `trim=0:${round3(d)}`)
  const aTrim = (d) => (frameExact(d) !== null ? `atrim=end_sample=${Math.round((frameExact(d) / F) * SR)}` : `atrim=0:${round3(d)}`)
  const JOIN_FADE = 0.02 // 編集点（カット・区間のつなぎ）の音声の短いフェード（クリックノイズ防止。重ねないので長さは変わらない）
  const HALF = round3(0.5 / F) // 半フレーム
  /**
   * 元動画の [a, a+d) を、映像・音声をそろえて取り出す入力引数とフィルタ（a・d はフレーム境界）。
   * 元動画の映像フレームは 1/30 秒の格子に載っていない（約29.9977fps）ため、-ss a ちょうどだと「a 以降で最初のフレーム」から始まり、
   * 最大1フレーム遅れたフレームが先頭になって、音声（サンプル精度で a から）より映像が早く見える。
   * そこで半フレーム手前からシークし、映像は時刻で a に合わせ（最も近いフレームを選ぶ）、音声は半フレーム分をサンプル数で切り落とす。
   * a=0 は従来どおり（音声起点の補正 first_pts=0 が先頭を無音で埋める）。
   * @returns {{ input: string[], v: string, a: string }}
   */
  const alignedSegment = (a, d) => {
    const n = frameExact(d)
    if (n === null || !(a > HALF)) {
      return { input: ['-ss', String(round3(a)), '-t', String(round3(d + 0.1))], v: `${vTrim(d)},setpts=PTS-STARTPTS,${fmtV}`, a: `${fmtAV},${aTrim(d)},asetpts=PTS-STARTPTS` }
    }
    const skip = Math.round(HALF * SR)
    const total = Math.round((n / F) * SR)
    return {
      input: ['-ss', String(Math.round((a - HALF) * 1e5) / 1e5), '-t', String(round3(d + 0.1 + HALF))],
      v: `trim=start=${HALF},setpts=PTS-${HALF}/TB,scale=${width}:${height}:flags=bicubic,setsar=1,fps=${F}:start_time=0,trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p`,
      a: `${fmtAV},atrim=start_sample=${skip}:end_sample=${skip + total},asetpts=PTS-STARTPTS`,
    }
  }

  if (digestOn) {
    const D = timeline.digestSec
    const clipIdx = []
    const clipSeg = p.digestClips.map((c) => alignedSegment(c.srcStartSec, c.durationSec))
    p.digestClips.forEach((c, k) => {
      // 従来と同じ入力（-ss a -t d）。フレーム境界の区間だけ、半フレーム手前からシークして映像と音声をそろえる
      const aligned = frameExact(c.durationSec) !== null && c.srcStartSec > HALF
      args.push(...(aligned ? clipSeg[k].input : ['-ss', String(round3(c.srcStartSec)), '-t', String(round3(c.durationSec))]), '-i', p.sourcePath)
      clipIdx.push(idx++)
    })
    const vs = []
    const as = []
    p.digestClips.forEach((c, k) => {
      const n = clipIdx[k]
      const d = round3(c.durationSec)
      const gray = cfg.digest.grayscale ? ',hue=s=0' : ''
      const seg = clipSeg[k]
      const aligned = frameExact(c.durationSec) !== null && c.srcStartSec > HALF
      chain.push(`[${n}:v]${aligned ? seg.v : `${vTrim(c.durationSec)},setpts=PTS-STARTPTS,${fmtV}`}${gray}[dv${k}]`)
      chain.push(`[${n}:a]${aligned ? seg.a : `${fmtAV},${aTrim(c.durationSec)},asetpts=PTS-STARTPTS`},afade=t=in:st=0:d=0.04,afade=t=out:st=${round3(Math.max(0, d - 0.04))}:d=0.04[da${k}]`)
      vs.push(`[dv${k}]`)
      as.push(`[da${k}]`)
    })
    chain.push(`${vs.join('')}concat=n=${vs.length}:v=1:a=0[dvid]`)
    chain.push(`${as.join('')}concat=n=${as.length}:v=0:a=1[dvoice]`)
    const b = cfg.digest.bgm
    if (p.bgmPath) {
      args.push('-i', p.bgmPath)
      const bi = idx++
      const fo = Math.min(b.fadeOutSec, D)
      chain.push(`[${bi}:a]${fmtA},atrim=0:${round3(D)},asetpts=PTS-STARTPTS,volume=${b.volume},afade=t=in:st=0:d=${b.fadeInSec},afade=t=out:st=${round3(Math.max(0, D - fo))}:d=${fo}[bgm]`)
      if (b.duck) {
        chain.push('[dvoice]asplit=2[dmixv][dsc]')
        chain.push(`[bgm][dsc]sidechaincompress=threshold=${b.duckThreshold}:ratio=${b.duckRatio}:attack=15:release=300[bgmd]`)
        chain.push('[dmixv][bgmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[dmix]')
      } else {
        chain.push('[dvoice][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[dmix]')
      }
      chain.push(`[dmix]atrim=0:${round3(D)},asetpts=PTS-STARTPTS[dA]`)
    } else {
      chain.push(`[dvoice]atrim=0:${round3(D)},asetpts=PTS-STARTPTS[dA]`)
    }
    concatIn.push('[dvid]', '[dA]')
  }

  const panel = (label, sec) => {
    const d = round3(sec.endSec - sec.startSec)
    chain.push(`color=c=${cfg.line.backgroundColor}:s=${width}x${height}:r=${F}:d=${d},setsar=1,format=yuv420p[${label}v]`)
    chain.push(`anullsrc=r=${SR}:cl=stereo,atrim=0:${d},asetpts=PTS-STARTPTS[${label}a]`)
    concatIn.push(`[${label}v]`, `[${label}a]`)
  }
  if (intro) panel('li', intro)

  if (Array.isArray(p.mainItems) && p.mainItems.length > 0) {
    // 編集済みの本編: 残す区間（元動画の [start, end)）と区切りカードの並び。映像・音声へ同じ区間を同じ順で適用する。
    // 映像はフレーム単位で接続（長いクロスフェードなし）。音声は編集点の前後だけ短いフェード（重ねないので映像との長さは一致し続ける）。
    p.mainItems.forEach((it, k) => {
      if (it.kind === 'card') {
        panel(`mc${k}`, { startSec: 0, endSec: it.durationSec })
        return
      }
      const d = it.srcEndSec - it.srcStartSec
      const seg = alignedSegment(it.srcStartSec, d)
      args.push(...seg.input, '-i', p.sourcePath)
      const n = idx++
      const fades = `${k > 0 ? `,afade=t=in:st=0:d=${JOIN_FADE}` : ''}${k < p.mainItems.length - 1 ? `,afade=t=out:st=${round3(Math.max(0, d - JOIN_FADE))}:d=${JOIN_FADE}` : ''}`
      chain.push(`[${n}:v]${seg.v}[mv${k}]`)
      chain.push(`[${n}:a]${seg.a}${fades}[ma${k}]`)
      concatIn.push(`[mv${k}]`, `[ma${k}]`)
    })
  } else {
    args.push('-ss', String(round3(p.mainStartSec)), '-t', String(round3(p.mainEndSec - p.mainStartSec)), '-i', p.sourcePath)
    const mi = idx++
    const md = round3(p.mainEndSec - p.mainStartSec)
    chain.push(`[${mi}:v]trim=0:${md},setpts=PTS-STARTPTS,${fmtV}[mv]`)
    chain.push(`[${mi}:a]${fmtAV},atrim=0:${md},asetpts=PTS-STARTPTS[ma]`)
    concatIn.push('[mv]', '[ma]')
  }
  if (outro) panel('lo', outro)

  const n = concatIn.length / 2
  chain.push(`${concatIn.join('')}concat=n=${n}:v=1:a=1[cv][ca]`)
  chain.push(`[cv]ass=${escapePathForFfmpegFilter(p.assPath)}[sv]`)

  // QR（字幕の後に重ねる。白黒・字幕・フェード・透明度の影響を受けない）。表示区間は planQrWindows（LINE案内の開始〜終了と同一）。
  const qrWindows = planQrWindows(cfg, timeline)
  let vout = '[sv]'
  if (qrWindows.length > 0) {
    if (!p.qrPath) throw new Error(QR_MISSING_MESSAGE) // QR表示ONで素材が無いまま、QRを省略してレンダーしない
    if (!(p.qrSize?.width > 0 && p.qrSize?.height > 0)) throw new Error('QR画像の寸法が必要です')
    args.push('-loop', '1', '-framerate', String(F), '-t', String(timeline.totalSec), '-i', p.qrPath)
    const qi = idx++
    chain.push(`[${qi}:v]split=${qrWindows.length}${qrWindows.map((_, i) => `[qs${i}]`).join('')}`)
    qrWindows.forEach((w, i) => {
      const q = planQrPlacement(w, width, height, p.qrSize, cfg)
      // 縦横比を維持して縮尺し、白いquiet zoneと薄い枠を外側へ付ける（QR本体は変形・着色・透過しない）。
      const card = `scale=${q.innerW}:${q.innerH}:flags=bicubic,pad=${q.innerW + q.quiet * 2}:${q.innerH + q.quiet * 2}:${q.quiet}:${q.quiet}:color=white,pad=${q.totalW}:${q.totalH}:${q.frame}:${q.frame}:color=0x8a968f,format=yuv420p`
      chain.push(`[qs${i}]${card}[qr${i}]`)
      chain.push(`${vout}[qr${i}]overlay=${q.x}:${q.y}:enable='between(t,${w.startSec},${w.endSec})':eof_action=repeat[ov${i}]`)
      vout = `[ov${i}]`
    })
  }
  args.push('-filter_complex', chain.join(';'))
  args.push('-map', vout, '-map', '[ca]')
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(F))
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-movflags', '+faststart', '-t', String(timeline.totalSec), p.outputPath)
  return { args, filterComplex: chain.join(';') }
}

/**
 * 検証用: ダイジェスト区間の音声だけを「声」「ducking後のBGM」「最終ミックス」の3つのWAVへ書き出す引数（本番のフィルタと同じ式）。
 * 声とBGMの音量バランスを機械的に測るために使う。映像は処理しない。
 */
export function buildDigestStemArgs(p) {
  const { cfg } = p
  const SR = cfg.sampleRate
  const b = cfg.digest.bgm
  const D = round3(p.digestClips.reduce((a, c) => a + c.durationSec, 0))
  const args = ['-y', '-hide_banner', '-nostats']
  const chain = []
  const as = []
  p.digestClips.forEach((c, k) => {
    args.push('-ss', String(round3(c.srcStartSec)), '-t', String(round3(c.durationSec)), '-i', p.sourcePath)
    const d = round3(c.durationSec)
    chain.push(`[${k}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${d},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.04,afade=t=out:st=${round3(Math.max(0, d - 0.04))}:d=0.04[da${k}]`)
    as.push(`[da${k}]`)
  })
  chain.push(`${as.join('')}concat=n=${as.length}:v=0:a=1[dvoice]`)
  args.push('-i', p.bgmPath)
  const bi = p.digestClips.length
  const fo = Math.min(b.fadeOutSec, D)
  chain.push(`[${bi}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${D},asetpts=PTS-STARTPTS,volume=${b.volume},afade=t=in:st=0:d=${b.fadeInSec},afade=t=out:st=${round3(Math.max(0, D - fo))}:d=${fo}[bgm]`)
  chain.push('[dvoice]asplit=3[vmix][vsc][vstem]')
  if (b.duck) chain.push(`[bgm][vsc]sidechaincompress=threshold=${b.duckThreshold}:ratio=${b.duckRatio}:attack=15:release=300[bgmd]`)
  else chain.push('[bgm]anull[bgmd]; [vsc]anullsink')
  chain.push('[bgmd]asplit=2[bmix][bstem]')
  chain.push('[vmix][bmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]')
  args.push('-filter_complex', chain.join(';'))
  args.push('-map', '[vstem]', '-ac', '1', '-ar', '16000', p.outVoice, '-map', '[bstem]', '-ac', '1', '-ar', '16000', p.outBgm, '-map', '[mix]', '-ac', '1', '-ar', '16000', p.outMix)
  return { args }
}
