// ローカルAIテロップ動画: 構成動画（ダイジェスト・LINE案内）の設定状態API と、ジョブからの構成準備。
//
// - 素材（BGM・QR画像）のパスは環境設定（COMPOSITION_BGM_PATH / COMPOSITION_QR_PATH）またはレンダー要求の上書きで指定する。
//   コード・ジョブJSON・APIレスポンスには絶対パスを含めない（実在・種別・サイズ・寸法/長さだけを返す）。
// - 素材・元動画は読み取り専用。外部AI APIは呼ばない。

import express from 'express'
import { createReadStream } from 'fs'
import { extname } from 'path'
import { RECOMMENDED_COMPOSITION_PROFILE, resolveCompositionConfig, validateCompositionConfig, selectDigestClips, planTimeline, shiftMainCaptions, digestCaptions, mainThemeBlock, digestThemeBlocks, buildFinalAss } from './lib/finalComposition.mjs'
import { resolveCompositionAssets, inspectAsset } from './lib/compositionRender.mjs'
import { sanitizeMainBgmOverrides } from './lib/mainBgm.mjs'
import { inspectMainBgm, listMainBgmCandidates, resolveMainBgmId } from './lib/mainBgmAssets.mjs'
import { normalizeTopicSectionsContinuous } from './lib/topicSections.mjs'

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** 環境設定からの素材パス（未設定なら空）。 */
export function getCompositionEnvOverrides(env = process.env) {
  const bgm = String(env.COMPOSITION_BGM_PATH || '').trim()
  const qr = String(env.COMPOSITION_QR_PATH || '').trim()
  const mainBgm = String(env.COMPOSITION_MAIN_BGM_PATH || '').trim() // 本編BGMのMP3（許可ルート内。ONにするのは上書きの mainBgm.enabled）
  return { ...(bgm ? { digest: { bgm: { path: bgm } } } : {}), ...(qr ? { line: { qrPath: qr } } : {}), ...(mainBgm ? { mainBgm: { sourcePath: mainBgm } } : {}) }
}

/**
 * 環境設定でBGMまたはQRのどちらかが指定されているか（完成動画レンダーで構成を自動適用する条件）。
 * 片方だけの指定でも構成を適用し、足りない素材は prepareJobComposition が明確なエラーで止める（黙ってQRを省略しない）。
 */
export function isCompositionConfiguredByEnv(env = process.env) {
  return Boolean(String(env.COMPOSITION_BGM_PATH || '').trim() || String(env.COMPOSITION_QR_PATH || '').trim())
}

/** UIから受け取る上書きのうち、許可する項目だけを取り出す（素材パスの上書きは環境設定側のみ）。 */
export function sanitizeCompositionOverrides(body) {
  if (!isPlainObject(body)) return {}
  const num = (v) => (Number.isFinite(v) ? v : undefined)
  const bool = (v) => (typeof v === 'boolean' ? v : undefined)
  const mode = (v) => (v === 'overlay' || v === 'standalone' ? v : undefined)
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined)
  const rest = {
    digest: strip({ enabled: bool(body.digest?.enabled), durationSec: num(body.digest?.durationSec), grayscale: bool(body.digest?.grayscale), bgm: strip({ volume: num(body.digest?.bgm?.volume), fadeInSec: num(body.digest?.bgm?.fadeInSec), fadeOutSec: num(body.digest?.bgm?.fadeOutSec) }) }),
    lineIntro: strip({ enabled: bool(body.lineIntro?.enabled), mode: mode(body.lineIntro?.mode), durationSec: num(body.lineIntro?.durationSec), showQr: bool(body.lineIntro?.showQr), startWithMain: bool(body.lineIntro?.startWithMain) }),
    lineOutro: strip({ enabled: bool(body.lineOutro?.enabled), mode: mode(body.lineOutro?.mode), durationSec: num(body.lineOutro?.durationSec), showQr: bool(body.lineOutro?.showQr) }),
    qr: strip({ enabled: bool(body.qr?.enabled) }),
    preview: strip({ digest: bool(body.preview?.digest), lineIntro: bool(body.preview?.lineIntro), lineOutro: bool(body.preview?.lineOutro) }),
    // 本編BGM: 素材は「選択ID」（許可ルート内のMP3の不透明なID）だけ受け付ける。絶対パスは受け付けない。
    mainBgm: strip({ ...sanitizeMainBgmOverrides(body.mainBgm), sourceId: typeof body.mainBgm?.sourceId === 'string' && /^([0-9a-f]{16})?$/.test(body.mainBgm.sourceId) ? body.mainBgm.sourceId : undefined }),
    // ダイジェスト→本編の暗転遷移（フレーム数は30fpsのフレーム）
    transition: strip({ enabled: bool(body.transition?.enabled), fadeOutFrames: int(body.transition?.fadeOutFrames, 1, 60), holdFrames: int(body.transition?.holdFrames, 0, 30), fadeInFrames: int(body.transition?.fadeInFrames, 1, 60) }),
  }
  // profile: 'recommended' は正式採用した推奨値（約10秒ダイジェスト＋暗転遷移）を土台にし、個別の指定で上書きする
  return body.profile === 'recommended' ? merge(JSON.parse(JSON.stringify(RECOMMENDED_COMPOSITION_PROFILE)), rest) : rest
}

