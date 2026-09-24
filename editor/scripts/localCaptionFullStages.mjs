// ローカルAIテロップ動画: 全編（約15分）ランナーの prepare / render / check ステージ。
// 共通の入出力は localCaptionFull.mjs（align と同じ安全方針: 外部AI API不使用・絶対パス/本文/テーマ名/強調語を出力しない）。

import { readFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { realpathSync } from 'fs'

import { EDITOR_ROOT, FULL_DIR, loadJob, safetyContext, writeJsonAtomic } from './localCaptionFull.mjs'
import { getFreeBytes } from '../server/lib/diskSpace.mjs'
import { withTempDir } from '../server/lib/tempDir.mjs'
import { validateEmphasis } from '../server/lib/emphasisSelector.mjs'
import { checkTopicTitleGrounding, validateTopicSections, normalizeTopicSectionsContinuous, validateTopicTitle } from '../server/lib/topicSections.mjs'
import { analyzeTopicAssEvents } from '../server/lib/topicAss.mjs'
import { inheritCaptionTypes, carryOverEmphasis, buildManualTopicSections, themeTexts } from '../server/lib/fullPipeline.mjs'
import { resolveCompositionConfig, validateCompositionConfig, selectDigestClips, planTimeline, shiftMainCaptions, digestCaptions, mainThemeBlock, digestThemeBlocks, buildFinalAss, buildCompositionArgs, planQrWindows } from '../server/lib/finalComposition.mjs'
import { resolveCompositionAssets, renderCompositionToFile, checkFreeSpace, FULL_RENDER_MIN_FREE_BYTES } from '../server/lib/compositionRender.mjs'
import { measureCaptionTiming } from '../server/lib/comparisonMetrics.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const KEY = 'full_v3'
const p = (name) => resolve(FULL_DIR, `${KEY}.${name}.json`)
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const MIN_FREE_DURING_RENDER = 10 * 1024 ** 3

// 人が確認した全編のテーマ（本編0秒から常時表示）。開始は rawSegment の先頭（=文の頭）。source は常に 'manual'。
// 既存の手動修正済みテーマ（5分版で承認）と同じ話題の区間は、承認済みのタイトルを使う。
const THEME_DEFS = [
  { seg: 0, title: 'バンド脱退の悩みについて' },
  { seg: 6, title: '脱退が起きる価値観の違い' },
  { seg: 13, title: '熱量と目的の違いを確認' },
  { seg: 20, title: '相手との違いから自分を知る' },
  { seg: 27, title: '無理に一緒にやる必要はない' },
  { seg: 32, title: '犯人探しをしない話し合い' },
  { seg: 37, title: 'バンドの自由なスタンス' }, // 承認済み
  { seg: 44, title: '音楽仲間との違いを把握' }, // 承認済み
  { seg: 49, title: '歌の配信と歌唱診断' }, // 承認済み
]

// 全編のうち、承認済みの5分区間（613秒〜）より前に、人が選んだ強調（本文の完全な部分文字列）。segは強調語を含むrawSegment。
const NEW_EMPHASIS = [
  { seg: 12, phrase: 'スタートライン' },
  { seg: 20, phrase: '真骨頂' },
  { seg: 26, phrase: '把握する' },
  { seg: 29, phrase: '犯人探し' },
  { seg: 31, phrase: '一番伝えたい' },
  { seg: 33, phrase: '危ない' },
]

const DIGEST_OVERRIDES = { digest: { minSec: 25, maxSec: 30, durationSec: 27, clipCount: { min: 4, max: 6 }, clipSec: { min: 4, max: 6.5 } } }

const loadPages = () => {
  const pages = JSON.parse(readFileSync(p('pages'), 'utf-8'))
  if (!pages.ok) throw new Error('全編のcaptionが未完成です（align の検証が通っていません）')
  return pages
}

const cumOffsets = (raw) => {
  const out = []
  let c = 0
  for (const s of raw) {
    out.push(c)
    c += s.text.length
  }
  return out
}

function composeCaptions(job, pages) {
  const legacy = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  const raw = job.rawSegments
  const cum = cumOffsets(raw)
  const canonicalText = legacy.map((c) => c.text).join('')
  let caps = pages.captions.map((c) => ({ ...c }))

  // 1) captionType: 旧caption（正本上の文字範囲が一致）から引き継ぐ。曖昧・headingは normal
  const inh = inheritCaptionTypes(caps, legacy)
  caps = inh.captions

  // 2) 強調: 承認済み（5分版のAI1件+手動6件）を正本位置で引き継ぎ、前半に人が選んだ強調を追加
  const five = resolve(EDITOR_ROOT, 'data/local_caption_comparisons/five_minute')
  const v2 = JSON.parse(readFileSync(resolve(five, 'five_minute_613.pages.v2.json'), 'utf-8'))
  const analysis = JSON.parse(readFileSync(resolve(five, 'five_minute_613.analysis.json'), 'utf-8'))
  const firstLegacy = legacy.findIndex((c) => c.startSec >= v2.window.startSec - 1e-6)
  const off = legacy.slice(0, firstLegacy).reduce((a, c) => a + c.text.length, 0)
  const startOf = new Map()
  let cur = off
  for (const c of v2.captions) {
    startOf.set(c.id, { globalStartIndex: cur, text: c.text })
    cur += c.text.length
  }
  const approved = analysis.emphasis.filter((e) => e.decision !== 'rejected').map((e) => ({ ...startOf.get(e.captionId), emphasisText: e.emphasisText }))
  const carry = carryOverEmphasis(caps, approved)
  caps = carry.captions

  const added = []
  const failed = []
  for (const e of NEW_EMPHASIS) {
    const a = cum[e.seg]
    const b = a + raw[e.seg].text.length
    const at = canonicalText.indexOf(e.phrase, a)
    const target = at >= 0 && at + e.phrase.length <= b ? caps.find((c) => c.startIndex <= at && c.startIndex + c.text.length >= at + e.phrase.length) : null
    const problem = target ? validateEmphasis(e.phrase, target.text) : '対象captionが見つかりません'
    if (!target || problem || target.emphasisText) failed.push({ seg: e.seg, reason: problem || '同じcaptionに既に強調があります' })
    else {
      target.emphasisText = e.phrase
      added.push({ captionId: target.id, seg: e.seg, chars: Array.from(e.phrase).length })
    }
  }
  const emphasisCaptions = caps.filter((c) => c.emphasisText)
  // 連続するcaptionへの強調の並び（隣接）を検査
  let adjacent = 0
  for (let i = 1; i < caps.length; i++) if (caps[i].emphasisText && caps[i - 1].emphasisText) adjacent += 1
  return { caps, legacy, cum, canonicalText, types: inh, emphasis: { carried: carry.carried, droppedApproved: carry.dropped, added, failed, total: emphasisCaptions.length, adjacent, lengths: emphasisCaptions.map((c) => Array.from(c.emphasisText).length) } }
}

function composeThemes(job, caps, cum) {
  const defs = THEME_DEFS.map((d, i) => {
    const startIndex = cum[d.seg]
    const idx = caps.findIndex((c) => c.startIndex === startIndex)
    return { id: `topic-${String(i + 1).padStart(3, '0')}`, title: d.title, startCaptionIndex: idx, startIndex }
  })
  const missing = defs.filter((d) => d.startCaptionIndex < 0).length
  if (missing) throw new Error(`テーマの開始位置がcaption境界と一致しません（${missing}件）`)
  const sections = buildManualTopicSections(defs, caps, job.durationSec)
  return { sections, defs }
}

/** テーマの検証（本文との一致・被覆・空白・重複）。本文・テーマ名は返さない。 */
function verifyThemes(sections, caps, durationSec) {
  const texts = themeTexts(sections, caps)
  const grounding = sections.map((s, i) => {
    const g = checkTopicTitleGrounding(s.title, texts[i])
    return { ok: g.ok, ungrounded: g.ungroundedTerms.length, termCount: g.terms.length, titleValid: validateTopicTitle(s.title).ok, durationSec: round(s.endSec - s.startSec, 2) }
  })
  const norm = normalizeTopicSectionsContinuous(sections, { startSec: 0, endSec: durationSec })
  const v = validateTopicSections(norm.sections)
  const adjacentSame = sections.filter((s, i) => i > 0 && s.title === sections[i - 1].title).length
  return {
    count: sections.length,
    grounding,
    validation: v,
    coverage: norm.stats.afterCoverage,
    gapSec: norm.stats.undisplayedSec,
    overlapSec: norm.stats.overlapSec,
    adjacentSameTitle: adjacentSame,
    allManual: sections.every((s) => s.source === 'manual'),
    firstStartSec: sections[0].startSec,
    lastEndSec: sections[sections.length - 1].endSec,
    ok: grounding.every((g) => g.ok && g.titleValid) && v.ok && norm.stats.afterCoverage === 1 && norm.stats.undisplayedSec === 0 && norm.stats.overlapSec === 0 && adjacentSame === 0 && sections[0].startSec === 0,
    normalized: norm.sections,
  }
}

function buildDigest(caps, sections, cfg) {
  const forDigest = caps.map((c) => ({ startSec: c.startSec, endSec: c.endSec, text: c.text, emphasisText: c.emphasisText }))
  const sel = selectDigestClips({ captions: forDigest, themes: sections, config: cfg.digest })
  return sel
}

async function stagePrepare(args) {
  const { file, bytes, job, canon } = loadJob(args.job)
  const canonBefore = canon(job)
  const pages = loadPages()
  const { caps, legacy, cum, canonicalText, types, emphasis } = composeCaptions(job, pages)
  const { sections } = composeThemes(job, caps, cum)
  const th = verifyThemes(sections, caps, job.durationSec)

  const cfg = resolveCompositionConfig(DIGEST_OVERRIDES)
  const v = validateCompositionConfig(cfg)
  const problems = []
  if (!v.ok) problems.push(...v.errors)
  const sel = buildDigest(caps, th.normalized, cfg)
  const digestThemes = digestThemeBlocks(th.normalized, sel.clips, caps)
  if (sel.reasons.length) problems.push(...sel.reasons)
  const digestTotal = sel.clips.reduce((a, c) => a + c.durationSec, 0)
  if (!(digestTotal >= 25 && digestTotal <= 30)) problems.push(`ダイジェストの合計が25〜30秒に収まりません (${round(digestTotal, 2)})`)
  if (sel.clips.length < 4 || sel.clips.length > 6) problems.push(`ダイジェストのクリップ数が4〜6ではありません (${sel.clips.length})`)
  if (sel.clips.some((c) => c.durationSec < 4 || c.durationSec > 8.5)) problems.push('ダイジェストのクリップが約4〜8秒に収まりません')
  if (digestThemes.clipsWithoutTheme > 0) problems.push('テーマの無いダイジェストクリップがあります')
  if (!th.ok) problems.push('テーマの内部検証が通っていません')
  if (emphasis.failed.length) problems.push(`新規の強調が${emphasis.failed.length}件、本文に対応しません`)
  if (emphasis.droppedApproved) problems.push(`承認済みの強調が${emphasis.droppedApproved}件、引き継げません`)
  if (emphasis.total < 8 || emphasis.total > 15) problems.push(`強調の件数が8〜15か所ではありません (${emphasis.total})`)
  if (emphasis.adjacent > 0) problems.push('連続するcaptionへ強調が並んでいます')

  const themeOfClip = sel.clips.map((c) => th.normalized.find((t) => caps[c.firstIndex].startSec >= t.startSec && caps[c.firstIndex].startSec < t.endSec)?.id)
  const doc = {
    createdAt: new Date().toISOString(),
    version: 3,
    jobId: job.id,
    canonicalSha256: sha256(canonicalText),
    captions: caps.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: c.text, lines: c.lines, startIndex: c.startIndex, captionType: c.captionType, emphasisText: c.emphasisText ?? null, lowConfidence: c.lowConfidence, displayOrder: c.displayOrder })),
  }
  writeJsonAtomic(p('captions'), doc)
  writeJsonAtomic(p('topics'), { createdAt: new Date().toISOString(), version: 3, jobId: job.id, source: 'manual', sections: sections.map((s) => ({ ...s })) })
  writeJsonAtomic(p('digest'), { createdAt: new Date().toISOString(), version: 3, config: DIGEST_OVERRIDES.digest, clips: sel.clips, totalSec: round(digestTotal, 3), themeIds: themeOfClip })

  const cntBy = (arr, f) => arr.reduce((h, x) => ({ ...h, [f(x)]: (h[f(x)] ?? 0) + 1 }), {})
  const legacyCounts = cntBy(legacy, (c) => c.captionType)
  console.log(JSON.stringify({
    stage: 'prepare',
    ok: problems.length === 0,
    problems,
    captionTypes: { counts: types.counts, ambiguousToNormal: types.ambiguous, headingDemotedToNormal: types.headingDemoted, legacyCounts },
    emphasis: { total: emphasis.total, carriedApproved: emphasis.carried, addedByHuman: emphasis.added.length, failed: emphasis.failed, adjacent: emphasis.adjacent, lengths: emphasis.lengths },
    themes: { count: th.count, coverage: th.coverage, gapSec: th.gapSec, overlapSec: th.overlapSec, adjacentSameTitle: th.adjacentSameTitle, allManual: th.allManual, ok: th.ok, sections: th.normalized.map((s) => ({ id: s.id, startSec: round(s.startSec, 2), endSec: round(s.endSec, 2), sec: round(s.endSec - s.startSec, 1) })), grounding: th.grounding },
    digest: { clips: sel.clips.length, totalSec: round(digestTotal, 2), items: sel.clips.map((c, i) => ({ srcStartSec: round(c.srcStartSec, 2), durationSec: round(c.durationSec, 2), themeId: themeOfClip[i], score: c.score })), clipsWithoutTheme: digestThemes.clipsWithoutTheme, reasons: sel.reasons },
    safety: { jobFileByteIdentical: sha256(bytes) === sha256(readFileSync(file)), captionsRawSegmentsClassificationUnchanged: canonBefore === canon(JSON.parse(readFileSync(file, 'utf-8'))), externalAiApiCalled: false },
  }, null, 2))
  if (problems.length) process.exitCode = 1
}

export async function stageRest(args) {
  if (args.stage === 'prepare') return stagePrepare(args)
  const { stageRender, stageCheck } = await import('./localCaptionFullRender.mjs')
  if (args.stage === 'render') return stageRender(args, { KEY, p, composeFromSaved })
  if (args.stage === 'check') return stageCheck(args, { KEY, p, composeFromSaved })
  if (args.stage === 'verify') {
    const { stageVerify } = await import('./localCaptionFullVerify.mjs')
    return stageVerify(args, { composeFromSaved })
  }
  throw new Error('ステージは align / prepare / render / check / verify のいずれかです')
}

/** 保存済みの全編データ（caption・テーマ・ダイジェスト）を読む。 */
function composeFromSaved(job) {
  const capDoc = JSON.parse(readFileSync(p('captions'), 'utf-8'))
  const topics = JSON.parse(readFileSync(p('topics'), 'utf-8'))
  const digest = JSON.parse(readFileSync(p('digest'), 'utf-8'))
  const pages = JSON.parse(readFileSync(p('pages'), 'utf-8'))
  if (capDoc.jobId !== job.id || topics.jobId !== job.id) throw new Error('保存済みデータのjobIdが一致しません')
  return { capDoc, topics, digest, pages }
}
