import { describe, it, expect } from 'vitest'
import { decideIntroTimes, INTRO_GREETING, buildMainBgmPreviewPlan, LOOP_CHECK, CARD_SEC, PREVIEW_TRANSITION, makeLoopCheckTransform } from './localCaptionMainBgm.mjs'
import { planDigestTail } from '../server/lib/digestTail.mjs'
import { SHORT_DIGEST_PICKS } from './localCaptionCuts.mjs'
import { buildShortDigest } from '../server/lib/shortDigest.mjs'
import { validateRecoveredCaptions } from '../server/lib/introCut.mjs'

// 合成の音量（20ms/フレーム）: 声区間 -28dB、フレーズ間の谷 -50dB（100ms）
const env = (spans, total = 8) => {
  const db = Array.from({ length: Math.round(total / 0.02) }, () => -63)
  for (const [a, b] of spans) for (let i = Math.round(a / 0.02); i < Math.round(b / 0.02); i++) db[i] = -28
  return db
}

describe('冒頭挨拶の時刻決定（トークン時刻＋音量の谷）', () => {
  const db = env([[2.28, 3.1], [3.2, 4.8], [4.92, 5.46], [5.6, 6.2]])
  const spans = [{ firstTokenSec: 2.62, lastTokenSec: 2.94 }, { firstTokenSec: 3.2, lastTokenSec: 4.62 }, { firstTokenSec: 5.0, lastTokenSec: 5.3 }, { firstTokenSec: 5.72, lastTokenSec: 6.1 }]
  it('境界は音量の谷（前の終了=谷の開始、次の開始=谷の終了）。最初の開始は最初の音、最後の終了は音量が落ちる点', () => {
    const r = decideIntroTimes({ db, frameSec: 0.02, tokenSpans: spans, onsetSec: 2.19 })
    expect(r.ok).toBe(true)
    expect(r.times[0].startSec).toBe(2.19)
    expect(r.times[0].endSec).toBeCloseTo(3.1, 2)
    expect(r.times[1].startSec).toBeCloseTo(3.2, 2)
    expect(r.times[3].endSec).toBeCloseTo(6.2, 1)
    for (let i = 1; i < 4; i++) expect(r.times[i].startSec).toBeGreaterThanOrEqual(r.times[i - 1].endSec) // 重ならない
  })
  it('谷が見つからなければ失敗する（推測で決めない）', () => {
    const flat = env([[2.28, 6.2]])
    expect(decideIntroTimes({ db: flat, frameSec: 0.02, tokenSpans: spans, onsetSec: 2.19 }).ok).toBe(false)
  })
})

describe('冒頭挨拶の文言（ユーザー確認済み）', () => {
  it('4件・確認済みの表記（トモキ）。最大2行・改行しても本文と一致', () => {
    expect(INTRO_GREETING.map((g) => g.text)).toEqual(['どうもこんにちは', '埼玉でシンガーソングライターをしております', 'トモキと申します', 'よろしくお願いします'])
    for (const g of INTRO_GREETING) {
      expect(g.lines.length).toBeLessThanOrEqual(2)
      expect(g.lines.join('')).toBe(g.text)
    }
  })
  it('補完caption（source: manual-intro-recovery・confirmed: true）は検証を通り、既存の最初のcaptionと重ならない', () => {
    const caps = INTRO_GREETING.map((g, i) => ({ id: `intro-recovery-${i}`, text: g.text, lines: g.lines, startSec: 2.19 + i * 1.2, endSec: 3.1 + i * 1.2, captionType: 'normal', emphasisText: null, source: 'manual-intro-recovery', confirmed: true }))
    expect(validateRecoveredCaptions(caps, [{ id: 'full-0000', startSec: 7.11 }]).ok).toBe(true)
  })
})

describe('確認動画の計画', () => {
  const base = { captions: [], norm: [] }
  it('ループ境界の確認区間は本編の後ろ（区切りカード付き）。カードは確認用で最終動画には入らない', () => {
    expect(LOOP_CHECK.boundaryOffsetSec).toBeLessThan(LOOP_CHECK.sec)
    expect(CARD_SEC).toBeGreaterThan(0)
    expect(typeof buildMainBgmPreviewPlan).toBe('function')
    expect(base.captions).toEqual([])
  })
})