/** 選択ID（sourceId）を許可ルート内のMP3の実パスへ解決する。見つからなければ sourcePath を null にする（ONのままなら素材エラーで止まる）。 */
export function resolveMainBgmSource(cfgOverrides, roots) {
  const mb = cfgOverrides?.mainBgm
  if (!mb || mb.sourceId === undefined) return cfgOverrides
  const { sourceId, ...rest } = mb
  return { ...cfgOverrides, mainBgm: { ...rest, sourcePath: sourceId === '' ? null : resolveMainBgmId(sourceId, roots) } } // ''=選択の解除
}

const merge = (a, b) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : v
  return out
}

/** 設定と素材の状態（UI表示用。絶対パスは含めない）。 */
export async function describeCompositionStatus(overrides, roots, deps = {}) {
  const cfg = resolveCompositionConfig(merge(getCompositionEnvOverrides(deps.env), resolveMainBgmSource(sanitizeCompositionOverrides(overrides), roots)))
  const safeAsset = (a) => (a ? { ok: a.ok, error: a.error ?? null, sizeBytes: a.sizeBytes ?? null, durationSec: a.durationSec ?? null, width: a.width ?? null, height: a.height ?? null } : { ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null })
  const bgm = cfg.digest.bgm.path ? await inspectAsset(cfg.digest.bgm.path, 'bgm', roots, deps) : null
  const qr = cfg.line.qrPath ? await inspectAsset(cfg.line.qrPath, 'qr', roots, deps) : null
  const { path: _bgmPath, ...bgmPublic } = cfg.digest.bgm
  const { qrPath: _qrPath, ...linePublic } = cfg.line
  const { sourcePath: _mainBgmPath, sourceId: _mainBgmId, ...mainBgmPublic } = cfg.mainBgm
  const mainBgmInfo = cfg.mainBgm.sourcePath ? await inspectMainBgm(cfg.mainBgm.sourcePath, roots, deps) : null
  const mainBgmAsset = mainBgmInfo ? { ok: mainBgmInfo.ok, error: mainBgmInfo.error ?? null, fileName: mainBgmInfo.fileName ?? null, sizeBytes: mainBgmInfo.sizeBytes ?? null, durationSec: mainBgmInfo.durationSec ?? null, sampleRate: mainBgmInfo.sampleRate ?? null, channels: mainBgmInfo.channels ?? null } : { ok: false, error: '未設定', fileName: null, sizeBytes: null, durationSec: null, sampleRate: null, channels: null }
  return {
    config: { ...cfg, digest: { ...cfg.digest, bgm: bgmPublic }, line: linePublic, mainBgm: mainBgmPublic },
    assets: { bgm: safeAsset(bgm), qr: safeAsset(qr), mainBgm: mainBgmAsset },
    validation: validateCompositionConfig(cfg),
    configuredByEnv: isCompositionConfiguredByEnv(deps.env),
    appliesToFullRender: isCompositionConfiguredByEnv(deps.env),
  }
}

/**
 * ジョブから構成（ダイジェスト・LINE案内・本編オフセット）を準備する。本編=元動画の全体。
 * トークテーマは job.topicSections（あれば）を使い、無ければテーマ表示なし（根拠のない名称は作らない）。
 * @returns {Promise<{ cfg: object, assets: object, timeline: object, assText: string, digest: object, mainStartSec: number, mainEndSec: number }>}
 */
export async function prepareJobComposition(job, overrides, roots, deps = {}) {
  const cfg = resolveCompositionConfig(merge(getCompositionEnvOverrides(deps.env), resolveMainBgmSource(sanitizeCompositionOverrides(overrides), roots)), { mode: 'full' })
  const v = validateCompositionConfig(cfg)
  if (!v.ok) throw Object.assign(new Error(`構成設定が不正です: ${v.errors.join(' / ')}`), { status: 400 })
  const assets = await resolveCompositionAssets(cfg, roots, deps)
  if (!assets.ok) throw Object.assign(new Error(`素材を確認できません: ${assets.errors.join(' / ')}`), { status: 400 })
  const sorted = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  const mainStartSec = 0
  const mainEndSec = Number(job.durationSec)
  const themes = Array.isArray(job.topicSections) && job.topicSections.length > 0
    ? normalizeTopicSectionsContinuous(job.topicSections, { startSec: mainStartSec, endSec: mainEndSec }).sections
    : []
  let clips = []
  if (cfg.digest.enabled) {
    const sel = selectDigestClips({ captions: sorted, themes, config: cfg.digest })
    if (sel.reasons.length) throw Object.assign(new Error(`ダイジェストを作れません: ${sel.reasons.join(' / ')}`), { status: 400 })
    clips = sel.clips
  }
  const timeline = planTimeline(cfg, { mainStartSec, mainEndSec, digestClips: clips })
  const digBlocks = digestThemeBlocks(themes, clips, sorted).blocks
  const mainBlock = themes.length > 0 ? [mainThemeBlock(themes, mainStartSec, mainEndSec, timeline.mainOffsetSec)] : []
  const assText = buildFinalAss({
    width: job.width, height: job.height, cfg, timeline,
    mainCaptions: shiftMainCaptions(sorted, mainStartSec, mainEndSec, timeline.mainOffsetSec),
    digestCaps: digestCaptions(sorted, clips),
    themeBlocks: [...digBlocks, ...mainBlock],
    qrSize: assets.qr ? { width: assets.qr.width, height: assets.qr.height } : undefined,
  })
  return { cfg, assets, timeline, assText, digest: { clips }, mainStartSec, mainEndSec }
}

