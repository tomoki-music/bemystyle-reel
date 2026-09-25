// ローカルAIテロップ動画: 本機能に rawSegments (raw transcription) の概念を導入する前に
// 作成されたジョブJSONを、後方互換のために1回だけ整形するための移行スクリプト。
//
// 何をするか:
// - rawSegments が無い（=このジョブは分割前の生segmentがそのままcaptionsとして
//   保存されている旧形式）ジョブについて、現在のcaptionsをrawSegmentsとしてコピーし、
//   captionsはそこからcaptionSegmenterで決定的に分割した表示用データへ置き換える。
// - Whisper APIは一切呼び出さない。ジョブJSONを削除しない。字幕本文は標準出力に出さない。
// - 既にrawSegmentsを持つジョブ、captionsが空のジョブはスキップする（冪等）。
//
// 実行方法: node editor/scripts/migrateLegacyCaptionJobs.mjs [jobsDir]
// jobsDir省略時は editor/data/local_caption_videos。

import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { JobStore } from '../server/lib/jobStore.mjs'
import { buildDisplayCaptionsFromSegments } from '../server/lib/captionSegmenter.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function migrateJob(job) {
  const hasRawSegments = Array.isArray(job.rawSegments) && job.rawSegments.length > 0
  const captions = Array.isArray(job.captions) ? job.captions : []
  if (hasRawSegments || captions.length === 0) {
    return { job, migrated: false }
  }

  const sorted = [...captions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  const rawSegments = sorted.map((c) => ({ startSec: c.startSec, endSec: c.endSec, text: c.text }))
  const displayChunks = buildDisplayCaptionsFromSegments(rawSegments)

  const nextCaptions = displayChunks.map((chunk, i) => ({
    id: `migrated-${job.id}-${i}`,
    startSec: chunk.startSec,
    endSec: chunk.endSec,
    text: chunk.text,
    captionType: 'normal',
    emphasisText: null,
    displayOrder: i,
  }))

  return {
    job: { ...job, rawSegments, captions: nextCaptions },
    migrated: true,
    rawCount: rawSegments.length,
    captionCount: nextCaptions.length,
  }
}

async function main() {
  const jobsDir = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '..', 'data', 'local_caption_videos')
  const store = new JobStore(jobsDir)
  const jobs = store.list()

  let migratedCount = 0
  for (const job of jobs) {
    const result = migrateJob(job)
    if (!result.migrated) {
      console.log(`[migrate] skip job=${job.id} (already migrated or no captions)`)
      continue
    }
    store.save(result.job)
    migratedCount++
    console.log(`[migrate] done job=${job.id} rawSegments=${result.rawCount} captions=${result.captionCount}`)
  }
  console.log(`[migrate] complete: ${migratedCount}/${jobs.length} job(s) migrated`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  main().catch((err) => {
    console.error('[migrate] failed:', err?.message || err)
    process.exit(1)
  })
}
