// ローカルAIテロップ動画: 構成動画（ダイジェスト・LINE案内）の設定状態API と、ジョブからの構成準備。
//
// - 素材（BGM・QR画像）のパスは環境設定（COMPOSITION_BGM_PATH / COMPOSITION_QR_PATH）またはレンダー要求の上書きで指定する。
//   コード・ジョブJSON・APIレスポンスには絶対パスを含めない（実在・種別・サイズ・寸法/長さだけを返す）。
// - 素材・元動画は読み取り専用。外部AI APIは呼ばない。

import express from 'express'
import { createReadStream } from 'fs'
import { extname } from 'path'
import { resolveCompositionConfig, validateCompositionConfig, selectDigestClips, planTimeline, shiftMainCaptions, digestCaptions, mainThemeBlock, digestThemeBlocks, buildFinalAss } from './lib/finalComposition.mjs'
import { resolveCompositionAssets, inspectAsset } from './lib/compositionRender.mjs'
import { normalizeTopicSectionsContinuous } from './lib/topicSections.mjs'

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** 環境設定からの素材パス（未設定なら空）。 */
export function getCompositionEnvOverrides(env = process.env) {
  const bgm = String(env.COMPOSITION_BGM_PATH || '').trim()
  const qr = String(env.COMPOSITION_QR_PATH || '').trim()
  return { ...(bgm ? { digest: { bgm: { path: bgm } } } : {}), ...(qr ? { line: { qrPath: qr } } : {}) }
}

/** 環境設定でBGM・QRの両方が指定されているか（完成動画レンダーで構成を自動適用する条件）。 */
export function isCompositionConfiguredByEnv(env = process.env) {
  return Boolean(String(env.COMPOSITION_BGM_PATH || '').trim() && String(env.COMPOSITION_QR_PATH || '').trim())
}

/** UIから受け取る上書きのうち、許可する項目だけを取り出す（素材パスの上書きは環境設定側のみ）。 */
export function sanitizeCompositionOverrides(body) {
  if (!isPlainObject(body)) return {}
  const num = (v) => (Number.isFinite(v) ? v : undefined)
  const bool = (v) => (typeof v === 'boolean' ? v : undefined)
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  return {
    digest: strip({ enabled: bool(body.digest?.enabled), durationSec: num(body.digest?.durationSec), grayscale: bool(body.digest?.grayscale), bgm: strip({ volume: num(body.digest?.bgm?.volume), fadeInSec: num(body.digest?.bgm?.fadeInSec), fadeOutSec: num(body.digest?.bgm?.fadeOutSec) }) }),
    lineIntro: strip({ enabled: bool(body.lineIntro?.enabled), durationSec: num(body.lineIntro?.durationSec), showQr: bool(body.lineIntro?.showQr) }),
    lineOutro: strip({ enabled: bool(body.lineOutro?.enabled), durationSec: num(body.lineOutro?.durationSec), showQr: bool(body.lineOutro?.showQr) }),
    preview: strip({ digest: bool(body.preview?.digest), lineIntro: bool(body.preview?.lineIntro), lineOutro: bool(body.preview?.lineOutro) }),
  }
}

const merge = (a, b) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : v
  return out
}

/** 設定と素材の状態（UI表示用。絶対パスは含めない）。 */
export async function describeCompositionStatus(overrides, roots, deps = {}) {
  const cfg = resolveCompositionConfig(merge(getCompositionEnvOverrides(deps.env), sanitizeCompositionOverrides(overrides)))
  const safeAsset = (a) => (a ? { ok: a.ok, error: a.error ?? null, sizeBytes: a.sizeBytes ?? null, durationSec: a.durationSec ?? null, width: a.width ?? null, height: a.height ?? null } : { ok: false, error: '未設定', sizeBytes: null, durationSec: null, width: null, height: null })
  const bgm = cfg.digest.bgm.path ? await inspectAsset(cfg.digest.bgm.path, 'bgm', roots, deps) : null
  const qr = cfg.line.qrPath ? await inspectAsset(cfg.line.qrPath, 'qr', roots, deps) : null
  const { path: _bgmPath, ...bgmPublic } = cfg.digest.bgm
  const { qrPath: _qrPath, ...linePublic } = cfg.line
  return {
    config: { ...cfg, digest: { ...cfg.digest, bgm: bgmPublic }, line: linePublic },
    assets: { bgm: safeAsset(bgm), qr: safeAsset(qr) },
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
  const cfg = resolveCompositionConfig(merge(getCompositionEnvOverrides(deps.env), sanitizeCompositionOverrides(overrides)), { mode: 'full' })
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
  })
  return { cfg, assets, timeline, assText, digest: { clips }, mainStartSec, mainEndSec }
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
  router.get('/qr-image', async (_req, res) => {
    const p = getCompositionEnvOverrides().line?.qrPath
    const a = p ? await inspectAsset(p, 'qr', getRoots()) : null
    if (!a?.ok) return res.status(404).json({ ok: false, message: 'QR画像を利用できません' })
    res.type(extname(a.realPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg')
    createReadStream(a.realPath).on('error', () => res.destroy()).pipe(res)
  })
  return router
}
