// ローカルAIテロップ動画: 約10秒の短いダイジェスト（2〜3クリップ・各約3〜5秒）の組み立てと検証。純粋関数のみ。
//
// クリップは「人が選んだ caption の範囲」（firstIndex〜lastIndex。文頭〜文末）を入力とし、ここでは
// 規則（合計9〜12秒・2〜3クリップ・語/文の途中で始めない/終わらない・告知や案内を含まない・強調は1クリップ最大1か所で本文の完全な部分文字列）を検証する。
// 選定そのものにAIは使わない。開始・終了は 30fps のフレーム境界へ寄せる（ダイジェストの長さがフレーム境界に載り、映像と音声の長さがずれない）。

import { STRONG_PUNCT } from './japaneseText.mjs'

export const SHORT_DIGEST_DEFAULTS = Object.freeze({
  fps: 30,
  minSec: 9,
  maxSec: 12,
  clipCount: Object.freeze({ min: 2, max: 3 }),
  clipSec: Object.freeze({ min: 2.5, max: 6.5 }), // 約3〜5秒（前後の余白と文の長さの都合で少し幅を持たせる）
  leadSec: 0.1, // 最初のcaption開始より前へ
  tailSec: 0.15, // 最後のcaption終了より後へ
  maxEmphasisPerClip: 1,
  maxEmphasisChars: 12,
  // ダイジェストの発言候補にしない話題（チャンネル紹介・LINE案内・歌唱診断の告知・登録のお願い）
  excludedRe: /チャンネル|LINE|ライン|歌唱診断|概要欄|登録|コメント|いいね|告知|ホームページ|お送りします|お会いしましょう|MMM/,
})

const r3 = (v) => Math.round(v * 1000) / 1000
const endsSentence = (t) => {
  const ch = Array.from(String(t ?? '').replace(/[」』）)\s]+$/u, '')).pop()
  return ch !== undefined && STRONG_PUNCT.has(ch)
}
const ceilF = (s, fps) => Math.ceil(s * fps - 1e-6) / fps
const floorF = (s, fps) => Math.floor(s * fps + 1e-6) / fps

/**
 * @param {Array<{ id?: string, startSec: number, endSec: number, text: string, lines?: string[] }>} captions
 * @param {Array<{ id: string, title: string, startSec: number, endSec: number }>} themes
 * @param {Array<{ firstIndex: number, lastIndex: number, emphasisText?: string | null }>} picks 時系列でなくてよい（視聴者が続きを見たくなる順）
 * @returns {{ ok: boolean, problems: string[], clips: Array<object>, totalSec: number }}
 */