// ── ダイジェスト末尾の余韻・画面遷移・タイムライン（合成の字幕で、実データと同じ選択位置・文末）──
const synthBase = () => {
  const captions = Array.from({ length: 500 }, (_, i) => ({ id: `full-${String(i).padStart(4, '0')}`, text: 'あいうえお。', lines: ['あいうえお。'], startSec: 2 * i + 0.02, endSec: 2 * i + 1.9, captionType: 'normal', emphasisText: null }))
  captions[226].text = '違うんであれば無理して一緒に'
  captions[227].text = 'やる必要はありません。'
  captions[400].text = '目的熱量は違いますよと。'
  const norm = [{ id: 'topic-001', title: 'はじめに', startSec: 0, endSec: 300 }, { id: 'topic-005', title: '結論', startSec: 300, endSec: 600 }, { id: 'topic-008', title: '音楽仲間との違いを把握', startSec: 600, endSec: 1000 }]
  return { captions, norm }
}
const JOB = { width: 1920, height: 1080 }
const PATHS = { bgm: '/b.mp3', qr: '/qr.png' }

describe('確認動画の計画: ダイジェスト末尾の余韻と画面遷移', () => {
  const base = synthBase()
  const dig0 = buildShortDigest(base.captions, base.norm, SHORT_DIGEST_PICKS)
  const last0 = dig0.clips.at(-1)
  // 最後の発話の終わり = 最後のクリップの終了点の0.52秒前、次の発話の始まり = その0.32秒後（実測と同じ間隔）
  const tail = planDigestTail({ speechEndSec: last0.srcEndSec - 0.52, nextSpeechStartSec: last0.srcEndSec - 0.2, clipStartSec: last0.srcStartSec })
  const mk = (over = {}) => buildMainBgmPreviewPlan(JOB, base, { paths: PATHS, cutEndSec: 2.0667, mainBgm: { sourcePath: '/m.mp3' }, digestTail: tail, transition: PREVIEW_TRANSITION, ...over })
  const plan = mk()

  it('前提: 元のダイジェストは尻切れ（最後の発話後の余韻が0.52秒あるが、次の発話の頭0.2秒を含む）。余韻計画は次の発話の手前で止まり、250〜400ms', () => {
    expect(tail.ok).toBe(true)
    expect(tail.afterSpeechSec).toBeGreaterThanOrEqual(0.25)
    expect(tail.afterSpeechSec).toBeLessThanOrEqual(0.4)
    expect(tail.srcEndSec).toBeLessThan(last0.srcEndSec - 0.2)
  })
  it('最後のクリップだけが変わる: 2クリップ・選択・開始・強調2件・字幕本文は不変', () => {
    expect(plan.dig.clips.length).toBe(2)
    expect(plan.dig.clips[0]).toEqual(dig0.clips[0])
    expect(plan.dig.clips[1]).toMatchObject({ firstIndex: last0.firstIndex, lastIndex: last0.lastIndex, srcStartSec: last0.srcStartSec, themeId: last0.themeId, emphasis: last0.emphasis })
    expect(plan.dig.clips[1].srcEndSec).toBe(tail.srcEndSec)
    expect(plan.dig.clips.filter((c) => c.emphasis).map((c) => c.emphasis.text)).toEqual(['無理して一緒に', '違います'])
    expect(plan.digCaps.map((c) => c.text)).toEqual([base.captions[226], base.captions[227], base.captions[398], base.captions[399], base.captions[400]].map((c) => c.text))
    expect(plan.digCaps.filter((c) => c.emphasisText).map((c) => c.emphasisText)).toEqual(['無理して一緒に', '違います'])
  })
  it('最後の発話は語尾まで入り、captionは暗転の終わりまで残る（途中で消えない）。テーマも同じ', () => {
    const T = plan.timeline
    const lastCap = plan.digCaps.at(-1)
    expect(lastCap.endSec).toBe(T.digestSec)
    expect(plan.digBlocks.at(-1).endSec).toBe(T.digestSec)
    const clipOffset = plan.dig.clips[0].durationSec
    const speechEndFinal = clipOffset + (last0.srcEndSec - 0.52 - last0.srcStartSec)
    expect(T.liveDigestSec).toBeGreaterThan(speechEndFinal + 0.25) // 発話終了後に250ms以上の余韻（実映像）
    expect(T.liveDigestSec - speechEndFinal).toBeLessThanOrEqual(0.4 + 1e-6)
    expect(lastCap.endSec).toBeGreaterThan(T.liveDigestSec) // 余韻・止め画・暗転の間もcaptionを表示
  })
  it('遷移区間は明示的なtimeline segment: digest → transitionHold（黒）→ main。本編開始・LINEオーバーレイ・BGM・末尾LINE案内が同じ基準', () => {
    const T = plan.timeline
    expect(T.sections.map((s) => s.kind)).toEqual(['digest', 'transitionHold', 'main', 'lineOutro'])
    expect(plan.D).toBe(T.mainOffsetSec)
    expect(T.transition.mainStartSec).toBe(plan.D)
    expect(T.transition.fadeOut.endSec).toBe(T.digestSec)
    expect(T.transition.hold.endSec).toBe(plan.D)
    expect(T.overlays[0]).toMatchObject({ startSec: plan.D })
    expect(T.overlays[0].endSec - T.overlays[0].startSec).toBeCloseTo(30, 3)
    expect(plan.anchors.bgmStartSec).toBe(plan.D)
    expect(plan.anchors.digestEndSec).toBeLessThanOrEqual(plan.anchors.bgmStartSec) // ダイジェストBGMと本編BGMは重ならない
    expect(plan.anchors.outroStartSec).toBe(plan.anchors.mainEndSec)
    expect(T.transition.endSec).toBeLessThanOrEqual(12) // ダイジェスト全体（遷移込み）
  })
  it('本編内部の相対時刻は不変: 本編のcaption・テーマは、遷移の有無にかかわらず同じ秒数だけ動く（差は遷移ぶんのオフセットだけ）', () => {
    const off = mk({ transition: null, digestTail: null })
    const dOff = plan.D - off.D
    expect(dOff).toBeGreaterThan(0)
    // 挨拶の手動補完captionも含め、本編のcaption数・本文は同じ。開始・終了はオフセット差だけずれる
    expect(plan.mainCaps.length).toBe(off.mainCaps.length)
    plan.mainCaps.forEach((c, i) => {
      expect(c.text).toBe(off.mainCaps[i].text)
      expect(c.startSec - off.mainCaps[i].startSec).toBeCloseTo(dOff, 3)
      expect(c.endSec - off.mainCaps[i].endSec).toBeCloseTo(dOff, 3)
    })
    expect(plan.mainBlocks.map((b) => b.sections.length)).toEqual(off.mainBlocks.map((b) => b.sections.length))
    expect(plan.mainBlocks[0].startSec - off.mainBlocks[0].startSec).toBeCloseTo(dOff, 3)
  })
  it('本編の先頭は遅らせない: 最初のcaptionは本編開始の後ろ（フェードの都合で遅らせない）。ASSには黒の保持の間に文字・タイトルがない', () => {
    const ass = plan.buildAss({ width: 500, height: 500 })
    const parse = (x) => { const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(x); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100 }
    const T = plan.timeline
    const holdA = T.transition.hold.startSec
    const holdB = T.transition.hold.endSec
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => { const f = l.split(','); return [parse(f[1]), parse(f[2]), f[3]] })
    const during = events.filter(([a, b]) => a < holdB - 0.011 && b > holdA + 0.011 && a >= holdA - 0.011)
    expect(during).toEqual([]) // 黒の保持の間に始まる字幕・テーマ・LINE案内はない（黒にタイトルを足さない）
    const first = events.filter(([a, , style]) => a >= holdB - 0.011 && style !== 'LineHead' && style !== 'LineBody').map(([a]) => a)
    expect(Math.min(...first)).toBeGreaterThanOrEqual(holdB - 0.011)
  })
  it('ダイジェストBGMは暗転の終わりで無音（本編BGMの開始前）: ダイジェストのBGMは digest 区間の長さで切る', () => {
    expect(plan.cfg.digest.bgm.fadeOutSec).toBeGreaterThan(0)
    expect(plan.timeline.digestSec).toBeCloseTo(plan.timeline.liveDigestSec + 0.333, 3)
  })
  it('遷移なし・末尾補完なしの計画は従来どおり（ダイジェスト＝2クリップの合計・遷移なし）', () => {
    const off = mk({ transition: null, digestTail: null })
    expect(off.timeline.transition).toBeNull()
    expect(off.timeline.digestSec).toBe(dig0.totalSec)
    expect(off.D).toBe(dig0.totalSec)
  })
  it('余韻を確保できないときは計画を作らない（推測で切らない）', () => {
    expect(() => mk({ digestTail: { ok: false, reason: 'x' } })).toThrow('ダイジェスト末尾を確保できません')
  })
})

describe('ループ境界の確認トラック', () => {
  it('確認用トラックは最終版のループ計画（開始点・単位）から作る関数。実データでの検証は preview-verify が行う', () => {
    expect(typeof makeLoopCheckTransform({ seg1Sec: 45 })).toBe('function')
  })
})