/** 本編BGMの短時間プレビュー（30〜60秒）の長さ。 */
export const MAIN_BGM_PREVIEW_SEC = Object.freeze({ min: 30, max: 60, default: 45 })

/**
 * 本編BGM付きの短時間プレビューを準備する。ダイジェスト・LINE案内は入れず、本編の一部（caption・テーマ・本編BGM）だけを作る。
 * 開始は最初のcaptionの少し前（トークとBGMが同時に聞ける位置）。本編BGMがOFF・素材不備なら400で止める。
 */
export async function prepareMainBgmPreview(job, overrides, roots, opts = {}, deps = {}) {
  const cfg = resolveCompositionConfig(
    merge(merge(getCompositionEnvOverrides(deps.env), resolveMainBgmSource(sanitizeCompositionOverrides(overrides), roots)), { digest: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { enabled: false } }),
    { mode: 'full' },
  )
  if (!cfg.mainBgm.enabled) throw Object.assign(new Error('本編BGMがOFFです。「本編BGMを使用する」をONにしてください'), { status: 400 })
  const v = validateCompositionConfig(cfg)
  if (!v.ok) throw Object.assign(new Error(`構成設定が不正です: ${v.errors.join(' / ')}`), { status: 400 })
  const assets = await resolveCompositionAssets(cfg, roots, deps)
  if (!assets.ok) throw Object.assign(new Error(`素材を確認できません: ${assets.errors.join(' / ')}`), { status: 400 })
  const sorted = [...job.captions].sort((a, b) => a.displayOrder - b.displayOrder)
  const lengthSec = Math.min(Math.max(opts.lengthSec ?? MAIN_BGM_PREVIEW_SEC.default, MAIN_BGM_PREVIEW_SEC.min), MAIN_BGM_PREVIEW_SEC.max, Number(job.durationSec))
  const startSec = Math.max(0, Math.min(Math.floor(((sorted[0]?.startSec ?? 0) - 0.5) * 10) / 10, Number(job.durationSec) - lengthSec))
  const endSec = Math.round((startSec + lengthSec) * 1000) / 1000
  const themes = Array.isArray(job.topicSections) && job.topicSections.length > 0
    ? normalizeTopicSectionsContinuous(job.topicSections, { startSec: 0, endSec: Number(job.durationSec) }).sections
    : []
  const timeline = planTimeline(cfg, { mainStartSec: startSec, mainEndSec: endSec, digestClips: [] })
  const mainBlock = themes.length > 0 ? [mainThemeBlock(themes, startSec, endSec, timeline.mainOffsetSec)] : []
  const assText = buildFinalAss({ width: job.width, height: job.height, cfg, timeline, mainCaptions: shiftMainCaptions(sorted, startSec, endSec, timeline.mainOffsetSec), digestCaps: [], themeBlocks: mainBlock })
  return { cfg, assets, timeline, assText, mainStartSec: startSec, mainEndSec: endSec, mainItems: [{ kind: 'seg', srcStartSec: startSec, srcEndSec: endSec }] }
}

/** GET /composition/status（設定・素材の状態）と GET /composition/qr-image（QRプレビュー）。 */
export function createCompositionRouter({ getRoots }) {
  const router = express.Router()
  router.use(express.json({ limit: '20kb' }))
  router.post('/status', async (req, res) => {
    try {
      res.json({ ok: true, ...(await describeCompositionStatus(req.body?.composition, getRoots())) })
    } catch {
      res.status(500).json({ ok: false, message: '設定状態を取得できませんでした' })
    }
  })
  // 本編BGMのMP3候補（許可ルート内。ファイル名と不透明なIDだけ。絶対パスは返さない）
  router.get('/main-bgm/candidates', (_req, res) => {
    try {
      res.json({ ok: true, files: listMainBgmCandidates(getRoots()) })
    } catch {
      res.status(500).json({ ok: false, message: 'MP3の一覧を取得できませんでした' })
    }
  })
  router.get('/qr-image', async (_req, res) => {
    const p = getCompositionEnvOverrides().line?.qrPath
    const a = p ? await inspectAsset(p, 'qr', getRoots()) : null
    if (!a?.ok) return res.status(404).json({ ok: false, message: 'QR画像を利用できません' })
    res.type(extname(a.realPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg')
    createReadStream(a.realPath).on('error', () => res.destroy()).pipe(res)
  })
  return router
}