export function buildShortDigest(captions, themes, picks, config = SHORT_DIGEST_DEFAULTS) {
  const problems = []
  const fps = config.fps
  const clips = []
  const usedThemes = new Set()
  picks.forEach((p, k) => {
    const n = k + 1
    const first = captions[p.firstIndex]
    const last = captions[p.lastIndex]
    if (!first || !last || p.lastIndex < p.firstIndex) {
      problems.push(`クリップ${n}: captionの範囲が不正です`)
      return
    }
    const slice = captions.slice(p.firstIndex, p.lastIndex + 1)
    const text = slice.map((c) => c.text).join('')
    if (!(p.firstIndex === 0 || endsSentence(captions[p.firstIndex - 1].text))) problems.push(`クリップ${n}: 文の途中から始まっています`)
    if (!endsSentence(last.text)) problems.push(`クリップ${n}: 文の途中で終わっています`)
    if (config.excludedRe.test(text)) problems.push(`クリップ${n}: チャンネル紹介・LINE案内・告知にあたる発言を含みます`)
    if (slice.some((c) => (c.lines?.length ?? 1) > 2)) problems.push(`クリップ${n}: 3行以上のcaptionを含みます`)
    for (let i = 1; i < slice.length; i++) if (slice[i].startSec - slice[i - 1].endSec > 0.6) problems.push(`クリップ${n}: 0.6秒以上の無音をまたいでいます`)

    const prevEnd = p.firstIndex > 0 ? captions[p.firstIndex - 1].endSec : 0
    const nextStart = p.lastIndex + 1 < captions.length ? captions[p.lastIndex + 1].startSec : Infinity
    // 前の発話・次の発話へ食い込まない範囲で、前後に余白を付け、フレーム境界へ（残す余白が減らない向きの逆＝発話を欠かさない向きへ寄せる）
    const srcStartSec = Math.min(ceilF(Math.max(prevEnd, first.startSec - config.leadSec), fps), floorF(first.startSec, fps))
    const srcEndSec = Math.max(floorF(Math.min(nextStart, last.endSec + config.tailSec), fps), ceilF(last.endSec, fps))
    const durationSec = r3(srcEndSec - srcStartSec)
    if (durationSec < config.clipSec.min || durationSec > config.clipSec.max) problems.push(`クリップ${n}: 長さが${config.clipSec.min}〜${config.clipSec.max}秒に収まりません（${durationSec}秒）`)

    const theme = themes.find((t) => first.startSec >= t.startSec && first.startSec < t.endSec) ?? null
    if (!theme) problems.push(`クリップ${n}: 対応するトークテーマがありません`)
    else if (usedThemes.has(theme.id)) problems.push(`クリップ${n}: 同じテーマ（同じ内容）を繰り返しています`)
    else usedThemes.add(theme.id)

    // 強調: 1クリップ最大1か所。本文の完全な部分文字列で、全文ではなく、1つのcaption内（行をまたいでよい）に収まる
    let emphasis = null
    const em = p.emphasisText ?? null
    if (em) {
      const holder = slice.findIndex((c) => c.text.includes(em))
      if (holder < 0) problems.push(`クリップ${n}: 強調語が字幕本文の部分文字列ではありません`)
      else if (em === slice[holder].text) problems.push(`クリップ${n}: 全文を強調しています`)
      else if (Array.from(em).length > config.maxEmphasisChars) problems.push(`クリップ${n}: 強調語が長すぎます`)
      else emphasis = { captionIndex: p.firstIndex + holder, text: em }
    }
    clips.push({ firstIndex: p.firstIndex, lastIndex: p.lastIndex, srcStartSec: r3(srcStartSec), srcEndSec: r3(srcEndSec), durationSec, themeId: theme?.id ?? null, emphasis })
  })
  const totalSec = r3(clips.reduce((a, c) => a + c.durationSec, 0))
  if (clips.length < config.clipCount.min || clips.length > config.clipCount.max) problems.push(`クリップ数が${config.clipCount.min}〜${config.clipCount.max}ではありません（${clips.length}）`)
  if (totalSec < config.minSec || totalSec > config.maxSec) problems.push(`合計が${config.minSec}〜${config.maxSec}秒に収まりません（${totalSec}秒）`)
  const ranges = clips.map((c) => [c.srcStartSec, c.srcEndSec]).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1] - 1e-9) problems.push('クリップの元動画上の範囲が重なっています')
  return { ok: problems.length === 0, problems, clips, totalSec }
}

/**
 * ダイジェストのcaptionを、編集後（ダイジェスト内）の時刻へ配置し、強調を「クリップごとに最大1か所」へ置き換える
 * （本編側のcaptionの強調は変更しない。ここで作るのはダイジェスト用のコピーだけ）。
 */
export function shortDigestCaptions(captions, clips) {
  const out = []
  let offset = 0
  for (const clip of clips) {
    for (let i = clip.firstIndex; i <= clip.lastIndex; i++) {
      const c = captions[i]
      out.push({
        ...c,
        startSec: r3(offset + (c.startSec - clip.srcStartSec)),
        endSec: r3(offset + (c.endSec - clip.srcStartSec)),
        emphasisText: clip.emphasis && clip.emphasis.captionIndex === i ? clip.emphasis.text : null,
        digestClipFirstIndex: clip.firstIndex,
      })
    }
    offset += clip.durationSec
  }
  return out
}
