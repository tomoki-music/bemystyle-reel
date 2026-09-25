// ローカルAIテロップ動画: 5分比較用の「トークテーマ・部分強調」を確認・手動修正するためのAPI（最小実装）。
//
// - 対象は5分比較用データ（editor/data/local_caption_comparisons/five_minute/。git管理外）だけ。既存ジョブJSONには触れない。
// - AI候補は source:'ai'。ここでの修正はすべて source:'manual' になり、AI再生成(mergeRegeneratedAi)で上書きされない。
// - AI候補は個別に採用(accepted)・却下(rejected)できる。
// - このルーターはAI APIを呼ばない（分析の実行は scripts/localCaptionFiveMinute.mjs analyze のみ）。
// - 変更は全て原子的に保存する（writeJsonAtomic）。検証に失敗した修正は保存せず 400 を返す。

import express from 'express'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  analysisPath,
  writeJsonAtomic,
  editTopic,
  setTopicDecision,
  upsertEmphasis,
  removeEmphasis,
  setEmphasisDecision,
  fingerprintCaptions,
  materializeAnalysis,
} from './lib/topicAnalysis.mjs'

const JOB_ID_RE = /^[a-zA-Z0-9-]+$/

/** キーごとのpagesファイル。修正後の v2（.pages.v2.json）があれば v2、なければ v1（.pages.json）。v1は変更しない。 */
export function pagesFileFor(dataDir, key) {
  const v2 = join(dataDir, `${key}.pages.v2.json`)
  return existsSync(v2) ? v2 : join(dataDir, `${key}.pages.json`)
}

/** ジョブに対応する5分比較用のpages/analysisを探す（最新のkey）。無ければ null。 */
export function findFiveMinuteData(dataDir, jobId) {
  if (!existsSync(dataDir)) return null
  const keys = [...new Set(readdirSync(dataDir)
    .filter((n) => /\.pages(\.v2)?\.json$/.test(n))
    .map((n) => n.replace(/\.pages(\.v2)?\.json$/, '')))]
    .sort()
    .reverse()
  for (const key of keys) {
    const pages = JSON.parse(readFileSync(pagesFileFor(dataDir, key), 'utf-8'))
    if (pages.jobId !== jobId) continue
    const aPath = analysisPath(dataDir, key)
    const analysis = existsSync(aPath) ? JSON.parse(readFileSync(aPath, 'utf-8')) : null
    return { key, pages, analysis }
  }
  return null
}

export function createFiveMinuteAnalysisRouter({ dataDir }) {
  const router = express.Router({ mergeParams: true })
  router.use(express.json({ limit: '100kb' }))

  function load(req, res) {
    const id = req.params.id
    if (!JOB_ID_RE.test(id)) {
      res.status(400).json({ ok: false, message: 'ジョブIDが不正です' })
      return null
    }
    const data = findFiveMinuteData(dataDir, id)
    if (!data) {
      res.status(404).json({ ok: false, message: '5分比較用データが見つかりません' })
      return null
    }
    if (!data.analysis) {
      res.status(409).json({ ok: false, message: 'AI分析の結果がまだ保存されていません' })
      return null
    }
    if (data.analysis.captionsFingerprint !== fingerprintCaptions(data.pages.captions)) {
      res.status(409).json({ ok: false, message: '分析結果が現在のcaption列と一致しません' })
      return null
    }
    return data
  }

  function commit(res, data, result) {
    if (!result.ok) return res.status(400).json({ ok: false, message: result.errors.join(' / ') })
    writeJsonAtomic(analysisPath(dataDir, data.key), result.analysis)
    const m = materializeAnalysis(result.analysis, data.pages.captions)
    return res.json({ ok: true, analysis: result.analysis, sections: m.topicSections, emphasisCount: m.emphasisCount })
  }

  router.get('/', (req, res) => {
    const data = load(req, res)
    if (!data) return
    const m = materializeAnalysis(data.analysis, data.pages.captions)
    res.json({
      ok: true,
      captions: data.pages.captions.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, text: c.text })),
      analysis: data.analysis,
      sections: m.topicSections,
      emphasisCount: m.emphasisCount,
    })
  })

  router.patch('/topics/:topicId', (req, res) => {
    const data = load(req, res)
    if (!data) return
    const { title, startCaptionId, endCaptionId } = req.body ?? {}
    const patch = {}
    if (typeof title === 'string') patch.title = title
    if (typeof startCaptionId === 'string') patch.startCaptionId = startCaptionId
    if (typeof endCaptionId === 'string') patch.endCaptionId = endCaptionId
    commit(res, data, editTopic(data.analysis, req.params.topicId, patch, data.pages.captions))
  })

  router.post('/topics/:topicId/decision', (req, res) => {
    const data = load(req, res)
    if (!data) return
    commit(res, data, setTopicDecision(data.analysis, req.params.topicId, req.body?.decision))
  })

  router.put('/emphasis/:captionId', (req, res) => {
    const data = load(req, res)
    if (!data) return
    commit(res, data, upsertEmphasis(data.analysis, req.params.captionId, req.body?.emphasisText, data.pages.captions))
  })

  router.delete('/emphasis/:captionId', (req, res) => {
    const data = load(req, res)
    if (!data) return
    commit(res, data, removeEmphasis(data.analysis, req.params.captionId))
  })

  router.post('/emphasis/:captionId/decision', (req, res) => {
    const data = load(req, res)
    if (!data) return
    commit(res, data, setEmphasisDecision(data.analysis, req.params.captionId, req.body?.decision))
  })

  return router
}
