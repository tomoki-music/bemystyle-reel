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
import { buildAssContent, getFontFamily } from './captionStyles.mjs'
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
  lineIntro: Object.freeze({ enabled: true, durationSec: 30, showQr: false }),
  lineOutro: Object.freeze({ enabled: true, durationSec: 12, showQr: true }),
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
  if (cfg.lineOutro.enabled && !cfg.lineOutro.showQr) errors.push('末尾のLINE案内ではQR画像を必ず表示してください')
  return { ok: errors.length === 0, errors }
}

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
 * 区間構成: digest → lineIntro → main → lineOutro（有効なものだけ）。
 * @param {ReturnType<typeof resolveCompositionConfig>} cfg
 * @param {{ mainStartSec: number, mainEndSec: number, digestClips?: Array<{ durationSec: number }> }} p
 * @returns {{ sections: Array<{ kind: 'digest' | 'lineIntro' | 'main' | 'lineOutro', startSec: number, endSec: number }>, mainOffsetSec: number, totalSec: number, digestSec: number }}
 */
export function planTimeline(cfg, p) {
  const sections = []
  let t = 0
  const digestSec = cfg.digest.enabled ? (p.digestClips ?? []).reduce((a, c) => a + c.durationSec, 0) : 0
  const push = (kind, len) => {
    sections.push({ kind, startSec: round3(t), endSec: round3(t + len) })
    t += len
  }
  if (cfg.digest.enabled && digestSec > 0) push('digest', digestSec)
  if (cfg.lineIntro.enabled) push('lineIntro', cfg.lineIntro.durationSec)
  const mainOffsetSec = t
  push('main', p.mainEndSec - p.mainStartSec)
  if (cfg.lineOutro.enabled) push('lineOutro', cfg.lineOutro.durationSec)
  return { sections, mainOffsetSec: round3(mainOffsetSec), totalSec: round3(t), digestSec: round3(digestSec) }
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

/** QRの表示レイアウト（すべて画面内・テキストと重ならない）。quiet zone は白い余白として QR の周囲に必ず設ける。 */
export function qrLayout(width, height) {
  const inner = Math.round(height * 0.52) // QR画像の表示サイズ（正方形へ収める）
  const quiet = Math.round(inner * 0.08) // 白いquiet zone
  const total = inner + quiet * 2
  const marginX = Math.round(width * 0.05)
  const x = width - marginX - total
  const y = Math.round((height - total) / 2)
  return { inner, quiet, total, x, y, marginX }
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

/**
 * 最終動画全体のASS。字幕・テーマ・強調は最終動画の時刻へ配置済みのものを渡す。LINE案内区間にはテーマも本編字幕も重ねない。
 */
export function buildFinalAss({ width, height, cfg, timeline, mainCaptions, digestCaps, themeBlocks }) {
  const line = buildLineStyleLines(width, height)
  const extraEvents = []
  for (const s of timeline.sections) {
    if (s.kind === 'lineIntro') extraEvents.push(...buildLineEvents(width, height, cfg.line.text, s, cfg.lineIntro.showQr, [0, 0.33, 0.66]))
    if (s.kind === 'lineOutro') extraEvents.push(...buildLineEvents(width, height, cfg.line.text, s, cfg.lineOutro.showQr, [0, 0.1, 0.2]))
  }
  return buildAssContent({ width, height, captions: [...digestCaps, ...mainCaptions] }, { topicBlocks: themeBlocks, topicAccentMode: 'label', extraStyleLines: line.lines, extraEvents })
}

// ────────────────────────────────────────────────────────────────
// ffmpeg（spawn argv配列。shell展開しない）
// ────────────────────────────────────────────────────────────────

/**
 * 構成動画1本を書き出すffmpeg引数。ダイジェストの映像だけを白黒（クリップごとのフィルタチェーンに閉じ込め、他区間へ漏らさない）にし、
 * その後で字幕・テーマ（カラー）を焼き込み、最後にQRを重ねる（QRには白黒・字幕を適用しない）。
 *
 * @param {{
 *   cfg: ReturnType<typeof resolveCompositionConfig>, timeline: ReturnType<typeof planTimeline>, width: number, height: number,
 *   sourcePath: string, mainStartSec: number, mainEndSec: number, digestClips: Array<{ srcStartSec: number, durationSec: number }>,
 *   bgmPath?: string, qrPath?: string, assPath: string, outputPath: string,
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

  if (digestOn) {
    const D = timeline.digestSec
    const clipIdx = []
    for (const c of p.digestClips) {
      args.push('-ss', String(round3(c.srcStartSec)), '-t', String(round3(c.durationSec)), '-i', p.sourcePath)
      clipIdx.push(idx++)
    }
    const vs = []
    const as = []
    p.digestClips.forEach((c, k) => {
      const n = clipIdx[k]
      const d = round3(c.durationSec)
      const gray = cfg.digest.grayscale ? ',hue=s=0' : ''
      chain.push(`[${n}:v]trim=0:${d},setpts=PTS-STARTPTS,${fmtV}${gray}[dv${k}]`)
      chain.push(`[${n}:a]${fmtA},atrim=0:${d},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.04,afade=t=out:st=${round3(Math.max(0, d - 0.04))}:d=0.04[da${k}]`)
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

  args.push('-ss', String(round3(p.mainStartSec)), '-t', String(round3(p.mainEndSec - p.mainStartSec)), '-i', p.sourcePath)
  const mi = idx++
  const md = round3(p.mainEndSec - p.mainStartSec)
  chain.push(`[${mi}:v]trim=0:${md},setpts=PTS-STARTPTS,${fmtV}[mv]`)
  chain.push(`[${mi}:a]${fmtA},atrim=0:${md},asetpts=PTS-STARTPTS[ma]`)
  concatIn.push('[mv]', '[ma]')
  if (outro) panel('lo', outro)

  const n = concatIn.length / 2
  chain.push(`${concatIn.join('')}concat=n=${n}:v=1:a=1[cv][ca]`)
  chain.push(`[cv]ass=${escapePathForFfmpegFilter(p.assPath)}[sv]`)

  // QR（字幕の後に重ねる。白黒・字幕の影響を受けない）
  const qrWindows = []
  if (intro && cfg.lineIntro.showQr) qrWindows.push(intro)
  if (outro && cfg.lineOutro.showQr) qrWindows.push(outro)
  let vout = '[sv]'
  if (qrWindows.length > 0 && p.qrPath) {
    args.push('-loop', '1', '-framerate', String(F), '-t', String(timeline.totalSec), '-i', p.qrPath)
    const qi = idx++
    const q = qrLayout(width, height)
    // 縮小はbicubic、拡大はneighborでぼやけを避ける。周囲に白いquiet zoneを付ける（QR自体は装飾しない）。
    chain.push(`[${qi}:v]scale=${q.inner}:${q.inner}:flags=bicubic,pad=${q.total}:${q.total}:${q.quiet}:${q.quiet}:color=white,format=yuv420p,split=${qrWindows.length}${qrWindows.map((_, i) => `[qr${i}]`).join('')}`)
    qrWindows.forEach((w, i) => {
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
